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
});
