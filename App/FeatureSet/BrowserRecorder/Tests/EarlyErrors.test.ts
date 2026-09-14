import {
  EarlyErrorBuffer,
  EarlyErrorRecord,
  MAX_EARLY_ERRORS,
  installEarlyErrorBuffer,
} from "../src/EarlyErrors";

/*
 * The loader stub's pre-load buffer. It exists to catch THE startup
 * crash — the most valuable failure class an error-triggered recorder
 * has — during the config round trip and artifact download, and to
 * guarantee that nothing it caught survives a privacy or policy gate
 * saying no.
 */
describe("EarlyErrors", (): void => {
  const fireError: (message: string, filename?: string) => void = (
    message: string,
    filename?: string,
  ): void => {
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: message,
        ...(filename ? { filename: filename } : {}),
        lineno: 12,
        colno: 3,
      }),
    );
  };

  it("captures errors fired between install and drain, with their time", (): void => {
    const buffer: EarlyErrorBuffer = installEarlyErrorBuffer(window);

    fireError("boom during startup", "https://app.example.com/main.js");

    const records: Array<EarlyErrorRecord> = buffer.drain();

    expect(records).toHaveLength(1);
    expect(records[0]!.kind).toBe("error");
    expect(records[0]!.message).toBe("boom during startup");
    expect(records[0]!.source).toBe("https://app.example.com/main.js");
    expect(records[0]!.lineNumber).toBe(12);
    expect(records[0]!.atUnixMs).toBeGreaterThan(0);
  });

  /*
   * A capture-phase "error" listener also hears RESOURCE load failures - an
   * <img>, <script> or <link> that 404s. They arrive with an Element target,
   * no message, no filename and no Error, so buffering them as JavaScript
   * errors filled the pre-load buffer with empty entries on any page with a
   * broken image, and spent its 20-record budget on them.
   */
  it("ignores a resource load failure, which is not a JavaScript error", (): void => {
    const buffer: EarlyErrorBuffer = installEarlyErrorBuffer(window);

    const image: HTMLImageElement = document.createElement("img");

    document.body.appendChild(image);

    const resourceFailure: Event = new Event("error");

    Object.defineProperty(resourceFailure, "target", { value: image });
    window.dispatchEvent(resourceFailure);

    fireError("a real one", "https://app.example.com/main.js");

    const records: Array<EarlyErrorRecord> = buffer.drain();

    expect(records).toHaveLength(1);
    expect(records[0]!.message).toBe("a real one");
  });

  it("captures unhandled rejections with a described reason, never a dump", (): void => {
    const buffer: EarlyErrorBuffer = installEarlyErrorBuffer(window);

    const event: Event = new Event("unhandledrejection");
    (event as unknown as Record<string, unknown>)["reason"] = {
      message: "rejected at startup",
      response: { body: "4111111111111111" },
    };
    window.dispatchEvent(event);

    const records: Array<EarlyErrorRecord> = buffer.drain();

    expect(records).toHaveLength(1);
    expect(records[0]!.kind).toBe("unhandledrejection");
    expect(records[0]!.message).toBe("rejected at startup");
    expect(JSON.stringify(records)).not.toContain("4111111111111111");
  });

  it("stops listening after drain — the artifact's ErrorRecorder takes over", (): void => {
    const buffer: EarlyErrorBuffer = installEarlyErrorBuffer(window);

    expect(buffer.drain()).toHaveLength(0);

    fireError("after drain");

    expect(buffer.drain()).toHaveLength(0);
  });

  it("discard forgets everything and stops listening", (): void => {
    const buffer: EarlyErrorBuffer = installEarlyErrorBuffer(window);

    fireError("before the gate said no");
    buffer.discard();
    fireError("after the gate said no");

    expect(buffer.drain()).toHaveLength(0);
  });

  it("caps the buffer instead of archiving a throw loop", (): void => {
    const buffer: EarlyErrorBuffer = installEarlyErrorBuffer(window);

    for (let index: number = 0; index < MAX_EARLY_ERRORS + 30; index++) {
      fireError(`boom ${index}`);
    }

    expect(buffer.drain()).toHaveLength(MAX_EARLY_ERRORS);
  });

  it("bounds message and stack size at capture", (): void => {
    const buffer: EarlyErrorBuffer = installEarlyErrorBuffer(window);

    const error: Error = new Error("boom");
    error.stack = "x".repeat(9000);

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "m".repeat(5000),
        error: error,
      }),
    );

    const records: Array<EarlyErrorRecord> = buffer.drain();

    expect(records[0]!.message.length).toBeLessThanOrEqual(1000);
    expect((records[0]!.stack || "").length).toBeLessThanOrEqual(4000);
  });
});
