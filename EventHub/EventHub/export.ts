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

/**
 * Buffers emitted records until the invocation that emitted them drains the buffer.
 *
 * Records are emitted synchronously while an invocation processes its events and
 * drained synchronously right after, before the invocation awaits anything, so a
 * concurrent invocation can never interleave its records into another one's drain.
 */
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

/**
 * Export records in batches, sequentially, and throw if any batch fails.
 *
 * A retryable failure throws immediately: the whole invocation will be retried, so
 * there is no point sending the remaining batches now. Batches exported before it
 * are not rolled back, so a retry may deliver them twice (at-least-once delivery).
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
      error
    );
  }

  if (dropped > 0) {
    throw new ExportError(
      `Coralogix rejected ${dropped} log records as invalid; they will not be retried: ${lastRejection?.message ?? "unknown error"}`,
      false,
      lastRejection
    );
  }
}
