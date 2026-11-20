import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import SpanService from "Common/Server/Services/SpanService";
import LogService from "Common/Server/Services/LogService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import { TelemetryUsageAttributeFilter } from "Common/Server/Services/AnalyticsDatabaseService";
import { getBilledExceptionsFilter } from "Common/Server/Services/TelemetryUsageBillingService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  EXCEPTION_SOURCE_ATTRIBUTE,
  ExceptionSource,
} from "Common/Types/Telemetry/ExceptionSource";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Issue #6590: an exception occurrence is billed with the product it was
 * found in, and usage tells which by the row's `exception.source` attribute
 * (ExceptionSource). These run the real OTLP walk and row builders of both
 * ingests - body -> processTracesFromQueue / processLogsFromQueue -> the
 * real TelemetryFanInWriter -> a mocked ClickHouse insert - and read the
 * exception rows back:
 *
 *   - a span's exception says "span", even when the emitter's own event
 *     put "log" under the key, so only the logs ingest can mark a row as
 *     found in a log;
 *   - an exception found in a log record says "log";
 *   - read through the filters the two products' usage scans use, each row
 *     is billed by exactly one of them.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "exception-source-test-service";

const MESSAGE: string = "Something broke";
const STACK: string = "Error: Something broke\n    at handler (app.js:10:5)";

const AUTO_DISCOVERY_METHODS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverOpenStackCloud",
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
    const service: Record<string, unknown> = ingestService as unknown as Record<
      string,
      unknown
    >;

    for (const method of AUTO_DISCOVERY_METHODS_RETURNING_NULL) {
      if (typeof service[method] === "function") {
        jest
          .spyOn(service as never, method as never)
          .mockResolvedValue(null as never);
      }
    }

    jest
      .spyOn(service as never, "resolveTelemetryResource" as never)
      .mockResolvedValue({
        serviceName: SERVICE_NAME,
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      } as never);
  }

  jest
    .spyOn(TraceDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined as never);
}

function request(body: JSONObject): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: body,
    headers: {},
  } as unknown as TelemetryRequest;
}

function tracesBody(eventAttributes: Array<OtlpAttribute>): JSONObject {
  const nowNano: string = `${Date.now()}000000`;

  return {
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
                    timeUnixNano: nowNano,
                    attributes: [
                      stringAttribute("exception.message", MESSAGE),
                      stringAttribute("exception.type", "Error"),
                      stringAttribute("exception.stacktrace", STACK),
                      ...eventAttributes,
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
  } as unknown as JSONObject;
}

function logsBody(): JSONObject {
  return {
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
                timeUnixNano: `${Date.now()}000000`,
                severityNumber: 17,
                body: { stringValue: MESSAGE },
                attributes: [
                  stringAttribute("exception.message", MESSAGE),
                  stringAttribute("exception.type", "Error"),
                  stringAttribute("exception.stacktrace", STACK),
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as JSONObject;
}

function exceptionRows(spy: jest.SpyInstance): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  for (const call of spy.mock.calls) {
    for (const row of call[0] as Array<JSONObject>) {
      rows.push(row);
    }
  }

  return rows;
}

// A Map(String, String) read the way ClickHouse reads one: a missing key is ''.
function matches(
  row: JSONObject,
  filter: TelemetryUsageAttributeFilter,
): boolean {
  const attributes: Record<string, unknown> =
    (row["attributes"] as Record<string, unknown>) || {};
  const value: string = String(attributes[filter.key] ?? "");

  return filter.isEqual ? value === filter.value : value !== filter.value;
}

describe("where an exception was found, as its row says (issue #6590)", () => {
  let exceptionInsertSpy: jest.SpyInstance;

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
  });

  afterEach(async () => {
    await TelemetryFanInWriter.flushAll();
    jest.restoreAllMocks();
  });

  test("an exception found in a span says span", async () => {
    await OtelTracesIngestService.processTracesFromQueue(
      request(tracesBody([stringAttribute("event.origin", "handler")])),
    );
    await TelemetryFanInWriter.flushAll();

    const rows: Array<JSONObject> = exceptionRows(exceptionInsertSpy);

    expect(rows).toHaveLength(1);

    const attributes: JSONObject = rows[0]!["attributes"] as JSONObject;

    expect(attributes[EXCEPTION_SOURCE_ATTRIBUTE]).toBe(ExceptionSource.Span);
    // The emitter's own attributes are kept beside it.
    expect(attributes["event.origin"]).toBe("handler");
    expect(rows[0]!["attributeKeys"]).toContain(EXCEPTION_SOURCE_ATTRIBUTE);
  });

  test("a span's exception says span even when its event put log under the key", async () => {
    await OtelTracesIngestService.processTracesFromQueue(
      request(
        tracesBody([
          stringAttribute(EXCEPTION_SOURCE_ATTRIBUTE, ExceptionSource.Log),
        ]),
      ),
    );
    await TelemetryFanInWriter.flushAll();

    const rows: Array<JSONObject> = exceptionRows(exceptionInsertSpy);

    expect(rows).toHaveLength(1);
    expect(
      (rows[0]!["attributes"] as JSONObject)[EXCEPTION_SOURCE_ATTRIBUTE],
    ).toBe(ExceptionSource.Span);
  });

  test("an exception found in a log record says log", async () => {
    await OtelLogsIngestService.processLogsFromQueue(request(logsBody()));
    await TelemetryFanInWriter.flushAll();

    const rows: Array<JSONObject> = exceptionRows(exceptionInsertSpy);

    expect(rows).toHaveLength(1);
    expect(
      (rows[0]!["attributes"] as JSONObject)[EXCEPTION_SOURCE_ATTRIBUTE],
    ).toBe(ExceptionSource.Log);
  });

  test("each row is billed by exactly one product: Traces the span's, Logs the log's", async () => {
    await OtelTracesIngestService.processTracesFromQueue(
      request(tracesBody([])),
    );
    await OtelLogsIngestService.processLogsFromQueue(request(logsBody()));
    await TelemetryFanInWriter.flushAll();

    const rows: Array<JSONObject> = exceptionRows(exceptionInsertSpy);
    const traces: TelemetryUsageAttributeFilter = getBilledExceptionsFilter(
      ProductType.Traces,
    )!;
    const logs: TelemetryUsageAttributeFilter = getBilledExceptionsFilter(
      ProductType.Logs,
    )!;

    expect(rows).toHaveLength(2);

    for (const row of rows) {
      const billedBy: Array<ProductType> = [
        ...(matches(row, traces) ? [ProductType.Traces] : []),
        ...(matches(row, logs) ? [ProductType.Logs] : []),
      ];
      const source: unknown = (row["attributes"] as JSONObject)[
        EXCEPTION_SOURCE_ATTRIBUTE
      ];

      expect({ source, billedBy }).toEqual({
        source,
        billedBy: [
          source === ExceptionSource.Log
            ? ProductType.Logs
            : ProductType.Traces,
        ],
      });
    }

    // A row written before the source was stamped on spans: Traces, as before.
    expect(matches({ attributes: {} }, traces)).toBe(true);
    expect(matches({ attributes: {} }, logs)).toBe(false);
  });
});
