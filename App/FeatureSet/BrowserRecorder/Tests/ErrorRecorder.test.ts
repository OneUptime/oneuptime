import CommonMasking from "Common/Utils/Rum/Masking";
import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import ErrorRecorder, {
  CompiledIgnorePatterns,
  ERROR_CUSTOM_EVENT_TAG,
  MAX_IGNORE_PATTERNS,
  RecordedError,
} from "../src/ErrorRecorder";

describe("ErrorRecorder", (): void => {
  let errors: Array<RecordedError> = [];
  let customEvents: Array<{ tag: string; payload: unknown }> = [];
  let recorder: ErrorRecorder;

  beforeEach((): void => {
    errors = [];
    customEvents = [];

    recorder = new ErrorRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        customEvents.push({ tag: tag, payload: payload });
      },
      maskMessage: (message: string): string => {
        return CommonMasking.maskText(message);
      },

      /* Exactly what Recorder.scrubUrl does, with the default empty allowlist. */
      scrubUrl: (url: string): string => {
        return UrlScrubber.scrub(url, []);
      },
      onError: (_atUnixMs: number, error: RecordedError): void => {
        errors.push(error);
      },
    });

    recorder.start(window);
  });

  afterEach((): void => {
    recorder.stop(window);
  });

  const throwError: (message: string, error?: Error) => void = (
    message: string,
    error?: Error,
  ): void => {
    const event: ErrorEvent = new ErrorEvent("error", {
      message: message,
      filename: "https://shop.example.com/app.js",
      lineno: 42,
      colno: 7,
      ...(error ? { error: error } : {}),
    });

    window.dispatchEvent(event);
  };

  it("records an uncaught error with its source location", (): void => {
    throwError("Cannot read properties of undefined");

    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe("error");
    expect(errors[0]?.source).toBe("https://shop.example.com/app.js");
    expect(errors[0]?.lineNumber).toBe(42);
    expect(errors[0]?.columnNumber).toBe(7);
    expect(customEvents[0]?.tag).toBe(ERROR_CUSTOM_EVENT_TAG);
  });

  /*
   * Error messages routinely quote user data ("could not save order for
   * alice@example.com"), so they go through the same transform as a text node
   * rather than being treated as developer-authored strings.
   */
  it("masks the message", (): void => {
    throwError("could not save order for alice@example.com");

    expect(errors[0]?.message).not.toContain("alice@example.com");
  });

  /*
   * The stack is NOT masked: it is frames and file paths from the customer's
   * own build, which is precisely what makes it useful.
   */
  it("keeps the stack unmasked but truncated", (): void => {
    const error: Error = new Error("boom");
    error.stack = `Error: boom\n    at handler (app.js:1:1)\n${"x".repeat(9000)}`;

    throwError("boom", error);

    expect(errors[0]?.stack).toContain("at handler (app.js:1:1)");
    expect((errors[0]?.stack || "").length).toBeLessThanOrEqual(4000);
  });

  /*
   * For an error thrown from an INLINE script the browser sets
   * ErrorEvent.filename to the document's own URL, query string included. An
   * uncaught error on /reset-password?token=... therefore used to post a live
   * password-reset token in the clear.
   */
  it("scrubs the query string out of the error source", (): void => {
    const event: ErrorEvent = new ErrorEvent("error", {
      message: "boom",
      filename:
        "https://shop.example.com/reset-password?token=s3cr3t-reset-token",
      lineno: 1,
      colno: 1,
    });

    window.dispatchEvent(event);

    expect(errors[0]?.source).toBe("https://shop.example.com/reset-password");
    expect(JSON.stringify(errors)).not.toContain("s3cr3t-reset-token");
    expect(JSON.stringify(customEvents)).not.toContain("s3cr3t-reset-token");
  });

  /* Stack frames carry the same document URL, and the same query string. */
  it("scrubs URLs inside the stack while keeping the frames readable", (): void => {
    const error: Error = new Error("boom");

    error.stack = [
      "Error: boom",
      "    at submit (https://shop.example.com/verify?email=alice@example.com:12:5)",
      "    at handler (https://shop.example.com/static/app.js:1:1)",
    ].join("\n");

    throwError("boom", error);

    const stack: string = errors[0]?.stack || "";

    expect(stack).not.toContain("alice@example.com");
    expect(stack).toContain("at submit (");
    expect(stack).toContain("https://shop.example.com/static/app.js");
  });

  /*
   * The scrub regex is module-scope and global, so its lastIndex must be
   * reset per call - otherwise the second error's stack is scrubbed from
   * wherever the first one left off and leaks everything before that point.
   */
  it("scrubs the second error's stack as thoroughly as the first", (): void => {
    for (let i: number = 0; i < 3; i++) {
      const error: Error = new Error("boom");

      error.stack = `Error: boom\n    at f (https://shop.example.com/p?token=leak-${i})`;

      throwError("boom", error);
    }

    for (const recorded of errors) {
      expect(recorded.stack || "").not.toContain("token=");
    }
  });

  it("records an unhandled rejection", (): void => {
    const event: Event = new Event("unhandledrejection");

    (event as unknown as Record<string, unknown>)["reason"] = new Error(
      "rejected",
    );

    window.dispatchEvent(event);

    expect(errors[0]?.kind).toBe("unhandledrejection");
  });

  /*
   * A rejection reason can be anything, including a rejected fetch carrying a
   * whole response body. Only a short description is taken, never a dump.
   */
  it("never dumps a non-error rejection reason", (): void => {
    const event: Event = new Event("unhandledrejection");

    (event as unknown as Record<string, unknown>)["reason"] = {
      response: { body: "4111111111111111" },
    };

    window.dispatchEvent(event);

    expect(JSON.stringify(errors)).not.toContain("4111111111111111");
  });

  it("caps how many errors it records", (): void => {
    for (let i: number = 0; i < 200; i++) {
      throwError("boom");
    }

    expect(recorder.getRecordedCount()).toBe(100);
  });

  it("stops listening after stop", (): void => {
    recorder.stop(window);

    throwError("boom");

    expect(errors).toHaveLength(0);
  });
});

/*
 * The trigger-worthiness decision. One chronically-throwing third-party
 * tag used to convert error-triggered capture into always-on upload;
 * these tests pin the two escape valves — the automatic stackless
 * cross-origin "Script error." suppression and the config-driven ignore
 * patterns — while asserting the error is still RECORDED either way.
 */
describe("ErrorRecorder trigger-worthiness", (): void => {
  interface ObservedError {
    atUnixMs: number;
    error: RecordedError;
    isTriggerWorthy: boolean;
  }

  let observed: Array<ObservedError>;
  let emitted: Array<{ tag: string; payload: unknown }>;

  const makeRecorder: (ignorePatterns?: Array<RegExp>) => ErrorRecorder = (
    ignorePatterns?: Array<RegExp>,
  ): ErrorRecorder => {
    observed = [];
    emitted = [];

    return new ErrorRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        emitted.push({ tag: tag, payload: payload });
      },
      maskMessage: (message: string): string => {
        /* A visible transform, so raw-vs-masked matching is testable. */
        return `masked:${message}`;
      },
      scrubUrl: (url: string): string => {
        return url;
      },
      onError: (
        atUnixMs: number,
        error: RecordedError,
        isTriggerWorthy: boolean,
      ): void => {
        observed.push({
          atUnixMs: atUnixMs,
          error: error,
          isTriggerWorthy: isTriggerWorthy,
        });
      },
      ...(ignorePatterns ? { ignorePatterns: ignorePatterns } : {}),
    });
  };

  const fire: (recorder: ErrorRecorder, init: ErrorEventInit) => void = (
    recorder: ErrorRecorder,
    init: ErrorEventInit,
  ): void => {
    recorder.start(window);
    window.dispatchEvent(new ErrorEvent("error", init));
    recorder.stop(window);
  };

  it("stackless, sourceless 'Script error.' is recorded but not trigger-worthy", (): void => {
    const recorder: ErrorRecorder = makeRecorder();

    fire(recorder, { message: "Script error." });

    expect(observed).toHaveLength(1);
    expect(observed[0]!.isTriggerWorthy).toBe(false);
    /* Still recorded: the custom event went into the stream. */
    expect(emitted).toHaveLength(1);
    expect(recorder.getRecordedCount()).toBe(1);
  });

  it("the period-less and case variants are equally unactionable", (): void => {
    const recorder: ErrorRecorder = makeRecorder();

    fire(recorder, { message: "script error" });

    expect(observed[0]!.isTriggerWorthy).toBe(false);
  });

  it("'Script error.' WITH a source is a real, trigger-worthy error", (): void => {
    const recorder: ErrorRecorder = makeRecorder();

    fire(recorder, {
      message: "Script error.",
      filename: "https://app.example.com/main.js",
    });

    expect(observed[0]!.isTriggerWorthy).toBe(true);
  });

  it("an ignore pattern matching the message suppresses the trigger, not the record", (): void => {
    const recorder: ErrorRecorder = makeRecorder([
      new RegExp("ResizeObserver loop", "i"),
    ]);

    fire(recorder, {
      message: "resizeobserver LOOP limit exceeded",
      filename: "https://app.example.com/main.js",
    });

    expect(observed[0]!.isTriggerWorthy).toBe(false);
    expect(emitted).toHaveLength(1);
  });

  it("an ignore pattern matching the SOURCE quiets a whole third-party tag", (): void => {
    const recorder: ErrorRecorder = makeRecorder([
      new RegExp("third-party-tag\\.js", "i"),
    ]);

    fire(recorder, {
      message: "Cannot read properties of undefined",
      filename: "https://cdn.example.net/third-party-tag.js",
    });

    expect(observed[0]!.isTriggerWorthy).toBe(false);
  });

  it("matches against the RAW message, before masking rewrites it", (): void => {
    const recorder: ErrorRecorder = makeRecorder([new RegExp("^exact match$")]);

    fire(recorder, {
      message: "exact match",
      filename: "https://app.example.com/main.js",
    });

    /* maskMessage prefixed the stored message; the raw one matched. */
    expect(observed[0]!.error.message).toBe("masked:exact match");
    expect(observed[0]!.isTriggerWorthy).toBe(false);
  });

  it("a non-matching error stays trigger-worthy", (): void => {
    const recorder: ErrorRecorder = makeRecorder([new RegExp("quiet-me")]);

    fire(recorder, {
      message: "genuine failure",
      filename: "https://app.example.com/main.js",
    });

    expect(observed[0]!.isTriggerWorthy).toBe(true);
  });

  it("record() replays a buffered error with its ORIGINAL time on the payload", (): void => {
    const recorder: ErrorRecorder = makeRecorder();
    const occurredAt: number = 1_700_000_000_123;

    recorder.record(
      { kind: "error", message: "boom during startup" },
      occurredAt,
    );

    expect(observed).toHaveLength(1);
    expect(observed[0]!.atUnixMs).toBe(occurredAt);
    expect(observed[0]!.isTriggerWorthy).toBe(true);
    expect(
      (emitted[0]!.payload as Record<string, unknown>)["occurredAtUnixMs"],
    ).toBe(occurredAt);
  });
});

describe("ErrorRecorder.compileIgnorePatterns", (): void => {
  it("compiles valid patterns case-insensitively", (): void => {
    const compiled: CompiledIgnorePatterns =
      ErrorRecorder.compileIgnorePatterns(["ResizeObserver"]);

    expect(compiled.patterns).toHaveLength(1);
    expect(compiled.discardedCount).toBe(0);
    expect(compiled.patterns[0]!.test("resizeobserver loop")).toBe(true);
  });

  it("discards an invalid regex and counts it, instead of throwing", (): void => {
    const compiled: CompiledIgnorePatterns =
      ErrorRecorder.compileIgnorePatterns(["([unclosed", "valid"]);

    expect(compiled.patterns).toHaveLength(1);
    expect(compiled.discardedCount).toBe(1);
  });

  it("caps the pattern count and reports the overflow as discarded", (): void => {
    const many: Array<string> = Array.from(
      { length: MAX_IGNORE_PATTERNS + 5 },
      (_unused: unknown, index: number): string => {
        return `pattern-${index}`;
      },
    );

    const compiled: CompiledIgnorePatterns =
      ErrorRecorder.compileIgnorePatterns(many);

    expect(compiled.patterns).toHaveLength(MAX_IGNORE_PATTERNS);
    expect(compiled.discardedCount).toBe(5);
  });

  it("discards an over-length pattern — remote config must not hand the page a ReDoS", (): void => {
    const compiled: CompiledIgnorePatterns =
      ErrorRecorder.compileIgnorePatterns(["a".repeat(500)]);

    expect(compiled.patterns).toHaveLength(0);
    expect(compiled.discardedCount).toBe(1);
  });
});
