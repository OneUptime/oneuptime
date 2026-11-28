import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity, {
  LOG_SEVERITY_NUMBER_BY_TEXT,
} from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  LOG_SEVERITY_WORDS,
  LogSeverityWord,
  WORDS_THAT_NAME_NOTHING,
  spellingsOf,
} from "./Helpers/LogSeverityWords";

/*
 * A Fluentd or Fluent Bit record's level, as stored (issue #8425).
 *
 * Fluent ingest had a table of level words of its own, and it disagreed
 * with the one OTLP ingest reads a record's severityText with: `critical`
 * was Fatal here and Error there, `notice`, `fatal` and `emergency` had
 * other numbers, and `crit`, `alert`, `severe`, `panic` or a numbered step
 * such as `WARN2` were Unspecified here. So the same line - `{"level":
 * "critical"}` - was stored as Fatal through Fluent Bit and as Error through
 * an OTLP exporter, and a Logs monitor on Fatal saw one and not the other.
 *
 * Now both read one table (LOG_SEVERITY_NUMBER_BY_TEXT, in Common). This
 * suite sends every word of it - written out by hand in
 * Helpers/LogSeverityWords, the same list the OTLP wire-format suite and
 * the remapper's suite hold their paths to - through the Fluent ingest as
 * the worker runs it, from the queued body to the rows it hands the fan-in
 * writer. Only the database and the queue are replaced.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Logger",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/OpenTelemetryIngestService", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Services/OpenTelemetryIngestService",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: { telemetryServiceFromName: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Telemetry/TelemetryFanInWriter", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Telemetry/TelemetryFanInWriter",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: { submit: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Telemetry/Services/LogPipelineService", () => {
  return {
    __esModule: true,
    default: { loadPipelines: jest.fn(), processLog: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Telemetry/Services/LogDropFilterService", () => {
  return {
    __esModule: true,
    default: { loadDropFilters: jest.fn(), shouldDropLog: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Telemetry/Services/LogScrubRuleService", () => {
  return {
    __esModule: true,
    default: { loadScrubRules: jest.fn(), scrubLog: jest.fn() },
  };
});

import OTelIngestService from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { ExpressRequest } from "Common/Server/Utils/Express";
import FluentLogsIngestService from "../../FeatureSet/Telemetry/Services/FluentLogsIngestService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";

type MockedFn = jest.Mock;

const submitMock: MockedFn = TelemetryFanInWriter.submit as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();

// The fields a record's level is read from, in the order they are tried.
const SEVERITY_FIELDS: Array<string> = (
  FluentLogsIngestService as unknown as { SEVERITY_FIELDS: Array<string> }
).SEVERITY_FIELDS;

// The rows the job hands the fan-in writer.
const ingest: (entries: Array<unknown>) => Promise<Array<JSONObject>> = async (
  entries: Array<unknown>,
): Promise<Array<JSONObject>> => {
  submitMock.mockClear();

  await FluentLogsIngestService.processFluentLogsFromQueue({
    projectId: PROJECT_ID,
    body: { entries },
    headers: { "x-oneuptime-service-name": "checkout" },
  } as unknown as ExpressRequest);

  return submitMock.mock.calls.flatMap((call: Array<unknown>) => {
    return call[1] as Array<JSONObject>;
  });
};

// What a stored row says its severity is.
const severityOf: (row: JSONObject | undefined) => {
  severityNumber: unknown;
  severityText: unknown;
} = (
  row: JSONObject | undefined,
): { severityNumber: unknown; severityText: unknown } => {
  return {
    severityNumber: row?.["severityNumber"],
    severityText: row?.["severityText"],
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date("2026-11-15T10:17:18.703Z");
  });
  (
    OTelIngestService.telemetryServiceFromName as unknown as MockedFn
  ).mockImplementation((async () => {
    return {
      serviceName: "checkout",
      primaryEntityId: SERVICE_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      entityKeys: [],
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    };
  }) as never);
  (LogPipelineService.loadPipelines as unknown as MockedFn).mockImplementation(
    (async () => {
      return [];
    }) as never,
  );
  (
    LogDropFilterService.loadDropFilters as unknown as MockedFn
  ).mockImplementation((async () => {
    return [];
  }) as never);
  (
    LogScrubRuleService.loadScrubRules as unknown as MockedFn
  ).mockImplementation((async () => {
    return [];
  }) as never);
  submitMock.mockReturnValue({ flushed: Promise.resolve() } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a Fluent record's level word (issue #8425)", () => {
  test.each(
    LOG_SEVERITY_WORDS.map(
      (word: LogSeverityWord): [string, number, LogSeverity, string] => {
        return [word.word, word.severityNumber, word.severity, word.source];
      },
    ),
  )(
    "%s is stored as %i (%s), in any case and with spaces around it (%s)",
    async (
      word: string,
      severityNumber: number,
      severity: LogSeverity,
    ): Promise<void> => {
      const spellings: Array<string> = spellingsOf(word);
      const rows: Array<JSONObject> = await ingest(
        spellings.map((written: string): JSONObject => {
          return { level: written, message: `a ${written} line` };
        }),
      );

      expect(rows).toHaveLength(spellings.length);

      for (const [index, row] of rows.entries()) {
        expect({ written: spellings[index], ...severityOf(row) }).toEqual({
          written: spellings[index],
          severityNumber: severityNumber,
          severityText: severity,
        });
      }
    },
  );

  test("every word of the table every log ingest reads is in the hand-written list, and no other", () => {
    expect(Array.from(LOG_SEVERITY_NUMBER_BY_TEXT.keys()).sort()).toEqual(
      LOG_SEVERITY_WORDS.map((word: LogSeverityWord): string => {
        return word.word.toUpperCase();
      }).sort(),
    );
  });

  test.each(WORDS_THAT_NAME_NOTHING)(
    "%s (%p) is stored as 0 / Unspecified, never as a guess",
    async (_label: string, written: string): Promise<void> => {
      const [row] = await ingest([{ level: written, message: "a line" }]);

      expect(severityOf(row)).toEqual({
        severityNumber: 0,
        severityText: LogSeverity.Unspecified,
      });
    },
  );

  /*
   * Fluent's old table was an object literal, so a level named like an
   * Object.prototype member found that member: `constructor` came back as
   * the Object function, and the row was stored with no severity number
   * and no severity text at all.
   */
  test("a level named like an Object.prototype member gets a number and a text like any other unknown word", async () => {
    const rows: Array<JSONObject> = await ingest(
      ["constructor", "toString", "valueOf", "__proto__"].map(
        (written: string): JSONObject => {
          return { level: written, message: "a line" };
        },
      ),
    );

    expect(rows).toHaveLength(4);

    for (const row of rows) {
      expect(typeof row["severityNumber"]).toBe("number");
      expect(severityOf(row)).toEqual({
        severityNumber: 0,
        severityText: LogSeverity.Unspecified,
      });
    }
  });

  test("a record with no level field is stored as 0 / Unspecified", async () => {
    const [row] = await ingest([{ message: "no level here" }]);

    expect(severityOf(row)).toEqual({
      severityNumber: 0,
      severityText: LogSeverity.Unspecified,
    });
  });

  test("a numeric level is no word: a syslog priority of 3 stays Unspecified, as the Fluentd page says", async () => {
    const rows: Array<JSONObject> = await ingest([
      { priority: 3, message: "a line" },
      { level: 17, message: "a line" },
      { level: "17", message: "a line" },
    ]);

    for (const row of rows) {
      expect(severityOf(row)).toEqual({
        severityNumber: 0,
        severityText: LogSeverity.Unspecified,
      });
    }
  });

  test.each(SEVERITY_FIELDS)(
    "the level is read from the %s field with the same table",
    async (field: string): Promise<void> => {
      const rows: Array<JSONObject> = await ingest([
        { [field]: "critical", message: "a line" },
        { [field]: "crit", message: "a line" },
        { [field]: "WARN2", message: "a line" },
      ]);

      expect(rows.map(severityOf)).toEqual([
        { severityNumber: 21, severityText: LogSeverity.Fatal },
        { severityNumber: 18, severityText: LogSeverity.Error },
        { severityNumber: 14, severityText: LogSeverity.Warning },
      ]);
    },
  );

  /*
   * The words Fluent stored differently before. `critical` keeps its
   * severity (Fatal), so a Fluent user's alerts on Fatal see what they saw;
   * `notice`, `fatal` and `emergency` keep their severity and take the
   * number Appendix B gives them; the rest were Unspecified and now name
   * the severity they name everywhere else.
   */
  test.each([
    ["critical", 21, LogSeverity.Fatal, "Fatal (21): unchanged"],
    ["notice", 10, LogSeverity.Information, "Information, 9 before"],
    ["fatal", 21, LogSeverity.Fatal, "Fatal, 23 before"],
    ["emergency", 21, LogSeverity.Fatal, "Fatal, 23 before"],
    ["emerg", 21, LogSeverity.Fatal, "Fatal, 23 before"],
    ["crit", 18, LogSeverity.Error, "Unspecified before"],
    ["alert", 19, LogSeverity.Error, "Unspecified before"],
    ["severe", 17, LogSeverity.Error, "Unspecified before"],
    // A crash (issue #11228): Error (19) from #8425 until then.
    ["panic", 21, LogSeverity.Fatal, "Unspecified before"],
    ["verbose", 5, LogSeverity.Debug, "Unspecified before"],
    ["error3", 19, LogSeverity.Error, "Unspecified before"],
    ["fatal4", 24, LogSeverity.Fatal, "Unspecified before"],
  ])(
    "%s is stored as %i (%s) - %s",
    async (
      written: string,
      severityNumber: number,
      severity: LogSeverity,
    ): Promise<void> => {
      const [row] = await ingest([{ level: written, message: "a line" }]);

      expect(severityOf(row)).toEqual({
        severityNumber: severityNumber,
        severityText: severity,
      });
    },
  );

  test("every row's number is in its text's range: the two never disagree", async () => {
    const rows: Array<JSONObject> = await ingest(
      LOG_SEVERITY_WORDS.map((word: LogSeverityWord): JSONObject => {
        return { level: word.word, message: "a line" };
      }),
    );

    expect(rows).toHaveLength(LOG_SEVERITY_WORDS.length);

    for (const row of rows) {
      const severityNumber: number = row["severityNumber"] as number;
      const expected: LogSeverity =
        severityNumber >= 21
          ? LogSeverity.Fatal
          : severityNumber >= 17
            ? LogSeverity.Error
            : severityNumber >= 13
              ? LogSeverity.Warning
              : severityNumber >= 9
                ? LogSeverity.Information
                : severityNumber >= 5
                  ? LogSeverity.Debug
                  : severityNumber >= 1
                    ? LogSeverity.Trace
                    : LogSeverity.Unspecified;

      expect(row["severityText"]).toBe(expected);
    }
  });
});
