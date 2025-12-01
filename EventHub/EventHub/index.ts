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
import {
  LoggerProvider,
  BatchLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";

const APPLICATION_NAME = process.env.CORALOGIX_APPLICATION;
const SUBSYSTEM_NAME = process.env.CORALOGIX_SUBSYSTEM;
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
function getLoggerForAppSubsystem(
  appName: string,
  subsystemName: string
): logsAPI.Logger {
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

// Template evaluation
export type TemplateContext = {
  body: unknown;
  attributes: Record<string, any>;
};

export type TemplateConfig = {
  expression: string;
  regex?: RegExp;
};

/**
 * Parses a template like "{{ $.category | r'/pattern/' }}"
 * Returns null if not a template.
 */
export function parseTemplate(template: string | undefined): TemplateConfig | null {
  if (!template?.trim()) return null;

  const trimmed = template.trim();
  const templateMatch = trimmed.match(/^\{\{\s*(.+?)\s*\}\}$/);
  if (!templateMatch) return null;

  const content = templateMatch[1];

  // Check for pipe operator with regex: {{ expression | r'pattern' }} or {{ expression | r'pattern/flags' }}
  const pipeMatch = content.match(/^(.+?)\s*\|\s*r['"](.*?)['"]$/);
  if (!pipeMatch) return { expression: content.trim() };

  const expression = pipeMatch[1].trim();
  const patternString = pipeMatch[2];

  let pattern = patternString;
  let flags = "";

  // Check if pattern ends with /flags
  const flagsMatch = patternString.match(/\/([gimsuvy]*)$/);
  if (flagsMatch) {
    flags = flagsMatch[1];
    pattern = patternString.slice(0, patternString.length - flagsMatch[0].length);
  }

  try {
    const regex = new RegExp(pattern, flags);
    return { expression, regex };
  } catch (e) {
    console.warn(`Invalid regex pattern in template: ${patternString}`, e);
    return { expression };
  }
}

/**
 * Evaluates a single expression (e.g., "$.field" or "attributes.key").
 * Returns the value or undefined if not found.
 */
export function evaluateExpression(
  expression: string,
  ctx: TemplateContext
): string | undefined {
  const expr = expression.trim();

  let source: unknown;
  let path: string;

  if (expr.startsWith("$.")) {
    source = ctx.body;
    path = expr.slice(2);
  } else if (expr.startsWith("attributes.")) {
    source = ctx.attributes;
    path = expr.slice("attributes.".length);
  } else if (expr.startsWith("body.")) {
    source = ctx.body;
    path = expr.slice("body.".length);
  } else {
    source = ctx.body;
    path = expr;
  }

  return getNestedValue(source, path);
}

/**
 * Evaluates a template against the context.
 * Supports multiple fallback expressions with || operator.
 * Returns the resolved value or undefined if not found.
 */
export function evaluateTemplate(
  templateConfig: TemplateConfig,
  ctx: TemplateContext
): string | undefined {
  const { expression, regex } = templateConfig;

  const expressions = expression.includes("||")
    ? expression.split("||").map((e) => e.trim())
    : [expression.trim()];

  let value: string | undefined;

  for (const expr of expressions) {
    value = evaluateExpression(expr, ctx);
    if (value !== undefined && value !== "") break;
  }

  if (value === undefined) return undefined;

  const regexResult = applyRegex(value, regex);
  return regexResult ?? value;
}

/**
 * Resolves a name from a template string with fallback to default.
 */
export function resolveName(
  template: string | undefined,
  ctx: TemplateContext,
  globalDefault: string
): string {
  if (!template?.trim()) return globalDefault;

  const parsed = parseTemplate(template);

  // Not a template - treat as literal value
  if (!parsed) return template.trim();

  const resolved = evaluateTemplate(parsed, ctx);
  return resolved ?? globalDefault;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

export function getNestedValue(source: unknown, path: string): string | undefined {
  if (source == null) return undefined;

  let obj: any = source;

  // If the source is a JSON string, try to parse
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return path ? undefined : obj;
    }
  }

  if (!path) {
    if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") {
      return String(obj);
    }
    try {
      return JSON.stringify(obj);
    } catch {
      return undefined;
    }
  }

  if (typeof obj !== "object") return undefined;

  const parts = path.split(".").filter(Boolean);
  let current: any = obj;

  for (let i = 0; i < parts.length; i++) {
    if (typeof current === "string") {
      try {
        current = JSON.parse(current);
      } catch {
        return undefined;
      }
    }

    if (!current || typeof current !== "object") return undefined;

    const part = parts[i];

    if (part in current) {
      current = current[part];
      continue;
    }

    // Remaining joined key, e.g. "custom.path"
    const remainingPath = parts.slice(i).join(".");
    if (remainingPath in current) {
      current = current[remainingPath];
      break;
    }

    return undefined;
  }

  if (current == null) return undefined;

  if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") {
    return String(current);
  }

  try {
    return JSON.stringify(current);
  } catch {
    return undefined;
  }
}

/**
 * Apply a precompiled regex to a value and return the first capture group
 * or the full match if no capture group exists.
 */
export function applyRegex(
  value: string | undefined,
  pattern?: RegExp
): string | undefined {
  if (!value || !pattern) return value;

  const match = pattern.exec(value);
  return match ? match[1] ?? match[0] : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseJsonSafely(input: unknown): any | null {
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (input && typeof input === "object") {
    return input;
  }
  return null;
}

// Log writing
type EventMetadata = Record<string, unknown>;

function buildBaseAttributes(
  threadId: string,
  messageIndex: number,
  eventMetadata: EventMetadata | undefined
): Record<string, any> {
  const attributes: Record<string, any> = {
    "log.type": "EventHubLogRecord",
    threadId,
    "function.name": FUNCTION_NAME,
    "message.index": messageIndex,
  };

  if (eventMetadata && typeof eventMetadata === "object") {
    for (const [key, value] of Object.entries(eventMetadata)) {
      if (value === null || value === undefined) continue;
      const attrKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
      attributes[`eventhub.${attrKey}`] = value;
    }
  }

  return attributes;
}

function enrichAzureMetadata(
  attributes: Record<string, any>,
  parsedBody: any
): void {
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
  messageIndex: number,
  eventMetadata: EventMetadata
): void {
  if (!text) return;

  try {
    const attributes = buildBaseAttributes(threadId, messageIndex, eventMetadata);
    const parsedBody = parseJsonSafely(text);

    const templateContext: TemplateContext = {
      body: parsedBody ?? text,
      attributes,
    };

    // Generic Azure metadata
    enrichAzureMetadata(attributes, parsedBody);

    // Dynamic application and subsystem name resolution via templates
    const applicationName = resolveName(
      APPLICATION_NAME,
      templateContext,
      "Azure-EventHub"
    );

    const subsystemName = resolveName(
      SUBSYSTEM_NAME,
      templateContext,
      "EventHub"
    );

    attributes["cx.application.name"] = applicationName;
    attributes["cx.subsystem.name"] = subsystemName;

    // Get cached logger for this app/subsystem combo
    const logger = getLoggerForAppSubsystem(applicationName, subsystemName);

    logger.emit({
      severityNumber: logsAPI.SeverityNumber.INFO,
      body: JSON.stringify(text),
      attributes,
    });
  } catch (error: any) {
    context.warn(`writeLog failed for message ${messageIndex}: ${error.message}`);
    throw error;
  }
};

/* -------------------------------------------------------------------------- */
/*  Azure Function entrypoint                                                 */
/* -------------------------------------------------------------------------- */

/**
 * @description Function entrypoint
 * @param {InvocationContext} context - Function context
 * @param {array} events - event hub messages
 */
const eventHubTrigger = async function (
  context: InvocationContext,
  events: any
): Promise<void> {
  try {
    if (!Array.isArray(events) || events.length === 0) return;

    const threadId = context.invocationId;
    const metadata = (context as any).bindingData;

    events.forEach((message, index) => {
      try {
        const eventMetadata: EventMetadata = {
          enqueuedTimeUtc: metadata?.enqueuedTimeUtcArray?.[index],
          sequenceNumber: metadata?.sequenceNumberArray?.[index],
          offset: metadata?.offsetArray?.[index],
          partitionKey: metadata?.partitionKeyArray?.[index],
        };

        if ("records" in message && Array.isArray(message.records)) {
          message.records.forEach((innerRecord: any) => {
            writeLog(context, innerRecord, threadId, index, eventMetadata);
          });
        } else {
          writeLog(context, message, threadId, index, eventMetadata);
        }
      } catch (msgError: any) {
        context.warn(`Failed to process message ${index}: ${msgError.message}`);
      }
    });

    // Add delay before force flush to allow batch to accumulate
    await sleep(2000);

    // Flush all logger providers in the cache
    const flushPromises = Array.from(loggerCache.values()).map((entry) =>
      entry.provider.forceFlush()
    );
    await Promise.all(flushPromises);
  } catch (error: any) {
    context.warn(`Function error: ${error.message}`);
    throw error;
  }
};

// Main function entry point
export { eventHubTrigger };