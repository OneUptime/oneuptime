import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import { toTraceScanSpan } from "Common/Server/Utils/SecurityEvent/TelemetryScan/TraceSecurityScan";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import TraceScrubAction from "Common/Types/Trace/TraceScrubAction";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import {
  buildTraceSecurityEvents,
  SSRF_TARGET_ATTRIBUTE,
} from "Common/Utils/SecurityEvent/TelemetryScan/TraceSignals";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * IP ADDRESS AND HASH SCRUB RULES THROUGH LOG AND TRACE INGEST (#10393,
 * #10394).
 *
 * OTLP/JSON log and trace requests through OtelLogsIngestService and
 * OtelTracesIngestService with a project's IP Address rule - the rows they
 * write, a span's exception with them - and the stored span read by
 * Security Events' trace scan. Only the persistence edges are replaced:
 * Postgres (resource resolution, pipelines, drop filters, scrub rules, the
 * exception upsert, auto-discovery) and ClickHouse (the fan-in writer).
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "checkout-api";

const AUTO_DISCOVERY_METHODS: Array<string> = [
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IngestTestMethods = Record<string, any>;

let logRows: Array<JSONObject> = [];
let spanRows: Array<JSONObject> = [];
let exceptionRows: Array<JSONObject> = [];

function attribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function regexOf(service: unknown, patternType: string): ScrubRegExp {
  const regex: ScrubRegExp | null = (
    service as {
      getRegexForPattern: (patternType: string) => ScrubRegExp | null;
    }
  ).getRegexForPattern(patternType);

  expect(regex).not.toBeNull();

  return regex as ScrubRegExp;
}

// The project's IP Address log rule, as loadScrubRules hands it to ingest.
function logIpRule(action: string): never {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = "Scrub IP addresses";
  rule.projectId = PROJECT_ID;
  rule.patternType = LogScrubPatternType.IPAddress;
  rule.scrubAction = action;
  rule.fieldsToScrub = LogScrubField.Both;

  return [
    {
      rule: rule,
      regex: regexOf(LogScrubRuleService, LogScrubPatternType.IPAddress),
    },
  ] as never;
}

function traceIpRule(action: string): never {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.name = "Scrub IP addresses";
  rule.projectId = PROJECT_ID;
  rule.patternType = TraceScrubPatternType.IPAddress;
  rule.scrubAction = action;
  rule.fieldsToScrub = TraceScrubField.All;

  return [
    {
      rule: rule,
      regex: regexOf(TraceScrubRuleService, TraceScrubPatternType.IPAddress),
    },
  ] as never;
}

function setupIngest(data: {
  logRules?: never | undefined;
  traceRules?: never | undefined;
}): void {
  for (const ingestService of [
    OtelLogsIngestService,
    OtelTracesIngestService,
  ]) {
    const service: IngestTestMethods =
      ingestService as unknown as IngestTestMethods;

    for (const method of AUTO_DISCOVERY_METHODS) {
      jest.spyOn(service, method).mockResolvedValue(null);
    }

    jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
      serviceName: SERVICE_NAME,
      primaryEntityId: new ObjectID(SERVICE_ID.toString()),
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    });
  }

  jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue(data.logRules || ([] as never));
  jest.spyOn(TracePipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(TraceDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    .mockResolvedValue(data.traceRules || ([] as never));
  jest.spyOn(LlmModelPriceService, "loadModelPrices").mockResolvedValue([]);
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
        if (target === LogService) {
          logRows.push(...batch);
        } else if (target === SpanService) {
          spanRows.push(...batch);
        } else if (target === ExceptionInstanceService) {
          exceptionRows.push(...batch);
        } else {
          throw new Error(`unexpected fan-in target ${target.model.tableName}`);
        }

        return { flushed: Promise.resolve() };
      },
    );
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockImplementation(
      async (_payloads: Array<TelemetryExceptionPayload>): Promise<void> => {
        // The exception's group: not what these tests read.
      },
    );
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
}

function request(body: JSONObject): TelemetryRequest {
  return {
    projectId: new ObjectID(PROJECT_ID.toString()),
    body: body,
    headers: {},
  } as unknown as TelemetryRequest;
}

function token(address: string): string {
  return ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address });
}

beforeEach(() => {
  logRows = [];
  spanRows = [];
  exceptionRows = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("log ingest with an IP Address rule", () => {
  async function ingestLog(action: string): Promise<JSONObject> {
    setupIngest({ logRules: logIpRule(action) });

    await OtelLogsIngestService.processLogsFromQueue(
      request({
        resourceLogs: [
          {
            resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
            scopeLogs: [
              {
                scope: {},
                logRecords: [
                  {
                    timeUnixNano: `${Date.now()}000000`,
                    severityNumber: 9,
                    body: {
                      stringValue:
                        "request from 2001:4860:4860::8888 via 10.0.0.12 to http://169.254.169.254/latest/meta-data/",
                    },
                    attributes: [
                      attribute("client.address", "::ffff:8.8.8.8"),
                      attribute("net.peer.ip", "169.254.169.254"),
                      attribute("server.address", "fe80::1%eth0"),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(logRows).toHaveLength(1);

    return logRows[0]!;
  }

  test("Hash: a public address becomes the project's token, a private one stays", async () => {
    const row: JSONObject = await ingestLog(LogScrubAction.Hash);
    const attributes: JSONObject = row["attributes"] as JSONObject;

    expect(row["body"]).toBe(
      `request from ${token("2001:4860:4860::8888")} via 10.0.0.12 to http://169.254.169.254/latest/meta-data/`,
    );
    // An IPv4 address written as IPv6 is the IPv4 address: its token.
    expect(attributes["client.address"]).toBe(token("8.8.8.8"));
    expect(attributes["net.peer.ip"]).toBe("169.254.169.254");
    expect(attributes["server.address"]).toBe("fe80::1%eth0");
    expect(JSON.stringify(row)).not.toContain("2001:4860:4860::8888");
    expect(JSON.stringify(row)).not.toContain("8.8.8.8");
  });

  test("Redact and Mask hide the public addresses the same way", async () => {
    const redacted: JSONObject = await ingestLog(LogScrubAction.Redact);

    expect(redacted["body"]).toBe(
      "request from [REDACTED] via 10.0.0.12 to http://169.254.169.254/latest/meta-data/",
    );
    expect((redacted["attributes"] as JSONObject)["client.address"]).toBe(
      "[REDACTED]",
    );

    jest.restoreAllMocks();
    logRows = [];

    const masked: JSONObject = await ingestLog(LogScrubAction.Mask);

    expect(masked["body"]).toBe(
      "request from ****:****:****:****:****:****:****:**** via 10.0.0.12 to http://169.254.169.254/latest/meta-data/",
    );
    expect((masked["attributes"] as JSONObject)["client.address"]).toBe(
      "***.***.***.***",
    );
  });
});

describe("trace ingest with an IP Address rule", () => {
  async function ingestTrace(action: string): Promise<JSONObject> {
    setupIngest({ traceRules: traceIpRule(action) });

    const nowNano: string = `${Date.now()}000000`;

    await OtelTracesIngestService.processTracesFromQueue(
      request({
        resourceSpans: [
          {
            resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
            scopeSpans: [
              {
                scope: {},
                spans: [
                  {
                    traceId: "0af7651916cd43dd8448eb211c80319c",
                    spanId: "b7ad6b7169203331",
                    parentSpanId: "",
                    name: "GET /fetch",
                    kind: 2,
                    startTimeUnixNano: nowNano,
                    endTimeUnixNano: nowNano,
                    status: { code: 2, message: "upstream 8.8.4.4 refused" },
                    attributes: [
                      attribute("http.request.method", "GET"),
                      attribute("url.path", "/fetch"),
                      attribute(
                        "url.query",
                        "target=http://169.254.169.254/latest/meta-data/",
                      ),
                      attribute("client.address", "2001:4860:4860::8888"),
                      attribute("server.address", "10.0.0.5"),
                    ],
                    events: [
                      {
                        name: "exception",
                        timeUnixNano: nowNano,
                        attributes: [
                          attribute(
                            "exception.message",
                            "connect 8.8.8.8 refused from 10.0.0.5",
                          ),
                          attribute("exception.type", "ECONNREFUSED"),
                          attribute(
                            "exception.stacktrace",
                            "Error: connect 8.8.8.8\n    at dial (net.js:10:5)",
                          ),
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
      }),
    );

    expect(spanRows).toHaveLength(1);

    return spanRows[0]!;
  }

  test("Hash: the span's public addresses become the project's tokens, the metadata address stays", async () => {
    const row: JSONObject = await ingestTrace(TraceScrubAction.Hash);
    const attributes: JSONObject = row["attributes"] as JSONObject;

    expect(attributes["client.address"]).toBe(token("2001:4860:4860::8888"));
    expect(attributes["server.address"]).toBe("10.0.0.5");
    expect(attributes["url.query"]).toBe(
      "target=http://169.254.169.254/latest/meta-data/",
    );
    expect(row["statusMessage"]).toBe(`upstream ${token("8.8.4.4")} refused`);
    expect(JSON.stringify(row)).not.toContain("2001:4860:4860::8888");
    expect(JSON.stringify(row)).not.toContain("8.8.8.8");
  });

  test("the exception recorded on the span is hidden with it", async () => {
    await ingestTrace(TraceScrubAction.Hash);

    expect(exceptionRows).toHaveLength(1);
    expect(exceptionRows[0]!["message"]).toBe(
      `connect ${token("8.8.8.8")} refused from 10.0.0.5`,
    );
    expect(String(exceptionRows[0]!["stackTrace"])).toContain(
      `connect ${token("8.8.8.8")}`,
    );
  });

  test.each([
    TraceScrubAction.Redact,
    TraceScrubAction.Mask,
    TraceScrubAction.Hash,
  ])(
    "the stored span is still found as SSRF by Security Events' trace scan, under %s",
    async (action: string) => {
      const row: JSONObject = await ingestTrace(action);
      const events: Array<NormalizedSecurityEvent> = buildTraceSecurityEvents(
        toTraceScanSpan(row),
      ).filter((event: NormalizedSecurityEvent): boolean => {
        return event.attributes[SSRF_TARGET_ATTRIBUTE] !== undefined;
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.targetHost).toBe("169.254.169.254");
    },
  );
});
