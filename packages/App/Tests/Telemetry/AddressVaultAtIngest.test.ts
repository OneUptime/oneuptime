import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

import FluentLogsIngestService from "../../FeatureSet/Telemetry/Services/FluentLogsIngestService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import ProbeSyslogIngestService from "../../FeatureSet/Telemetry/Services/ProbeSyslogIngestService";
import SyslogIngestService from "../../FeatureSet/Telemetry/Services/SyslogIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import SecurityLogSource from "Common/Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "Common/Models/DatabaseModels/SecurityTelemetrySource";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogService from "Common/Server/Services/LogService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import SecurityAddressVaultService from "Common/Server/Services/SecurityAddressVaultService";
import SecurityLogSourceService from "Common/Server/Services/SecurityLogSourceService";
import SecurityTelemetrySourceService from "Common/Server/Services/SecurityTelemetrySourceService";
import SpanService from "Common/Server/Services/SpanService";
import { ExpressRequest } from "Common/Server/Utils/Express";
import SecurityAddressVaultWriter from "Common/Server/Utils/SecurityEvent/AddressVault/SecurityAddressVaultWriter";
import SecurityEventsReadTelemetry from "Common/Server/Utils/SecurityEvent/SecurityEventsReadTelemetry";
import SyslogDeviceMatcher from "Common/Server/Utils/Syslog/SyslogDeviceMatcher";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import TelemetryFanInWriter, {
  FanInInsertTarget,
  FanInSubmitResult,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import { SecurityTelemetrySourceKind } from "Common/Types/SecurityEvent/SecurityTelemetrySource";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";

/*
 * ---------------------------------------------------------------------------
 * INGEST WRITES SECURITY EVENTS' ADDRESS VAULT (#10395).
 *
 * Every route logs and traces arrive by - OTLP logs and traces, Fluentd,
 * syslog over HTTP, syslog a probe forwards - from the batch posted to the
 * rows written, with the project's real scrub rules. Only the persistence
 * edges are replaced: Postgres (resources, pipelines, drop filters, scrub
 * rules, the Security Events sources, the exception upsert) and ClickHouse
 * (the fan-in writer, a probe's insert).
 *
 *   - an IP Address Hash rule, in logs or traces Security Events reads:
 *     each address it hid goes to the vault with its token, once a batch,
 *     after the batch's records - and the records hold only the tokens;
 *   - Security Events not reading them, a Redact or Mask rule, a custom
 *     pattern: nothing goes to the vault;
 *   - a vault that refuses the write: the batch is stored, with the
 *     tokens, and the job succeeds.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const PROBE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "checkout-api";

const ATTACKER: string = "203.0.113.7";

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

interface Submission {
  table: string;
  rows: Array<JSONObject>;
}

let submissions: Array<Submission> = [];
let probeRows: Array<JSONObject> = [];
let counted: Array<string> = [];
let logRules: never = [] as never;
let traceRules: never = [] as never;
// What a test does to the vault's own submission.
let vaultSubmit: () => Promise<FanInSubmitResult> = async () => {
  return { flushed: Promise.resolve() };
};
// What a test does to the records' submissions.
let recordAck: () => Promise<void> = async (): Promise<void> => {};

function attribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function tokenOf(address: string): string {
  return ScrubHashToken.ofIpAddress({ projectId: PROJECT_ID, address });
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

function logIpRule(action: string, fields: string = LogScrubField.Both): never {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = "Scrub IP addresses";
  rule.projectId = PROJECT_ID;
  rule.patternType = LogScrubPatternType.IPAddress;
  rule.scrubAction = action;
  rule.fieldsToScrub = fields;

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
  rule.patternType = LogScrubPatternType.IPAddress;
  rule.scrubAction = action;
  rule.fieldsToScrub = TraceScrubField.All;

  return [
    {
      rule: rule,
      regex: regexOf(TraceScrubRuleService, LogScrubPatternType.IPAddress),
    },
  ] as never;
}

// Which of Security Events' sources the project turned on.
function sourcesOn(data: { logs: boolean; traces: boolean }): {
  logs: ReturnType<typeof jest.spyOn>;
  traces: ReturnType<typeof jest.spyOn>;
} {
  return {
    logs: jest
      .spyOn(SecurityLogSourceService, "findOneBy")
      .mockResolvedValue((data.logs ? new SecurityLogSource() : null) as never),
    traces: jest
      .spyOn(SecurityTelemetrySourceService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        query: JSONObject;
      }): Promise<SecurityTelemetrySource | null> => {
        expect(findOneBy.query["kind"]).toBe(
          SecurityTelemetrySourceKind.Traces,
        );
        return data.traces ? new SecurityTelemetrySource() : null;
      }) as never),
  };
}

function vaultRows(): Array<JSONObject> {
  return submissions
    .filter((submission: Submission): boolean => {
      return submission.table === "SecurityAddressVaultV1";
    })
    .flatMap((submission: Submission): Array<JSONObject> => {
      return submission.rows;
    });
}

function vaultPairs(): Array<[string, string]> {
  return vaultRows()
    .map((row: JSONObject): [string, string] => {
      return [String(row["address"]), String(row["token"])];
    })
    .sort();
}

function rowsOf(table: string): Array<JSONObject> {
  return submissions
    .filter((submission: Submission): boolean => {
      return submission.table === table;
    })
    .flatMap((submission: Submission): Array<JSONObject> => {
      return submission.rows;
    });
}

beforeEach(() => {
  submissions = [];
  probeRows = [];
  counted = [];
  logRules = [] as never;
  traceRules = [] as never;
  vaultSubmit = async (): Promise<FanInSubmitResult> => {
    return { flushed: Promise.resolve() };
  };
  recordAck = async (): Promise<void> => {};
  SecurityEventsReadTelemetry.clearCache();
  SecurityAddressVaultWriter.forgetWrites();

  const metadata: TelemetryServiceMetadata = {
    serviceName: SERVICE_NAME,
    primaryEntityId: new ObjectID(SERVICE_ID.toString()),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  } as unknown as TelemetryServiceMetadata;

  for (const ingestService of [
    OtelLogsIngestService,
    OtelTracesIngestService,
  ]) {
    const service: IngestTestMethods =
      ingestService as unknown as IngestTestMethods;

    for (const method of AUTO_DISCOVERY_METHODS) {
      jest.spyOn(service, method).mockResolvedValue(null);
    }

    jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue(metadata);
  }

  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockResolvedValue(metadata as never);
  jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockImplementation((async (): Promise<never> => {
      return logRules;
    }) as never);
  jest.spyOn(TracePipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(TraceDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    .mockImplementation((async (): Promise<never> => {
      return traceRules;
    }) as never);
  jest.spyOn(LlmModelPriceService, "loadModelPrices").mockResolvedValue([]);
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (
        target: FanInInsertTarget,
        rows: Array<JSONObject>,
      ): Promise<FanInSubmitResult> => {
        if (target === SecurityAddressVaultService) {
          const result: FanInSubmitResult = await vaultSubmit();
          submissions.push({ table: target.model.tableName, rows });
          return result;
        }

        if (
          target !== LogService &&
          target !== SpanService &&
          target !== ExceptionInstanceService
        ) {
          throw new Error(`unexpected fan-in target ${target.model.tableName}`);
        }

        submissions.push({ table: target.model.tableName, rows });

        return { flushed: recordAck() };
      },
    );
  jest
    .spyOn(LogService, "insertJsonRows")
    .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
      probeRows.push(...rows);
      submissions.push({ table: LogService.model.tableName, rows });
    });
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockImplementation(
      async (_payloads: Array<TelemetryExceptionPayload>): Promise<void> => {
        // The exception's group: not what these tests read.
      },
    );
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(SyslogDeviceMatcher, "getProbe")
    .mockResolvedValue({ id: PROBE_ID, projectId: PROJECT_ID } as never);
  jest.spyOn(SyslogDeviceMatcher, "attribute").mockResolvedValue({
    devices: [],
    unmatchedProjectId: PROJECT_ID,
  } as never);
  jest.spyOn(AppMetrics, "getAddressVaultWriteCounter").mockReturnValue({
    add: (count: number, attributes?: JSONObject): void => {
      counted.push(
        `${String(attributes?.[AppMetrics.ADDRESS_VAULT_SIGNAL_ATTRIBUTE])}:${String(
          attributes?.[AppMetrics.ADDRESS_VAULT_OUTCOME_ATTRIBUTE],
        )}:${count}`,
      );
    },
  } as never);
});

afterEach(async () => {
  await SecurityAddressVaultWriter.whenIdle();
  jest.restoreAllMocks();
  SyslogDeviceMatcher.clearCaches();
  SecurityEventsReadTelemetry.clearCache();
});

function otlpRequest(body: JSONObject): TelemetryRequest {
  return {
    projectId: new ObjectID(PROJECT_ID.toString()),
    body: body,
    headers: {},
  } as unknown as TelemetryRequest;
}

// An nginx access line through OTLP logs, and an application's line with the address in an attribute.
async function ingestOtlpLogs(): Promise<void> {
  await OtelLogsIngestService.processLogsFromQueue(
    otlpRequest({
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
                    stringValue: `${ATTACKER} - - [20/Nov/2026:10:00:05 +0000] "GET /static/../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"`,
                  },
                  attributes: [attribute("net.peer.ip", "10.0.0.12")],
                },
                {
                  timeUnixNano: `${Date.now()}000000`,
                  severityNumber: 13,
                  body: {
                    stringValue: "WARN rejected /static/../../etc/passwd",
                  },
                  attributes: [
                    attribute("client.address", `::ffff:${ATTACKER}`),
                    attribute("upstream", "2001:DB8::7"),
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
}

async function ingestOtlpTraces(): Promise<void> {
  const nowNano: string = `${Date.now()}000000`;

  await OtelTracesIngestService.processTracesFromQueue(
    otlpRequest({
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
                  name: "GET /download",
                  kind: 2,
                  startTimeUnixNano: nowNano,
                  endTimeUnixNano: nowNano,
                  status: { code: 2, message: "upstream 198.51.100.9 refused" },
                  attributes: [
                    attribute("http.request.method", "GET"),
                    attribute("url.path", "/download"),
                    attribute("url.query", "file=../../../../etc/passwd"),
                    attribute("client.address", ATTACKER),
                    attribute("server.address", "10.0.0.5"),
                  ],
                  events: [
                    {
                      name: "exception",
                      timeUnixNano: nowNano,
                      attributes: [
                        attribute(
                          "exception.message",
                          "connect 2001:db8::99 refused",
                        ),
                        attribute("exception.type", "ECONNREFUSED"),
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
}

describe("OTLP logs", () => {
  test("an IP Address Hash rule, logs Security Events reads: each address to the vault with its token, the rows hold only tokens", async () => {
    logRules = logIpRule(LogScrubAction.Hash);
    sourcesOn({ logs: true, traces: false });

    await ingestOtlpLogs();
    await SecurityAddressVaultWriter.whenIdle();

    const logs: Array<JSONObject> = rowsOf("LogItemV3");

    expect(logs).toHaveLength(2);
    expect(String(logs[0]!["body"]).startsWith(tokenOf(ATTACKER))).toBe(true);
    expect((logs[1]!["attributes"] as JSONObject)["client.address"]).toBe(
      tokenOf(ATTACKER),
    );
    // Nobody reading the logs can see the addresses.
    expect(JSON.stringify(logs)).not.toContain(ATTACKER);
    expect(JSON.stringify(logs).toLowerCase()).not.toContain("2001:db8::7");
    // The private address is no one's, and is kept (#10393).
    expect(JSON.stringify(logs)).toContain("10.0.0.12");

    // One row a token, the address in the spelling its token is made of.
    expect(vaultPairs()).toEqual(
      [
        [ATTACKER, tokenOf(ATTACKER)],
        ["2001:db8::7", tokenOf("2001:db8::7")],
      ].sort(),
    );
    expect(vaultRows()[0]!["projectId"]).toBe(PROJECT_ID.toString());
    expect(counted).toEqual(["log:written:2"]);
  });

  test("written once, after the batch's logs are stored", async () => {
    logRules = logIpRule(LogScrubAction.Hash);
    sourcesOn({ logs: true, traces: false });

    let storeLogs: () => void = (): void => {};
    recordAck = (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        storeLogs = resolve;
      });
    };

    const ingest: Promise<void> = ingestOtlpLogs();

    // Until the batch has handed its logs over, and waits for them to be stored.
    for (
      let tick: number = 0;
      tick < 10_000 && rowsOf("LogItemV3").length < 2;
      tick++
    ) {
      await new Promise<void>((resolve: () => void) => {
        setImmediate(resolve);
      });
    }

    // The batch waits on its logs' ack: give it every chance to write early.
    for (let tick: number = 0; tick < 20; tick++) {
      await new Promise<void>((resolve: () => void) => {
        setImmediate(resolve);
      });
    }

    // The logs are handed over, but not yet stored: nothing for the vault yet.
    expect(rowsOf("LogItemV3")).toHaveLength(2);
    expect(vaultRows()).toHaveLength(0);

    storeLogs();
    await ingest;
    await SecurityAddressVaultWriter.whenIdle();

    expect(
      submissions.map((submission: Submission): string => {
        return submission.table;
      }),
    ).toEqual(["LogItemV3", "SecurityAddressVaultV1"]);
  });

  test("logs Security Events does not read: nothing to the vault", async () => {
    logRules = logIpRule(LogScrubAction.Hash);
    const sources: { logs: ReturnType<typeof jest.spyOn> } = sourcesOn({
      logs: false,
      traces: true,
    });

    await ingestOtlpLogs();
    await SecurityAddressVaultWriter.whenIdle();

    expect(rowsOf("LogItemV3")).toHaveLength(2);
    expect(vaultRows()).toEqual([]);
    expect(sources.logs).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["Redact", LogScrubAction.Redact],
    ["Mask", LogScrubAction.Mask],
  ])(
    "a %s rule: nothing to the vault, and nobody asked whether Security Events reads",
    async (_label: string, action: string) => {
      logRules = logIpRule(action);
      const sources: { logs: ReturnType<typeof jest.spyOn> } = sourcesOn({
        logs: true,
        traces: true,
      });

      await ingestOtlpLogs();
      await SecurityAddressVaultWriter.whenIdle();

      expect(rowsOf("LogItemV3")).toHaveLength(2);
      expect(JSON.stringify(rowsOf("LogItemV3"))).not.toContain(ATTACKER);
      expect(vaultRows()).toEqual([]);
      expect(sources.logs).not.toHaveBeenCalled();
    },
  );

  test("a vault that refuses the write: the batch is stored with its tokens, and the job succeeds", async () => {
    logRules = logIpRule(LogScrubAction.Hash);
    sourcesOn({ logs: true, traces: false });
    vaultSubmit = async (): Promise<FanInSubmitResult> => {
      throw new Error("TOO_MANY_PARTS");
    };

    await expect(ingestOtlpLogs()).resolves.toBeUndefined();
    await SecurityAddressVaultWriter.whenIdle();

    const logs: Array<JSONObject> = rowsOf("LogItemV3");

    expect(logs).toHaveLength(2);
    expect(String(logs[0]!["body"]).startsWith(tokenOf(ATTACKER))).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(ATTACKER);
    expect(vaultRows()).toEqual([]);
    expect(counted).toEqual(["log:failed:2"]);
  });

  test("a vault whose insert fails after it was taken: the same", async () => {
    logRules = logIpRule(LogScrubAction.Hash);
    sourcesOn({ logs: true, traces: false });
    vaultSubmit = async (): Promise<FanInSubmitResult> => {
      return { flushed: Promise.reject(new Error("socket hang up")) };
    };

    await expect(ingestOtlpLogs()).resolves.toBeUndefined();
    await SecurityAddressVaultWriter.whenIdle();

    expect(rowsOf("LogItemV3")).toHaveLength(2);
    expect(counted).toEqual(["log:failed:2"]);
  });

  test("a batch whose logs are not stored writes nothing to the vault: the retried batch will", async () => {
    logRules = logIpRule(LogScrubAction.Hash);
    sourcesOn({ logs: true, traces: false });
    recordAck = async (): Promise<void> => {
      throw new Error("ClickHouse refused the logs");
    };

    await expect(ingestOtlpLogs()).rejects.toThrow();
    await SecurityAddressVaultWriter.whenIdle();

    expect(vaultRows()).toEqual([]);
  });

  test("Security Events' answer is asked once a minute, not once a batch", async () => {
    logRules = logIpRule(LogScrubAction.Hash);
    const sources: { logs: ReturnType<typeof jest.spyOn> } = sourcesOn({
      logs: true,
      traces: false,
    });

    await ingestOtlpLogs();
    await ingestOtlpLogs();
    await ingestOtlpLogs();
    await SecurityAddressVaultWriter.whenIdle();

    expect(sources.logs).toHaveBeenCalledTimes(1);
    // An address written lately is not written again.
    expect(vaultRows()).toHaveLength(2);
  });
});

describe("OTLP traces", () => {
  test("an IP Address Hash rule, traces Security Events reads: the span's addresses to the vault, the span holds only tokens", async () => {
    traceRules = traceIpRule(LogScrubAction.Hash);
    sourcesOn({ logs: false, traces: true });

    await ingestOtlpTraces();
    await SecurityAddressVaultWriter.whenIdle();

    const spans: Array<JSONObject> = rowsOf("SpanItemV3");

    expect(spans).toHaveLength(1);
    expect((spans[0]!["attributes"] as JSONObject)["client.address"]).toBe(
      tokenOf(ATTACKER),
    );
    expect(JSON.stringify(spans)).not.toContain(ATTACKER);
    expect(JSON.stringify(rowsOf("ExceptionItemV3"))).not.toContain(
      "2001:db8::99",
    );

    expect(vaultPairs()).toEqual(
      [
        [ATTACKER, tokenOf(ATTACKER)],
        ["198.51.100.9", tokenOf("198.51.100.9")],
        ["2001:db8::99", tokenOf("2001:db8::99")],
      ].sort(),
    );
    expect(counted).toEqual(["trace:written:3"]);
  });

  test("with the Traces source off and Your logs off, no vault row is written", async () => {
    traceRules = traceIpRule(LogScrubAction.Hash);
    sourcesOn({ logs: false, traces: false });

    await ingestOtlpTraces();
    await SecurityAddressVaultWriter.whenIdle();

    expect(rowsOf("SpanItemV3")).toHaveLength(1);
    expect(vaultRows()).toEqual([]);
  });

  test("with the Traces source off but Your logs on, the log scan follows its lines into these traces: the vault is written", async () => {
    traceRules = traceIpRule(LogScrubAction.Hash);
    sourcesOn({ logs: true, traces: false });

    await ingestOtlpTraces();
    await SecurityAddressVaultWriter.whenIdle();

    expect(
      vaultPairs().map(([address]: [string, string]): string => {
        return address;
      }),
    ).toContain(ATTACKER);
  });

  test("a Redact rule: nothing to the vault", async () => {
    traceRules = traceIpRule(LogScrubAction.Redact);
    sourcesOn({ logs: true, traces: true });

    await ingestOtlpTraces();
    await SecurityAddressVaultWriter.whenIdle();

    expect(
      (rowsOf("SpanItemV3")[0]!["attributes"] as JSONObject)["client.address"],
    ).toBe("[REDACTED]");
    expect(vaultRows()).toEqual([]);
  });

  test("a vault that refuses the write: the span is stored with its token, and the job succeeds", async () => {
    traceRules = traceIpRule(LogScrubAction.Hash);
    sourcesOn({ logs: false, traces: true });
    vaultSubmit = async (): Promise<FanInSubmitResult> => {
      throw new Error("TOO_MANY_PARTS");
    };

    await expect(ingestOtlpTraces()).resolves.toBeUndefined();
    await SecurityAddressVaultWriter.whenIdle();

    expect(
      (rowsOf("SpanItemV3")[0]!["attributes"] as JSONObject)["client.address"],
    ).toBe(tokenOf(ATTACKER));
    expect(counted).toEqual(["trace:failed:3"]);
  });
});

describe("Fluentd logs", () => {
  test("an IP Address Hash rule, logs Security Events reads: the address to the vault", async () => {
    logRules = logIpRule(LogScrubAction.Hash);
    sourcesOn({ logs: true, traces: false });

    await FluentLogsIngestService.processFluentLogsFromQueue({
      projectId: PROJECT_ID,
      body: {
        entries: [
          `${ATTACKER} - - [20/Nov/2026:10:00:05 +0000] "GET /static/../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"`,
        ],
      },
      headers: { "x-oneuptime-service-name": SERVICE_NAME },
    } as unknown as ExpressRequest);
    await SecurityAddressVaultWriter.whenIdle();

    expect(JSON.stringify(rowsOf("LogItemV3"))).not.toContain(ATTACKER);
    expect(vaultPairs()).toEqual([[ATTACKER, tokenOf(ATTACKER)]]);
  });
});

describe("syslog posted over HTTP", () => {
  test("an IP Address Hash rule, logs Security Events reads: the address to the vault", async () => {
    logRules = logIpRule(LogScrubAction.Hash);
    sourcesOn({ logs: true, traces: false });

    await SyslogIngestService.processSyslogFromQueue({
      projectId: PROJECT_ID,
      body: {
        messages: [
          `<38>1 2026-11-20T10:00:05.000Z web-01 sshd 4711 - - Failed password for root from ${ATTACKER} port 52314 ssh2`,
        ],
      },
      headers: {},
      query: {},
    } as unknown as ExpressRequest);
    await SecurityAddressVaultWriter.whenIdle();

    expect(rowsOf("LogItemV3")).toHaveLength(1);
    expect(JSON.stringify(rowsOf("LogItemV3"))).not.toContain(ATTACKER);
    expect(vaultPairs()).toEqual([[ATTACKER, tokenOf(ATTACKER)]]);
  });

  test("logs Security Events does not read: nothing to the vault", async () => {
    logRules = logIpRule(LogScrubAction.Hash);
    sourcesOn({ logs: false, traces: false });

    await SyslogIngestService.processSyslogFromQueue({
      projectId: PROJECT_ID,
      body: {
        messages: [
          `<38>1 2026-11-20T10:00:05.000Z web-01 sshd 4711 - - Failed password for root from ${ATTACKER} port 52314 ssh2`,
        ],
      },
      headers: {},
      query: {},
    } as unknown as ExpressRequest);
    await SecurityAddressVaultWriter.whenIdle();

    expect(vaultRows()).toEqual([]);
  });
});

describe("syslog a probe forwards", () => {
  test("an IP Address Hash rule, logs Security Events reads: the address to the vault, after the logs are inserted", async () => {
    logRules = logIpRule(LogScrubAction.Hash);
    sourcesOn({ logs: true, traces: false });

    await ProbeSyslogIngestService.processSyslogMessages(PROBE_ID, [
      {
        sourceIpAddress: "10.0.0.9",
        facility: 4,
        severity: 6,
        message: `sshd[4711]: Failed password for root from ${ATTACKER} port 52314 ssh2`,
        receivedAt: "2026-11-20T10:00:05.000Z",
        raw: `<38>sshd[4711]: Failed password for root from ${ATTACKER} port 52314 ssh2`,
      },
    ]);
    await SecurityAddressVaultWriter.whenIdle();

    expect(probeRows).toHaveLength(1);
    expect(JSON.stringify(probeRows)).not.toContain(ATTACKER);
    expect(vaultPairs()).toEqual([[ATTACKER, tokenOf(ATTACKER)]]);
    expect(
      submissions.map((submission: Submission): string => {
        return submission.table;
      }),
    ).toEqual(["LogItemV3", "SecurityAddressVaultV1"]);
  });
});
