/*
 * The user an exception's occurrence happened to, end to end through the
 * real OTLP walk: OTLP JSON -> processTracesFromQueue / processLogsFromQueue
 * -> the occurrence row's userId, the column the exceptions list counts as
 * the row's affected users.
 *
 * On a span, the user is almost never on the exception event itself: an
 * HTTP server span names its request's user (enduser.id, user.id), and a
 * browser's resource names its visitor. The exception row's own attribute
 * bag holds only the event's attributes, so only walking a real payload
 * shows that the span's and the resource's keys are read - and that they are
 * read after the project's scrub rules, so a redacted id stays redacted.
 */
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import SpanService from "Common/Server/Services/SpanService";
import LogService from "Common/Server/Services/LogService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import TraceScrubAction from "Common/Types/Trace/TraceScrubAction";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { MAX_EXCEPTION_USER_ID_LENGTH } from "Common/Utils/Exceptions/ExceptionUserId";
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
const SERVICE_NAME: string = "user-id-test-service";

const TRACE_ID_HEX: string = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID_HEX: string = "b7ad6b7169203331";

const EXCEPTION_MESSAGE: string = "Cart is empty";
const EXCEPTION_STACK: string =
  "Error: Cart is empty\n    at checkout (cart.js:10:5)";

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

type OtlpAttribute = {
  key: string;
  value: { stringValue: string } | { intValue: string };
};

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

type CompiledTraceRule = { rule: TraceScrubRule; regex: ScrubRegExp };

function emailRedactionRule(): Array<CompiledTraceRule> {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.name = "redact emails";
  rule.patternType = TraceScrubPatternType.Email;
  rule.fieldsToScrub = TraceScrubField.Attributes;
  rule.scrubAction = TraceScrubAction.Redact;

  const regex: ScrubRegExp | null = (
    TraceScrubRuleService as unknown as {
      getRegexForPattern: (patternType: string) => ScrubRegExp | null;
    }
  ).getRegexForPattern(TraceScrubPatternType.Email as string);

  return [{ rule: rule, regex: regex as ScrubRegExp }];
}

function setupIngestMocks(data?: {
  traceScrubRules?: Array<CompiledTraceRule>;
}): void {
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
    .mockResolvedValue((data?.traceScrubRules || []) as any);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    .mockResolvedValue([] as any);
  /*
   * Loaded with the scrub rules in one Promise.all: left to reach the
   * database, its failure would drop the scrub rules with it.
   */
  jest
    .spyOn(LlmModelPriceService, "loadModelPrices")
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

function tracesRequest(data: {
  resourceAttributes?: Array<OtlpAttribute>;
  spanAttributes?: Array<OtlpAttribute>;
  eventAttributes?: Array<OtlpAttribute>;
}): TelemetryRequest {
  const nowNano: string = `${Date.now()}000000`;

  return telemetryRequest({
    resourceSpans: [
      {
        resource: {
          attributes: [
            stringAttribute("service.name", SERVICE_NAME),
            ...(data.resourceAttributes || []),
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
                name: "POST /checkout",
                kind: 2,
                startTimeUnixNano: nowNano,
                endTimeUnixNano: nowNano,
                status: { code: 2 },
                attributes: [
                  stringAttribute("http.method", "POST"),
                  ...(data.spanAttributes || []),
                ],
                events: [
                  {
                    name: "exception",
                    timeUnixNano: nowNano,
                    attributes: [
                      stringAttribute("exception.message", EXCEPTION_MESSAGE),
                      stringAttribute("exception.type", "Error"),
                      stringAttribute("exception.stacktrace", EXCEPTION_STACK),
                      ...(data.eventAttributes || []),
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
  resourceAttributes?: Array<OtlpAttribute>;
  logAttributes?: Array<OtlpAttribute>;
}): TelemetryRequest {
  return telemetryRequest({
    resourceLogs: [
      {
        resource: {
          attributes: [
            stringAttribute("service.name", SERVICE_NAME),
            ...(data.resourceAttributes || []),
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

function onlyRow(spy: jest.SpyInstance): JSONObject {
  const rows: Array<JSONObject> = [];
  for (const call of spy.mock.calls) {
    for (const row of call[0] as Array<JSONObject>) {
      rows.push(row);
    }
  }
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe("the user an exception's occurrence happened to", () => {
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

  describe("on the trace path", () => {
    async function ingest(
      data: Parameters<typeof tracesRequest>[0],
      mocks?: Parameters<typeof setupIngestMocks>[0],
    ): Promise<JSONObject> {
      setupIngestMocks(mocks);
      await OtelTracesIngestService.processTracesFromQueue(tracesRequest(data));
      return onlyRow(exceptionInsertSpy);
    }

    test("the span's enduser.id: where an HTTP server names its request's user", async () => {
      const row: JSONObject = await ingest({
        spanAttributes: [stringAttribute("enduser.id", "customer-42")],
      });

      expect(row["userId"]).toBe("customer-42");
    });

    test("the span's user.id", async () => {
      const row: JSONObject = await ingest({
        spanAttributes: [stringAttribute("user.id", "u-7")],
      });

      expect(row["userId"]).toBe("u-7");
    });

    test("the exception event's own before the span's", async () => {
      const row: JSONObject = await ingest({
        eventAttributes: [stringAttribute("user.id", "from-event")],
        spanAttributes: [stringAttribute("user.id", "from-span")],
      });

      expect(row["userId"]).toBe("from-event");
    });

    test("the resource's, when the span names none: a browser's visitor", async () => {
      const row: JSONObject = await ingest({
        resourceAttributes: [stringAttribute("enduser.pseudo.id", "visitor-1")],
      });

      expect(row["userId"]).toBe("visitor-1");
    });

    test("the span's before the resource's", async () => {
      const row: JSONObject = await ingest({
        resourceAttributes: [stringAttribute("user.id", "process-user")],
        spanAttributes: [stringAttribute("enduser.id", "request-user")],
      });

      expect(row["userId"]).toBe("request-user");
    });

    test("a numeric id is its digits", async () => {
      const row: JSONObject = await ingest({
        spanAttributes: [{ key: "enduser.id", value: { intValue: "4242" } }],
      });

      expect(row["userId"]).toBe("4242");
    });

    test("none named: '', and the event's attribute bag is unchanged", async () => {
      const row: JSONObject = await ingest({
        spanAttributes: [stringAttribute("user.email", "ana@example.com")],
      });

      expect(row["userId"]).toBe("");
      expect(row["attributes"]).not.toHaveProperty("user.id");
    });

    test("a scrubbed id stays scrubbed: the user is read after the scrub rules", async () => {
      const row: JSONObject = await ingest(
        { spanAttributes: [stringAttribute("enduser.id", "ana@example.com")] },
        { traceScrubRules: emailRedactionRule() },
      );

      expect(row["userId"]).not.toContain("ana@example.com");
      expect(String(row["userId"]).length).toBeGreaterThan(0);
    });

    test("a megabyte-long id is cut to the longest id kept", async () => {
      const row: JSONObject = await ingest({
        spanAttributes: [stringAttribute("user.id", "x".repeat(1024 * 1024))],
      });

      expect(row["userId"]).toHaveLength(MAX_EXCEPTION_USER_ID_LENGTH);
    });

    test("the user is not part of the group: the fingerprint is the same whoever it happened to", async () => {
      const first: JSONObject = await ingest({
        spanAttributes: [stringAttribute("user.id", "ana")],
      });
      jest.restoreAllMocks();
      jest.spyOn(SpanService, "insertJsonRows").mockResolvedValue(undefined);
      exceptionInsertSpy = jest
        .spyOn(ExceptionInstanceService, "insertJsonRows")
        .mockResolvedValue(undefined);
      jest
        .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
        .mockResolvedValue(undefined);

      const second: JSONObject = await ingest({
        spanAttributes: [stringAttribute("user.id", "ben")],
      });

      expect(first["fingerprint"]).toBe(second["fingerprint"]);
      expect([first["userId"], second["userId"]]).toEqual(["ana", "ben"]);
    });

    test("the group upsert carries no user: users are counted from the occurrences", async () => {
      await ingest({ spanAttributes: [stringAttribute("user.id", "ana")] });

      expect(upsertedPayloads).toHaveLength(1);
      expect(upsertedPayloads[0]).not.toHaveProperty("userId");
    });
  });

  describe("on the log path", () => {
    async function ingest(
      data: Parameters<typeof logsRequest>[0],
    ): Promise<JSONObject> {
      setupIngestMocks();
      await OtelLogsIngestService.processLogsFromQueue(logsRequest(data));
      return onlyRow(exceptionInsertSpy);
    }

    test("the log record's own user.id", async () => {
      const row: JSONObject = await ingest({
        logAttributes: [stringAttribute("user.id", "log-user")],
      });

      expect(row["userId"]).toBe("log-user");
    });

    test("the resource's enduser.id when the record names none", async () => {
      const row: JSONObject = await ingest({
        resourceAttributes: [stringAttribute("enduser.id", "resource-user")],
      });

      expect(row["userId"]).toBe("resource-user");
    });

    test("the record's own before the resource's", async () => {
      const row: JSONObject = await ingest({
        resourceAttributes: [stringAttribute("enduser.id", "resource-user")],
        logAttributes: [stringAttribute("enduser.pseudo.id", "record-user")],
      });

      expect(row["userId"]).toBe("record-user");
    });

    test("none named: ''", async () => {
      const row: JSONObject = await ingest({});

      expect(row["userId"]).toBe("");
    });
  });
});
