/**
 * Azure Function for integration of Event Hub with Coralogix
 *
 * @file        This file contains function source code
 * @author      Coralogix Ltd. <info@coralogix.com>
 * @link        https://coralogix.com/
 * @copyright   Coralogix Ltd.
 * @licence     Apache-2.0
 * @version     3.8.0
 * @since       1.0.0
 */

import { InvocationContext } from "@azure/functions";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { Logger } from "@opentelemetry/api-logs";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { resolveSelector, TemplateContext } from "./nameResolution";
import {
  CollectedRecord,
  CollectingLogRecordProcessor,
  DeliveredRecords,
  ExportError,
  exportRecords,
} from "./export";

// Surface OTel's internal diagnostics (exporter/connection errors) in the function
// logs. OTEL_LOG_LEVEL is not read by the OTel packages used here, so honour it.
const OTEL_LOG_LEVEL =
  DiagLogLevel[(process.env.OTEL_LOG_LEVEL || "").toUpperCase() as keyof typeof DiagLogLevel] ??
  DiagLogLevel.WARN;
diag.setLogger(new DiagConsoleLogger(), OTEL_LOG_LEVEL);

const APPLICATION_NAME = process.env.CORALOGIX_APPLICATION;
const SUBSYSTEM_NAME = process.env.CORALOGIX_SUBSYSTEM;

const APPLICATION_SELECTOR = process.env.CORALOGIX_APPLICATION_SELECTOR;
const SUBSYSTEM_SELECTOR = process.env.CORALOGIX_SUBSYSTEM_SELECTOR;

const FUNCTION_NAME = process.env.FUNCTION_APP_NAME || "unknown";
const INCLUDE_METADATA = process.env.INCLUDE_METADATA === "true";

const NEWLINE_PATTERN = process.env.NEWLINE_PATTERN;
const NEWLINE_REGEX = NEWLINE_PATTERN ? new RegExp(NEWLINE_PATTERN, "g") : null;

const BLOCKING_PATTERN = process.env.BLOCKING_PATTERN;
const BLOCKING_REGEX = BLOCKING_PATTERN ? new RegExp(BLOCKING_PATTERN) : null;

const BASE_RESOURCE_ATTRIBUTES: Record<string, any> = {
  [ATTR_SERVICE_NAME]: "eventhub-to-otel",
};

interface LoggerCacheEntry {
  provider: LoggerProvider;
  logger: Logger;
  collector: CollectingLogRecordProcessor;
  exporter: OTLPLogExporter;
}

const loggerCache = new Map<string, LoggerCacheEntry>();

// Records already delivered by a failed invocation, skipped when it is retried.
const deliveredRecords = new DeliveredRecords();

// Event being processed while records are emitted (set synchronously per event).
let currentEventKey: string | undefined;

// The app runs on the v3 Node programming model (function.json), where the error
// and warning loggers are context.log.error / context.log.warn; the v4 model has
// context.error / context.warn. Support both.
function logError(context: InvocationContext, message: string): void {
  const ctx: any = context;
  if (typeof ctx.error === "function") ctx.error(message);
  else if (typeof ctx.log?.error === "function") ctx.log.error(message);
  else ctx.log(message);
}

function logWarn(context: InvocationContext, message: string): void {
  const ctx: any = context;
  if (typeof ctx.warn === "function") ctx.warn(message);
  else if (typeof ctx.log?.warn === "function") ctx.log.warn(message);
  else ctx.log(message);
}

/**
 * Stable identity of each event in the batch, `<partitionId>:<sequenceNumber>`,
 * from the trigger metadata (v3: context.bindingData, v4: context.triggerMetadata).
 * Returns undefined when it is incomplete; retries then resend the whole batch
 * rather than risk skipping a record that was never delivered.
 */
export function getEventKeys(context: InvocationContext, eventCount: number): string[] | undefined {
  const ctx: any = context;
  const metadata = ctx.triggerMetadata ?? ctx.bindingData;
  const partitionContext = metadata?.partitionContext ?? metadata?.PartitionContext;
  const partitionId = partitionContext?.partitionId ?? partitionContext?.PartitionId;
  const sequenceNumbers = metadata?.sequenceNumberArray ?? metadata?.SequenceNumberArray;

  if (partitionId === undefined || partitionId === null || partitionId === "") return undefined;
  if (!Array.isArray(sequenceNumbers) || sequenceNumbers.length !== eventCount) return undefined;
  if (sequenceNumbers.some((n) => n === undefined || n === null)) return undefined;

  return sequenceNumbers.map((n) => `${partitionId}:${n}`);
}

// Get or create a logger for a specific app/subsystem combination.
function getLoggerForAppSubsystem(appName: string, subsystemName: string): Logger {
  const cacheKey = `${appName}::${subsystemName}`;
  const cached = loggerCache.get(cacheKey);

  if (cached) return cached.logger;

  const resource = resourceFromAttributes({
    ...BASE_RESOURCE_ATTRIBUTES,
    "cx.application.name": appName,
    "cx.subsystem.name": subsystemName,
  });
  const collector = new CollectingLogRecordProcessor(() => currentEventKey);
  const exporter = new OTLPLogExporter();
  const provider = new LoggerProvider({ resource, processors: [collector] });

  const logger = provider.getLogger("azure-eventhub-logs");
  loggerCache.set(cacheKey, { provider, logger, collector, exporter });

  return logger;
}

// Drop a cache entry whose export failed so the next invocation builds a fresh
// exporter, and with it a fresh gRPC connection, instead of reusing a broken one.
function evictLogger(cacheKey: string, entry: LoggerCacheEntry, context: InvocationContext): void {
  if (loggerCache.get(cacheKey) === entry) loggerCache.delete(cacheKey);
  entry.exporter
    .shutdown()
    .catch((e: any) =>
      logWarn(context, `Failed to shut down exporter for ${cacheKey}: ${e?.message}`)
    );
}

function isBlocked(body: string): boolean {
  if (!BLOCKING_REGEX) return false;
  return BLOCKING_REGEX.test(body);
}

export enum LogFormat {
  STRING = "string",
  JSON_STRING = "json-string",
  JSON_OBJECT = "json-object",
  JSON_ARRAY = "json-array",
  INVALID = "invalid",
}

export function detectLogFormat(log: unknown): LogFormat {
  if (log === null || log === undefined) {
    return LogFormat.INVALID;
  }

  if (typeof log === "string") {
    try {
      const parsed = JSON.parse(log);
      if (Array.isArray(parsed)) return LogFormat.JSON_ARRAY;
      return LogFormat.JSON_STRING;
    } catch {
      return LogFormat.STRING;
    }
  }

  if (Array.isArray(log)) {
    return LogFormat.JSON_ARRAY;
  }

  if (typeof log === "object") {
    return LogFormat.JSON_OBJECT;
  }

  // handle primitives (number, boolean, etc.)
  return LogFormat.STRING;
}

export interface LogHandlerResult {
  body: string;
  parsedBody: any | null;
}

export function resolveApplicationAndSubsystem(
  rawBody: string,
  parsedBody: any,
  attributes: Record<string, any>
) {
  const ctx: TemplateContext = {
    body: parsedBody ?? rawBody,
    attributes,
  };

  const resolvedApp = resolveSelector(APPLICATION_SELECTOR, ctx, rawBody);
  const resolvedSubsystem = resolveSelector(SUBSYSTEM_SELECTOR, ctx, rawBody);

  const app = resolvedApp ?? APPLICATION_NAME ?? "coralogix-azure-eventhub";
  const subsystem = resolvedSubsystem ?? SUBSYSTEM_NAME ?? "azure";

  return { app, subsystem };
}

function enrichAzureMetadata(attributes: Record<string, any>, parsedBody: any): void {
  if (!parsedBody || typeof parsedBody !== "object") return;

  const resourceId = (parsedBody as any).resourceId;
  if (!resourceId || typeof resourceId !== "string") return;

  const parts = resourceId.split("/").filter(Boolean);

  const subIdx = parts.findIndex((p) => p.toLowerCase() === "subscriptions");
  if (subIdx !== -1 && parts[subIdx + 1]) {
    attributes["azure.subscription_id"] = parts[subIdx + 1];
  }

  const rgIdx = parts.findIndex((p) => p.toLowerCase() === "resourcegroups");
  if (rgIdx !== -1 && parts[rgIdx + 1]) {
    attributes["azure.resource_group"] = parts[rgIdx + 1];
  }

  const provIdx = parts.findIndex((p) => p.toLowerCase() === "providers");
  if (provIdx !== -1 && parts[provIdx + 1]) {
    attributes["azure.provider"] = parts[provIdx + 1].toLowerCase();
  }
}

const writeLog = function (
  context: InvocationContext,
  text: any,
  threadId: string,
  idx: number
): void {
  if (!text) return;
  const attributes: Record<string, any> = {
    "function.name": FUNCTION_NAME,
    ...(INCLUDE_METADATA && { threadId, "message.index": idx }),
  };

  try {
    const format = detectLogFormat(text);
    const logEntries = handleLogEntries(text, format, context);

    for (const { body, parsedBody } of logEntries) {
      if (INCLUDE_METADATA && parsedBody) {
        enrichAzureMetadata(attributes, parsedBody);
      }

      const { app, subsystem } = resolveApplicationAndSubsystem(body, parsedBody, attributes);

      attributes.applicationName = app;
      attributes.subsystemName = subsystem;

      const logger = getLoggerForAppSubsystem(app, subsystem);
      logger.emit({
        body,
        attributes,
      });
    }
  } catch (e: any) {
    context.log(`writeLog failed for message ${idx}: ${e.message}`);
    throw e;
  }
};

export function handleLogEntries(
  raw: any,
  format: LogFormat,
  context: InvocationContext
): LogHandlerResult[] {
  let entries: LogHandlerResult[];

  switch (format) {
    case LogFormat.JSON_OBJECT:
      entries = [
        {
          body: JSON.stringify(raw),
          parsedBody: raw,
        },
      ];
      break;

    case LogFormat.JSON_STRING:
      const parsed = JSON.parse(raw);
      entries = [
        {
          body: raw,
          parsedBody: parsed,
        },
      ];
      break;

    case LogFormat.JSON_ARRAY:
      const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
      entries = arr.map((elem) => ({
        body: typeof elem === "object" ? JSON.stringify(elem) : String(elem),
        parsedBody: typeof elem === "object" ? elem : null,
      }));
      break;

    case LogFormat.STRING: {
      const text = String(raw);

      // If no newline pattern configured - treat as single log
      if (!NEWLINE_REGEX) {
        entries = [{ body: text, parsedBody: null }];
        break;
      }

      // Split text using the configured regex
      const parts = text.split(NEWLINE_REGEX).filter((p) => p.trim() !== "");

      // Keep original as single log if the regex matches nothing
      if (parts.length <= 1) {
        entries = [{ body: text, parsedBody: null }];
        break;
      }

      // Create multiple log records for each part
      entries = parts.map((p) => ({
        body: p,
        parsedBody: null,
      }));
      break;
    }

    case LogFormat.INVALID:
      context.log(`Skipping invalid log payload: ${typeof raw}`);
      return [];

    default:
      context.log(`Unknown log format: ${format}`);
      return [];
  }

  // filter out blocked logs
  if (BLOCKING_REGEX) {
    return entries.filter((entry) => {
      const bodyToCheck = entry.parsedBody != null ? JSON.stringify(entry.parsedBody) : entry.body;
      if (isBlocked(bodyToCheck)) {
        context.log(`Coralogix: blocked log line (pattern=${BLOCKING_PATTERN}): ${bodyToCheck}`);
        return false;
      }
      return true;
    });
  }

  return entries;
}

/**
 * @description Unwrap an EventHub message into individual log entries.
 * @param message - Raw EventHub message (string, object, or any)
 * @returns Array of individual log entries to process
 */
export function unwrapEventHubMessage(message: any): any[] {
  let parsed = message;
  if (typeof message === "string") {
    try {
      parsed = JSON.parse(message);
    } catch {
      parsed = message;
    }
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    Array.isArray(parsed.records)
  ) {
    return parsed.records;
  }

  if (parsed && typeof parsed === "object" && "body" in parsed) {
    return [parsed.body];
  }

  return [message];
}

/* -------------------------------------------------------------------------- */
/*  Azure Function entrypoint                                                 */
/* -------------------------------------------------------------------------- */
/**
 * @description Function entrypoint
 * @param {InvocationContext} context - Function context
 * @param {array} events - event hub messages
 */
const eventHubTrigger = async function (context: InvocationContext, events: any): Promise<void> {
  try {
    if (!Array.isArray(events) || events.length === 0) return;
    const threadId = context.invocationId;
    const eventKeys = getEventKeys(context, events.length);

    try {
      events.forEach((event, index) => {
        currentEventKey = eventKeys?.[index];
        try {
          const entries = unwrapEventHubMessage(event);
          entries.forEach((entry, idx) => {
            writeLog(context, entry, threadId, idx);
          });
        } catch (msgError: any) {
          context.log(`Failed to process message ${index}: ${msgError.message}`);
        }
      });
    } finally {
      currentEventKey = undefined;
    }

    // Take this invocation's records before awaiting anything (see
    // CollectingLogRecordProcessor), minus those a failed earlier attempt of this
    // same batch already delivered.
    let skipped = 0;
    const pending = Array.from(loggerCache.entries())
      .map(([cacheKey, entry]) => {
        const items = entry.collector.drain().filter((item) => {
          if (!deliveredRecords.has(cacheKey, item)) return true;
          skipped++;
          return false;
        });
        return { cacheKey, entry, items };
      })
      .filter(({ items }) => items.length > 0);

    if (skipped > 0) {
      context.log(`Skipping ${skipped} log records already delivered by a previous attempt`);
    }

    const results = await Promise.allSettled(
      pending.map(({ entry, items }) =>
        exportRecords(
          entry.exporter,
          items.map((item) => item.record)
        )
      )
    );

    let retryableFailure: ExportError | undefined;
    results.forEach((result, i) => {
      const { cacheKey, entry, items } = pending[i];
      const markDelivered = (delivered: CollectedRecord[]) =>
        delivered.forEach((item) => deliveredRecords.add(cacheKey, item));

      if (result.status === "fulfilled") {
        markDelivered(items);
        return;
      }

      const error: any = result.reason;
      logError(context, `Export to Coralogix failed for ${cacheKey}: ${error?.message}`);

      if (error instanceof ExportError) markDelivered(items.slice(0, error.settled));
      if (error instanceof ExportError && !error.retryable) return;

      evictLogger(cacheKey, entry, context);
      retryableFailure ??=
        error instanceof ExportError
          ? error
          : new ExportError(String(error?.message), true, 0, error);
    });

    // Fail the invocation so the Event Hub retry policy re-delivers the batch
    // instead of advancing the checkpoint past logs that never reached Coralogix.
    // What was delivered stays remembered so the retry only sends the rest.
    if (retryableFailure) throw retryableFailure;

    if (eventKeys) deliveredRecords.forget(eventKeys);
  } catch (error: any) {
    logError(context, `Function error: ${error.message}`);
    throw error;
  }
};

// Main function entry point
export { eventHubTrigger };
