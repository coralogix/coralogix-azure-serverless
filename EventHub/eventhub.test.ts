import {
  getNestedValue,
  applyRegex,
  parseTemplate,
  evaluateTemplate,
  resolveName,
  TemplateContext,
  TemplateConfig,
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
    const value = "test-value";
    expect(applyRegex(value, undefined)).toBe("test-value");
  });
});

describe("parseTemplate", () => {
  it("parses simple template without regex", () => {
    const result = parseTemplate("{{ $.category }}");
    expect(result).toEqual({ expression: "$.category" });
  });

  it("parses template with regex using single quotes", () => {
    const result = parseTemplate("{{ $.resourceId | r'/resourceGroups/([^/]+)/' }}");
    expect(result?.expression).toBe("$.resourceId");
    expect(result?.regex).toBeDefined();
    expect(result?.regex?.test("/resourceGroups/test/")).toBe(true);
  });

  it("parses template with regex using double quotes", () => {
    const result = parseTemplate('{{ $.field | r"^test-(.*)$" }}');
    expect(result?.expression).toBe("$.field");
    expect(result?.regex).toBeDefined();
  });

  it("parses template with case-insensitive regex flag", () => {
    const result = parseTemplate('{{ $.resourceId | r"/resourcegroups/([^/]+)/i" }}');
    expect(result?.expression).toBe("$.resourceId");
    expect(result?.regex).toBeDefined();
    expect(result?.regex?.flags).toContain("i");
    // Test that it matches case-insensitively
    expect(result?.regex?.test("/RESOURCEGROUPS/test/")).toBe(true);
    expect(result?.regex?.test("/resourceGroups/test/")).toBe(true);
  });

  it("returns null for non-template strings", () => {
    expect(parseTemplate("plain-text")).toBeNull();
    expect(parseTemplate("not a {{ template")).toBeNull();
    expect(parseTemplate("template }} missing open")).toBeNull();
  });

  it("handles templates with extra whitespace", () => {
    const result = parseTemplate("{{  $.field  |  r'/pattern/'  }}");
    expect(result?.expression).toBe("$.field");
    expect(result?.regex).toBeDefined();
  });

  it("returns null for empty or undefined input", () => {
    expect(parseTemplate("")).toBeNull();
    expect(parseTemplate(undefined)).toBeNull();
    expect(parseTemplate("  ")).toBeNull();
  });

  it("logs warning and handles invalid regex gracefully", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();
    
    const result = parseTemplate("{{ $.field | r'[invalid(' }}");
    
    expect(result?.expression).toBe("$.field");
    expect(result?.regex).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid regex pattern in template"),
      expect.any(Error)
    );
    
    warnSpy.mockRestore();
  });
});

describe("evaluateTemplate", () => {
  const baseCtx: TemplateContext = {
    body: {
      category: "AuditLogs",
      resourceId: "/subscriptions/123/resourceGroups/production-rg/providers/Microsoft.Web/sites/app1",
      nested: {
        field: "deep-value",
      },
    },
    attributes: {
      "http.status_code": "200",
      "eventhub.partition_key": "0",
    },
  };

  it("evaluates $.field syntax (body access)", () => {
    const config: TemplateConfig = { expression: "$.category" };
    expect(evaluateTemplate(config, baseCtx)).toBe("AuditLogs");
  });

  it("evaluates nested $.field.nested syntax", () => {
    const config: TemplateConfig = { expression: "$.nested.field" };
    expect(evaluateTemplate(config, baseCtx)).toBe("deep-value");
  });

  it("evaluates attributes.field syntax", () => {
    const config: TemplateConfig = { expression: "attributes.http.status_code" };
    expect(evaluateTemplate(config, baseCtx)).toBe("200");
  });

  it("evaluates body.field syntax", () => {
    const config: TemplateConfig = { expression: "body.category" };
    expect(evaluateTemplate(config, baseCtx)).toBe("AuditLogs");
  });

  it("applies regex and returns capture group when pattern matches", () => {
    const config: TemplateConfig = {
      expression: "$.resourceId",
      regex: new RegExp("/resourceGroups/([^/]+)/"),
    };
    expect(evaluateTemplate(config, baseCtx)).toBe("production-rg");
  });

  it("returns raw value when regex doesn't match", () => {
    const config: TemplateConfig = {
      expression: "$.category",
      regex: new RegExp("/resourceGroups/([^/]+)/"), // Won't match "AuditLogs"
    };
    // Returns original value instead of undefined when regex fails
    expect(evaluateTemplate(config, baseCtx)).toBe("AuditLogs");
  });

  it("returns undefined when field doesn't exist", () => {
    const config: TemplateConfig = { expression: "$.nonexistent" };
    expect(evaluateTemplate(config, baseCtx)).toBeUndefined();
  });

  it("returns undefined when field doesn't exist, even with regex", () => {
    const config: TemplateConfig = {
      expression: "$.missing",
      regex: new RegExp("(.*)"),
    };
    expect(evaluateTemplate(config, baseCtx)).toBeUndefined();
  });

  it("supports multiple fallback expressions with || operator", () => {
    const config: TemplateConfig = {
      expression: "$.nonexistent || $.category",
    };
    expect(evaluateTemplate(config, baseCtx)).toBe("AuditLogs");
  });

  it("tries all fallback expressions in order with ||", () => {
    const config: TemplateConfig = {
      expression: "$.missing1 || $.missing2 || $.nested.field",
    };
    expect(evaluateTemplate(config, baseCtx)).toBe("deep-value");
  });

  it("returns first non-empty value with || operator", () => {
    const config: TemplateConfig = {
      expression: "$.resourceId || $.category",
    };
    // resourceId should be found first
    expect(evaluateTemplate(config, baseCtx)).toContain("/subscriptions/");
  });

  it("applies regex to first found value in || chain", () => {
    const config: TemplateConfig = {
      expression: "$.missing || $.resourceId",
      regex: new RegExp("/resourceGroups/([^/]+)/"),
    };
    expect(evaluateTemplate(config, baseCtx)).toBe("production-rg");
  });

  it("returns undefined when all || fallbacks fail", () => {
    const config: TemplateConfig = {
      expression: "$.missing1 || $.missing2 || $.missing3",
    };
    expect(evaluateTemplate(config, baseCtx)).toBeUndefined();
  });
});

describe("resolveName", () => {
  const baseCtx: TemplateContext = {
    body: {
      category: "AuditLogs",
      resourceId: "/subscriptions/123/resourceGroups/prod-rg/providers/Microsoft.Compute/vm1",
      operationName: "Microsoft.Compute/virtualMachines/write",
    },
    attributes: {
      "eventhub.partition_key": "0",
    },
  };

  it("resolves simple template without regex", () => {
    const result = resolveName("{{ $.category }}", baseCtx, "default-app");
    expect(result).toBe("AuditLogs");
  });

  it("resolves template with regex extraction", () => {
    const result = resolveName(
      "{{ $.resourceId | r'/resourceGroups/([^/]+)/' }}",
      baseCtx,
      "default-sub"
    );
    expect(result).toBe("prod-rg");
  });

  it("returns raw value when regex doesn't match", () => {
    const result = resolveName("{{ $.category | r'/resourceGroups/([^/]+)/' }}", baseCtx, "default");
    expect(result).toBe("AuditLogs"); // Raw value, not default
  });

  it("returns default when field doesn't exist", () => {
    const result = resolveName("{{ $.nonexistent }}", baseCtx, "fallback-default");
    expect(result).toBe("fallback-default");
  });

  it("returns default when field doesn't exist with regex", () => {
    const result = resolveName("{{ $.missing | r'(.*)' }}", baseCtx, "my-default");
    expect(result).toBe("my-default");
  });

  it("treats non-template strings as literal values", () => {
    const result = resolveName("StaticAppName", baseCtx, "default");
    expect(result).toBe("StaticAppName");
  });

  it("returns default for empty or undefined template", () => {
    expect(resolveName("", baseCtx, "default-1")).toBe("default-1");
    expect(resolveName(undefined, baseCtx, "default-2")).toBe("default-2");
    expect(resolveName("  ", baseCtx, "default-3")).toBe("default-3");
  });

  it("handles attributes access in templates", () => {
    const result = resolveName("{{ attributes.eventhub.partition_key }}", baseCtx, "default");
    expect(result).toBe("0");
  });

  it("handles body prefix explicitly", () => {
    const result = resolveName("{{ body.operationName }}", baseCtx, "default");
    expect(result).toBe("Microsoft.Compute/virtualMachines/write");
  });

  it("supports multiple fallback sources with || operator", () => {
    const result = resolveName("{{ $.missing || $.category }}", baseCtx, "default");
    expect(result).toBe("AuditLogs");
  });

  it("combines || fallback with regex extraction", () => {
    const result = resolveName(
      '{{ $.nonexistent || $.resourceId | r"/resourceGroups/([^/]+)/" }}',
      baseCtx,
      "default"
    );
    expect(result).toBe("prod-rg");
  });
});

describe("Azure-specific use cases", () => {
  it("extracts resource group from uppercase Azure resourceId", () => {
    const ctx: TemplateContext = {
      body: {
        resourceId: "/SUBSCRIPTIONS/123/RESOURCEGROUPS/PRODUCTION-RG/PROVIDERS/MICROSOFT.WEB/SITES/APP",
      },
      attributes: {},
    };

    const result = resolveName(
      '{{ $.resourceId | r"/resourcegroups/([^/]+)/i" }}',
      ctx,
      "NO_SUBSYSTEM"
    );
    expect(result).toBe("PRODUCTION-RG");
  });

  it("extracts resource group from mixed-case Azure resourceId", () => {
    const ctx: TemplateContext = {
      body: {
        resourceId: "/subscriptions/123/resourceGroups/staging-rg/providers/Microsoft.Compute/virtualMachines/vm1",
      },
      attributes: {},
    };

    const result = resolveName(
      '{{ $.resourceId | r"/resourcegroups/([^/]+)/i" }}',
      ctx,
      "NO_SUBSYSTEM"
    );
    expect(result).toBe("staging-rg");
  });

  it("extracts function app name from properties", () => {
    const ctx: TemplateContext = {
      body: {
        properties: {
          appName: "my-function-app",
          functionName: "HttpTrigger1",
        },
      },
      attributes: {},
    };

    const result = resolveName(
      "{{ $.properties.appName }}",
      ctx,
      "NO_SUBSYSTEM"
    );
    expect(result).toBe("my-function-app");
  });

  it("uses Azure region when app name is missing", () => {
    const ctx: TemplateContext = {
      body: {
        location: "West Europe",
        category: "FunctionAppLogs",
      },
      attributes: {},
    };

    const result = resolveName(
      "{{ $.properties.appName || $.location }}",
      ctx,
      "NO_SUBSYSTEM"
    );
    expect(result).toBe("West Europe");
  });

  it("extracts site name from Azure resourceId", () => {
    const ctx: TemplateContext = {
      body: {
        resourceId: "/subscriptions/123/resourceGroups/rg/providers/Microsoft.Web/sites/my-app",
      },
      attributes: {},
    };

    const result = resolveName(
      '{{ $.resourceId | r"/sites/([^/]+)" }}',
      ctx,
      "NO_APPLICATION"
    );
    expect(result).toBe("my-app");
  });

  it("uses Azure log category with multi-level fallback", () => {
    const ctx: TemplateContext = {
      body: {
        category: "AuditLogs",
        operationName: "Microsoft.Web/sites/write",
        level: "Informational",
      },
      attributes: {},
    };

    const result = resolveName(
      "{{ $.nonexistent || $.category }}",
      ctx,
      "NO_APPLICATION"
    );
    expect(result).toBe("AuditLogs");
  });

  it("falls back to default when all Azure fields are missing", () => {
    const ctx: TemplateContext = {
      body: {
        time: "2025-12-01T08:00:00Z",
      },
      attributes: {},
    };

    const result = resolveName(
      "{{ $.properties.appName || $.location || $.category }}",
      ctx,
      "azure-default"
    );
    expect(result).toBe("azure-default");
  });
});
