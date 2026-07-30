import CommonMasking from "Common/Utils/Rum/Masking";
import ConsoleRecorder, {
  CONSOLE_CUSTOM_EVENT_TAG,
  RecordedConsoleEntry,
} from "../src/ConsoleRecorder";

describe("ConsoleRecorder", (): void => {
  let entries: Array<RecordedConsoleEntry> = [];
  let customEvents: Array<{ tag: string; payload: unknown }> = [];
  let recorder: ConsoleRecorder;
  let fakeConsole: Console;
  let written: Array<Array<unknown>> = [];

  beforeEach((): void => {
    entries = [];
    customEvents = [];
    written = [];

    fakeConsole = {
      error: (...args: Array<unknown>): void => {
        written.push(args);
      },
      warn: (...args: Array<unknown>): void => {
        written.push(args);
      },
      log: (): void => {
        written.push(["log"]);
      },
      info: (): void => {
        written.push(["info"]);
      },
    } as unknown as Console;

    recorder = new ConsoleRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        customEvents.push({ tag: tag, payload: payload });
      },
      maskArgument: (value: string): string => {
        return CommonMasking.maskText(value);
      },
      onConsole: (_atUnixMs: number, entry: RecordedConsoleEntry): void => {
        entries.push(entry);
      },
    });

    recorder.start(fakeConsole);
  });

  afterEach((): void => {
    recorder.stop(fakeConsole);
  });

  it("records error and warn", (): void => {
    fakeConsole.error("boom");
    fakeConsole.warn("careful");

    expect(
      entries.map((entry: RecordedConsoleEntry): string => {
        return entry.level;
      }),
    ).toEqual(["error", "warn"]);
    expect(customEvents[0]?.tag).toBe(CONSOLE_CUSTOM_EVENT_TAG);
  });

  /*
   * log/info/debug are the highest-volume text channel on a chatty app and
   * routinely carry whole API responses. Recording them would put more
   * end-user data in the payload than the DOM does.
   */
  it("does not touch log or info", (): void => {
    fakeConsole.log("chatty");
    fakeConsole.info("chatty");

    expect(entries).toHaveLength(0);
  });

  it("still writes to the real console", (): void => {
    fakeConsole.error("boom");

    expect(written).toEqual([["boom"]]);
  });

  it("masks arguments through the text-node transform", (): void => {
    fakeConsole.error("could not save order for alice@example.com");

    expect(entries[0]?.message).not.toContain("alice@example.com");
  });

  /*
   * Never JSON.stringify an argument: that is how a recorder ends up shipping
   * an entire API response, a DOM subtree, or a circular structure that
   * throws.
   */
  it("describes objects without serialising them", (): void => {
    fakeConsole.error({
      password: "hunter2",
      nested: { pan: "4111111111111111" },
    });

    const serialised: string = JSON.stringify(entries);

    expect(serialised).not.toContain("hunter2");
    expect(serialised).not.toContain("4111111111111111");
  });

  it("describes an Error by name and message", (): void => {
    expect(ConsoleRecorder.describe(new TypeError("bad"))).toBe(
      "TypeError: bad",
    );
  });

  it("describes an array by length only", (): void => {
    expect(ConsoleRecorder.describe([1, 2, 3])).toBe("[Array(3)]");
  });

  it("survives a circular structure", (): void => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    expect((): void => {
      fakeConsole.error(circular);
    }).not.toThrow();
  });

  it("caps how many entries it records", (): void => {
    for (let i: number = 0; i < 200; i++) {
      fakeConsole.error("x");
    }

    expect(recorder.getRecordedCount()).toBe(100);
  });

  it("restores the original methods on stop", (): void => {
    const patched: unknown = fakeConsole.error;

    recorder.stop(fakeConsole);

    expect(fakeConsole.error).not.toBe(patched);

    fakeConsole.error("after");

    expect(entries).toHaveLength(0);
  });
});
