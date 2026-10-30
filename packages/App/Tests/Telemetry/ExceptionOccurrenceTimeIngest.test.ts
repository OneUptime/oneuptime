/*
 * The time an exception occurrence happened reaches its group, end to end
 * through the real OTLP walk: OTLP JSON -> processTracesFromQueue /
 * processLogsFromQueue -> the group upsert's payload.
 *
 * The group's first and last seen used to be the time a worker read the
 * batch. A queue that backed up an hour moved them an hour forward, and an
 * exception resolved in that hour was reopened by occurrences that happened
 * before it was resolved. The span event's time (traces) and the log
 * record's (logs) are what the group is kept by now - only walking a real
 * payload shows which time the row builders actually hand on.
 */
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import SpanService from "Common/Server/Services/SpanService";
import LogService from "Common/Server/Services/LogService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "occurrence-time-test-service";

/*
 * Two hours before the test runs: far enough from "now" that a payload
 * stamped with the worker's clock could never pass for it.
 */
const OCCURRED_AT_MS: number = Date.now() - 2 * 60 * 60 * 1000;
const OCCURRED_AT_NANO: string = `${OCCURRED_AT_MS}000000`;

const EXCEPTION_MESSAGE: string = "Something broke";
const EXCEPTION_STACK: string =
  "Error: Something broke\n    at handler (app.js:10:5)";

// Auto-discovery methods on OtelIngestBaseService that hit Postgres.
const AUTO_DISCOVERY_METHODS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

type OtlpAttribute = { key: string; value: { stringValue: string } };

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function setupIngestMocks(): void {
  for (const ingestService of [
    OtelTracesIngestService,
    OtelLogsIngestService,
  ]) {
    const service: Record<string, any> = ingestService as unknown as {
      [key: string]: any;
    };

    for (const method of AUTO_DISCOVERY_METHODS_RETURNING_NULL) {
      jest.spyOn(service, method).mockResolvedValue(null);
    }

    jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
      serviceName: SERVICE_NAME,
      primaryEntityId: SERVICE_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    });
  }

  jest
    .spyOn(TraceDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as any);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as any);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    .mockResolvedValue([] as any);
  jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([] as any);
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as any);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as any);
}

function telemetryRequest(body: JSONObject): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: body,
    headers: {},
  } as unknown as TelemetryRequest;
}

function tracesRequest(): TelemetryRequest {
  // The span itself ran now; only its exception event is two hours old.
  const nowNano: string = `${Date.now()}000000`;

  return telemetryRequest({
    resourceSpans: [
      {
        resource: {
          attributes: [stringAttribute("service.name", SERVICE_NAME)],
        },
        scopeSpans: [
          {
            scope: {},
            spans: [
              {
                traceId: "0af7651916cd43dd8448eb211c80319c",
                spanId: "b7ad6b7169203331",
                parentSpanId: "",
                name: "GET /checkout",
                kind: 2,
                startTimeUnixNano: nowNano,
                endTimeUnixNano: nowNano,
                status: { code: 2 },
                attributes: [],
                events: [
                  {
                    name: "exception",
                    timeUnixNano: OCCURRED_AT_NANO,
                    attributes: [
                      stringAttribute("exception.message", EXCEPTION_MESSAGE),
                      stringAttribute("exception.type", "Error"),
                      stringAttribute("exception.stacktrace", EXCEPTION_STACK),
                    ],
                  },
                ],
                links: [],
              },
            ],
          },
        ],
      },
    ],
  });
}

function logsRequest(): TelemetryRequest {
  return telemetryRequest({
    resourceLogs: [
      {
        resource: {
          attributes: [stringAttribute("service.name", SERVICE_NAME)],
        },
        scopeLogs: [
          {
            scope: {},
            logRecords: [
              {
                timeUnixNano: OCCURRED_AT_NANO,
                severityNumber: 17,
                body: { stringValue: EXCEPTION_MESSAGE },
                attributes: [
                  stringAttribute("exception.message", EXCEPTION_MESSAGE),
                  stringAttribute("exception.type", "Error"),
                  stringAttribute("exception.stacktrace", EXCEPTION_STACK),
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

describe("an exception occurrence's own time reaches its group", () => {
  let upsertedPayloads: Array<TelemetryExceptionPayload>;

  beforeAll(() => {
    TelemetryFanInWriter.configure({
      maxWaitMs: 10,
      maxBatchRows: 50,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
    });
  });

  beforeEach(() => {
    setupIngestMocks();
    jest.spyOn(SpanService, "insertJsonRows").mockResolvedValue(undefined);
    jest.spyOn(LogService, "insertJsonRows").mockResolvedValue(undefined);
    jest
      .spyOn(ExceptionInstanceService, "insertJsonRows")
      .mockResolvedValue(undefined);
    upsertedPayloads = [];
    jest
      .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
      .mockImplementation(
        async (exceptions: Array<TelemetryExceptionPayload>): Promise<void> => {
          for (const exception of exceptions) {
            upsertedPayloads.push({ ...exception });
          }
        },
      );
  });

  afterEach(async () => {
    await TelemetryFanInWriter.flushAll();
    jest.restoreAllMocks();
  });

  test("trace path: the span event's time, not the worker's clock", async () => {
    await OtelTracesIngestService.processTracesFromQueue(tracesRequest());

    expect(upsertedPayloads).toHaveLength(1);
    expect(upsertedPayloads[0]!.occurredAt).toBeInstanceOf(Date);
    expect(upsertedPayloads[0]!.occurredAt!.getTime()).toBe(OCCURRED_AT_MS);
  });

  test("log path: the log record's time, not the worker's clock", async () => {
    await OtelLogsIngestService.processLogsFromQueue(logsRequest());

    expect(upsertedPayloads).toHaveLength(1);
    expect(upsertedPayloads[0]!.occurredAt).toBeInstanceOf(Date);
    expect(upsertedPayloads[0]!.occurredAt!.getTime()).toBe(OCCURRED_AT_MS);
  });
});
