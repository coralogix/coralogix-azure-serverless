import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import {
  LogRecordExporter,
  LogRecordProcessor,
  ReadableLogRecord,
  SdkLogRecord,
} from "@opentelemetry/sdk-logs";

export const MAX_EXPORT_BATCH_SIZE = 512;

// Coralogix's recommended maximum OTLP request size.
export const MAX_EXPORT_BATCH_BYTES = 2 * 1024 * 1024;

const GRPC_INVALID_ARGUMENT = 3;
// RESOURCE_EXHAUSTED is used both for "message too large" (permanent for that
// payload) and for throttling / load shedding (transient); only the former is split.
const GRPC_RESOURCE_EXHAUSTED = 8;
const MESSAGE_TOO_LARGE =
  /larger than max|too large|size limit.*exceeded|exceeded while decompressing/i;

export function isMessageTooLarge(error: any): boolean {
  return error?.code === GRPC_RESOURCE_EXHAUSTED && MESSAGE_TOO_LARGE.test(String(error?.message));
}

export function estimateRecordBytes(record: ReadableLogRecord): number {
  const body = typeof record.body === "string" ? record.body : JSON.stringify(record.body ?? "");
  const attributes = record.attributes ? JSON.stringify(record.attributes) : "";
  return Buffer.byteLength(body ?? "", "utf8") + Buffer.byteLength(attributes, "utf8") + 64;
}

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

// onEmit and drain run synchronously before the handler's first await.
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
  /** Number of leading records that need no further attempt. */
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
  settled: number;
  dropped: number;
  lastRejection?: any;
}

// A whole request is rejected for one bad record (invalid or too large), so split
// rejected batches until the bad record is isolated and only that record is dropped.
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
  const payloadRejected = error.code === GRPC_INVALID_ARGUMENT || isMessageTooLarge(error);

  if (payloadRejected && batch.length > 1) {
    const middle = Math.ceil(batch.length / 2);
    for (const half of [batch.slice(0, middle), batch.slice(middle)]) {
      const failure = await exportChunk(exporter, half, progress);
      if (failure) return failure;
    }
    return undefined;
  }

  if (payloadRejected) {
    progress.settled += batch.length;
    progress.dropped += batch.length;
    progress.lastRejection = error;
    return undefined;
  }

  return error;
}

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

// Best-effort duplicate suppression for retries on the same worker.
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

  forget(eventKeys: Iterable<string>): void {
    for (const key of eventKeys) this.delivered.delete(key);
  }

  get size(): number {
    return this.delivered.size;
  }
}
