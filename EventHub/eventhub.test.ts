import {
  detectLogFormat,
  LogFormat,
  handlePlainText,
  handleJsonString,
  handleJsonObject,
  handleJsonArray,
  type LogHandlerResult,
} from "./EventHub/index";

describe("logger parsing", () => {
  it("should detect plain text string", () => {
    const input = "User login succeeded for user: alice";

    expect(detectLogFormat(input)).toBe(LogFormat.STRING);

    const res: LogHandlerResult = handlePlainText(input);

    expect(res.body).toBe(input);
    expect(res.parsedBody).toBeNull();
  });

  it("should detect JSON string and parse JSON object payload", () => {
    const obj = { event: "started", user: "bob" };
    const input = JSON.stringify(obj);

    expect(detectLogFormat(input)).toBe(LogFormat.JSON_STRING);

    const res: LogHandlerResult = handleJsonString(input);

    expect(res.parsedBody).toEqual(obj);
    // body remains original JSON string
    expect(res.body).toBe(input);
  });

  it("should detect and handle a JSON object payload", () => {
    const obj = {
      time: "2025-01-01T00:00:00Z",
      message: "something happened",
      level: "Information",
    };

    expect(detectLogFormat(obj)).toBe(LogFormat.JSON_OBJECT);

    const res: LogHandlerResult = handleJsonObject(obj);

    // body is stringified JSON
    expect(res.body).toBe(JSON.stringify(obj));
    // parsedBody and templateContext.body keep the original object
    expect(res.parsedBody).toEqual(obj);
  });

  it("should detect and handle a JSON array payload (objects)", () => {
    const arr = [
      { id: 1, msg: "first" },
      { id: 2, msg: "second" },
    ];

    expect(detectLogFormat(arr)).toBe(LogFormat.JSON_ARRAY);

    const results: LogHandlerResult[] = handleJsonArray(arr);

    expect(results).toHaveLength(2);

    // Log 1
    expect(results[0].body).toBe(JSON.stringify(arr[0]));
    expect(results[0].parsedBody).toEqual(arr[0]);

    // Log 2
    expect(results[1].body).toBe(JSON.stringify(arr[1]));
    expect(results[1].parsedBody).toEqual(arr[1]);
  });

  it("should handle a JSON array payload with primitives", () => {
    const arr = ["one", "two", 3];

    expect(detectLogFormat(arr)).toBe(LogFormat.JSON_ARRAY);

    const results: LogHandlerResult[] = handleJsonArray(arr as any[]);

    expect(results).toHaveLength(3);

    expect(results[0].body).toBe("one");
    expect(results[0].parsedBody).toBeNull();

    expect(results[1].body).toBe("two");
    expect(results[1].parsedBody).toBeNull();

    expect(results[2].body).toBe("3");
    expect(results[2].parsedBody).toBeNull();
  });

  it("should handle number primitives as STRING", () => {
    const num = 42;

    expect(detectLogFormat(num)).toBe(LogFormat.STRING);

    const res: LogHandlerResult = handlePlainText(num);

    expect(res.body).toBe("42");
    expect(res.parsedBody).toBeNull();
  });

  it("should handle boolean primitives as STRING", () => {
    const bool = true;

    expect(detectLogFormat(bool)).toBe(LogFormat.STRING);

    const res: LogHandlerResult = handlePlainText(bool);

    expect(res.body).toBe("true");
    expect(res.parsedBody).toBeNull();
  });

  // Edge cases - null, undefined, and special types
  it("should detect null as invalid", () => {
    expect(detectLogFormat(null)).toBe(LogFormat.INVALID);
  });

  it("should detect undefined as invalid", () => {
    expect(detectLogFormat(undefined)).toBe(LogFormat.INVALID);
  });

  it("should handle deeply nested objects as JSON_OBJECT", () => {
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

    expect(detectLogFormat(nested)).toBe(LogFormat.JSON_OBJECT);

    const res: LogHandlerResult = handleJsonObject(nested);

    expect(res.body).toBe(JSON.stringify(nested));
    expect(res.parsedBody).toEqual(nested);
    expect(res.parsedBody.level1.level2.level3.level4.message).toBe("deeply nested");
  });

  it("should handle JSON string containing array as JSON_ARRAY", () => {
    const arr = [{ a: 1 }, { b: 2 }];
    const jsonString = JSON.stringify(arr);

    expect(detectLogFormat(jsonString)).toBe(LogFormat.JSON_ARRAY);

    const results: LogHandlerResult[] = handleJsonArray(JSON.parse(jsonString));

    expect(results).toHaveLength(2);
  });
});
