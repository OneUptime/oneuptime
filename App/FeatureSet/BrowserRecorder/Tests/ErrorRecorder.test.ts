import CommonMasking from "Common/Utils/Rum/Masking";
import ErrorRecorder, {
  ERROR_CUSTOM_EVENT_TAG,
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
