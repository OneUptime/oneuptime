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

/*
 * ---------------------------------------------------------------------------
 * AN EXCEPTION'S STACK TRACE IS INGESTED IN TIME IN LINE WITH ITS LENGTH.
 *
 * Any project that sends telemetry decides what its exceptions' stack
 * traces say: a span's exception.stacktrace is as long as the request that
 * carries it, a log's exception attributes keep 64 KB and an ERROR log's
 * body 16 KB. Each is parsed into frames on the shared ingest workers, and
 * a line built for the patterns that parsed it took close to a minute at
 * 4,000 characters. Here each path is walked end to end - an OTLP body
 * through processTracesFromQueue / processLogsFromQueue to the exception
 * row the real writer builds (ClickHouse mocked) - with such a line among
 * real frames: it is ingested quickly, and the real frames are still found.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "stack-trace-length-test-service";

const TRACE_ID_HEX: string = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID_HEX: string = "b7ad6b7169203331";

const LENGTH: number = 400000;

// What a log keeps of an exception attribute, and of a body it reads.
const LOG_STACK_TRACE_LENGTH: number = 64 * 1024;
const LOG_BODY_LENGTH: number = 16 * 1024;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

// A V8 frame line built so the old patterns tried every split of it.
const builtFrameLine: (length: number) => string = (length: number): string => {
  return "at\t" + repeat("\t", length) + "(:0:0)";
};

const REAL_FRAME: string = "    at handler (/app/src/handler.js:10:5)";

const REAL_PARSED_FRAME: JSONObject = {
  functionName: "handler",
  fileName: "/app/src/handler.js",
  lineNumber: 10,
  columnNumber: 5,
  inApp: true,
};

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

function tracesRequest(stackTrace: string): TelemetryRequest {
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
                traceId: TRACE_ID_HEX,
                spanId: SPAN_ID_HEX,
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
                      stringAttribute("exception.message", "boom"),
                      stringAttribute("exception.type", "Error"),
                      stringAttribute("exception.stacktrace", stackTrace),
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

function logsRequest(data: {
  body: string;
  attributes: Array<OtlpAttribute>;
}): TelemetryRequest {
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
                timeUnixNano: `${Date.now()}000000`,
                severityNumber: 17,
                body: { stringValue: data.body },
                attributes: data.attributes,
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

function parsedFramesOf(spy: jest.SpyInstance): Array<JSONObject> {
  const rows: Array<JSONObject> = insertedRows(spy);
  expect(rows).toHaveLength(1);
  return JSON.parse(rows[0]!["parsedFrames"] as string) as Array<JSONObject>;
}

async function timeOf(run: () => Promise<unknown>): Promise<number> {
  const startedAt: number = Date.now();
  await run();
  return Date.now() - startedAt;
}

describe("an exception's stack trace is ingested in time in line with its length", () => {
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
    jest
      .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
      .mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await TelemetryFanInWriter.flushAll();
    jest.restoreAllMocks();
  });

  test("a span's exception with a built line of 400,000 characters among real frames", async () => {
    const stackTrace: string = [
      "Error: boom",
      REAL_FRAME,
      builtFrameLine(LENGTH),
      REAL_FRAME,
    ].join("\n");

    expect(
      await timeOf(async () => {
        await OtelTracesIngestService.processTracesFromQueue(
          tracesRequest(stackTrace),
        );
        await TelemetryFanInWriter.flushAll();
      }),
    ).toBeLessThan(10000);

    const frames: Array<JSONObject> = parsedFramesOf(exceptionInsertSpy);
    expect(frames[0]).toEqual(REAL_PARSED_FRAME);
    expect(frames[frames.length - 1]).toEqual(REAL_PARSED_FRAME);
  });

  test("a log's exception attribute of the longest a log keeps", async () => {
    const stackTrace: string = [
      REAL_FRAME,
      builtFrameLine(LOG_STACK_TRACE_LENGTH - 2 * REAL_FRAME.length),
    ].join("\n");

    expect(
      await timeOf(async () => {
        await OtelLogsIngestService.processLogsFromQueue(
          logsRequest({
            body: "boom",
            attributes: [
              stringAttribute("exception.message", "boom"),
              stringAttribute("exception.type", "Error"),
              stringAttribute("exception.stacktrace", stackTrace),
            ],
          }),
        );
        await TelemetryFanInWriter.flushAll();
      }),
    ).toBeLessThan(10000);

    expect(parsedFramesOf(exceptionInsertSpy)[0]).toEqual(REAL_PARSED_FRAME);
  });

  test("an ERROR log whose body's first line was built for the type and message", async () => {
    // Long enough that the pattern it was read with before took twice the limit.
    const firstLine: string =
      "A" +
      repeat(".A", 4000) +
      ":" +
      repeat("\t", 4000) +
      "y" +
      String.fromCharCode(0x2028) +
      "x";
    const body: string = [firstLine, REAL_FRAME].join("\n");

    expect(body.length).toBeLessThanOrEqual(LOG_BODY_LENGTH);
    expect(
      await timeOf(async () => {
        await OtelLogsIngestService.processLogsFromQueue(
          logsRequest({ body: body, attributes: [] }),
        );
        await TelemetryFanInWriter.flushAll();
      }),
    ).toBeLessThan(10000);

    expect(parsedFramesOf(exceptionInsertSpy)).toEqual([REAL_PARSED_FRAME]);
  });
});
