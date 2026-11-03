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

// gRPC status codes for which retrying the same payload cannot succeed.
const GRPC_INVALID_ARGUMENT = 3;

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

/**
 * Export records in batches, sequentially, and throw if any batch fails.
 *
 * A retryable failure throws immediately (the invocation will be retried, so there
 * is no point sending the remaining batches now). `ExportError.settled` says how
 * many leading records were already handled, so a retry can skip them.
 *
 * A non-retryable failure (the payload itself was rejected) does not stop the
 * remaining batches; once they are sent, a non-retryable ExportError reports how
 * many records were dropped.
 */
export async function exportRecords(
  exporter: LogRecordExporter,
  records: ReadableLogRecord[],
  maxBatchSize: number = MAX_EXPORT_BATCH_SIZE
): Promise<void> {
  let dropped = 0;
  let lastRejection: any;

  for (let i = 0; i < records.length; i += maxBatchSize) {
    const batch = records.slice(i, i + maxBatchSize);
    const result = await exportBatch(exporter, batch);

    if (result.code === ExportResultCode.SUCCESS) continue;

    const error: any = result.error;
    if (error?.code === GRPC_INVALID_ARGUMENT) {
      dropped += batch.length;
      lastRejection = error;
      continue;
    }

    throw new ExportError(
      `Failed to export ${batch.length} log records to Coralogix: ${error?.message ?? "unknown error"}`,
      true,
      i,
      error
    );
  }

  if (dropped > 0) {
    throw new ExportError(
      `Coralogix rejected ${dropped} log records as invalid; they will not be retried: ${lastRejection?.message ?? "unknown error"}`,
      false,
      records.length,
      lastRejection
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
