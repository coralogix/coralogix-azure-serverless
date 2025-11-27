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

/* -------------------------------------------------------------------------- */
/*  Constants & configuration                                                 */
/* -------------------------------------------------------------------------- */
const APPLICATION_NAME = process.env.CORALOGIX_APPLICATION || "NO_APPLICATION";

// Configuration: Subsystem uses customer-defined extraction rules.
// Example: "body.category;body.resourceId;/resourceGroups/([^/]+)/;*azure-eventhub*"
const SUBSYSTEM_NAME = process.env.CORALOGIX_SUBSYSTEM || "NO_SUBSYSTEM";

const FUNCTION_NAME = process.env.FUNCTION_APP_NAME || "unknown";

const BASE_RESOURCE_ATTRIBUTES: Record<string, any> = {
  [ATTR_SERVICE_NAME]: "eventhub-to-otel",
};

/* -------------------------------------------------------------------------- */
/*  Logger cache                                                              */
/* -------------------------------------------------------------------------- */
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

/**
 * Get or create a logger for a specific app/subsystem combination.
 */
function getLoggerForAppSubsystem(appName: string, subsystemName: string): logsAPI.Logger {
  const cacheKey = `${appName}::${subsystemName}`;

  const cached = loggerCache.get(cacheKey);
  if (cached) {
    return cached.logger;
  }

  const loggerProvider = createLoggerProvider({
    ...BASE_RESOURCE_ATTRIBUTES,
    "cx.application.name": appName,
    "cx.subsystem.name": subsystemName,
  });

  const logger = loggerProvider.getLogger("azure-eventhub-logs");

  loggerCache.set(cacheKey, { provider: loggerProvider, logger });

  return logger;
}

/* -------------------------------------------------------------------------- */
/*  Name-resolution types & config parsing                                    */
/* -------------------------------------------------------------------------- */
type NameResolutionContext = {
    body: unknown;
    attributes: Record<string, any>;
  };
  
  type NameRuleConfig = {
    sources: string[];       // expressions like "body.category", "body.resourceId"
    regex?: RegExp;          // optional compiled regex
    defaultValue?: string;   // optional *default* from config
  };
  
  /**
   * Parse a rule string like:
   * "body.category;body.resourceId;/resourceGroups/([^/]+)/;*azure-eventhub*"
   * into a structured config.
   */
  function parseNameRuleConfig(config: string | undefined): NameRuleConfig {
    if (!config || !config.trim()) {
      return { sources: [] };
    }
  
    const tokens = config
      .split(";")
      .map((t) => t.trim())
      .filter(Boolean);
  
    const sources: string[] = [];
    let regex: RegExp | undefined;
    let defaultValue: string | undefined;
  
    for (const token of tokens) {
      // Regex token: /.../
      if (token.startsWith("/") && token.endsWith("/") && token.length > 2) {
        const pattern = token.slice(1, -1);
        try {
          regex = new RegExp(pattern);
        } catch (e) {
          // Invalid regex: log once and skip it
          console.warn(`Invalid CORALOGIX_SUBSYSTEM regex: ${token}`, e);
        }
        continue;
      }
  
      // Default token: *default*
      if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
        defaultValue = token.slice(1, -1);
        continue;
      }
  
      // Otherwise it's a source expression
      sources.push(token);
    }
  
    return { sources, regex, defaultValue };
  }
  
  /**
   * Pre-parsed subsystem rule config (from env) at module load time.
   */
  const SUBSYSTEM_NAME_RULE: NameRuleConfig = parseNameRuleConfig(SUBSYSTEM_NAME);

function getNestedValue(source: unknown, path: string): string | undefined {
  if (source == null) return undefined;

  let obj: any = source;

  // If the source is a JSON string, try to parse
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
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
      break;
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

/**
 * Apply a precompiled regex to a value and return the first capture group
 * or the full match if no capture group exists.
 */
function applyRegex(
    value: string | undefined,
    pattern?: RegExp
  ): string | undefined {
    if (!value || !pattern) return value;
  
    const match = pattern.exec(value);
    if (!match) {
      return undefined;
    }
    return match[1] ?? match[0];
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
  
    return {
      body: ctx.body,
      attributes: nestedAttributes,
      logRecord: {
        body: ctx.body,
        attributes: nestedAttributes,
      },
    };
  }

  /**
 * Evaluate a parsed NameRuleConfig against a context to produce a name.
 *
 * Order:
 *  1. Evaluate sources in order; take first non-empty result.
 *  2. If regex exists, apply it to that result.
 *  3. If regex fails, use rule's defaultValue (if any).
 *  4. If still empty, fall back to globalDefault.
 */
function resolveNameFromRuleConfig(
    rule: NameRuleConfig,
    ctx: NameResolutionContext,
    globalDefault: string
  ): string {
    let chosenValue: string | undefined;
  
    for (const source of rule.sources) {
      const v = getValueFromExpression(source, ctx);
      if (v !== undefined && v !== "") {
        chosenValue = v;
        break;
      }
    }
  
    // Step 1–3: combine chosen, default, global
    let result = chosenValue ?? rule.defaultValue ?? globalDefault;
  
    // Step 4: apply regex if we have a result and a pattern
    if (result && rule.regex) {
      const processed = applyRegex(result, rule.regex);
      if (processed) {
        result = processed;
      } else {
        // Regex didn't match; fall back to default or global
        result = rule.defaultValue ?? globalDefault;
      }
    }
  
    return result;
  }

function getValueFromExpression(
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

/* -------------------------------------------------------------------------- */
/*  Utility helpers                                                           */
/* -------------------------------------------------------------------------- */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonSafely(input: unknown): any | null {
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
    if (!Array.isArray(events) || events.length === 0) {
      return;
    }

    const threadId = context.invocationId;
    const metadata = (context as any).bindingData;

    events.forEach((message, index) => {
      try {
        const eventMetadata = {
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

/* -------------------------------------------------------------------------- */
/*  Log writing                                                               */
/* -------------------------------------------------------------------------- */
const writeLog = function (
    context: InvocationContext,
    text: any,
    threadId: string,
    messageIndex: number,
    eventMetadata: any
  ): void {
    if (!text) {
      return;
    }
  
    try {
      const attributes: Record<string, any> = {
        "log.type": "EventHubLogRecord",
        threadId,
        "function.name": FUNCTION_NAME,
        "message.index": messageIndex,
      };
  
      // Add Event Hub system properties generically
      if (eventMetadata && typeof eventMetadata === "object") {
        for (const [key, value] of Object.entries(eventMetadata)) {
          if (value !== null && value !== undefined) {
            const attrKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
            attributes[`eventhub.${attrKey}`] = value;
          }
        }
      }
  
      // Parse body once for both metadata and name resolution
      const parsedBody = parseJsonSafely(text);
  
      const nameContext: NameResolutionContext = {
        body: parsedBody ?? text,
        attributes,
      };
  
      // Generic metadata extraction
      if (parsedBody && typeof parsedBody === "object") {
        const resourceId = (parsedBody as any).resourceId;
        if (resourceId && typeof resourceId === "string") {
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
      }
  
      // Dynamic subsystem extraction via pre-parsed rule
      const subsystemName = resolveNameFromRuleConfig(
        SUBSYSTEM_NAME_RULE,
        nameContext,
        "NO_SUBSYSTEM"
      );
  
  
      attributes["cx.application.name"] = APPLICATION_NAME;
      attributes["cx.subsystem.name"] = subsystemName;
  
      // Get cached logger for this app/subsystem combo
      const logger = getLoggerForAppSubsystem(APPLICATION_NAME, subsystemName);
  
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

// Main function entry point
export { eventHubTrigger };

// Testing
export type { NameResolutionContext };
export {
  getNestedValue,
  applyRegex,
  getValueFromExpression,
  resolveNameFromRuleConfig,
  parseNameRuleConfig,
  nestFlatKeys,
  buildEvaluationRoot,
  parseJsonSafely,
};