import ConfigLogLevel from "../../../Server/Types/ConfigLogLevel";
import { REDACTED } from "../../../Server/Utils/LogRedaction";
import { SeverityNumber } from "@opentelemetry/api-logs";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Core behaviour of Server/Utils/Logger that the credential-leak and
 * fault-demotion suites do not pin: level filtering per method, how bodies
 * are serialised for the ring buffer and the OTel exporter, attribute
 * sanitisation and merging with the ambient TelemetryContext, the ring
 * buffer's trimming and `limit`, a missing / throwing telemetry logger, and
 * getLogAttributesFromRequest.
 *
 * Telemetry is mocked; console methods are silenced spies; time is frozen so
 * the ring buffer timestamps are deterministic.
 */

interface EmittedRecord {
  body: string;
  severityNumber: SeverityNumber;
  attributes?: Record<string, string | number | boolean> | undefined;
}

interface MockTelemetryState {
  mode: "collect" | "null" | "throw";
  emitted: Array<EmittedRecord>;
}

const mockTelemetryState: MockTelemetryState = {
  mode: "collect",
  emitted: [],
};

jest.mock("../../../Server/Utils/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      getLogger: (): unknown => {
        if (mockTelemetryState.mode === "null") {
          return null;
        }

        if (mockTelemetryState.mode === "throw") {
          throw new Error("telemetry exploded");
        }

        return {
          emit: (record: EmittedRecord): void => {
            mockTelemetryState.emitted.push(record);
          },
        };
      },
    },
  };
});

import logger, {
  getLogAttributesFromRequest,
  LogAttributes,
  RecentLogEntry,
} from "../../../Server/Utils/Logger";
import TelemetryContext from "../../../Server/Utils/Telemetry/TelemetryContext";

type LogMethod = "info" | "warn" | "error" | "debug" | "trace";
type ConsoleMethod = "info" | "warn" | "error" | "debug" | "trace";

interface ConsoleSpy {
  mock: { calls: Array<Array<unknown>> };
}

const FIXED_NOW: Date = new Date("2026-01-15T10:20:30.000Z");

let consoleSpies: Record<ConsoleMethod, ConsoleSpy>;

function resetRecentLogs(): void {
  (logger as unknown as { recentLogs: Array<RecentLogEntry> }).recentLogs = [];
}

function setLevel(level: ConfigLogLevel): void {
  jest.spyOn(logger, "getLogLevel").mockReturnValue(level);
}

function lastEmitted(): EmittedRecord {
  const record: EmittedRecord | undefined =
    mockTelemetryState.emitted[mockTelemetryState.emitted.length - 1];

  if (!record) {
    throw new Error("nothing was emitted");
  }

  return record;
}

function totalConsoleCalls(): number {
  return Object.values(consoleSpies).reduce(
    (sum: number, spy: ConsoleSpy): number => {
      return sum + spy.mock.calls.length;
    },
    0,
  );
}

beforeEach((): void => {
  jest.useFakeTimers();
  jest.setSystemTime(FIXED_NOW);

  mockTelemetryState.mode = "collect";
  mockTelemetryState.emitted.length = 0;
  resetRecentLogs();

  const silence: () => undefined = (): undefined => {
    return undefined;
  };

  consoleSpies = {
    info: jest.spyOn(console, "info").mockImplementation(silence),
    warn: jest.spyOn(console, "warn").mockImplementation(silence),
    error: jest.spyOn(console, "error").mockImplementation(silence),
    debug: jest.spyOn(console, "debug").mockImplementation(silence),
    trace: jest.spyOn(console, "trace").mockImplementation(silence),
  };
});

afterEach((): void => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  resetRecentLogs();
});

describe("Logger level filtering", () => {
  /*
   * For every configured level, which logger methods produce output. error()
   * is on for every level except OFF; debug and trace need DEBUG.
   */
  const matrix: Array<{ level: ConfigLogLevel; enabled: Array<LogMethod> }> = [
    {
      level: ConfigLogLevel.DEBUG,
      enabled: ["info", "warn", "error", "debug", "trace"],
    },
    { level: ConfigLogLevel.INFO, enabled: ["info", "warn", "error"] },
    { level: ConfigLogLevel.WARN, enabled: ["warn", "error"] },
    { level: ConfigLogLevel.ERROR, enabled: ["error"] },
    { level: ConfigLogLevel.OFF, enabled: [] },
  ];

  const allMethods: Array<LogMethod> = [
    "info",
    "warn",
    "error",
    "debug",
    "trace",
  ];

  interface FilterCase {
    name: string;
    level: ConfigLogLevel;
    method: LogMethod;
    shouldLog: boolean;
  }

  const cases: Array<FilterCase> = [];

  for (const row of matrix) {
    for (const method of allMethods) {
      const shouldLog: boolean = row.enabled.includes(method);
      cases.push({
        name: `LOG_LEVEL=${row.level}: ${method}() ${shouldLog ? "logs" : "is silent"}`,
        level: row.level,
        method: method,
        shouldLog: shouldLog,
      });
    }
  }

  test.each(cases)("$name", (filterCase: FilterCase) => {
    setLevel(filterCase.level);

    logger[filterCase.method](`message from ${filterCase.method}`);

    if (filterCase.shouldLog) {
      expect(consoleSpies[filterCase.method].mock.calls).toEqual([
        [`message from ${filterCase.method}`],
      ]);
      expect(totalConsoleCalls()).toBe(1);
      expect(logger.getRecentLogs().length).toBe(1);
      expect(mockTelemetryState.emitted.length).toBe(1);
    } else {
      expect(totalConsoleCalls()).toBe(0);
      expect(logger.getRecentLogs()).toEqual([]);
      expect(mockTelemetryState.emitted).toEqual([]);
    }
  });

  test("each method records its own level name and exports its own severity", () => {
    setLevel(ConfigLogLevel.DEBUG);

    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.debug("d");
    logger.trace("t");

    expect(
      logger.getRecentLogs().map((entry: RecentLogEntry): string => {
        return entry.level;
      }),
    ).toEqual(["INFO", "WARN", "ERROR", "DEBUG", "TRACE"]);

    expect(
      mockTelemetryState.emitted.map((r: EmittedRecord): SeverityNumber => {
        return r.severityNumber;
      }),
    ).toEqual([
      SeverityNumber.INFO,
      SeverityNumber.WARN,
      SeverityNumber.ERROR,
      SeverityNumber.DEBUG,
      // trace is exported at DEBUG severity
      SeverityNumber.DEBUG,
    ]);
  });
});

describe("Logger.getLogLevel", () => {
  const originalLogLevel: string | undefined = process.env["LOG_LEVEL"];

  afterEach((): void => {
    if (originalLogLevel === undefined) {
      delete process.env["LOG_LEVEL"];
    } else {
      process.env["LOG_LEVEL"] = originalLogLevel;
    }
  });

  function loadLoggerWith(
    environmentOverride: Record<string, unknown>,
  ): typeof logger {
    let loaded: typeof logger | undefined;

    jest.isolateModules((): void => {
      jest.doMock("../../../Server/EnvironmentConfig", () => {
        return {
          ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
            string,
            unknown
          >),
          ...environmentOverride,
        };
      });
      loaded = (
        jest.requireActual("../../../Server/Utils/Logger") as {
          default: typeof logger;
        }
      ).default;
    });

    jest.dontMock("../../../Server/EnvironmentConfig");

    return loaded!;
  }

  test("returns the configured LOG_LEVEL", () => {
    expect(
      loadLoggerWith({ LogLevel: ConfigLogLevel.WARN }).getLogLevel(),
    ).toBe(ConfigLogLevel.WARN);
  });

  test("defaults to INFO when no level is configured", () => {
    expect(loadLoggerWith({ LogLevel: undefined }).getLogLevel()).toBe(
      ConfigLogLevel.INFO,
    );
  });

  test("reads LOG_LEVEL from the environment at load time", () => {
    process.env["LOG_LEVEL"] = ConfigLogLevel.DEBUG;
    expect(loadLoggerWith({}).getLogLevel()).toBe(ConfigLogLevel.DEBUG);

    delete process.env["LOG_LEVEL"];
    expect(loadLoggerWith({}).getLogLevel()).toBe(ConfigLogLevel.INFO);
  });
});

describe("Logger body serialisation", () => {
  beforeEach((): void => {
    setLevel(ConfigLogLevel.DEBUG);
  });

  test("a string is recorded and exported verbatim with a frozen timestamp", () => {
    logger.info("plain message");

    expect(logger.getRecentLogs()).toEqual([
      {
        time: "2026-01-15T10:20:30.000Z",
        level: "INFO",
        message: "plain message",
      },
    ]);
    expect(lastEmitted()).toEqual({
      body: "plain message",
      severityNumber: SeverityNumber.INFO,
    });
  });

  test("an object is printed as an object but recorded and exported as JSON", () => {
    const body: { a: number; nested: { b: string } } = {
      a: 1,
      nested: { b: "two" },
    };

    logger.info(body);

    expect(consoleSpies.info.mock.calls[0]![0]).toEqual(body);
    expect(typeof consoleSpies.info.mock.calls[0]![0]).toBe("object");
    expect(logger.getRecentLogs()[0]!.message).toBe(
      '{"a":1,"nested":{"b":"two"}}',
    );
    expect(lastEmitted().body).toBe('{"a":1,"nested":{"b":"two"}}');
  });

  test("an Error without secrets reaches console as the same Error and is recorded by message", () => {
    const err: Error = new Error("disk full");

    logger.warn(err);

    expect(consoleSpies.warn.mock.calls[0]![0]).toBe(err);
    expect(logger.getRecentLogs()[0]!.message).toBe("disk full");
    expect(lastEmitted().body).toBe("disk full");
  });

  test("undefined serialises to an empty body instead of throwing", () => {
    logger.info(undefined);

    expect(logger.getRecentLogs()[0]!.message).toBe("");
    expect(lastEmitted().body).toBe("");
  });

  test("numbers and booleans serialise as JSON literals", () => {
    logger.info(42);
    logger.info(false);

    expect(
      logger.getRecentLogs().map((e: RecentLogEntry): string => {
        return e.message;
      }),
    ).toEqual(["42", "false"]);
  });

  test("a body that cannot be walked is replaced by the redaction marker, never passed on raw", () => {
    const hostile: Record<string, unknown> = new Proxy(
      {},
      {
        ownKeys: (): Array<string> => {
          throw new Error("no keys for you");
        },
        get: (): never => {
          throw new Error("no props for you");
        },
      },
    );

    expect((): void => {
      logger.info(hostile);
    }).not.toThrow();

    expect(consoleSpies.info.mock.calls[0]![0]).toBe(REDACTED);
    expect(logger.getRecentLogs()[0]!.message).toBe(REDACTED);
  });

  test("serializeLogBody redacts and serialises in one step", () => {
    expect(logger.serializeLogBody("hello")).toBe("hello");
    expect(logger.serializeLogBody({ x: [1, 2] })).toBe('{"x":[1,2]}');
    expect(logger.serializeLogBody(new Error("boom"))).toBe("boom");
    expect(logger.serializeLogBody({ password: "hunter2" })).not.toContain(
      "hunter2",
    );
  });

  test("messages longer than 4000 characters are truncated in the ring buffer only", () => {
    const long: string = "x".repeat(4500);

    logger.info(long);

    const recorded: string = logger.getRecentLogs()[0]!.message;
    expect(recorded).toBe(`${"x".repeat(4000)}… (truncated)`);
    expect(lastEmitted().body).toBe(long);
    expect(consoleSpies.info.mock.calls[0]![0]).toBe(long);
  });
});

describe("Logger recent-log ring buffer", () => {
  beforeEach((): void => {
    setLevel(ConfigLogLevel.INFO);
  });

  test("getRecentLogs returns a newest-last copy, optionally limited", () => {
    logger.info("one");
    logger.info("two");
    logger.info("three");

    const messages: (entries: Array<RecentLogEntry>) => Array<string> = (
      entries: Array<RecentLogEntry>,
    ): Array<string> => {
      return entries.map((e: RecentLogEntry): string => {
        return e.message;
      });
    };

    expect(messages(logger.getRecentLogs())).toEqual(["one", "two", "three"]);
    expect(messages(logger.getRecentLogs(2))).toEqual(["two", "three"]);
    expect(messages(logger.getRecentLogs(3))).toEqual(["one", "two", "three"]);
    expect(messages(logger.getRecentLogs(99))).toEqual(["one", "two", "three"]);
    // 0 means "no limit"
    expect(messages(logger.getRecentLogs(0))).toEqual(["one", "two", "three"]);

    // Mutating the snapshot does not affect the buffer.
    const snapshot: Array<RecentLogEntry> = logger.getRecentLogs();
    snapshot.length = 0;
    expect(logger.getRecentLogs().length).toBe(3);
  });

  test("the buffer trims back to the newest 1000 entries once it exceeds 1256", () => {
    for (let i: number = 0; i < 1256; i++) {
      logger.info(`m${i}`);
    }

    // At the soft ceiling nothing has been trimmed yet.
    expect(logger.getRecentLogs().length).toBe(1256);
    expect(logger.getRecentLogs()[0]!.message).toBe("m0");

    logger.info("m1256");

    const entries: Array<RecentLogEntry> = logger.getRecentLogs();
    expect(entries.length).toBe(1000);
    expect(entries[0]!.message).toBe("m257");
    expect(entries[entries.length - 1]!.message).toBe("m1256");
  });
});

describe("Logger telemetry export", () => {
  beforeEach((): void => {
    setLevel(ConfigLogLevel.INFO);
  });

  test("no attributes key is exported when there are no attributes", () => {
    logger.info("bare");

    expect(Object.keys(lastEmitted())).toEqual(["body", "severityNumber"]);
  });

  test("undefined attribute values are dropped and an all-undefined set exports no attributes", () => {
    logger.info("empty attrs", { userId: undefined, projectId: undefined });

    expect(lastEmitted().attributes).toBeUndefined();
  });

  test("attributes pass through, sensitive keys are redacted, strings are scrubbed, numbers and booleans kept", () => {
    const attributes: LogAttributes = {
      projectId: "project-1",
      retryCount: 3,
      isRetry: true,
      apiKey: "abc123-plain-key",
      note: "connecting with password=hunter2-super-secret",
      skipped: undefined,
    };

    logger.info("with attrs", attributes);

    const exported: Record<string, string | number | boolean> =
      lastEmitted().attributes!;

    expect(exported["projectId"]).toBe("project-1");
    expect(exported["retryCount"]).toBe(3);
    expect(exported["isRetry"]).toBe(true);
    expect(exported["apiKey"]).toBe(REDACTED);
    expect(String(exported["note"])).not.toContain("hunter2-super-secret");
    expect(String(exported["note"])).toContain("connecting with");
    expect(Object.keys(exported)).not.toContain("skipped");
  });

  test("ambient TelemetryContext attributes are merged and explicit attributes win", () => {
    TelemetryContext.runWithContext(
      { projectId: "ambient-project", monitorId: "monitor-9" },
      (): void => {
        logger.info("in context", { projectId: "explicit-project" });
      },
    );

    const exported: Record<string, string | number | boolean> | undefined =
      lastEmitted().attributes;

    expect(exported?.["projectId"]).toBe("explicit-project");
    expect(exported?.["monitorId"]).toBe("monitor-9");
  });

  test("error() always exports an error.class attribute alongside caller attributes", () => {
    logger.error(new Error("unexpected"), { requestId: "req-1" });

    const exported: Record<string, string | number | boolean> | undefined =
      lastEmitted().attributes;

    expect(exported?.["requestId"]).toBe("req-1");
    expect(typeof exported?.["error.class"]).toBe("string");
  });

  test("emit() redacts the body and forwards the given severity without touching console or the buffer", () => {
    logger.emit({
      body: { token: "very-secret-token-value", ok: true },
      severityNumber: SeverityNumber.FATAL,
      attributes: { requestId: "r-7" },
    });

    const record: EmittedRecord = lastEmitted();
    expect(record.severityNumber).toBe(SeverityNumber.FATAL);
    expect(record.body).not.toContain("very-secret-token-value");
    expect(record.body).toContain('"ok":true');
    expect(record.attributes).toEqual({ requestId: "r-7" });
    expect(totalConsoleCalls()).toBe(0);
    expect(logger.getRecentLogs()).toEqual([]);
  });

  test("a null telemetry logger still logs to console and the buffer", () => {
    mockTelemetryState.mode = "null";

    logger.info("offline");

    expect(consoleSpies.info.mock.calls).toEqual([["offline"]]);
    expect(logger.getRecentLogs().length).toBe(1);
    expect(mockTelemetryState.emitted).toEqual([]);
  });

  test("a throwing telemetry logger never propagates out of a log call", () => {
    mockTelemetryState.mode = "throw";

    expect((): void => {
      logger.info("still fine");
      logger.error("still fine");
      logger.emit({ body: "x", severityNumber: SeverityNumber.INFO });
    }).not.toThrow();

    expect(consoleSpies.info.mock.calls).toEqual([["still fine"]]);
    expect(logger.getRecentLogs().length).toBe(2);
  });
});

describe("getLogAttributesFromRequest", () => {
  test("returns an empty object for a missing request", () => {
    expect(getLogAttributesFromRequest(undefined)).toEqual({});
    expect(getLogAttributesFromRequest(null)).toEqual({});
  });

  test("extracts requestId, projectId and userId when present", () => {
    expect(
      getLogAttributesFromRequest({
        requestId: "req-42",
        tenantId: {
          toString: (): string => {
            return "tenant-1";
          },
        },
        userAuthorization: {
          userId: {
            toString: (): string => {
              return "user-9";
            },
          },
        },
      }),
    ).toEqual({ requestId: "req-42", projectId: "tenant-1", userId: "user-9" });
  });

  test("omits fields that are absent", () => {
    expect(getLogAttributesFromRequest({ requestId: "only" })).toEqual({
      requestId: "only",
    });
    expect(getLogAttributesFromRequest({ userAuthorization: {} })).toEqual({});
  });

  test("returns an empty object when reading the request throws", () => {
    expect(
      getLogAttributesFromRequest({
        requestId: "req-1",
        tenantId: {
          toString: (): string => {
            throw new Error("bad id");
          },
        },
      }),
    ).toEqual({});
  });
});
