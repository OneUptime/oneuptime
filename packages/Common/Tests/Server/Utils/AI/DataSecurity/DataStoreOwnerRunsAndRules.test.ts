import Queue from "../../../../../Server/Infrastructure/Queue";
import AIService, {
  ProjectAiDailyLimitStatus,
} from "../../../../../Server/Services/AIService";
import AutoRemediationRuleService from "../../../../../Server/Services/AutoRemediationRuleService";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import DataSecurityAiDecisionService from "../../../../../Server/Services/DataSecurityAiDecisionService";
import DataSecurityAiProposalService from "../../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityCustomDataTypeService from "../../../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataStoreAccessService from "../../../../../Server/Services/DataStoreAccessService";
import DataStoreFeedService from "../../../../../Server/Services/DataStoreFeedService";
import DataStoreOwnerRuleService from "../../../../../Server/Services/DataStoreOwnerRuleService";
import DataStoreOwnerTeamService from "../../../../../Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../../../Server/Services/DataStoreOwnerUserService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import LlmLogService from "../../../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ServiceOwnerTeamService from "../../../../../Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../../../Server/Services/ServiceOwnerUserService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../../../Server/Services/TeamPermissionService";
import TeamService from "../../../../../Server/Services/TeamService";
import { Results } from "../../../../../Server/Services/AnalyticsDatabaseService";
import DataStoreOwnerProposalRun, {
  DataStoreOwnerRunOutcome,
} from "../../../../../Server/Utils/AI/DataSecurity/DataStoreOwnerProposalRun";
import DataStoreOwnerRuleProposals from "../../../../../Server/Utils/AI/DataSecurity/DataStoreOwnerRuleProposals";
import DeclaredCodeOwner from "../../../../../Server/Utils/AI/Remediation/DeclaredCodeOwner";
import AIInvestigationEngine from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import {
  DATA_SECURITY_AI_EVALUATE_ISSUE_JOB,
  DATA_SECURITY_PROPOSE_OWNER_RULES_JOB,
  OWNER_RULES_DELAY_IN_MS,
} from "../../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import LLMService from "../../../../../Server/Utils/LLM/LLMService";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LlmProvider from "../../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../../Models/DatabaseModels/Project";
import AutoRemediationTriggerEntity from "../../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import {
  DataSecurityAiAutonomy,
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  DataSecurityAiWork,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import {
  DataStoreOwnerConfidence,
  DataStoreOwnerEvidenceSource,
  DataStoreOwnerKind,
  DataStoreOwnerRulePlan,
  DataStoreOwnersPlan,
  readDataStoreOwnerRulePlan,
} from "../../../../../Types/DataSecurity/DataStoreOwnerProposal";
import { JSONObject } from "../../../../../Types/JSON";
import LlmType from "../../../../../Types/LLM/LlmType";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../../TestingUtils/InMemoryRepository";
import { everyServerProductIsOn } from "../../../TestingUtils/ServerProductsOn";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE OWNERS OF STORES THAT HAVE NO ISSUE, AND THE RULES THAT KEEP THEM
 * (#10374), THROUGH THE REAL RUNS.
 *
 *   - The daily run hands every open "Nobody owns this sensitive store"
 *     issue to the engine, and has OneUptime AI propose owners for the
 *     stores found in the last day that are not sensitive - each through
 *     the real planner, input builder, one call and proposals - skipping a
 *     store that has owners, or a proposal already. A connection read for
 *     the first time has its stores proposed for, whatever their age.
 *   - Then the rule run: three or more stores whose proposed owners rest on
 *     the same tag get one owner rule proposed, with what the rule engine
 *     says it would do, once, and not where the project has that rule.
 *   - With AI off, or an AI rule that turns Judge off, nothing is asked and
 *     nothing is written.
 *
 * Every table is held in memory; only the model is a fake.
 */

const NOW: Date = new Date("2026-11-21T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "10374000-0000-4000-8000-000000000001",
);
const CONNECTION_ID: string = "10374000-0000-4000-8000-0000000000f9";
const PAYMENTS_TEAM_ID: string = "10374000-0000-4000-8000-0000000000c1";
const PLATFORM_TEAM_ID: string = "10374000-0000-4000-8000-0000000000c2";
const ISSUE_ID: string = "10374000-0000-4000-8000-0000000000a1";

function storeId(index: number): string {
  return `10374000-0000-4000-8000-000000000${String(100 + index)}`;
}

const asService: <T extends BaseModel>(
  service: unknown,
) => DatabaseService<T> = <T extends BaseModel>(
  service: unknown,
): DatabaseService<T> => {
  return service as DatabaseService<T>;
};

let completion: SpyInstance<typeof LLMService.getCompletion>;
let proposals: InMemoryTable;
let modelAnswers: Array<string>;
let project: Record<string, unknown>;

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function store(index: number, overrides: StoredRow = {}): StoredRow {
  return {
    _id: storeId(index),
    projectId: PROJECT_ID.toString(),
    name: `payments-bucket-${index}`,
    kind: "AWS S3 Bucket",
    provider: "aws",
    region: "eu-north-1",
    environment: "Production",
    sensitivity: "Internal",
    providerResourceId: `arn:aws:s3:::payments-bucket-${index}`,
    dataTypeIds: [],
    cloudTags: { team: "payments" },
    isArchived: false,
    labels: [],
    firstSeenAt: hoursAgo(2),
    ...overrides,
  };
}

function useWorld(data: {
  stores: Array<StoredRow>;
  issues?: Array<StoredRow>;
  ownerTeams?: Array<StoredRow>;
  proposals?: Array<StoredRow>;
  ownerRules?: Array<StoredRow>;
  aiRules?: Array<StoredRow>;
}): void {
  useInMemoryTable(asService(DataStoreService), data.stores);
  useInMemoryTable(asService(DataSecurityIssueService), data.issues || []);
  useInMemoryTable(asService(DataSecurityCustomDataTypeService), []);
  useInMemoryTable(asService(AutoRemediationRuleService), data.aiRules || []);
  useInMemoryTable(asService(DataStoreOwnerUserService), []);
  useInMemoryTable(asService(DataStoreOwnerTeamService), data.ownerTeams || []);
  useInMemoryTable(asService(DataStoreOwnerRuleService), data.ownerRules || []);
  useInMemoryTable(asService(DataStoreAccessService), []);
  useInMemoryTable(asService(ServiceService), []);
  useInMemoryTable(asService(ServiceOwnerUserService), []);
  useInMemoryTable(asService(ServiceOwnerTeamService), []);
  useInMemoryTable(asService(TeamService), [
    {
      _id: PAYMENTS_TEAM_ID,
      projectId: PROJECT_ID.toString(),
      name: "Payments",
    },
    {
      _id: PLATFORM_TEAM_ID,
      projectId: PROJECT_ID.toString(),
      name: "Platform",
    },
  ]);
  useInMemoryTable(asService(TeamMemberService), []);
  useInMemoryTable(asService(TeamPermissionService), [
    {
      _id: "10374000-0000-4000-8000-0000000000d8",
      projectId: PROJECT_ID.toString(),
      teamId: PAYMENTS_TEAM_ID,
      permission: Permission.SecurityMember,
      isBlockPermission: false,
      labels: [],
    },
  ]);
  proposals = useInMemoryTable(
    asService(DataSecurityAiProposalService),
    data.proposals || [],
  );
  useInMemoryTable(asService(DataSecurityAiDecisionService), []);
  useInMemoryTable(asService(LlmLogService), []);
}

// The model names Payments, from the tag, for every store it is asked about.
function answerPaymentsFor(count: number): void {
  for (let i: number = 0; i < count; i++) {
    modelAnswers.push(
      JSON.stringify({
        owners: ["T1"],
        restsOn: ["E1"],
        confidence: "high",
        reason: "The team tag names {T1}.",
        disagreement: "",
      }),
    );
  }
}

function queued(jobName: string): Array<Array<unknown>> {
  return (Queue.addJob as unknown as jest.Mock).mock.calls.filter(
    (call: Array<unknown>): boolean => {
      return call[2] === jobName;
    },
  );
}

function storeProposals(): Array<StoredRow> {
  return proposals.rows.filter((row: StoredRow): boolean => {
    return row["kind"] === DataSecurityAiProposalKind.SetStoreOwners;
  });
}

function ruleProposals(): Array<StoredRow> {
  return proposals.rows.filter((row: StoredRow): boolean => {
    return row["kind"] === DataSecurityAiProposalKind.CreateOwnerRule;
  });
}

async function runOwners(
  cloudConnectionId?: string,
): Promise<DataStoreOwnerRunOutcome> {
  return await DataStoreOwnerProposalRun.run({
    projectId: PROJECT_ID,
    cloudConnectionId: cloudConnectionId
      ? new ObjectID(cloudConnectionId)
      : undefined,
    now: NOW,
  });
}

// A store's proposal as the rule run reads it: Payments, resting on the tag.
function paymentsProposal(index: number, overrides: StoredRow = {}): StoredRow {
  const payments: DataStoreOwnersPlan["owners"][number] = {
    kind: DataStoreOwnerKind.Team,
    id: PAYMENTS_TEAM_ID,
    ref: "T1",
    name: "Payments",
    evidenceIds: ["E1"],
    canOpenStore: true,
  };
  const plan: DataStoreOwnersPlan = {
    dataStoreId: storeId(index),
    dataStoreName: `payments-bucket-${index}`,
    owners: [payments],
    confidence: DataStoreOwnerConfidence.High,
    reason: "The team tag names Payments.",
    disagreement: "",
    restsOn: ["E1"],
    evidence: [
      {
        id: "E1",
        source: DataStoreOwnerEvidenceSource.CloudTag,
        tagKey: "team",
        tagValue: "payments",
        owners: [{ kind: DataStoreOwnerKind.Team, id: PAYMENTS_TEAM_ID }],
      },
    ],
    candidates: [payments],
    ruleFacts: [{ kind: "CloudTag", key: "team", value: "payments" }],
    isSensitive: false,
  };

  return {
    _id: `10374000-0000-4000-8000-0000000002${String(10 + index)}`,
    version: 1,
    projectId: PROJECT_ID.toString(),
    dataStoreId: storeId(index),
    kind: DataSecurityAiProposalKind.SetStoreOwners,
    work: DataSecurityAiWork.Judge,
    safety: DataSecurityAiChangeSafety.ChangesWhoIsTold,
    status: DataSecurityAiProposalStatus.Proposed,
    title: `Make Payments the owner of payments-bucket-${index}`,
    plan: plan as unknown as JSONObject,
    ...overrides,
  };
}

beforeEach(() => {
  everyServerProductIsOn();
  modelAnswers = [];
  project = {
    id: PROJECT_ID,
    enableAi: true,
    enableAutomaticDataSecurityAi: true,
    requireTwoApprovalsForRiskierFixes: false,
  };

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return project as unknown as Project;
  }) as never);
  jest
    .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
    .mockResolvedValue(null);
  jest
    .spyOn(AIService, "getReachedProjectDailyLimit")
    .mockImplementation(async (): Promise<ProjectAiDailyLimitStatus | null> => {
      return null;
    });
  jest.spyOn(LlmProviderService, "getProviderForChat").mockResolvedValue({
    id: ObjectID.generate(),
    name: "The project's provider",
    llmType: LlmType.Ollama,
    baseUrl: "http://ollama.internal:11434",
    modelName: "llama3.1",
    isGlobalLlm: false,
  } as unknown as LlmProvider);
  completion = jest
    .spyOn(LLMService, "getCompletion")
    .mockImplementation(async () => {
      return {
        content: modelAnswers.shift() || "{}",
        usage: { promptTokens: 300, completionTokens: 40, totalTokens: 340 },
      };
    });
  jest.spyOn(DeclaredCodeOwner, "findCandidates").mockResolvedValue([]);
  jest.spyOn(ChangeEventService, "executeQuery").mockResolvedValue({
    json: async () => {
      return { data: [] };
    },
  } as unknown as Results);
  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
  jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined);
  jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the daily owners run", () => {
  test("hands a sensitive store's issue to the engine, and proposes owners for the new stores that are not sensitive", async () => {
    useWorld({
      stores: [
        store(1, { name: "card-ledger", sensitivity: "Restricted" }),
        store(2),
        store(3),
        // Owned already: nothing to propose.
        store(4),
        // Found a week ago: not new.
        store(5, { firstSeenAt: hoursAgo(24 * 7) }),
      ],
      issues: [
        {
          _id: ISSUE_ID,
          projectId: PROJECT_ID.toString(),
          checkId: "no-owner",
          status: "Open",
          riskScore: 40,
          dataStoreId: storeId(1),
        },
      ],
      ownerTeams: [
        {
          _id: "10374000-0000-4000-8000-0000000003a4",
          projectId: PROJECT_ID.toString(),
          dataStoreId: storeId(4),
          teamId: PLATFORM_TEAM_ID,
        },
      ],
    });
    answerPaymentsFor(2);

    const outcome: DataStoreOwnerRunOutcome = await runOwners();

    expect(outcome).toEqual({
      skipped: null,
      issuesQueued: 1,
      storesProposed: 2,
    });

    // The sensitive store goes through its issue, as the engine decides it.
    expect(queued(DATA_SECURITY_AI_EVALUATE_ISSUE_JOB)).toHaveLength(1);
    expect(queued(DATA_SECURITY_AI_EVALUATE_ISSUE_JOB)[0]![3]).toEqual({
      projectId: PROJECT_ID.toString(),
      dataSecurityIssueId: ISSUE_ID,
    });

    // The two new stores that are not sensitive, each asked about once.
    expect(completion).toHaveBeenCalledTimes(2);
    expect(
      storeProposals()
        .map((row: StoredRow): string => {
          return String(row["dataStoreId"]).toLowerCase();
        })
        .sort(),
    ).toEqual([storeId(2), storeId(3)]);

    for (const row of storeProposals()) {
      expect(row["status"]).toBe(DataSecurityAiProposalStatus.Proposed);
      expect(row["dataSecurityIssueId"] ?? null).toBeNull();
      // Listed after every sensitive store.
      expect(row["riskScore"]).toBe(0);
      expect(row["safety"]).toBe(DataSecurityAiChangeSafety.ChangesWhoIsTold);
    }

    /*
     * And the rules those proposals share, a few minutes on: each proposal
     * asks for the run, which the queue keeps once for the project.
     */
    const rules: Array<Array<unknown>> = queued(
      DATA_SECURITY_PROPOSE_OWNER_RULES_JOB,
    );

    expect(rules.length).toBeGreaterThan(0);

    for (const job of rules) {
      expect(job[3]).toEqual({ projectId: PROJECT_ID.toString() });
      expect(job[4]).toEqual(
        expect.objectContaining({
          delayInMs: OWNER_RULES_DELAY_IN_MS,
          deduplication: expect.objectContaining({
            id: `data-security-owner-rules-${PROJECT_ID.toString()}`,
          }),
        }),
      );
    }
  });

  /*
   * Security Events, Network Flows and the address vault are OneUptime's
   * own (#10398): no tag, code owner or service says who owns them, so the
   * model is never asked, and the team names their owners itself.
   */
  test("a store OneUptime declares is never asked about", async () => {
    useWorld({
      stores: [
        store(7, {
          name: "Security Events",
          kind: "Security Events",
          provider: "oneuptime",
          sensitivity: "Internal",
        }),
        store(8, {
          name: "Network Flows",
          kind: "Network Flows",
          provider: "oneuptime",
          sensitivity: "Internal",
        }),
        store(2),
      ],
    });
    answerPaymentsFor(1);

    const outcome: DataStoreOwnerRunOutcome = await runOwners();

    expect(outcome.storesProposed).toBe(1);
    expect(completion).toHaveBeenCalledTimes(1);
    expect(
      storeProposals().map((row: StoredRow): string => {
        return String(row["dataStoreId"]).toLowerCase();
      }),
    ).toEqual([storeId(2)]);
  });

  test("a store with an owner proposal already, or a sensitive store, is not asked about again", async () => {
    useWorld({
      stores: [store(2), store(3)],
      proposals: [paymentsProposal(2)],
    });
    answerPaymentsFor(1);

    const outcome: DataStoreOwnerRunOutcome = await runOwners();

    expect(outcome.storesProposed).toBe(1);
    expect(completion).toHaveBeenCalledTimes(1);
    expect(storeProposals()).toHaveLength(2);
  });

  test("a connection read for the first time has its stores proposed for, whatever their age", async () => {
    useWorld({
      stores: [
        store(5, {
          firstSeenAt: hoursAgo(24 * 30),
          cloudConnectionId: CONNECTION_ID,
        }),
        store(6, { firstSeenAt: hoursAgo(24 * 30) }),
      ],
    });
    answerPaymentsFor(1);

    const outcome: DataStoreOwnerRunOutcome = await runOwners(CONNECTION_ID);

    expect(outcome.storesProposed).toBe(1);
    expect(
      storeProposals().map((row: StoredRow): string => {
        return String(row["dataStoreId"]).toLowerCase();
      }),
    ).toEqual([storeId(5)]);
  });

  test("a store nothing points to: no model is asked, and nothing is proposed", async () => {
    useWorld({ stores: [store(2, { cloudTags: {} })] });

    const outcome: DataStoreOwnerRunOutcome = await runOwners();

    expect(outcome.storesProposed).toBe(0);
    expect(completion).not.toHaveBeenCalled();
    expect(proposals.rows).toEqual([]);
    expect(queued(DATA_SECURITY_PROPOSE_OWNER_RULES_JOB)).toEqual([]);
  });

  test.each([
    ["Enable AI off", { enableAi: false }],
    ["Work on new issues off", { enableAutomaticDataSecurityAi: false }],
  ])(
    "%s: nothing runs, nothing is asked, nothing is written",
    async (_name: string, off: Record<string, unknown>) => {
      project = { ...project, ...off };
      useWorld({
        stores: [store(2)],
        issues: [
          {
            _id: ISSUE_ID,
            projectId: PROJECT_ID.toString(),
            checkId: "no-owner",
            status: "Open",
            dataStoreId: storeId(1),
          },
        ],
      });
      answerPaymentsFor(1);

      expect(await runOwners()).toEqual({
        skipped: "ai-off",
        issuesQueued: 0,
        storesProposed: 0,
      });
      expect(completion).not.toHaveBeenCalled();
      expect(Queue.addJob).not.toHaveBeenCalled();
      expect(proposals.rows).toEqual([]);
    },
  );

  test("an AI rule that turns Judge off: no store's owners are proposed", async () => {
    useWorld({
      stores: [store(2)],
      aiRules: [
        {
          _id: "10374000-0000-4000-8000-0000000004a1",
          projectId: PROJECT_ID.toString(),
          name: "Never judge",
          isEnabled: true,
          triggerEntityType: AutoRemediationTriggerEntity.DataSecurityIssue,
          dataSecurityAnalyze: DataSecurityAiAutonomy.Off,
          dataSecurityContain: DataSecurityAiAutonomy.Off,
          dataSecurityFix: DataSecurityAiAutonomy.Off,
          dataSecurityJudge: DataSecurityAiAutonomy.Off,
        },
      ],
    });
    answerPaymentsFor(1);

    const outcome: DataStoreOwnerRunOutcome = await runOwners();

    expect(outcome.storesProposed).toBe(0);
    expect(completion).not.toHaveBeenCalled();
    expect(proposals.rows).toEqual([]);
  });
});

describe("the owner rules the proposals share", () => {
  function paymentsWorld(
    extra: {
      proposals?: Array<StoredRow>;
      ownerRules?: Array<StoredRow>;
    } = {},
  ): void {
    useWorld({
      stores: [
        store(1),
        store(2),
        store(3),
        store(4),
        store(5, { cloudTags: { team: "platform" } }),
      ],
      ownerTeams: [
        // Store 4 has an owner already: the rule would add Payments beside it.
        {
          _id: "10374000-0000-4000-8000-0000000003a4",
          projectId: PROJECT_ID.toString(),
          dataStoreId: storeId(4),
          teamId: PLATFORM_TEAM_ID,
        },
      ],
      proposals: extra.proposals || [
        paymentsProposal(1),
        paymentsProposal(2),
        paymentsProposal(3),
      ],
      ownerRules: extra.ownerRules || [],
    });
  }

  test("three stores whose owners rest on team=payments get one owner rule proposed, with what it would do", async () => {
    paymentsWorld();

    expect(
      await DataStoreOwnerRuleProposals.proposeForProject({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).toBe(1);

    const rows: Array<StoredRow> = ruleProposals();

    expect(rows).toHaveLength(1);
    expect(rows[0]!["title"]).toBe(
      "Make Payments the owner of every store tagged team=payments",
    );
    expect(rows[0]!["status"]).toBe(DataSecurityAiProposalStatus.Proposed);
    // For the project's stores, not one issue's or one store's.
    expect(rows[0]!["dataSecurityIssueId"] ?? null).toBeNull();
    expect(rows[0]!["dataStoreId"] ?? null).toBeNull();
    expect(rows[0]!["safety"]).toBe(
      DataSecurityAiChangeSafety.ChangesWhoIsTold,
    );

    const plan: DataStoreOwnerRulePlan | null = readDataStoreOwnerRulePlan(
      rows[0]!["plan"],
    );

    expect(plan).not.toBeNull();
    expect(plan!.cloudTagPattern).toBe("^team=payments$");
    expect(plan!.owners).toEqual([
      { kind: DataStoreOwnerKind.Team, id: PAYMENTS_TEAM_ID, name: "Payments" },
    ]);
    expect([...plan!.dataStoreIds].sort()).toEqual([
      storeId(1),
      storeId(2),
      storeId(3),
    ]);
    // The rule engine's own answer: four stores are tagged so, one owned.
    expect(plan!.preview.matchingStores).toBe(4);
    expect(plan!.preview.alreadyOwned).toBe(1);
    expect(String(rows[0]!["changeMarkdown"])).toContain(
      "This rule would set Payments as the owner of 4 stores, 1 of which already has owners.",
    );
  });

  test("proposed once: a second run adds nothing", async () => {
    paymentsWorld();

    await DataStoreOwnerRuleProposals.proposeForProject({
      projectId: PROJECT_ID,
      now: NOW,
    });
    await DataStoreOwnerRuleProposals.proposeForProject({
      projectId: PROJECT_ID,
      now: NOW,
    });

    expect(ruleProposals()).toHaveLength(1);
  });

  test("not where the project has that rule already", async () => {
    paymentsWorld({
      ownerRules: [
        {
          _id: "10374000-0000-4000-8000-0000000005a1",
          projectId: PROJECT_ID.toString(),
          name: "Payments' stores",
          cloudTagPattern: "^team=payments$",
          ownerTeams: [
            { _id: PAYMENTS_TEAM_ID, id: new ObjectID(PAYMENTS_TEAM_ID) },
          ],
          ownerUsers: [],
          isEnabled: true,
        },
      ],
    });

    expect(
      await DataStoreOwnerRuleProposals.proposeForProject({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).toBe(0);
    expect(ruleProposals()).toEqual([]);
  });

  test("two stores are not enough for a rule", async () => {
    paymentsWorld({ proposals: [paymentsProposal(1), paymentsProposal(2)] });

    expect(
      await DataStoreOwnerRuleProposals.proposeForProject({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).toBe(0);
  });

  test("a proposal someone dismissed is no reason for a rule", async () => {
    paymentsWorld({
      proposals: [
        paymentsProposal(1),
        paymentsProposal(2),
        paymentsProposal(3, {
          status: DataSecurityAiProposalStatus.Dismissed,
        }),
      ],
    });

    expect(
      await DataStoreOwnerRuleProposals.proposeForProject({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).toBe(0);
  });

  test("with AI off, nothing is proposed or written", async () => {
    project = { ...project, enableAi: false };
    paymentsWorld();

    expect(
      await DataStoreOwnerRuleProposals.proposeForProject({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).toBe(0);
    expect(ruleProposals()).toEqual([]);
  });
});
