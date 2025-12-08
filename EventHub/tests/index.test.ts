import { InvocationContext } from "@azure/functions";

const createMockContext = (): InvocationContext =>
  ({
    invocationId: "test-id",
    log: jest.fn(),
  }) as unknown as InvocationContext;

type LogModule = {
  detectLogFormat: typeof import("../EventHub/index").detectLogFormat;
  LogFormat: typeof import("../EventHub/index").LogFormat;
  handleLogEntries: typeof import("../EventHub/index").handleLogEntries;
};

type EnvConfig = {
  NEWLINE_PATTERN?: string;
  BLOCKING_PATTERN?: string;
};

/**
 * Load the module in isolation with optional environment variables.
 * Environment is set before module load and cleaned up after.
 */
function loadLogModule(env: EnvConfig = {}): LogModule {
  const originalEnv = { ...process.env };

  // Set env vars before loading module
  if (env.NEWLINE_PATTERN !== undefined) {
    process.env.NEWLINE_PATTERN = env.NEWLINE_PATTERN;
  } else {
    delete process.env.NEWLINE_PATTERN;
  }

  if (env.BLOCKING_PATTERN !== undefined) {
    process.env.BLOCKING_PATTERN = env.BLOCKING_PATTERN;
  } else {
    delete process.env.BLOCKING_PATTERN;
  }

  let mod: LogModule;
  jest.isolateModules(() => {
    mod = require("../EventHub/index");
  });

  process.env = originalEnv;

  return mod!;
}

describe("Log processing + blocking + splitting behaviour", () => {
  let mockContext: InvocationContext;

  beforeEach(() => {
    mockContext = createMockContext();
  });

  describe("Parsing format & basic log entries", () => {
    it("should handle plain text string", () => {
      const { detectLogFormat, LogFormat, handleLogEntries } = loadLogModule();
      const input = "User login succeeded for user: alice";

      expect(detectLogFormat(input)).toBe(LogFormat.STRING);
      const results = handleLogEntries(input, LogFormat.STRING, mockContext);
      expect(results).toHaveLength(1);
      expect(results[0].body).toBe(input);
      expect(results[0].parsedBody).toBeNull();
    });

    it("should handle JSON string containing object", () => {
      const { detectLogFormat, LogFormat, handleLogEntries } = loadLogModule();
      const obj = { event: "started", user: "bob" };
      const input = JSON.stringify(obj);

      expect(detectLogFormat(input)).toBe(LogFormat.JSON_STRING);
      const results = handleLogEntries(input, LogFormat.JSON_STRING, mockContext);
      expect(results).toHaveLength(1);
      expect(results[0].body).toBe(input);
      expect(results[0].parsedBody).toEqual(obj);
    });

    it("should handle JSON object", () => {
      const { detectLogFormat, LogFormat, handleLogEntries } = loadLogModule();
      const obj = {
        time: "2025-01-01T00:00:00Z",
        message: "something happened",
        level: "Information",
      };

      expect(detectLogFormat(obj)).toBe(LogFormat.JSON_OBJECT);
      const results = handleLogEntries(obj, LogFormat.JSON_OBJECT, mockContext);
      expect(results).toHaveLength(1);
      expect(results[0].body).toBe(JSON.stringify(obj));
      expect(results[0].parsedBody).toEqual(obj);
    });

    it("should handle JSON array with objects", () => {
      const { detectLogFormat, LogFormat, handleLogEntries } = loadLogModule();
      const arr = [
        { id: 1, msg: "first" },
        { id: 2, msg: "second" },
      ];

      expect(detectLogFormat(arr)).toBe(LogFormat.JSON_ARRAY);
      const results = handleLogEntries(arr, LogFormat.JSON_ARRAY, mockContext);
      expect(results).toHaveLength(2);
      expect(results[0].body).toBe(JSON.stringify(arr[0]));
      expect(results[0].parsedBody).toEqual(arr[0]);
      expect(results[1].body).toBe(JSON.stringify(arr[1]));
      expect(results[1].parsedBody).toEqual(arr[1]);
    });

    it("should handle JSON array with primitives", () => {
      const { detectLogFormat, LogFormat, handleLogEntries } = loadLogModule();
      const arr = ["one", "two", 3];

      expect(detectLogFormat(arr)).toBe(LogFormat.JSON_ARRAY);
      const results = handleLogEntries(arr, LogFormat.JSON_ARRAY, mockContext);
      expect(results).toHaveLength(3);
      expect(results[0].body).toBe("one");
      expect(results[0].parsedBody).toBeNull();
      expect(results[1].body).toBe("two");
      expect(results[1].parsedBody).toBeNull();
      expect(results[2].body).toBe("3");
      expect(results[2].parsedBody).toBeNull();
    });

    it("should handle number primitive", () => {
      const { detectLogFormat, LogFormat, handleLogEntries } = loadLogModule();
      const num = 42;

      expect(detectLogFormat(num)).toBe(LogFormat.STRING);
      const results = handleLogEntries(num, LogFormat.STRING, mockContext);
      expect(results).toHaveLength(1);
      expect(results[0].body).toBe("42");
      expect(results[0].parsedBody).toBeNull();
    });

    it("should handle boolean primitive", () => {
      const { detectLogFormat, LogFormat, handleLogEntries } = loadLogModule();
      const bool = true;

      expect(detectLogFormat(bool)).toBe(LogFormat.STRING);
      const results = handleLogEntries(bool, LogFormat.STRING, mockContext);
      expect(results).toHaveLength(1);
      expect(results[0].body).toBe("true");
      expect(results[0].parsedBody).toBeNull();
    });

    it("should return empty for null", () => {
      const { detectLogFormat, LogFormat, handleLogEntries } = loadLogModule();
      expect(detectLogFormat(null)).toBe(LogFormat.INVALID);
      const results = handleLogEntries(null, LogFormat.INVALID, mockContext);
      expect(results).toHaveLength(0);
      expect(mockContext.log).toHaveBeenCalled();
    });

    it("should return empty for undefined", () => {
      const { detectLogFormat, LogFormat, handleLogEntries } = loadLogModule();
      expect(detectLogFormat(undefined)).toBe(LogFormat.INVALID);
      const results = handleLogEntries(undefined, LogFormat.INVALID, mockContext);
      expect(results).toHaveLength(0);
      expect(mockContext.log).toHaveBeenCalled();
    });

    it("should handle deeply nested object", () => {
      const { detectLogFormat, LogFormat, handleLogEntries } = loadLogModule();
      const nested = {
        level1: { level2: { level3: { level4: { message: "deep", values: [1, 2, 3] } } } },
      };

      expect(detectLogFormat(nested)).toBe(LogFormat.JSON_OBJECT);
      const results = handleLogEntries(nested, LogFormat.JSON_OBJECT, mockContext);
      expect(results).toHaveLength(1);
      expect(results[0].parsedBody.level1.level2.level3.level4.message).toBe("deep");
    });
  });

  describe("Newline splitting behaviour", () => {
    it("should not split if NEWLINE_PATTERN not set", () => {
      const { LogFormat, handleLogEntries } = loadLogModule();
      const input = "line1\nline2\nline3";
      const results = handleLogEntries(input, LogFormat.STRING, mockContext);
      expect(results).toHaveLength(1);
      expect(results[0].body).toBe(input);
    });

    it("should split on simple newline when pattern '\\n'", () => {
      const { LogFormat, handleLogEntries } = loadLogModule({ NEWLINE_PATTERN: "\\n" });
      const input = "a\nb\nc";
      const results = handleLogEntries(input, LogFormat.STRING, mockContext);
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.body)).toEqual(["a", "b", "c"]);
    });

    it("should split on regex CRLF '\\r?\\n'", () => {
      const { LogFormat, handleLogEntries } = loadLogModule({ NEWLINE_PATTERN: "\\r?\\n" });
      const input = "line1\r\nline2\nline3";
      const results = handleLogEntries(input, LogFormat.STRING, mockContext);
      expect(results.map((r) => r.body)).toEqual(["line1", "line2", "line3"]);
    });

    it("should not split if pattern does not match", () => {
      const { LogFormat, handleLogEntries } = loadLogModule({ NEWLINE_PATTERN: "---" });
      const input = "lineX\nlineY";
      const results = handleLogEntries(input, LogFormat.STRING, mockContext);
      expect(results).toHaveLength(1);
      expect(results[0].body).toBe(input);
    });

    it("should trim empty lines after split", () => {
      const { LogFormat, handleLogEntries } = loadLogModule({ NEWLINE_PATTERN: "\\n" });
      const input = "line1\n\nline2\n";
      const results = handleLogEntries(input, LogFormat.STRING, mockContext);
      expect(results.map((r) => r.body)).toEqual(["line1", "line2"]);
    });

    it("should not split JSON logs even if they contain newlines (JSON_STRING)", () => {
      const { LogFormat, handleLogEntries } = loadLogModule({ NEWLINE_PATTERN: "\\n" });
      const jsonString = JSON.stringify({ msg: "a\nb\nc" });
      const results = handleLogEntries(jsonString, LogFormat.JSON_STRING, mockContext);
      expect(results).toHaveLength(1);
      expect(results[0].parsedBody).toEqual({ msg: "a\nb\nc" });
    });

    it("should not split JSON_LOG_OBJECT even with newlines", () => {
      const { LogFormat, handleLogEntries } = loadLogModule({ NEWLINE_PATTERN: "\\n" });
      const obj = { msg: "hello\nworld" };
      const results = handleLogEntries(obj, LogFormat.JSON_OBJECT, mockContext);
      expect(results).toHaveLength(1);
      expect(results[0].parsedBody).toEqual(obj);
    });

    it("should not split JSON_ARRAY logs by newline", () => {
      const { LogFormat, handleLogEntries } = loadLogModule({ NEWLINE_PATTERN: "\\n" });
      const arr = ["a\nb", { test: 123 }];
      const results = handleLogEntries(arr, LogFormat.JSON_ARRAY, mockContext);
      expect(results).toHaveLength(2);
      expect(results[0].body).toBe("a\nb");
      expect(results[1].parsedBody).toEqual({ test: 123 });
    });
  });

  describe("Blocking logic", () => {
    it("should forward when no BLOCKING_PATTERN", () => {
      const { LogFormat, handleLogEntries } = loadLogModule();
      const input = "All good";
      const entries = handleLogEntries(input, LogFormat.STRING, mockContext);
      expect(entries).toHaveLength(1);
      expect(entries[0].body).toBe(input);
    });

    it("should block plain text matching pattern", () => {
      const { LogFormat, handleLogEntries } = loadLogModule({ BLOCKING_PATTERN: "secret" });
      const input = "User entered secret password";
      const entries = handleLogEntries(input, LogFormat.STRING, mockContext);
      expect(entries).toHaveLength(0);
    });

    it("should allow lines not matching pattern", () => {
      const { LogFormat, handleLogEntries } = loadLogModule({
        BLOCKING_PATTERN: "password:\\d{3}",
      });
      const input = "User entered password:12";
      const entries = handleLogEntries(input, LogFormat.STRING, mockContext);
      expect(entries).toHaveLength(1);
      expect(entries[0].body).toBe(input);
    });

    it("should block matching lines after split", () => {
      const { LogFormat, handleLogEntries } = loadLogModule({
        BLOCKING_PATTERN: "IGNORE_ME",
        NEWLINE_PATTERN: "\\n",
      });
      const input = "ok-line-1\nIGNORE_ME line should be removed\nok-line-2";
      const entries = handleLogEntries(input, LogFormat.STRING, mockContext);
      expect(entries.map((r) => r.body)).toEqual(["ok-line-1", "ok-line-2"]);
    });

    it("should block JSON log containing DEBUG", () => {
      const { LogFormat, handleLogEntries } = loadLogModule({
        BLOCKING_PATTERN: "\\[DEBUG\\]",
      });
      const input = { level: "debug", message: "[DEBUG] Loading configuration" };
      const entries = handleLogEntries(input, LogFormat.JSON_OBJECT, mockContext);
      expect(entries).toHaveLength(0);
    });

    it("should allow JSON log not matching pattern", () => {
      const { LogFormat, handleLogEntries } = loadLogModule({
        BLOCKING_PATTERN: "\\[DEBUG\\]",
      });
      const input = { level: "info", message: "[INFO] Application started" };
      const entries = handleLogEntries(input, LogFormat.JSON_OBJECT, mockContext);
      expect(entries).toHaveLength(1);
    });
  });
});
