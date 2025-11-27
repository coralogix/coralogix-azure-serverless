/**
 * Azure Function for integration of Event Hub with Coralogix
 *
 * @file        This file contains function source code
 * @author      Coralogix Ltd. <info@coralogix.com>
 * @link        https://coralogix.com/
 * @copyright   Coralogix Ltd.
 * @licence     Apache-2.0
 * @version     3.0.0
 * @since       1.0.0
 */

import { InvocationContext } from "@azure/functions";
import * as logsAPI from "@opentelemetry/api-logs";
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";

// Configuration: Application is static, subsystem uses customer-defined extraction rules
// Example: "body.category;body.resourceId;/resourceGroups/([^/]+)/;*azure-eventhub*"
const SUBSYSTEM_NAME = process.env.CORALOGIX_SUBSYSTEM || "body.category;*azure-eventhub*";

const functionName = process.env.FUNCTION_APP_NAME || "unknown";

const BASE_RESOURCE_ATTRIBUTES: Record<string, any> = {
  [ATTR_SERVICE_NAME]: "eventhub-to-otel",
};

/**
 * Logger cache to store LoggerProvider instances per app/subsystem combination
 */
interface LoggerCacheEntry {
  provider: LoggerProvider;
  logger: logsAPI.Logger;
}

const loggerCache = new Map<string, LoggerCacheEntry>();

/**
 * Get or create a logger for a specific app/subsystem combination
 */
function getLoggerForAppSubsystem(appName: string, subsystemName: string): logsAPI.Logger {
  const cacheKey = `${appName}::${subsystemName}`;

  let entry = loggerCache.get(cacheKey);
  if (entry) {
    return entry.logger;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "eventhub-to-otel",
    'cx.application.name': appName,
    "cx.subsystem.name": subsystemName,
  });

  const loggerProvider = new LoggerProvider({ resource });
  const otlpExporter = new OTLPLogExporter();

  loggerProvider.addLogRecordProcessor(
    new BatchLogRecordProcessor(otlpExporter, {
      maxExportBatchSize: 512,
      scheduledDelayMillis: 1000,
      exportTimeoutMillis: 30000,
    })
  );

  const logger = loggerProvider.getLogger("azure-eventhub-logs");

  entry = { provider: loggerProvider, logger };
  loggerCache.set(cacheKey, entry);

  return logger;
}

/**
 * Name-resolution support types & helpers
 */
export type NameResolutionContext = {
  body: unknown;
  attributes: Record<string, any>;
  scope: { name?: string; version?: string; schemaUrl?: string };
  resourceAttributes: Record<string, any>;
};

export function getNestedValue(source: unknown, path: string): string | undefined {
  if (source == null) return undefined;

  let obj: any = source;

  // If the source is a JSON string, try to parse
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      // If path is empty, we can use the raw string; otherwise we can't traverse it
      if (!path) {
        return obj;
      }
      return undefined;
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
    // If current is a JSON string, try to parse it
    if (typeof current === "string") {
      try {
        current = JSON.parse(current);
      } catch {
        return undefined;
      }
    }

    if (!current || typeof current !== "object") {
      return undefined;
    }

    const part = parts[i];

    // First, try the current part as a simple key
    if (part in current) {
      current = current[part];
      continue;
    }

    // If not found, try joining the remaining parts as a single key
    // This handles cases like { "custom.path": "value" }
    const remainingPath = parts.slice(i).join(".");
    if (remainingPath in current) {
      current = current[remainingPath];
      break; // We've consumed all remaining parts
    }

    // Neither worked, path not found
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

export function applyRegex(value: string | undefined, pattern?: string): string | undefined {
  if (!value || !pattern) return value;

  try {
    const re = new RegExp(pattern);
    const match = re.exec(value);
    if (!match) {
      // no match - return undefined so fallback chain continues
      return undefined;
    }
    // prefer first capture group if present
    return match[1] ?? match[0];
  } catch {
    // invalid regex - return undefined so fallback chain continues
    return undefined;
  }
}

function nestFlatKeys(obj: Record<string, any>): any {
  const root: any = {};

  for (const [key, value] of Object.entries(obj)) {
    const parts = key.split(".");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        current[part] = value;
      } else {
        if (!current[part] || typeof current[part] !== "object") {
          current[part] = {};
        }
        current = current[part];
      }
    }
  }

  return root;
}

function buildEvaluationRoot(ctx: NameResolutionContext): any {
  const nestedAttributes = nestFlatKeys(ctx.attributes);
  const nestedResourceAttributes = nestFlatKeys(ctx.resourceAttributes);

  return {
    body: ctx.body,
    attributes: nestedAttributes,
    scope: ctx.scope,
    resource: {
      attributes: nestedResourceAttributes,
    },
    logRecord: {
      body: ctx.body,
      attributes: nestedAttributes,
    },
  };
}

export function getValueFromExpression(
  expr: string,
  ctx: NameResolutionContext
): string | undefined {
  const e = expr.trim();
  if (!e) return undefined;

  const root = buildEvaluationRoot(ctx);

  const knownPrefixes = ["body.", "attributes.", "resource.", "scope.", "logRecord."];
  const isPathExpression = knownPrefixes.some((prefix) => e.startsWith(prefix));

  // Try interpreting the expression as a path on the evaluation root
  const val = getNestedValue(root, e);
  if (val !== undefined) {
    return val;
  }

  // Fallback: try it as a path on the body directly
  const fromBody = getNestedValue(ctx.body, e);
  if (fromBody !== undefined) {
    return fromBody;
  }

  // If it looks like a path expression but wasn't found, return undefined
  if (isPathExpression) {
    return undefined;
  }

  // Otherwise, treat it as a literal candidate
  return e;
}

export function resolveNameConfig(
  config: string | undefined,
  ctx: NameResolutionContext,
  globalDefault: string
): string {
  if (!config || !config.trim()) return globalDefault;

  const tokens = config
    .split(";")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  let chosenValue: string | undefined;
  let regexPattern: string | undefined;
  let defaultValue: string | undefined;

  for (const token of tokens) {
    if (token.startsWith("/") && token.endsWith("/") && token.length > 2) {
      // regex step
      regexPattern = token.slice(1, -1);
      continue;
    }

    if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      // default value step
      defaultValue = token.slice(1, -1);
      continue;
    }

    // source expression
    if (!chosenValue) {
      const v = getValueFromExpression(token, ctx);
      if (v !== undefined && v !== "") {
        chosenValue = v;
      }
    }
  }

  let result = chosenValue ?? defaultValue ?? globalDefault;

  if (result && regexPattern) {
    const processed = applyRegex(result, regexPattern);
    if (processed) {
      result = processed;
    } else {
      // Regex didn't match, fall back to default or global
      result = defaultValue ?? globalDefault;
    }
  }

  return result;
}

/**
 * @description Function entrypoint
 * @param {object} context - Function context
 * @param {array} events - event hub messages
 */
const eventHubTrigger = async function (context: InvocationContext, events: any): Promise<void> {
  try {
    if (!Array.isArray(events) || events.length === 0) {
      return;
    }

    const threadId = context.invocationId;
    const metadata = (context as any).bindingData;

    // Process events with metadata
    let successCount = 0;
    let errorCount = 0;

    events.forEach((message, index) => {
      try {
        // Extract Event Hub metadata for this message from bindingData arrays
        const eventMetadata = {
          enqueuedTimeUtc: metadata?.enqueuedTimeUtcArray?.[index],
          sequenceNumber: metadata?.sequenceNumberArray?.[index],
          offset: metadata?.offsetArray?.[index],
          partitionKey: metadata?.partitionKeyArray?.[index],
        };

        if ("records" in message && Array.isArray(message.records)) {
          message.records.forEach((inner_record: any, recordIndex: number) => {
            try {
              writeLog(context, inner_record, threadId, index, eventMetadata);
              successCount++;
            } catch (recordError: any) {
              errorCount++;
              context.error(
                `Failed to process record ${recordIndex} in message ${index}: ${recordError.message}`
              );
            }
          });
        } else {
          writeLog(context, message, threadId, index, eventMetadata);
          successCount++;
        }
      } catch (msgError: any) {
        errorCount++;
        context.error(`Failed to process message ${index}: ${msgError.message}`);
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
    context.error(`Function error: ${error.message}`);
    throw error;
  }
};

const writeLog = function (
  context: InvocationContext,
  text: any,
  threadId: string,
  messageIndex: number,
  eventMetadata: any,
): void {
  if (!text) {
    return;
  }

  try {
    const attributes: Record<string, any> = {
      "log.type": "EventHubLogRecord",
      threadId,
      "function.name": functionName,
      "message.index": messageIndex,
    };

    // Add Event Hub system properties FIRST so they are visible to expressions
    if (eventMetadata.sequenceNumber !== undefined) {
      attributes["eventhub.sequence_number"] = eventMetadata.sequenceNumber;
    }
    if (eventMetadata.offset !== undefined) {
      attributes["eventhub.offset"] = eventMetadata.offset;
    }
    if (eventMetadata.enqueuedTimeUtc !== undefined) {
      attributes["eventhub.enqueued_time"] = eventMetadata.enqueuedTimeUtc;
    }
    if (eventMetadata.partitionKey !== undefined) {
      attributes["eventhub.partition_key"] = eventMetadata.partitionKey;
    }

    const nameContext: NameResolutionContext = {
      body: text,
      attributes,
      scope: { name: "azure-eventhub-logs" },
      resourceAttributes: BASE_RESOURCE_ATTRIBUTES,
    };

    // Generic metadata extraction: add all fields as azure.* attributes
    let bodyObj: any = null;
    if (typeof text === 'string') {
      try {
        bodyObj = JSON.parse(text);
      } catch {
        // Not JSON, skip metadata extraction
      }
    } else if (typeof text === 'object') {
      bodyObj = text;
    }
    
    // Extract ALL top-level fields as azure.* attributes
    if (bodyObj && typeof bodyObj === 'object') {
      for (const [key, value] of Object.entries(bodyObj)) {
        if (value !== null && value !== undefined) {
          // Only primitive values (skip nested objects/arrays)
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            attributes[`azure.${key}`] = value;
          }
        }
      }
      
      // Parse resourceId for additional structured attributes
      const resourceId = bodyObj.resourceId;
      if (resourceId && typeof resourceId === 'string') {
        const parts = resourceId.split('/').filter(Boolean);
        const rgIdx = parts.findIndex((p: string) => p.toLowerCase() === 'resourcegroups');
        if (rgIdx !== -1 && parts[rgIdx + 1]) {
          attributes['azure.resource_group'] = parts[rgIdx + 1];
        }
        
        const provIdx = parts.findIndex((p: string) => p.toLowerCase() === 'providers');
        if (provIdx !== -1 && parts[provIdx + 1]) {
          attributes['azure.provider'] = parts[provIdx + 1].toLowerCase();
        }
      }
    }

    // Static application name from env var
    const applicationName = process.env.CORALOGIX_APPLICATION || "Azure-EventHub";
    
    // Dynamic subsystem extraction via customer-defined rule
    const subsystemName = resolveNameConfig(
      SUBSYSTEM_NAME,
      nameContext,
      "NO_SUBSYSTEM"
    );

    // Get cached logger for this app/subsystem combo
    const logger = getLoggerForAppSubsystem(applicationName, subsystemName);

    logger.emit({
      severityNumber: logsAPI.SeverityNumber.INFO,
      body: JSON.stringify(text),
      attributes,
    });
  } catch (error: any) {
    context.error(`writeLog failed for message ${messageIndex}: ${error.message}`);
    throw error;
  }
};

export { eventHubTrigger };