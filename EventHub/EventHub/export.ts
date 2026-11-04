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

// Failures that say nothing about the connection: the exporter's own in-flight limit,
// and Coralogix throttling or load shedding. Retry them, but keep the exporter.
export function isSaturation(error: any): boolean {
  const cause = error instanceof ExportError ? error.cause : error;
  if (cause?.code === GRPC_RESOURCE_EXHAUSTED) return true;
  return /Concurrent export limit reached/i.test(String(cause?.message ?? error?.message));
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

// onEmit and drain run synchronously before the handler's first await.
export class CollectingLogRecordProcessor implements LogRecordProcessor {
  private records: ReadableLogRecord[] = [];

  onEmit(logRecord: SdkLogRecord): void {
    this.records.push(logRecord);
  }

  drain(): ReadableLogRecord[] {
    const drained = this.records;
    this.records = [];
    return drained;
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.records = [];
    return Promise.resolve();
  }
}

export class ExportError extends Error {
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(message: string, retryable: boolean, cause?: unknown) {
    super(message);
    this.name = "ExportError";
    this.retryable = retryable;
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

// Extra requests allowed per export for splitting rejected batches. Isolating one bad
// record in a 512-record batch takes ~18; a batch where most records are rejected would
// otherwise take up to 2N-1 requests and could outlast the function timeout.
export const MAX_SPLIT_REQUESTS = 64;

interface ExportProgress {
  dropped: number;
  lastRejection?: any;
  splitBudget: number;
}

// A whole request is rejected for one bad record (invalid or too large), so split
// rejected batches until the bad record is isolated and only that record is dropped.
// Once the split budget is spent, a rejected chunk is dropped as a whole.
async function exportChunk(
  exporter: LogRecordExporter,
  batch: ReadableLogRecord[],
  progress: ExportProgress
): Promise<any | undefined> {
  const result = await exportBatch(exporter, batch);
  if (result.code === ExportResultCode.SUCCESS) return undefined;

  const error: any = result.error ?? new Error("unknown error");
  const payloadRejected = error.code === GRPC_INVALID_ARGUMENT || isMessageTooLarge(error);

  if (payloadRejected && batch.length > 1 && progress.splitBudget >= 2) {
    progress.splitBudget -= 2;
    const middle = Math.ceil(batch.length / 2);
    for (const half of [batch.slice(0, middle), batch.slice(middle)]) {
      const failure = await exportChunk(exporter, half, progress);
      if (failure) return failure;
    }
    return undefined;
  }

  if (payloadRejected) {
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
  const progress: ExportProgress = { dropped: 0, splitBudget: 0 };

  for (const batch of toBatches(records, maxBatchSize, maxBatchBytes)) {
    // Each batch gets its own split budget, so one bad batch can't use up the next one's.
    progress.splitBudget = MAX_SPLIT_REQUESTS;
    const failure = await exportChunk(exporter, batch, progress);
    if (failure) {
      throw new ExportError(
        `Failed to export log records to Coralogix: ${failure?.message ?? "unknown error"}`,
        true,
        failure
      );
    }
  }

  if (progress.dropped > 0) {
    throw new ExportError(
      `Coralogix rejected ${progress.dropped} log records as invalid or too large; they will not be retried: ${progress.lastRejection?.message ?? "unknown error"}`,
      false,
      progress.lastRejection
    );
  }
}
