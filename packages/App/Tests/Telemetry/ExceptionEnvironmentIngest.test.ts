/*
 * The environment an exception is stored with, end to end through the real
 * OTLP walk: OTLP JSON -> processTracesFromQueue / processLogsFromQueue ->
 * the exception row and the exception group upsert.
 *
 * OpenTelemetry renamed deployment.environment to
 * deployment.environment.name, and the exception paths read only the old
 * key: an SDK on the current conventions stored every exception with no
 * environment, so an Exceptions monitor scoped to an environment never
 * counted it. The resource attribute arrives as
 * "resource.deployment.environment.name" - only walking a real payload
 * shows which key the row builders actually read.
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
const SERVICE_NAME: string = "environment-test-service";

const TRACE_ID_HEX: string = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID_HEX: string = "b7ad6b7169203331";

const EXCEPTION_MESSAGE: string = "Something broke";
const EXCEPTION_STACK: string =
  "Error: Something broke\n    at handler (app.js:10:5)";

/*
 * Auto-discovery methods on OtelIngestBaseService that hit Postgres.
 * Mirrors TelemetryFanInIngest.test.ts in this directory.
 */
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

function exceptionEvent(): JSONObject {
  const nowNano: string = `${Date.now()}000000`;
  return {
    name: "exception",
    timeUnixNano: nowNano,
    attributes: [
      stringAttribute("exception.message", EXCEPTION_MESSAGE),
      stringAttribute("exception.type", "Error"),
      stringAttribute("exception.stacktrace", EXCEPTION_STACK),
      // A non-exception event attribute, to prove the bag survives at all.
      stringAttribute("event.origin", "window.onerror"),
    ],
  };
}

/*
 * `spanAttributes` deliberately defaults to EMPTY: the resource-attribute
 * case is the one that matters, and a span-level session.id would mask a
 * broken resource-attribute read.
 */
function tracesRequest(data: {
  resourceAttributes: Array<OtlpAttribute>;
  spanAttributes?: Array<OtlpAttribute>;
}): TelemetryRequest {
  const nowNano: string = `${Date.now()}000000`;

  return telemetryRequest({
    resourceSpans: [
      {
        resource: {
          attributes: [
            stringAttribute("service.name", SERVICE_NAME),
            ...data.resourceAttributes,
          ],
        },
        scopeSpans: [
          {
            scope: {},
            spans: [
              {
                traceId: TRACE_ID_HEX,
                spanId: SPAN_ID_HEX,
                parentSpanId: "",
                name: "GET /checkout",
                kind: 2,
                startTimeUnixNano: nowNano,
                endTimeUnixNano: nowNano,
                status: { code: 2 },
                attributes: [
                  stringAttribute("http.method", "GET"),
                  ...(data.spanAttributes || []),
                ],
                events: [exceptionEvent()],
                links: [],
              },
            ],
          },
        ],
      },
    ],
  });
}

function logsRequest(data: {
  resourceAttributes: Array<OtlpAttribute>;
  logAttributes?: Array<OtlpAttribute>;
}): TelemetryRequest {
  return telemetryRequest({
    resourceLogs: [
      {
        resource: {
          attributes: [
            stringAttribute("service.name", SERVICE_NAME),
            ...data.resourceAttributes,
          ],
        },
        scopeLogs: [
          {
            scope: {},
            logRecords: [
              {
                timeUnixNano: `${Date.now()}000000`,
                severityNumber: 17,
                body: { stringValue: EXCEPTION_MESSAGE },
                attributes: [
                  /*
                   * Explicit OTel exception.* attributes so
                   * LogExceptionExtractor path A fires deterministically
                   * (no reliance on the body heuristic).
                   */
                  stringAttribute("exception.message", EXCEPTION_MESSAGE),
                  stringAttribute("exception.type", "Error"),
                  stringAttribute("exception.stacktrace", EXCEPTION_STACK),
                  ...(data.logAttributes || []),
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

function insertedRows(spy: jest.SpyInstance): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  for (const call of spy.mock.calls) {
    for (const row of call[0] as Array<JSONObject>) {
      rows.push(row);
    }
  }
  return rows;
}

function onlyRow(spy: jest.SpyInstance): JSONObject {
  const rows: Array<JSONObject> = insertedRows(spy);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe("Exception environment from the resource's deployment environment", () => {
  let exceptionInsertSpy: jest.SpyInstance;
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
    exceptionInsertSpy = jest
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

  type Ingest = (resourceAttributes: Array<OtlpAttribute>) => Promise<void>;

  const paths: Array<[string, Ingest]> = [
    [
      "trace path",
      async (resourceAttributes: Array<OtlpAttribute>): Promise<void> => {
        await OtelTracesIngestService.processTracesFromQueue(
          tracesRequest({ resourceAttributes }),
        );
      },
    ],
    [
      "log path",
      async (resourceAttributes: Array<OtlpAttribute>): Promise<void> => {
        await OtelLogsIngestService.processLogsFromQueue(
          logsRequest({ resourceAttributes }),
        );
      },
    ],
  ];

  describe.each(paths)("%s", (_name: string, ingest: Ingest) => {
    test("the current deployment.environment.name key reaches the row and the group", async () => {
      await ingest([
        stringAttribute("deployment.environment.name", "production"),
        stringAttribute("service.version", "2.3.1"),
      ]);

      const row: JSONObject = onlyRow(exceptionInsertSpy);
      expect(row["environment"]).toBe("production");
      expect(row["release"]).toBe("2.3.1");

      expect(upsertedPayloads).toHaveLength(1);
      expect(upsertedPayloads[0]!.environment).toBe("production");
      expect(upsertedPayloads[0]!.release).toBe("2.3.1");
    });

    test("the old deployment.environment key still counts", async () => {
      await ingest([stringAttribute("deployment.environment", "staging")]);

      expect(onlyRow(exceptionInsertSpy)["environment"]).toBe("staging");
      expect(upsertedPayloads[0]!.environment).toBe("staging");
    });

    test("the current key wins when a resource sends both", async () => {
      await ingest([
        stringAttribute("deployment.environment", "old-name"),
        stringAttribute("deployment.environment.name", "new-name"),
      ]);

      expect(onlyRow(exceptionInsertSpy)["environment"]).toBe("new-name");
      expect(upsertedPayloads[0]!.environment).toBe("new-name");
    });

    test("no environment yields '' on the row and none on the group", async () => {
      await ingest([]);

      expect(onlyRow(exceptionInsertSpy)["environment"]).toBe("");
      expect(upsertedPayloads[0]!.environment).toBeUndefined();
    });
  });
});
