import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ISSUE #8221: SYSLOG FROM A SERVICE NAMED LIKE WHAT EVERY OBJECT INHERITS.
 *
 * /syslog/v1/logs resolves each line's service once per batch, by the name
 * the line gives (the header's, else APP-NAME, else HOSTNAME), and kept what
 * it resolved in a plain object. A plain object answers for every name it
 * inherits: `cache["constructor"]` is the Object function, so the lookup was
 * skipped, the row was built from a function where the service was, that
 * threw, and the line was not stored. The cache is a Map now, which answers
 * only for the names put in it.
 *
 * The queue and the response stack are replaced (they pull in BullMQ and
 * Express at import time); the databases are stubbed at their services, as
 * in SyslogIngestVendorMessages.test.ts.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

import SyslogIngestService from "../../FeatureSet/Telemetry/Services/SyslogIngestService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import LogService from "Common/Server/Services/LogService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import { ExpressRequest } from "Common/Server/Utils/Express";
import SyslogDeviceMatcher from "Common/Server/Utils/Syslog/SyslogDeviceMatcher";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { INHERITED_PROPERTY_NAMES } from "Common/Tests/Helpers/InheritedNames";

type MockedFn = jest.Mock;

const PROJECT: ObjectID = ObjectID.generate();

const PROTOTYPE_KEYS: Array<string> = Object.getOwnPropertyNames(
  Object.prototype,
).sort();

let submittedRows: Array<JSONObject> = [];
let resolveService: MockedFn;
const serviceIds: Map<string, ObjectID> = new Map();

function serviceIdFor(serviceName: string): ObjectID {
  if (!serviceIds.has(serviceName)) {
    serviceIds.set(serviceName, ObjectID.generate());
  }

  return serviceIds.get(serviceName)!;
}

beforeEach(() => {
  SyslogDeviceMatcher.clearCaches();
  submittedRows = [];

  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([] as never);

  resolveService = jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation((async (data: {
      serviceName: string;
    }): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: data.serviceName,
        primaryEntityId: serviceIdFor(data.serviceName),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 30,
        serviceRetentionConfig: null,
        serviceRetentionInDays: 30,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
    }) as never) as unknown as MockedFn;

  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    service: unknown,
    rows: Array<JSONObject>,
  ): Promise<{ flushed: Promise<void> }> => {
    expect(service).toBe(LogService);
    submittedRows.push(...rows);

    return { flushed: Promise.resolve() };
  }) as never);

  jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  SyslogDeviceMatcher.clearCaches();
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(
    PROTOTYPE_KEYS,
  );
});

async function ingest(
  messages: Array<string>,
  headers: Record<string, string> = {},
): Promise<void> {
  await SyslogIngestService.processSyslogFromQueue({
    projectId: PROJECT,
    body: { messages: messages },
    headers: headers,
    query: {},
  } as unknown as ExpressRequest);
}

function serviceNameOf(row: JSONObject): unknown {
  return (row["attributes"] as JSONObject)["oneuptime.service.name"];
}

describe("syslog from a service named like what every object inherits", () => {
  test.each(INHERITED_PROPERTY_NAMES)(
    "a line whose APP-NAME is %s is stored under that service",
    async (name: string) => {
      await ingest([
        `<13>1 2026-11-15T10:00:00Z web-01 ${name} - - - request failed`,
      ]);

      expect(submittedRows).toHaveLength(1);
      expect(serviceNameOf(submittedRows[0]!)).toBe(name);
      expect(submittedRows[0]!["primaryEntityId"]).toBe(
        serviceIdFor(name).toString(),
      );
      expect(resolveService).toHaveBeenCalledTimes(1);
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a line with no APP-NAME from a HOSTNAME of %s is stored under that service",
    async (name: string) => {
      await ingest([
        `<13>1 2026-11-15T10:00:00Z ${name} - - - - request failed`,
      ]);

      expect(submittedRows).toHaveLength(1);
      expect(serviceNameOf(submittedRows[0]!)).toBe(name);
      expect(submittedRows[0]!["primaryEntityId"]).toBe(
        serviceIdFor(name).toString(),
      );
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a batch sent with the service name %s in its header is stored under it, every line of it",
    async (name: string) => {
      await ingest(
        [
          "<13>1 2026-11-15T10:00:00Z web-01 app - - - one",
          "<13>1 2026-11-15T10:00:01Z web-01 app - - - two",
        ],
        { "x-oneuptime-service-name": name },
      );

      expect(submittedRows).toHaveLength(2);
      expect(submittedRows.map(serviceNameOf)).toEqual([name, name]);
      // Resolved once for the batch, as any other name is.
      expect(resolveService).toHaveBeenCalledTimes(1);
    },
  );

  test("a batch from several services, inherited names among them, resolves each once and keeps each line", async () => {
    await ingest([
      "<13>1 2026-11-15T10:00:00Z web-01 constructor - - - one",
      "<13>1 2026-11-15T10:00:01Z web-01 __proto__ - - - two",
      "<13>1 2026-11-15T10:00:02Z web-01 checkout - - - three",
      "<13>1 2026-11-15T10:00:03Z web-01 constructor - - - four",
      "<13>1 2026-11-15T10:00:04Z web-01 __proto__ - - - five",
    ]);

    expect(submittedRows.map(serviceNameOf)).toEqual([
      "constructor",
      "__proto__",
      "checkout",
      "constructor",
      "__proto__",
    ]);
    expect(resolveService).toHaveBeenCalledTimes(3);
  });
});
