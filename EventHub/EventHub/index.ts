/**
 * Azure Function for integration of Event Hub with Coralogix
 *
 * @file        This file contains function source code
 * @author      Coralogix Ltd. <info@coralogix.com>
 * @link        https://coralogix.com/
 * @copyright   Coralogix Ltd.
 * @licence     Apache-2.0
 * @version     3.1.0
 * @since       1.0.0
 */

import { InvocationContext } from "@azure/functions";
import * as logsAPI from "@opentelemetry/api-logs";
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";

const APPLICATION_NAME = process.env.CORALOGIX_APPLICATION || "Azure-EventHub";
const SUBSYSTEM_NAME = process.env.CORALOGIX_SUBSYSTEM || "EventHub";
const FUNCTION_NAME = process.env.FUNCTION_APP_NAME || "unknown";

const BASE_RESOURCE_ATTRIBUTES: Record<string, any> = {
  [ATTR_SERVICE_NAME]: "eventhub-to-otel",
};

interface LoggerCacheEntry {
  provider: LoggerProvider;
  logger: logsAPI.Logger;
}

const loggerCache = new Map<string, LoggerCacheEntry>();

function createLoggerProvider(resourceAttributes: Record<string, any>): LoggerProvider {
  const resource = resourceFromAttributes(resourceAttributes);
  const loggerProvider = new LoggerProvider({ resource });

  const otlpExporter = new OTLPLogExporter();

  loggerProvider.addLogRecordProcessor(
    new BatchLogRecordProcessor(otlpExporter, {
      maxExportBatchSize: 512,
      scheduledDelayMillis: 1000,
      exportTimeoutMillis: 30000,
    })
  );

  return loggerProvider;
}

// Get or create a logger for a specific app/subsystem combination.
function getLoggerForAppSubsystem(appName: string, subsystemName: string): logsAPI.Logger {
  const cacheKey = `${appName}::${subsystemName}`;
  const cached = loggerCache.get(cacheKey);

  if (cached) return cached.logger;

  const loggerProvider = createLoggerProvider({
    ...BASE_RESOURCE_ATTRIBUTES,
    "cx.application.name": appName,
    "cx.subsystem.name": subsystemName,
  });

  const logger = loggerProvider.getLogger("azure-eventhub-logs");
  loggerCache.set(cacheKey, { provider: loggerProvider, logger });

  return logger;
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

  // Handle strings
  if (typeof log === "string") {
    try {
      const parsed = JSON.parse(log);
      if (Array.isArray(parsed)) return LogFormat.JSON_ARRAY;
      return LogFormat.JSON_STRING;
    } catch {
      return LogFormat.STRING;
    }
  }

  // Handle arrays
  if (Array.isArray(log)) {
    return LogFormat.JSON_ARRAY;
  }

  // Handle objects
  if (typeof log === "object") {
    return LogFormat.JSON_OBJECT;
  }

  // Handle primitives (number, boolean, etc.)
  return LogFormat.STRING;
}

export interface LogHandlerResult {
  body: string;
  parsedBody: any | null;
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

// Single-log handlers
export function handlePlainText(text: any): LogHandlerResult {
  const bodyString = typeof text === "string" ? text : String(text);
  return {
    body: bodyString,
    parsedBody: null,
  };
}

export function handleJsonObject(obj: any): LogHandlerResult {
  return {
    body: JSON.stringify(obj),
    parsedBody: obj,
  };
}

export function handleJsonString(text: string): LogHandlerResult {
  const parsed = JSON.parse(text); // may be object or array, but this
  // function always returns a single result
  return {
    body: text, // keep original JSON string as body
    parsedBody: parsed,
  };
}

export function handleInvalidFormat(
  text: any,
  context: InvocationContext,
  messageIndex: number
): LogHandlerResult {
  context.log(`Invalid log format detected for message ${messageIndex}`);
  return {
    body: JSON.stringify(text),
    parsedBody: null,
  };
}

// Array handler
export function handleJsonArray(arr: any[]): LogHandlerResult[] {
  return arr.map((elem) => {
    if (elem && typeof elem === "object") {
      return {
        body: JSON.stringify(elem),
        parsedBody: elem,
      };
    } else {
      return {
        body: String(elem),
        parsedBody: null,
      };
    }
  });
}

const writeLog = function (
  context: InvocationContext,
  text: any,
  threadId: string,
  messageIndex: number
): void {
  if (!text) return;

  try {
    const attributes: Record<string, any> = {
      threadId,
      "function.name": FUNCTION_NAME,
      "message.index": messageIndex,
    };

    const logFormat = detectLogFormat(text);
    attributes["log.format"] = logFormat;

    let results: LogHandlerResult | LogHandlerResult[];

    switch (logFormat) {
      case LogFormat.JSON_STRING:
        results = handleJsonString(text);
        break;
      case LogFormat.JSON_OBJECT:
        results = handleJsonObject(text);
        break;
      case LogFormat.JSON_ARRAY:
        results = handleJsonArray(typeof text === "string" ? JSON.parse(text) : text);
        break;
      case LogFormat.STRING:
        results = handlePlainText(text);
        break;
      default:
        context.log(`Invalid log format detected for message ${messageIndex}: ${text}`);
        results = handleInvalidFormat(text, context, messageIndex);
        break;
    }
    const logRecords = Array.isArray(results) ? results : [results];

    for (const result of logRecords) {
      if (result.parsedBody) {
        enrichAzureMetadata(attributes, result.parsedBody);
      }

      const logger = getLoggerForAppSubsystem(APPLICATION_NAME, SUBSYSTEM_NAME);
      logger.emit({
        severityNumber: logsAPI.SeverityNumber.INFO,
        body: result.body,
        attributes: attributes,
      });
    }
  } catch (error: any) {
    context.log(`writeLog failed for message ${messageIndex}: ${error.message}`);
    throw error;
  }
};

function handleEventHubMessage(context: InvocationContext, message: any, threadId: string): void {
  let entries: any[];

  if (
    message &&
    typeof message === "object" &&
    !Array.isArray(message) &&
    Array.isArray((message as any).records)
  ) {
    entries = (message as any).records;
  } else {
    const content =
      message && typeof message === "object" && "body" in message ? (message as any).body : message;
    entries = [content];
  }

  entries.forEach((entry, idx) => {
    writeLog(context, entry, threadId, idx);
  });
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

    events.forEach((event, index) => {
      try {
        handleEventHubMessage(context, event, threadId);
      } catch (msgError: any) {
        context.log(`Failed to process message ${index}: ${msgError.message}`);
      }
    });

    // Add delay before force flush to allow batch to accumulate
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Flush all logger providers in the cache
    const flushPromises = Array.from(loggerCache.values()).map((entry) =>
      entry.provider.forceFlush()
    );

    await Promise.all(flushPromises);
  } catch (error: any) {
    context.log(`Function error: ${error.message}`);
    throw error;
  }
};

// Main function entry point
export { eventHubTrigger };
