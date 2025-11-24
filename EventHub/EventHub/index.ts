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
import {
  LoggerProvider,
  BatchLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";

/**
 * Application and Subsystem configuration - supports fallback chains
 * Format: "field1;field2.nested;/regex/;*default*"
 * Examples:
 *   - Static: "my-app"
 *   - Single field: "category"
 *   - With fallback: "category;operationName;*NO_APPLICATION*"
 *   - With regex: "resourceId;/resourceGroups/([^/]+)/;*NO_SUBSYSTEM*"
 */
const APPLICATION_NAME = process.env.CORALOGIX_APPLICATION || "NO_APPLICATION";
const SUBSYSTEM_NAME = process.env.CORALOGIX_SUBSYSTEM || "NO_SUBSYSTEM";

const functionName = process.env.FUNCTION_APP_NAME || "unknown";

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
function getLoggerForAppSubsystem(
  appName: string,
  subsystemName: string
): logsAPI.Logger {
  const cacheKey = `${appName}::${subsystemName}`;

  let entry = loggerCache.get(cacheKey);
  if (entry) {
    return entry.logger;
  }

  // Create new resource with app/subsystem
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "eventhub-to-otel",
    "cx.application.name": appName,
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
 * Parse a fallback chain string
 * Format: "field1;field2.nested;/regex/;*default*"
 * Returns array of extraction attempts in priority order
 */
function parseFallbackChain(chain: string): Array<{ type: 'field' | 'regex' | 'default'; value: string }> {
  const parts = chain.split(';').map(p => p.trim()).filter(Boolean);
  const attempts: Array<{ type: 'field' | 'regex' | 'default'; value: string }> = [];
  
  for (const part of parts) {
    // Check for default value: *value*
    const defaultMatch = part.match(/^\*(.+)\*$/);
    if (defaultMatch) {
      attempts.push({ type: 'default', value: defaultMatch[1] });
      continue;
    }
    
    // Check for regex: /pattern/
    const regexMatch = part.match(/^\/(.+)\/$/);
    if (regexMatch) {
      attempts.push({ type: 'regex', value: regexMatch[1] });
      continue;
    }
    
    // Otherwise it's a field path
    attempts.push({ type: 'field', value: part });
  }
  
  return attempts;
}

/**
 * Resolve a JSON path (very small subset, good enough for our use-case):
 * - Supports:
 *     $.field.subField
 *     field.subField
 * - Returns undefined if path can't be resolved.
 */
function extractFromPayload(payload: unknown, path: string): string | undefined {
  if (!path) return undefined;

  let obj: any = payload;

  if (obj == null) return undefined;

  // If the payload is a string, try to parse JSON – common case for logs
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      // Not JSON, can't resolve fields from it
      return undefined;
    }
  }

  if (typeof obj !== "object") {
    return undefined;
  }

  let cleanPath = path.trim();

  if (cleanPath.startsWith("$."))
    cleanPath = cleanPath.slice(2);
  else if (cleanPath.startsWith("$"))
    cleanPath = cleanPath.slice(1);

  if (!cleanPath) return undefined;

  const parts = cleanPath.split(".").filter(Boolean);

  let current: any = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }

  if (current === null || current === undefined) return undefined;

  if (
    typeof current === "string" ||
    typeof current === "number" ||
    typeof current === "boolean"
  ) {
    return String(current);
  }

  // If it's an object/array, stringify – still valid as an app/sub name value
  try {
    return JSON.stringify(current);
  } catch {
    return undefined;
  }
}

/**
 * Apply an optional regex to a string value.
 * If the regex has a capture group, group[1] is returned; otherwise full match.
 * On any error, we just return the original value.
 */
function applyRegex(value: string | undefined, pattern?: string): string | undefined {
  if (!value || !pattern) return value;

  try {
    // Make regex case-insensitive by default (Azure resource IDs can vary in case)
    const re = new RegExp(pattern, 'i');
    const match = re.exec(value);
    if (!match) {
      // Regex didn't match at all: return undefined to signal no match
      return undefined;
    }
    // Prefer first capture group if present, otherwise the whole match
    return match[1] ?? match[0];
  } catch {
    // Invalid regex – return undefined
    return undefined;
  }
}

/**
 * Resolve value using fallback chain
 * Tries each extraction method in order until one succeeds
 */
function resolveFromChain(chain: string, payload: unknown): string {
  const attempts = parseFallbackChain(chain);
  
  // If no semicolons, treat as static value
  if (!chain.includes(';')) {
    // Check if it's a simple field reference
    const extracted = extractFromPayload(payload, chain);
    if (extracted) return extracted;
    // Otherwise return as static value
    return chain;
  }
  
  let lastExtractedValue: string | undefined;
  
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const nextAttempt = i < attempts.length - 1 ? attempts[i + 1] : undefined;
    
    if (attempt.type === 'default') {
      // Return default value
      return attempt.value;
    }
    
    if (attempt.type === 'field') {
      // Try to extract from payload
      const extracted = extractFromPayload(payload, attempt.value);
      if (extracted) {
        lastExtractedValue = extracted;
        
        // If next is a regex, continue to apply it
        // Otherwise return this value
        if (!nextAttempt || nextAttempt.type !== 'regex') {
          return extracted;
        }
      }
    }
    
    if (attempt.type === 'regex') {
      // Apply regex to the last extracted value
      if (lastExtractedValue) {
        const match = applyRegex(lastExtractedValue, attempt.value);
        if (match) {
          return match;
        }
        // If regex didn't match, return the extracted value as-is
        return lastExtractedValue;
      }
    }
  }
  
  // If nothing worked, return the original chain as fallback
  return chain;
}

/**
 * @description Function entrypoint
 * @param {object} context - Function context
 * @param {array} events - event hub messages
 */
const eventHubTrigger = async function (
  context: InvocationContext,
  events: any
): Promise<void> {
  if (!Array.isArray(events) || events.length === 0) {
    return;
  }

  const threadId = context.invocationId;
  const metadata = (context as any).bindingData;

  context.log(`Event hub function processing ${events.length} messages`);

  // Process events with metadata
  events.forEach((message, index) => {
    // Extract Event Hub metadata for this message from bindingData arrays
    const eventMetadata = {
      enqueuedTimeUtc: metadata?.enqueuedTimeUtcArray?.[index],
      sequenceNumber: metadata?.sequenceNumberArray?.[index],
      offset: metadata?.offsetArray?.[index],
      partitionKey: metadata?.partitionKeyArray?.[index],
    };

    if ("records" in message && Array.isArray(message.records)) {
      message.records.forEach((inner_record: any) => {
        writeLog(inner_record, threadId, index, eventMetadata);
      });
    } else {
      writeLog(message, threadId, index, eventMetadata);
    }
  });

  // Add delay before force flush to allow batch to accumulate
  await new Promise((resolve) => setTimeout(resolve, 2000));
  
  // Flush all logger providers in the cache
  const flushPromises = Array.from(loggerCache.values()).map((entry) =>
    entry.provider.forceFlush()
  );
  await Promise.all(flushPromises);
};

const writeLog = function (
  text: any,
  threadId: string,
  messageIndex: number,
  eventMetadata: any
): void {
  if (!text) return;

  // Resolve application and subsystem names using fallback chains
  const appName = resolveFromChain(APPLICATION_NAME, text);
  const subsystemName = resolveFromChain(SUBSYSTEM_NAME, text);

  // Get logger for this specific app/subsystem combination
  const logger = getLoggerForAppSubsystem(appName, subsystemName);
  // -----------------------------------------------

  const attributes: Record<string, any> = {
    "log.type": "EventHubLogRecord",
    threadId: threadId,
    "function.name": functionName,
    "message.index": messageIndex,
  };

  // Add Event Hub system properties
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

  logger.emit({
    severityNumber: logsAPI.SeverityNumber.INFO,
    body: JSON.stringify(text),
    attributes: attributes,
  });
};

export { eventHubTrigger as default };