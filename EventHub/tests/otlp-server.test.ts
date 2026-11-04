/**
 * End-to-end tests against a local OTLP/gRPC server, with the real OpenTelemetry
 * exporter and the real function handler (no exporter mocks). The server stands in
 * for Coralogix ingress and replies with real OTLP responses or gRPC status codes.
 */
import * as grpc from "@grpc/grpc-js";
import { InvocationContext } from "@azure/functions";

const EXPORT_PATH = "/opentelemetry.proto.collector.logs.v1.LogsService/Export";

type Reply = { response?: Buffer; status?: grpc.status; message?: string };
type Handler = (request: Buffer) => Reply;

/** ExportLogsServiceResponse { partial_success { rejected_log_records, error_message } } */
function partialSuccessResponse(rejected: number, errorMessage: string): Buffer {
  const msg = Buffer.from(errorMessage, "utf8");
  const inner = Buffer.concat([
    Buffer.from([0x08, rejected]),
    Buffer.from([0x12, msg.length]),
    msg,
  ]);
  return Buffer.concat([Buffer.from([0x0a, inner.length]), inner]);
}

const EMPTY_RESPONSE = Buffer.alloc(0);

let server: grpc.Server;
let port: number;
let handler: Handler;
const requests: Buffer[] = [];

beforeAll(async () => {
  server = new grpc.Server();
  server.addService(
    {
      Export: {
        path: EXPORT_PATH,
        requestStream: false,
        responseStream: false,
        requestSerialize: (b: Buffer) => b,
        requestDeserialize: (b: Buffer) => b,
        responseSerialize: (b: Buffer) => b,
        responseDeserialize: (b: Buffer) => b,
      },
    } as grpc.ServiceDefinition,
    {
      Export: (call: grpc.ServerUnaryCall<Buffer, Buffer>, cb: grpc.sendUnaryData<Buffer>) => {
        requests.push(call.request);
        const reply = handler(call.request);
        if (reply.status !== undefined) {
          cb({ code: reply.status, details: reply.message ?? "" } as grpc.ServiceError, null);
        } else {
          cb(null, reply.response ?? EMPTY_RESPONSE);
        }
      },
    }
  );
  port = await new Promise((resolve, reject) =>
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (err, p) =>
      err ? reject(err) : resolve(p)
    )
  );
});

afterAll(() => {
  server.forceShutdown();
});

beforeEach(() => {
  requests.length = 0;
  handler = () => ({ response: EMPTY_RESPONSE });
});

afterEach(() => {
  jest.resetModules();
});

const createMockContext = (invocationId = "test-id"): InvocationContext => {
  const log: any = jest.fn();
  log.error = jest.fn();
  log.warn = jest.fn();
  return { invocationId, log } as unknown as InvocationContext;
};

/** Load the function with the real exporter pointed at the local server. */
function loadFunction(env: Record<string, string> = {}) {
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
    OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer local-test",
    ...env,
  });
  let mod: typeof import("../EventHub/index");
  jest.isolateModules(() => {
    mod = require("../EventHub/index");
  });
  // The exporter reads its configuration when it is first created, during an invocation,
  // so the environment is restored by the caller via the returned function.
  const restore = () => {
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  };
  return { eventHubTrigger: mod!.eventHubTrigger, restore };
}

const sent = (needle: string) => requests.filter((r) => r.includes(needle)).length;

describe("against a local OTLP/gRPC server", () => {
  it("delivers logs and resolves on a successful response", async () => {
    const { eventHubTrigger, restore } = loadFunction();
    try {
      await eventHubTrigger(createMockContext(), ["hello from the real exporter"]);
    } finally {
      restore();
    }

    expect(requests).toHaveLength(1);
    expect(sent("hello from the real exporter")).toBe(1);
  });

  it("logs a real partial-success response as a warning by default and does not retry it", async () => {
    handler = () => ({ response: partialSuccessResponse(3, "3 records rejected") });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { eventHubTrigger, restore } = loadFunction();
    try {
      // The export counts as successful (OTLP forbids retrying partial successes).
      await expect(eventHubTrigger(createMockContext(), ["log"])).resolves.toBeUndefined();

      expect(requests).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(
        "Received Partial Success response:",
        expect.stringMatching(/"rejectedLogRecords":"?3"?.*3 records rejected/)
      );
    } finally {
      warn.mockRestore();
      restore();
    }
  });

  it("stays silent about partial success with OTEL_LOG_LEVEL=none", async () => {
    handler = () => ({ response: partialSuccessResponse(3, "3 records rejected") });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { eventHubTrigger, restore } = loadFunction({ OTEL_LOG_LEVEL: "none" });
    try {
      await eventHubTrigger(createMockContext(), ["log"]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      restore();
    }
  });

  it("fails the invocation on a real UNAVAILABLE status so Event Hubs retries the batch", async () => {
    handler = () => ({ status: grpc.status.UNAVAILABLE, message: "ingress down" });
    const { eventHubTrigger, restore } = loadFunction();
    const context = createMockContext();
    try {
      await expect(eventHubTrigger(context, ["log"])).rejects.toThrow("UNAVAILABLE");
      expect((context.log as any).error).toHaveBeenCalledWith(
        expect.stringContaining("Export to Coralogix failed")
      );
    } finally {
      restore();
    }
  });

  it("isolates a record that the server rejects with INVALID_ARGUMENT", async () => {
    handler = (request) =>
      request.includes("POISON")
        ? { status: grpc.status.INVALID_ARGUMENT, message: "bad record" }
        : { response: EMPTY_RESPONSE };
    const { eventHubTrigger, restore } = loadFunction();
    const events = [
      { records: Array.from({ length: 16 }, (_, i) => ({ n: i, v: i === 9 ? "POISON" : "ok" })) },
    ];
    try {
      // Not retryable: the invocation succeeds and the partition moves on.
      await expect(eventHubTrigger(createMockContext(), events)).resolves.toBeUndefined();
    } finally {
      restore();
    }

    const accepted = requests.filter((r) => !r.includes("POISON"));
    for (let i = 0; i < 16; i++) {
      const delivered = accepted.filter((r) => r.includes(`"n":${i},`)).length;
      expect(delivered).toBe(i === 9 ? 0 : 1);
    }
  });
});
