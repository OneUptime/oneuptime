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
import SecurityUserVaultService from "Common/Server/Services/SecurityUserVaultService";
import SecurityLogSourceService from "Common/Server/Services/SecurityLogSourceService";
import SecurityTelemetrySourceService from "Common/Server/Services/SecurityTelemetrySourceService";
import SpanService from "Common/Server/Services/SpanService";
import { ExpressRequest } from "Common/Server/Utils/Express";
import SecurityAddressVaultWriter from "Common/Server/Utils/SecurityEvent/AddressVault/SecurityAddressVaultWriter";
import SecurityUserVaultWriter from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserVaultWriter";
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
 * INGEST WRITES SECURITY EVENTS' USER VAULT (#10632), as it writes the
 * address vault (AddressVaultAtIngest.test.ts).
 *
 * Every route logs and traces arrive by - OTLP logs and traces, Fluentd,
 * syslog over HTTP, syslog a probe forwards - from the batch posted to the
 * rows written, with the project's real scrub rules. Only the persistence
 * edges are replaced: Postgres (resources, pipelines, drop filters, scrub
 * rules, the Security Events sources, the exception upsert) and ClickHouse
 * (the fan-in writer, a probe's insert).
 *
 *   - a rule that hashes a user where Security Events reads one, in logs
 *     or traces it reads: the user goes to the vault with its token, once a
 *     batch, after the batch's records - and the records hold only tokens;
 *   - an email the same rule hashes anywhere else, Security Events not
 *     reading, a Redact rule: nothing goes to the vault;
 *   - a vault that refuses the write: the batch is stored, with the
 *     tokens, and the job succeeds.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const PROBE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "checkout-api";

const MALLORY: string = "mallory@acme.com";
const ALICE: string = "alice@example.com";

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
// What a test does to the user vault's own submission.
let vaultSubmit: () => Promise<FanInSubmitResult> = async () => {
  return { flushed: Promise.resolve() };
};
// What a test does to the records' submissions.
let recordAck: () => Promise<void> = async (): Promise<void> => {};

function attribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
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

function logEmailRule(action: string): never {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = "Scrub email addresses";
  rule.projectId = PROJECT_ID;
  rule.patternType = LogScrubPatternType.Email;
  rule.scrubAction = action;
  rule.fieldsToScrub = LogScrubField.Both;

  return [
    {
      rule: rule,
      regex: regexOf(LogScrubRuleService, LogScrubPatternType.Email),
    },
  ] as never;
}

function logCustomRule(action: string, customRegex: string): never {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = "Scrub the deploy account";
  rule.projectId = PROJECT_ID;
  rule.patternType = LogScrubPatternType.Custom;
  rule.customRegex = customRegex;
  rule.scrubAction = action;
  rule.fieldsToScrub = LogScrubField.Both;

  return [
    {
      rule: rule,
      regex: (
        LogScrubRuleService as unknown as {
          getRegexForPattern: (
            patternType: string,
            customRegex?: string,
          ) => ScrubRegExp | null;
        }
      ).getRegexForPattern(LogScrubPatternType.Custom, customRegex)!,
    },
  ] as never;
}

function traceEmailRule(action: string): never {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.name = "Scrub email addresses";
  rule.projectId = PROJECT_ID;
  rule.patternType = LogScrubPatternType.Email;
  rule.scrubAction = action;
  rule.fieldsToScrub = TraceScrubField.All;

  return [
    {
      rule: rule,
      regex: regexOf(TraceScrubRuleService, LogScrubPatternType.Email),
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
      return submission.table === "SecurityUserVaultV1";
    })
    .flatMap((submission: Submission): Array<JSONObject> => {
      return submission.rows;
    });
}

function vaultPairs(): Array<[string, string]> {
  return vaultRows()
    .map((row: JSONObject): [string, string] => {
      return [String(row["userValue"]), String(row["token"])];
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
  SecurityUserVaultWriter.forgetWrites();

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
        if (target === SecurityUserVaultService) {
          const result: FanInSubmitResult = await vaultSubmit();
          submissions.push({ table: target.model.tableName, rows });
          return result;
        }

        // An Email rule hides no address: the address vault is never written here.
        if (target === SecurityAddressVaultService) {
          throw new Error("the address vault was written for an Email rule");
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
  jest.spyOn(AppMetrics, "getUserVaultWriteCounter").mockReturnValue({
    add: (count: number, attributes?: JSONObject): void => {
      counted.push(
        `${String(attributes?.[AppMetrics.ADDRESS_VAULT_SIGNAL_ATTRIBUTE])}:${String(
          attributes?.[AppMetrics.USER_VAULT_OUTCOME_ATTRIBUTE],
        )}:${count}`,
      );
    },
  } as never);
});

afterEach(async () => {
  await SecurityAddressVaultWriter.whenIdle();
  await SecurityUserVaultWriter.whenIdle();
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

// A Google Cloud audit entry through OTLP logs, and an application's line with an email in it.
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
                    stringValue: JSON.stringify({
                      insertId: "1a2b3c4d5e",
                      logName:
                        "projects/acme-prod/logs/cloudaudit.googleapis.com%2Factivity",
                      resource: {
                        type: "service_account",
                        labels: { project_id: "acme-prod" },
                      },
                      timestamp: "2026-11-24T09:58:12.345Z",
                      severity: "NOTICE",
                      protoPayload: {
                        "@type":
                          "type.googleapis.com/google.cloud.audit.AuditLog",
                        status: {},
                        authenticationInfo: { principalEmail: ALICE },
                        requestMetadata: { callerIp: "203.0.113.7" },
                        serviceName: "iam.googleapis.com",
                        methodName:
                          "google.iam.admin.v1.CreateServiceAccountKey",
                        resourceName:
                          "projects/-/serviceAccounts/app@acme-prod.iam.gserviceaccount.com",
                      },
                    }),
                  },
                  attributes: [],
                },
                {
                  timeUnixNano: `${Date.now()}000000`,
                  severityNumber: 9,
                  body: { stringValue: `Sent the weekly digest to ${MALLORY}` },
                  attributes: [],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
}

// A sign-in request's span, its user an email.
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
                  name: "POST /login",
                  kind: 2,
                  startTimeUnixNano: nowNano,
                  endTimeUnixNano: nowNano,
                  status: { code: 2, message: "invalid password" },
                  attributes: [
                    attribute("http.request.method", "POST"),
                    attribute("url.path", "/login"),
                    attribute("enduser.id", MALLORY),
                    attribute(
                      "url.query",
                      "reset=bob@acme.com",
                    ),
                  ],
                  events: [],
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

describe("OTLP traces", () => {
  test("an Email Hash rule, traces Security Events reads: the span's user to the vault, the span holds only the token", async () => {
    traceRules = traceEmailRule(LogScrubAction.Hash);
    sourcesOn({ logs: false, traces: true });

    await ingestOtlpTraces();
    await SecurityUserVaultWriter.whenIdle();

    expect(JSON.stringify(rowsOf("SpanItemV3"))).not.toContain(MALLORY);
    expect(JSON.stringify(rowsOf("SpanItemV3"))).toContain(tokenOf(MALLORY));
    // The user, and never the email the same rule hashed in the query.
    expect(vaultPairs()).toEqual([[MALLORY, tokenOf(MALLORY)]]);
    expect(counted).toEqual(["trace:written:1"]);
  });

  test("the spans are stored before the vault is written", async () => {
    traceRules = traceEmailRule(LogScrubAction.Hash);
    sourcesOn({ logs: false, traces: true });

    await ingestOtlpTraces();
    await SecurityUserVaultWriter.whenIdle();

    const tables: Array<string> = submissions.map(
      (submission: Submission): string => {
        return submission.table;
      },
    );

    expect(tables.indexOf("SecurityUserVaultV1")).toBeGreaterThan(
      tables.indexOf("SpanItemV3"),
    );
  });

  test("with neither the Traces source nor Your logs on, no vault row is written", async () => {
    traceRules = traceEmailRule(LogScrubAction.Hash);
    sourcesOn({ logs: false, traces: false });

    await ingestOtlpTraces();
    await SecurityUserVaultWriter.whenIdle();

    expect(vaultRows()).toEqual([]);
  });

  test("a Redact rule: nothing to the vault", async () => {
    traceRules = traceEmailRule(LogScrubAction.Redact);
    sourcesOn({ logs: false, traces: true });

    await ingestOtlpTraces();
    await SecurityUserVaultWriter.whenIdle();

    expect(JSON.stringify(rowsOf("SpanItemV3"))).not.toContain(MALLORY);
    expect(vaultRows()).toEqual([]);
  });

  test("a vault that refuses the write: the span is stored with its token, and the job succeeds", async () => {
    traceRules = traceEmailRule(LogScrubAction.Hash);
    sourcesOn({ logs: false, traces: true });
    vaultSubmit = async (): Promise<FanInSubmitResult> => {
      return { flushed: Promise.reject(new Error("TOO_MANY_PARTS")) };
    };

    await expect(ingestOtlpTraces()).resolves.toBeUndefined();
    await SecurityUserVaultWriter.whenIdle();

    expect(JSON.stringify(rowsOf("SpanItemV3"))).toContain(tokenOf(MALLORY));
    expect(counted).toEqual(["trace:failed:1"]);
  });
});

describe("OTLP logs", () => {
  test("an Email Hash rule, logs Security Events reads: a cloud audit log's principal to the vault, never the email in an app's line", async () => {
    logRules = logEmailRule(LogScrubAction.Hash);
    sourcesOn({ logs: true, traces: false });

    await ingestOtlpLogs();
    await SecurityUserVaultWriter.whenIdle();

    expect(JSON.stringify(rowsOf("LogItemV3"))).not.toContain(ALICE);
    expect(JSON.stringify(rowsOf("LogItemV3"))).not.toContain(MALLORY);
    expect(vaultPairs()).toEqual([[ALICE, tokenOf(ALICE)]]);
  });

  test("logs Security Events does not read: nothing to the vault", async () => {
    logRules = logEmailRule(LogScrubAction.Hash);
    sourcesOn({ logs: false, traces: false });

    await ingestOtlpLogs();
    await SecurityUserVaultWriter.whenIdle();

    expect(vaultRows()).toEqual([]);
  });
});

describe("Fluentd logs", () => {
  test("a rule that hashes an SSH account, logs Security Events reads: the account to the vault", async () => {
    logRules = logCustomRule(LogScrubAction.Hash, "deploy");
    sourcesOn({ logs: true, traces: false });

    await FluentLogsIngestService.processFluentLogsFromQueue({
      projectId: PROJECT_ID,
      body: {
        entries: [
          "Nov 24 10:00:00 bastion sshd[4242]: Failed password for deploy from 203.0.113.7 port 52314 ssh2",
        ],
      },
      headers: { "x-oneuptime-service-name": SERVICE_NAME },
    } as unknown as ExpressRequest);
    await SecurityUserVaultWriter.whenIdle();

    expect(JSON.stringify(rowsOf("LogItemV3"))).toContain(tokenOf("deploy"));
    expect(vaultPairs()).toEqual([["deploy", tokenOf("deploy")]]);
  });
});

describe("syslog posted over HTTP", () => {
  test("a rule that hashes an SSH account, logs Security Events reads: the account to the vault", async () => {
    logRules = logCustomRule(LogScrubAction.Hash, "deploy");
    sourcesOn({ logs: true, traces: false });

    await SyslogIngestService.processSyslogFromQueue({
      projectId: PROJECT_ID,
      body: {
        messages: [
          "<38>1 2026-11-24T10:00:05.000Z web-01 sshd 4711 - - Failed password for deploy from 203.0.113.7 port 52314 ssh2",
        ],
      },
      headers: {},
      query: {},
    } as unknown as ExpressRequest);
    await SecurityUserVaultWriter.whenIdle();

    expect(vaultPairs()).toEqual([["deploy", tokenOf("deploy")]]);
  });
});

describe("syslog a probe forwards", () => {
  test("a rule that hashes an SSH account, logs Security Events reads: the account to the vault, after the logs are inserted", async () => {
    logRules = logCustomRule(LogScrubAction.Hash, "deploy");
    sourcesOn({ logs: true, traces: false });

    await ProbeSyslogIngestService.processSyslogMessages(PROBE_ID, [
      {
        sourceIpAddress: "10.0.0.9",
        facility: 4,
        severity: 6,
        message:
          "sshd[4711]: Failed password for deploy from 203.0.113.7 port 52314 ssh2",
        receivedAt: "2026-11-24T10:00:05.000Z",
        raw: "<38>sshd[4711]: Failed password for deploy from 203.0.113.7 port 52314 ssh2",
      },
    ]);
    await SecurityUserVaultWriter.whenIdle();

    expect(probeRows).toHaveLength(1);
    expect(JSON.stringify(probeRows)).toContain(tokenOf("deploy"));
    expect(vaultPairs()).toEqual([["deploy", tokenOf("deploy")]]);
    expect(
      submissions.map((submission: Submission): string => {
        return submission.table;
      }),
    ).toEqual(["LogItemV3", "SecurityUserVaultV1"]);
  });
});
