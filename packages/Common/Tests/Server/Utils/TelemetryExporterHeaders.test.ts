import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SeverityNumber } from "@opentelemetry/api-logs";
import Telemetry from "../../../Server/Utils/Telemetry";
import logger, {
  EXTERNAL_FAULT,
  RecentLogEntry,
} from "../../../Server/Utils/Logger";
import ConfigLogLevel from "../../../Server/Types/ConfigLogLevel";
import ErrorClass from "../../../Types/Telemetry/ErrorClass";

/*
 * Telemetry.getHeaders() is what OneUptime's own traces, metrics and logs are
 * exported with, read from OPENTELEMETRY_EXPORTER_OTLP_HEADERS (Helm:
 * openTelemetryExporter.headers). It used to split each header at every '=',
 * so a header whose value held '=' - a Basic Authorization value, a token
 * ending in '=' - was dropped without a word, and when it was the only one,
 * OneUptime exported nothing at all (init exports only with a header).
 *
 * These tests read the setting as the process does, and pin the one line the
 * operator gets for a header that cannot be read: once, printed as a warning
 * even under LOG_LEVEL=ERROR (what config.example.env ships), never an Issue,
 * and never with a name or a value from the setting in it.
 */

const SETTING: string = "OPENTELEMETRY_EXPORTER_OTLP_HEADERS";

const BASIC_AUTHORIZATION: string = "Basic dXNlcjpwYXNzd29yZA==";

interface EmittedRecord {
  body: unknown;
  severityNumber?: SeverityNumber;
  attributes?: Record<string, unknown> | undefined;
}

interface TelemetryInternals {
  hasWarnedAboutUnreadableHeaders: boolean;
  loggerProvider: unknown;
}

const internals: TelemetryInternals =
  Telemetry as unknown as TelemetryInternals;

const savedEnv: NodeJS.ProcessEnv = { ...process.env };

let loggerError: ReturnType<typeof jest.spyOn>;
let consoleWarn: ReturnType<typeof jest.spyOn>;
let consoleError: ReturnType<typeof jest.spyOn>;

const emitted: Array<EmittedRecord> = [];

const warnings: () => Array<string> = (): Array<string> => {
  return loggerError.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
};

beforeEach(() => {
  internals.hasWarnedAboutUnreadableHeaders = false;
  internals.loggerProvider = null;
  emitted.length = 0;
  delete process.env[SETTING];

  loggerError = jest.spyOn(logger, "error");
  consoleWarn = jest.spyOn(console, "warn").mockImplementation((): void => {
    return undefined;
  });
  consoleError = jest.spyOn(console, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  internals.hasWarnedAboutUnreadableHeaders = false;
  internals.loggerProvider = null;
});

afterAll(() => {
  process.env = savedEnv;
});

describe("Telemetry.getHeaders: the issue's cases", () => {
  test("'Authorization=Basic abc==' gives { Authorization: 'Basic abc==' }", () => {
    process.env[SETTING] = "Authorization=Basic abc==";

    expect(Telemetry.getHeaders()).toEqual({ Authorization: "Basic abc==" });
    expect(warnings()).toEqual([]);
  });

  test("a real Basic Authorization value, padding and all, is the one header sent", () => {
    process.env[SETTING] = `Authorization=${BASIC_AUTHORIZATION}`;

    expect(Telemetry.getHeaders()).toEqual({
      Authorization: BASIC_AUTHORIZATION,
    });
  });

  test("a token that ends in '=' is kept whole", () => {
    process.env[SETTING] = "x-oneuptime-token=c2VjcmV0dG9rZW4=";

    expect(Telemetry.getHeaders()).toEqual({
      "x-oneuptime-token": "c2VjcmV0dG9rZW4=",
    });
  });

  test("'a=1;b=2' gives two headers", () => {
    process.env[SETTING] = "a=1;b=2";

    expect(Telemetry.getHeaders()).toEqual({ a: "1", b: "2" });
  });

  test("a trailing ';' or an empty part is skipped, and nobody is warned", () => {
    process.env[SETTING] = "a=1;";
    expect(Telemetry.getHeaders()).toEqual({ a: "1" });

    process.env[SETTING] = "a=1;;b=2; ;";
    expect(Telemetry.getHeaders()).toEqual({ a: "1", b: "2" });

    expect(warnings()).toEqual([]);
  });

  test("spaces around the name and the value are trimmed", () => {
    process.env[SETTING] = " Authorization = Basic abc== ; x-extra =  1 ";

    expect(Telemetry.getHeaders()).toEqual({
      Authorization: "Basic abc==",
      "x-extra": "1",
    });
  });

  test("a part without '=' is skipped and warned about, with its value never logged", () => {
    process.env[SETTING] = "x-oneuptime-token=key;sk-live-the-secret-part";

    expect(Telemetry.getHeaders()).toEqual({ "x-oneuptime-token": "key" });

    expect(warnings()).toEqual([
      "OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart): " +
        "OneUptime cannot read header 2 of 2, so it does not send it. " +
        "Header 2 has no '=' between a name and a value. " +
        "Write each header as name=value, and separate headers with ';'.",
    ]);
    expect(warnings()[0]).not.toContain("sk-live-the-secret-part");
    expect(warnings()[0]).not.toContain("key");
  });

  test("unset or empty, the setting gives no header and no warning", () => {
    expect(Telemetry.getHeaders()).toEqual({});

    process.env[SETTING] = "";
    expect(Telemetry.getHeaders()).toEqual({});

    expect(warnings()).toEqual([]);
  });
});

describe("Telemetry.getHeaders: the warning", () => {
  test("is logged once a process, however often the headers are read", () => {
    process.env[SETTING] = "a=1;broken";

    Telemetry.getHeaders();
    Telemetry.getHeaders();
    Telemetry.getHeaders();

    expect(loggerError).toHaveBeenCalledTimes(1);
  });

  test("is marked an outside fault, so it is a warning and never an Issue", () => {
    process.env[SETTING] = "broken";

    Telemetry.getHeaders();

    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining("OneUptime cannot read header 1 of 1"),
      EXTERNAL_FAULT,
    );
  });

  test("never holds a name or a value of the setting, readable or not", () => {
    const secrets: Array<string> = [
      "Basic dXNlcjpwYXNzd29yZA",
      "dXNlcjpwYXNzd29yZA",
      "server-secret",
      "sk-live-0123456789",
      "tenant-eu-42",
      "x-scope-orgid",
    ];

    process.env[SETTING] = [
      `Authorization=${BASIC_AUTHORIZATION}`,
      "Authorization: Bearer server-secret",
      "sk-live-0123456789",
      "x-scope-orgid=tenant-eu-42\u0007",
      "dXNlcjpwYXNzd29yZA==",
    ].join(";");

    expect(Telemetry.getHeaders()).toEqual({
      Authorization: BASIC_AUTHORIZATION,
    });

    const line: string = warnings()[0] as string;

    expect(line).toContain(
      "OneUptime cannot read headers 2, 3, 4 and 5 of 5, so it does not send them.",
    );

    for (const secret of secrets) {
      expect(line).not.toContain(secret);
    }

    expect(line).not.toContain("Authorization");
  });

  test("is not logged for a setting every header of which can be sent", () => {
    process.env[SETTING] =
      `x-oneuptime-token=key;Authorization=${BASIC_AUTHORIZATION};x-extra=a=b`;

    Telemetry.getHeaders();

    expect(warnings()).toEqual([]);
  });

  /*
   * LOG_LEVEL=ERROR is what config.example.env ships, so it is what most
   * Docker Compose installs run. logger.warn() prints nothing there; the
   * operator must still see this line.
   */
  test("prints as a warning under LOG_LEVEL=ERROR, and the support bundle keeps it as one", () => {
    jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.ERROR);
    loggerError.mockRestore();

    process.env[SETTING] = "x-oneuptime-token=key;broken";

    Telemetry.getHeaders();

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(String(consoleWarn.mock.calls[0]?.[0])).toContain(
      "OneUptime cannot read header 2 of 2, so it does not send it.",
    );

    const recent: RecentLogEntry | undefined = logger
      .getRecentLogs()
      .reverse()
      .find((entry: RecentLogEntry): boolean => {
        return entry.message.includes("OPENTELEMETRY_EXPORTER_OTLP_HEADERS");
      });

    expect(recent?.level).toBe("WARN");
    expect(recent?.message).toContain(
      "Header 2 has no '=' between a name and a value.",
    );
  });

  test("goes to the exported logs at WARN severity, as a user error, once telemetry runs", () => {
    loggerError.mockRestore();
    jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.INFO);

    internals.loggerProvider = {
      getLogger: (): unknown => {
        return {
          emit: (record: EmittedRecord): void => {
            emitted.push(record);
          },
        };
      },
    };

    process.env[SETTING] = "=no-name";

    Telemetry.getHeaders();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.severityNumber).toBe(SeverityNumber.WARN);
    expect(emitted[0]?.attributes?.["error.class"]).toBe(ErrorClass.UserError);
    expect(String(emitted[0]?.body)).toContain(
      "Header 1 has nothing before its first '='.",
    );
    expect(String(emitted[0]?.body)).not.toContain("no-name");
  });
});
