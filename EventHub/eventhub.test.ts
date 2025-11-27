import {
    getNestedValue,
    applyRegex,
    getValueFromExpression,
    resolveNameFromRuleConfig,
    NameResolutionContext,
    parseNameRuleConfig,
  } from "./EventHub/index";

describe("getNestedValue", () => {
  it("returns a simple nested value from an object", () => {
    const src = { a: { b: { c: 42 } } };
    expect(getNestedValue(src, "a.b.c")).toBe("42");
  });

  it("returns undefined for non-existing path", () => {
    const src = { a: { b: { c: 42 } } };
    expect(getNestedValue(src, "a.b.x")).toBeUndefined();
  });

  it("handles dotted keys as a single key when direct access fails", () => {
    const src = { "custom.path": "value" };
    expect(getNestedValue(src, "custom.path")).toBe("value");
  });

  it("parses JSON string source when path is non-empty", () => {
    const src = JSON.stringify({ a: { b: "ok" } });
    expect(getNestedValue(src, "a.b")).toBe("ok");
  });

  it("returns the string itself when source is a non-JSON string and path is empty", () => {
    const src = "plain-string";
    expect(getNestedValue(src, "")).toBe("plain-string");
  });
});

describe("applyRegex", () => {
  it("returns first capture group when pattern matches", () => {
    const value = "/subscriptions/123/resourceGroups/my-group/providers";
    const pattern = new RegExp("/resourceGroups/([^/]+)/");
    expect(applyRegex(value, pattern)).toBe("my-group");
  });

  it("returns undefined when pattern does not match", () => {
    const value = "no match here";
    const pattern = new RegExp("/resourceGroups/([^/]+)/");
    expect(applyRegex(value, pattern)).toBeUndefined();
  });

  it("returns original value when pattern is undefined", () => {
    const value = "hello";
    expect(applyRegex(value, undefined)).toBe("hello");
  });
});

describe("getValueFromExpression", () => {
  const baseCtx: NameResolutionContext = {
    body: {
      category: "payments",
      nested: { field: "inner" },
    },
    attributes: {
      "http.status_code": 200,
      env: "prod",
    }
  };

  it("resolves body path expressions like 'body.category'", () => {
    const v = getValueFromExpression("body.category", baseCtx);
    expect(v).toBe("payments");
  });

  it("resolves attributes via 'attributes' prefix", () => {
    const v = getValueFromExpression("attributes.http.status_code", baseCtx);
    expect(v).toBe("200");
  });

  it("falls back to body path when not using known prefixes", () => {
    const v = getValueFromExpression("nested.field", baseCtx);
    expect(v).toBe("inner");
  });

  it("returns undefined for non-existing path expression with known prefix", () => {
    const v = getValueFromExpression("body.does.not.exist", baseCtx);
    expect(v).toBeUndefined();
  });

  it("treats non-path-looking expressions as literals", () => {
    const v = getValueFromExpression("literal-value", baseCtx);
    expect(v).toBe("literal-value");
  });
});

describe("parseNameRuleConfig + resolveNameFromRuleConfig", () => {
  const baseCtx: NameResolutionContext = {
    body: {
      category: "payments",
      resourceId:
        "/subscriptions/123/resourceGroups/rg-payments/providers/Microsoft.Web/sites/app1",
    },
    attributes: {},
  };

  it("parses sources, regex and default", () => {
    const config =
      "body.category;body.resourceId;/resourceGroups/([^/]+)/;*azure-eventhub*";
    const rule = parseNameRuleConfig(config);

    expect(rule.sources).toEqual(["body.category", "body.resourceId"]);
    expect(rule.regex).toBeInstanceOf(RegExp);
    expect(rule.defaultValue).toBe("azure-eventhub");
  });

  it("uses first non-empty expression and then default when regex does not match", () => {
    const config =
      "body.category;body.resourceId;/resourceGroups/([^/]+)/;*azure-eventhub*";
    const rule = parseNameRuleConfig(config);
    const result = resolveNameFromRuleConfig(rule, baseCtx, "NO_SUBSYSTEM");

    // chosenValue is 'payments'; regex does not match; default is 'azure-eventhub'
    expect(result).toBe("azure-eventhub");
  });

  it("applies regex on the chosen value when it matches", () => {
    const ctx: NameResolutionContext = {
      ...baseCtx,
      body: {
        resourceId:
          "/subscriptions/123/resourceGroups/rg-billing/providers/Microsoft.Web/sites/app1",
      },
    };

    const config = "body.resourceId;/resourceGroups/([^/]+)/;*fallback*";
    const rule = parseNameRuleConfig(config);
    const result = resolveNameFromRuleConfig(rule, ctx, "NO_SUBSYSTEM");

    expect(result).toBe("rg-billing");
  });

  it("falls back to default when regex does not match chosen value", () => {
    const ctx: NameResolutionContext = {
      ...baseCtx,
      body: {
        resourceId: "/no-resource-groups-here",
      },
    };

    const config = "body.resourceId;/resourceGroups/([^/]+)/;*fallback-subsystem*";
    const rule = parseNameRuleConfig(config);
    const result = resolveNameFromRuleConfig(rule, ctx, "NO_SUBSYSTEM");

    expect(result).toBe("fallback-subsystem");
  });

  it("falls back to global default when no sources, no default", () => {
    const config = "   "; // or undefined in real env
    const rule = parseNameRuleConfig(config);
    const result = resolveNameFromRuleConfig(rule, baseCtx, "GLOBAL_DEFAULT");

    expect(result).toBe("GLOBAL_DEFAULT");
  });

  it("uses default value when no expression resolves to a value", () => {
    const ctx: NameResolutionContext = {
      ...baseCtx,
      body: {}, // no category or resourceId
    };

    const config = "body.category;/resourceGroups/([^/]+)/;*default-subsystem*";
    const rule = parseNameRuleConfig(config);
    const result = resolveNameFromRuleConfig(rule, ctx, "NO_SUBSYSTEM");

    expect(result).toBe("default-subsystem");
  });

  it("falls back to global default when regex does not match and no fallback is provided", () => {
    const ctx: NameResolutionContext = {
      ...baseCtx,
      body: {
        resourceId: "/subscriptions/abc/no-resource-groups-here",
      },
    };

    const config = "body.resourceId;/resourceGroups/([^/]+)/"; // No *fallback*
    const rule = parseNameRuleConfig(config);
    const result = resolveNameFromRuleConfig(rule, ctx, "NO_SUBSYSTEM");

    // regex doesn't match, no fallback → global default
    expect(result).toBe("NO_SUBSYSTEM");
  });

  it("uses static subsystem when config is a plain string with no paths", () => {
    const config = "EventHub-Logs"; // Static value
    const rule = parseNameRuleConfig(config);
    const result = resolveNameFromRuleConfig(rule, baseCtx, "NO_SUBSYSTEM");

    expect(result).toBe("EventHub-Logs");
  });

  it("extracts field value without regex transformation", () => {
    const ctx: NameResolutionContext = {
      ...baseCtx,
      body: {
        category: "FunctionAppLogs",
        properties: {
          roleInstance: "4A88A912-638998452087239735"
        }
      },
    };

    const config = "body.properties.roleInstance"; // No regex, no fallback
    const rule = parseNameRuleConfig(config);
    const result = resolveNameFromRuleConfig(rule, ctx, "NO_SUBSYSTEM");

    expect(result).toBe("4A88A912-638998452087239735");
  });

  it("extracts simple field with fallback", () => {
    const ctx: NameResolutionContext = {
      ...baseCtx,
      body: {
        category: "AuditLogs"
      },
    };

    const config = "body.category;*default-category*"; // No regex, with fallback
    const rule = parseNameRuleConfig(config);
    const result = resolveNameFromRuleConfig(rule, ctx, "NO_SUBSYSTEM");

    expect(result).toBe("AuditLogs");
  });
}); 