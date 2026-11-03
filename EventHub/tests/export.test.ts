import { InvocationContext } from "@azure/functions";
import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import { ReadableLogRecord } from "@opentelemetry/sdk-logs";

type ExportCall = { records: ReadableLogRecord[]; exporterId: number };
type ExportBehaviour = (records: ReadableLogRecord[], exporterId: number) => ExportResult;

// Match the v3 Node context used by function.json.
const createMockContext = (
  invocationId = "test-id",
  bindingData?: Record<string, any>
): InvocationContext => {
  const log: any = jest.fn();
  log.error = jest.fn();
  log.warn = jest.fn();
  return { invocationId, log, bindingData } as unknown as InvocationContext;
};

const errorLog = (context: InvocationContext): jest.Mock => (context.log as any).error;

const eventHubMetadata = (count: number, partitionId = "0", firstSequenceNumber = 100) => ({
  partitionContext: { partitionId },
  sequenceNumberArray: Array.from({ length: count }, (_, i) => firstSequenceNumber + i),
});

const SUCCESS: ExportResult = { code: ExportResultCode.SUCCESS };
const failure = (message: string, code?: number): ExportResult => ({
  code: ExportResultCode.FAILED,
  error: Object.assign(new Error(message), code !== undefined ? { code } : {}),
});

// Exercise the real SDK path with only the network exporter replaced.
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

  it("drops only the invalid record of an INVALID_ARGUMENT batch and keeps sending", async () => {
    const records = fakeRecords(600);
    const poison = records[100];
    const delivered: ReadableLogRecord[] = [];
    const exporter = {
      export: (batch: ReadableLogRecord[], cb: (r: ExportResult) => void) => {
        if (batch.includes(poison)) return cb(failure("3 INVALID_ARGUMENT: bad payload", 3));
        delivered.push(...batch);
        cb(SUCCESS);
      },
      shutdown: () => Promise.resolve(),
    };

    const promise = exportRecords(exporter, records, 512);

    await expect(promise).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining("rejected 1 log records"),
    });
    // All 599 valid records were delivered, in order; only the invalid one was dropped.
    expect(delivered).toEqual(records.filter((r) => r !== poison));
  });

  it("drops a whole batch only when every record in it is invalid", async () => {
    const exporter = {
      export: (_: ReadableLogRecord[], cb: (r: ExportResult) => void) =>
        cb(failure("3 INVALID_ARGUMENT: bad payload", 3)),
      shutdown: () => Promise.resolve(),
    };

    await expect(exportRecords(exporter, fakeRecords(8))).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining("rejected 8 log records"),
    });
  });

  it("bounds the number of requests when a whole full batch is rejected", async () => {
    const { MAX_SPLIT_REQUESTS } = require("../EventHub/export");
    let requests = 0;
    const exporter = {
      export: (_: ReadableLogRecord[], cb: (r: ExportResult) => void) => {
        requests++;
        cb(failure("3 INVALID_ARGUMENT: bad payload", 3));
      },
      shutdown: () => Promise.resolve(),
    };

    // Without a bound this would take 2 * 512 - 1 = 1023 requests.
    await expect(exportRecords(exporter, fakeRecords(512))).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining("rejected 512 log records"),
    });
    expect(requests).toBeLessThanOrEqual(1 + MAX_SPLIT_REQUESTS);
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
    expect(errorLog(context)).toHaveBeenCalledWith(
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
    expect(errorLog(context)).toHaveBeenCalledWith(
      expect.stringContaining("rejected 1 log records")
    );
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
    expect(errorLog(context)).toHaveBeenCalledWith(expect.stringContaining("::x"));
  });
});

describe("oversized export requests", () => {
  const {
    exportRecords,
    isMessageTooLarge,
    toBatches,
    MAX_EXPORT_BATCH_BYTES,
  } = require("../EventHub/export");
  const sized = (n: number, bytes: number, tag = "r") =>
    Array.from(
      { length: n },
      (_, i) => ({ body: `${tag}${i}:`.padEnd(bytes, "x") }) as unknown as ReadableLogRecord
    );
  const tooLarge = () =>
    failure("8 RESOURCE_EXHAUSTED: Received message larger than max (5000000 vs. 4194304)", 8);

  it("caps requests at 2 MB, Coralogix's recommended request size", () => {
    expect(MAX_EXPORT_BATCH_BYTES).toBe(2 * 1024 * 1024);
  });

  it("bounds batches by estimated bytes as well as count", () => {
    // 20 records of ~512 KB: far below 512 records, far above 2 MB.
    const batches = toBatches(sized(20, 512 * 1024));

    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toHaveLength(20);
    for (const batch of batches) {
      const bytes = batch.reduce((sum: number, r: any) => sum + r.body.length, 0);
      expect(bytes).toBeLessThanOrEqual(MAX_EXPORT_BATCH_BYTES);
    }
  });

  it("still batches small records by count only", () => {
    expect(toBatches(sized(1100, 100)).map((b: any[]) => b.length)).toEqual([512, 512, 76]);
  });

  it("sends a single record larger than the byte limit on its own", () => {
    const batches = toBatches([
      ...sized(1, 10),
      ...sized(1, 3 * 1024 * 1024, "big"),
      ...sized(1, 10),
    ]);

    expect(batches.map((b: any[]) => b.length)).toEqual([1, 1, 1]);
  });

  it.each([
    [
      "grpc-js / grpc-go",
      "8 RESOURCE_EXHAUSTED: Received message larger than max (5000000 vs. 4194304)",
      true,
    ],
    [
      "Coralogix, uncompressed",
      "8 RESOURCE_EXHAUSTED: decoded message length too large: found 25000000 bytes, the limit is: 20971520 bytes",
      true,
    ],
    [
      "Coralogix, compressed",
      "8 RESOURCE_EXHAUSTED: size limit, of 10485760 bytes, exceeded while decompressing message",
      true,
    ],
    ["load shedding / throttling", "8 RESOURCE_EXHAUSTED: service overloaded, please retry", false],
  ])("recognises a size rejection: %s", (_, message, expected) => {
    expect(isMessageTooLarge(Object.assign(new Error(message), { code: 8 }))).toBe(expected);
  });

  it("only treats RESOURCE_EXHAUSTED as a size rejection", () => {
    expect(isMessageTooLarge(Object.assign(new Error("message too large"), { code: 14 }))).toBe(
      false
    );
  });

  it("splits a batch rejected as too large until the offending record is isolated", async () => {
    const records = sized(8, 100);
    const poison = records[5];
    const attempts: number[] = [];
    const delivered: ReadableLogRecord[] = [];
    const exporter = {
      export: (batch: ReadableLogRecord[], cb: (r: ExportResult) => void) => {
        attempts.push(batch.length);
        if (batch.includes(poison)) return cb(tooLarge());
        delivered.push(...batch);
        cb(SUCCESS);
      },
      shutdown: () => Promise.resolve(),
    };

    const promise = exportRecords(exporter, records);

    await expect(promise).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining("rejected 1 log records as invalid or too large"),
    });
    expect(delivered).toHaveLength(7);
    expect(delivered).not.toContain(poison);
    expect(attempts[0]).toBe(8);
  });

  it("does not split or drop on RESOURCE_EXHAUSTED caused by throttling", async () => {
    const attempts: number[] = [];
    const exporter = {
      export: (batch: ReadableLogRecord[], cb: (r: ExportResult) => void) => {
        attempts.push(batch.length);
        cb(failure("8 RESOURCE_EXHAUSTED: rate limit exceeded, please retry", 8));
      },
      shutdown: () => Promise.resolve(),
    };

    await expect(exportRecords(exporter, sized(8, 100))).rejects.toMatchObject({
      retryable: true,
    });
    expect(attempts).toEqual([8]);
  });

  it("keeps the partition moving: an oversized record does not fail the invocation", async () => {
    const { eventHubTrigger, calls } = loadFunction((records) =>
      records.some((r) => String(r.body).includes("POISON")) ? tooLarge() : SUCCESS
    );
    const context = createMockContext("1", eventHubMetadata(3));

    await expect(eventHubTrigger(context, ["a", "POISON", "b"])).resolves.toBeUndefined();

    const delivered = calls
      .filter((c) => !c.records.some((r) => String(r.body).includes("POISON")))
      .flatMap((c) => c.records.map((r) => r.body));
    expect(delivered.sort()).toEqual(["a", "b"]);
    expect(errorLog(context)).toHaveBeenCalledWith(expect.stringContaining("too large"));
  });
});

describe("eventHubTrigger retries", () => {
  it("logs failures through context.log.error on the v3 programming model", async () => {
    const { eventHubTrigger } = loadFunction(() => failure("14 UNAVAILABLE", 14));
    const context = createMockContext("id", eventHubMetadata(1));

    await expect(eventHubTrigger(context, ["log"])).rejects.toThrow("UNAVAILABLE");
    expect(errorLog(context)).toHaveBeenCalledWith(
      expect.stringContaining("Export to Coralogix failed")
    );
  });

  it("re-sends the whole batch when the same events are retried", async () => {
    let call = 0;
    // 1st attempt: batch 1 succeeds, batch 2 fails. Retry: everything succeeds.
    const { eventHubTrigger, calls } = loadFunction(() =>
      ++call === 2 ? failure("14 UNAVAILABLE", 14) : SUCCESS
    );
    const events = [{ records: Array.from({ length: 700 }, (_, i) => ({ msg: `record-${i}` })) }];

    await expect(eventHubTrigger(createMockContext("1"), events)).rejects.toThrow();
    calls.length = 0;
    await eventHubTrigger(createMockContext("2"), events);

    expect(calls.flatMap((c) => c.records)).toHaveLength(700);
  });
});
