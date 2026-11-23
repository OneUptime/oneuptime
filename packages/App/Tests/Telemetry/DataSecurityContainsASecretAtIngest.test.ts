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

import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import AppLogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import DataSecurityAiDecision from "Common/Models/DatabaseModels/DataSecurityAiDecision";
import DataSecurityAiProposal from "Common/Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataStoreFinding from "Common/Models/DatabaseModels/DataStoreFinding";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import Project from "Common/Models/DatabaseModels/Project";
import Service from "Common/Models/DatabaseModels/Service";
import ServiceOwnerUser from "Common/Models/DatabaseModels/ServiceOwnerUser";
import User from "Common/Models/DatabaseModels/User";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import AutoRemediationRuleService from "Common/Server/Services/AutoRemediationRuleService";
import DataSecurityAiDecisionService from "Common/Server/Services/DataSecurityAiDecisionService";
import DataSecurityAiProposalService from "Common/Server/Services/DataSecurityAiProposalService";
import DataSecurityCustomDataTypeService from "Common/Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityIssueFeedService from "Common/Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "Common/Server/Services/DataSecurityIssueService";
import DataStoreFeedService from "Common/Server/Services/DataStoreFeedService";
import DataStoreFindingService from "Common/Server/Services/DataStoreFindingService";
import DataStoreService from "Common/Server/Services/DataStoreService";
import LogScrubRuleService from "Common/Server/Services/LogScrubRuleService";
import LogService from "Common/Server/Services/LogService";
import MailService from "Common/Server/Services/MailService";
import MetricPipelineRuleService from "Common/Server/Services/MetricPipelineRuleService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import ProjectService from "Common/Server/Services/ProjectService";
import ScrubRuleValueCountService from "Common/Server/Services/ScrubRuleValueCountService";
import ServiceOwnerTeamService from "Common/Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "Common/Server/Services/ServiceOwnerUserService";
import ServiceService from "Common/Server/Services/ServiceService";
import TraceScrubRuleService from "Common/Server/Services/TraceScrubRuleService";
import UserService from "Common/Server/Services/UserService";
import DataSecurityAiEngine from "Common/Server/Utils/AI/DataSecurity/DataSecurityAiEngine";
import DataSecurityIssueAnalysis from "Common/Server/Utils/AI/DataSecurity/DataSecurityIssueAnalysis";
import DataSecurityIntegrations from "Common/Server/Utils/DataSecurity/DataSecurityIntegrations";
import DataSecurityRunner from "Common/Server/Utils/DataSecurity/DataSecurityRunner";
import { ContentScanOptions } from "Common/Server/Utils/DataSecurity/DataSecurityScanTypes";
import * as SecurityEventsFieldReaders from "Common/Server/Utils/SecurityEvent/SecurityEventsFieldReaders";
import { ExpressRequest } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import * as TelemetryFieldReaders from "Common/Server/Utils/Telemetry/TelemetryFieldReaders";
import {
  compileScrubRule,
  CompiledScrubRule,
} from "Common/Server/Utils/Telemetry/ScrubEngine/CompiledScrubRule";
import ScrubRuleValueCounter from "Common/Server/Utils/Telemetry/ScrubRuleValueCounter";
import TelemetryFanInWriter, {
  FanInInsertTarget,
  FanInSubmitResult,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import URL from "Common/Types/API/URL";
import DataCategory from "Common/Types/DataSecurity/DataCategory";
import { DataSecurityAiProposalStatus } from "Common/Types/DataSecurity/DataSecurityAi";
import { DataSecurityAiDecisionReason } from "Common/Types/DataSecurity/DataSecurityAiDecision";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import SecuritySeverity from "Common/Types/SecuritySeverity";
import {
  doesScrubRuleProofCover,
  readScrubRuleProof,
} from "Common/Types/Telemetry/ScrubRuleProof";
import { SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE } from "Common/Types/Telemetry/ScrubRuleKeys";
import {
  TELEMETRY_FIELD_READER_KINDS,
  TelemetryFieldReadersByKind,
} from "Common/Types/Telemetry/TelemetryFieldReaders";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * ---------------------------------------------------------------------------
 * A SECRET IN ONE SERVICE'S LOG ATTRIBUTE, CONTAINED WITH NOBODY PRESSING
 * ANYTHING (#10366).
 *
 * checkout writes its database password into every log, under
 * db.password. The scan found it there, and a Secrets in telemetry issue
 * is open. OneUptime AI works on the issue with the project's defaults -
 * no Data Security AI rule:
 *
 *   - it plans the rule Scrub It would make for the finding, proves it on
 *     the very records the finding was seen in (the verifier runs ingest's
 *     own engine on them), finds nothing in the project reads what it
 *     hides, and - the finding being a secret - makes it without asking:
 *     a Named Attributes rule for db.password of checkout, with its proof;
 *   - the issue's timeline says what was done, how it was proven, that the
 *     secret must be rotated and where it was seen, and how to undo it;
 *     the store's and the service's owners are emailed the same;
 *   - from then on, ingest hides checkout's db.password before a log is
 *     stored, counts each value it hid by service and version - and
 *     leaves payments' logs, which no finding was about, as they are.
 *
 * Only the persistence edges are replaced: Postgres (the project, the
 * issue, its store and finding, the proposals, the timelines, the scrub
 * rules, the owners), ClickHouse (the finding's records, the rows ingest
 * writes) and the email.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10366000-0000-4000-8000-0000000e2e01",
);
const ISSUE_ID: ObjectID = new ObjectID("10366000-0000-4000-8000-0000000e2ea1");
const STORE_ID: ObjectID = new ObjectID("10366000-0000-4000-8000-0000000e2eb1");
const FINDING_ID: ObjectID = new ObjectID(
  "10366000-0000-4000-8000-0000000e2ef1",
);
const CHECKOUT: ObjectID = new ObjectID("10366000-0000-4000-8000-0000000e2ec1");
const PAYMENTS: ObjectID = new ObjectID("10366000-0000-4000-8000-0000000e2ec2");
const RULE_ID: ObjectID = new ObjectID("10366000-0000-4000-8000-0000000e2e51");
const STORE_OWNER: ObjectID = new ObjectID(
  "10366000-0000-4000-8000-0000000e2e71",
);
const SERVICE_OWNER: ObjectID = new ObjectID(
  "10366000-0000-4000-8000-0000000e2e72",
);

// Made up, and put together here so no secret scanner reads it as one.
const PASSWORD: string = ["vH7#qL2!", "xT9$mR4@"].join("");
const OTHER_PASSWORD: string = ["zP3&kW8*", "bN5^cJ1%"].join("");

const OPTIONS: ContentScanOptions = {
  limits: {
    maxObjects: 2000,
    maxBytesPerObject: 65536,
    maxBytesTotal: 52428800,
    maxRowsPerTable: 1000,
    maxTables: 200,
    deadline: new Date(Date.now() + 60 * 60 * 1000),
  },
  customDetectors: [],
  extraHints: [],
  disabledDataTypeIds: new Set<string>(),
  allowedValues: new Set<string>(),
  exclusions: [],
  fingerprintKey: "e2e-contain-a-secret",
};

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IngestTestMethods = Record<string, any>;

interface Submission {
  table: string;
  rows: Array<JSONObject>;
}

let logRules: Array<LogScrubRule>;
let proposals: Array<DataSecurityAiProposal>;
let transitions: Array<{ set: JSONObject }>;
let issueFeed: Array<JSONObject>;
let emails: Array<{ to: string; subject: string; message: string }>;
let submissions: Array<Submission>;
let marked: Array<{ id: string; isScrubbed: unknown }>;

// The finding's records, as the scan kept them, and the newest of checkout with a value at the place.
function proofRows(): Array<JSONObject> {
  return [PASSWORD, OTHER_PASSWORD, PASSWORD].map(
    (value: string, index: number): JSONObject => {
      return {
        ownerId: CHECKOUT.toString(),
        recordTime: 1795000000000 + index,
        readLogId: `10366000-0000-4000-8000-0000000e2d0${index}`,
        readAttributes: [["db.password", value]],
      };
    },
  );
}

function noReaders(): TelemetryFieldReadersByKind {
  const kinds: Partial<TelemetryFieldReadersByKind> = {};

  for (const kind of TELEMETRY_FIELD_READER_KINDS) {
    kinds[kind] = { readers: [], hiddenCount: 0, isChecked: true };
  }

  return kinds as TelemetryFieldReadersByKind;
}

function user(id: ObjectID, email: string): User {
  const found: User = new User(id);
  found.email = email as never;
  return found;
}

function attribute(
  key: string,
  value: string,
): { key: string; value: { stringValue: string } } {
  return { key, value: { stringValue: value } };
}

function metadataOf(serviceName: string): TelemetryServiceMetadata {
  return {
    serviceName,
    primaryEntityId: serviceName === "checkout" ? CHECKOUT : PAYMENTS,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  } as unknown as TelemetryServiceMetadata;
}

beforeEach(() => {
  logRules = [];
  proposals = [];
  transitions = [];
  issueFeed = [];
  emails = [];
  submissions = [];
  marked = [];
  ScrubRuleValueCounter.reset();

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "info").mockImplementation((): void => {});

  // OneUptime AI on, working on new issues, with no Data Security AI rule: the defaults.
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
    enableAutomaticDataSecurityAi: true,
    requireTwoApprovalsForRiskierFixes: false,
  } as unknown as Project);
  jest.spyOn(AutoRemediationRuleService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(DataSecurityCustomDataTypeService, "findBy")
    .mockResolvedValue([] as never);

  jest.spyOn(DataSecurityIssueService, "findOneBy").mockResolvedValue({
    id: ISSUE_ID,
    projectId: PROJECT_ID,
    checkId: "secrets-in-telemetry",
    checkGroup: "Telemetry",
    title: "A secret is reaching your telemetry",
    severity: SecuritySeverity.High,
    riskScore: 80,
    status: DataSecurityIssueStatus.Open,
    dataTypeIds: ["generic-secret"],
    dataStoreId: STORE_ID,
    reopenCount: 0,
  } as unknown as DataSecurityIssue);
  jest.spyOn(DataStoreService, "findOneById").mockResolvedValue({
    id: STORE_ID,
    name: "checkout · Logs",
    kind: DataStoreKind.TelemetryLogs,
    provider: "oneuptime",
    serviceId: CHECKOUT,
    isArchived: false,
    labels: [],
  } as unknown as DataStore);
  jest.spyOn(DataStoreService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(ServiceService, "findOneBy").mockImplementation((async () => {
    const service: Service = new Service(CHECKOUT);
    service.name = "checkout";
    return service;
  }) as never);

  // The finding: the password under db.password, its records kept.
  const finding: DataStoreFinding = {
    id: FINDING_ID,
    dataTypeId: "generic-secret",
    dataTypeName: "Password or secret",
    dataCategory: DataCategory.SecretsAndCredentials,
    location: "attributes.db.password",
    locationKind: "Attribute",
    matchCount: 3,
    isScrubbed: false,
    isSuppressed: false,
    lastSeenAt: new Date("2026-11-22T09:40:00.000Z"),
    sampleRecords: [
      {
        time: "2026-11-22T09:40:00.000Z",
        logId: "10366000-0000-4000-8000-0000000e2d00",
      },
    ],
  } as unknown as DataStoreFinding;

  jest
    .spyOn(DataStoreFindingService, "findBy")
    .mockResolvedValue([finding] as never);
  jest
    .spyOn(DataStoreFindingService, "findOneBy")
    .mockResolvedValue(finding as never);
  jest
    .spyOn(DataStoreFindingService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      id: ObjectID;
      data: { isScrubbed: unknown };
    }) => {
      marked.push({ id: data.id.toString(), isScrubbed: data.data.isScrubbed });
    }) as never);
  jest
    .spyOn(DataSecurityRunner, "getScanSetup")
    .mockResolvedValue({ options: OPTIONS } as never);
  // ClickHouse: the records the proof reads.
  jest.spyOn(LogService, "executeQuery").mockImplementation((async () => {
    return {
      json: async () => {
        return { data: proofRows() };
      },
    };
  }) as never);

  // Nothing in the project reads db.password, and Security Events reads no logs.
  jest
    .spyOn(TelemetryFieldReaders, "findTelemetryFieldReaders")
    .mockImplementation(async () => {
      return noReaders();
    });
  jest
    .spyOn(SecurityEventsFieldReaders, "findSecurityEventsFieldReads")
    .mockResolvedValue({ isChecked: true, sources: [], loses: [] });
  jest
    .spyOn(SecurityEventsFieldReaders, "findSecurityEventsSources")
    .mockResolvedValue({ isChecked: true, sources: [] } as never);

  // The scrub rules: none, until OneUptime AI makes one.
  jest.spyOn(LogScrubRuleService, "findBy").mockImplementation((async () => {
    return logRules;
  }) as never);
  jest.spyOn(TraceScrubRuleService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(MetricPipelineRuleService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogScrubRuleService, "create")
    .mockImplementation((async (createBy: {
      data: LogScrubRule;
      props: { isRoot?: boolean };
    }) => {
      // Made as OneUptime: nobody pressed anything.
      expect(createBy.props.isRoot).toBe(true);
      createBy.data.id = RULE_ID;
      logRules.push(createBy.data);
      return createBy.data;
    }) as never);
  jest
    .spyOn(LogScrubRuleService, "updateOneById")
    .mockImplementation((async (updateBy: {
      id: ObjectID;
      data: { proof?: JSONObject };
    }) => {
      const rule: LogScrubRule | undefined = logRules.find(
        (item: LogScrubRule): boolean => {
          return item.id?.toString() === updateBy.id.toString();
        },
      );

      if (rule && updateBy.data.proof) {
        rule.proof = updateBy.data.proof;
      }
    }) as never);

  // The proposals and the record of the work.
  jest
    .spyOn(DataSecurityAiDecisionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest
    .spyOn(DataSecurityAiDecisionService, "create")
    .mockImplementation((async (createBy: { data: DataSecurityAiDecision }) => {
      return createBy.data;
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest
    .spyOn(DataSecurityAiProposalService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(DataSecurityAiProposalService, "create")
    .mockImplementation((async (createBy: { data: DataSecurityAiProposal }) => {
      createBy.data.id = new ObjectID(
        `10366000-0000-4000-8000-0000000e2e9${String(proposals.length)}`,
      );
      proposals.push(createBy.data);
      return createBy.data;
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "attemptTransition")
    .mockImplementation((async (data: { set: JSONObject }) => {
      transitions.push(data);
      return 1;
    }) as never);
  jest.spyOn(DataSecurityIssueAnalysis, "analyze").mockResolvedValue({
    analyzed: false,
    reason: DataSecurityAiDecisionReason.AlreadyAnalyzed,
    analysis: null,
  } as never);
  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockImplementation((async (item: JSONObject) => {
      issueFeed.push(item);
    }) as never);
  jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined);

  // The owners: the store's, and the service's.
  jest
    .spyOn(DataSecurityIntegrations, "getOwnerUsers")
    .mockResolvedValue([user(STORE_OWNER, "store-owner@acme.test")]);
  jest
    .spyOn(ServiceOwnerUserService, "findBy")
    .mockResolvedValue([
      { userId: SERVICE_OWNER } as unknown as ServiceOwnerUser,
    ] as never);
  jest.spyOn(ServiceOwnerTeamService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(UserService, "findBy")
    .mockResolvedValue([user(SERVICE_OWNER, "checkout-owner@acme.test")]);
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/dashboard"));
  jest.spyOn(MailService, "sendMail").mockImplementation((async (mail: {
    toEmail: string;
    subject: string;
    vars: { message: string };
  }) => {
    emails.push({
      to: mail.toEmail.toString(),
      subject: mail.subject,
      message: mail.vars.message,
    });
  }) as never);

  // Ingest's persistence edges.
  const service: IngestTestMethods =
    OtelLogsIngestService as unknown as IngestTestMethods;

  for (const method of AUTO_DISCOVERY_METHODS) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  jest
    .spyOn(service, "resolveTelemetryResource")
    .mockImplementation((async (data: {
      attributes: Array<{ key: string; value: { stringValue: string } }>;
    }) => {
      const name: string =
        data.attributes.find((item: { key: string }): boolean => {
          return item.key === "service.name";
        })?.value.stringValue || "";

      return metadataOf(name);
    }) as never);
  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation((async (data: { serviceName: string }) => {
      return metadataOf(data.serviceName);
    }) as never);
  jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest.spyOn(LlmModelPriceService, "loadModelPrices").mockResolvedValue([]);
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (
        target: FanInInsertTarget,
        rows: Array<JSONObject>,
      ): Promise<FanInSubmitResult> => {
        if (target !== LogService && target !== ScrubRuleValueCountService) {
          throw new Error(`unexpected fan-in target ${target.model.tableName}`);
        }

        submissions.push({ table: target.model.tableName, rows });

        return { flushed: Promise.resolve() };
      },
    );
});

afterEach(() => {
  ScrubRuleValueCounter.reset();
  jest.restoreAllMocks();
});

async function ingest(): Promise<Array<JSONObject>> {
  await OtelLogsIngestService.processLogsFromQueue({
    projectId: new ObjectID(PROJECT_ID.toString()),
    headers: {},
    body: {
      resourceLogs: ["checkout", "payments"].map((name: string) => {
        return {
          resource: { attributes: [attribute("service.name", name)] },
          scopeLogs: [
            {
              scope: {},
              logRecords: [
                {
                  timeUnixNano: `${Date.now()}000000`,
                  severityNumber: 9,
                  body: { stringValue: `${name} connected to orders-db` },
                  attributes: [
                    attribute("db.password", PASSWORD),
                    attribute("db.user", "orders_app"),
                  ],
                },
              ],
            },
          ],
        };
      }),
    },
  } as unknown as TelemetryRequest as unknown as ExpressRequest);

  return submissions
    .filter((submission: Submission): boolean => {
      return submission.table === LogService.model.tableName;
    })
    .flatMap((submission: Submission): Array<JSONObject> => {
      return submission.rows;
    });
}

describe("a secret in one service's log attribute", () => {
  test("is hidden at ingest by a rule for that service, proven on its records, that nobody pressed anything for - and the issue says what was done, how it was proven and how to undo it", async () => {
    // Before: ingest stores the password as it came.
    jest
      .spyOn(AppLogScrubRuleService, "loadScrubRules")
      .mockImplementation(async () => {
        return logRules
          .map((rule: LogScrubRule) => {
            return compileScrubRule(rule);
          })
          .filter(Boolean) as Array<CompiledScrubRule<LogScrubRule>>;
      });

    const before: Array<JSONObject> = await ingest();

    expect(JSON.stringify(before)).toContain(PASSWORD);
    submissions = [];

    // OneUptime AI works on the issue: no person, no rule, the defaults.
    await DataSecurityAiEngine.evaluateIssue({
      projectId: PROJECT_ID,
      dataSecurityIssueId: ISSUE_ID,
    });

    // It made the change without asking.
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.planKey).toMatch(/^scrub-alone:/);
    expect(
      transitions.some((transition: { set: JSONObject }): boolean => {
        return (
          transition.set["status"] ===
          DataSecurityAiProposalStatus.AppliedWithoutAsking
        );
      }),
    ).toBe(true);

    // The rule: checkout's db.password, whole, redacted, with its proof.
    expect(logRules).toHaveLength(1);

    const rule: LogScrubRule = logRules[0]!;

    expect(rule.patternType).toBe(SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE);
    expect(rule.attributeKeys).toEqual(["db.password"]);
    expect(rule.scrubAction).toBe(LogScrubAction.Redact);
    expect(rule.serviceId?.toString()).toBe(CHECKOUT.toString());
    expect(rule.name).toBe(
      "Data Security: Password or secret in db.password of checkout",
    );
    expect(readScrubRuleProof(rule.proof)).not.toBeNull();
    expect(
      doesScrubRuleProofCover({
        rule: {
          signal: "log",
          patternType: rule.patternType!,
          attributeKeys: rule.attributeKeys,
          scrubAction: rule.scrubAction,
          fieldsToScrub: rule.fieldsToScrub,
          serviceId: rule.serviceId,
        },
        proof: rule.proof,
        place: {
          dataTypeId: "generic-secret",
          location: "attributes.db.password",
          kind: DataStoreKind.TelemetryLogs,
        },
      }),
    ).toBe(true);
    expect(marked).toContainEqual({
      id: FINDING_ID.toString(),
      isScrubbed: true,
    });

    // The issue's timeline: what was done, how it was proven, to rotate it, and the Undo.
    const made: JSONObject | undefined = issueFeed.find(
      (item: JSONObject): boolean => {
        return String(item["feedInfoInMarkdown"]).includes(
          "made this change without asking",
        );
      },
    );

    expect(made).toBeDefined();
    expect(String(made!["feedInfoInMarkdown"])).toContain(
      "Scrub rules made: **Data Security: Password or secret in db.password of checkout**",
    );
    expect(String(made!["feedInfoInMarkdown"])).toContain("Undo it here");
    expect(String(made!["moreInformationInMarkdown"])).toContain("Proven on");
    expect(String(made!["moreInformationInMarkdown"])).toContain(
      "**Rotate this secret.**",
    );
    expect(String(made!["moreInformationInMarkdown"])).toContain(
      "`attributes.db.password` of checkout · Logs",
    );
    expect(String(made!["moreInformationInMarkdown"])).toContain(
      "press Undo on this entry",
    );
    expect(String(made!["dataSecurityAiProposalId"])).toBe(
      proposals[0]!.id!.toString(),
    );

    // The store's and the service's owners were emailed, to rotate it.
    expect(
      emails.map((email: { to: string }): string => {
        return email.to;
      }),
    ).toEqual(["store-owner@acme.test", "checkout-owner@acme.test"]);
    expect(emails[0]!.subject).toContain("rotate it");
    expect(emails[0]!.message).toContain("Rotate this secret.");

    // After: ingest hides checkout's password, and only checkout's.
    const after: Array<JSONObject> = await ingest();
    const checkout: JSONObject = after.find((row: JSONObject): boolean => {
      return String(row["body"]).startsWith("checkout");
    })!;
    const payments: JSONObject = after.find((row: JSONObject): boolean => {
      return String(row["body"]).startsWith("payments");
    })!;

    expect((checkout["attributes"] as JSONObject)["db.password"]).toBe(
      "[REDACTED]",
    );
    expect((checkout["attributes"] as JSONObject)["db.user"]).toBe(
      "orders_app",
    );
    expect((payments["attributes"] as JSONObject)["db.password"]).toBe(
      PASSWORD,
    );

    // Each value it hid is counted, by its rule and service.
    expect(
      ScrubRuleValueCounter.getPendingEntries().map(
        (entry: {
          scrubRuleId: string;
          serviceId: string;
          valueCount: number;
        }) => {
          return {
            scrubRuleId: entry.scrubRuleId,
            serviceId: entry.serviceId,
            valueCount: entry.valueCount,
          };
        },
      ),
    ).toEqual([
      {
        scrubRuleId: RULE_ID.toString(),
        serviceId: CHECKOUT.toString(),
        valueCount: 1,
      },
    ]);
  });
});
