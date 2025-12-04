import { detectLogFormat, LogFormat, handleLogEntries } from "../EventHub/index";
import { InvocationContext } from "@azure/functions";

// Mock context for testing
const mockContext = {
  log: jest.fn(),
} as unknown as InvocationContext;

describe("log processing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should detect and handle plain text string", () => {
    const input = "User login succeeded for user: alice";

    const format = detectLogFormat(input);
    expect(format).toBe(LogFormat.STRING);

    const results = handleLogEntries(input, format, mockContext);
    expect(results).toHaveLength(1);
    expect(results[0].body).toBe(input);
    expect(results[0].parsedBody).toBeNull();
  });

  it("should detect and handle JSON string containing object", () => {
    const obj = { event: "started", user: "bob" };
    const input = JSON.stringify(obj);

    const format = detectLogFormat(input);
    expect(format).toBe(LogFormat.JSON_STRING);

    const results = handleLogEntries(input, format, mockContext);
    expect(results).toHaveLength(1);
    expect(results[0].body).toBe(input);
    expect(results[0].parsedBody).toEqual(obj);
  });

  it("should detect and handle JSON object", () => {
    const obj = {
      time: "2025-01-01T00:00:00Z",
      message: "something happened",
      level: "Information",
    };

    const format = detectLogFormat(obj);
    expect(format).toBe(LogFormat.JSON_OBJECT);

    const results = handleLogEntries(obj, format, mockContext);
    expect(results).toHaveLength(1);
    expect(results[0].body).toBe(JSON.stringify(obj));
    expect(results[0].parsedBody).toEqual(obj);
  });

  it("should detect and handle JSON array with objects", () => {
    const arr = [
      { id: 1, msg: "first" },
      { id: 2, msg: "second" },
    ];

    const format = detectLogFormat(arr);
    expect(format).toBe(LogFormat.JSON_ARRAY);

    const results = handleLogEntries(arr, format, mockContext);
    expect(results).toHaveLength(2);
    expect(results[0].body).toBe(JSON.stringify(arr[0]));
    expect(results[0].parsedBody).toEqual(arr[0]);
    expect(results[1].body).toBe(JSON.stringify(arr[1]));
    expect(results[1].parsedBody).toEqual(arr[1]);
  });

  it("should detect and handle JSON array with primitives", () => {
    const arr = ["one", "two", 3];

    const format = detectLogFormat(arr);
    expect(format).toBe(LogFormat.JSON_ARRAY);

    const results = handleLogEntries(arr, format, mockContext);
    expect(results).toHaveLength(3);
    expect(results[0].body).toBe("one");
    expect(results[0].parsedBody).toBeNull();
    expect(results[1].body).toBe("two");
    expect(results[1].parsedBody).toBeNull();
    expect(results[2].body).toBe("3");
    expect(results[2].parsedBody).toBeNull();
  });

  it("should detect and handle JSON string containing array", () => {
    const arr = [{ a: 1 }, { b: 2 }];
    const jsonString = JSON.stringify(arr);

    const format = detectLogFormat(jsonString);
    expect(format).toBe(LogFormat.JSON_ARRAY);

    const results = handleLogEntries(jsonString, format, mockContext);
    expect(results).toHaveLength(2);
    expect(results[0].parsedBody).toEqual({ a: 1 });
    expect(results[1].parsedBody).toEqual({ b: 2 });
  });

  it("should detect and handle number primitives", () => {
    const num = 42;

    const format = detectLogFormat(num);
    expect(format).toBe(LogFormat.STRING);

    const results = handleLogEntries(num, format, mockContext);
    expect(results).toHaveLength(1);
    expect(results[0].body).toBe("42");
    expect(results[0].parsedBody).toBeNull();
  });

  it("should detect and handle boolean primitives", () => {
    const bool = true;

    const format = detectLogFormat(bool);
    expect(format).toBe(LogFormat.STRING);

    const results = handleLogEntries(bool, format, mockContext);
    expect(results).toHaveLength(1);
    expect(results[0].body).toBe("true");
    expect(results[0].parsedBody).toBeNull();
  });

  it("should detect null as INVALID and return empty results", () => {
    const format = detectLogFormat(null);
    expect(format).toBe(LogFormat.INVALID);

    const results = handleLogEntries(null, format, mockContext);
    expect(results).toHaveLength(0);
    expect(mockContext.log).toHaveBeenCalled();
  });

  it("should detect undefined as INVALID and return empty results", () => {
    const format = detectLogFormat(undefined);
    expect(format).toBe(LogFormat.INVALID);

    const results = handleLogEntries(undefined, format, mockContext);
    expect(results).toHaveLength(0);
    expect(mockContext.log).toHaveBeenCalled();
  });

  it("should detect and handle deeply nested objects", () => {
    const nested = {
      level1: {
        level2: {
          level3: {
            level4: {
              message: "deeply nested",
              values: [1, 2, 3],
            },
          },
        },
      },
    };

    const format = detectLogFormat(nested);
    expect(format).toBe(LogFormat.JSON_OBJECT);

    const results = handleLogEntries(nested, format, mockContext);
    expect(results).toHaveLength(1);
    expect(results[0].body).toBe(JSON.stringify(nested));
    expect(results[0].parsedBody).toEqual(nested);
    expect(results[0].parsedBody.level1.level2.level3.level4.message).toBe("deeply nested");
  });
});
