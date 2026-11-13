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
 * THE WELCOME CHECKLIST'S ONE SERVER ANSWER (issue #6803), with the
 * project's row, its milestones, its on-call rules and their responders,
 * its imports and the old checklist's counts answered here.
 *
 *  - Steps tick on outcomes: a monitor that reported, a status page that
 *    shows a monitor, a policy a rule runs that reaches someone - never on
 *    a row existing.
 *  - One answer for the project: a second member and another browser read
 *    the same steps; hiding is one member's own.
 *  - The plan and the edition: the Free plan's team step says what it
 *    needs; a master admin of a self-hosted server that cannot send email
 *    sees that first.
 *  - A project that existed before is looked at once by the old rule.
 *  - Invited members get no steps, and nothing of the project's is read
 *    for them: only whether a test page has reached them, and, while
 *    their card shows, whether the server can send email (#6807).
 */

let mockIsBillingEnabled: boolean = false;

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual, __esModule: true };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockIsBillingEnabled;
    },
  });

  return mocked;
});

import WelcomeChecklistService, {
  MAX_POLICIES_CHECKED_FOR_RESPONDERS,
  WelcomeChecklistCaller,
} from "../../../Server/Services/WelcomeChecklistService";
import AlertOnCallRuleService from "../../../Server/Services/AlertOnCallRuleService";
import IncidentOnCallRuleService from "../../../Server/Services/IncidentOnCallRuleService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallReadinessService from "../../../Server/Services/OnCallReadinessService";
import ProjectMilestoneService from "../../../Server/Services/ProjectMilestoneService";
import ProjectProductsService from "../../../Server/Services/ProjectProductsService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import ToolImportRunService from "../../../Server/Services/ToolImportRunService";
import logger from "../../../Server/Utils/Logger";
import ServerSendingStatus from "../../../Server/Utils/ServerSending/ServerSendingStatus";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import ToolImportRunStatus from "../../../Types/ToolImport/ToolImportRunStatus";
import UserType from "../../../Types/UserType";
import ProjectGoal from "../../../Types/WelcomeChecklist/ProjectGoal";
import {
  WelcomeAudience,
  WelcomeChecklistStepState,
  WelcomeStep,
} from "../../../Types/WelcomeChecklist/WelcomeChecklist";
import { WelcomeChecklistAnswer } from "../../../Types/WelcomeChecklist/WelcomeChecklistAnswer";
import {
  WelcomeChecklistFinishedBy,
  parseWelcomeChecklistState,
} from "../../../Types/WelcomeChecklist/WelcomeChecklistState";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OWNER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ADMIN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const MEMBER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const POLICY_A: string = "55555555-5555-4555-8555-555555555555";
const POLICY_B: string = "66666666-6666-4666-8666-666666666666";

interface ProjectRow {
  goals: unknown;
  welcomeChecklistState: unknown;
  planName?: PlanType | undefined;
  paymentProviderPlanId?: string | undefined;
}

let row: ProjectRow;
let milestones: Array<ActivationMilestone>;
let incidentRulePolicies: Array<Array<string>>;
let alertRulePolicies: Array<Array<string>>;
let reachableByPolicy: Record<string, number>;
let finishedImports: number;
let legacyCounts: {
  monitors: number;
  statusPages: number;
  teamMembers: number;
  onCallPolicies: number;
};
let serverCanSendEmail: boolean;

interface RecordedWrite {
  sql: string;
  parameters: Array<unknown>;
  // Written in a transaction that holds the project row's lock.
  holdsRowLock: boolean;
}

let writes: Array<RecordedWrite>;

/*
 * THE PROJECT ROW, AS POSTGRES LOCKS IT. `SELECT ... FOR UPDATE` takes the
 * row's lock inside a transaction, waiting for whoever holds it, and reads
 * the row once it has it; the lock is let go when the transaction ends. A
 * read without FOR UPDATE takes no lock and reads the row as it is at that
 * moment - so a writer that read it so loses what another wrote meanwhile.
 */
let rowLock: Promise<void>;
let isRowThere: boolean;

interface FakeTransaction {
  releases: Array<() => void>;
}

const READ_STATE: RegExp =
  /^SELECT "welcomeChecklistState" FROM "Project" WHERE "_id" = \$1 AND "deletedAt" IS NULL( FOR UPDATE)?$/;

const fakeQuery: (
  transaction: FakeTransaction | null,
) => (sql: string, parameters: Array<unknown>) => Promise<unknown> = (
  transaction: FakeTransaction | null,
): ((sql: string, parameters: Array<unknown>) => Promise<unknown>) => {
  return async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
    const read: RegExpMatchArray | null = sql.match(READ_STATE);

    if (read) {
      expect(parameters).toEqual([PROJECT_ID.toString()]);

      if (read[1] && transaction) {
        const held: Promise<void> = rowLock;
        let release: () => void = (): void => {};

        rowLock = new Promise<void>((resolve: () => void) => {
          release = resolve;
        });
        transaction.releases.push(release);

        await held;
      }

      return isRowThere
        ? [
            {
              welcomeChecklistState: JSON.parse(
                JSON.stringify(row.welcomeChecklistState ?? null),
              ),
            },
          ]
        : [];
    }

    writes.push({
      sql: sql,
      parameters: parameters,
      holdsRowLock: Boolean(transaction && transaction.releases.length > 0),
    });

    if (
      sql.startsWith(
        `UPDATE "Project" SET "goals" = $1, "welcomeChecklistState" = $2`,
      )
    ) {
      row.goals = JSON.parse(parameters[0] as string);
      row.welcomeChecklistState = JSON.parse(parameters[1] as string);
    } else if (
      sql.startsWith(`UPDATE "Project" SET "welcomeChecklistState" = $1`)
    ) {
      row.welcomeChecklistState = JSON.parse(parameters[0] as string);
    } else {
      throw new Error(`Unexpected query: ${sql}`);
    }

    return [];
  };
};

let readinessSpy: SpyInstance<
  typeof OnCallReadinessService.getReadinessForPolicy
>;
let incidentRulesSpy: SpyInstance<typeof IncidentOnCallRuleService.findBy>;
let importsSpy: SpyInstance<typeof ToolImportRunService.countBy>;
let milestonesSpy: SpyInstance<
  typeof ProjectMilestoneService.getReachedMilestones
>;
// The four counts of the checklist before this one, each a service of its own.
type LegacyCountSpy = SpyInstance<() => Promise<PositiveNumber>>;
let legacyCountSpies: Array<LegacyCountSpy>;
let canSendSpy: SpyInstance;
/*
 * The products the goals need (#6814): ProjectProductsService works them
 * out and is tested on its own (ProjectProductsService.test.ts); here, only
 * that choosing the goals hands them over.
 */
let applyGoalsSpy: SpyInstance<typeof ProjectProductsService.applyGoals>;

function permission(value: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission: value,
    labelIds: [],
  } as UserPermission;
}

function caller(
  userId: ObjectID,
  permissions: Array<Permission>,
  extra?: Partial<DatabaseCommonInteractionProps>,
): WelcomeChecklistCaller {
  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map(permission),
  };

  return {
    projectId: PROJECT_ID,
    userId: userId,
    props: {
      tenantId: PROJECT_ID,
      userId: userId,
      userType: UserType.User,
      userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
      ...extra,
    },
  };
}

const OWNER: () => WelcomeChecklistCaller = (): WelcomeChecklistCaller => {
  return caller(OWNER_ID, [Permission.ProjectOwner]);
};
const ADMIN: () => WelcomeChecklistCaller = (): WelcomeChecklistCaller => {
  return caller(ADMIN_ID, [Permission.ProjectAdmin]);
};
const MEMBER: () => WelcomeChecklistCaller = (): WelcomeChecklistCaller => {
  return caller(MEMBER_ID, [Permission.ProjectMember]);
};

const stepsOf: (answer: WelcomeChecklistAnswer) => Array<string> = (
  answer: WelcomeChecklistAnswer,
): Array<string> => {
  return answer.steps.map((state: WelcomeChecklistStepState): string => {
    return `${state.step}:${state.isDone ? "done" : "open"}${state.isNext ? ":next" : ""}${state.needsPlan ? `:needs-${state.needsPlan}` : ""}`;
  });
};

const storedState: () => ReturnType<
  typeof parseWelcomeChecklistState
> = (): ReturnType<typeof parseWelcomeChecklistState> => {
  return parseWelcomeChecklistState(row.welcomeChecklistState);
};

const count: (value: number) => PositiveNumber = (
  value: number,
): PositiveNumber => {
  return new PositiveNumber(value);
};

beforeEach(() => {
  mockIsBillingEnabled = false;
  row = {
    goals: null,
    welcomeChecklistState: { startedWithOutcomes: true },
  };
  milestones = [];
  incidentRulePolicies = [];
  alertRulePolicies = [];
  reachableByPolicy = {};
  finishedImports = 0;
  legacyCounts = {
    monitors: 0,
    statusPages: 0,
    teamMembers: 1,
    onCallPolicies: 0,
  };
  serverCanSendEmail = true;
  writes = [];
  rowLock = Promise.resolve();
  isRowThere = true;

  jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation((async (): Promise<unknown> => {
      return isRowThere ? { ...row } : null;
    }) as never);

  jest.spyOn(ProjectService, "getRepository").mockReturnValue({
    manager: {
      query: fakeQuery(null),
      transaction: async (
        work: (manager: unknown) => Promise<unknown>,
      ): Promise<unknown> => {
        const transaction: FakeTransaction = { releases: [] };

        try {
          return await work({ query: fakeQuery(transaction) });
        } finally {
          for (const release of transaction.releases) {
            release();
          }
        }
      },
    },
  } as never);

  milestonesSpy = jest
    .spyOn(ProjectMilestoneService, "getReachedMilestones")
    .mockImplementation((async (): Promise<unknown> => {
      return milestones.map((milestone: ActivationMilestone) => {
        return {
          milestone: milestone,
          reachedAt: new Date(),
          wasBackfilled: false,
        };
      });
    }) as never);

  const rulesOf: (policies: Array<Array<string>>) => Array<JSONObject> = (
    policies: Array<Array<string>>,
  ): Array<JSONObject> => {
    return policies.map((ids: Array<string>) => {
      return {
        _id: ObjectID.generate(),
        onCallDutyPolicies: ids.map((id: string) => {
          return { _id: new ObjectID(id) };
        }),
      } as unknown as JSONObject;
    });
  };

  incidentRulesSpy = jest
    .spyOn(IncidentOnCallRuleService, "findBy")
    .mockImplementation((async (): Promise<unknown> => {
      return rulesOf(incidentRulePolicies);
    }) as never);
  jest
    .spyOn(AlertOnCallRuleService, "findBy")
    .mockImplementation((async (): Promise<unknown> => {
      return rulesOf(alertRulePolicies);
    }) as never);

  readinessSpy = jest
    .spyOn(OnCallReadinessService, "getReadinessForPolicy")
    .mockImplementation((async (policyId: ObjectID): Promise<unknown> => {
      const reachable: number = reachableByPolicy[policyId.toString()] || 0;
      return {
        readyCount: reachable,
        partiallyReadyCount: 0,
        notReachableCount: reachable ? 0 : 1,
      };
    }) as never);

  importsSpy = jest
    .spyOn(ToolImportRunService, "countBy")
    .mockImplementation((async (): Promise<unknown> => {
      return count(finishedImports);
    }) as never);

  legacyCountSpies = [
    jest.spyOn(MonitorService, "countBy").mockImplementation((async () => {
      return count(legacyCounts.monitors);
    }) as never) as unknown as LegacyCountSpy,
    jest.spyOn(StatusPageService, "countBy").mockImplementation((async () => {
      return count(legacyCounts.statusPages);
    }) as never) as unknown as LegacyCountSpy,
    jest.spyOn(TeamMemberService, "countBy").mockImplementation((async () => {
      return count(legacyCounts.teamMembers);
    }) as never) as unknown as LegacyCountSpy,
    jest
      .spyOn(OnCallDutyPolicyService, "countBy")
      .mockImplementation((async () => {
        return count(legacyCounts.onCallPolicies);
      }) as never) as unknown as LegacyCountSpy,
  ];

  canSendSpy = jest
    .spyOn(ServerSendingStatus, "canSendEmailPublicly")
    .mockImplementation((async (): Promise<boolean> => {
      return serverCanSendEmail;
    }) as never);

  applyGoalsSpy = jest
    .spyOn(ProjectProductsService, "applyGoals")
    .mockImplementation((async (): Promise<void> => {}) as never);

  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a new project's owner", () => {
  test("is asked what they came to do, over the four steps they get until they answer", async () => {
    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(OWNER());

    expect(answer.audience).toBe(WelcomeAudience.SetUp);
    expect(answer.shouldAskForGoals).toBe(true);
    expect(answer.canChooseGoals).toBe(true);
    expect(answer.goals).toBeNull();
    expect(stepsOf(answer)).toEqual([
      "monitor:open:next",
      "on_call:open",
      "status_page:open",
      "team:open",
    ]);
    expect(answer.doneCount).toBe(0);
    expect(answer.totalCount).toBe(4);
    expect(answer.isFinished).toBe(false);
  });

  test("chooses goals, and the steps follow them", async () => {
    await WelcomeChecklistService.chooseGoals(OWNER(), [
      "status_page",
      "uptime",
    ]);

    expect(row.goals).toEqual([ProjectGoal.Uptime, ProjectGoal.StatusPage]);
    expect(storedState().goalsChosenByUserId).toBe(OWNER_ID.toString());
    expect(storedState().goalsChosenAt).toBeDefined();
    // What was kept before is kept.
    expect(storedState().startedWithOutcomes).toBe(true);

    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(OWNER());

    expect(answer.shouldAskForGoals).toBe(false);
    expect(answer.goals).toEqual([ProjectGoal.Uptime, ProjectGoal.StatusPage]);
    expect(stepsOf(answer)).toEqual([
      "monitor:open:next",
      "on_call:open",
      "status_page:open",
    ]);
  });

  test("skips the question with no goals, and gets the four steps without being asked again", async () => {
    await WelcomeChecklistService.chooseGoals(OWNER(), []);

    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(OWNER());

    expect(row.goals).toEqual([]);
    expect(answer.shouldAskForGoals).toBe(false);
    expect(answer.goals).toEqual([]);
    expect(answer.steps).toHaveLength(4);
  });

  test("cannot choose goals that do not exist", async () => {
    await expect(
      WelcomeChecklistService.chooseGoals(OWNER(), ["uptime", "world_peace"]),
    ).rejects.toThrow(BadDataException);
    await expect(
      WelcomeChecklistService.chooseGoals(OWNER(), "uptime"),
    ).rejects.toThrow(BadDataException);
    expect(writes).toHaveLength(0);
  });

  test("is not asked once the project is in use", async () => {
    milestones = [ActivationMilestone.FirstMonitorCreated];

    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(OWNER());

    expect(answer.shouldAskForGoals).toBe(false);
    expect(answer.steps).toHaveLength(4);
  });
});

describe("steps tick on outcomes", () => {
  test("a monitor that was only created does not tick; its first result does", async () => {
    milestones = [ActivationMilestone.FirstMonitorCreated];
    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[0]).toBe(
      "monitor:open:next",
    );

    milestones = [
      ActivationMilestone.FirstMonitorCreated,
      ActivationMilestone.FirstCheckResultReceived,
    ];
    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))).toEqual([
      "monitor:done",
      "on_call:open:next",
      "status_page:open",
      "team:open",
    ]);
  });

  test("a status page with no monitor does not tick; one that shows a monitor does", async () => {
    milestones = [ActivationMilestone.FirstStatusPageSubscriberAdded];
    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[2]).toBe(
      "status_page:open",
    );

    milestones = [ActivationMilestone.FirstStatusPageMonitorAdded];
    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[2]).toBe(
      "status_page:done",
    );
  });

  test("a policy no rule runs does not tick who is told, however reachable its people", async () => {
    reachableByPolicy = { [POLICY_A]: 2 };

    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[1]).toBe(
      "on_call:open",
    );
    expect(readinessSpy).not.toHaveBeenCalled();
  });

  test("a policy a rule runs that pages nobody reachable does not tick it", async () => {
    incidentRulePolicies = [[POLICY_A]];
    reachableByPolicy = { [POLICY_A]: 0 };

    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[1]).toBe(
      "on_call:open",
    );
    expect(readinessSpy).toHaveBeenCalledTimes(1);
  });

  test("a rule that runs a policy with someone reachable ticks it", async () => {
    alertRulePolicies = [[POLICY_A, POLICY_B]];
    reachableByPolicy = { [POLICY_B]: 1 };

    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[1]).toBe(
      "on_call:done",
    );
  });

  test("a page that reached someone ticks it without reading rules at all", async () => {
    milestones = [ActivationMilestone.FirstNotificationDelivered];

    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[1]).toBe(
      "on_call:done",
    );
    expect(incidentRulesSpy).not.toHaveBeenCalled();
    expect(readinessSpy).not.toHaveBeenCalled();
  });

  test("a test page acknowledged ticks it (#6811)", async () => {
    milestones = [ActivationMilestone.FirstTestPageAcknowledged];

    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[1]).toBe(
      "on_call:done",
    );
  });

  test("asks at most a few policies about their responders, each once", async () => {
    const many: Array<string> = Array.from(
      { length: 12 },
      (_: unknown, index: number) => {
        return `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`;
      },
    );

    incidentRulePolicies = [many, many];

    await WelcomeChecklistService.getAnswer(OWNER());

    expect(readinessSpy).toHaveBeenCalledTimes(
      MAX_POLICIES_CHECKED_FOR_RESPONDERS,
    );
  });

  test("a readiness read that fails is nobody reachable, not a broken answer", async () => {
    incidentRulePolicies = [[POLICY_A]];
    readinessSpy.mockImplementation((async () => {
      throw new Error("policy went away");
    }) as never);

    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[1]).toBe(
      "on_call:open",
    );
  });

  test("a second person who accepted ticks the team", async () => {
    milestones = [ActivationMilestone.SecondMemberJoined];

    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[3]).toBe(
      "team:done",
    );
  });

  test("importing: only an import that finished ticks it, and only that is read", async () => {
    row.goals = [ProjectGoal.Import];

    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[0]).toBe(
      "import:open:next",
    );
    expect(importsSpy).toHaveBeenCalledTimes(1);
    expect(importsSpy.mock.calls[0]![0].query).toEqual({
      projectId: PROJECT_ID,
      status: ToolImportRunStatus.Completed,
    });

    finishedImports = 1;

    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[0]).toBe(
      "import:done",
    );
  });

  test("imports are not read for a project that did not choose to import", async () => {
    await WelcomeChecklistService.getAnswer(OWNER());

    expect(importsSpy).not.toHaveBeenCalled();
  });

  test("telemetry and servers tick on the data arriving", async () => {
    row.goals = [ProjectGoal.Telemetry, ProjectGoal.Infrastructure];
    milestones = [ActivationMilestone.FirstLogsReceived];

    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))).toEqual([
      "infrastructure:open:next",
      "telemetry:done",
    ]);
  });
});

describe("one checklist for the project", () => {
  test("a second admin, and the same person on another browser, read the same progress", async () => {
    await WelcomeChecklistService.chooseGoals(OWNER(), ["uptime"]);
    milestones = [ActivationMilestone.FirstCheckResultReceived];

    const owner: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(OWNER());
    const ownerAgain: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(OWNER());
    const admin: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(ADMIN());

    expect(ownerAgain).toEqual(owner);
    expect(admin).toEqual(owner);
    expect(stepsOf(admin)).toEqual(["monitor:done", "on_call:open:next"]);
  });

  test("hiding is one member's own: the other still sees it, and it can be shown again", async () => {
    await WelcomeChecklistService.setHiddenForCaller(OWNER(), true);

    expect(
      (await WelcomeChecklistService.getAnswer(OWNER())).isHiddenForMe,
    ).toBe(true);
    expect(
      (await WelcomeChecklistService.getAnswer(ADMIN())).isHiddenForMe,
    ).toBe(false);
    // Hidden, the answer still carries the steps for the line left behind.
    expect(
      (await WelcomeChecklistService.getAnswer(OWNER())).steps,
    ).toHaveLength(4);

    await WelcomeChecklistService.setHiddenForCaller(OWNER(), false);

    expect(
      (await WelcomeChecklistService.getAnswer(OWNER())).isHiddenForMe,
    ).toBe(false);
  });

  test("an invited member gets no steps, and nothing of the project's is read for them", async () => {
    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(MEMBER());

    expect(answer.audience).toBe(WelcomeAudience.InvitedMember);
    expect(answer.steps).toEqual([]);
    expect(answer.shouldAskForGoals).toBe(false);
    expect(answer.canChooseGoals).toBe(false);
    expect(answer.hasAcknowledgedTestPage).toBe(false);
    expect(milestonesSpy).not.toHaveBeenCalled();
    expect(incidentRulesSpy).not.toHaveBeenCalled();
    expect(importsSpy).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  test("an invited member is told when the server cannot send email (#6807)", async () => {
    serverCanSendEmail = false;

    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(MEMBER());

    expect(answer.canSendEmail).toBe(false);
    expect(canSendSpy).toHaveBeenCalledTimes(1);
  });

  test("OneUptime Cloud always sends email, and asks nothing", async () => {
    mockIsBillingEnabled = true;
    serverCanSendEmail = false;

    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(MEMBER());

    expect(answer.canSendEmail).toBe(true);
    expect(canSendSpy).not.toHaveBeenCalled();
  });

  test("a member who hid their first steps is asked nothing more", async () => {
    serverCanSendEmail = false;
    await WelcomeChecklistService.setHiddenForCaller(MEMBER(), true);
    canSendSpy.mockClear();

    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(MEMBER());

    expect(answer.isHiddenForMe).toBe(true);
    expect(answer.canSendEmail).toBe(true);
    expect(canSendSpy).not.toHaveBeenCalled();
  });

  test("a test page a member acknowledged is theirs alone, and written once", async () => {
    await WelcomeChecklistService.noteTestPageAcknowledged({
      projectId: PROJECT_ID,
      userId: MEMBER_ID,
    });

    expect(writes).toHaveLength(1);
    expect(storedState().testPageAcknowledgedByUserIds).toEqual([
      MEMBER_ID.toString(),
    ]);
    expect(
      (await WelcomeChecklistService.getAnswer(MEMBER()))
        .hasAcknowledgedTestPage,
    ).toBe(true);
    expect(
      (await WelcomeChecklistService.getAnswer(OWNER()))
        .hasAcknowledgedTestPage,
    ).toBe(false);

    // A later acknowledgement reads the row and stops.
    await WelcomeChecklistService.noteTestPageAcknowledged({
      projectId: PROJECT_ID,
      userId: MEMBER_ID,
    });

    expect(
      writes.filter((write: { sql: string }): boolean => {
        return write.sql.includes("welcomeChecklistState");
      }),
    ).toHaveLength(1);
    // What else the state held is kept.
    expect(storedState().startedWithOutcomes).toBe(true);
  });

  test("noting a test page in the background never throws", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockImplementation((async (): Promise<unknown> => {
        throw new Error("The database is restarting.");
      }) as never);

    expect(() => {
      WelcomeChecklistService.noteTestPageAcknowledgedInBackground({
        projectId: PROJECT_ID,
        userId: MEMBER_ID,
      });
    }).not.toThrow();

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });

    expect(writes).toHaveLength(0);
    expect(logger.error).toHaveBeenCalled();
  });

  test("an invited member may not choose the goals", async () => {
    await expect(
      WelcomeChecklistService.chooseGoals(MEMBER(), ["uptime"]),
    ).rejects.toThrow(BadDataException);
    expect(row.goals).toBeNull();
  });

  test("a master admin sets up any project they open", async () => {
    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(
        caller(MEMBER_ID, [], { isMasterAdmin: true }),
      );

    expect(answer.audience).toBe(WelcomeAudience.SetUp);
    expect(answer.canChooseGoals).toBe(true);
  });

  test("once every step is done it is finished for everyone, once, and later reads skip the rest", async () => {
    milestones = [
      ActivationMilestone.FirstCheckResultReceived,
      ActivationMilestone.FirstNotificationDelivered,
      ActivationMilestone.FirstStatusPageMonitorAdded,
      ActivationMilestone.SecondMemberJoined,
    ];

    const finishing: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(OWNER());

    expect(finishing.isFinished).toBe(true);
    // The finishing answer still carries the steps, for checklist_finished.
    expect(stepsOf(finishing)).toEqual([
      "monitor:done",
      "on_call:done",
      "status_page:done",
      "team:done",
    ]);
    expect(storedState().finishedBy).toBe(WelcomeChecklistFinishedBy.Outcomes);

    milestonesSpy.mockClear();

    const later: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(ADMIN());

    expect(later.isFinished).toBe(true);
    expect(later.steps).toEqual([]);
    expect(milestonesSpy).not.toHaveBeenCalled();
  });
});

describe("the plan and the edition", () => {
  test("on Cloud's Free plan the team step says it needs the Growth plan, and is not counted", async () => {
    mockIsBillingEnabled = true;
    row.planName = PlanType.Free;

    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(OWNER());

    expect(stepsOf(answer)[3]).toBe("team:open:needs-Growth");
    expect(answer.totalCount).toBe(3);
  });

  test("a plan named only by its id counts too", async () => {
    mockIsBillingEnabled = true;
    row.paymentProviderPlanId = "price_free_monthly";
    jest.spyOn(SubscriptionPlan, "getSubscriptionPlanById").mockReturnValue({
      getName: () => {
        return PlanType.Free;
      },
    } as never);

    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[3]).toBe(
      "team:open:needs-Growth",
    );
  });

  test("a paid plan, or a server without billing, holds nothing back", async () => {
    mockIsBillingEnabled = true;
    row.planName = PlanType.Growth;
    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[3]).toBe(
      "team:open",
    );

    mockIsBillingEnabled = false;
    row.planName = PlanType.Free;
    expect(stepsOf(await WelcomeChecklistService.getAnswer(OWNER()))[3]).toBe(
      "team:open",
    );
  });

  test("a master admin of a self-hosted server that cannot send email sees that first", async () => {
    serverCanSendEmail = false;

    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(
        caller(OWNER_ID, [Permission.ProjectOwner], { isMasterAdmin: true }),
      );

    expect(stepsOf(answer)[0]).toBe("server_email:open:next");
    expect(answer.canSendEmail).toBe(false);
  });

  test("an owner who is not the server's admin is told the server cannot send, without the step", async () => {
    serverCanSendEmail = false;

    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(OWNER());

    expect(stepsOf(answer)).not.toContain("server_email:open:next");
    expect(answer.canSendEmail).toBe(false);
  });

  test("OneUptime Cloud never asks whether it can send email", async () => {
    mockIsBillingEnabled = true;
    serverCanSendEmail = false;

    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(
        caller(OWNER_ID, [Permission.ProjectOwner], { isMasterAdmin: true }),
      );

    expect(canSendSpy).not.toHaveBeenCalled();
    expect(answer.canSendEmail).toBe(true);
    expect(
      answer.steps.map((state: WelcomeChecklistStepState) => {
        return state.step;
      }),
    ).not.toContain(WelcomeStep.ServerEmail);
  });
});

describe("a project from before this checklist", () => {
  beforeEach(() => {
    row.welcomeChecklistState = null;
  });

  test("that finished the old checklist is finished now, and is never asked", async () => {
    legacyCounts = {
      monitors: 3,
      statusPages: 1,
      teamMembers: 2,
      onCallPolicies: 1,
    };

    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(OWNER());

    expect(answer.isFinished).toBe(true);
    expect(answer.shouldAskForGoals).toBe(false);
    expect(storedState().finishedBy).toBe(WelcomeChecklistFinishedBy.Legacy);
    expect(storedState().legacyCheckedAt).toBeDefined();
  });

  test("that did not is looked at once, and then follows outcomes", async () => {
    legacyCounts = {
      monitors: 3,
      statusPages: 1,
      teamMembers: 1,
      onCallPolicies: 1,
    };

    const first: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(OWNER());

    expect(first.isFinished).toBe(false);
    expect(storedState().legacyCheckedAt).toBeDefined();
    expect(storedState().finishedAt).toBeUndefined();

    for (const spy of legacyCountSpies) {
      spy.mockClear();
    }

    await WelcomeChecklistService.getAnswer(OWNER());

    for (const spy of legacyCountSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  test("a project created now is never looked at by the old rule", async () => {
    row.welcomeChecklistState = { startedWithOutcomes: true };
    legacyCounts = {
      monitors: 3,
      statusPages: 1,
      teamMembers: 2,
      onCallPolicies: 1,
    };

    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(OWNER());

    expect(answer.isFinished).toBe(false);
    for (const spy of legacyCountSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  test("counts that cannot be read are looked at again next time", async () => {
    legacyCountSpies[0]!.mockImplementation((async () => {
      throw new Error("database restarting");
    }) as never);

    const answer: WelcomeChecklistAnswer =
      await WelcomeChecklistService.getAnswer(OWNER());

    expect(answer.isFinished).toBe(false);
    expect(storedState().legacyCheckedAt).toBeUndefined();
  });
});

describe("what a browser remembered of the old checklist", () => {
  test("a dismissal hides the card for that member only", async () => {
    await WelcomeChecklistService.takeBrowserState(MEMBER(), {
      wasDismissed: true,
      wasFinished: false,
    });

    expect(storedState().hiddenForUserIds).toEqual([MEMBER_ID.toString()]);
    expect(storedState().finishedAt).toBeUndefined();
  });

  test("a finish from someone who set the project up finishes it for everyone", async () => {
    await WelcomeChecklistService.takeBrowserState(OWNER(), {
      wasDismissed: false,
      wasFinished: true,
    });

    expect(storedState().finishedBy).toBe(WelcomeChecklistFinishedBy.Browser);
    expect((await WelcomeChecklistService.getAnswer(ADMIN())).isFinished).toBe(
      true,
    );
  });

  test("a finish from anyone else's browser finishes nothing", async () => {
    await WelcomeChecklistService.takeBrowserState(MEMBER(), {
      wasDismissed: false,
      wasFinished: true,
    });

    expect(storedState().finishedAt).toBeUndefined();
  });

  test("nothing remembered writes nothing", async () => {
    await WelcomeChecklistService.takeBrowserState(OWNER(), {
      wasDismissed: false,
      wasFinished: false,
    });

    expect(writes).toHaveLength(0);
  });
});

describe("the products the goals need (#6814)", () => {
  test("choosing the goals gives the project the products they need", async () => {
    await WelcomeChecklistService.chooseGoals(OWNER(), ["telemetry", "uptime"]);

    expect(applyGoalsSpy).toHaveBeenCalledTimes(1);
    expect(applyGoalsSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      // In the order of PROJECT_GOALS, as they are kept.
      goals: [ProjectGoal.Uptime, ProjectGoal.Telemetry],
    });
  });

  test("skipping the question hands over no goals", async () => {
    await WelcomeChecklistService.chooseGoals(OWNER(), []);

    expect(applyGoalsSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      goals: [],
    });
  });

  test("goals that are refused set no products", async () => {
    await expect(
      WelcomeChecklistService.chooseGoals(MEMBER(), ["uptime"]),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      WelcomeChecklistService.chooseGoals(OWNER(), ["uptime", "world_peace"]),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(applyGoalsSpy).not.toHaveBeenCalled();
  });
});

describe("the writes", () => {
  test("go straight to the project's row, never through its update hooks", async () => {
    const update: SpyInstance<typeof ProjectService.updateOneById> = jest.spyOn(
      ProjectService,
      "updateOneById",
    );

    await WelcomeChecklistService.chooseGoals(OWNER(), ["telemetry"]);
    await WelcomeChecklistService.setHiddenForCaller(OWNER(), true);

    expect(update).not.toHaveBeenCalled();
    expect(
      writes.map((write: { sql: string }) => {
        return write.sql;
      }),
    ).toEqual([
      `UPDATE "Project" SET "goals" = $1, "welcomeChecklistState" = $2 WHERE "_id" = $3`,
      `UPDATE "Project" SET "welcomeChecklistState" = $1 WHERE "_id" = $2`,
    ]);
    expect(writes[0]!.parameters[2]).toBe(PROJECT_ID.toString());
    expect(writes[1]!.parameters[1]).toBe(PROJECT_ID.toString());
  });

  test("each is written holding the project row's lock, read inside it (#7043)", async () => {
    row.welcomeChecklistState = null;

    await WelcomeChecklistService.chooseGoals(OWNER(), ["uptime"]);
    await WelcomeChecklistService.setHiddenForCaller(MEMBER(), true);
    await WelcomeChecklistService.takeBrowserState(OWNER(), {
      wasDismissed: true,
      wasFinished: false,
    });
    await WelcomeChecklistService.noteTestPageAcknowledged({
      projectId: PROJECT_ID,
      userId: MEMBER_ID,
    });
    await WelcomeChecklistService.checkLegacyChecklist(PROJECT_ID, {});

    expect(writes).toHaveLength(5);

    for (const write of writes) {
      expect(write.holdsRowLock).toBe(true);
    }
  });

  test("a change that changes nothing writes nothing, and takes no other lock", async () => {
    await WelcomeChecklistService.setHiddenForCaller(MEMBER(), false);

    expect(writes).toHaveLength(0);
  });

  test("a project that is gone is not written", async () => {
    isRowThere = false;

    await expect(
      WelcomeChecklistService.setHiddenForCaller(MEMBER(), true),
    ).rejects.toThrow(NotFoundException);
    expect(writes).toHaveLength(0);
  });
});

/*
 * EVERY PERSON WHO ACKNOWLEDGES A TEST IS NOTED (#7043). Each
 * acknowledgement notes its person (OnCallTestPageEvents, for every one -
 * UserOnCallLogTimelineTestPageAcknowledge); what could lose one was the
 * note itself, a read of the state and a write of all of it a moment later:
 * a second writer in between - a teammate acknowledging the same policy
 * test, Home finishing the checklist - was overwritten.
 */
describe("every person who acknowledges a test is noted", () => {
  const TEAMMATE_ID: ObjectID = new ObjectID(
    "77777777-7777-4777-8777-777777777777",
  );

  const note: (userId: ObjectID) => Promise<void> = (
    userId: ObjectID,
  ): Promise<void> => {
    return WelcomeChecklistService.noteTestPageAcknowledged({
      projectId: PROJECT_ID,
      userId: userId,
    });
  };

  const hasAcknowledged: (userId: ObjectID) => Promise<boolean> = async (
    userId: ObjectID,
  ): Promise<boolean> => {
    return (
      await WelcomeChecklistService.getAnswer(
        caller(userId, [Permission.ProjectMember]),
      )
    ).hasAcknowledgedTestPage;
  };

  test("two people who answer one policy's test, one after the other, are both noted", async () => {
    await note(MEMBER_ID);
    await note(TEAMMATE_ID);

    expect(storedState().testPageAcknowledgedByUserIds).toEqual([
      MEMBER_ID.toString(),
      TEAMMATE_ID.toString(),
    ]);
    expect(await hasAcknowledged(MEMBER_ID)).toBe(true);
    expect(await hasAcknowledged(TEAMMATE_ID)).toBe(true);
    // Somebody who answered nothing is not.
    expect(await hasAcknowledged(ADMIN_ID)).toBe(false);
  });

  test("two who answer at the same moment are both noted: neither write loses the other", async () => {
    await Promise.all([note(MEMBER_ID), note(TEAMMATE_ID)]);

    expect(
      [...(storedState().testPageAcknowledgedByUserIds || [])].sort(),
    ).toEqual([MEMBER_ID.toString(), TEAMMATE_ID.toString()].sort());
  });

  test("five who answer at once are all noted, each once", async () => {
    const people: Array<ObjectID> = [
      MEMBER_ID,
      TEAMMATE_ID,
      ADMIN_ID,
      new ObjectID("88888888-8888-4888-8888-888888888888"),
      new ObjectID("99999999-9999-4999-8999-999999999999"),
    ];

    await Promise.all(
      [...people, MEMBER_ID, TEAMMATE_ID].map((userId: ObjectID) => {
        return note(userId);
      }),
    );

    expect(
      [...(storedState().testPageAcknowledgedByUserIds || [])].sort(),
    ).toEqual(
      people
        .map((userId: ObjectID): string => {
          return userId.toString();
        })
        .sort(),
    );
  });

  test("Home finishing the checklist while a test is answered keeps the answer", async () => {
    milestones = [
      ActivationMilestone.FirstCheckResultReceived,
      ActivationMilestone.FirstNotificationDelivered,
      ActivationMilestone.FirstStatusPageMonitorAdded,
      ActivationMilestone.SecondMemberJoined,
    ];

    // The member acknowledges while the owner's Home reads the milestones.
    milestonesSpy.mockImplementation((async (): Promise<unknown> => {
      await note(MEMBER_ID);

      return milestones.map((milestone: ActivationMilestone) => {
        return {
          milestone: milestone,
          reachedAt: new Date(),
          wasBackfilled: false,
        };
      });
    }) as never);

    expect((await WelcomeChecklistService.getAnswer(OWNER())).isFinished).toBe(
      true,
    );
    expect(storedState().finishedBy).toBe(WelcomeChecklistFinishedBy.Outcomes);
    expect(storedState().testPageAcknowledgedByUserIds).toEqual([
      MEMBER_ID.toString(),
    ]);
  });

  test("the old checklist's one look keeps an answer that lands while it counts", async () => {
    row.welcomeChecklistState = null;
    legacyCountSpies[0]!.mockImplementation((async () => {
      await note(MEMBER_ID);
      return count(0);
    }) as never);

    await WelcomeChecklistService.getAnswer(OWNER());

    expect(storedState().legacyCheckedAt).toBeDefined();
    expect(storedState().testPageAcknowledgedByUserIds).toEqual([
      MEMBER_ID.toString(),
    ]);
  });

  test("the old checklist looked at by two at once is looked at once: the second keeps the first's", async () => {
    row.welcomeChecklistState = null;
    legacyCounts = {
      monitors: 3,
      statusPages: 1,
      teamMembers: 2,
      onCallPolicies: 1,
    };

    await Promise.all([
      WelcomeChecklistService.getAnswer(OWNER()),
      WelcomeChecklistService.getAnswer(ADMIN()),
    ]);

    expect(storedState().finishedBy).toBe(WelcomeChecklistFinishedBy.Legacy);
    expect(
      writes.filter((write: RecordedWrite): boolean => {
        return write.sql.includes("welcomeChecklistState");
      }),
    ).toHaveLength(1);
  });

  test("a member hiding their card while a teammate answers keeps both", async () => {
    await Promise.all([
      WelcomeChecklistService.setHiddenForCaller(MEMBER(), true),
      note(TEAMMATE_ID),
      WelcomeChecklistService.chooseGoals(OWNER(), ["on_call"]),
    ]);

    expect(storedState().hiddenForUserIds).toEqual([MEMBER_ID.toString()]);
    expect(storedState().testPageAcknowledgedByUserIds).toEqual([
      TEAMMATE_ID.toString(),
    ]);
    expect(storedState().goalsChosenByUserId).toBe(OWNER_ID.toString());
    expect(row.goals).toEqual([ProjectGoal.OnCall]);
  });
});
