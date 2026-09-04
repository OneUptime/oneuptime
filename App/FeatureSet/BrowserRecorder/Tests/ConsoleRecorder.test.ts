import CommonMasking from "Common/Utils/Rum/Masking";
import ConsoleRecorder, {
  CONSOLE_CUSTOM_EVENT_TAG,
  MAX_CONSOLE_RECORDED,
  RecordedConsoleEntry,
} from "../src/ConsoleRecorder";
import { LOG_PREFIX } from "../src/Debug";

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
   * Objects are serialised SHALLOWLY, and the result goes through the same
   * masking transform as every other argument - so under MaskAllText an
   * object argument is as masked as a string one. Keys that look sensitive
   * are redacted in every mode, before masking gets a say.
   */
  it("serialises objects shallowly, through the masking transform", (): void => {
    fakeConsole.error({
      password: "hunter2",
      nested: { pan: "4111111111111111" },
    });

    const serialised: string = JSON.stringify(entries);

    expect(serialised).not.toContain("hunter2");
    expect(serialised).not.toContain("4111111111111111");
  });

  it("describes a plain object two levels deep with sensitive keys redacted", (): void => {
    expect(
      ConsoleRecorder.describe({
        status: 500,
        body: { error: "boom", password: "hunter2", deeper: { a: 1 } },
        authorization: "Bearer xyz",
        list: [1, "two", { three: 3 }],
      }),
    ).toBe(
      '{status: 500, body: {error: "boom", password: [redacted], deeper: [Object]}, authorization: [redacted], list: [1, "two", [Object]]}',
    );
  });

  it("caps the key count, string length and total length of a description", (): void => {
    const wide: Record<string, unknown> = {};

    for (let index: number = 0; index < 40; index++) {
      wide[`k${index}`] = "x".repeat(200);
    }

    const described: string = ConsoleRecorder.describe(wide);

    expect(described.length).toBeLessThanOrEqual(512);
    expect(described).not.toContain("x".repeat(65));
  });

  it("names DOM nodes and platform objects instead of walking them", (): void => {
    const div: HTMLDivElement = document.createElement("div");
    div.textContent = "alice@example.com";

    expect(ConsoleRecorder.describe(div)).toBe("[DIV]");
    expect(ConsoleRecorder.describe({ el: div })).toBe("{el: [DIV]}");
    expect(ConsoleRecorder.describe(new Map([["k", "v"]]))).toBe("[Map(1)]");
    expect(ConsoleRecorder.describe(new Date(0))).toBe(
      "1970-01-01T00:00:00.000Z",
    );
    expect(ConsoleRecorder.describe(new (class Thing {})())).toBe("[Thing]");
  });

  it("describes an Error by name and message", (): void => {
    expect(ConsoleRecorder.describe(new TypeError("bad"))).toBe(
      "TypeError: bad",
    );
  });

  it("describes an array by its first items, and a deep one by length only", (): void => {
    expect(ConsoleRecorder.describe([1, 2, 3])).toBe("[1, 2, 3]");
    expect(ConsoleRecorder.describe({ a: { b: [1, 2] } })).toBe(
      "{a: {b: [Array(2)]}}",
    );
  });

  it("marks a circular reference instead of throwing or recursing", (): void => {
    const circular: Record<string, unknown> = { name: "root" };
    circular["self"] = circular;

    expect(ConsoleRecorder.describe(circular)).toBe(
      '{name: "root", self: [Circular]}',
    );
  });

  /*
   * The recorder's own diagnostics go through the patched console.warn like
   * everything else on the page. Recording them put OneUptime's log lines
   * into the customer's replay and spent the console cap on them.
   */
  it("never records the recorder's own diagnostics, and they cost nothing against the cap", (): void => {
    fakeConsole.warn(`${LOG_PREFIX} chunk-accepted: Chunk accepted.`, {
      chunkIndex: 1,
    });
    fakeConsole.warn(`${LOG_PREFIX} transport-disabled: Uploading stopped.`);

    expect(entries).toHaveLength(0);
    expect(recorder.getRecordedCount()).toBe(0);

    /* Still printed for the person who turned diagnostics on. */
    expect(written).toHaveLength(2);
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

    expect(recorder.getRecordedCount()).toBe(MAX_CONSOLE_RECORDED);
  });

  /*
   * The cap used to exhaust silently: the Console tab simply ended, and a
   * viewer had no way to tell "the page went quiet" from "we stopped
   * listening". One marker entry, once, says which.
   */
  it("emits one cap marker when the cap is hit, and reports it once", (): void => {
    const capReports: Array<number> = [];

    recorder.stop(fakeConsole);
    recorder = new ConsoleRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        customEvents.push({ tag: tag, payload: payload });
      },
      maskArgument: (value: string): string => {
        return value;
      },
      onConsole: (_atUnixMs: number, entry: RecordedConsoleEntry): void => {
        entries.push(entry);
      },
      onCapReached: (cap: number): void => {
        capReports.push(cap);
      },
    });
    recorder.start(fakeConsole);

    for (let i: number = 0; i < MAX_CONSOLE_RECORDED + 20; i++) {
      fakeConsole.error("x");
    }

    const markers: Array<RecordedConsoleEntry> = entries.filter(
      (entry: RecordedConsoleEntry): boolean => {
        return entry.isCapMarker === true;
      },
    );

    expect(entries).toHaveLength(MAX_CONSOLE_RECORDED + 1);
    expect(markers).toHaveLength(1);
    expect(markers[0]?.level).toBe("warn");
    expect(markers[0]?.message).toContain(`${MAX_CONSOLE_RECORDED} entries`);
    expect(capReports).toEqual([MAX_CONSOLE_RECORDED]);
    expect(recorder.hasReachedCap()).toBe(true);
    expect(recorder.getRecordedCount()).toBe(MAX_CONSOLE_RECORDED);
  });

  /*
   * The cap is per SESSION. A long-lived tab that rolls over after idle
   * starts a new session whose Console tab used to be empty forever
   * because the cap was burned hours earlier.
   */
  it("starts a fresh cap when the session rotates", (): void => {
    for (let i: number = 0; i < MAX_CONSOLE_RECORDED + 5; i++) {
      fakeConsole.error("x");
    }

    expect(recorder.hasReachedCap()).toBe(true);

    recorder.resetForNewSession();

    expect(recorder.getRecordedCount()).toBe(0);
    expect(recorder.hasReachedCap()).toBe(false);

    const before: number = entries.length;

    fakeConsole.error("after rotation");

    expect(entries).toHaveLength(before + 1);
    expect(entries[entries.length - 1]?.isCapMarker).toBeUndefined();
  });

  it("restores the original methods on stop", (): void => {
    const patched: unknown = fakeConsole.error;

    recorder.stop(fakeConsole);

    expect(fakeConsole.error).not.toBe(patched);

    fakeConsole.error("after");

    expect(entries).toHaveLength(0);
  });
});
