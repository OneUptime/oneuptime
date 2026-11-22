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
import Service from "Common/Models/DatabaseModels/Service";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogService from "Common/Server/Services/LogService";
import CommonLogScrubRuleService from "Common/Server/Services/LogScrubRuleService";
import MetricPipelineRuleService from "Common/Server/Services/MetricPipelineRuleService";
import ServiceService from "Common/Server/Services/ServiceService";
import SpanService from "Common/Server/Services/SpanService";
import CommonTraceScrubRuleService from "Common/Server/Services/TraceScrubRuleService";
import CreateBy from "Common/Server/Types/Database/CreateBy";
import FindOneBy from "Common/Server/Types/Database/FindOneBy";
import { createScrubRuleForFinding } from "Common/Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import TraceScrubAction from "Common/Types/Trace/TraceScrubAction";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A SCRUB RULE FOR ONE SERVICE, THROUGH LOG AND TRACE INGEST (#10433).
 *
 * Scrub It makes its rule for the service a finding was seen in. Here two
 * services send in one OTLP request - checkout, where the email was found,
 * and payments - through OtelLogsIngestService and OtelTracesIngestService:
 * a rule for checkout scrubs checkout's records (a span's exception with
 * its span) and leaves payments' as they came; a rule for every service -
 * every rule saved before a rule could name one - scrubs both, as it did.
 * And Scrub It's own rule, made from a finding of checkout's logs, does
 * exactly what it said. Only the persistence edges are replaced: Postgres
 * (resource resolution, pipelines, drop filters, scrub rules, the exception
 * upsert, auto-discovery) and ClickHouse (the fan-in writer).
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CHECKOUT_ID: string = "0192f1a0-0000-7000-8000-0000001043f1";
const PAYMENTS_ID: string = "0192f1a0-0000-7000-8000-0000001043f2";

const SERVICE_IDS: Record<string, string> = {
  checkout: CHECKOUT_ID,
  payments: PAYMENTS_ID,
};

const EMAIL: string = "alice@example.com";

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

// A saved log rule, as loadScrubRules hands it to ingest.
function compiledLogRule(rule: LogScrubRule): never {
  return [
    {
      rule: rule,
      regex: regexOf(LogScrubRuleService, rule.patternType as string),
    },
  ] as never;
}

function logEmailRule(serviceId?: string): LogScrubRule {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = "Scrub email addresses";
  rule.projectId = PROJECT_ID;
  rule.patternType = LogScrubPatternType.Email;
  rule.scrubAction = LogScrubAction.Redact;
  rule.fieldsToScrub = LogScrubField.Both;

  if (serviceId) {
    rule.serviceId = new ObjectID(serviceId);
  }

  return rule;
}

function traceEmailRule(serviceId?: string): never {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.name = "Scrub email addresses";
  rule.projectId = PROJECT_ID;
  rule.patternType = TraceScrubPatternType.Email;
  rule.scrubAction = TraceScrubAction.Redact;
  rule.fieldsToScrub = TraceScrubField.All;

  if (serviceId) {
    rule.serviceId = new ObjectID(serviceId);
  }

  return [
    {
      rule: rule,
      regex: regexOf(TraceScrubRuleService, TraceScrubPatternType.Email),
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

    // Each service.name is its own Service, as ingest resolves it.
    jest
      .spyOn(service, "resolveTelemetryResource")
      .mockImplementation(async (resource: unknown) => {
        const attributes: Array<OtlpAttribute> =
          (resource as { attributes: Array<OtlpAttribute> }).attributes || [];
        const serviceName: string =
          attributes.find((item: OtlpAttribute): boolean => {
            return item.key === "service.name";
          })?.value.stringValue || "";

        expect(Object.keys(SERVICE_IDS)).toContain(serviceName);

        return {
          serviceName,
          primaryEntityId: new ObjectID(SERVICE_IDS[serviceName]!),
          primaryEntityType: ServiceType.OpenTelemetry,
          dataRententionInDays: 15,
          serviceRetentionConfig: null,
          serviceRetentionInDays: null,
          projectRetentionConfig: null,
          projectRetentionInDays: 15,
        };
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

// One log line of each service, each naming the same person.
async function ingestLogs(): Promise<Record<string, JSONObject>> {
  await OtelLogsIngestService.processLogsFromQueue(
    request({
      resourceLogs: ["checkout", "payments"].map((serviceName: string) => {
        return {
          resource: { attributes: [attribute("service.name", serviceName)] },
          scopeLogs: [
            {
              scope: {},
              logRecords: [
                {
                  timeUnixNano: `${Date.now()}000000`,
                  severityNumber: 9,
                  body: { stringValue: `sign-in by ${EMAIL}` },
                  attributes: [attribute("user.email", EMAIL)],
                },
              ],
            },
          ],
        };
      }),
    }),
  );

  expect(logRows).toHaveLength(2);

  return rowsByService(logRows);
}

// One span of each service, each failing with an exception that names the person.
async function ingestSpans(): Promise<Record<string, JSONObject>> {
  const nowNano: string = `${Date.now()}000000`;

  await OtelTracesIngestService.processTracesFromQueue(
    request({
      resourceSpans: ["checkout", "payments"].map(
        (serviceName: string, index: number) => {
          return {
            resource: {
              attributes: [attribute("service.name", serviceName)],
            },
            scopeSpans: [
              {
                scope: {},
                spans: [
                  {
                    traceId: "0af7651916cd43dd8448eb211c80319c",
                    spanId: `b7ad6b716920333${index}`,
                    parentSpanId: "",
                    name: "POST /sign-in",
                    kind: 2,
                    startTimeUnixNano: nowNano,
                    endTimeUnixNano: nowNano,
                    status: { code: 2, message: `refused ${EMAIL}` },
                    attributes: [attribute("enduser.id", EMAIL)],
                    events: [
                      {
                        name: "exception",
                        timeUnixNano: nowNano,
                        attributes: [
                          attribute(
                            "exception.message",
                            `no account for ${EMAIL}`,
                          ),
                          attribute("exception.type", "NotFound"),
                          attribute(
                            "exception.stacktrace",
                            "Error: no account\n    at signIn (auth.js:10:5)",
                          ),
                        ],
                      },
                    ],
                    links: [],
                  },
                ],
              },
            ],
          };
        },
      ),
    }),
  );

  expect(spanRows).toHaveLength(2);

  return rowsByService(spanRows);
}

function rowsByService(rows: Array<JSONObject>): Record<string, JSONObject> {
  const byService: Record<string, JSONObject> = {};

  for (const row of rows) {
    const id: string = String(row["primaryEntityId"]).toLowerCase();

    byService[id === CHECKOUT_ID ? "checkout" : "payments"] = row;
  }

  return byService;
}

function exceptionOf(serviceId: string): JSONObject {
  const row: JSONObject | undefined = exceptionRows.find(
    (exception: JSONObject): boolean => {
      return String(exception["primaryEntityId"]).toLowerCase() === serviceId;
    },
  );

  expect(row).toBeDefined();

  return row!;
}

beforeEach(() => {
  logRows = [];
  spanRows = [];
  exceptionRows = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a log rule for one service", () => {
  test("scrubs that service's lines and leaves another service's as they came", async () => {
    setupIngest({ logRules: compiledLogRule(logEmailRule(CHECKOUT_ID)) });

    const rows: Record<string, JSONObject> = await ingestLogs();

    expect(rows["checkout"]!["body"]).toBe("sign-in by [REDACTED]");
    expect((rows["checkout"]!["attributes"] as JSONObject)["user.email"]).toBe(
      "[REDACTED]",
    );
    expect(rows["payments"]!["body"]).toBe(`sign-in by ${EMAIL}`);
    expect((rows["payments"]!["attributes"] as JSONObject)["user.email"]).toBe(
      EMAIL,
    );
  });

  test("a rule for every service - every rule saved before - scrubs both, as it did", async () => {
    setupIngest({ logRules: compiledLogRule(logEmailRule()) });

    const rows: Record<string, JSONObject> = await ingestLogs();

    for (const serviceName of ["checkout", "payments"]) {
      expect(rows[serviceName]!["body"]).toBe("sign-in by [REDACTED]");
      expect(JSON.stringify(rows[serviceName])).not.toContain(EMAIL);
    }
  });
});

describe("a trace rule for one service", () => {
  test("scrubs that service's spans and their exceptions, and leaves another service's as they came", async () => {
    setupIngest({ traceRules: traceEmailRule(PAYMENTS_ID) });

    const rows: Record<string, JSONObject> = await ingestSpans();

    expect((rows["payments"]!["attributes"] as JSONObject)["enduser.id"]).toBe(
      "[REDACTED]",
    );
    expect(rows["payments"]!["statusMessage"]).toBe("refused [REDACTED]");
    expect(exceptionOf(PAYMENTS_ID)["message"]).toBe(
      "no account for [REDACTED]",
    );

    expect((rows["checkout"]!["attributes"] as JSONObject)["enduser.id"]).toBe(
      EMAIL,
    );
    expect(rows["checkout"]!["statusMessage"]).toBe(`refused ${EMAIL}`);
    expect(exceptionOf(CHECKOUT_ID)["message"]).toBe(`no account for ${EMAIL}`);
  });

  test("a rule for every service scrubs both services' spans and exceptions", async () => {
    setupIngest({ traceRules: traceEmailRule() });

    await ingestSpans();

    for (const row of [...spanRows, ...exceptionRows]) {
      expect(JSON.stringify(row)).not.toContain(EMAIL);
    }
  });
});

describe("Scrub It's own rule, through ingest", () => {
  test("made from a finding in checkout's logs, it scrubs checkout's logs and no other service's", async () => {
    let made: LogScrubRule | null = null;

    // Postgres, for Scrub It: no rule covers the finding yet, and the service is checkout.
    jest
      .spyOn(CommonLogScrubRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(CommonTraceScrubRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(MetricPipelineRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ServiceService, "findOneBy")
      .mockImplementation((async (
        findOneBy: FindOneBy<Service>,
      ): Promise<Service | null> => {
        const id: string = String(
          (findOneBy.query as Record<string, unknown>)["_id"],
        );
        const service: Service = new Service(new ObjectID(id));
        service.name = id === CHECKOUT_ID ? "checkout" : "payments";

        return service;
      }) as never);
    jest
      .spyOn(CommonLogScrubRuleService, "create")
      .mockImplementation((async (
        createBy: CreateBy<LogScrubRule>,
      ): Promise<LogScrubRule> => {
        made = createBy.data;
        made._id = ObjectID.generate().toString();

        return made;
      }) as never);

    await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryLogs,
      dataTypeId: "email-address",
      location: "attributes.user.email",
      serviceId: CHECKOUT_ID,
    });

    expect(made).not.toBeNull();
    expect(made!.serviceId?.toString()).toBe(CHECKOUT_ID);

    setupIngest({ logRules: compiledLogRule(made!) });

    const rows: Record<string, JSONObject> = await ingestLogs();

    expect((rows["checkout"]!["attributes"] as JSONObject)["user.email"]).toBe(
      "[REDACTED]",
    );
    expect((rows["payments"]!["attributes"] as JSONObject)["user.email"]).toBe(
      EMAIL,
    );
    // Its fields to scrub are the finding's part of the record: the attributes.
    expect(rows["checkout"]!["body"]).toBe(`sign-in by ${EMAIL}`);
  });
});
