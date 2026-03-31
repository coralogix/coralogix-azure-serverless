/**
 * End-to-end tests for eventHubTrigger.
 *
 * Each test simulates what a customer sends to EventHub and asserts
 * what log records are emitted to the OTLP exporter (i.e. Coralogix).
 *
 * The OTLP exporter is mocked — no network calls are made.
 * Timers are mocked to skip the 2 s flush delay.
 */

import { InvocationContext } from "@azure/functions";

// ---------------------------------------------------------------------------
// Shared record capture — populated by the mock exporter, cleared per test
// ---------------------------------------------------------------------------
const capturedRecords: any[] = [];

jest.mock("@opentelemetry/exporter-logs-otlp-grpc", () => ({
  OTLPLogExporter: jest.fn().mockImplementation(() => ({
    export(records: any[], cb: (result: { code: number }) => void) {
      capturedRecords.push(...records);
      cb({ code: 0 });
    },
    shutdown: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Prevent app.eventHub() from trying to register with the Azure host
jest.mock("@azure/functions", () => {
  const actual = jest.requireActual("@azure/functions");
  return { ...actual, app: { eventHub: jest.fn() } };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createMockContext = (): InvocationContext =>
  ({
    invocationId: "test-invocation-id",
    log: jest.fn(),
    error: jest.fn(),
  }) as unknown as InvocationContext;

/**
 * Load a fresh module (so loggerCache is empty) and invoke the trigger
 * with fake timers to skip the flush delay.
 */
async function runTrigger(
  events: unknown[],
  env: Record<string, string> = {}
): Promise<InvocationContext> {
  const originalEnv = { ...process.env };
  Object.assign(process.env, env);

  let trigger!: (events: unknown[], ctx: InvocationContext) => Promise<void>;
  jest.isolateModules(() => {
    ({ eventHubTrigger: trigger } = require("../EventHub/index"));
  });

  const context = createMockContext();
  jest.useFakeTimers();
  const promise = trigger(events, context);
  jest.advanceTimersByTime(3000);
  await promise;
  jest.useRealTimers();

  Object.keys(process.env).forEach((k) => {
    if (!(k in originalEnv)) delete process.env[k];
  });
  Object.assign(process.env, originalEnv);

  return context;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  capturedRecords.length = 0;
});

describe("eventHubTrigger — supported event formats", () => {
  it("JSON_OBJECT: plain object → 1 log entry with JSON body", async () => {
    const event = { message: "hello", level: "info", service: "payments" };

    await runTrigger([event]);

    expect(capturedRecords).toHaveLength(1);
    const body = JSON.parse(capturedRecords[0].body as string);
    expect(body.message).toBe("hello");
    expect(body.service).toBe("payments");
  });

  it("JSON_STRING: JSON-encoded string → 1 log entry, parsedBody available", async () => {
    const inner = { message: "json string event", level: "warning" };
    const event = JSON.stringify(inner); // string that is valid JSON

    await runTrigger([event]);

    expect(capturedRecords).toHaveLength(1);
    // body is the original string
    expect(capturedRecords[0].body).toBe(event);
  });

  it("JSON_ARRAY: array of objects → 1 log entry per element", async () => {
    const event = [
      { message: "first element", index: 0 },
      { message: "second element", index: 1 },
      { message: "third element", index: 2 },
    ];

    await runTrigger([event]);

    expect(capturedRecords).toHaveLength(3);
    const bodies = capturedRecords.map((r) => JSON.parse(r.body as string));
    expect(bodies[0].message).toBe("first element");
    expect(bodies[1].message).toBe("second element");
    expect(bodies[2].message).toBe("third element");
  });

  it("AZURE_ENVELOPE: {records:[...]} → 1 log entry per record", async () => {
    const event = {
      records: [
        {
          message: "record one",
          resourceId:
            "/subscriptions/abc-123/resourceGroups/prod-rg/providers/Microsoft.Compute/virtualMachines/vm1",
        },
        { message: "record two" },
      ],
    };

    await runTrigger([event]);

    expect(capturedRecords).toHaveLength(2);
    const bodies = capturedRecords.map((r) => JSON.parse(r.body as string));
    expect(bodies[0].message).toBe("record one");
    expect(bodies[1].message).toBe("record two");
  });

  it("AZURE_ENVELOPE: enriches azure metadata from resourceId", async () => {
    const event = {
      records: [
        {
          message: "with resource id",
          resourceId:
            "/subscriptions/sub-999/resourceGroups/my-rg/providers/Microsoft.Storage/storageAccounts/sa1",
        },
      ],
    };

    await runTrigger([event]);

    expect(capturedRecords).toHaveLength(1);
    const attrs = capturedRecords[0].attributes as Record<string, any>;
    expect(attrs["azure.subscription_id"]).toBe("sub-999");
    expect(attrs["azure.resource_group"]).toBe("my-rg");
    expect(attrs["azure.provider"]).toBe("microsoft.storage");
  });

  it("BUFFER: raw bytes → decoded and emitted as JSON", async () => {
    const payload = { message: "from buffer", level: "debug" };
    const event = Buffer.from(JSON.stringify(payload));

    await runTrigger([event]);

    expect(capturedRecords).toHaveLength(1);
    const body = JSON.parse(capturedRecords[0].body as string);
    expect(body.message).toBe("from buffer");
  });

  it("batch: multiple events of mixed formats in one trigger invocation", async () => {
    const events = [
      { message: "json object" },                             // JSON_OBJECT → 1
      JSON.stringify({ message: "json string" }),             // JSON_STRING → 1
      [{ message: "arr 1" }, { message: "arr 2" }],          // JSON_ARRAY  → 2
      { records: [{ message: "rec 1" }, { message: "rec 2" }] }, // ENVELOPE → 2
    ];

    await runTrigger(events);

    expect(capturedRecords).toHaveLength(6);
  });

  it("empty batch: does nothing and emits no records", async () => {
    await runTrigger([]);

    expect(capturedRecords).toHaveLength(0);
  });
});

describe("eventHubTrigger — application / subsystem routing", () => {
  it("uses CORALOGIX_APPLICATION and CORALOGIX_SUBSYSTEM env vars", async () => {
    const event = { message: "routed" };

    await runTrigger([event], {
      CORALOGIX_APPLICATION: "my-app",
      CORALOGIX_SUBSYSTEM: "my-subsystem",
    });

    expect(capturedRecords).toHaveLength(1);
    const attrs = capturedRecords[0].attributes as Record<string, any>;
    expect(attrs.applicationName).toBe("my-app");
    expect(attrs.subsystemName).toBe("my-subsystem");
  });

  it("falls back to defaults when env vars not set", async () => {
    await runTrigger([{ message: "fallback" }]);

    const attrs = capturedRecords[0].attributes as Record<string, any>;
    expect(attrs.applicationName).toBe("coralogix-azure-eventhub");
    expect(attrs.subsystemName).toBe("azure");
  });

  it("resolves applicationName from JSON field via selector", async () => {
    const event = { service: "checkout", message: "order placed" };

    await runTrigger([event], {
      CORALOGIX_APPLICATION_SELECTOR: "{{ $.service }}",
    });

    const attrs = capturedRecords[0].attributes as Record<string, any>;
    expect(attrs.applicationName).toBe("checkout");
  });
});

describe("eventHubTrigger — blocking pattern", () => {
  it("drops events matching BLOCKING_PATTERN", async () => {
    await runTrigger(
      [
        { message: "this is fine" },
        { message: "secret password leaked" },
        { message: "also fine" },
      ],
      { BLOCKING_PATTERN: "secret" }
    );

    expect(capturedRecords).toHaveLength(2);
    const bodies = capturedRecords.map((r) => JSON.parse(r.body as string));
    expect(bodies.every((b) => !b.message.includes("secret"))).toBe(true);
  });

  it("forwards all events when no blocking pattern set", async () => {
    await runTrigger([{ message: "a" }, { message: "b" }, { message: "c" }]);

    expect(capturedRecords).toHaveLength(3);
  });
});
