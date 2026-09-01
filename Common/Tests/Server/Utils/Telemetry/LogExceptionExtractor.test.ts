import LogExceptionExtractor, {
  ExtractedLogException,
  LogExceptionExtractorInput,
} from "../../../../Server/Utils/Telemetry/LogExceptionExtractor";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

// OTel severity numbers.
const INFO: number = 9;
const ERROR: number = 17;
const FATAL: number = 21;

function extract(
  overrides: Partial<LogExceptionExtractorInput>,
): ExtractedLogException | null {
  return LogExceptionExtractor.extractFromLogRecord({
    body: "",
    attributes: {},
    severityNumber: ERROR,
    hasTraceAndSpan: false,
    ...overrides,
  });
}

const PYTHON_TRACE: string = [
  "Traceback (most recent call last):",
  '  File "/app/main.py", line 10, in <module>',
  "    foo()",
  '  File "/app/main.py", line 5, in foo',
  '    raise ValueError("bad input")',
  "ValueError: bad input",
].join("\n");

const JS_TRACE: string = [
  "TypeError: Cannot read properties of undefined (reading 'x')",
  "    at Object.<anonymous> (/app/index.js:10:15)",
  "    at Module._compile (node:internal/modules/cjs/loader:1254:14)",
].join("\n");

const NODE_BARE_ERROR_TRACE: string = [
  "Error: connect ECONNREFUSED 127.0.0.1:5432",
  "    at TCPConnectWrap.afterConnect (node:net:1278:16)",
].join("\n");

const JAVA_TRACE: string = [
  'Exception in thread "main" java.lang.NullPointerException: Cannot invoke method',
  "\tat com.example.Foo.bar(Foo.java:10)",
  "\tat com.example.Main.main(Main.java:5)",
].join("\n");

const GO_TRACE: string = [
  "panic: runtime error: invalid memory address or nil pointer dereference",
  "",
  "goroutine 1 [running]:",
  "main.main()",
  "\t/app/main.go:10 +0x20",
].join("\n");

describe("LogExceptionExtractor — Path A (explicit exception.* attributes)", () => {
  test("emits from type + message + stacktrace, even at INFO severity", () => {
    const attributes: JSONObject = {
      "exception.type": "ValueError",
      "exception.message": "bad input",
      "exception.stacktrace": PYTHON_TRACE,
      "exception.escaped": true,
      "other.attr": "kept-elsewhere",
    };

    const result: ExtractedLogException | null = extract({
      attributes,
      severityNumber: INFO,
    });

    expect(result).not.toBeNull();
    /*
     * Fields must equal the inputs verbatim so the fingerprint matches a
     * span-derived exception carrying the same data.
     */
    expect(result!.exceptionType).toBe("ValueError");
    expect(result!.message).toBe("bad input");
    expect(result!.stackTrace).toBe(PYTHON_TRACE);
    expect(result!.escaped).toBe(true);
    expect(JSON.parse(result!.parsedFrames).length).toBeGreaterThan(0);
  });

  test("emits from message alone", () => {
    const result: ExtractedLogException | null = extract({
      attributes: { "exception.message": "something broke" },
      severityNumber: INFO,
    });

    expect(result).not.toBeNull();
    expect(result!.message).toBe("something broke");
    expect(result!.exceptionType).toBe("");
    expect(result!.escaped).toBeNull();
  });

  test("is NOT suppressed when the log has trace + span", () => {
    const result: ExtractedLogException | null = extract({
      attributes: { "exception.stacktrace": JS_TRACE },
      hasTraceAndSpan: true,
    });

    expect(result).not.toBeNull();
    expect(result!.stackTrace).toBe(JS_TRACE);
  });

  test("parses exception.escaped string form", () => {
    const result: ExtractedLogException | null = extract({
      attributes: {
        "exception.message": "x",
        "exception.escaped": "false",
      },
    });

    expect(result!.escaped).toBe(false);
  });
});

describe("LogExceptionExtractor — Path B (raw body scan)", () => {
  test("Python traceback → ValueError + message + frames", () => {
    const result: ExtractedLogException | null = extract({
      body: PYTHON_TRACE,
      severityNumber: ERROR,
    });

    expect(result).not.toBeNull();
    expect(result!.exceptionType).toBe("ValueError");
    expect(result!.message).toBe("bad input");
    expect(JSON.parse(result!.parsedFrames).length).toBeGreaterThanOrEqual(2);
    expect(result!.escaped).toBeNull();
  });

  test("JavaScript stack → TypeError + message", () => {
    const result: ExtractedLogException | null = extract({ body: JS_TRACE });

    expect(result).not.toBeNull();
    expect(result!.exceptionType).toBe("TypeError");
    expect(result!.message).toBe(
      "Cannot read properties of undefined (reading 'x')",
    );
  });

  test("Node bare 'Error:' header → Error + message", () => {
    const result: ExtractedLogException | null = extract({
      body: NODE_BARE_ERROR_TRACE,
    });

    expect(result).not.toBeNull();
    expect(result!.exceptionType).toBe("Error");
    expect(result!.message).toBe("connect ECONNREFUSED 127.0.0.1:5432");
  });

  test("Java stack with thread prefix → fully-qualified type", () => {
    const result: ExtractedLogException | null = extract({
      body: JAVA_TRACE,
      severityNumber: FATAL,
    });

    expect(result).not.toBeNull();
    expect(result!.exceptionType).toBe("java.lang.NullPointerException");
    expect(result!.message).toBe("Cannot invoke method");
  });

  test("Go panic → panic type + message", () => {
    const result: ExtractedLogException | null = extract({ body: GO_TRACE });

    expect(result).not.toBeNull();
    expect(result!.exceptionType).toBe("panic");
    expect(result!.message).toContain("invalid memory address");
  });

  test("below Error severity → null", () => {
    expect(extract({ body: PYTHON_TRACE, severityNumber: INFO })).toBeNull();
  });

  test("suppressed when the log has both trace + span", () => {
    expect(
      extract({ body: JS_TRACE, severityNumber: ERROR, hasTraceAndSpan: true }),
    ).toBeNull();
  });

  test("prose that merely mentions an error (no frames) → null", () => {
    expect(
      extract({
        body: "Got a TypeError somewhere but this is logged as plain prose",
        severityNumber: ERROR,
      }),
    ).toBeNull();
  });

  test("empty / non-stack body → null", () => {
    expect(extract({ body: "service started on port 8080" })).toBeNull();
    expect(extract({ body: "" })).toBeNull();
  });

  test("oversized body is sliced, still extracts, and stored stack is bounded", () => {
    const hugeBody: string = JS_TRACE + "\n" + "x".repeat(500 * 1024);

    const result: ExtractedLogException | null = extract({ body: hugeBody });

    expect(result).not.toBeNull();
    expect(result!.exceptionType).toBe("TypeError");
    // Parsed slice is capped at 16 KB; stored stack trace never exceeds it here.
    expect(result!.stackTrace.length).toBeLessThanOrEqual(16 * 1024);
  });

  test("never throws on malformed input", () => {
    expect(() => {
      return extract({ body: "}{ at :: not a real \u0000 trace :::" });
    }).not.toThrow();
  });
});

const FIREFOX_TRACE: string = [
  "handleSubmit@https://app.example.com/_nuxt/entry.a1b2c3d4.js:1:98217",
  "onClick/<@https://app.example.com/_nuxt/entry.a1b2c3d4.js:1:74102",
  "@https://app.example.com/_nuxt/entry.a1b2c3d4.js:1:2211",
].join("\n");

const SAFARI_TRACE: string = [
  "global code@https://app.example.com/build/main.js:1:1",
  "forEach@[native code]",
].join("\n");

/*
 * Firefox and Safari stacks reach the body path with no `at ` frame and,
 * unless the app happened to log a `*Error`/`*Exception` token, no signature
 * the gate recognised — so they were rejected before StackTraceParser ever
 * ran. The gate now carries an `fn@url:line` alternative, which has to admit
 * every real browser body while still keeping ordinary log prose out: the
 * body path is the one place this change alters INGEST rather than display,
 * and a body that newly yields frames creates a new exception group.
 */
describe("LogExceptionExtractor — Path B (Firefox / Safari bodies)", () => {
  test("a bare Firefox stack with no error header is extracted", () => {
    const result: ExtractedLogException | null = extract({
      body: FIREFOX_TRACE,
      severityNumber: ERROR,
    });

    expect(result).not.toBeNull();
    expect(JSON.parse(result!.parsedFrames)).toHaveLength(3);
  });

  test("a Firefox stack under a typed error header keeps type and message", () => {
    const result: ExtractedLogException | null = extract({
      body: `TypeError: t is undefined\n${FIREFOX_TRACE}`,
      severityNumber: ERROR,
    });

    expect(result).not.toBeNull();
    expect(result!.exceptionType).toBe("TypeError");
    expect(result!.message).toBe("t is undefined");
    expect(JSON.parse(result!.parsedFrames)).toHaveLength(3);
  });

  test("an indented Firefox body still passes the gate", () => {
    const indented: string = FIREFOX_TRACE.split("\n")
      .map((line: string) => {
        return `    ${line}`;
      })
      .join("\n");

    const result: ExtractedLogException | null = extract({
      body: indented,
      severityNumber: ERROR,
    });

    expect(result).not.toBeNull();
    expect(JSON.parse(result!.parsedFrames)).toHaveLength(3);
  });

  test("a Safari body whose only located frame is `global code@` is extracted", () => {
    const result: ExtractedLogException | null = extract({
      body: SAFARI_TRACE,
      severityNumber: ERROR,
    });

    expect(result).not.toBeNull();
    expect(JSON.parse(result!.parsedFrames)).toHaveLength(2);
  });

  test("ordinary ERROR log prose containing an `@` is still not an exception", () => {
    /*
     * The widened gate is only a cheap pre-filter — extractFromBody still
     * requires at least one parsed frame, and none of these produce one.
     */
    const bodies: Array<string> = [
      "failed login for user@example.com:22:1 from 10.0.0.4",
      "cannot clone git@github.com:OneUptime/oneuptime.git",
      "ssh user@host:2222 timed out",
      "pool exhausted for mongodb://svc@db.internal/app:1:1",
    ];

    for (const body of bodies) {
      expect(extract({ body: body, severityNumber: ERROR })).toBeNull();
    }
  });

  test("the severity and trace+span gates still apply to browser bodies", () => {
    expect(extract({ body: FIREFOX_TRACE, severityNumber: INFO })).toBeNull();
    expect(
      extract({
        body: FIREFOX_TRACE,
        severityNumber: ERROR,
        hasTraceAndSpan: true,
      }),
    ).toBeNull();
  });

  test("FATAL severity is covered too", () => {
    expect(
      extract({ body: FIREFOX_TRACE, severityNumber: FATAL }),
    ).not.toBeNull();
  });
});

describe("LogExceptionExtractor — Path A (Firefox / Safari stacktrace attribute)", () => {
  test("exception.stacktrace from Firefox now yields parsed frames", () => {
    /*
     * This is the shape the issue reporter's SDK sends. It already emitted an
     * exception record before the browser parser existed — but with
     * parsedFrames "[]", which is what blocked source-map resolution.
     */
    const result: ExtractedLogException | null = extract({
      attributes: {
        "exception.type": "TypeError",
        "exception.message": "t is undefined",
        "exception.stacktrace": FIREFOX_TRACE,
      },
      severityNumber: ERROR,
    });

    expect(result).not.toBeNull();
    expect(result!.parsedFrames).not.toBe("[]");

    const frames: Array<{ fileName: string; columnNumber?: number }> =
      JSON.parse(result!.parsedFrames);

    expect(frames).toHaveLength(3);
    expect(frames[0]!.fileName).toBe(
      "https://app.example.com/_nuxt/entry.a1b2c3d4.js",
    );
    expect(frames[0]!.columnNumber).toBe(98217);
  });
});
