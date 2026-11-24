import AutoRemediationRule from "../../../../../Models/DatabaseModels/AutoRemediationRule";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import Project from "../../../../../Models/DatabaseModels/Project";
import Service from "../../../../../Models/DatabaseModels/Service";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import OpenPullRequestCap from "../../../../../Server/Utils/AI/CodeFix/OpenPullRequestCap";
import {
  TELEMETRY_FIX_APPROVE_REFUSED_MESSAGE,
  TelemetryLeakFixAction,
  pickProposedPlan,
} from "../../../../../Server/Utils/AI/DataSecurity/Actions/TelemetryLeakFixAction";
import { DataSecurityAiPlannedChange } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiAction";
import DataSecurityAiEngine from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiEngine";
import DataSecurityAiProposals from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiProposals";
import TelemetryLeakFixProposals, {
  buildTelemetryFixPreview,
} from "../../../../../Server/Utils/AI/DataSecurity/TelemetryLeakFixProposals";
import { ResolvableRepository } from "../../../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import TelemetryLeakFix, {
  TelemetryLeakFixPlan,
} from "../../../../../Server/Utils/DataSecurity/TelemetryLeakFix";
import { TelemetryLeakToPlace } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryLeakRepositories";
import {
  DataSecurityAiAskReason,
  DataSecurityAiAutonomy,
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
  DataSecurityAiWithoutAskingVerdict,
  DataSecurityAiWorkDecision,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import { DataSecurityAiDecisionReason } from "../../../../../Types/DataSecurity/DataSecurityAiDecision";
import { DataSecurityTelemetryFixRepositoryChoice } from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  SECRETS_IN_TELEMETRY_CHECK_ID,
  SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
} from "../../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  TelemetryLeakPlace,
  TelemetryLeakSignal,
} from "../../../../../Types/DataSecurity/TelemetryLeakFix";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ONEUPTIME AI PROPOSES EACH SERVICE'S TELEMETRY FIX UNDER THE PROJECT'S AI
 * RULES (#10367, #10364).
 *
 * Out of the box the pull request is proposed and waits for a person; a
 * rule whose Fix is Without asking opens it on its own, in a repository
 * something decided; the repository's cap on open AI pull requests holds
 * it, the riskiest service first, counting what this run opened; a rule
 * that turns Fix off, rules that cannot be read, or AI off propose
 * nothing; and a fix already on its way is not proposed again.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10367000-0000-4000-8000-000000000001",
);
const REPOSITORY: ResolvableRepository = {
  id: "c0de0000-0000-4000-8000-000000000001",
  name: "checkout",
  organizationName: "acme",
  repositoryName: "checkout",
  mainBranchName: "main",
  gitHubAppInstallationId: null,
};

interface Proposed {
  kind: DataSecurityAiProposalKind;
  change: DataSecurityAiPlannedChange;
  work: DataSecurityAiWorkDecision;
  verdict: DataSecurityAiWithoutAskingVerdict;
  issueId: string;
}

let proposed: Array<Proposed>;
let project: { enableAi: boolean; enableAutomaticDataSecurityAi: boolean };
let rules: Array<AutoRemediationRule> | null;
let plansByService: Map<string, Array<TelemetryLeakFixPlan>>;
let cap: number | null;
let openAlready: number;
let onItsWay: Set<string>;

function issueOf(id: string, riskScore: number): DataSecurityIssue {
  const issue: DataSecurityIssue = new DataSecurityIssue();

  issue._id = id;
  issue.title = "Sensitive data is reaching your telemetry";
  issue.checkId = SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID;
  issue.riskScore = riskScore;
  issue.dataStoreId = new ObjectID("51000000-0000-4000-8000-000000000101");

  return issue;
}

function leakOf(
  issueId: string,
  places: Array<TelemetryLeakPlace>,
  data: Partial<TelemetryLeakToPlace> = {},
): TelemetryLeakToPlace {
  return {
    issueId,
    dataStoreId: "51000000-0000-4000-8000-000000000101",
    checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
    signal: TelemetryLeakSignal.Spans,
    dataTypeId: "email-address",
    dataTypeName: "Email address",
    isSecret: false,
    location: "attributes.user.email",
    key: "user.email",
    isMaskedByScrubRule: false,
    places,
    ...data,
  };
}

// A service's plan, as TelemetryLeakFix makes it.
function planOf(data: {
  serviceId: string;
  serviceName: string;
  repository: ResolvableRepository | null;
  issues: Array<DataSecurityIssue>;
  leaks: Array<TelemetryLeakToPlace>;
}): TelemetryLeakFixPlan {
  const service: Service = new Service();

  service._id = data.serviceId;
  service.name = data.serviceName;

  return TelemetryLeakFix.toPlan({
    projectId: PROJECT_ID,
    service,
    issues: data.issues,
    group: {
      repository: data.repository,
      choice: data.repository
        ? DataSecurityTelemetryFixRepositoryChoice.StackTrace
        : null,
      folder: null,
      leaks: data.leaks,
    },
  });
}

const CHECKOUT_ID: string = "5e000000-0000-4000-8000-000000000001";
const ORDERS_ID: string = "5e000000-0000-4000-8000-000000000002";
const CHECKOUT_SPAN: DataSecurityIssue = issueOf(
  "15000000-0000-4000-8000-000000000101",
  90,
);
const CHECKOUT_LOG: DataSecurityIssue = issueOf(
  "15000000-0000-4000-8000-000000000102",
  70,
);
const ORDERS_SPAN: DataSecurityIssue = issueOf(
  "15000000-0000-4000-8000-000000000201",
  60,
);

function checkoutPlan(
  repository: ResolvableRepository | null = REPOSITORY,
): TelemetryLeakFixPlan {
  return planOf({
    serviceId: CHECKOUT_ID,
    serviceName: "checkout",
    repository,
    issues: [CHECKOUT_SPAN, CHECKOUT_LOG],
    leaks: [
      leakOf(CHECKOUT_SPAN._id!, [
        { filePath: "src/signup.js", lineNumber: 10, recordCount: 2 },
      ]),
      leakOf(
        CHECKOUT_LOG._id!,
        [
          {
            filePath: "src/signup.js",
            lineNumber: 12,
            template: "User <Email address> signed up",
            recordCount: 2,
          },
        ],
        { signal: TelemetryLeakSignal.Logs, location: "body", key: undefined },
      ),
    ],
  });
}

function ordersPlan(): TelemetryLeakFixPlan {
  return planOf({
    serviceId: ORDERS_ID,
    serviceName: "orders",
    repository: REPOSITORY,
    issues: [ORDERS_SPAN],
    leaks: [
      leakOf(ORDERS_SPAN._id!, [
        { filePath: "src/orders.js", lineNumber: 3, recordCount: 1 },
      ]),
    ],
  });
}

function storeOf(serviceId: string): DataStore {
  const store: DataStore = new DataStore();

  store._id = "51000000-0000-4000-8000-000000000101";
  store.serviceId = new ObjectID(serviceId);

  return store;
}

function rule(fix: DataSecurityAiAutonomy): AutoRemediationRule {
  const made: AutoRemediationRule = new AutoRemediationRule();

  made._id = "55555555-5555-4555-8555-555555555555";
  made.name = "Fix leaks in code";
  made.isEnabled = true;
  (made as unknown as Record<string, unknown>)["dataSecurityFix"] = fix;

  return made;
}

function useRule(fix: DataSecurityAiAutonomy): void {
  rules = [rule(fix)];
  jest.spyOn(DataSecurityAiEngine, "matchRules").mockReturnValue([
    {
      _id: "55555555-5555-4555-8555-555555555555",
      name: "Fix leaks in code",
      dataSecurityFix: fix,
    },
  ] as never);
}

async function propose(): Promise<number> {
  return await TelemetryLeakFixProposals.proposeForProject({
    projectId: PROJECT_ID,
    now: new Date("2026-11-24T10:00:00.000Z"),
  });
}

beforeEach(() => {
  proposed = [];
  project = { enableAi: true, enableAutomaticDataSecurityAi: true };
  rules = [];
  cap = null;
  openAlready = 0;
  onItsWay = new Set();
  plansByService = new Map([
    [CHECKOUT_ID, [checkoutPlan()]],
    [ORDERS_ID, [ordersPlan()]],
  ]);

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    const row: Project = new Project();

    row.enableAi = project.enableAi;
    row.enableAutomaticDataSecurityAi = project.enableAutomaticDataSecurityAi;
    row.requireTwoApprovalsForRiskierFixes = false;

    return row;
  }) as never);
  // The riskiest service first: checkout's span issue, then orders'.
  jest
    .spyOn(TelemetryLeakFixProposals, "findServicesWithLeaks")
    .mockImplementation((async () => {
      return [
        {
          serviceId: CHECKOUT_ID,
          issue: CHECKOUT_SPAN,
          store: storeOf(CHECKOUT_ID),
        },
        { serviceId: ORDERS_ID, issue: ORDERS_SPAN, store: storeOf(ORDERS_ID) },
      ];
    }) as never);
  jest
    .spyOn(DataSecurityAiEngine, "readRules")
    .mockImplementation((async () => {
      return rules;
    }) as never);
  jest.spyOn(DataSecurityAiEngine, "readDataTypes").mockResolvedValue({
    namer: undefined,
    categoryOf: new Map(),
  } as never);
  jest.spyOn(DataSecurityAiEngine, "readRuleIssue").mockResolvedValue({
    checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
  } as never);
  jest
    .spyOn(DataSecurityAiEngine, "countChangesWithoutAskingThisHour")
    .mockResolvedValue(0 as never);
  jest.spyOn(TelemetryLeakFix, "planService").mockImplementation((async (data: {
    serviceId: ObjectID;
  }) => {
    return plansByService.get(data.serviceId.toString().toLowerCase()) || [];
  }) as never);
  jest
    .spyOn(TelemetryLeakFix, "findFixOnItsWay")
    .mockImplementation((async (data: { serviceId: string }) => {
      return onItsWay.has(data.serviceId)
        ? "a1000000-0000-4000-8000-000000000001"
        : null;
    }) as never);
  jest
    .spyOn(DataSecurityIssueService, "findOneBy")
    .mockImplementation((async (data: { query: { _id: string } }) => {
      return (
        [CHECKOUT_SPAN, CHECKOUT_LOG, ORDERS_SPAN].find(
          (issue: DataSecurityIssue): boolean => {
            return issue._id === String(data.query._id);
          },
        ) || null
      );
    }) as never);
  jest
    .spyOn(DataStoreService, "findOneBy")
    .mockResolvedValue(storeOf(CHECKOUT_ID) as never);
  jest
    .spyOn(CodeRepositoryService, "findOneBy")
    .mockImplementation((async () => {
      const repository: CodeRepository = new CodeRepository();

      repository._id = REPOSITORY.id;
      repository.maxOpenFixPullRequests = cap as never;

      return repository;
    }) as never);
  jest
    .spyOn(OpenPullRequestCap, "checkForRepository")
    .mockImplementation((async (data: { configuredLimit: number | null }) => {
      return OpenPullRequestCap.evaluate({
        configuredLimit: data.configuredLimit,
        openCount: openAlready,
      });
    }) as never);
  jest
    .spyOn(DataSecurityAiProposals, "propose")
    .mockImplementation((async (data: {
      action: { kind: DataSecurityAiProposalKind };
      change: DataSecurityAiPlannedChange;
      work: DataSecurityAiWorkDecision;
      verdict: DataSecurityAiWithoutAskingVerdict;
      issue: DataSecurityIssue;
    }) => {
      proposed.push({
        kind: data.action.kind,
        change: data.change,
        work: data.work,
        verdict: data.verdict,
        issueId: data.issue._id || "",
      });

      return {
        reason: data.verdict.runWithoutAsking
          ? DataSecurityAiDecisionReason.AppliedWithoutAsking
          : DataSecurityAiDecisionReason.Proposed,
      };
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("out of the box", () => {
  test("each service's one pull request is proposed for a person, the riskiest service first, kept on its riskiest issue", async () => {
    expect(await propose()).toBe(2);

    expect(
      proposed.map((each: Proposed): string => {
        return each.issueId;
      }),
    ).toEqual([CHECKOUT_SPAN._id, ORDERS_SPAN._id]);

    const checkout: Proposed = proposed[0]!;

    expect(checkout.kind).toBe(
      DataSecurityAiProposalKind.FixTelemetryLeaksInCode,
    );
    expect(checkout.work.autonomy).toBe(DataSecurityAiAutonomy.Suggest);
    expect(checkout.verdict.runWithoutAsking).toBe(false);
    expect(checkout.change.safety).toBe(
      DataSecurityAiChangeSafety.OpensPullRequest,
    );
    expect(checkout.change.title).toBe(
      "Stop checkout writing sensitive data to its telemetry: one pull request for 2 issues",
    );
    expect(checkout.change.plan["issueIds"]).toEqual([
      CHECKOUT_SPAN._id,
      CHECKOUT_LOG._id,
    ]);
    expect(checkout.change.plan["repositoryId"]).toBe(REPOSITORY.id);
    expect(checkout.change.planKey).toBe(checkoutPlan().planKey);
    // Where each leak is written, never a value.
    expect(checkout.change.changeMarkdown).toContain("src/signup.js:10");
    // A template's "<" is kept from starting a tag (FeedMarkdown.code).
    expect(checkout.change.changeMarkdown).toMatch(
      /User <\u2060?Email address> signed up/,
    );
    expect(checkout.change.changeMarkdown).toContain(
      "OneUptime AI starts from",
    );
  });
});

describe("under the project's AI rules", () => {
  test("a rule whose Fix is Without asking opens the pull request on its own", async () => {
    useRule(DataSecurityAiAutonomy.WithoutAsking);

    await propose();

    expect(proposed[0]!.work.autonomy).toBe(
      DataSecurityAiAutonomy.WithoutAsking,
    );
    expect(proposed[0]!.verdict).toEqual({
      runWithoutAsking: true,
      askReason: null,
    });
  });

  test("never in a repository a person must pick", async () => {
    useRule(DataSecurityAiAutonomy.WithoutAsking);
    plansByService.set(CHECKOUT_ID, [checkoutPlan(null)]);

    await propose();

    expect(proposed[0]!.verdict).toEqual({
      runWithoutAsking: false,
      askReason: null,
    });
    expect(proposed[0]!.change.plan["repositoryId"]).toBeUndefined();
  });

  test("a rule that turns Fix off proposes nothing; rules that cannot be read keep it from proposing anything", async () => {
    useRule(DataSecurityAiAutonomy.Off);
    expect(await propose()).toBe(0);
    expect(proposed).toEqual([]);

    rules = null;
    expect(await propose()).toBe(0);
    expect(proposed).toEqual([]);
  });
});

describe("the repository's cap on open AI pull requests", () => {
  test("holds a pull request a rule would open: at the cap, it waits, saying why", async () => {
    useRule(DataSecurityAiAutonomy.WithoutAsking);
    cap = 1;
    openAlready = 1;

    await propose();

    expect(
      proposed.map((each: Proposed) => {
        return each.verdict;
      }),
    ).toEqual([
      {
        runWithoutAsking: false,
        askReason: DataSecurityAiAskReason.AtPullRequestCap,
      },
      {
        runWithoutAsking: false,
        askReason: DataSecurityAiAskReason.AtPullRequestCap,
      },
    ]);
  });

  test("the riskiest service gets the slot, and the pull requests this run opened count", async () => {
    useRule(DataSecurityAiAutonomy.WithoutAsking);
    cap = 1;
    openAlready = 0;

    await propose();

    expect(proposed[0]!.issueId).toBe(CHECKOUT_SPAN._id);
    expect(proposed[0]!.verdict.runWithoutAsking).toBe(true);
    expect(proposed[1]!.issueId).toBe(ORDERS_SPAN._id);
    expect(proposed[1]!.verdict).toEqual({
      runWithoutAsking: false,
      askReason: DataSecurityAiAskReason.AtPullRequestCap,
    });
  });

  test("a repository with no cap opens each", async () => {
    useRule(DataSecurityAiAutonomy.WithoutAsking);
    cap = null;
    openAlready = 40;

    await propose();

    expect(
      proposed.every((each: Proposed): boolean => {
        return each.verdict.runWithoutAsking;
      }),
    ).toBe(true);
  });
});

describe("the same fix, proposed once", () => {
  test("a pull request already on its way for the service there is not proposed again", async () => {
    onItsWay.add(CHECKOUT_ID);

    expect(await propose()).toBe(1);
    expect(proposed[0]!.issueId).toBe(ORDERS_SPAN._id);
  });
});

describe("with the project's AI off", () => {
  test("nothing is proposed, with either switch off", async () => {
    project = { enableAi: false, enableAutomaticDataSecurityAi: true };
    expect(await propose()).toBe(0);

    project = { enableAi: true, enableAutomaticDataSecurityAi: false };
    expect(await propose()).toBe(0);
    expect(proposed).toEqual([]);
  });
});

describe("what a proposal shows", () => {
  test("a secret says to rotate it, and twenty places one redaction step", () => {
    const secret: TelemetryLeakFixPlan = planOf({
      serviceId: CHECKOUT_ID,
      serviceName: "payments",
      repository: REPOSITORY,
      issues: [CHECKOUT_SPAN],
      leaks: Array.from({ length: 6 }, (_: unknown, index: number) => {
        return leakOf(
          CHECKOUT_SPAN._id!,
          [
            {
              filePath: `src/handlers/step${index}.js`,
              lineNumber: 4,
              recordCount: 1,
            },
          ],
          {
            checkId: SECRETS_IN_TELEMETRY_CHECK_ID,
            dataTypeId: "stripe-secret-key",
            dataTypeName: "Stripe secret key",
            isSecret: true,
            key: "stripe.key",
          },
        );
      }),
    });
    const preview: string = buildTelemetryFixPreview(secret);

    expect(preview).toContain("adds one redaction step");
    expect(preview).toContain("rotate the secret too");
  });
});

describe("approving a service's proposal", () => {
  test("is held to the permission Fix with AI takes: changing Data Security issues", () => {
    expect(
      TelemetryLeakFixAction.getApproveRefusal({
        props: {
          userId: ObjectID.generate(),
          userGlobalAccessPermission: undefined,
        } as never,
      } as never),
    ).toBe(TELEMETRY_FIX_APPROVE_REFUSED_MESSAGE);
    expect(
      TelemetryLeakFixAction.getApproveRefusal({
        props: { isRoot: true },
      } as never),
    ).toBeNull();
    expect(new DataSecurityIssue().updateRecordPermissions).toContain(
      Permission.ProjectOwner,
    );
  });

  test("is never undone from here: a pull request is closed where it was opened", () => {
    expect(TelemetryLeakFixAction.getUndoRefusal({} as never)).toContain(
      "close it in Code",
    );
  });

  test("asks for the plan in the proposal's repository, else the one no repository decides", () => {
    const decided: TelemetryLeakFixPlan = checkoutPlan();
    const undecided: TelemetryLeakFixPlan = checkoutPlan(null);

    expect(
      pickProposedPlan({
        plans: [undecided, decided],
        repositoryId: REPOSITORY.id,
      }),
    ).toBe(decided);
    expect(
      pickProposedPlan({ plans: [decided, undecided], repositoryId: "" }),
    ).toBe(undecided);
    expect(pickProposedPlan({ plans: [], repositoryId: "" })).toBeNull();
    expect(
      pickProposedPlan({
        plans: [decided],
        repositoryId: "c0de0000-0000-4000-8000-000000000009",
      }),
    ).toBeNull();
  });
});
