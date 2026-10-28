import DataSecurityEvaluator, {
  MAX_STORES_PER_EVALUATION,
} from "../../../../Server/Utils/DataSecurity/DataSecurityEvaluator";
import DataSecurityFlows from "../../../../Server/Utils/DataSecurity/DataSecurityFlows";
import DataSecurityIntegrations, {
  OpenedIssueForIntegrations,
} from "../../../../Server/Utils/DataSecurity/DataSecurityIntegrations";
import DataSecurityIssueReconciler, {
  ReconcileStoreInput,
  ReconcileStoreOutput,
} from "../../../../Server/Utils/DataSecurity/DataSecurityIssueReconciler";
import DataSecurityCheckSettingService from "../../../../Server/Services/DataSecurityCheckSettingService";
import DataSecurityCustomDataTypeService from "../../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityFlowService from "../../../../Server/Services/DataSecurityFlowService";
import DataSecurityIssueFeedService from "../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../Server/Services/DataSecurityIssueService";
import DataSecurityResidencyRuleService from "../../../../Server/Services/DataSecurityResidencyRuleService";
import DataSecuritySettingService from "../../../../Server/Services/DataSecuritySettingService";
import DataStoreAccessService from "../../../../Server/Services/DataStoreAccessService";
import DataStoreFindingService from "../../../../Server/Services/DataStoreFindingService";
import DataStoreOwnerTeamService from "../../../../Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../../Server/Services/DataStoreOwnerUserService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import SecurityEntityRiskService from "../../../../Server/Services/SecurityEntityRiskService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import logger from "../../../../Server/Utils/Logger";
import DataSecurityCheckSetting from "../../../../Models/DatabaseModels/DataSecurityCheckSetting";
import DataSecurityCustomDataType from "../../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecurityFlow from "../../../../Models/DatabaseModels/DataSecurityFlow";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityResidencyRule from "../../../../Models/DatabaseModels/DataSecurityResidencyRule";
import DataSecuritySetting from "../../../../Models/DatabaseModels/DataSecuritySetting";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../../Models/DatabaseModels/DataStoreAccess";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import DataStoreOwnerTeam from "../../../../Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "../../../../Models/DatabaseModels/DataStoreOwnerUser";
import SecurityEntityRisk from "../../../../Models/DatabaseModels/SecurityEntityRisk";
import OneUptimeDate from "../../../../Types/Date";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SecuritySeverity from "../../../../Types/SecuritySeverity";
import DataCategory from "../../../../Types/DataSecurity/DataCategory";
import DataConfidence from "../../../../Types/DataSecurity/DataConfidence";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataStoreEnvironment from "../../../../Types/DataSecurity/DataStoreEnvironment";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  DataStoreExposure,
  DataStorePostureFacts,
} from "../../../../Types/DataSecurity/DataStorePosture";
import * as CheckCatalog from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import { ResidencyRuleInput } from "../../../../Types/DataSecurity/DataSecurityResidency";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import { customDataTypeId } from "../../../../Utils/DataSecurity/CustomDataTypeDetector";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What a project's stores are, and what is wrong with them
 * (DataSecurityEvaluator): every reader of the evaluation is stood in for
 * by rows written here - the readers honour the query operators the
 * evaluator builds, as Postgres would - while the real check catalog and
 * the real issue reconciler decide what opens, and the issue service's
 * writes are recorded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

type StoreFacts = Parameters<
  typeof DataSecurityEvaluator.evaluateStore
>[0]["facts"];

interface Fixture {
  setting: DataSecuritySetting;
  stores: Array<DataStore>;
  findings: Array<DataStoreFinding>;
  ownerUsers: Array<DataStoreOwnerUser>;
  ownerTeams: Array<DataStoreOwnerTeam>;
  access: Array<DataStoreAccess>;
  flows: Array<DataSecurityFlow>;
  issues: Array<DataSecurityIssue>;
  risks: Array<SecurityEntityRisk>;
  checkSettings: Array<DataSecurityCheckSetting>;
  residencyRules: Array<DataSecurityResidencyRule>;
  customTypes: Array<DataSecurityCustomDataType>;
}

interface FindByArgument {
  query: JSONObject;
  select?: JSONObject | undefined;
  skip?: number | undefined;
  limit?: number | undefined;
  props?: { isRoot?: boolean } | undefined;
}

interface RawOperator {
  objectLiteralParameters: Record<string, unknown>;
  getSql: (alias: string) => string;
}

let fixture: Fixture;
let summaries: Map<string, JSONObject>;
let createdIssues: Array<DataSecurityIssue>;
let checksSpy: jest.SpyInstance;
let integrationsSpy: jest.SpyInstance;
let flowsSpy: jest.SpyInstance;
let findingsSpy: jest.SpyInstance;
let risksSpy: jest.SpyInstance;
let storesSpy: jest.SpyInstance;
let summarySpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

function boundValue(operator: unknown): unknown {
  return Object.values((operator as RawOperator).objectLiteralParameters)[0];
}

function pageOf<T>(rows: Array<T>, findBy: FindByArgument): Array<T> {
  const skip: number = Number(findBy.skip || 0);
  const limit: number = Number(findBy.limit || rows.length);

  return rows.slice(skip, skip + limit);
}

function newFixture(): Fixture {
  const setting: DataSecuritySetting = new DataSecuritySetting();
  setting.projectId = PROJECT_ID;

  return {
    setting,
    stores: [],
    findings: [],
    ownerUsers: [],
    ownerTeams: [],
    access: [],
    flows: [],
    issues: [],
    risks: [],
    checkSettings: [],
    residencyRules: [],
    customTypes: [],
  };
}

beforeEach(() => {
  fixture = newFixture();
  summaries = new Map();
  createdIssues = [];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });
  jest
    .spyOn(DataSecuritySettingService, "getOrCreateForProject")
    .mockImplementation(async () => {
      return fixture.setting;
    });
  storesSpy = jest.spyOn(DataStoreService, "findBy").mockImplementation((async (
    findBy: FindByArgument,
  ) => {
    return pageOf(fixture.stores, findBy);
  }) as never);
  findingsSpy = jest
    .spyOn(DataStoreFindingService, "findBy")
    .mockImplementation((async (findBy: FindByArgument) => {
      const since: Date = boundValue(findBy.query["lastSeenAt"]) as Date;

      return pageOf(
        fixture.findings.filter((finding: DataStoreFinding) => {
          return (
            !finding.isSuppressed &&
            Boolean(finding.lastSeenAt) &&
            finding.lastSeenAt!.getTime() >= since.getTime()
          );
        }),
        findBy,
      );
    }) as never);
  jest.spyOn(DataStoreOwnerUserService, "findBy").mockImplementation((async (
    findBy: FindByArgument,
  ) => {
    return pageOf(fixture.ownerUsers, findBy);
  }) as never);
  jest.spyOn(DataStoreOwnerTeamService, "findBy").mockImplementation((async (
    findBy: FindByArgument,
  ) => {
    return pageOf(fixture.ownerTeams, findBy);
  }) as never);
  jest.spyOn(DataStoreAccessService, "findBy").mockImplementation((async (
    findBy: FindByArgument,
  ) => {
    return pageOf(fixture.access, findBy);
  }) as never);
  jest.spyOn(DataSecurityFlowService, "findBy").mockImplementation((async (
    findBy: FindByArgument,
  ) => {
    return pageOf(fixture.flows, findBy);
  }) as never);
  jest.spyOn(DataSecurityIssueService, "findBy").mockImplementation((async (
    findBy: FindByArgument,
  ) => {
    return pageOf(fixture.issues, findBy);
  }) as never);
  risksSpy = jest
    .spyOn(SecurityEntityRiskService, "findBy")
    .mockImplementation((async (findBy: FindByArgument) => {
      const after: Date = boundValue(findBy.query["riskExpiresAt"]) as Date;

      return pageOf(
        fixture.risks.filter((risk: SecurityEntityRisk) => {
          return (
            risk.entityType === findBy.query["entityType"] &&
            Boolean(risk.riskExpiresAt) &&
            risk.riskExpiresAt!.getTime() > after.getTime()
          );
        }),
        findBy,
      );
    }) as never);
  jest
    .spyOn(DataSecurityCheckSettingService, "findBy")
    .mockImplementation((async (findBy: FindByArgument) => {
      return pageOf(fixture.checkSettings, findBy);
    }) as never);
  jest
    .spyOn(DataSecurityResidencyRuleService, "findBy")
    .mockImplementation((async (findBy: FindByArgument) => {
      return pageOf(
        fixture.residencyRules.filter((rule: DataSecurityResidencyRule) => {
          return rule.isEnabled === findBy.query["isEnabled"];
        }),
        findBy,
      );
    }) as never);
  jest
    .spyOn(DataSecurityCustomDataTypeService, "findBy")
    .mockImplementation((async (findBy: FindByArgument) => {
      return pageOf(fixture.customTypes, findBy);
    }) as never);

  summarySpy = jest
    .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      summaries.set(data.id.toString(), data.data);
    }) as never);

  jest.spyOn(DataSecurityIssueService, "create").mockImplementation((async (
    createBy: CreateBy<DataSecurityIssue>,
  ): Promise<DataSecurityIssue> => {
    createBy.data.id = ObjectID.generate();
    createdIssues.push(createBy.data);
    return createBy.data;
  }) as never);
  jest
    .spyOn(DataSecurityIssueService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DataSecurityIssueService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);

  flowsSpy = jest
    .spyOn(DataSecurityFlows, "computeProjectFlows")
    .mockResolvedValue(undefined);
  integrationsSpy = jest
    .spyOn(DataSecurityIntegrations, "onIssuesOpened")
    .mockResolvedValue(undefined);
  checksSpy = jest.spyOn(CheckCatalog, "evaluateDataStoreChecks");
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function storeOf(data: {
  name: string;
  kind?: DataStoreKind | undefined;
  storeKey?: string | undefined;
  environment?: DataStoreEnvironment | undefined;
  posture?: DataStorePostureFacts | undefined;
  region?: string | undefined;
  sensitivityOverride?: string | undefined;
  isAiData?: boolean | undefined;
  lastActivityAt?: Date | undefined;
  estimatedRecords?: number | undefined;
  contentScanState?: JSONObject | undefined;
}): DataStore {
  const kind: DataStoreKind = data.kind || DataStoreKind.AwsS3Bucket;
  const store: DataStore = new DataStore(ObjectID.generate());
  store.projectId = PROJECT_ID;
  store.name = data.name;
  store.kind = kind;
  store.storeKey =
    data.storeKey === undefined
      ? `cloud:aws:${kind}:arn:aws:s3:::${data.name}`
      : data.storeKey;
  store.environment = data.environment || DataStoreEnvironment.Unknown;

  if (data.posture) {
    store.posture = data.posture;
  }

  if (data.region) {
    store.region = data.region;
  }

  if (data.sensitivityOverride) {
    store.sensitivityOverride = data.sensitivityOverride as DataSensitivity;
  }

  if (data.isAiData !== undefined) {
    store.isAiData = data.isAiData;
  }

  if (data.lastActivityAt) {
    store.lastActivityAt = data.lastActivityAt;
  }

  if (data.estimatedRecords !== undefined) {
    store.estimatedRecords = data.estimatedRecords;
  }

  if (data.contentScanState) {
    store.contentScanState = data.contentScanState;
  }

  return store;
}

function findingOf(
  store: DataStore,
  dataTypeId: string | undefined,
  options: {
    confidence?: DataConfidence | undefined;
    matchCount?: number | undefined;
    isScrubbed?: boolean | undefined;
    isSuppressed?: boolean | undefined;
    seenDaysAgo?: number | undefined;
  } = {},
): DataStoreFinding {
  const finding: DataStoreFinding = new DataStoreFinding(ObjectID.generate());
  finding.projectId = PROJECT_ID;
  finding.dataStoreId = store.id!;

  if (dataTypeId !== undefined) {
    finding.dataTypeId = dataTypeId;
  }

  finding.confidence = options.confidence || DataConfidence.High;
  finding.matchCount =
    options.matchCount === undefined ? 12 : options.matchCount;
  finding.isScrubbed = Boolean(options.isScrubbed);
  finding.isSuppressed = Boolean(options.isSuppressed);
  finding.lastSeenAt = new Date(
    NOW.getTime() - (options.seenDaysAgo || 1) * DAY_IN_MS,
  );

  return finding;
}

function ownerUserOf(store: DataStore): DataStoreOwnerUser {
  const owner: DataStoreOwnerUser = new DataStoreOwnerUser();
  owner.dataStoreId = store.id!;
  return owner;
}

function ownerTeamOf(store: DataStore): DataStoreOwnerTeam {
  const owner: DataStoreOwnerTeam = new DataStoreOwnerTeam();
  owner.dataStoreId = store.id!;
  return owner;
}

function accessOf(
  store: DataStore,
  principal: string | undefined,
  isPublic: boolean = false,
): DataStoreAccess {
  const entry: DataStoreAccess = new DataStoreAccess();
  entry.dataStoreId = store.id!;

  if (principal !== undefined) {
    entry.principal = principal;
  }

  entry.isPublic = isPublic;
  return entry;
}

function flowOf(data: {
  kind: string;
  source?: DataStore | undefined;
  destination?: DataStore | undefined;
  destinationName?: string | undefined;
}): DataSecurityFlow {
  const flow: DataSecurityFlow = new DataSecurityFlow();
  flow.kind = data.kind;

  if (data.source) {
    flow.sourceDataStoreId = data.source.id!;
  }

  if (data.destination) {
    flow.destinationDataStoreId = data.destination.id!;
  }

  if (data.destinationName) {
    flow.destination = data.destinationName;
  }

  return flow;
}

function riskOf(data: {
  store: DataStore;
  sources: Array<{ source: SecurityDetectionSource; points: number }>;
  expiresInDays?: number | undefined;
  entityKey?: string | undefined;
}): SecurityEntityRisk {
  const risk: SecurityEntityRisk = new SecurityEntityRisk();
  risk.projectId = PROJECT_ID;
  risk.entityType = SecurityEntityType.DataStore;
  risk.entityKey =
    data.entityKey === undefined
      ? `data-store:${data.store.storeKey}`.toLowerCase()
      : data.entityKey;
  risk.riskExpiresAt = new Date(
    NOW.getTime() +
      (data.expiresInDays === undefined ? 3 : data.expiresInDays) * DAY_IN_MS,
  );
  risk.contributions = data.sources.map(
    (contribution: { source: SecurityDetectionSource; points: number }) => {
      return {
        sourceKey: `rule:${ObjectID.generate().toString()}`,
        source: contribution.source,
        sourceName: "Mass download from one principal",
        severity: OcsfSeverity.High,
        points: contribution.points,
        hits: 3,
        firstSeenAt: NOW.toISOString(),
        lastSeenAt: NOW.toISOString(),
        mitreTactics: [],
        mitreTechniques: [],
      };
    },
  ) as unknown as JSONArray;
  return risk;
}

function checkRunOf(storeName: string): {
  input: CheckCatalog.DataStoreCheckInput;
  options: {
    disabledCheckIds?: ReadonlySet<string> | undefined;
    severityOverrides?: ReadonlyMap<string, SecuritySeverity> | undefined;
  };
  checks: Array<CheckCatalog.EvaluatedCheck>;
} {
  const index: number = checksSpy.mock.calls.findIndex(
    (call: Array<unknown>) => {
      return (call[0] as CheckCatalog.DataStoreCheckInput).name === storeName;
    },
  );

  if (index < 0) {
    throw new Error(`The checks never ran on ${storeName}.`);
  }

  return {
    input: checksSpy.mock.calls[index]![0] as CheckCatalog.DataStoreCheckInput,
    options: checksSpy.mock.calls[index]![1] as {
      disabledCheckIds?: ReadonlySet<string> | undefined;
      severityOverrides?: ReadonlyMap<string, SecuritySeverity> | undefined;
    },
    checks: checksSpy.mock.results[index]!
      .value as Array<CheckCatalog.EvaluatedCheck>,
  };
}

function checkOn(
  storeName: string,
  checkId: string,
): CheckCatalog.EvaluatedCheck | undefined {
  return checkRunOf(storeName).checks.find(
    (evaluated: CheckCatalog.EvaluatedCheck) => {
      return evaluated.check.id === checkId;
    },
  );
}

function summaryOf(store: DataStore): JSONObject {
  const summary: JSONObject | undefined = summaries.get(store.id!.toString());

  if (!summary) {
    throw new Error(`No summary was written for ${store.name}.`);
  }

  return summary;
}

function openedFor(store: DataStore): Array<DataSecurityIssue> {
  return createdIssues.filter((issue: DataSecurityIssue) => {
    return issue.dataStoreId?.toString() === store.id!.toString();
  });
}

function openedCheckIds(store: DataStore): Array<string> {
  return openedFor(store)
    .map((issue: DataSecurityIssue): string => {
      return issue.checkId || "";
    })
    .sort();
}

function evaluate(): Promise<void> {
  return DataSecurityEvaluator.evaluateProject(PROJECT_ID);
}

function factsOf(overrides: Partial<StoreFacts> = {}): StoreFacts {
  return {
    findings: [],
    unscrubbedDataTypeIds: new Set(),
    hasOwner: true,
    readers: new Set(),
    copiedFromProductionStoreName: null,
    aiProvidersReached: new Set(),
    hasRecentSecurityActivity: false,
    issues: [],
    ...overrides,
  };
}

function evaluateOne(data: {
  store: DataStore;
  facts?: StoreFacts | undefined;
  residencyRules?: Array<ResidencyRuleInput> | undefined;
}): Promise<{ output: ReconcileStoreOutput; sensitivity: DataSensitivity }> {
  return DataSecurityEvaluator.evaluateStore({
    projectId: PROJECT_ID,
    store: data.store,
    facts: data.facts || factsOf(),
    checkSettings: { disabled: new Set(), overrides: new Map() },
    residencyRules: data.residencyRules || [],
    now: NOW,
  });
}

const EMAIL_HIGH: { dataTypeId: string; confidence: DataConfidence } = {
  dataTypeId: "email-address",
  confidence: DataConfidence.High,
};

describe("DataSecurityEvaluator.evaluateStore", () => {
  test("a person's sensitivity override decides the checks, while the sensitivity the scans found is what is saved", async () => {
    const store: DataStore = storeOf({
      name: "customer-exports",
      sensitivityOverride: DataSensitivity.Restricted,
    });

    const result: {
      output: ReconcileStoreOutput;
      sensitivity: DataSensitivity;
    } = await evaluateOne({
      store,
      facts: factsOf({ findings: [EMAIL_HIGH], hasOwner: false }),
    });

    expect(checkRunOf("customer-exports").input.sensitivity).toBe(
      DataSensitivity.Restricted,
    );
    // No owner on a Restricted store is Medium; on a Confidential one, Low.
    expect(checkOn("customer-exports", "no-owner")?.severity).toBe(
      SecuritySeverity.Medium,
    );
    expect(result.sensitivity).toBe(DataSensitivity.Restricted);
    expect(summaryOf(store)["sensitivity"]).toBe(DataSensitivity.Confidential);
    expect(createdIssues[0]!.severity).toBe(SecuritySeverity.Medium);
  });

  test("without an override, the checks read the sensitivity the scans found", async () => {
    const store: DataStore = storeOf({ name: "newsletter-signups" });

    const result: {
      output: ReconcileStoreOutput;
      sensitivity: DataSensitivity;
    } = await evaluateOne({
      store,
      facts: factsOf({ findings: [EMAIL_HIGH], hasOwner: false }),
    });

    expect(checkRunOf("newsletter-signups").input.sensitivity).toBe(
      DataSensitivity.Confidential,
    );
    expect(checkOn("newsletter-signups", "no-owner")?.severity).toBe(
      SecuritySeverity.Low,
    );
    expect(result.sensitivity).toBe(DataSensitivity.Confidential);
  });

  test("an override that is not a sensitivity is ignored", async () => {
    const store: DataStore = storeOf({
      name: "legacy-store",
      sensitivityOverride: "Top secret",
    });

    const result: {
      output: ReconcileStoreOutput;
      sensitivity: DataSensitivity;
    } = await evaluateOne({
      store,
      facts: factsOf({ findings: [EMAIL_HIGH] }),
    });

    expect(checkRunOf("legacy-store").input.sensitivity).toBe(
      DataSensitivity.Confidential,
    );
    expect(result.sensitivity).toBe(DataSensitivity.Confidential);
  });

  test("exposure comes from the store's posture, and is saved and scored", async () => {
    const cases: Array<[DataStorePostureFacts | undefined, DataStoreExposure]> =
      [
        [
          { readAt: NOW.toISOString(), publicRead: true },
          DataStoreExposure.Public,
        ],
        [
          { readAt: NOW.toISOString(), sharedWithExternal: ["210987654321"] },
          DataStoreExposure.OtherAccounts,
        ],
        [
          { readAt: NOW.toISOString(), publicNetworkAccess: true },
          DataStoreExposure.InternetReachable,
        ],
        [
          { readAt: NOW.toISOString(), publicRead: false },
          DataStoreExposure.Private,
        ],
        [{ publicRead: true }, DataStoreExposure.Unknown],
        [undefined, DataStoreExposure.Unknown],
      ];

    for (const [index, [posture, exposure]] of cases.entries()) {
      const store: DataStore = storeOf({ name: `bucket-${index}`, posture });
      const reconcileSpy: jest.SpyInstance = jest.spyOn(
        DataSecurityIssueReconciler,
        "reconcileStore",
      );

      await evaluateOne({ store, facts: factsOf({ findings: [EMAIL_HIGH] }) });

      expect(summaryOf(store)["exposure"]).toBe(exposure);
      expect(
        (
          reconcileSpy.mock.calls[
            reconcileSpy.mock.calls.length - 1
          ]![0] as ReconcileStoreInput
        ).exposure,
      ).toBe(exposure);
      expect(checkRunOf(`bucket-${index}`).input.posture).toEqual(
        posture || {},
      );
    }

    // The public bucket's Critical issue carries 10 points for being public.
    const publicIssue: DataSecurityIssue | undefined = createdIssues.find(
      (issue: DataSecurityIssue) => {
        return issue.checkId === "public-read";
      },
    );

    expect(publicIssue?.severity).toBe(SecuritySeverity.Critical);
    expect(publicIssue?.riskScore).toBe(85);
  });

  test("unscrubbed data types reach the checks of telemetry stores only", async () => {
    const logs: DataStore = storeOf({
      name: "checkout · Logs",
      kind: DataStoreKind.TelemetryLogs,
      storeKey: "telemetry:service-1:Logs",
    });
    const bucket: DataStore = storeOf({ name: "support-attachments" });
    const facts: () => StoreFacts = (): StoreFacts => {
      return factsOf({
        findings: [
          EMAIL_HIGH,
          { dataTypeId: "generic-secret", confidence: DataConfidence.High },
        ],
        unscrubbedDataTypeIds: new Set(["email-address", "generic-secret"]),
      });
    };

    await evaluateOne({ store: logs, facts: facts() });
    await evaluateOne({ store: bucket, facts: facts() });

    expect(checkRunOf("checkout · Logs").input.unscrubbedDataTypeIds).toEqual([
      "email-address",
      "generic-secret",
    ]);
    expect(
      checkOn("checkout · Logs", "sensitive-data-in-telemetry")?.result,
    ).toEqual({
      status: CheckCatalog.DataSecurityCheckStatus.Fail,
      evidence: "1 kind(s) of sensitive data are not scrubbed.",
      severity: undefined,
    });
    expect(
      checkOn("checkout · Logs", "secrets-in-telemetry")?.result.evidence,
    ).toBe("1 kind(s) of secret are not scrubbed.");
    expect(
      checkRunOf("support-attachments").input.unscrubbedDataTypeIds,
    ).toEqual([]);
    expect(
      checkOn("support-attachments", "sensitive-data-in-telemetry"),
    ).toBeUndefined();
    expect(openedCheckIds(logs)).toEqual([
      "secrets-in-telemetry",
      "sensitive-data-in-telemetry",
    ]);
  });

  test("residency rules the store's region or replicas break reach the checks", async () => {
    const store: DataStore = storeOf({
      name: "crm-backups",
      region: "us-east-1",
      posture: {
        readAt: NOW.toISOString(),
        replicationRegions: ["eu-west-1", "ap-south-1"],
      },
    });
    const rule: ResidencyRuleInput = {
      name: "EU customers stay in the EU",
      dataCategories: [],
      subjectCountries: [],
      allowedRegions: ["eu-*"],
    };

    await evaluateOne({
      store,
      facts: factsOf({ findings: [EMAIL_HIGH] }),
      residencyRules: [rule],
    });

    expect(checkRunOf("crm-backups").input.residencyViolations).toEqual([
      { ruleName: "EU customers stay in the EU", region: "us-east-1" },
      { ruleName: "EU customers stay in the EU", region: "ap-south-1" },
    ]);
    expect(checkOn("crm-backups", "residency-violation")?.result.evidence).toBe(
      'us-east-1 is outside what "EU customers stay in the EU" allows.',
    );
    expect(checkOn("crm-backups", "residency-violation")?.severity).toBe(
      SecuritySeverity.High,
    );
  });

  test("a residency rule about other data, or a store inside its regions, is no violation", async () => {
    const store: DataStore = storeOf({
      name: "eu-crm",
      region: "eu-central-1",
      posture: { readAt: NOW.toISOString() },
    });

    await evaluateOne({
      store,
      facts: factsOf({ findings: [EMAIL_HIGH] }),
      residencyRules: [
        {
          name: "Health data stays in Frankfurt",
          dataCategories: [DataCategory.Health],
          subjectCountries: [],
          allowedRegions: ["eu-central-2"],
        },
        {
          name: "EU only",
          dataCategories: [],
          subjectCountries: [],
          allowedRegions: ["eu-*"],
        },
      ],
    });

    expect(checkRunOf("eu-crm").input.residencyViolations).toEqual([]);
    expect(checkOn("eu-crm", "residency-violation")?.result.status).toBe(
      CheckCatalog.DataSecurityCheckStatus.Pass,
    );
  });

  test("password fields the last content scan found in plain text reach their check", async () => {
    const store: DataStore = storeOf({
      name: "accounts-db",
      kind: DataStoreKind.PostgreSql,
      storeKey: "database:accounts",
      contentScanState: {
        plaintextPasswordFields: ["public.users.password"],
        cursor: "users:1000",
      },
    });
    const malformed: DataStore = storeOf({
      name: "orders-db",
      kind: DataStoreKind.PostgreSql,
      storeKey: "database:orders",
      contentScanState: { plaintextPasswordFields: "public.users.password" },
    });

    await evaluateOne({ store, facts: factsOf({ findings: [EMAIL_HIGH] }) });
    await evaluateOne({ store: malformed, facts: factsOf() });

    expect(checkRunOf("accounts-db").input.plaintextPasswordFields).toEqual([
      "public.users.password",
    ]);
    expect(checkOn("accounts-db", "plaintext-passwords")?.result.evidence).toBe(
      "Plain-text passwords in public.users.password.",
    );
    expect(checkRunOf("orders-db").input.plaintextPasswordFields).toEqual([]);
  });

  test("readers are counted once the store's configuration has been read, and not before", async () => {
    const readers: Set<string> = new Set();

    for (let index: number = 0; index < 26; index++) {
      readers.add(`arn:aws:iam::123456789012:role/reader-${index}`);
    }

    const read: DataStore = storeOf({
      name: "card-vault",
      posture: { readAt: NOW.toISOString() },
    });
    const unread: DataStore = storeOf({ name: "card-vault-replica" });
    const restricted: StoreFacts = factsOf({
      findings: [
        { dataTypeId: "credit-card-number", confidence: DataConfidence.High },
      ],
      readers,
    });

    await evaluateOne({ store: read, facts: restricted });
    await evaluateOne({
      store: unread,
      facts: factsOf({
        findings: restricted.findings,
        readers,
      }),
    });

    expect(checkRunOf("card-vault").input.readerCount).toBe(26);
    expect(checkOn("card-vault", "many-readers")?.result.evidence).toBe(
      "26 identities can read it.",
    );
    expect(checkOn("card-vault", "many-readers")?.severity).toBe(
      SecuritySeverity.Medium,
    );
    expect(checkRunOf("card-vault-replica").input.readerCount).toBeNull();
    expect(checkOn("card-vault-replica", "many-readers")?.result.status).toBe(
      CheckCatalog.DataSecurityCheckStatus.Unknown,
    );
  });

  test("copies, AI providers, AI data, ownership and activity reach the checks", async () => {
    const dev: DataStore = storeOf({
      name: "orders-dev",
      environment: DataStoreEnvironment.Development,
      isAiData: true,
      lastActivityAt: new Date(NOW.getTime() - 100 * DAY_IN_MS),
    });

    await evaluateOne({
      store: dev,
      facts: factsOf({
        findings: [
          { dataTypeId: "credit-card-number", confidence: DataConfidence.High },
        ],
        copiedFromProductionStoreName: "orders-prod",
        aiProvidersReached: new Set(["openai"]),
        hasOwner: true,
      }),
    });

    const input: CheckCatalog.DataStoreCheckInput =
      checkRunOf("orders-dev").input;

    expect(input.environment).toBe(DataStoreEnvironment.Development);
    expect(input.copiedFromProductionStoreName).toBe("orders-prod");
    expect(input.aiProvidersReached).toEqual(["openai"]);
    expect(input.isAiData).toBe(true);
    expect(input.hasOwner).toBe(true);
    expect(input.now).toEqual(NOW);
    expect(
      checkOn("orders-dev", "production-data-in-non-production")?.result
        .evidence,
    ).toBe("It holds copies of data from orders-prod.");
    expect(checkOn("orders-dev", "sensitive-data-in-ai-store")?.severity).toBe(
      SecuritySeverity.High,
    );
    expect(checkOn("orders-dev", "stale-sensitive-data")?.result.evidence).toBe(
      "No activity for 100 days.",
    );
    expect(checkOn("orders-dev", "no-owner")?.result.status).toBe(
      CheckCatalog.DataSecurityCheckStatus.Pass,
    );
  });

  test("a store with no environment is checked as Unknown", async () => {
    const store: DataStore = storeOf({ name: "mystery" });
    delete store.environment;

    await evaluateOne({ store });

    expect(checkRunOf("mystery").input.environment).toBe(
      DataStoreEnvironment.Unknown,
    );
  });

  test("the reconciler is given the store's exposure, size, environment, activity, data types and issues", async () => {
    const existing: DataSecurityIssue = new DataSecurityIssue(
      ObjectID.generate(),
    );
    existing.checkId = "no-owner";
    existing.status = DataSecurityIssueStatus.Open;

    const store: DataStore = storeOf({
      name: "payments-prod",
      environment: DataStoreEnvironment.Production,
      estimatedRecords: 10_000_000,
      posture: { readAt: NOW.toISOString(), publicRead: true },
    });
    const reconcileSpy: jest.SpyInstance = jest.spyOn(
      DataSecurityIssueReconciler,
      "reconcileStore",
    );

    await evaluateOne({
      store,
      facts: factsOf({
        findings: [
          { dataTypeId: "email-address", confidence: DataConfidence.High },
          { dataTypeId: "credit-card-number", confidence: DataConfidence.High },
        ],
        hasRecentSecurityActivity: true,
        issues: [existing],
      }),
    });

    const input: ReconcileStoreInput = reconcileSpy.mock
      .calls[0]![0] as ReconcileStoreInput;

    expect(input.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(input.dataStoreId.toString()).toBe(store.id!.toString());
    expect(input.exposure).toBe(DataStoreExposure.Public);
    expect(input.estimatedRecords).toBe(10_000_000);
    expect(input.isProduction).toBe(true);
    expect(input.hasRecentSecurityActivity).toBe(true);
    expect(input.dataTypeIds).toEqual(["credit-card-number", "email-address"]);
    expect(input.existingIssues).toEqual([existing]);
    expect(input.now).toEqual(NOW);

    // Critical, public, ten million records, active, production: as risky as it gets.
    expect(
      createdIssues.find((issue: DataSecurityIssue) => {
        return issue.checkId === "public-read";
      })?.riskScore,
    ).toBe(100);
  });

  test("writes the store's summary: what it holds, whose, how exposed, and its issues", async () => {
    const store: DataStore = storeOf({
      name: "kyc-documents",
      posture: { readAt: NOW.toISOString(), publicRead: true },
    });

    const result: {
      output: ReconcileStoreOutput;
      sensitivity: DataSensitivity;
    } = await evaluateOne({
      store,
      facts: factsOf({
        findings: [
          { dataTypeId: "email-address", confidence: DataConfidence.High },
          { dataTypeId: "br-cpf", confidence: DataConfidence.Medium },
          { dataTypeId: "in-aadhaar", confidence: DataConfidence.High },
          { dataTypeId: "credit-card-number", confidence: DataConfidence.Low },
        ],
        hasOwner: false,
      }),
    });

    expect(summarySpy).toHaveBeenCalledTimes(1);
    expect(summarySpy.mock.calls[0]![0].id.toString()).toBe(
      store.id!.toString(),
    );
    expect(summaryOf(store)).toEqual({
      sensitivity: DataSensitivity.Restricted,
      dataTypeIds: ["br-cpf", "email-address", "in-aadhaar"],
      dataCategories: [
        DataCategory.ContactAndIdentity,
        DataCategory.GovernmentId,
      ],
      subjectCountries: ["BR", "IN"],
      exposure: DataStoreExposure.Public,
      findingCount: 4,
      openIssueCount: result.output.openIssueCount,
      highestIssueSeverity: SecuritySeverity.Critical,
      riskScore: 85,
    });
    expect(result.output.openIssueCount).toBe(openedFor(store).length);
    expect(openedCheckIds(store)).toEqual(["no-owner", "public-read"]);
  });
});

describe("DataSecurityEvaluator.evaluateProject: what it reads", () => {
  test("with checks turned off for the project, nothing is read and nothing is written", async () => {
    fixture.setting.isConfigurationScanEnabled = false;
    fixture.stores = [storeOf({ name: "customer-exports" })];

    await evaluate();

    expect(
      DataSecuritySettingService.getOrCreateForProject,
    ).toHaveBeenCalledWith(PROJECT_ID);
    expect(storesSpy).not.toHaveBeenCalled();
    expect(findingsSpy).not.toHaveBeenCalled();
    expect(flowsSpy).not.toHaveBeenCalled();
    expect(checksSpy).not.toHaveBeenCalled();
    expect(summarySpy).not.toHaveBeenCalled();
    expect(DataSecurityIssueService.create).not.toHaveBeenCalled();
    expect(DataSecurityIssueService.updateOneById).not.toHaveBeenCalled();
    expect(integrationsSpy).not.toHaveBeenCalled();
  });

  test("checks run unless the project turned them off", async () => {
    fixture.stores = [storeOf({ name: "customer-exports" })];

    await evaluate();

    expect(checkRunOf("customer-exports")).toBeDefined();
    expect(summarySpy).toHaveBeenCalledTimes(1);
  });

  test("a project with no stores reads nothing else", async () => {
    await evaluate();

    expect(storesSpy).toHaveBeenCalledTimes(1);
    expect(flowsSpy).not.toHaveBeenCalled();
    expect(findingsSpy).not.toHaveBeenCalled();
    expect(risksSpy).not.toHaveBeenCalled();
    expect(integrationsSpy).not.toHaveBeenCalled();
  });

  test("reads the project's stores that are not archived, as root, a page at a time", async () => {
    fixture.stores = [storeOf({ name: "customer-exports" })];

    await evaluate();

    const findBy: FindByArgument = storesSpy.mock
      .calls[0]![0] as FindByArgument;

    expect(findBy.query).toEqual({ projectId: PROJECT_ID, isArchived: false });
    expect(findBy.skip).toBe(0);
    expect(findBy.limit).toBe(1000);
    expect(findBy.props).toEqual({ isRoot: true });
    expect(findBy.select).toMatchObject({
      _id: true,
      name: true,
      storeKey: true,
      kind: true,
      environment: true,
      sensitivity: true,
      sensitivityOverride: true,
      posture: true,
      contentScanState: true,
      fingerprints: true,
    });
    expect(MAX_STORES_PER_EVALUATION).toBe(10000);
  });

  test("a full page is followed by the next one", async () => {
    const store: DataStore = storeOf({ name: "event-archive" });
    fixture.stores = [store];

    for (let index: number = 0; index < 1500; index++) {
      fixture.findings.push(findingOf(store, "email-address"));
    }

    await evaluate();

    expect(
      findingsSpy.mock.calls.map((call: Array<unknown>): number => {
        return Number((call[0] as FindByArgument).skip);
      }),
    ).toEqual([0, 1000]);
    expect(summaryOf(store)["findingCount"]).toBe(1500);
  });

  test("asks only for findings that are not suppressed and were seen in the last 30 days", async () => {
    const store: DataStore = storeOf({ name: "customer-exports" });
    fixture.stores = [store];
    fixture.findings = [
      findingOf(store, "email-address", { seenDaysAgo: 2 }),
      findingOf(store, "credit-card-number", { seenDaysAgo: 31 }),
      findingOf(store, "us-ssn", { isSuppressed: true }),
    ];

    await evaluate();

    const query: JSONObject = (findingsSpy.mock.calls[0]![0] as FindByArgument)
      .query;

    expect(query["projectId"]).toEqual(PROJECT_ID);
    expect(query["isSuppressed"]).toBe(false);
    expect(
      (query["lastSeenAt"] as unknown as RawOperator).getSql("seen"),
    ).toMatch(/^\(seen >= :[A-Za-z0-9]+\)$/);
    // Thirty days back, as the calendar counts them in the server's zone.
    expect(boundValue(query["lastSeenAt"])).toEqual(
      OneUptimeDate.addRemoveDays(NOW, -30),
    );
    expect(
      Math.abs(
        NOW.getTime() -
          (boundValue(query["lastSeenAt"]) as Date).getTime() -
          30 * DAY_IN_MS,
      ),
    ).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(summaryOf(store)["sensitivity"]).toBe(DataSensitivity.Confidential);
    expect(summaryOf(store)["dataTypeIds"]).toEqual(["email-address"]);
    expect(summaryOf(store)["findingCount"]).toBe(1);
  });

  test("a low-confidence finding is kept but decides nothing; one with no matches is dropped", async () => {
    const logs: DataStore = storeOf({
      name: "checkout · Logs",
      kind: DataStoreKind.TelemetryLogs,
      storeKey: "telemetry:service-1:Logs",
    });
    fixture.stores = [logs];
    fixture.findings = [
      findingOf(logs, "email-address", { confidence: DataConfidence.Medium }),
      findingOf(logs, "credit-card-number", { confidence: DataConfidence.Low }),
      findingOf(logs, "us-ssn", { matchCount: 0 }),
    ];

    await evaluate();

    expect(summaryOf(logs)).toMatchObject({
      sensitivity: DataSensitivity.Confidential,
      dataTypeIds: ["email-address"],
      findingCount: 2,
    });
    expect(checkRunOf("checkout · Logs").input.unscrubbedDataTypeIds).toEqual([
      "email-address",
    ]);
  });

  test("scrubbed findings still decide sensitivity, but are not unscrubbed", async () => {
    const logs: DataStore = storeOf({
      name: "checkout · Traces",
      kind: DataStoreKind.TelemetryTraces,
      storeKey: "telemetry:service-1:Traces",
    });
    fixture.stores = [logs];
    fixture.findings = [
      findingOf(logs, "credit-card-number", { isScrubbed: true }),
      findingOf(logs, "email-address"),
    ];

    await evaluate();

    expect(summaryOf(logs)["sensitivity"]).toBe(DataSensitivity.Restricted);
    expect(checkRunOf("checkout · Traces").input.unscrubbedDataTypeIds).toEqual(
      ["email-address"],
    );
  });

  test("findings of a store outside the evaluation, or with no data type, are ignored", async () => {
    const store: DataStore = storeOf({ name: "customer-exports" });
    const archived: DataStore = storeOf({ name: "old-exports" });
    fixture.stores = [store];
    fixture.findings = [
      findingOf(archived, "credit-card-number"),
      findingOf(store, undefined),
    ];

    await evaluate();

    expect(summaryOf(store)).toMatchObject({
      sensitivity: DataSensitivity.Public,
      findingCount: 0,
    });
    expect(summaries.has(archived.id!.toString())).toBe(false);
  });

  test("a custom data type carries the sensitivity and category its project gave it", async () => {
    const store: DataStore = storeOf({ name: "loyalty-db" });
    const custom: DataSecurityCustomDataType = new DataSecurityCustomDataType(
      ObjectID.generate(),
    );
    custom.sensitivity = DataSensitivity.Restricted;
    custom.category = DataCategory.Financial;
    const incomplete: DataSecurityCustomDataType =
      new DataSecurityCustomDataType(ObjectID.generate());
    incomplete.sensitivity = DataSensitivity.Restricted;

    fixture.stores = [store];
    fixture.customTypes = [custom, incomplete];
    fixture.findings = [
      findingOf(store, customDataTypeId(custom.id!.toString())),
      findingOf(store, customDataTypeId(incomplete.id!.toString())),
    ];

    await evaluate();

    expect(summaryOf(store)).toMatchObject({
      sensitivity: DataSensitivity.Restricted,
      dataTypeIds: [customDataTypeId(custom.id!.toString())],
      dataCategories: [DataCategory.Financial],
      findingCount: 2,
    });
  });

  test("an owner, directly or through a team, makes a store owned", async () => {
    const byUser: DataStore = storeOf({ name: "billing-db" });
    const byTeam: DataStore = storeOf({ name: "crm-db" });
    const nobody: DataStore = storeOf({ name: "scratch-exports" });
    fixture.stores = [byUser, byTeam, nobody];
    fixture.ownerUsers = [ownerUserOf(byUser)];
    fixture.ownerTeams = [ownerTeamOf(byTeam)];
    fixture.findings = [byUser, byTeam, nobody].map((store: DataStore) => {
      return findingOf(store, "email-address");
    });

    await evaluate();

    expect(checkRunOf("billing-db").input.hasOwner).toBe(true);
    expect(checkRunOf("crm-db").input.hasOwner).toBe(true);
    expect(checkRunOf("scratch-exports").input.hasOwner).toBe(false);
    expect(openedCheckIds(nobody)).toEqual(["no-owner"]);
    expect(openedCheckIds(byUser)).toEqual([]);
  });

  test("readers are counted once each, public grants and nameless entries aside", async () => {
    const store: DataStore = storeOf({
      name: "card-vault",
      posture: { readAt: NOW.toISOString() },
    });
    fixture.stores = [store];
    fixture.access = [
      accessOf(store, "arn:aws:iam::123456789012:role/payments"),
      accessOf(store, "arn:aws:iam::123456789012:role/payments"),
      accessOf(store, "arn:aws:iam::123456789012:role/analytics"),
      accessOf(store, "*", true),
      accessOf(store, undefined),
    ];

    await evaluate();

    expect(checkRunOf("card-vault").input.readerCount).toBe(2);
  });

  test("checks the project turned off do not run, and its severity overrides apply", async () => {
    const store: DataStore = storeOf({
      name: "card-vault",
      posture: { readAt: NOW.toISOString(), publicRead: true },
    });
    const off: DataSecurityCheckSetting = new DataSecurityCheckSetting();
    off.checkId = "no-owner";
    off.isEnabled = false;
    const lowered: DataSecurityCheckSetting = new DataSecurityCheckSetting();
    lowered.checkId = "public-read";
    lowered.severityOverride = SecuritySeverity.Low;
    const both: DataSecurityCheckSetting = new DataSecurityCheckSetting();
    both.checkId = "card-numbers-readable";
    both.isEnabled = false;
    both.severityOverride = SecuritySeverity.Critical;
    const nameless: DataSecurityCheckSetting = new DataSecurityCheckSetting();
    nameless.isEnabled = false;
    nameless.severityOverride = SecuritySeverity.Low;

    fixture.stores = [store];
    fixture.findings = [findingOf(store, "credit-card-number")];
    fixture.checkSettings = [off, lowered, both, nameless];

    await evaluate();

    const run: {
      options: {
        disabledCheckIds?: ReadonlySet<string> | undefined;
        severityOverrides?: ReadonlyMap<string, SecuritySeverity> | undefined;
      };
    } = checkRunOf("card-vault");

    expect([...(run.options.disabledCheckIds || [])].sort()).toEqual([
      "card-numbers-readable",
      "no-owner",
    ]);
    expect([...(run.options.severityOverrides || new Map()).entries()]).toEqual(
      [
        ["public-read", SecuritySeverity.Low],
        ["card-numbers-readable", SecuritySeverity.Critical],
      ],
    );
    expect(checkOn("card-vault", "no-owner")).toBeUndefined();
    expect(checkOn("card-vault", "card-numbers-readable")).toBeUndefined();
    expect(checkOn("card-vault", "public-read")?.severity).toBe(
      SecuritySeverity.Low,
    );
    expect(openedCheckIds(store)).toEqual(["public-read"]);
    expect(openedFor(store)[0]!.severity).toBe(SecuritySeverity.Low);
  });

  test("only enabled residency rules are read, and they reach every store's checks", async () => {
    const store: DataStore = storeOf({
      name: "crm-backups",
      region: "us-east-1",
    });
    const enabled: DataSecurityResidencyRule = new DataSecurityResidencyRule();
    enabled.name = "EU only";
    enabled.allowedRegions = ["eu-*"];
    enabled.isEnabled = true;
    const disabled: DataSecurityResidencyRule = new DataSecurityResidencyRule();
    disabled.name = "US only";
    disabled.allowedRegions = ["us-west-*"];
    disabled.isEnabled = false;
    const unnamed: DataSecurityResidencyRule = new DataSecurityResidencyRule();
    unnamed.allowedRegions = ["ap-*"];
    unnamed.isEnabled = true;

    fixture.stores = [store];
    fixture.findings = [findingOf(store, "email-address")];
    fixture.residencyRules = [enabled, disabled, unnamed];

    await evaluate();

    expect(
      (
        (DataSecurityResidencyRuleService.findBy as unknown as jest.SpyInstance)
          .mock.calls[0]![0] as FindByArgument
      ).query,
    ).toEqual({ projectId: PROJECT_ID, isEnabled: true });
    expect(checkRunOf("crm-backups").input.residencyViolations).toEqual([
      { ruleName: "EU only", region: "us-east-1" },
      { ruleName: "Residency rule", region: "us-east-1" },
    ]);
  });

  test("a copy of a production store's data in a non-production store fails its check there", async () => {
    const prod: DataStore = storeOf({
      name: "orders-prod",
      environment: DataStoreEnvironment.Production,
    });
    const dev: DataStore = storeOf({
      name: "orders-dev",
      environment: DataStoreEnvironment.Development,
    });
    fixture.stores = [prod, dev];
    fixture.findings = [
      findingOf(prod, "email-address"),
      findingOf(dev, "email-address"),
    ];
    fixture.ownerUsers = [ownerUserOf(prod), ownerUserOf(dev)];
    fixture.flows = [
      flowOf({ kind: DataSecurityFlows.COPY, source: prod, destination: dev }),
      flowOf({ kind: DataSecurityFlows.USES, source: prod }),
    ];

    await evaluate();

    expect(checkRunOf("orders-dev").input.copiedFromProductionStoreName).toBe(
      "orders-prod",
    );
    expect(
      checkRunOf("orders-prod").input.copiedFromProductionStoreName,
    ).toBeNull();
    expect(openedCheckIds(dev)).toEqual(["production-data-in-non-production"]);
    expect(openedFor(dev)[0]!.evidence).toBe(
      "It holds copies of data from orders-prod.",
    );
  });

  test("a copy between two stores neither of which is production is no evidence of production data", async () => {
    const staging: DataStore = storeOf({
      name: "orders-staging",
      environment: DataStoreEnvironment.Staging,
    });
    const dev: DataStore = storeOf({
      name: "orders-dev",
      environment: DataStoreEnvironment.Development,
    });
    const unknown: DataStore = storeOf({ name: "orders-copy" });
    fixture.stores = [staging, dev, unknown];
    fixture.findings = [staging, dev, unknown].map((store: DataStore) => {
      return findingOf(store, "email-address");
    });
    fixture.ownerUsers = [
      ownerUserOf(staging),
      ownerUserOf(dev),
      ownerUserOf(unknown),
    ];
    fixture.flows = [
      flowOf({
        kind: DataSecurityFlows.COPY,
        source: staging,
        destination: dev,
      }),
      flowOf({
        kind: DataSecurityFlows.COPY,
        source: unknown,
        destination: staging,
      }),
    ];

    await evaluate();

    expect(
      checkRunOf("orders-dev").input.copiedFromProductionStoreName,
    ).toBeNull();
    expect(
      checkRunOf("orders-staging").input.copiedFromProductionStoreName,
    ).toBeNull();
    expect(openedCheckIds(dev)).toEqual([]);
    expect(openedCheckIds(staging)).toEqual([]);
  });

  test("a production copy is not undone by a later copy from a store that is not production", async () => {
    const prod: DataStore = storeOf({
      name: "orders-prod",
      environment: DataStoreEnvironment.Production,
    });
    const staging: DataStore = storeOf({
      name: "orders-staging",
      environment: DataStoreEnvironment.Staging,
    });
    const dev: DataStore = storeOf({
      name: "orders-dev",
      environment: DataStoreEnvironment.Development,
    });
    fixture.stores = [prod, staging, dev];
    fixture.flows = [
      flowOf({ kind: DataSecurityFlows.COPY, source: prod, destination: dev }),
      flowOf({
        kind: DataSecurityFlows.COPY,
        source: staging,
        destination: dev,
      }),
    ];

    await evaluate();

    expect(checkRunOf("orders-dev").input.copiedFromProductionStoreName).toBe(
      "orders-prod",
    );
  });

  test("the AI providers a store's data was sent to reach its checks", async () => {
    const conversations: DataStore = storeOf({
      name: "support-bot · AI Conversations",
      kind: DataStoreKind.TelemetryAiConversations,
      storeKey: "telemetry:service-2:AI Conversations",
    });
    fixture.stores = [conversations];
    fixture.findings = [findingOf(conversations, "email-address")];
    fixture.ownerUsers = [ownerUserOf(conversations)];
    fixture.flows = [
      flowOf({
        kind: DataSecurityFlows.AI_PROVIDER,
        source: conversations,
        destinationName: "openai",
      }),
      flowOf({
        kind: DataSecurityFlows.AI_PROVIDER,
        source: conversations,
        destinationName: "anthropic",
      }),
      flowOf({
        kind: DataSecurityFlows.AI_PROVIDER,
        source: conversations,
        destinationName: "openai",
      }),
      flowOf({ kind: DataSecurityFlows.AI_PROVIDER, source: conversations }),
    ];

    await evaluate();

    expect(
      checkRunOf("support-bot · AI Conversations").input.aiProvidersReached,
    ).toEqual(["openai", "anthropic"]);
    expect(
      openedFor(conversations).find((issue: DataSecurityIssue) => {
        return issue.checkId === "sensitive-data-to-ai";
      })?.evidence,
    ).toBe("Sent to openai, anthropic.");
  });

  test("each store's existing issues are reconciled on that store", async () => {
    const owned: DataStore = storeOf({ name: "billing-db" });
    const other: DataStore = storeOf({ name: "crm-db" });
    const issue: DataSecurityIssue = new DataSecurityIssue(ObjectID.generate());
    issue.dataStoreId = owned.id!;
    issue.checkId = "no-owner";
    issue.status = DataSecurityIssueStatus.Open;
    const stray: DataSecurityIssue = new DataSecurityIssue(ObjectID.generate());
    stray.dataStoreId = ObjectID.generate();
    stray.checkId = "no-owner";
    stray.status = DataSecurityIssueStatus.Open;

    fixture.stores = [owned, other];
    fixture.findings = [findingOf(owned, "email-address")];
    fixture.ownerUsers = [ownerUserOf(owned), ownerUserOf(other)];
    fixture.issues = [issue, stray];

    await evaluate();

    const resolved: Array<{ id: ObjectID; data: JSONObject }> = (
      DataSecurityIssueService.updateOneById as unknown as jest.SpyInstance
    ).mock.calls.map((call: Array<unknown>) => {
      return call[0] as { id: ObjectID; data: JSONObject };
    });

    expect(
      resolved.map((write: { id: ObjectID }): string => {
        return write.id.toString();
      }),
    ).toEqual([issue.id!.toString()]);
    expect(resolved[0]!.data["status"]).toBe(DataSecurityIssueStatus.Resolved);
  });
});

describe("DataSecurityEvaluator.evaluateProject: activity Security Operations saw on a store", () => {
  // A public bucket of personal data: its public-read issue is Critical, 75 + 10.
  function publicBucket(
    name: string = "customer-exports",
    storeKey?: string,
  ): DataStore {
    const store: DataStore = storeOf({
      name,
      storeKey,
      posture: { readAt: NOW.toISOString(), publicRead: true },
    });

    fixture.stores.push(store);
    fixture.findings.push(findingOf(store, "email-address"));
    return store;
  }

  function publicReadScore(store: DataStore): number | undefined {
    return openedFor(store).find((issue: DataSecurityIssue) => {
      return issue.checkId === "public-read";
    })?.riskScore;
  }

  test("asks only for the project's data store risk that has not expired", async () => {
    publicBucket();

    await evaluate();

    const findBy: FindByArgument = risksSpy.mock.calls[0]![0] as FindByArgument;

    expect(findBy.query["projectId"]).toEqual(PROJECT_ID);
    expect(findBy.query["entityType"]).toBe(SecurityEntityType.DataStore);
    expect(
      (findBy.query["riskExpiresAt"] as unknown as RawOperator).getSql(
        "expires",
      ),
    ).toMatch(/^\(expires > :[A-Za-z0-9]+\)$/);
    expect(boundValue(findBy.query["riskExpiresAt"])).toEqual(NOW);
    expect(findBy.select).toEqual({ entityKey: true, contributions: true });
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("risk another source added raises the store's issues by the activity points", async () => {
    const store: DataStore = publicBucket();
    fixture.risks = [
      riskOf({
        store,
        sources: [
          { source: SecurityDetectionSource.DetectionRule, points: 30 },
        ],
      }),
    ];

    await evaluate();

    expect(publicReadScore(store)).toBe(90);
    expect(
      openedFor(store)[0]!.riskFactors as unknown as Array<{ label: string }>,
    ).toContainEqual({
      label: "Security Operations saw activity on it this week",
      points: 5,
    });
  });

  test("the store is found by its entity key, which is lower-cased", async () => {
    const store: DataStore = publicBucket(
      "Customer-Exports",
      "cloud:aws:AWS S3 Bucket:arn:aws:s3:::Customer-Exports",
    );
    fixture.risks = [
      riskOf({
        store,
        sources: [{ source: SecurityDetectionSource.ThreatIntel, points: 10 }],
        entityKey:
          "data-store:cloud:aws:aws s3 bucket:arn:aws:s3:::customer-exports",
      }),
    ];

    await evaluate();

    expect(publicReadScore(store)).toBe(90);
  });

  test("risk Data Security's own cases added is left out, so an issue never raises its own score", async () => {
    const store: DataStore = publicBucket();
    fixture.risks = [
      riskOf({
        store,
        sources: [{ source: SecurityDetectionSource.DataSecurity, points: 40 }],
      }),
    ];

    await evaluate();

    expect(publicReadScore(store)).toBe(85);
  });

  test("expired risk is not read, and risk worth no points counts for nothing", async () => {
    const expired: DataStore = publicBucket();
    const pointless: DataStore = publicBucket("partner-exports");
    fixture.risks = [
      riskOf({
        store: expired,
        sources: [
          { source: SecurityDetectionSource.DetectionRule, points: 30 },
        ],
        expiresInDays: -1,
      }),
      riskOf({
        store: pointless,
        sources: [
          { source: SecurityDetectionSource.ConnectedProduct, points: 0 },
        ],
      }),
    ];

    await evaluate();

    expect(publicReadScore(expired)).toBe(85);
    expect(publicReadScore(pointless)).toBe(85);
  });

  test("risk of another entity, or with no contributions to read, raises nothing", async () => {
    const store: DataStore = publicBucket();
    const malformed: SecurityEntityRisk = riskOf({
      store,
      sources: [{ source: SecurityDetectionSource.DetectionRule, points: 30 }],
    });
    malformed.contributions = { points: 30 } as unknown as JSONArray;

    fixture.risks = [
      malformed,
      riskOf({
        store,
        sources: [
          { source: SecurityDetectionSource.DetectionRule, points: 30 },
        ],
        entityKey: "data-store:cloud:aws:aws s3 bucket:arn:aws:s3:::other",
      }),
    ];

    await evaluate();

    expect(publicReadScore(store)).toBe(85);
  });

  test("with no store keys to look for, entity risk is not read at all", async () => {
    const store: DataStore = publicBucket("customer-exports", "");

    await evaluate();

    expect(risksSpy).not.toHaveBeenCalled();
    expect(publicReadScore(store)).toBe(85);
  });
});

describe("DataSecurityEvaluator.evaluateProject: what happens after", () => {
  test("flows and copies are worked out first, from the project's stores", async () => {
    const store: DataStore = storeOf({ name: "customer-exports" });
    fixture.stores = [store];
    fixture.findings = [findingOf(store, "email-address")];

    await evaluate();

    expect(flowsSpy).toHaveBeenCalledTimes(1);
    expect(flowsSpy.mock.calls[0]![0]).toBe(PROJECT_ID);
    expect(flowsSpy.mock.calls[0]![1]).toEqual([store]);
    expect(flowsSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      findingsSpy.mock.invocationCallOrder[0]!,
    );
  });

  test("flows that cannot be worked out are logged, and the stores are evaluated anyway", async () => {
    const store: DataStore = storeOf({ name: "customer-exports" });
    fixture.stores = [store];
    flowsSpy.mockRejectedValue(new Error("ClickHouse went away"));

    await evaluate();

    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not work out flows of project ${PROJECT_ID.toString()}:`,
    );
    expect(summaries.has(store.id!.toString())).toBe(true);
  });

  test("what opened goes to the integrations once, with each store's name, key, kind and sensitivity", async () => {
    const bucket: DataStore = storeOf({
      name: "customer-exports",
      posture: { readAt: NOW.toISOString(), publicRead: true },
    });
    const database: DataStore = storeOf({
      name: "billing-db",
      kind: DataStoreKind.PostgreSql,
      storeKey: "database:billing",
      sensitivityOverride: DataSensitivity.Restricted,
    });
    fixture.stores = [bucket, database];
    fixture.findings = [
      findingOf(bucket, "email-address"),
      findingOf(database, "email-address"),
    ];
    fixture.ownerUsers = [ownerUserOf(bucket)];

    await evaluate();

    expect(integrationsSpy).toHaveBeenCalledTimes(1);

    const call: {
      projectId: ObjectID;
      setting: DataSecuritySetting;
      issues: Array<OpenedIssueForIntegrations>;
    } = integrationsSpy.mock.calls[0]![0];

    expect(call.projectId).toBe(PROJECT_ID);
    expect(call.setting).toBe(fixture.setting);
    expect(
      call.issues
        .map((issue: OpenedIssueForIntegrations): string => {
          return `${issue.dataStoreName}|${issue.checkId}`;
        })
        .sort(),
    ).toEqual(["billing-db|no-owner", "customer-exports|public-read"]);

    const publicRead: OpenedIssueForIntegrations = call.issues.find(
      (issue: OpenedIssueForIntegrations) => {
        return issue.checkId === "public-read";
      },
    )!;
    const created: DataSecurityIssue = openedFor(bucket)[0]!;

    expect(publicRead).toEqual({
      issueId: created.id,
      checkId: "public-read",
      title: "Anyone on the internet can read it",
      severity: SecuritySeverity.Critical,
      riskScore: 85,
      dataStoreId: bucket.id,
      dataStoreName: "customer-exports",
      dataStoreKey: bucket.storeKey,
      dataStoreKind: DataStoreKind.AwsS3Bucket,
      sensitivity: DataSensitivity.Confidential,
    });

    const noOwner: OpenedIssueForIntegrations = call.issues.find(
      (issue: OpenedIssueForIntegrations) => {
        return issue.checkId === "no-owner";
      },
    )!;

    expect(noOwner).toMatchObject({
      dataStoreName: "billing-db",
      dataStoreKey: "database:billing",
      dataStoreKind: DataStoreKind.PostgreSql,
      sensitivity: DataSensitivity.Restricted,
      severity: SecuritySeverity.Medium,
    });
  });

  test("nothing opened, nothing handed on", async () => {
    const store: DataStore = storeOf({ name: "billing-db" });
    fixture.stores = [store];
    fixture.findings = [findingOf(store, "email-address")];
    fixture.ownerUsers = [ownerUserOf(store)];

    await evaluate();

    expect(createdIssues).toEqual([]);
    expect(integrationsSpy).not.toHaveBeenCalled();
  });

  test("a store that cannot be evaluated is logged, and the others are still evaluated and handed on", async () => {
    const broken: DataStore = storeOf({ name: "broken-bucket" });
    const healthy: DataStore = storeOf({ name: "healthy-bucket" });
    fixture.stores = [broken, healthy];
    fixture.findings = [
      findingOf(broken, "email-address"),
      findingOf(healthy, "email-address"),
    ];

    const reconcile: (
      input: ReconcileStoreInput,
    ) => Promise<ReconcileStoreOutput> =
      DataSecurityIssueReconciler.reconcileStore.bind(
        DataSecurityIssueReconciler,
      );

    jest
      .spyOn(DataSecurityIssueReconciler, "reconcileStore")
      .mockImplementation(
        async (input: ReconcileStoreInput): Promise<ReconcileStoreOutput> => {
          if (input.dataStoreId.toString() === broken.id!.toString()) {
            throw new Error("deadlock detected");
          }

          return reconcile(input);
        },
      );

    await evaluate();

    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not evaluate store ${broken.id!.toString()}:`,
    );
    expect(summaries.has(broken.id!.toString())).toBe(false);
    expect(summaries.has(healthy.id!.toString())).toBe(true);
    expect(integrationsSpy).toHaveBeenCalledTimes(1);
    expect(
      (
        integrationsSpy.mock.calls[0]![0] as {
          issues: Array<OpenedIssueForIntegrations>;
        }
      ).issues.map((issue: OpenedIssueForIntegrations): string => {
        return issue.dataStoreName;
      }),
    ).toEqual(["healthy-bucket"]);
  });
});
