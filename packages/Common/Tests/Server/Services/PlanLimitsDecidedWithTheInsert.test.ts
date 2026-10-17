import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import DashboardService, {
  ALLOWED_DASHBOARD_COUNT_IN_FREE_PLAN,
  DASHBOARD_COUNT_STATEMENT,
  FREE_PLAN_DASHBOARD_LIMIT_MESSAGE,
  FREE_PLAN_DASHBOARD_LIMIT_NAME,
} from "../../../Server/Services/DashboardService";
import OnCallDutyPolicyEscalationRuleService, {
  ALLOWED_ESCALATION_RULES_PER_POLICY_IN_FREE_PLAN,
  ESCALATION_RULE_COUNT_STATEMENT,
  FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE,
  FREE_PLAN_ESCALATION_RULE_LIMIT_NAME,
} from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import ProjectService, {
  CurrentPlan,
} from "../../../Server/Services/ProjectService";
import StatusPageService, {
  FREE_PLAN_STATUS_PAGE_LIMIT_MESSAGE,
  FREE_PLAN_STATUS_PAGE_LIMIT_NAME,
  STATUS_PAGE_COUNT_STATEMENT,
} from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService, {
  FREE_PLAN_SUBSCRIBER_LIMIT_MESSAGE,
  FREE_PLAN_SUBSCRIBER_LIMIT_NAME,
  SUBSCRIBER_COUNT_STATEMENT,
} from "../../../Server/Services/StatusPageSubscriberService";
import TeamMemberService, {
  ALLOWED_PEOPLE_IN_FREE_PLAN,
  MEMBERSHIPS_OF_PERSON_STATEMENT,
  PEOPLE_IN_PROJECT_STATEMENT,
  ProjectPeopleLimits,
  SEAT_LIMIT_NAME,
} from "../../../Server/Services/TeamMemberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import CreateLimit from "../../../Server/Types/Database/CreateLimit";
import Errors from "../../../Server/Utils/Errors";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { EntityManager } from "typeorm";

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  const mocked: Record<string, unknown> = billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );

  // The Free plan's allowances, pinned: an install can change them.
  Object.defineProperty(mocked, "AllowedStatusPageCountInFreePlan", {
    enumerable: true,
    value: 3,
  });
  Object.defineProperty(mocked, "AllowedSubscribersCountInFreePlan", {
    enumerable: true,
    value: 100,
  });

  return mocked;
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * EVERY PLAN LIMIT ON A PROJECT'S CREATES IS DECIDED WITH THE INSERT.
 *
 * A plan limits how many people a project may have (the seats of a plan
 * bought from a reseller, and the Free plan's one person), and, on the
 * Free plan, how many status pages, status page subscribers and dashboards
 * it may have, and how many escalation rules each of its on-call policies
 * may have. Each service counted in onBeforeCreate and inserted later, so
 * creates made at the same moment all passed. Each now hands DatabaseService
 * a CreateLimit for the create (getCreateLimit), and the INSERT is decided
 * with it: counted in the INSERT's own transaction under the limit's lock in
 * the project (DatabaseServiceCreateLimit pins that wiring for any service;
 * ProjectPlanLimitsPostgres races real creates).
 *
 * These pin, for each service: which creates are held (billing on, the
 * plan or seat limit that applies - the same ones the early check holds),
 * the lock each takes, what its check counts with the transaction it is
 * handed, and that it refuses in the early check's own words.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "8c000000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "8c000000-0000-4000-8000-000000000002",
);
const PERSON_ID: ObjectID = new ObjectID(
  "8c000000-0000-4000-8000-000000000003",
);
const TEAM_ID: ObjectID = new ObjectID("8c000000-0000-4000-8000-000000000004");

interface LimitedService {
  getCreateLimit: (createBy: CreateBy<never>) => Promise<CreateLimit | null>;
}

// The service's own getCreateLimit, as DatabaseService.create asks it.
async function createLimitOf(
  service: unknown,
  createBy: CreateBy<never>,
): Promise<CreateLimit | null> {
  return await (service as LimitedService).getCreateLimit(createBy);
}

interface FakeTransaction {
  manager: EntityManager;
  statements: Array<{ sql: string; parameters: Array<unknown> }>;
}

// The INSERT's transaction: each COUNT answered from `counts`, by statement.
function transactionCounting(counts: Map<string, number>): FakeTransaction {
  const transaction: FakeTransaction = {
    manager: {} as EntityManager,
    statements: [],
  };

  transaction.manager = {
    query: async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<Array<{ count: number }>> => {
      transaction.statements.push({ sql: sql, parameters: parameters });

      if (!counts.has(sql)) {
        throw new Error(`Not a count this limit makes: ${sql}`);
      }

      return [{ count: counts.get(sql)! }];
    },
  } as unknown as EntityManager;

  return transaction;
}

function memberProps(
  currentPlan?: PlanType | undefined,
): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    ...(currentPlan ? { currentPlan: currentPlan } : {}),
  } as DatabaseCommonInteractionProps;
}

function readsPlan(plan: PlanType | null): void {
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: plan,
    isSubscriptionUnpaid: false,
  } as CurrentPlan);
}

beforeEach(() => {
  setTestBillingEnabled(true);
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

/*
 * A Free plan cap counted by one statement: the shape every limit but the
 * seat limit shares.
 */
async function expectCountLimit(data: {
  limit: CreateLimit | null;
  limitName: string;
  statement: string;
  parameters: Array<string>;
  allowed: number;
  refusal: string;
}): Promise<void> {
  expect(data.limit).not.toBeNull();
  expect(data.limit!.limitName).toBe(data.limitName);
  expect(data.limit!.projectId.toString()).toBe(PROJECT_ID.toString());

  // Room for one more: through, after one count on the transaction handed in.
  const withRoom: FakeTransaction = transactionCounting(
    new Map([[data.statement, data.allowed - 1]]),
  );
  await expect(data.limit!.check(withRoom.manager)).resolves.toBeUndefined();
  expect(withRoom.statements).toEqual([
    { sql: data.statement, parameters: data.parameters },
  ]);

  // At the limit and past it: refused in the early check's words.
  for (const count of [data.allowed, data.allowed + 1]) {
    await expect(
      data.limit!.check(
        transactionCounting(new Map([[data.statement, count]])).manager,
      ),
    ).rejects.toThrow(new BadDataException(data.refusal));
  }
}

describe("status pages: the Free plan's limit", () => {
  function createBy(props?: DatabaseCommonInteractionProps): CreateBy<never> {
    const statusPage: StatusPage = new StatusPage();
    statusPage.name = "Public status";
    statusPage.projectId = PROJECT_ID;

    return {
      data: statusPage,
      props: props || memberProps(),
    } as unknown as CreateBy<never>;
  }

  test("holds a create in a project on the Free plan, read from the project, whoever makes it", async () => {
    readsPlan(PlanType.Free);

    for (const props of [
      memberProps(),
      memberProps(PlanType.Growth),
      { isRoot: true } as DatabaseCommonInteractionProps,
      { isRoot: true, ignoreHooks: true } as DatabaseCommonInteractionProps,
    ]) {
      await expectCountLimit({
        limit: await createLimitOf(StatusPageService, createBy(props)),
        limitName: FREE_PLAN_STATUS_PAGE_LIMIT_NAME,
        statement: STATUS_PAGE_COUNT_STATEMENT,
        parameters: [PROJECT_ID.toString()],
        allowed: 3,
        refusal: FREE_PLAN_STATUS_PAGE_LIMIT_MESSAGE,
      });
    }

    expect(ProjectService.getCurrentPlan).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("holds nothing on a paid plan", async () => {
    for (const plan of [PlanType.Growth, PlanType.Scale, PlanType.Enterprise]) {
      readsPlan(plan);
      await expect(
        createLimitOf(StatusPageService, createBy()),
      ).resolves.toBeNull();
    }
  });

  test("holds nothing without billing, and reads no plan", async () => {
    setTestBillingEnabled(false);
    readsPlan(PlanType.Free);

    await expect(
      createLimitOf(StatusPageService, createBy()),
    ).resolves.toBeNull();
    expect(ProjectService.getCurrentPlan).not.toHaveBeenCalled();
  });

  test("counts the project's status pages, every one the early check counts", () => {
    expect(STATUS_PAGE_COUNT_STATEMENT).toBe(
      'SELECT COUNT(*)::int AS "count" FROM "StatusPage" WHERE "projectId" = $1 AND "deletedAt" IS NULL',
    );
  });
});

describe("status page subscribers: the Free plan's limit", () => {
  function createBy(props?: DatabaseCommonInteractionProps): CreateBy<never> {
    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    subscriber.projectId = PROJECT_ID;
    subscriber.statusPageId = ObjectID.generate();

    return {
      data: subscriber,
      props: props || { isRoot: true },
    } as unknown as CreateBy<never>;
  }

  test("holds a visitor's sign-up and the team's create alike, in a project on the Free plan", async () => {
    readsPlan(PlanType.Free);

    for (const props of [
      // A sign-up on the public status page is created as OneUptime.
      { isRoot: true } as DatabaseCommonInteractionProps,
      memberProps(),
      memberProps(PlanType.Free),
    ]) {
      await expectCountLimit({
        limit: await createLimitOf(
          StatusPageSubscriberService,
          createBy(props),
        ),
        limitName: FREE_PLAN_SUBSCRIBER_LIMIT_NAME,
        statement: SUBSCRIBER_COUNT_STATEMENT,
        parameters: [PROJECT_ID.toString()],
        allowed: 100,
        refusal: FREE_PLAN_SUBSCRIBER_LIMIT_MESSAGE,
      });
    }
  });

  test("holds nothing on a paid plan, or without billing", async () => {
    readsPlan(PlanType.Growth);
    await expect(
      createLimitOf(StatusPageSubscriberService, createBy()),
    ).resolves.toBeNull();

    setTestBillingEnabled(false);
    readsPlan(PlanType.Free);
    await expect(
      createLimitOf(StatusPageSubscriberService, createBy()),
    ).resolves.toBeNull();
  });

  test("counts the project's subscribers, over all of its status pages", () => {
    expect(SUBSCRIBER_COUNT_STATEMENT).toBe(
      'SELECT COUNT(*)::int AS "count" FROM "StatusPageSubscriber" WHERE "projectId" = $1 AND "deletedAt" IS NULL',
    );
  });
});

describe("dashboards: the Free plan's limit", () => {
  function createBy(props: DatabaseCommonInteractionProps): CreateBy<never> {
    const dashboard: Dashboard = new Dashboard();
    dashboard.name = "Overview";
    dashboard.projectId = PROJECT_ID;

    return { data: dashboard, props: props } as unknown as CreateBy<never>;
  }

  test("holds a create by someone on the Free plan: one dashboard", async () => {
    expect(ALLOWED_DASHBOARD_COUNT_IN_FREE_PLAN).toBe(1);

    await expectCountLimit({
      limit: await createLimitOf(
        DashboardService,
        createBy(memberProps(PlanType.Free)),
      ),
      limitName: FREE_PLAN_DASHBOARD_LIMIT_NAME,
      statement: DASHBOARD_COUNT_STATEMENT,
      parameters: [PROJECT_ID.toString()],
      allowed: 1,
      refusal: FREE_PLAN_DASHBOARD_LIMIT_MESSAGE,
    });
  });

  test("holds nothing on a paid plan, without billing, or for OneUptime itself and a server admin, who carry no plan", async () => {
    for (const props of [
      memberProps(PlanType.Growth),
      memberProps(PlanType.Enterprise),
      { isRoot: true, tenantId: PROJECT_ID } as DatabaseCommonInteractionProps,
      {
        isMasterAdmin: true,
        tenantId: PROJECT_ID,
      } as DatabaseCommonInteractionProps,
    ]) {
      await expect(
        createLimitOf(DashboardService, createBy(props)),
      ).resolves.toBeNull();
    }

    setTestBillingEnabled(false);
    await expect(
      createLimitOf(DashboardService, createBy(memberProps(PlanType.Free))),
    ).resolves.toBeNull();
  });

  test("the early check refuses in the same words", () => {
    expect(FREE_PLAN_DASHBOARD_LIMIT_MESSAGE).toBe(
      "Free plan can only have 1 dashboard. Please upgrade your plan.",
    );
    expect(DASHBOARD_COUNT_STATEMENT).toBe(
      'SELECT COUNT(*)::int AS "count" FROM "Dashboard" WHERE "projectId" = $1 AND "deletedAt" IS NULL',
    );
  });
});

describe("escalation rules: the Free plan's limit, per on-call policy", () => {
  function createBy(
    props: DatabaseCommonInteractionProps,
    policy: "id column" | "relation" | "both" | "none" = "id column",
  ): CreateBy<never> {
    const rule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    rule.name = "Level 1";
    rule.projectId = PROJECT_ID;

    if (policy === "id column" || policy === "both") {
      rule.onCallDutyPolicyId = POLICY_ID;
    }

    if (policy === "relation" || policy === "both") {
      (rule as unknown as Record<string, unknown>)["onCallDutyPolicy"] = {
        _id: POLICY_ID.toString(),
      };
    }

    return { data: rule, props: props } as unknown as CreateBy<never>;
  }

  test("holds a create by someone on the Free plan, counting the rules of its own policy", async () => {
    expect(ALLOWED_ESCALATION_RULES_PER_POLICY_IN_FREE_PLAN).toBe(1);

    for (const policy of ["id column", "relation", "both"] as const) {
      await expectCountLimit({
        limit: await createLimitOf(
          OnCallDutyPolicyEscalationRuleService,
          createBy(memberProps(PlanType.Free), policy),
        ),
        limitName: FREE_PLAN_ESCALATION_RULE_LIMIT_NAME,
        statement: ESCALATION_RULE_COUNT_STATEMENT,
        parameters: [PROJECT_ID.toString(), POLICY_ID.toString()],
        allowed: 1,
        refusal: FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE,
      });
    }
  });

  test("holds nothing on a paid plan, without billing, for OneUptime itself, or with no policy named", async () => {
    for (const createByOf of [
      createBy(memberProps(PlanType.Growth)),
      createBy({
        isRoot: true,
        tenantId: PROJECT_ID,
      } as DatabaseCommonInteractionProps),
      createBy(memberProps(PlanType.Free), "none"),
    ]) {
      await expect(
        createLimitOf(OnCallDutyPolicyEscalationRuleService, createByOf),
      ).resolves.toBeNull();
    }

    setTestBillingEnabled(false);
    await expect(
      createLimitOf(
        OnCallDutyPolicyEscalationRuleService,
        createBy(memberProps(PlanType.Free)),
      ),
    ).resolves.toBeNull();
  });

  test("counts the rules of one policy of the project, not of the project", () => {
    expect(ESCALATION_RULE_COUNT_STATEMENT).toBe(
      'SELECT COUNT(*)::int AS "count" FROM "OnCallDutyPolicyEscalationRule" WHERE "projectId" = $1 AND "onCallDutyPolicyId" = $2 AND "deletedAt" IS NULL',
    );
    expect(FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE).toBe(
      "You can only create one escalation rule in free plan.",
    );
  });
});

describe("people: the plan's seats and the Free plan's one person", () => {
  function readsSeatLimit(seatLimit: number | null | undefined): void {
    jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
      const project: Project = new Project(PROJECT_ID);

      if (seatLimit !== undefined) {
        project.seatLimit = seatLimit as number;
      }

      return project;
    }) as never);
  }

  function createBy(
    props: DatabaseCommonInteractionProps,
    person: "id column" | "relation" | "none" = "id column",
  ): CreateBy<never> {
    const member: TeamMember = new TeamMember();
    member.projectId = PROJECT_ID;
    member.teamId = TEAM_ID;

    if (person === "id column") {
      member.userId = PERSON_ID;
    }

    if (person === "relation") {
      member.user = new User(PERSON_ID);
    }

    return { data: member, props: props } as unknown as CreateBy<never>;
  }

  // The project's people, and the person's memberships in it.
  function counts(data: {
    people: number;
    membershipsOfPerson: number;
  }): Map<string, number> {
    return new Map([
      [PEOPLE_IN_PROJECT_STATEMENT, data.people],
      [MEMBERSHIPS_OF_PERSON_STATEMENT, data.membershipsOfPerson],
    ]);
  }

  test("a plan's seats hold every create that adds someone: an invitation, an SSO sign-in that skips the hooks, OneUptime's own", async () => {
    readsSeatLimit(5);

    for (const props of [
      memberProps(PlanType.Growth),
      { isRoot: true, ignoreHooks: true } as DatabaseCommonInteractionProps,
      { isRoot: true } as DatabaseCommonInteractionProps,
      { isMasterAdmin: true } as DatabaseCommonInteractionProps,
    ]) {
      const limit: CreateLimit | null = await createLimitOf(
        TeamMemberService,
        createBy(props),
      );

      expect(limit).not.toBeNull();
      expect(limit!.limitName).toBe(SEAT_LIMIT_NAME);
      expect(limit!.projectId.toString()).toBe(PROJECT_ID.toString());

      // Room for one more person.
      const withRoom: FakeTransaction = transactionCounting(
        counts({ people: 4, membershipsOfPerson: 0 }),
      );
      await expect(limit!.check(withRoom.manager)).resolves.toBeUndefined();
      expect(withRoom.statements).toEqual([
        {
          sql: MEMBERSHIPS_OF_PERSON_STATEMENT,
          parameters: [PROJECT_ID.toString(), PERSON_ID.toString()],
        },
        {
          sql: PEOPLE_IN_PROJECT_STATEMENT,
          parameters: [PROJECT_ID.toString()],
        },
      ]);

      // Every seat taken, or more.
      for (const people of [5, 9]) {
        await expect(
          limit!.check(
            transactionCounting(
              counts({ people: people, membershipsOfPerson: 0 }),
            ).manager,
          ),
        ).rejects.toThrow(
          new BadDataException(Errors.TeamMemberService.LIMIT_REACHED),
        );
      }
    }
  });

  test("someone already in the project is counted already: they join another team at the limit, and the people are not counted", async () => {
    readsSeatLimit(5);

    const limit: CreateLimit | null = await createLimitOf(
      TeamMemberService,
      createBy(memberProps(PlanType.Growth)),
    );

    for (const membershipsOfPerson of [1, 3]) {
      const transaction: FakeTransaction = transactionCounting(
        counts({ people: 9, membershipsOfPerson: membershipsOfPerson }),
      );

      await expect(limit!.check(transaction.manager)).resolves.toBeUndefined();
      expect(
        transaction.statements.map((statement: { sql: string }): string => {
          return statement.sql;
        }),
      ).toEqual([MEMBERSHIPS_OF_PERSON_STATEMENT]);
    }
  });

  test("the person is read under either name of the reference", async () => {
    readsSeatLimit(5);

    const limit: CreateLimit | null = await createLimitOf(
      TeamMemberService,
      createBy({ isRoot: true } as DatabaseCommonInteractionProps, "relation"),
    );
    const transaction: FakeTransaction = transactionCounting(
      counts({ people: 5, membershipsOfPerson: 1 }),
    );

    await expect(limit!.check(transaction.manager)).resolves.toBeUndefined();
    expect(transaction.statements[0]).toEqual({
      sql: MEMBERSHIPS_OF_PERSON_STATEMENT,
      parameters: [PROJECT_ID.toString(), PERSON_ID.toString()],
    });
  });

  test("a create naming nobody is held as someone new", async () => {
    readsSeatLimit(5);

    const limit: CreateLimit | null = await createLimitOf(
      TeamMemberService,
      createBy({ isRoot: true } as DatabaseCommonInteractionProps, "none"),
    );
    const transaction: FakeTransaction = transactionCounting(
      counts({ people: 5, membershipsOfPerson: 0 }),
    );

    await expect(limit!.check(transaction.manager)).rejects.toThrow(
      Errors.TeamMemberService.LIMIT_REACHED,
    );
    expect(transaction.statements).toEqual([
      { sql: PEOPLE_IN_PROJECT_STATEMENT, parameters: [PROJECT_ID.toString()] },
    ]);
  });

  test("the Free plan holds someone on it to one person", async () => {
    readsSeatLimit(null);
    expect(ALLOWED_PEOPLE_IN_FREE_PLAN).toBe(1);

    const limit: CreateLimit | null = await createLimitOf(
      TeamMemberService,
      createBy(memberProps(PlanType.Free)),
    );

    expect(limit).not.toBeNull();
    await expect(
      limit!.check(
        transactionCounting(counts({ people: 0, membershipsOfPerson: 0 }))
          .manager,
      ),
    ).resolves.toBeUndefined();
    await expect(
      limit!.check(
        transactionCounting(counts({ people: 1, membershipsOfPerson: 0 }))
          .manager,
      ),
    ).rejects.toThrow(
      new BadDataException(
        Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
      ),
    );

    // Their owner, already in it, joins another team.
    await expect(
      limit!.check(
        transactionCounting(counts({ people: 1, membershipsOfPerson: 1 }))
          .manager,
      ),
    ).resolves.toBeUndefined();
  });

  test("a plan's seats are asked before the Free plan's person", () => {
    const limits: ProjectPeopleLimits = { seatLimit: 3, isFreePlan: true };

    expect(
      TeamMemberService.getPeopleLimitRefusal({ limits: limits, people: 0 }),
    ).toBeNull();
    expect(
      TeamMemberService.getPeopleLimitRefusal({ limits: limits, people: 1 }),
    ).toBe(Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN);
    expect(
      TeamMemberService.getPeopleLimitRefusal({ limits: limits, people: 3 }),
    ).toBe(Errors.TeamMemberService.LIMIT_REACHED);
    expect(
      TeamMemberService.getPeopleLimitRefusal({
        limits: { seatLimit: 3, isFreePlan: false },
        people: 2,
      }),
    ).toBeNull();
  });

  test("holds nothing with no seat limit (none, or 0) off the Free plan, for OneUptime itself with no seat limit, or without billing", async () => {
    for (const seatLimit of [null, 0, undefined]) {
      readsSeatLimit(seatLimit);

      for (const props of [
        memberProps(PlanType.Growth),
        memberProps(),
        { isRoot: true, ignoreHooks: true } as DatabaseCommonInteractionProps,
      ]) {
        await expect(
          createLimitOf(TeamMemberService, createBy(props)),
        ).resolves.toBeNull();
      }
    }

    // Without billing, not even the project is read.
    jest.restoreAllMocks();
    setTestBillingEnabled(false);
    readsSeatLimit(5);
    await expect(
      createLimitOf(TeamMemberService, createBy(memberProps(PlanType.Free))),
    ).resolves.toBeNull();
    expect(ProjectService.findOneById).not.toHaveBeenCalled();
  });

  test("holds nothing in a project that cannot be read", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null as never);

    await expect(
      createLimitOf(TeamMemberService, createBy(memberProps(PlanType.Free))),
    ).resolves.toBeNull();
  });

  test("reads the limits the early check reads: the project's seats, the caller's plan", async () => {
    readsSeatLimit(7);

    await expect(
      TeamMemberService.readPeopleLimits({
        projectId: PROJECT_ID,
        props: memberProps(PlanType.Free),
      }),
    ).resolves.toEqual({ seatLimit: 7, isFreePlan: true });
    await expect(
      TeamMemberService.readPeopleLimits({
        projectId: PROJECT_ID,
        props: { isRoot: true } as DatabaseCommonInteractionProps,
      }),
    ).resolves.toEqual({ seatLimit: 7, isFreePlan: false });

    expect(ProjectService.findOneById).toHaveBeenCalledWith({
      id: PROJECT_ID,
      select: { seatLimit: true },
      props: { isRoot: true },
    });
  });

  test("counts people, not memberships: the distinct people with any membership, a pending invitation included", () => {
    expect(PEOPLE_IN_PROJECT_STATEMENT).toBe(
      'SELECT COUNT(DISTINCT "userId")::int AS "count" FROM "TeamMember" WHERE "projectId" = $1 AND "deletedAt" IS NULL',
    );
    expect(MEMBERSHIPS_OF_PERSON_STATEMENT).toBe(
      'SELECT COUNT(*)::int AS "count" FROM "TeamMember" WHERE "projectId" = $1 AND "userId" = $2 AND "deletedAt" IS NULL',
    );
  });
});

describe("every limit takes a lock of its own", () => {
  test("no two limits share a name", () => {
    const names: Array<string> = [
      FREE_PLAN_STATUS_PAGE_LIMIT_NAME,
      FREE_PLAN_SUBSCRIBER_LIMIT_NAME,
      FREE_PLAN_DASHBOARD_LIMIT_NAME,
      FREE_PLAN_ESCALATION_RULE_LIMIT_NAME,
      SEAT_LIMIT_NAME,
      "active-monitors",
    ];

    expect(new Set(names).size).toBe(names.length);
  });
});
