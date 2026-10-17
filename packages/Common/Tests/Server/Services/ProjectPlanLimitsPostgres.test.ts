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
  generateIdWithLetters,
  spellingsOf,
} from "../TestingUtils/IdSpellings";
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
   * its props, as CommonAPI puts it there. With `namedAs`, the request
   * named the project by that spelling of its id (IdSpellings):
   * its tenant and its permissions are keyed by the id as it was sent, as
   * UserMiddleware keys them; the projects the person is in are read
   * from the table.
   */
  function projectAdminProps(
    currentPlan: PlanType,
    namedAs?: ObjectID | undefined,
  ): DatabaseCommonInteractionProps {
    const tenantId: ObjectID = namedAs || projectId;

    return {
      userId: adminId,
      tenantId: tenantId,
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
        [tenantId.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: tenantId,
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
    service: unknown,
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
    holdAt?: unknown;
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
      namedAs?: ObjectID | undefined,
    ): Promise<StatusPage> {
      const statusPage: StatusPage = new StatusPage();
      statusPage.name = name;
      statusPage.projectId = namedAs || projectId;

      return await StatusPageService.create({
        data: statusPage,
        props: props || projectAdminProps(PlanType.Free, namedAs),
      });
    }

    test("of twelve creates that each name the project by another spelling of its id, exactly one is added", async () => {
      projectId = generateIdWithLetters();
      await insertProject({ plan: "free" });
      const spellings: Array<ObjectID> = spellingsOf(projectId);

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: StatusPageService,
        create: (index: number) => {
          return createStatusPage(
            `Racing page ${index}`,
            undefined,
            spellings[index],
          );
        },
      });

      expectOutcome(outcome, { created: 1, refusal: STATUS_PAGE_REFUSAL });
      expect(await count("StatusPage")).toBe(1);
    }, 120000);

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

    test("without billing - a self-hosted install - nothing is held, whatever the plan id says", async () => {
      setTestBillingEnabled(false);
      await insertProject({ plan: "free" });

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: StatusPageService,
        create: (index: number) => {
          return createStatusPage(`Racing page ${index}`);
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

    test("the team adding subscribers and visitors signing up at the same moment share the room: exactly two are added", async () => {
      await insertProject({ plan: "free" });
      await insertStatusPage();
      await insertSubscribers(3);

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: StatusPageSubscriberService,
        create: (index: number) => {
          if (index % 2 === 0) {
            return signUp(`visitor-${index}@example.com`);
          }

          // A teammate's Add Subscriber, from the dashboard.
          const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
          subscriber.statusPageId = statusPageId;
          subscriber.projectId = projectId;
          subscriber.subscriberEmail = new Email(`added-${index}@example.com`);
          subscriber.sendYouHaveSubscribedMessage = false;

          return StatusPageSubscriberService.create({
            data: subscriber,
            props: projectAdminProps(PlanType.Free),
          });
        },
      });

      expectOutcome(outcome, { created: 2, refusal: SUBSCRIBER_REFUSAL });
      expect(await count("StatusPageSubscriber")).toBe(5);
    }, 120000);

    test("the team adding subscribers, each naming the project by another spelling of its id, and visitors signing up share the room: exactly two are added", async () => {
      projectId = generateIdWithLetters();
      await insertProject({ plan: "free" });
      await insertStatusPage();
      await insertSubscribers(3);
      const spellings: Array<ObjectID> = spellingsOf(projectId);

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: StatusPageSubscriberService,
        create: (index: number) => {
          if (index % 4 === 0) {
            return signUp(`visitor-${index}@example.com`);
          }

          const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
          subscriber.statusPageId = statusPageId;
          subscriber.projectId = spellings[index]!;
          subscriber.subscriberEmail = new Email(`added-${index}@example.com`);
          subscriber.sendYouHaveSubscribedMessage = false;

          return StatusPageSubscriberService.create({
            data: subscriber,
            props: projectAdminProps(PlanType.Free, spellings[index]),
          });
        },
      });

      expectOutcome(outcome, { created: 2, refusal: SUBSCRIBER_REFUSAL });
      expect(await count("StatusPageSubscriber")).toBe(5);
    }, 120000);
  });

  describe("dashboards on the Free plan", () => {
    async function createDashboard(
      name: string,
      props?: DatabaseCommonInteractionProps,
      namedAs?: ObjectID | undefined,
    ): Promise<Dashboard> {
      const dashboard: Dashboard = new Dashboard();
      dashboard.name = name;
      dashboard.projectId = namedAs || projectId;

      return await DashboardService.create({
        data: dashboard,
        props: props || projectAdminProps(PlanType.Free, namedAs),
      });
    }

    test("of twelve creates that each name the project by another spelling of its id, exactly one is added", async () => {
      projectId = generateIdWithLetters();
      await insertProject({ plan: "free" });
      const spellings: Array<ObjectID> = spellingsOf(projectId);

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: DashboardService,
        create: (index: number) => {
          return createDashboard(
            `Racing dashboard ${index}`,
            undefined,
            spellings[index],
          );
        },
      });

      expectOutcome(outcome, { created: 1, refusal: DASHBOARD_REFUSAL });
      expect(await count("Dashboard")).toBe(1);
    }, 120000);

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

    test("a paid plan is held to nothing: every create is added", async () => {
      await insertProject({ plan: "growth" });

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: DashboardService,
        create: (index: number) => {
          return createDashboard(
            `Racing dashboard ${index}`,
            projectAdminProps(PlanType.Growth),
          );
        },
      });

      expect(outcome).toEqual({ created: RACING_CREATES, refusals: [] });
      expect(await count("Dashboard")).toBe(RACING_CREATES);
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
      plan: PlanType = PlanType.Free,
      namedAs?: ObjectID | undefined,
    ): Promise<OnCallDutyPolicyEscalationRule> {
      const rule: OnCallDutyPolicyEscalationRule =
        new OnCallDutyPolicyEscalationRule();
      rule.name = name;
      rule.projectId = namedAs || projectId;
      rule.onCallDutyPolicyId = policyId;
      rule.escalateAfterInMinutes = 5;

      return await OnCallDutyPolicyEscalationRuleService.create({
        data: rule,
        props: projectAdminProps(plan, namedAs),
      });
    }

    test("of twelve creates on one policy that each name the project by another spelling of its id, exactly one is added", async () => {
      projectId = generateIdWithLetters();
      await insertProject({ plan: "free" });
      const policyId: ObjectID = await insertPolicy();
      const spellings: Array<ObjectID> = spellingsOf(projectId);

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: OnCallDutyPolicyEscalationRuleService,
        create: (index: number) => {
          return createRule(
            policyId,
            `Racing rule ${index}`,
            PlanType.Free,
            spellings[index],
          );
        },
      });

      expectOutcome(outcome, { created: 1, refusal: ESCALATION_RULE_REFUSAL });
      expect(await count("OnCallDutyPolicyEscalationRule")).toBe(1);
    }, 120000);

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

    test("the limit is each policy's: a rule of another policy does not count, and each policy gets its one rule", async () => {
      await insertProject({ plan: "free" });
      const firstPolicyId: ObjectID = await insertPolicy();
      const secondPolicyId: ObjectID = await insertPolicy();
      await createRule(firstPolicyId, "First policy's rule");

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: OnCallDutyPolicyEscalationRuleService,
        create: (index: number) => {
          return createRule(secondPolicyId, `Racing rule ${index}`);
        },
      });

      expectOutcome(outcome, { created: 1, refusal: ESCALATION_RULE_REFUSAL });
      expect(
        await count(
          "OnCallDutyPolicyEscalationRule",
          `AND "onCallDutyPolicyId" = '${firstPolicyId.toString()}'`,
        ),
      ).toBe(1);
      expect(
        await count(
          "OnCallDutyPolicyEscalationRule",
          `AND "onCallDutyPolicyId" = '${secondPolicyId.toString()}'`,
        ),
      ).toBe(1);
    }, 120000);

    test("a paid plan is held to nothing: every rule is added", async () => {
      await insertProject({ plan: "growth" });
      const policyId: ObjectID = await insertPolicy();

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: OnCallDutyPolicyEscalationRuleService,
        create: (index: number) => {
          return createRule(policyId, `Racing rule ${index}`, PlanType.Growth);
        },
      });

      expect(outcome).toEqual({ created: RACING_CREATES, refusals: [] });
      expect(await count("OnCallDutyPolicyEscalationRule")).toBe(
        RACING_CREATES,
      );
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

    let secondTeamId: ObjectID;

    async function insertTeam(): Promise<void> {
      teamId = ObjectID.generate();
      secondTeamId = ObjectID.generate();

      for (const [id, name] of [
        [teamId, "Engineering"],
        [secondTeamId, "Support"],
      ] as Array<[ObjectID, string]>) {
        await database.query(
          `INSERT INTO "${schema}"."Team" ("_id", "version", "projectId", "name", "slug") VALUES ($1, 1, $2, $3, $4)`,
          [
            id.toString(),
            projectId.toString(),
            name,
            `${name.toLowerCase()}-${id.toString()}`,
          ],
        );
      }
    }

    async function insertMembership(
      userId: ObjectID,
      onTeamId: ObjectID,
    ): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."TeamMember" ("_id", "version", "projectId", "teamId", "userId", "hasAcceptedInvitation") VALUES ($1, 1, $2, $3, $4, true)`,
        [
          ObjectID.generate().toString(),
          projectId.toString(),
          onTeamId.toString(),
          userId.toString(),
        ],
      );
    }

    /*
     * People already in the project, each with an accepted membership of
     * the first team - and, with onBothTeams, of the second as well.
     */
    async function insertPeople(
      howMany: number,
      options?: { onBothTeams?: boolean | undefined },
    ): Promise<Array<ObjectID>> {
      const people: Array<ObjectID> = [];

      for (let index: number = 0; index < howMany; index++) {
        const userId: ObjectID = index === 0 ? adminId : ObjectID.generate();

        await insertUser(
          userId,
          `member-${index}-${projectId.toString()}@example.com`,
        );
        await insertMembership(userId, teamId);

        if (options?.onBothTeams) {
          await insertMembership(userId, secondTeamId);
        }

        people.push(userId);
      }

      return people;
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
      toTeamId?: ObjectID | undefined,
      namedAs?: ObjectID | undefined,
    ): Promise<TeamMember> {
      const member: TeamMember = new TeamMember();
      member.projectId = namedAs || projectId;
      member.teamId = toTeamId || teamId;
      member.userId = userId;

      return await TeamMemberService.create({
        data: member,
        props: projectAdminProps(currentPlan, namedAs),
      });
    }

    // The same from the invite form, which names the person by email.
    async function inviteByEmail(email: string): Promise<TeamMember> {
      const member: TeamMember = new TeamMember();
      member.projectId = projectId;
      member.teamId = teamId;

      return await TeamMemberService.create({
        data: member,
        props: projectAdminProps(PlanType.Growth),
        miscDataProps: { email: email },
      });
    }

    async function membershipsInProject(): Promise<number> {
      return await count("TeamMember");
    }

    /*
     * A first sign-in through the project's SSO: hooks skipped, as SSO.ts
     * does, in the project its sign-in address names - by `namedAs`, when
     * the address spells the id another way - onto the provider's team
     * (`toTeamId`, the first team by default).
     */
    async function joinThroughSso(
      userId: ObjectID,
      namedAs?: ObjectID | undefined,
      toTeamId?: ObjectID | undefined,
    ): Promise<TeamMember> {
      const member: TeamMember = new TeamMember();
      member.projectId = namedAs || projectId;
      member.teamId = toTeamId || teamId;
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

    test("with one seat left, people already in the project all join another team at the same moment, and only one newcomer gets the seat", async () => {
      await insertProject({ plan: "growth", seatLimit: 7 });
      await insertTeam();
      const people: Array<ObjectID> = await insertPeople(6);
      const newcomers: Array<ObjectID> = [];
      for (let index: number = 0; index < 6; index++) {
        newcomers.push(await newPerson(index));
      }

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: TeamMemberService,
        create: (index: number) => {
          // Even: someone in the project, to the second team. Odd: someone new.
          return index % 2 === 0
            ? invite(people[index / 2]!, PlanType.Growth, secondTeamId)
            : invite(newcomers[(index - 1) / 2]!, PlanType.Growth);
        },
      });

      expect(outcome.created).toBe(7);
      expect(outcome.refusals).toEqual(
        Array.from({ length: 5 }, () => {
          return Errors.TeamMemberService.LIMIT_REACHED;
        }),
      );
      expect(await peopleInProject()).toBe(7);
      expect(await membershipsInProject()).toBe(13);
      expect(
        await count(
          "TeamMember",
          `AND "teamId" = '${secondTeamId.toString()}'`,
        ),
      ).toBe(6);
    }, 120000);

    test("at the limit, people already in the project join another team and every newcomer is refused before anything is prepared", async () => {
      await insertProject({ plan: "growth", seatLimit: 6 });
      await insertTeam();
      const people: Array<ObjectID> = await insertPeople(6);
      const newcomers: Array<ObjectID> = [];
      for (let index: number = 0; index < 6; index++) {
        newcomers.push(await newPerson(index));
      }

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        create: (index: number) => {
          return index % 2 === 0
            ? invite(people[index / 2]!, PlanType.Growth, secondTeamId)
            : invite(newcomers[(index - 1) / 2]!, PlanType.Growth);
        },
      });

      expect(outcome.created).toBe(6);
      expect(outcome.refusals).toEqual(
        Array.from({ length: 6 }, () => {
          return Errors.TeamMemberService.LIMIT_REACHED;
        }),
      );
      expect(await peopleInProject()).toBe(6);
      expect(await membershipsInProject()).toBe(12);
    }, 120000);

    test("someone new added to two teams at the same moment, with one seat left, takes that one seat on both", async () => {
      await insertProject({ plan: "growth", seatLimit: 3 });
      await insertTeam();
      await insertPeople(2);
      const newcomer: ObjectID = await newPerson(0);

      const outcome: Outcome = await createAtOnce({
        count: 2,
        holdAt: TeamMemberService,
        create: (index: number) => {
          return invite(
            newcomer,
            PlanType.Growth,
            index === 0 ? teamId : secondTeamId,
          );
        },
      });

      expect(outcome).toEqual({ created: 2, refusals: [] });
      expect(await peopleInProject()).toBe(3);
      expect(await membershipsInProject()).toBe(4);
    }, 120000);

    test("people are counted, not memberships: with everyone on two teams and one seat left, exactly one of twelve is added", async () => {
      await insertProject({ plan: "growth", seatLimit: 4 });
      await insertTeam();
      await insertPeople(3, { onBothTeams: true });
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
      expect(await peopleInProject()).toBe(4);
    }, 120000);

    test("invitations by email to people with no account yet, at the same moment, with one seat left: exactly one is added", async () => {
      await insertProject({ plan: "growth", seatLimit: 3 });
      await insertTeam();
      await insertPeople(2);

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        create: (index: number) => {
          return inviteByEmail(
            `newcomer-${index}-${projectId.toString()}@example.com`,
          );
        },
      });

      expectOutcome(outcome, {
        created: 1,
        refusal: Errors.TeamMemberService.LIMIT_REACHED,
      });
      expect(await peopleInProject()).toBe(3);
    }, 120000);

    test("invitations and first SSO sign-ins at the same moment share the seats left: exactly two are added", async () => {
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
          return index % 2 === 0
            ? invite(people[index]!, PlanType.Growth)
            : joinThroughSso(people[index]!);
        },
      });

      expectOutcome(outcome, {
        created: 2,
        refusal: Errors.TeamMemberService.LIMIT_REACHED,
      });
      expect(await peopleInProject()).toBe(4);
    }, 120000);

    test("the Free plan's one person is its owner: every invitation is refused, and the owner joins another team", async () => {
      await insertProject({ plan: "free" });
      await insertTeam();
      await insertPeople(1);
      const people: Array<ObjectID> = [];
      for (let index: number = 0; index < RACING_CREATES - 1; index++) {
        people.push(await newPerson(index));
      }

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        create: (index: number) => {
          return index === 0
            ? invite(adminId, PlanType.Free, secondTeamId)
            : invite(people[index - 1]!, PlanType.Free);
        },
      });

      expectOutcome(outcome, {
        created: 1,
        refusal: Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
      });
      expect(await peopleInProject()).toBe(1);
      expect(await membershipsInProject()).toBe(2);
    }, 120000);

    test("a Free plan project with nobody in it yet: of twelve invitations that all passed the early count, exactly one is added", async () => {
      await insertProject({ plan: "free" });
      await insertTeam();
      const people: Array<ObjectID> = [];
      for (let index: number = 0; index < RACING_CREATES; index++) {
        people.push(await newPerson(index));
      }

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: TeamMemberService,
        create: (index: number) => {
          return invite(people[index]!, PlanType.Free);
        },
      });

      expectOutcome(outcome, {
        created: 1,
        refusal: Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
      });
      expect(await peopleInProject()).toBe(1);
    }, 120000);

    /*
     * A server admin adds someone from the Admin Dashboard: no tenant, no
     * plan on the request (a server admin is held to no plan), the project
     * named on the membership.
     */
    async function serverAdminAdds(userId: ObjectID): Promise<TeamMember> {
      const member: TeamMember = new TeamMember();
      member.projectId = projectId;
      member.teamId = teamId;
      member.userId = userId;

      return await TeamMemberService.create({
        data: member,
        props: {
          isMasterAdmin: true,
          userId: ObjectID.generate(),
        } as DatabaseCommonInteractionProps,
      });
    }

    test("the Free plan's one person holds first SSO sign-ins too: its owner joins another team, and nobody new joins", async () => {
      await insertProject({ plan: "free" });
      await insertTeam();
      await insertPeople(1);
      const people: Array<ObjectID> = [];
      for (let index: number = 0; index < RACING_CREATES - 1; index++) {
        people.push(await newPerson(index));
      }

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        create: (index: number) => {
          return index === 0
            ? joinThroughSso(adminId, undefined, secondTeamId)
            : joinThroughSso(people[index - 1]!);
        },
      });

      expectOutcome(outcome, {
        created: 1,
        refusal: Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
      });
      expect(await peopleInProject()).toBe(1);
      expect(await membershipsInProject()).toBe(2);
    }, 120000);

    test("a Free plan project with nobody in it yet: of twelve first SSO sign-ins at the same moment, exactly one joins", async () => {
      await insertProject({ plan: "free" });
      await insertTeam();
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
        refusal: Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
      });
      expect(await peopleInProject()).toBe(1);
    }, 120000);

    test("first SSO sign-ins in a Free plan project, each naming the project by another spelling of its id, add its one person only", async () => {
      projectId = generateIdWithLetters();
      await insertProject({ plan: "free" });
      await insertTeam();
      const spellings: Array<ObjectID> = spellingsOf(projectId);
      const people: Array<ObjectID> = [];
      for (let index: number = 0; index < RACING_CREATES; index++) {
        people.push(await newPerson(index));
      }

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        create: (index: number) => {
          return joinThroughSso(people[index]!, spellings[index]);
        },
      });

      expectOutcome(outcome, {
        created: 1,
        refusal: Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
      });
      expect(await peopleInProject()).toBe(1);
    }, 120000);

    test("a server admin is held to no plan: they add people to a Free plan project that has its one person", async () => {
      await insertProject({ plan: "free" });
      await insertTeam();
      await insertPeople(1);

      for (let index: number = 0; index < 3; index++) {
        await serverAdminAdds(await newPerson(index));
      }

      expect(await peopleInProject()).toBe(4);
    }, 120000);

    test("a server admin is still held to a plan's seats", async () => {
      await insertProject({ plan: "growth", seatLimit: 2 });
      await insertTeam();
      await insertPeople(2);

      await expect(serverAdminAdds(await newPerson(0))).rejects.toThrow(
        new BadDataException(Errors.TeamMemberService.LIMIT_REACHED),
      );
      expect(await peopleInProject()).toBe(2);
    }, 120000);

    test("a plan's seat limit with room for one: of twelve invitations that each name the project by another spelling of its id, exactly one is added", async () => {
      projectId = generateIdWithLetters();
      await insertProject({ plan: "growth", seatLimit: 3 });
      await insertTeam();
      await insertPeople(2);
      const spellings: Array<ObjectID> = spellingsOf(projectId);
      const people: Array<ObjectID> = [];
      for (let index: number = 0; index < RACING_CREATES; index++) {
        people.push(await newPerson(index));
      }

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        holdAt: TeamMemberService,
        create: (index: number) => {
          return invite(
            people[index]!,
            PlanType.Growth,
            undefined,
            spellings[index],
          );
        },
      });

      expectOutcome(outcome, {
        created: 1,
        refusal: Errors.TeamMemberService.LIMIT_REACHED,
      });
      expect(await peopleInProject()).toBe(3);
    }, 120000);

    test("first SSO sign-ins whose addresses each spell the project's id another way share the seats left: exactly two are added", async () => {
      projectId = generateIdWithLetters();
      await insertProject({ plan: "growth", seatLimit: 4 });
      await insertTeam();
      await insertPeople(2);
      const spellings: Array<ObjectID> = spellingsOf(projectId);
      const people: Array<ObjectID> = [];
      for (let index: number = 0; index < RACING_CREATES; index++) {
        people.push(await newPerson(index));
      }

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        create: (index: number) => {
          return joinThroughSso(people[index]!, spellings[index]);
        },
      });

      expectOutcome(outcome, {
        created: 2,
        refusal: Errors.TeamMemberService.LIMIT_REACHED,
      });
      expect(await peopleInProject()).toBe(4);
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
