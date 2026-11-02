import { InvocationContext } from "@azure/functions";
import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import { ReadableLogRecord } from "@opentelemetry/sdk-logs";

type ExportCall = { records: ReadableLogRecord[]; exporterId: number };
type ExportBehaviour = (records: ReadableLogRecord[], exporterId: number) => ExportResult;

const createMockContext = (invocationId = "test-id"): InvocationContext =>
  ({
    invocationId,
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as InvocationContext;

const SUCCESS: ExportResult = { code: ExportResultCode.SUCCESS };
const failure = (message: string, code?: number): ExportResult => ({
  code: ExportResultCode.FAILED,
  error: Object.assign(new Error(message), code !== undefined ? { code } : {}),
});

/**
 * Load the function with the real OTel SDK and a fake OTLP exporter, so the tests
 * exercise the actual emit -> collect -> export path without a network.
 */
function loadFunction(
  behaviour: ExportBehaviour = () => SUCCESS,
  env: Record<string, string> = {}
) {
  const calls: ExportCall[] = [];
  const shutdowns: number[] = [];
  let exportersCreated = 0;

  const originalEnv = { ...process.env };
  Object.assign(process.env, env);

  let mod: typeof import("../EventHub/index");
  jest.isolateModules(() => {
    jest.doMock("@opentelemetry/exporter-logs-otlp-grpc", () => ({
      OTLPLogExporter: jest.fn().mockImplementation(() => {
        const exporterId = ++exportersCreated;
        return {
          export: (records: ReadableLogRecord[], cb: (r: ExportResult) => void) => {
            calls.push({ records, exporterId });
            // Resolve asynchronously, like a real network export.
            setImmediate(() => cb(behaviour(records, exporterId)));
          },
          shutdown: jest.fn(() => {
            shutdowns.push(exporterId);
            return Promise.resolve();
          }),
          forceFlush: jest.fn(() => Promise.resolve()),
        };
      }),
    }));
    mod = require("../EventHub/index");
  });

  for (const key of Object.keys(env)) {
    if (key in originalEnv) process.env[key] = originalEnv[key];
    else delete process.env[key];
  }

  return {
    eventHubTrigger: mod!.eventHubTrigger,
    calls,
    shutdowns,
    exportersCreated: () => exportersCreated,
  };
}

const bodies = (records: ReadableLogRecord[]) => records.map((r) => r.body);

afterEach(() => {
  jest.resetModules();
});

describe("exportRecords", () => {
  const { exportRecords, ExportError } = require("../EventHub/export");
  const fakeRecords = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ body: `log-${i}` }) as unknown as ReadableLogRecord);

  it("splits records into batches of the given size", async () => {
    const batches: number[] = [];
    const exporter = {
      export: (records: ReadableLogRecord[], cb: (r: ExportResult) => void) => {
        batches.push(records.length);
        cb(SUCCESS);
      },
      shutdown: () => Promise.resolve(),
    };

    await exportRecords(exporter, fakeRecords(1100), 512);

    expect(batches).toEqual([512, 512, 76]);
  });

  it("throws a retryable error and stops on a transport failure", async () => {
    const batches: number[] = [];
    const exporter = {
      export: (records: ReadableLogRecord[], cb: (r: ExportResult) => void) => {
        batches.push(records.length);
        cb(failure("14 UNAVAILABLE: No connection established", 14));
      },
      shutdown: () => Promise.resolve(),
    };

    const promise = exportRecords(exporter, fakeRecords(1000), 512);

    await expect(promise).rejects.toBeInstanceOf(ExportError);
    await expect(promise).rejects.toMatchObject({ retryable: true });
    expect(batches).toEqual([512]);
  });

  it("treats an exporter that throws synchronously as a retryable failure", async () => {
    const exporter = {
      export: () => {
        throw new Error("boom");
      },
      shutdown: () => Promise.resolve(),
    };

    await expect(exportRecords(exporter, fakeRecords(1))).rejects.toMatchObject({
      retryable: true,
      message: expect.stringContaining("boom"),
    });
  });

  it("keeps sending after an INVALID_ARGUMENT batch and reports it as non-retryable", async () => {
    const batches: number[] = [];
    let n = 0;
    const exporter = {
      export: (records: ReadableLogRecord[], cb: (r: ExportResult) => void) => {
        batches.push(records.length);
        cb(n++ === 0 ? failure("3 INVALID_ARGUMENT: bad payload", 3) : SUCCESS);
      },
      shutdown: () => Promise.resolve(),
    };

    const promise = exportRecords(exporter, fakeRecords(600), 512);

    await expect(promise).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining("rejected 512 log records"),
    });
    expect(batches).toEqual([512, 88]);
  });

  it("does nothing for an empty record list", async () => {
    const exporter = { export: jest.fn(), shutdown: () => Promise.resolve() };

    await exportRecords(exporter, []);

    expect(exporter.export).not.toHaveBeenCalled();
  });
});

describe("eventHubTrigger export behaviour", () => {
  it("exports the invocation's logs and resolves once the export succeeded", async () => {
    const { eventHubTrigger, calls } = loadFunction();

    await eventHubTrigger(createMockContext(), ["first log", "second log"]);

    expect(calls).toHaveLength(1);
    expect(bodies(calls[0].records)).toEqual(["first log", "second log"]);
  });

  it("does not wait on timers before exporting", async () => {
    jest.useFakeTimers({ doNotFake: ["setImmediate"] });
    try {
      const { eventHubTrigger, calls } = loadFunction();

      await eventHubTrigger(createMockContext(), ["log"]);

      expect(calls).toHaveLength(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("fails the invocation when the export fails, so Event Hub retries the batch", async () => {
    const { eventHubTrigger } = loadFunction(() =>
      failure("4 DEADLINE_EXCEEDED: Deadline exceeded", 4)
    );
    const context = createMockContext();

    await expect(eventHubTrigger(context, ["log"])).rejects.toThrow("DEADLINE_EXCEEDED");
    expect(context.error).toHaveBeenCalledWith(
      expect.stringContaining("Export to Coralogix failed")
    );
  });

  it("recreates the exporter after a failed export instead of reusing the broken one", async () => {
    let fail = true;
    const { eventHubTrigger, calls, shutdowns, exportersCreated } = loadFunction(() =>
      fail ? failure("14 UNAVAILABLE", 14) : SUCCESS
    );

    await expect(eventHubTrigger(createMockContext(), ["log"])).rejects.toThrow();
    expect(shutdowns).toEqual([1]);

    fail = false;
    await eventHubTrigger(createMockContext(), ["retried log"]);

    expect(exportersCreated()).toBe(2);
    expect(calls[1].exporterId).toBe(2);
    expect(bodies(calls[1].records)).toEqual(["retried log"]);
  });

  it("does not fail the invocation when Coralogix rejects records as invalid", async () => {
    const { eventHubTrigger, shutdowns } = loadFunction(() =>
      failure("3 INVALID_ARGUMENT: bad payload", 3)
    );
    const context = createMockContext();

    await expect(eventHubTrigger(context, ["log"])).resolves.toBeUndefined();
    expect(context.error).toHaveBeenCalledWith(expect.stringContaining("rejected 1 log records"));
    expect(shutdowns).toEqual([]);
  });

  it("keeps concurrent invocations' records separate", async () => {
    const { eventHubTrigger, calls } = loadFunction();

    await Promise.all([
      eventHubTrigger(createMockContext("a"), ["a1", "a2"]),
      eventHubTrigger(createMockContext("b"), ["b1"]),
    ]);

    const exported = calls.map((c) => bodies(c.records));
    expect(exported).toContainEqual(["a1", "a2"]);
    expect(exported).toContainEqual(["b1"]);
    expect(exported).toHaveLength(2);
  });

  it("does not re-export records that were already delivered", async () => {
    const { eventHubTrigger, calls } = loadFunction();

    await eventHubTrigger(createMockContext(), ["one"]);
    await eventHubTrigger(createMockContext(), ["two"]);

    expect(calls.map((c) => bodies(c.records))).toEqual([["one"], ["two"]]);
  });

  it("exports more than 2048 records from one invocation without dropping any", async () => {
    const { eventHubTrigger, calls } = loadFunction();
    const records = Array.from({ length: 3000 }, (_, i) => ({ msg: `record-${i}` }));

    await eventHubTrigger(createMockContext(), [{ records }]);

    const total = calls.reduce((sum, c) => sum + c.records.length, 0);
    expect(total).toBe(3000);
    expect(calls.every((c) => c.records.length <= 512)).toBe(true);
  });

  it("exports each app/subsystem separately and recreates every exporter that failed", async () => {
    // Subsystem "x" fails, "y" succeeds.
    const { eventHubTrigger, calls, shutdowns } = loadFunction(
      (records) =>
        String(records[0].body).includes('"x"') ? failure("14 UNAVAILABLE", 14) : SUCCESS,
      { CORALOGIX_SUBSYSTEM_SELECTOR: "{{ $.sub }}" }
    );
    const context = createMockContext();

    await expect(eventHubTrigger(context, [{ sub: "x" }, { sub: "y" }])).rejects.toThrow(
      "UNAVAILABLE"
    );

    expect(calls).toHaveLength(2);
    const failedExporter = calls.find((c) => String(c.records[0].body).includes('"x"'))!;
    expect(shutdowns).toEqual([failedExporter.exporterId]);
    expect(context.error).toHaveBeenCalledWith(expect.stringContaining("::x"));
  });
});
