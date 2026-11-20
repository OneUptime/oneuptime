import AutoRemediationRule from "../../../../../Models/DatabaseModels/AutoRemediationRule";
import DataSecurityAiDecision from "../../../../../Models/DatabaseModels/DataSecurityAiDecision";
import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import Project from "../../../../../Models/DatabaseModels/Project";
import AutoRemediationRuleService from "../../../../../Server/Services/AutoRemediationRuleService";
import DataSecurityAiDecisionService from "../../../../../Server/Services/DataSecurityAiDecisionService";
import DataSecurityAiProposalService from "../../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityCustomDataTypeService from "../../../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataStoreFeedService from "../../../../../Server/Services/DataStoreFeedService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import { DataSecurityAiAction } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiAction";
import DataSecurityAiActions from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiActions";
import DataSecurityAiEngine, {
  DataSecurityAiEvaluation,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiEngine";
import DataSecurityIssueAnalysis from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueAnalysis";
import logger from "../../../../../Server/Utils/Logger";
import AutoRemediationTriggerEntity from "../../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import {
  DATA_SECURITY_AI_CHANGES_WITHOUT_ASKING_PER_HOUR,
  DATA_SECURITY_AI_ISSUES_PER_PROJECT_PER_DAY,
  DATA_SECURITY_AI_ISSUES_PER_STORE_PER_DAY,
  DataSecurityAiAskReason,
  DataSecurityAiAutonomy,
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  DataSecurityAiWork,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import {
  DataSecurityAiDecisionHelper,
  DataSecurityAiDecisionReason,
  DataSecurityAiIssueSkipReason,
} from "../../../../../Types/DataSecurity/DataSecurityAiDecision";
import DataSecurityIssueStatus from "../../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE WORK ONEUPTIME AI DOES ON A DATA SECURITY ISSUE WHEN IT OPENS
 * (#10364), from the switches and the rules to what is proposed, what is
 * made without asking, and the record of why it did or did not act.
 * Every service the engine reads and writes is stood in for; the decisions
 * themselves are the engine's own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10364000-0000-4000-8000-000000000001",
);
const ISSUE_ID: ObjectID = new ObjectID("10364000-0000-4000-8000-0000000000a1");
const STORE_ID: ObjectID = new ObjectID("10364000-0000-4000-8000-0000000000b1");
const RULE_ID: string = "10364000-0000-4000-8000-0000000000c1";
const PROVIDER_ID: string = "10364000-0000-4000-8000-0000000000d1";

interface World {
  project: Partial<Project> | null;
  issue: Partial<DataSecurityIssue> | null;
  store: Partial<DataStore> | null;
  rules: Array<Partial<AutoRemediationRule>> | null;
  decisionsActedToday: { store: number; project: number };
  analyzedThisOpening: number;
  changesWithoutAskingThisHour: number;
  earlierProposals: Array<Partial<DataSecurityAiProposal>>;
}

let world: World;
let decisions: Array<DataSecurityAiDecision>;
let proposals: Array<DataSecurityAiProposal>;
let transitions: Array<{ fromStatuses: unknown; set: { status: string } }>;
let analyze: jest.SpiedFunction<typeof DataSecurityIssueAnalysis.analyze>;
let action: DataSecurityAiAction;
let issueFeed: jest.SpiedFunction<
  typeof DataSecurityIssueFeedService.createDataSecurityIssueFeedItem
>;

function telemetryIssue(
  overrides: Partial<DataSecurityIssue> = {},
): Partial<DataSecurityIssue> {
  return {
    id: ISSUE_ID,
    projectId: PROJECT_ID,
    checkId: "secrets-in-telemetry",
    checkGroup: "Telemetry",
    title: "Secrets in telemetry",
    severity: SecuritySeverity.Critical,
    riskScore: 92,
    status: DataSecurityIssueStatus.Open,
    dataTypeIds: ["aws-access-key"],
    dataStoreId: STORE_ID,
    reopenCount: 0,
    ...overrides,
  };
}

function logsStore(overrides: Partial<DataStore> = {}): Partial<DataStore> {
  return {
    id: STORE_ID,
    name: "checkout logs",
    kind: DataStoreKind.TelemetryLogs,
    provider: "oneuptime",
    environment: "Production" as never,
    sensitivity: "Restricted" as never,
    isArchived: false,
    labels: [],
    ...overrides,
  };
}

function dataSecurityRule(
  overrides: Partial<AutoRemediationRule> = {},
): Partial<AutoRemediationRule> {
  return {
    id: new ObjectID(RULE_ID),
    name: "Telemetry secrets",
    triggerEntityType: AutoRemediationTriggerEntity.DataSecurityIssue,
    dataSecurityAnalyze: DataSecurityAiAutonomy.WithoutAsking,
    dataSecurityContain: DataSecurityAiAutonomy.WithoutAsking,
    dataSecurityFix: DataSecurityAiAutonomy.Suggest,
    dataSecurityJudge: DataSecurityAiAutonomy.Off,
    ...overrides,
  };
}

// A contain action that plans one mask-only change, and makes it when asked.
function fakeAction(
  overrides: Partial<DataSecurityAiAction> = {},
): DataSecurityAiAction {
  return {
    kind: DataSecurityAiProposalKind.ScrubTelemetry,
    appliesToCheck: (checkId: string | undefined): boolean => {
      return checkId === "secrets-in-telemetry";
    },
    plan: jest.fn(async () => {
      return {
        kind: "planned" as const,
        changes: [
          {
            title: "Scrub AWS Access Key in attributes.aws.key of checkout logs",
            changeMarkdown: "One scrub rule.",
            reasonMarkdown: "Found unscrubbed.",
            proofMarkdown: "The check decides.",
            undoMarkdown: "Undo deletes it.",
            plan: { kind: "Logs", places: [] },
            planKey: "scrub:aaaaaaaaaaaaaaaa",
            meetsDefaultConditions: false,
          },
        ],
      };
    }),
    getApproveRefusal: (): string | null => {
      return null;
    },
    getUndoRefusal: (): string | null => {
      return null;
    },
    apply: jest.fn(async () => {
      return { result: { rules: [] }, summaryMarkdown: "Made." };
    }),
    undo: jest.fn(async () => {
      return { summaryMarkdown: "Undone." };
    }),
    ...overrides,
  } as DataSecurityAiAction;
}

async function evaluate(): Promise<DataSecurityAiEvaluation | null> {
  return await DataSecurityAiEngine.evaluateIssue({
    projectId: PROJECT_ID,
    dataSecurityIssueId: ISSUE_ID,
    now: new Date("2026-11-20T10:00:00Z"),
  });
}

function lastDecision(): DataSecurityAiDecision {
  return decisions[decisions.length - 1]!;
}

function entryOf(
  evaluation: DataSecurityAiEvaluation | null,
  work: DataSecurityAiWork,
): { reason: DataSecurityAiDecisionReason; askReason?: unknown } {
  return evaluation!.entries.find((entry: { work: DataSecurityAiWork }) => {
    return entry.work === work;
  })!;
}

beforeEach(() => {
  world = {
    project: {
      id: PROJECT_ID,
      enableAi: true,
      enableAutomaticDataSecurityAi: true,
      requireTwoApprovalsForRiskierFixes: false,
    },
    issue: telemetryIssue(),
    store: logsStore(),
    rules: [],
    decisionsActedToday: { store: 0, project: 0 },
    analyzedThisOpening: 0,
    changesWithoutAskingThisHour: 0,
    earlierProposals: [],
  };
  decisions = [];
  proposals = [];
  transitions = [];
  action = fakeAction();

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return world.project as Project | null;
  }) as never);
  jest
    .spyOn(DataSecurityIssueService, "findOneBy")
    .mockImplementation((async () => {
      return world.issue as DataSecurityIssue | null;
    }) as never);
  jest.spyOn(DataStoreService, "findOneById").mockImplementation((async () => {
    return world.store as DataStore | null;
  }) as never);
  jest
    .spyOn(DataSecurityCustomDataTypeService, "findBy")
    .mockResolvedValue([] as never);
  jest.spyOn(ServiceService, "findOneBy").mockResolvedValue(null as never);
  jest
    .spyOn(AutoRemediationRuleService, "findBy")
    .mockImplementation((async () => {
      if (world.rules === null) {
        throw new Error("the rules could not be read");
      }

      return world.rules as Array<AutoRemediationRule>;
    }) as never);

  jest
    .spyOn(DataSecurityAiDecisionService, "countBy")
    .mockImplementation((async (countBy: {
      query: Record<string, unknown>;
    }) => {
      if (countBy.query["didAnalyze"] === true) {
        return new PositiveNumber(world.analyzedThisOpening);
      }

      return new PositiveNumber(
        countBy.query["dataStoreId"]
          ? world.decisionsActedToday.store
          : world.decisionsActedToday.project,
      );
    }) as never);
  jest
    .spyOn(DataSecurityAiDecisionService, "create")
    .mockImplementation((async (createBy: { data: DataSecurityAiDecision }) => {
      decisions.push(createBy.data);
      return createBy.data;
    }) as never);

  jest
    .spyOn(DataSecurityAiProposalService, "countBy")
    .mockImplementation((async () => {
      return new PositiveNumber(world.changesWithoutAskingThisHour);
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "findBy")
    .mockImplementation((async () => {
      return world.earlierProposals as Array<DataSecurityAiProposal>;
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "create")
    .mockImplementation((async (createBy: { data: DataSecurityAiProposal }) => {
      createBy.data.id = new ObjectID(
        `10364000-0000-4000-8000-0000000001${String(proposals.length).padStart(2, "0")}`,
      );
      proposals.push(createBy.data);
      return createBy.data;
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "attemptTransition")
    .mockImplementation((async (data: {
      fromStatuses: unknown;
      set: { status: string };
    }) => {
      transitions.push(data);
      return 1;
    }) as never);

  issueFeed = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
  jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined);

  analyze = jest
    .spyOn(DataSecurityIssueAnalysis, "analyze")
    .mockResolvedValue({ analyzed: true });
  jest
    .spyOn(DataSecurityAiActions, "forWork")
    .mockImplementation((work: DataSecurityAiWork) => {
      return work === DataSecurityAiWork.Contain ? [action] : [];
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("with AI off, Data Security works exactly as it did", () => {
  test.each([
    ["Enable AI is off", { enableAi: false }],
    ["Work on new Data Security issues is off", {
      enableAutomaticDataSecurityAi: false,
    }],
  ])(
    "%s: nothing is analyzed, proposed or written",
    async (_name: string, project: Partial<Project>) => {
      world.project = { ...world.project, ...project };

      expect(await evaluate()).toBeNull();
      expect(analyze).not.toHaveBeenCalled();
      expect(action.plan).not.toHaveBeenCalled();
      expect(decisions).toEqual([]);
      expect(proposals).toEqual([]);
      expect(issueFeed).not.toHaveBeenCalled();
    },
  );

  test("a project that is gone is not worked on", async () => {
    world.project = null;

    expect(await evaluate()).toBeNull();
    expect(decisions).toEqual([]);
  });
});

describe("an issue that no longer needs anything", () => {
  test.each([
    DataSecurityIssueStatus.Resolved,
    DataSecurityIssueStatus.Accepted,
    DataSecurityIssueStatus.NotAnIssue,
  ])(
    "%s before its turn came: nothing is done or written",
    async (status: DataSecurityIssueStatus) => {
      world.issue = telemetryIssue({ status });

      expect(await evaluate()).toBeNull();
      expect(decisions).toEqual([]);
      expect(analyze).not.toHaveBeenCalled();
    },
  );

  test("on a store that was archived: nothing is done", async () => {
    world.store = logsStore({ isArchived: true });

    expect(await evaluate()).toBeNull();
    expect(decisions).toEqual([]);
  });
});

describe("with no Data Security AI rule, the defaults", () => {
  test("analyze a Critical issue, and propose containing it - nothing changes without asking out of the box", async () => {
    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(entryOf(evaluation, DataSecurityAiWork.Analyze).reason).toBe(
      DataSecurityAiDecisionReason.Analyzed,
    );
    expect(entryOf(evaluation, DataSecurityAiWork.Contain)).toMatchObject({
      reason: DataSecurityAiDecisionReason.Proposed,
      askReason: DataSecurityAiAskReason.NotProvenSafe,
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      status: DataSecurityAiProposalStatus.Proposed,
      kind: DataSecurityAiProposalKind.ScrubTelemetry,
      work: DataSecurityAiWork.Contain,
      safety: DataSecurityAiChangeSafety.MaskOnly,
      autonomy: DataSecurityAiAutonomy.WithoutAsking,
      askReason: DataSecurityAiAskReason.NotProvenSafe,
      riskScore: 92,
    });
    expect(proposals[0]!.autoRemediationRuleId).toBeUndefined();
    expect(action.apply).not.toHaveBeenCalled();

    // Fix and judge have nothing they can do for this check yet.
    expect(entryOf(evaluation, DataSecurityAiWork.Fix).reason).toBe(
      DataSecurityAiDecisionReason.NoActionForIssue,
    );

    expect(lastDecision()).toMatchObject({
      didAct: true,
      didAnalyze: true,
      issueReopenCount: 0,
    });
    expect(lastDecision().skipReason).toBeUndefined();
  });

  test("leave a Medium issue that no action can help alone, and say why", async () => {
    world.issue = telemetryIssue({
      checkId: "no-backups",
      checkGroup: "Recovery",
      severity: SecuritySeverity.Medium,
    });

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(analyze).not.toHaveBeenCalled();
    expect(proposals).toEqual([]);
    expect(evaluation!.didAct).toBe(false);
    expect(evaluation!.skipReason).toBe(
      DataSecurityAiIssueSkipReason.NothingToDo,
    );
    expect(entryOf(evaluation, DataSecurityAiWork.Analyze).reason).toBe(
      DataSecurityAiDecisionReason.WorkOff,
    );
    expect(entryOf(evaluation, DataSecurityAiWork.Contain).reason).toBe(
      DataSecurityAiDecisionReason.NoActionForIssue,
    );
    expect(lastDecision()).toMatchObject({
      didAct: false,
      skipReason: DataSecurityAiIssueSkipReason.NothingToDo,
    });
    expect(
      DataSecurityAiDecisionHelper.parseEntries(lastDecision().entries).map(
        (entry: { work: DataSecurityAiWork }) => {
          return entry.work;
        },
      ),
    ).toEqual([
      DataSecurityAiWork.Analyze,
      DataSecurityAiWork.Contain,
      DataSecurityAiWork.Fix,
      DataSecurityAiWork.Judge,
    ]);
  });

  test("a contain action that proves it is safe runs without asking, out of the box", async () => {
    action = fakeAction({
      plan: jest.fn(async () => {
        return {
          kind: "planned" as const,
          changes: [
            {
              title: "Scrub a secret nothing reads",
              changeMarkdown: "",
              reasonMarkdown: "",
              proofMarkdown: "",
              undoMarkdown: "",
              plan: {},
              planKey: "scrub:bbbbbbbbbbbbbbbb",
              meetsDefaultConditions: true,
            },
          ],
        };
      }) as never,
    });

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(entryOf(evaluation, DataSecurityAiWork.Contain).reason).toBe(
      DataSecurityAiDecisionReason.AppliedWithoutAsking,
    );
    expect(action.apply).toHaveBeenCalledTimes(1);
    // Made as OneUptime, with no person behind it.
    expect(
      (action.apply as jest.Mock).mock.calls[0]![0] as {
        actor: { props: { isRoot?: boolean }; userId?: unknown };
      },
    ).toMatchObject({ actor: { props: { isRoot: true } } });
    expect(transitions.map((transition: { set: { status: string } }) => {
      return transition.set.status;
    })).toEqual([
      DataSecurityAiProposalStatus.Approved,
      DataSecurityAiProposalStatus.AppliedWithoutAsking,
    ]);
  });
});

describe("with Data Security AI rules", () => {
  test("an issue no rule matches is not worked on, and Why AI did not act says so", async () => {
    world.rules = [
      dataSecurityRule({ dataSecuritySeverities: [SecuritySeverity.Low] }),
    ];

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(analyze).not.toHaveBeenCalled();
    expect(action.plan).not.toHaveBeenCalled();
    expect(evaluation!.skipReason).toBe(
      DataSecurityAiIssueSkipReason.NoRuleMatched,
    );
    expect(lastDecision()).toMatchObject({
      didAct: false,
      skipReason: DataSecurityAiIssueSkipReason.NoRuleMatched,
    });
  });

  test("a rule that contains without asking has the change made, named on the proposal", async () => {
    world.rules = [dataSecurityRule()];

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(entryOf(evaluation, DataSecurityAiWork.Contain)).toMatchObject({
      reason: DataSecurityAiDecisionReason.AppliedWithoutAsking,
    });
    expect(action.apply).toHaveBeenCalledTimes(1);
    expect(proposals[0]!.autoRemediationRuleId?.toString()).toBe(RULE_ID);
    expect(proposals[0]!.autoRemediationRuleName).toBe("Telemetry secrets");
    expect(issueFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "AiChangeMade",
        feedInfoInMarkdown: expect.stringContaining(
          "OneUptime AI made this change without asking",
        ),
      }),
    );
  });

  test("a rule that suggests has the change proposed, waiting for a person", async () => {
    world.rules = [
      dataSecurityRule({ dataSecurityContain: DataSecurityAiAutonomy.Suggest }),
    ];

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(entryOf(evaluation, DataSecurityAiWork.Contain)).toMatchObject({
      reason: DataSecurityAiDecisionReason.Proposed,
    });
    expect(proposals[0]!.status).toBe(DataSecurityAiProposalStatus.Proposed);
    // Asked because the rule asks: nothing to explain.
    expect(proposals[0]!.askReason).toBeUndefined();
    expect(action.apply).not.toHaveBeenCalled();
    expect(issueFeed).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "AiProposed" }),
    );
  });

  test("a rule that turns containing off proposes nothing for it", async () => {
    world.rules = [
      dataSecurityRule({ dataSecurityContain: DataSecurityAiAutonomy.Off }),
    ];

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(action.plan).not.toHaveBeenCalled();
    expect(entryOf(evaluation, DataSecurityAiWork.Contain)).toMatchObject({
      reason: DataSecurityAiDecisionReason.WorkOff,
    });
  });

  test("a rule's LLM provider is the one the analysis uses", async () => {
    world.rules = [dataSecurityRule({ llmProviderId: new ObjectID(PROVIDER_ID) })];

    await evaluate();

    expect(analyze.mock.calls[0]![0].llmProviderId?.toString()).toBe(
      PROVIDER_ID,
    );
  });

  test("rules that cannot be read stop everything a rule may keep out", async () => {
    world.rules = null;

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(analyze).not.toHaveBeenCalled();
    expect(action.plan).not.toHaveBeenCalled();
    expect(evaluation!.skipReason).toBe(
      DataSecurityAiIssueSkipReason.RulesUnreadable,
    );
  });
});

describe("the limits", () => {
  test("the hourly circuit breaker proposes what a rule would have had made without asking", async () => {
    world.rules = [dataSecurityRule()];
    world.changesWithoutAskingThisHour =
      DATA_SECURITY_AI_CHANGES_WITHOUT_ASKING_PER_HOUR;

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(action.apply).not.toHaveBeenCalled();
    expect(entryOf(evaluation, DataSecurityAiWork.Contain)).toMatchObject({
      reason: DataSecurityAiDecisionReason.Proposed,
      askReason: DataSecurityAiAskReason.CircuitBreaker,
    });
    expect(proposals[0]!.askReason).toBe(DataSecurityAiAskReason.CircuitBreaker);
  });

  test("a store's daily limit stops the work on its issues, and says so", async () => {
    world.decisionsActedToday.store = DATA_SECURITY_AI_ISSUES_PER_STORE_PER_DAY;

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(analyze).not.toHaveBeenCalled();
    expect(action.plan).not.toHaveBeenCalled();
    expect(evaluation!.skipReason).toBe(
      DataSecurityAiIssueSkipReason.StoreDailyLimitReached,
    );
  });

  test("the project's daily limit does the same for every store", async () => {
    world.decisionsActedToday.project =
      DATA_SECURITY_AI_ISSUES_PER_PROJECT_PER_DAY;

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(analyze).not.toHaveBeenCalled();
    expect(evaluation!.skipReason).toBe(
      DataSecurityAiIssueSkipReason.ProjectDailyLimitReached,
    );
  });
});

describe("work done once", () => {
  test("an issue analyzed since it last opened is not analyzed again", async () => {
    world.analyzedThisOpening = 1;

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(analyze).not.toHaveBeenCalled();
    expect(entryOf(evaluation, DataSecurityAiWork.Analyze).reason).toBe(
      DataSecurityAiDecisionReason.AlreadyAnalyzed,
    );
  });

  test("the same change is not proposed for an issue twice", async () => {
    world.earlierProposals = [
      {
        id: new ObjectID("10364000-0000-4000-8000-0000000002a1"),
        status: DataSecurityAiProposalStatus.Dismissed,
        planKey: "scrub:aaaaaaaaaaaaaaaa",
      },
    ];

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(proposals).toEqual([]);
    expect(entryOf(evaluation, DataSecurityAiWork.Contain)).toMatchObject({
      reason: DataSecurityAiDecisionReason.AlreadyProposed,
    });
  });

  test("a change that expired may be proposed again", async () => {
    world.earlierProposals = [
      {
        id: new ObjectID("10364000-0000-4000-8000-0000000002a1"),
        status: DataSecurityAiProposalStatus.Expired,
        planKey: "scrub:aaaaaaaaaaaaaaaa",
      },
    ];

    await evaluate();

    expect(proposals).toHaveLength(1);
  });

  test("a newer plan of the same kind replaces the one still waiting", async () => {
    world.earlierProposals = [
      {
        id: new ObjectID("10364000-0000-4000-8000-0000000002a1"),
        status: DataSecurityAiProposalStatus.Proposed,
        planKey: "scrub:0000000000000000",
      },
    ];

    await evaluate();

    expect(proposals).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      fromStatuses: [DataSecurityAiProposalStatus.Proposed],
      set: { status: DataSecurityAiProposalStatus.Expired },
    });
  });
});

describe("what stopped the work, recorded", () => {
  test.each([
    DataSecurityAiDecisionReason.NoLlmProvider,
    DataSecurityAiDecisionReason.NoAiCredits,
    DataSecurityAiDecisionReason.AiDailyLimitReached,
    DataSecurityAiDecisionReason.AnalysisFailed,
  ])(
    "an analysis stopped by %s says so, and the rest goes on",
    async (reason: DataSecurityAiDecisionReason) => {
      analyze.mockResolvedValue({ analyzed: false, reason });

      const evaluation: DataSecurityAiEvaluation | null = await evaluate();

      expect(entryOf(evaluation, DataSecurityAiWork.Analyze).reason).toBe(
        reason,
      );
      expect(lastDecision().didAnalyze).toBe(false);
      // The proposal is still made.
      expect(proposals).toHaveLength(1);
    },
  );

  test("an action that cannot plan is noted, and nothing is proposed for it", async () => {
    action = fakeAction({
      plan: jest.fn(async () => {
        throw new Error("coverage could not be read");
      }) as never,
    });

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(proposals).toEqual([]);
    expect(entryOf(evaluation, DataSecurityAiWork.Contain)).toMatchObject({
      reason: DataSecurityAiDecisionReason.NothingToPropose,
    });
    expect(
      (entryOf(evaluation, DataSecurityAiWork.Contain) as { detail?: string })
        .detail,
    ).toBe("could-not-plan");
  });

  test("a change that fails without asking is recorded as failed, and nothing changed", async () => {
    world.rules = [dataSecurityRule()];
    action = fakeAction({
      apply: jest.fn(async () => {
        throw new Error("The scrub rule could not be saved.");
      }) as never,
    });

    const evaluation: DataSecurityAiEvaluation | null = await evaluate();

    expect(entryOf(evaluation, DataSecurityAiWork.Contain)).toMatchObject({
      reason: DataSecurityAiDecisionReason.ApplyFailed,
    });
    expect(transitions.map((transition: { set: { status: string } }) => {
      return transition.set.status;
    })).toEqual([
      DataSecurityAiProposalStatus.Approved,
      DataSecurityAiProposalStatus.Failed,
    ]);
    expect(issueFeed).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "AiChangeFailed" }),
    );
  });

  test("an evaluation that stops on an error is recorded as failed, and never throws", async () => {
    jest
      .spyOn(DataSecurityCustomDataTypeService, "findBy")
      .mockRejectedValue(new Error("the database went away"));

    expect(await evaluate()).toBeNull();
    expect(lastDecision()).toMatchObject({
      didAct: false,
      skipReason: DataSecurityAiIssueSkipReason.EvaluationFailed,
    });
  });
});
