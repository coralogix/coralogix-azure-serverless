/**
 * Synchronous, result-checked export of log records.
 *
 * The OTel BatchLogRecordProcessor exports in the background and swallows export
 * errors (they only reach the OTel diag logger), so an invocation could report
 * success while its logs were dropped. Instead, each invocation collects the
 * records it emitted and exports them itself, awaiting the exporter's result.
 */

import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import {
  LogRecordExporter,
  LogRecordProcessor,
  ReadableLogRecord,
  SdkLogRecord,
} from "@opentelemetry/sdk-logs";

export const MAX_EXPORT_BATCH_SIZE = 512;

// Upper bound for the estimated size of one export request. Event Hub events can be
// up to 1 MB each, so a record-count limit alone can produce requests of hundreds of
// MB, which are rejected or time out. Coralogix documents a hard limit of 10 MB per
// OTLP request and recommends 2 MB.
export const MAX_EXPORT_BATCH_BYTES = 2 * 1024 * 1024;

// gRPC status codes for which retrying the same payload cannot succeed.
const GRPC_INVALID_ARGUMENT = 3;
// RESOURCE_EXHAUSTED is used both for "message too large" (permanent for that
// payload) and for throttling / load shedding (transient); only the former is split.
const GRPC_RESOURCE_EXHAUSTED = 8;
// Size rejections as reported by gRPC servers and clients, e.g. Coralogix ingress:
//   "decoded message length too large: found N bytes, the limit is: M bytes"
//   "size limit, of N bytes, exceeded while decompressing message"
// and grpc-js / grpc-go: "Received message larger than max (N vs. M)".
const MESSAGE_TOO_LARGE =
  /larger than max|too large|size limit.*exceeded|exceeded while decompressing/i;

export function isMessageTooLarge(error: any): boolean {
  return error?.code === GRPC_RESOURCE_EXHAUSTED && MESSAGE_TOO_LARGE.test(String(error?.message));
}

/** Rough serialized size of a record: body plus attributes, as UTF-8 bytes. */
export function estimateRecordBytes(record: ReadableLogRecord): number {
  const body = typeof record.body === "string" ? record.body : JSON.stringify(record.body ?? "");
  const attributes = record.attributes ? JSON.stringify(record.attributes) : "";
  return Buffer.byteLength(body ?? "", "utf8") + Buffer.byteLength(attributes, "utf8") + 64;
}

/** Split records, in order, into batches bounded by both count and estimated bytes. */
export function toBatches(
  records: ReadableLogRecord[],
  maxBatchSize: number = MAX_EXPORT_BATCH_SIZE,
  maxBatchBytes: number = MAX_EXPORT_BATCH_BYTES
): ReadableLogRecord[][] {
  const batches: ReadableLogRecord[][] = [];
  let current: ReadableLogRecord[] = [];
  let currentBytes = 0;

  for (const record of records) {
    const bytes = estimateRecordBytes(record);
    if (
      current.length > 0 &&
      (current.length >= maxBatchSize || currentBytes + bytes > maxBatchBytes)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(record);
    currentBytes += bytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export interface CollectedRecord {
  record: ReadableLogRecord;
  /** Event Hub event the record came from (`<partition>:<sequenceNumber>`), if known. */
  eventKey?: string;
  /** Position of the record among this processor's records for that event. */
  ordinal: number;
}

/**
 * Buffers emitted records until the invocation that emitted them drains the buffer.
 *
 * Records are emitted synchronously while an invocation processes its events and
 * drained synchronously right after, before the invocation awaits anything, so a
 * concurrent invocation can never interleave its records into another one's drain.
 *
 * Each record is tagged with the event it came from and its position within that
 * event, which is deterministic for the same event. This lets a retried invocation
 * recognise records it already delivered.
 */
export class CollectingLogRecordProcessor implements LogRecordProcessor {
  private records: CollectedRecord[] = [];
  private ordinals = new Map<string, number>();

  constructor(private readonly currentEventKey: () => string | undefined = () => undefined) {}

  onEmit(logRecord: SdkLogRecord): void {
    const eventKey = this.currentEventKey();
    const counterKey = eventKey ?? "";
    const ordinal = this.ordinals.get(counterKey) ?? 0;
    this.ordinals.set(counterKey, ordinal + 1);
    this.records.push({ record: logRecord, eventKey, ordinal });
  }

  drain(): CollectedRecord[] {
    const drained = this.records;
    this.records = [];
    this.ordinals.clear();
    return drained;
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.records = [];
    this.ordinals.clear();
    return Promise.resolve();
  }
}

export class ExportError extends Error {
  readonly retryable: boolean;
  /**
   * Number of leading records that need no further attempt: they were accepted,
   * or rejected as invalid (retrying them cannot succeed).
   */
  readonly settled: number;
  readonly cause?: unknown;

  constructor(message: string, retryable: boolean, settled: number, cause?: unknown) {
    super(message);
    this.name = "ExportError";
    this.retryable = retryable;
    this.settled = settled;
    this.cause = cause;
  }
}

function exportBatch(
  exporter: LogRecordExporter,
  batch: ReadableLogRecord[]
): Promise<ExportResult> {
  return new Promise((resolve) => {
    try {
      exporter.export(batch, resolve);
    } catch (error: any) {
      resolve({ code: ExportResultCode.FAILED, error });
    }
  });
}

interface ExportProgress {
  /** Leading records that need no further attempt (accepted, or rejected for good). */
  settled: number;
  dropped: number;
  lastRejection?: any;
}

/**
 * Export one batch. A batch rejected as too large is split in half and each half
 * sent in turn, until the offending record is isolated; a single record that is
 * still rejected, or a batch rejected as invalid, is dropped (retrying the same
 * payload cannot succeed). Returns the error of a retryable failure, if any.
 */
async function exportChunk(
  exporter: LogRecordExporter,
  batch: ReadableLogRecord[],
  progress: ExportProgress
): Promise<any | undefined> {
  const result = await exportBatch(exporter, batch);
  if (result.code === ExportResultCode.SUCCESS) {
    progress.settled += batch.length;
    return undefined;
  }

  const error: any = result.error ?? new Error("unknown error");

  if (isMessageTooLarge(error) && batch.length > 1) {
    const middle = Math.ceil(batch.length / 2);
    for (const half of [batch.slice(0, middle), batch.slice(middle)]) {
      const failure = await exportChunk(exporter, half, progress);
      if (failure) return failure;
    }
    return undefined;
  }

  if (error.code === GRPC_INVALID_ARGUMENT || isMessageTooLarge(error)) {
    progress.settled += batch.length;
    progress.dropped += batch.length;
    progress.lastRejection = error;
    return undefined;
  }

  return error;
}

/**
 * Export records in batches (bounded by count and estimated bytes), sequentially,
 * and throw if any batch fails.
 *
 * A retryable failure throws immediately (the invocation will be retried, so there
 * is no point sending the remaining batches now). `ExportError.settled` says how
 * many leading records were already handled, so a retry can skip them.
 *
 * Records rejected for good (invalid, or too large even on their own) do not stop
 * the remaining batches; once they are sent, a non-retryable ExportError reports
 * how many records were dropped.
 */
export async function exportRecords(
  exporter: LogRecordExporter,
  records: ReadableLogRecord[],
  maxBatchSize: number = MAX_EXPORT_BATCH_SIZE,
  maxBatchBytes: number = MAX_EXPORT_BATCH_BYTES
): Promise<void> {
  const progress: ExportProgress = { settled: 0, dropped: 0 };

  for (const batch of toBatches(records, maxBatchSize, maxBatchBytes)) {
    const settledBefore = progress.settled;
    const failure = await exportChunk(exporter, batch, progress);
    if (failure) {
      const pending = batch.length - (progress.settled - settledBefore);
      throw new ExportError(
        `Failed to export ${pending} log records to Coralogix: ${failure?.message ?? "unknown error"}`,
        true,
        progress.settled,
        failure
      );
    }
  }

  if (progress.dropped > 0) {
    throw new ExportError(
      `Coralogix rejected ${progress.dropped} log records as invalid or too large; they will not be retried: ${progress.lastRejection?.message ?? "unknown error"}`,
      false,
      records.length,
      progress.lastRejection
    );
  }
}

/**
 * Remembers which records of a failed invocation were already delivered, so the
 * retry of that invocation (same events, same instance) only sends the rest.
 *
 * Kept in memory: Azure Functions retries an Event Hubs batch on the same instance.
 * If the instance is replaced, the batch is redelivered in full (Event Hubs'
 * at-least-once behaviour). Bounded so it cannot grow without limit.
 */
export class DeliveredRecords {
  private delivered = new Map<string, Set<string>>();

  constructor(private readonly maxEvents: number = 50_000) {}

  private static recordId(scope: string, ordinal: number): string {
    return `${scope}#${ordinal}`;
  }

  has(scope: string, item: CollectedRecord): boolean {
    if (!item.eventKey) return false;
    return (
      this.delivered.get(item.eventKey)?.has(DeliveredRecords.recordId(scope, item.ordinal)) ??
      false
    );
  }

  add(scope: string, item: CollectedRecord): void {
    if (!item.eventKey) return;
    let ids = this.delivered.get(item.eventKey);
    if (!ids) {
      ids = new Set();
      this.delivered.set(item.eventKey, ids);
      while (this.delivered.size > this.maxEvents) {
        this.delivered.delete(this.delivered.keys().next().value);
      }
    }
    ids.add(DeliveredRecords.recordId(scope, item.ordinal));
  }

  /** Forget events whose invocation completed; they will not be retried. */
  forget(eventKeys: Iterable<string>): void {
    for (const key of eventKeys) this.delivered.delete(key);
  }

  get size(): number {
    return this.delivered.size;
  }
}
