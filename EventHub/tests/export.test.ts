import { InvocationContext } from "@azure/functions";
import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import { ReadableLogRecord } from "@opentelemetry/sdk-logs";

type ExportCall = { records: ReadableLogRecord[]; exporterId: number };
type ExportBehaviour = (records: ReadableLogRecord[], exporterId: number) => ExportResult;

/**
 * A context shaped like the v3 Node programming model this app runs on
 * (function.json): no context.error/context.warn, loggers hang off context.log,
 * and trigger metadata is in context.bindingData.
 */
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

/** Event Hubs trigger metadata for a batch of `count` events on one partition. */
const eventHubMetadata = (count: number, partitionId = "0", firstSequenceNumber = 100) => ({
  partitionContext: { partitionId },
  sequenceNumberArray: Array.from({ length: count }, (_, i) => firstSequenceNumber + i),
});

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

describe("exportRecords settled count", () => {
  const { exportRecords } = require("../EventHub/export");
  const fakeRecords = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ body: `log-${i}` }) as unknown as ReadableLogRecord);

  it("reports how many leading records were delivered before a retryable failure", async () => {
    let n = 0;
    const exporter = {
      export: (_: ReadableLogRecord[], cb: (r: ExportResult) => void) =>
        cb(n++ < 2 ? SUCCESS : failure("14 UNAVAILABLE", 14)),
      shutdown: () => Promise.resolve(),
    };

    await expect(exportRecords(exporter, fakeRecords(1300), 512)).rejects.toMatchObject({
      retryable: true,
      settled: 1024,
    });
  });

  it("counts every record as settled after an INVALID_ARGUMENT rejection", async () => {
    const exporter = {
      export: (_: ReadableLogRecord[], cb: (r: ExportResult) => void) =>
        cb(failure("3 INVALID_ARGUMENT", 3)),
      shutdown: () => Promise.resolve(),
    };

    await expect(exportRecords(exporter, fakeRecords(10))).rejects.toMatchObject({
      retryable: false,
      settled: 10,
    });
  });
});

describe("DeliveredRecords", () => {
  const { DeliveredRecords } = require("../EventHub/export");
  const item = (eventKey: string | undefined, ordinal: number) => ({
    record: {} as ReadableLogRecord,
    eventKey,
    ordinal,
  });

  it("matches on scope, event and ordinal", () => {
    const delivered = new DeliveredRecords();
    delivered.add("app::sub", item("0:1", 0));

    expect(delivered.has("app::sub", item("0:1", 0))).toBe(true);
    expect(delivered.has("app::sub", item("0:1", 1))).toBe(false);
    expect(delivered.has("app::other", item("0:1", 0))).toBe(false);
    expect(delivered.has("app::sub", item("1:1", 0))).toBe(false);
  });

  it("never tracks records without an event key", () => {
    const delivered = new DeliveredRecords();
    delivered.add("app::sub", item(undefined, 0));

    expect(delivered.has("app::sub", item(undefined, 0))).toBe(false);
    expect(delivered.size).toBe(0);
  });

  it("forgets events once their invocation completed", () => {
    const delivered = new DeliveredRecords();
    delivered.add("app::sub", item("0:1", 0));
    delivered.forget(["0:1"]);

    expect(delivered.has("app::sub", item("0:1", 0))).toBe(false);
  });

  it("stays bounded by evicting the oldest events", () => {
    const delivered = new DeliveredRecords(2);
    delivered.add("s", item("0:1", 0));
    delivered.add("s", item("0:2", 0));
    delivered.add("s", item("0:3", 0));

    expect(delivered.size).toBe(2);
    expect(delivered.has("s", item("0:1", 0))).toBe(false);
    expect(delivered.has("s", item("0:3", 0))).toBe(true);
  });
});

describe("getEventKeys", () => {
  const load = () => loadFunction() && require("../EventHub/index");

  it("builds <partition>:<sequenceNumber> keys from v3 bindingData", () => {
    const { getEventKeys } = load();
    const context = createMockContext("id", eventHubMetadata(2, "3", 7));

    expect(getEventKeys(context, 2)).toEqual(["3:7", "3:8"]);
  });

  it("reads v4 triggerMetadata too", () => {
    const { getEventKeys } = load();
    const context = {
      triggerMetadata: { partitionContext: { partitionId: "1" }, sequenceNumberArray: [5] },
    } as unknown as InvocationContext;

    expect(getEventKeys(context, 1)).toEqual(["1:5"]);
  });

  it.each([
    ["no metadata", undefined, 1],
    ["no partition", { sequenceNumberArray: [1] }, 1],
    ["length mismatch", eventHubMetadata(2), 3],
    [
      "missing sequence number",
      { partitionContext: { partitionId: "0" }, sequenceNumberArray: [null] },
      1,
    ],
  ])("returns undefined with %s", (_, bindingData, count) => {
    const { getEventKeys } = load();

    expect(
      getEventKeys(createMockContext("id", bindingData as any), count as number)
    ).toBeUndefined();
  });
});

describe("eventHubTrigger retries without duplicates", () => {
  const manyRecords = (n: number) => ({
    records: Array.from({ length: n }, (_, i) => ({ msg: `record-${i}` })),
  });
  const bodiesOf = (calls: ExportCall[]) => calls.flatMap((c) => c.records.map((r) => r.body));

  it("logs failures through context.log.error on the v3 programming model", async () => {
    const { eventHubTrigger } = loadFunction(() => failure("14 UNAVAILABLE", 14));
    const context = createMockContext("id", eventHubMetadata(1));

    await expect(eventHubTrigger(context, ["log"])).rejects.toThrow("UNAVAILABLE");
    expect(errorLog(context)).toHaveBeenCalledWith(
      expect.stringContaining("Export to Coralogix failed")
    );
  });

  it("only re-sends the batches that failed when the same events are retried", async () => {
    let call = 0;
    // 1st attempt: batch 1 succeeds, batch 2 fails. Retry: everything succeeds.
    const { eventHubTrigger, calls } = loadFunction(() =>
      ++call === 2 ? failure("14 UNAVAILABLE", 14) : SUCCESS
    );
    const metadata = eventHubMetadata(1);

    await expect(
      eventHubTrigger(createMockContext("1", metadata), [manyRecords(700)])
    ).rejects.toThrow();
    const sentFirst = bodiesOf(calls);
    expect(sentFirst).toHaveLength(700); // 512 delivered + 188 failed

    calls.length = 0;
    const retryContext = createMockContext("2", metadata);
    await eventHubTrigger(retryContext, [manyRecords(700)]);

    // Only the 188 records of the failed batch are sent again.
    const resent = bodiesOf(calls);
    expect(resent).toHaveLength(188);
    expect(resent).toEqual(sentFirst.slice(512));
    expect(retryContext.log).toHaveBeenCalledWith(
      "Skipping 512 log records already delivered by a previous attempt"
    );
  });

  it("only re-sends the app/subsystem that failed", async () => {
    let failX = true;
    const { eventHubTrigger, calls } = loadFunction(
      (records) =>
        failX && String(records[0].body).includes('"x"') ? failure("14 UNAVAILABLE", 14) : SUCCESS,
      { CORALOGIX_SUBSYSTEM_SELECTOR: "{{ $.sub }}" }
    );
    const metadata = eventHubMetadata(2);
    const events = [{ sub: "x" }, { sub: "y" }];

    await expect(eventHubTrigger(createMockContext("1", metadata), events)).rejects.toThrow();
    failX = false;
    calls.length = 0;
    await eventHubTrigger(createMockContext("2", metadata), events);

    expect(bodiesOf(calls)).toEqual([JSON.stringify({ sub: "x" })]);
  });

  it("does not skip anything for a different partition with the same sequence numbers", async () => {
    let call = 0;
    let healthy = false;
    const { eventHubTrigger, calls } = loadFunction(() =>
      healthy || ++call === 1 ? SUCCESS : failure("14 UNAVAILABLE", 14)
    );
    // Partition 0: 700 records, batch 1 delivered, batch 2 failed (kept for retry).
    await expect(
      eventHubTrigger(createMockContext("1", eventHubMetadata(1, "0")), [manyRecords(700)])
    ).rejects.toThrow();

    healthy = true;
    calls.length = 0;
    await eventHubTrigger(createMockContext("2", eventHubMetadata(1, "1")), [manyRecords(700)]);

    expect(bodiesOf(calls)).toHaveLength(700);
  });

  it("resends the whole batch when the trigger metadata is missing", async () => {
    let call = 0;
    const { eventHubTrigger, calls } = loadFunction(() =>
      ++call === 2 ? failure("14 UNAVAILABLE", 14) : SUCCESS
    );

    await expect(eventHubTrigger(createMockContext("1"), [manyRecords(700)])).rejects.toThrow();
    calls.length = 0;
    await eventHubTrigger(createMockContext("2"), [manyRecords(700)]);

    expect(bodiesOf(calls)).toHaveLength(700);
  });

  it("sends everything again for a deliberate replay after the batch succeeded", async () => {
    const { eventHubTrigger, calls } = loadFunction();
    const metadata = eventHubMetadata(1);

    await eventHubTrigger(createMockContext("1", metadata), ["log"]);
    await eventHubTrigger(createMockContext("2", metadata), ["log"]);

    expect(bodiesOf(calls)).toEqual(["log", "log"]);
  });

  it("does not resend records rejected as invalid when another export forces a retry", async () => {
    let failY = true;
    const { eventHubTrigger, calls } = loadFunction(
      (records) => {
        const body = String(records[0].body);
        if (body.includes('"x"')) return failure("3 INVALID_ARGUMENT", 3);
        return failY ? failure("14 UNAVAILABLE", 14) : SUCCESS;
      },
      { CORALOGIX_SUBSYSTEM_SELECTOR: "{{ $.sub }}" }
    );
    const metadata = eventHubMetadata(2);
    const events = [{ sub: "x" }, { sub: "y" }];

    await expect(eventHubTrigger(createMockContext("1", metadata), events)).rejects.toThrow();
    failY = false;
    calls.length = 0;
    await eventHubTrigger(createMockContext("2", metadata), events);

    expect(bodiesOf(calls)).toEqual([JSON.stringify({ sub: "y" })]);
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
      settled: 8,
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
      settled: 0,
    });
    expect(attempts).toEqual([8]);
  });

  it("reports exactly the records settled before a retryable failure inside a split", async () => {
    const records = sized(8, 100);
    let call = 0;
    const exporter = {
      export: (batch: ReadableLogRecord[], cb: (r: ExportResult) => void) => {
        call++;
        if (call === 1) return cb(tooLarge()); // whole batch too large -> split 4 + 4
        if (call === 2) return cb(SUCCESS); // first half delivered
        cb(failure("14 UNAVAILABLE", 14)); // second half: connection lost
      },
      shutdown: () => Promise.resolve(),
    };

    await expect(exportRecords(exporter, records)).rejects.toMatchObject({
      retryable: true,
      settled: 4,
      message: expect.stringContaining("Failed to export 4 log records"),
    });
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
