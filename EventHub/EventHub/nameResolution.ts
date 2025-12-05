export type TemplateContext = {
  body: unknown;
  attributes: Record<string, any>;
};

export type TemplateConfig = {
  expression: string;
  regex?: RegExp;
};

export function resolveName(rule: string | undefined, ctx: TemplateContext, body: string): string {
  const DEFAULT_APP = "Coralogix-Azure-EventHub";

  const type = classifyNameRule(rule);

  switch (type) {
    case "static":
      return rule?.trim() || DEFAULT_APP;

    case "regex":
      return resolveFromRegex(rule!, body, DEFAULT_APP);

    case "template":
      return resolveFromTemplate(rule!, ctx, DEFAULT_APP);

    default:
      return DEFAULT_APP;
  }
}

export function classifyNameRule(rule: string | undefined): "static" | "regex" | "template" {
  if (!rule?.trim()) return "static";
  const trimmed = rule.trim();

  if (trimmed.startsWith("/") && trimmed.endsWith("/")) return "regex";
  if (/^\{\{.*\}\}$/.test(trimmed)) return "template";

  return "static";
}

export function resolveFromRegex(rule: string, text: string, fallback: string): string {
  try {
    const pattern = rule.slice(1, -1);
    const re = new RegExp(pattern);
    const m = text.match(re);
    return m ? (m[1] ?? m[0]) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Resolves a name from a template string with fallback to default.
 * @param template - The template string to resolve the name from
 * @param ctx - The context to resolve the name from
 * @param globalDefault - The fallback value to return if the template string is not a template
 * @returns The resolved name
 */
export function resolveFromTemplate(
  template: string | undefined,
  ctx: TemplateContext,
  globalDefault: string
): string {
  if (!template?.trim()) return globalDefault;

  const parsed = parseTemplate(template);

  // Not a template - treat as literal value
  if (!parsed) return template.trim();

  const resolved = evaluateTemplate(parsed, ctx);
  // Treat empty string as "not resolved"
  if (resolved === undefined || resolved === "") {
    return globalDefault;
  }
  return resolved;
}

/**
 * @param config - The regex pattern to match against the text
 * @param text - The text to match the regex pattern against
 * @param fallback - The fallback value to return if the regex pattern does not match
 * @returns The value of the first capture group or the full match if no capture group exists
 */
export function resolveNameFromRegex(config: string, text: string, fallback: string): string {
  const trimmed = config.trim();

  // Must be /regex/ and nothing else
  if (!trimmed.startsWith("/") || !trimmed.endsWith("/")) {
    return fallback;
  }

  const pattern = trimmed.slice(1, -1);
  try {
    const re = new RegExp(pattern);
    const match = text.match(re);
    const result = match ? (match[1] ?? match[0]) : null;
    return result && result.trim() !== "" ? result : fallback;
  } catch {
    return fallback;
  }
}

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
export function evaluateExpression(expression: string, ctx: TemplateContext): string | undefined {
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

  /**
   * Apply regex if configured:
   * - Returns captured value if regex matches with non-empty capture
   * - Returns undefined if regex doesn't match or captures empty (triggers default fallback)
   */
  return applyRegex(value, regex);
}

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
 *
 * Returns:
 * - The captured value if regex matches with non-empty capture
 * - undefined if regex doesn't match or captures empty string (triggers default fallback)
 */
export function applyRegex(value: string | undefined, pattern?: RegExp): string | undefined {
  if (!value || !pattern) return value;

  const match = pattern.exec(value);

  // Return undefined if no match to trigger default fallback
  if (!match) return undefined;

  // Extract capture group or full match when match is found
  const result = match[1] ?? match[0];

  // Return undefined if capture is empty to trigger default fallback
  if (!result || result.trim() === "") return undefined;

  return result;
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
