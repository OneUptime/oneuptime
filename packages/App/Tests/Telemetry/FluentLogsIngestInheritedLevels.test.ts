import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { INHERITED_PROPERTY_NAME_SPELLINGS } from "Common/Tests/Helpers/InheritedNames";

/*
 * ISSUE #8221: A FLUENT RECORD WHOSE LEVEL IS NAMED LIKE WHAT EVERY OBJECT
 * INHERITS.
 *
 * The Fluent ingest reads a record's level (level, severity, loglevel ...),
 * lowercases it and looked it up in a plain object of severity names. A
 * plain object answers for every name it inherits, so a level of
 * "constructor" (or "CONSTRUCTOR", or "__proto__") found the Object function
 * or the prototype, which is truthy and has no number or text: the log was
 * stored with neither a severity number nor a severity text. The table is a
 * Map now (lookupTable): such a level is no severity it knows, and the log
 * is stored as Unspecified, as any other unknown level is.
 *
 * The persistence edges are replaced as in FluentLogsIngestRecordTime.
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

const PROTOTYPE_KEYS: Array<string> = Object.getOwnPropertyNames(
  Object.prototype,
).sort();

// The rows the job hands the fan-in writer.
const ingest: (entries: Array<unknown>) => Promise<Array<JSONObject>> = async (
  entries: Array<unknown>,
): Promise<Array<JSONObject>> => {
  await FluentLogsIngestService.processFluentLogsFromQueue({
    projectId: PROJECT_ID,
    body: { entries },
    headers: { "x-oneuptime-service-name": "checkout" },
  } as unknown as ExpressRequest);

  return submitMock.mock.calls.flatMap((call: Array<unknown>) => {
    return call[1] as Array<JSONObject>;
  });
};

beforeEach(() => {
  jest.clearAllMocks();
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
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(
    PROTOTYPE_KEYS,
  );
});

describe("a Fluent record's level, named like what every object inherits", () => {
  test.each(INHERITED_PROPERTY_NAME_SPELLINGS)(
    "a level of %s is no severity OneUptime knows: the log is stored as Unspecified",
    async (level: string) => {
      const rows: Array<JSONObject> = await ingest([
        { level: level, message: "payment failed" },
        { severity: level, message: "payment failed again" },
      ]);

      expect(rows).toHaveLength(2);

      for (const row of rows) {
        expect({
          severityNumber: row["severityNumber"],
          severityText: row["severityText"],
        }).toEqual({
          severityNumber: 0,
          severityText: LogSeverity.Unspecified,
        });
      }
    },
  );

  test('the issue\'s case: a record with "level": "constructor" has a severity', async () => {
    const [row] = await ingest([
      { level: "constructor", message: "payment failed" },
    ]);

    expect(row!["severityNumber"]).toBe(0);
    expect(row!["severityText"]).toBe(LogSeverity.Unspecified);
  });

  test("the levels the table lists still read as they did, in any case", async () => {
    const rows: Array<JSONObject> = await ingest([
      { level: "ERROR", message: "a" },
      { level: "warn", message: "b" },
      { severity: "Info", message: "c" },
      { loglevel: "fatal", message: "d" },
      { level: "verbose", message: "e" },
    ]);

    expect(
      rows.map((row: JSONObject) => {
        return [row["severityNumber"], row["severityText"]];
      }),
    ).toEqual([
      [17, LogSeverity.Error],
      [13, LogSeverity.Warning],
      [9, LogSeverity.Information],
      [23, LogSeverity.Fatal],
      [0, LogSeverity.Unspecified],
    ]);
  });
});
