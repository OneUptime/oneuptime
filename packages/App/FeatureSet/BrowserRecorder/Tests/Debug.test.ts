import {
  DEBUG_STORAGE_KEY,
  DebugRecord,
  MAX_DEBUG_RECORDS,
  MAX_DEBUG_VALUE_LENGTH,
  clearDebugRecords,
  debugLog,
  debugWarn,
  getDebugRecords,
  getDebugSource,
  isDebugEnabled,
  setEnabled,
} from "../src/Debug";
import ConsoleRecorder, { RecordedConsoleEntry } from "../src/ConsoleRecorder";

/*
 * The diagnostics module.
 *
 * Two properties matter more than any individual log line, and both are
 * asserted here rather than left to review:
 *
 * 1. It is OFF unless somebody asked. This code runs on a customer's site in
 *    THEIR end users' browsers; printing there unasked is noise on somebody
 *    else's property, and a recorder that chatters is one a customer removes.
 *
 * 2. It cannot carry page content. `DebugDetail` admits only primitives at
 *    the type level, but the API is reachable from untyped JavaScript on a
 *    global, so the runtime has to refuse a DOM node too. A diagnostics
 *    channel that could print a password field would be a second, unmasked
 *    egress path for exactly the data this package exists to protect.
 */

const STATE_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY_DEBUG__";

type GlobalRecord = Record<string, unknown>;

function globalRecord(): GlobalRecord {
  return globalThis as unknown as GlobalRecord;
}

/*
 * The state lives on a global so the two bundles share one timeline, which
 * means it also survives between test cases. Every case starts from nothing.
 */
function resetDebugState(): void {
  delete globalRecord()[STATE_GLOBAL];
}

/*
 * jsdom treats an assignment to window.location as a navigation, and its
 * Location properties are not configurable - so the query string is changed
 * the way a real page would change it.
 */
function setUrl(relative: string): void {
  window.history.replaceState({}, "", relative);
}

interface ConsoleSpies {
  info: jest.Mock;
  warn: jest.Mock;
}

function spyOnConsole(): ConsoleSpies {
  const spies: ConsoleSpies = {
    info: jest.fn(),
    warn: jest.fn(),
  };

  jest
    .spyOn(console, "info")
    .mockImplementation((...args: Array<unknown>): void => {
      spies.info(...args);
    });

  jest
    .spyOn(console, "warn")
    .mockImplementation((...args: Array<unknown>): void => {
      spies.warn(...args);
    });

  return spies;
}

function allConsoleText(spies: ConsoleSpies): string {
  return [...spies.info.mock.calls, ...spies.warn.mock.calls]
    .map((call: Array<unknown>): string => {
      return call
        .map((argument: unknown): string => {
          return typeof argument === "string"
            ? argument
            : JSON.stringify(argument);
        })
        .join(" ");
    })
    .join("\n");
}

describe("Debug", (): void => {
  let spies: ConsoleSpies;

  beforeEach((): void => {
    resetDebugState();

    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* jsdom always has both; a hostile environment is tested separately. */
    }

    delete globalRecord()["__ONEUPTIME_SESSION_REPLAY__"];

    spies = spyOnConsole();
  });

  afterEach((): void => {
    jest.restoreAllMocks();
    resetDebugState();
    setUrl("/checkout");
  });

  describe("the switch", (): void => {
    it("is off by default, and prints nothing", (): void => {
      expect(isDebugEnabled()).toBe(false);

      debugLog("something", "A thing happened.");
      debugWarn("something-else", "A worse thing happened.");

      expect(spies.info).not.toHaveBeenCalled();
      expect(spies.warn).not.toHaveBeenCalled();
    });

    it("turns on from localStorage", (): void => {
      window.localStorage.setItem(DEBUG_STORAGE_KEY, "true");

      expect(isDebugEnabled()).toBe(true);
      expect(getDebugSource()).toBe("local-storage");
    });

    it("turns on from sessionStorage", (): void => {
      window.sessionStorage.setItem(DEBUG_STORAGE_KEY, "1");

      expect(isDebugEnabled()).toBe(true);
      expect(getDebugSource()).toBe("session-storage");
    });

    it("accepts the truthy spellings a human would actually type", (): void => {
      for (const value of ["true", "TRUE", "1", "yes", "on"]) {
        resetDebugState();
        window.localStorage.setItem(DEBUG_STORAGE_KEY, value);

        expect(isDebugEnabled()).toBe(true);
      }
    });

    it("stays off for a falsy stored value", (): void => {
      for (const value of ["false", "0", "off", "", "maybe"]) {
        resetDebugState();
        window.localStorage.setItem(DEBUG_STORAGE_KEY, value);

        expect(isDebugEnabled()).toBe(false);
      }
    });

    /*
     * The switch a support engineer can send in a link. It has to work
     * without asking the customer to open a console at all, which is what
     * makes it the one to reach for with a non-technical reporter.
     *
     * Driven through history.replaceState rather than by assigning
     * globalThis.location, which jsdom treats as a navigation.
     */
    it("turns on from a query parameter", (): void => {
      setUrl("?a=1&oneuptime_debug=1");

      expect(isDebugEnabled()).toBe(true);
      expect(getDebugSource()).toBe("query-param");
    });

    it("turns on from a bare query parameter and from the fragment", (): void => {
      for (const url of ["?oneuptime_debug", "#oneuptime_debug=true"]) {
        resetDebugState();
        setUrl(url);

        expect(isDebugEnabled()).toBe(true);
      }
    });

    /*
     * `?oneuptime_debug=0` must not enable it, so a link that turns it OFF
     * reads the way anyone would expect.
     */
    it("does not turn on for an explicitly falsy query parameter", (): void => {
      setUrl("?oneuptime_debug=0");

      expect(isDebugEnabled()).toBe(false);
    });

    it("does not turn on for a parameter that merely contains the name", (): void => {
      setUrl("?not_oneuptime_debugging=1");

      expect(isDebugEnabled()).toBe(false);
    });

    it("turns on from the init global before any script tag is read", (): void => {
      globalRecord()["__ONEUPTIME_SESSION_REPLAY__"] = {
        host: "https://oneuptime.com",
        token: "t",
        appIdentifier: "a",
        debug: true,
      };

      expect(isDebugEnabled()).toBe(true);
      expect(getDebugSource()).toBe("init-global");
    });

    it("can be turned on and off explicitly", (): void => {
      setEnabled(true, "api");
      expect(isDebugEnabled()).toBe(true);
      expect(getDebugSource()).toBe("api");

      setEnabled(false, "api");
      expect(isDebugEnabled()).toBe(false);
    });

    /*
     * An explicit call must beat the ambient switches in BOTH directions;
     * otherwise setDebug(false) would be undone by the first lazy resolve.
     */
    it("keeps an explicit off even when a storage switch is set", (): void => {
      window.localStorage.setItem(DEBUG_STORAGE_KEY, "true");

      setEnabled(false, "api");

      expect(isDebugEnabled()).toBe(false);
    });

    /*
     * THE accessor case, and the one that matters most.
     *
     * `window.localStorage` throws SecurityError on the PROPERTY READ - not
     * on getItem - in an <iframe sandbox> without allow-same-origin and
     * wherever the user has blocked site data for the origin. Guarding only
     * getItem is therefore not enough, and getting this wrong is not a
     * missing log line: `debugLog("loader-start", ...)` is the first
     * statement of Loader.load(), so a throw here rejects load() before the
     * init options are even read, the top-level catch swallows it, and
     * session replay dies on that page with no recording, no request and no
     * output. That is precisely the failure this whole module exists to end,
     * reintroduced at the top of the loader.
     */
    it("survives a storage property accessor that throws", (): void => {
      const original: PropertyDescriptor | undefined =
        Object.getOwnPropertyDescriptor(globalThis, "localStorage");

      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get: (): never => {
          throw new Error("SecurityError");
        },
      });

      try {
        expect((): boolean => {
          return isDebugEnabled();
        }).not.toThrow();

        expect(isDebugEnabled()).toBe(false);

        /* And the records still work, which is what the loader relies on. */
        expect((): void => {
          debugLog("loader-start", "Loader running.");
        }).not.toThrow();

        expect(getDebugRecords()).toHaveLength(1);
      } finally {
        if (original) {
          Object.defineProperty(globalThis, "localStorage", original);
        } else {
          delete (globalThis as unknown as Record<string, unknown>)[
            "localStorage"
          ];
        }
      }
    });

    /*
     * A page that froze globalThis makes the state assignment throw in
     * strict mode. Losing the shared timeline is acceptable; throwing out of
     * the loader's first statement is not.
     */
    it("survives a global object it cannot write to", (): void => {
      const record: Record<string, unknown> = globalRecord();
      const original: PropertyDescriptor | undefined =
        Object.getOwnPropertyDescriptor(record, STATE_GLOBAL);

      Object.defineProperty(record, STATE_GLOBAL, {
        configurable: true,
        get: (): undefined => {
          return undefined;
        },
        set: (): never => {
          throw new TypeError("Cannot add property, object is not extensible");
        },
      });

      try {
        expect((): void => {
          debugLog("loader-start", "Loader running.");
        }).not.toThrow();
      } finally {
        delete record[STATE_GLOBAL];

        if (original) {
          Object.defineProperty(record, STATE_GLOBAL, original);
        }
      }
    });

    /*
     * getItem throws separately from the accessor - Safari private mode, and
     * anywhere site data is blocked after the accessor itself succeeds.
     */
    it("survives a storage getItem that throws", (): void => {
      jest
        .spyOn(Object.getPrototypeOf(window.localStorage) as Storage, "getItem")
        .mockImplementation((): never => {
          throw new Error("SecurityError");
        });

      expect((): boolean => {
        return isDebugEnabled();
      }).not.toThrow();

      expect(isDebugEnabled()).toBe(false);
    });

    it("survives a state global some other script parked a string on", (): void => {
      globalRecord()[STATE_GLOBAL] = "hijacked";

      expect((): void => {
        debugLog("code", "message");
      }).not.toThrow();

      expect(getDebugRecords()).toHaveLength(1);
    });
  });

  describe("records", (): void => {
    /*
     * The point of keeping records while switched off: a support engineer
     * can ask for getDiagnostics() on a page nobody had instrumented, and
     * get the whole timeline back without a reload.
     */
    it("are kept even when logging is off", (): void => {
      debugLog("first", "one");
      debugWarn("second", "two");

      const records: Array<DebugRecord> = getDebugRecords();

      expect(
        records.map((r: DebugRecord): string => {
          return r.code;
        }),
      ).toEqual(["first", "second"]);
      expect(records[0]?.level).toBe("info");
      expect(records[1]?.level).toBe("warn");
      expect(spies.info).not.toHaveBeenCalled();
    });

    it("carry a timestamp and the detail supplied", (): void => {
      debugLog("code", "message", {
        status: 404,
        url: "https://x.example.com",
      });

      const record: DebugRecord | undefined = getDebugRecords()[0];

      expect(typeof record?.atUnixMs).toBe("number");
      expect(record?.detail).toEqual({
        status: 404,
        url: "https://x.example.com",
      });
    });

    it("are bounded, dropping the oldest first", (): void => {
      for (let index: number = 0; index < MAX_DEBUG_RECORDS + 25; index++) {
        debugLog(`code-${index}`, "message");
      }

      const records: Array<DebugRecord> = getDebugRecords();

      expect(records).toHaveLength(MAX_DEBUG_RECORDS);
      expect(records[0]?.code).toBe("code-25");
      expect(records[records.length - 1]?.code).toBe(
        `code-${MAX_DEBUG_RECORDS + 24}`,
      );
    });

    it("are returned as a copy the caller cannot mutate", (): void => {
      debugLog("code", "message");

      getDebugRecords().push({
        atUnixMs: 0,
        level: "info",
        code: "injected",
        message: "",
      });

      expect(getDebugRecords()).toHaveLength(1);
    });

    it("can be cleared", (): void => {
      debugLog("code", "message");
      clearDebugRecords();

      expect(getDebugRecords()).toEqual([]);
    });
  });

  describe("output", (): void => {
    it("prints the code and message once enabled", (): void => {
      setEnabled(true, "api");

      debugLog("config-accepted", "Policy accepted.");

      expect(allConsoleText(spies)).toContain(
        "[OneUptime Session Replay] config-accepted: Policy accepted.",
      );
    });

    it("uses console.warn for a warning and console.info for a log", (): void => {
      setEnabled(true, "api");

      debugLog("fine", "fine");
      debugWarn("bad", "bad");

      expect(spies.info.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(spies.warn).toHaveBeenCalledTimes(1);
    });

    /*
     * The backlog flush. The server-driven switch and the script tag
     * attribute both arrive AFTER the loader has already decided several
     * things, and those earlier decisions are usually the answer - so
     * enabling has to reach back, not just forward.
     */
    it("flushes everything recorded before it was enabled", (): void => {
      debugLog("loader-start", "Session replay loader running.");
      debugWarn("config-disabled", "Replay is off for this application.");

      expect(spies.warn).not.toHaveBeenCalled();

      setEnabled(true, "server-config");

      const text: string = allConsoleText(spies);

      expect(text).toContain("loader-start");
      expect(text).toContain("config-disabled");
    });

    it("says how it was switched on, and how to switch it off", (): void => {
      setEnabled(true, "local-storage");

      expect(allConsoleText(spies)).toContain(DEBUG_STORAGE_KEY);
    });

    it("does not re-flush the backlog when enabled twice", (): void => {
      debugLog("one", "one");

      setEnabled(true, "api");
      const afterFirst: number = spies.info.mock.calls.length;

      setEnabled(true, "api");

      expect(spies.info.mock.calls.length).toBe(afterFirst);
    });

    it("survives a page that removed console.info", (): void => {
      setEnabled(true, "api");

      const original: unknown = (console as unknown as Record<string, unknown>)[
        "info"
      ];

      (console as unknown as Record<string, unknown>)["info"] = undefined;

      expect((): void => {
        debugLog("code", "message");
      }).not.toThrow();

      (console as unknown as Record<string, unknown>)["info"] = original;
    });

    it("survives a console method that throws", (): void => {
      setEnabled(true, "api");

      jest.spyOn(console, "info").mockImplementation((): void => {
        throw new Error("frozen console");
      });

      expect((): void => {
        debugLog("code", "message");
      }).not.toThrow();

      /* The record is still kept even though printing it failed. */
      expect(
        getDebugRecords().some((r: DebugRecord): boolean => {
          return r.code === "code";
        }),
      ).toBe(true);
    });
  });

  /*
   * The privacy boundary. Every case here is a value that must NOT survive
   * into a record, because a record is printed to a console and handed to
   * support.
   */
  describe("redaction", (): void => {
    it("keeps primitives verbatim", (): void => {
      debugLog("code", "message", {
        text: "ok",
        count: 7,
        flag: false,
        missing: null,
      });

      expect(getDebugRecords()[0]?.detail).toEqual({
        text: "ok",
        count: 7,
        flag: false,
        missing: null,
      });
    });

    it("refuses a DOM node rather than stringifying it", (): void => {
      const input: HTMLInputElement = document.createElement("input");

      input.value = "hunter2";

      debugLog("code", "message", {
        element: input,
      } as unknown as Record<string, string>);

      const detail: Record<string, unknown> = (getDebugRecords()[0]?.detail ||
        {}) as Record<string, unknown>;

      expect(detail["element"]).toBe("<object omitted>");
      expect(JSON.stringify(detail)).not.toContain("hunter2");
    });

    it("refuses objects, arrays and functions", (): void => {
      debugLog("code", "message", {
        object: { secret: "s3cret" },
        array: ["s3cret"],
        fn: (): string => {
          return "s3cret";
        },
      } as unknown as Record<string, string>);

      const detail: Record<string, unknown> = (getDebugRecords()[0]?.detail ||
        {}) as Record<string, unknown>;

      expect(detail["object"]).toBe("<object omitted>");
      expect(detail["array"]).toBe("<object omitted>");
      expect(detail["fn"]).toBe("<function omitted>");
      expect(JSON.stringify(detail)).not.toContain("s3cret");
    });

    it("omits an undefined value entirely", (): void => {
      debugLog("code", "message", {
        present: "yes",
        absent: undefined,
      } as unknown as Record<string, string>);

      const detail: Record<string, unknown> = (getDebugRecords()[0]?.detail ||
        {}) as Record<string, unknown>;

      expect("absent" in detail).toBe(false);
      expect(detail["present"]).toBe("yes");
    });

    /*
     * The bound that stops a long value - a stack, a serialised body someone
     * passed by mistake - from riding into the console in full.
     */
    it("truncates a long string", (): void => {
      const long: string = "x".repeat(MAX_DEBUG_VALUE_LENGTH + 500);

      debugLog("code", "message", { value: long });

      const value: unknown = (
        (getDebugRecords()[0]?.detail || {}) as Record<string, unknown>
      )["value"];

      expect(String(value)).toHaveLength(MAX_DEBUG_VALUE_LENGTH + 1);
      expect(String(value).endsWith("…")).toBe(true);
    });

    it("does not truncate a string at the limit", (): void => {
      const exact: string = "x".repeat(MAX_DEBUG_VALUE_LENGTH);

      debugLog("code", "message", { value: exact });

      expect(
        ((getDebugRecords()[0]?.detail || {}) as Record<string, unknown>)[
          "value"
        ],
      ).toBe(exact);
    });

    it("keeps a non-finite number legible instead of dropping it", (): void => {
      debugLog("code", "message", { a: NaN, b: Infinity });

      const detail: Record<string, unknown> = (getDebugRecords()[0]?.detail ||
        {}) as Record<string, unknown>;

      expect(detail["a"]).toBe("NaN");
      expect(detail["b"]).toBe("Infinity");
    });

    it("redacts before printing, not only before storing", (): void => {
      setEnabled(true, "api");

      const input: HTMLInputElement = document.createElement("input");

      input.value = "hunter2";

      debugLog("code", "message", {
        element: input,
      } as unknown as Record<string, string>);

      expect(allConsoleText(spies)).not.toContain("hunter2");
    });
  });

  /*
   * The loader stub and the artifact are two separate bundles with two
   * separate module instances. Without the shared global, getDiagnostics()
   * on the artifact would be missing precisely the records that explain why
   * the artifact was never reached.
   */
  describe("shared state", (): void => {
    it("keeps one timeline across module instances", (): void => {
      debugLog("from-loader", "the stub recorded this");

      jest.resetModules();

      /* eslint-disable-next-line @typescript-eslint/no-require-imports */
      const reloaded: typeof import("../src/Debug") = jest.requireActual(
        "../src/Debug",
      ) as typeof import("../src/Debug");

      reloaded.debugLog("from-artifact", "the artifact recorded this");

      expect(
        reloaded.getDebugRecords().map((r: DebugRecord): string => {
          return r.code;
        }),
      ).toEqual(["from-loader", "from-artifact"]);
    });

    it("carries an enable decision across module instances", (): void => {
      setEnabled(true, "api");

      jest.resetModules();

      const reloaded: typeof import("../src/Debug") = jest.requireActual(
        "../src/Debug",
      ) as typeof import("../src/Debug");

      expect(reloaded.isDebugEnabled()).toBe(true);
    });
  });

  /*
   * Diagnostics are written through console.warn / console.info, which the
   * ConsoleRecorder patches. Enabling them used to record every line - and
   * the whole flushed backlog - into the customer's replay as console
   * entries, spending the per-page console cap on OneUptime's own output.
   */
  describe("with the console recorder listening", (): void => {
    it("never records its own lines, including the backlog flushed on enable", (): void => {
      const entries: Array<RecordedConsoleEntry> = [];

      const recorder: ConsoleRecorder = new ConsoleRecorder({
        emitCustomEvent: (): void => {
          /* Not under test. */
        },
        maskArgument: (value: string): string => {
          return value;
        },
        onConsole: (_atUnixMs: number, entry: RecordedConsoleEntry): void => {
          entries.push(entry);
        },
      });

      recorder.start(console);

      try {
        for (let index: number = 0; index < 30; index++) {
          debugWarn(`backlog-${index}`, "recorded before diagnostics were on");
        }

        setEnabled(true, "test");

        debugWarn("after-enable", "a warning", { chunkIndex: 3 });
        debugLog("after-enable-info", "an info line");

        /* The page's own output is still recorded. */
        // eslint-disable-next-line no-console
        console.warn("customer warning");

        expect(spies.warn.mock.calls.length).toBeGreaterThan(30);
        expect(entries).toHaveLength(1);
        expect(entries[0]?.message).toBe("customer warning");
        expect(recorder.getRecordedCount()).toBe(1);
      } finally {
        recorder.stop(console);
      }
    });
  });
});
