import Entities from "../../../Models/DatabaseModels/Index";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import DashboardService from "../../../Server/Services/DashboardService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MailService from "../../../Server/Services/MailService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import Errors from "../../../Server/Utils/Errors";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

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
    value: 1,
  });
  Object.defineProperty(mocked, "AllowedSubscribersCountInFreePlan", {
    enumerable: true,
    value: 5,
  });

  return mocked;
});

/*
 * A PROJECT'S PLAN LIMITS, HELD BY A REAL, MIGRATED POSTGRES.
 *
 * A plan caps how many of some things a project may have: its people (the
 * seats a plan bought from a reseller includes, and the Free plan's one),
 * and on the Free plan its status pages, its status pages' subscribers,
 * its dashboards and the escalation rules of each on-call policy. Each
 * limit was a count in the service's onBeforeCreate followed, later, by
 * the INSERT, with nothing holding the two together: creates made at the
 * same moment each counted before any of the others had written, all saw
 * room, and all were added - a project could go past any of its limits by
 * as many creates as it sent at once.
 *
 * Only Postgres can show what holds them now: every create held to one of
 * these limits is counted again in the INSERT's own transaction, under the
 * limit's per-project advisory lock (DatabaseService.getCreateLimit /
 * insertWithinCreateLimit, ProjectLimitLock), so creates that all passed
 * the early count - held at a barrier until every one of them has - still
 * add exactly as many records as the limit has room for, and creates sent
 * at the same moment with nothing holding them do too.
 *
 * Every create goes through the real service, the way its callers make it:
 * a project admin's request from the dashboard or the API (the plan on its
 * props, as CommonAPI puts it there), a visitor signing up on a public
 * status page, and a sign-in through the project's SSO, which adds people
 * with hooks skipped. The project's plan and seat limit are read from its
 * row. Billing is on for every test (the plans are set below); Redis
 * (locks, the permission cache), email, live updates and workflows are
 * stood in for.
 *
 * Opt in with RUN_POSTGRES_PLAN_LIMIT_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database, right after its drift check. Every table's STRUCTURE is cloned
 * into a unique schema (first on the search_path), dropped afterwards, so
 * nothing lands in the database's own tables. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * PLAN_LIMIT_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * PLAN_LIMIT_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PLAN_LIMIT_TESTS"] === "true"
    ? describe
    : describe.skip;

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const SCHEMA_NAME_DASHES: RegExp = /-/g;

// More creates at once than the connection pool has connections.
const RACING_CREATES: number = 12;
const POOL_SIZE: number = 10;

// The refusals, as each limit words them.
const STATUS_PAGE_REFUSAL: string =
  "You have reached the maximum allowed status page limit for the free plan. Please upgrade your plan to add more status pages.";
const SUBSCRIBER_REFUSAL: string =
  "You have reached the maximum allowed subscriber limit for the free plan. Please upgrade your plan to add more subscribers.";
const DASHBOARD_REFUSAL: string =
  "Free plan can only have 1 dashboard. Please upgrade your plan.";
const ESCALATION_RULE_REFUSAL: string =
  "You can only create one escalation rule in free plan.";

interface Outcome {
  created: number;
  refusals: Array<string>;
}

describePostgres("a project's plan limits, on a migrated Postgres", () => {
  const schema: string = `plan_limits_${ObjectID.generate()
    .toString()
    .replace(SCHEMA_NAME_DASHES, "")}`;

  const savedPlanEnvironment: Record<string, string | undefined> = {};

  let database: DataSource;
  let projectId: ObjectID;
  let adminId: ObjectID;

  beforeAll(async () => {
    for (const [key, value] of Object.entries(PLAN_ENVIRONMENT)) {
      savedPlanEnvironment[key] = process.env[key];
      process.env[key] = value;
    }

    database = new DataSource({
      type: "postgres",
      host: process.env["PLAN_LIMIT_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["PLAN_LIMIT_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["PLAN_LIMIT_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema},public`,
        max: POOL_SIZE,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    /*
     * Every table, so whatever a create's hooks touch lands here and never
     * in the database's own tables. Defaults, NOT NULL and CHECK
     * constraints and every index come with them; foreign keys do not.
     */
    const tables: Array<string> = (
      await database.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'migrations'`,
      )
    ).map((row: { table_name: string }): string => {
      return row.table_name;
    });

    for (const table of tables) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  }, 300000);

  afterAll(async () => {
    for (const [key, value] of Object.entries(savedPlanEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    setTestBillingEnabled(true);

    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    // Live updates and workflows are not what this is about.
    jest
      .spyOn(DatabaseService.prototype, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);

    // Redis' locks: the seat sync's, not the limits' (Postgres').
    jest.spyOn(Semaphore, "lock").mockImplementation((async () => {
      return {} as SemaphoreMutex;
    }) as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

    // Email, the permission cache in Redis and product analytics.
    jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined as never);
    jest
      .spyOn(AccessTokenService, "refreshUserGlobalAccessPermission")
      .mockResolvedValue({
        _type: "UserGlobalAccessPermission",
        projectIds: [],
        globalPermissions: [],
      });
    jest
      .spyOn(AccessTokenService, "refreshUserTenantAccessPermission")
      .mockResolvedValue(null);
    jest.spyOn(ProductAnalytics, "captureForUser").mockReturnValue(undefined);

    // A project of its own per test: the plan is cached per project.
    projectId = ObjectID.generate();
    adminId = ObjectID.generate();
  });

  afterEach(async () => {
    // What a create leaves running after it returns ends first.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 1500);
    });
    jest.restoreAllMocks();
    setTestBillingEnabled(false);
  });

  async function insertProject(data: {
    plan: "free" | "growth";
    seatLimit?: number | null | undefined;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "version", "name", "slug", "paymentProviderPlanId", "seatLimit") VALUES ($1, 1, 'Acme', $2, $3, $4)`,
      [
        projectId.toString(),
        `acme-${projectId.toString()}`,
        `price_${data.plan}_month`,
        data.seatLimit ?? null,
      ],
    );
  }

  /*
   * A project admin's request from the dashboard or the API: the plan on
   * its props, as CommonAPI puts it there.
   */
  function projectAdminProps(
    currentPlan: PlanType,
  ): DatabaseCommonInteractionProps {
    return {
      userId: adminId,
      tenantId: projectId,
      currentPlan: currentPlan,
      isSubscriptionUnpaid: false,
      userGlobalAccessPermission: {
        _type: "UserGlobalAccessPermission",
        projectIds: [projectId],
        globalPermissions: [
          Permission.Public,
          Permission.User,
          Permission.CurrentUser,
        ],
      },
      userTenantAccessPermission: {
        [projectId.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: projectId,
          permissions: [
            {
              _type: "UserPermission",
              permission: Permission.ProjectAdmin,
              labelIds: [],
              isBlockPermission: false,
            },
          ],
        },
      },
    } as DatabaseCommonInteractionProps;
  }

  async function count(table: string, where: string = ""): Promise<number> {
    const rows: Array<{ count: number }> = await database.query(
      `SELECT COUNT(*)::int AS "count" FROM "${schema}"."${table}" WHERE "projectId" = $1 ${where}`,
      [projectId.toString()],
    );

    return rows[0]?.count ?? 0;
  }

  /*
   * Holds every create of `service` once its own checks and hooks have
   * passed - the early count of its limit among them - until `count` of
   * them have got there, then lets them all go at once. Past it, only the
   * INSERT's own count under the lock stands between them and the table.
   */
  function holdCreatesUntilAllPassedTheirChecks(
    service: object,
    count: number,
  ): void {
    let arrived: number = 0;
    let release: () => void = (): void => {
      return;
    };
    const allArrived: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        release = resolve;
      },
    );

    jest
      .spyOn(
        service as unknown as {
          onCreatePermitted: () => Promise<void>;
        },
        "onCreatePermitted",
      )
      .mockImplementation(async (): Promise<void> => {
        arrived++;

        if (arrived === count) {
          release();
        }

        await allArrived;
      });
  }

  /*
   * `count` creates at once. With `holdAt`, each is held once it has passed
   * its checks, until all have; without, they are only sent together.
   */
  async function createAtOnce(data: {
    count: number;
    holdAt?: object | undefined;
    create: (index: number) => Promise<unknown>;
  }): Promise<Outcome> {
    if (data.holdAt) {
      holdCreatesUntilAllPassedTheirChecks(data.holdAt, data.count);
    }

    const results: Array<PromiseSettledResult<unknown>> =
      await Promise.allSettled(
        Array.from({ length: data.count }, (_value: unknown, index: number) => {
          return data.create(index);
        }),
      );

    return {
      created: results.filter(
        (result: PromiseSettledResult<unknown>): boolean => {
          return result.status === "fulfilled";
        },
      ).length,
      refusals: results
        .filter((result: PromiseSettledResult<unknown>): boolean => {
          return result.status === "rejected";
        })
        .map((result: PromiseSettledResult<unknown>): string => {
          const reason: unknown = (result as { reason: unknown }).reason;
          expect(reason).toBeInstanceOf(BadDataException);
          return (reason as Error).message;
        }),
    };
  }

  function expectOutcome(
    outcome: Outcome,
    expected: { created: number; refusal: string },
  ): void {
    expect(outcome.created).toBe(expected.created);
    expect(outcome.refusals).toEqual(
      Array.from({ length: RACING_CREATES - expected.created }, () => {
        return expected.refusal;
      }),
    );
  }

  describe("status pages on the Free plan", () => {
    async function createStatusPage(
      name: string,
      props?: DatabaseCommonInteractionProps,
    ): Promise<StatusPage> {
      const statusPage: StatusPage = new StatusPage();
      statusPage.name = name;
      statusPage.projectId = projectId;

      return await StatusPageService.create({
        data: statusPage,
        props: props || projectAdminProps(PlanType.Free),
      });
    }

    test("of twelve creates that all passed the early count, exactly one is added", async () => {
      await insertProject({ plan: "free" });

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: StatusPageService,
        create: (index: number) => {
          return createStatusPage(`Racing page ${index}`);
        },
      });

      expectOutcome(outcome, { created: 1, refusal: STATUS_PAGE_REFUSAL });
      expect(await count("StatusPage")).toBe(1);
    }, 120000);

    test("of twelve creates sent at the same moment, with nothing holding them, exactly one is added", async () => {
      await insertProject({ plan: "free" });

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        create: (index: number) => {
          return createStatusPage(`Racing page ${index}`);
        },
      });

      expectOutcome(outcome, { created: 1, refusal: STATUS_PAGE_REFUSAL });
      expect(await count("StatusPage")).toBe(1);
    }, 120000);

    test("a paid plan is held to nothing: every create is added", async () => {
      await insertProject({ plan: "growth" });

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: StatusPageService,
        create: (index: number) => {
          return createStatusPage(
            `Racing page ${index}`,
            projectAdminProps(PlanType.Growth),
          );
        },
      });

      expect(outcome).toEqual({ created: RACING_CREATES, refusals: [] });
      expect(await count("StatusPage")).toBe(RACING_CREATES);
    }, 120000);
  });

  describe("status page subscribers on the Free plan", () => {
    let statusPageId: ObjectID;

    async function insertStatusPage(): Promise<void> {
      statusPageId = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."StatusPage" ("_id", "version", "projectId", "name", "slug", "isPublicStatusPage", "enableEmailSubscribers") VALUES ($1, 1, $2, 'Public status', $3, true, true)`,
        [
          statusPageId.toString(),
          projectId.toString(),
          `public-status-${statusPageId.toString()}`,
        ],
      );
    }

    async function insertSubscribers(howMany: number): Promise<void> {
      for (let index: number = 0; index < howMany; index++) {
        await database.query(
          `INSERT INTO "${schema}"."StatusPageSubscriber" ("_id", "version", "projectId", "statusPageId", "subscriberEmail", "isSubscriptionConfirmed") VALUES ($1, 1, $2, $3, $4, true)`,
          [
            ObjectID.generate().toString(),
            projectId.toString(),
            statusPageId.toString(),
            `existing-${index}@example.com`,
          ],
        );
      }
    }

    // A visitor signing up on the public status page, as StatusPageAPI does.
    async function signUp(email: string): Promise<StatusPageSubscriber> {
      const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
      subscriber.statusPageId = statusPageId;
      subscriber.projectId = projectId;
      subscriber.subscriberEmail = new Email(email);
      subscriber.sendYouHaveSubscribedMessage = false;

      return await StatusPageSubscriberService.createFromStatusPageSignUp(
        subscriber,
      );
    }

    test("with room for one: of twelve sign-ups that all passed the early count, exactly one is added", async () => {
      await insertProject({ plan: "free" });
      await insertStatusPage();
      await insertSubscribers(4);

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: StatusPageSubscriberService,
        create: (index: number) => {
          return signUp(`visitor-${index}@example.com`);
        },
      });

      expectOutcome(outcome, { created: 1, refusal: SUBSCRIBER_REFUSAL });
      expect(await count("StatusPageSubscriber")).toBe(5);
    }, 120000);

    test("with room for three: of twelve sign-ups sent at the same moment, exactly three are added", async () => {
      await insertProject({ plan: "free" });
      await insertStatusPage();
      await insertSubscribers(2);

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        create: (index: number) => {
          return signUp(`visitor-${index}@example.com`);
        },
      });

      expectOutcome(outcome, { created: 3, refusal: SUBSCRIBER_REFUSAL });
      expect(await count("StatusPageSubscriber")).toBe(5);
    }, 120000);
  });

  describe("dashboards on the Free plan", () => {
    async function createDashboard(
      name: string,
      props?: DatabaseCommonInteractionProps,
    ): Promise<Dashboard> {
      const dashboard: Dashboard = new Dashboard();
      dashboard.name = name;
      dashboard.projectId = projectId;

      return await DashboardService.create({
        data: dashboard,
        props: props || projectAdminProps(PlanType.Free),
      });
    }

    test("of twelve creates that all passed the early count, exactly one is added", async () => {
      await insertProject({ plan: "free" });

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: DashboardService,
        create: (index: number) => {
          return createDashboard(`Racing dashboard ${index}`);
        },
      });

      expectOutcome(outcome, { created: 1, refusal: DASHBOARD_REFUSAL });
      expect(await count("Dashboard")).toBe(1);
    }, 120000);

    test("of twelve creates sent at the same moment, with nothing holding them, exactly one is added", async () => {
      await insertProject({ plan: "free" });

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        create: (index: number) => {
          return createDashboard(`Racing dashboard ${index}`);
        },
      });

      expectOutcome(outcome, { created: 1, refusal: DASHBOARD_REFUSAL });
      expect(await count("Dashboard")).toBe(1);
    }, 120000);
  });

  describe("escalation rules of an on-call policy on the Free plan", () => {
    async function insertPolicy(): Promise<ObjectID> {
      const policyId: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."OnCallDutyPolicy" ("_id", "version", "projectId", "name", "slug") VALUES ($1, 1, $2, 'Primary', $3)`,
        [
          policyId.toString(),
          projectId.toString(),
          `primary-${policyId.toString()}`,
        ],
      );

      return policyId;
    }

    async function createRule(
      policyId: ObjectID,
      name: string,
    ): Promise<OnCallDutyPolicyEscalationRule> {
      const rule: OnCallDutyPolicyEscalationRule =
        new OnCallDutyPolicyEscalationRule();
      rule.name = name;
      rule.projectId = projectId;
      rule.onCallDutyPolicyId = policyId;
      rule.escalateAfterInMinutes = 5;

      return await OnCallDutyPolicyEscalationRuleService.create({
        data: rule,
        props: projectAdminProps(PlanType.Free),
      });
    }

    test("of twelve creates on one policy that all passed the early count, exactly one is added", async () => {
      await insertProject({ plan: "free" });
      const policyId: ObjectID = await insertPolicy();

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: OnCallDutyPolicyEscalationRuleService,
        create: (index: number) => {
          return createRule(policyId, `Racing rule ${index}`);
        },
      });

      expectOutcome(outcome, { created: 1, refusal: ESCALATION_RULE_REFUSAL });
      expect(await count("OnCallDutyPolicyEscalationRule")).toBe(1);
    }, 120000);

    test("of twelve creates sent at the same moment, with nothing holding them, exactly one is added", async () => {
      await insertProject({ plan: "free" });
      const policyId: ObjectID = await insertPolicy();

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        create: (index: number) => {
          return createRule(policyId, `Racing rule ${index}`);
        },
      });

      expectOutcome(outcome, { created: 1, refusal: ESCALATION_RULE_REFUSAL });
      expect(await count("OnCallDutyPolicyEscalationRule")).toBe(1);
    }, 120000);
  });

  describe("seats", () => {
    let teamId: ObjectID;

    async function insertUser(id: ObjectID, email: string): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."User" ("_id", "version", "email", "slug", "name", "password", "isEmailVerified") VALUES ($1, 1, $2, $3, $4, 'already-registered', true)`,
        [id.toString(), email, `user-${id.toString()}`, email.split("@")[0]],
      );
    }

    async function insertTeam(): Promise<void> {
      teamId = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."Team" ("_id", "version", "projectId", "name", "slug") VALUES ($1, 1, $2, 'Engineering', $3)`,
        [
          teamId.toString(),
          projectId.toString(),
          `engineering-${teamId.toString()}`,
        ],
      );
    }

    // People already in the project, each with an accepted membership.
    async function insertPeople(howMany: number): Promise<void> {
      for (let index: number = 0; index < howMany; index++) {
        const userId: ObjectID = index === 0 ? adminId : ObjectID.generate();

        await insertUser(
          userId,
          `member-${index}-${projectId.toString()}@example.com`,
        );

        await database.query(
          `INSERT INTO "${schema}"."TeamMember" ("_id", "version", "projectId", "teamId", "userId", "hasAcceptedInvitation") VALUES ($1, 1, $2, $3, $4, true)`,
          [
            ObjectID.generate().toString(),
            projectId.toString(),
            teamId.toString(),
            userId.toString(),
          ],
        );
      }
    }

    // Somebody with an account who is not in the project yet.
    async function newPerson(index: number): Promise<ObjectID> {
      const userId: ObjectID = ObjectID.generate();
      await insertUser(
        userId,
        `new-${index}-${projectId.toString()}@example.com`,
      );
      return userId;
    }

    async function peopleInProject(): Promise<number> {
      const rows: Array<{ count: number }> = await database.query(
        `SELECT COUNT(DISTINCT "userId")::int AS "count" FROM "${schema}"."TeamMember" WHERE "projectId" = $1`,
        [projectId.toString()],
      );

      return rows[0]?.count ?? 0;
    }

    // A project admin adds somebody to a team, as Team > Members does.
    async function invite(
      userId: ObjectID,
      currentPlan: PlanType,
    ): Promise<TeamMember> {
      const member: TeamMember = new TeamMember();
      member.projectId = projectId;
      member.teamId = teamId;
      member.userId = userId;

      return await TeamMemberService.create({
        data: member,
        props: projectAdminProps(currentPlan),
      });
    }

    // A first sign-in through the project's SSO: hooks skipped, as SSO.ts does.
    async function joinThroughSso(userId: ObjectID): Promise<TeamMember> {
      const member: TeamMember = new TeamMember();
      member.projectId = projectId;
      member.teamId = teamId;
      member.userId = userId;
      member.hasAcceptedInvitation = true;
      member.invitationAcceptedAt = new Date();

      return await TeamMemberService.create({
        data: member,
        props: { isRoot: true, ignoreHooks: true },
      });
    }

    test("a plan's seat limit with room for one: of twelve invitations that all passed the early count, exactly one is added", async () => {
      await insertProject({ plan: "growth", seatLimit: 3 });
      await insertTeam();
      await insertPeople(2);
      const people: Array<ObjectID> = [];
      for (let index: number = 0; index < RACING_CREATES; index++) {
        people.push(await newPerson(index));
      }

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: TeamMemberService,
        create: (index: number) => {
          return invite(people[index]!, PlanType.Growth);
        },
      });

      expectOutcome(outcome, {
        created: 1,
        refusal: Errors.TeamMemberService.LIMIT_REACHED,
      });
      expect(await peopleInProject()).toBe(3);
    }, 120000);

    test("a plan's seat limit with room for two: of twelve invitations sent at the same moment, exactly two are added", async () => {
      await insertProject({ plan: "growth", seatLimit: 4 });
      await insertTeam();
      await insertPeople(2);
      const people: Array<ObjectID> = [];
      for (let index: number = 0; index < RACING_CREATES; index++) {
        people.push(await newPerson(index));
      }

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        create: (index: number) => {
          return invite(people[index]!, PlanType.Growth);
        },
      });

      expectOutcome(outcome, {
        created: 2,
        refusal: Errors.TeamMemberService.LIMIT_REACHED,
      });
      expect(await peopleInProject()).toBe(4);
    }, 120000);

    test("first sign-ins through the project's SSO, which skip the create hooks, are held to the seat limit too", async () => {
      await insertProject({ plan: "growth", seatLimit: 3 });
      await insertTeam();
      await insertPeople(2);
      const people: Array<ObjectID> = [];
      for (let index: number = 0; index < RACING_CREATES; index++) {
        people.push(await newPerson(index));
      }

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        create: (index: number) => {
          return joinThroughSso(people[index]!);
        },
      });

      expectOutcome(outcome, {
        created: 1,
        refusal: Errors.TeamMemberService.LIMIT_REACHED,
      });
      expect(await peopleInProject()).toBe(3);
    }, 120000);

    test("a project with no seat limit is held to nothing: every invitation is added", async () => {
      await insertProject({ plan: "growth", seatLimit: null });
      await insertTeam();
      await insertPeople(2);
      const people: Array<ObjectID> = [];
      for (let index: number = 0; index < RACING_CREATES; index++) {
        people.push(await newPerson(index));
      }

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: TeamMemberService,
        create: (index: number) => {
          return invite(people[index]!, PlanType.Growth);
        },
      });

      expect(outcome).toEqual({ created: RACING_CREATES, refusals: [] });
      expect(await peopleInProject()).toBe(2 + RACING_CREATES);
    }, 120000);
  });
});
