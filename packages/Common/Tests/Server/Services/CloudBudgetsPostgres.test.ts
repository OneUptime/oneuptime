import Entities from "../../../Models/DatabaseModels/Index";
import CloudBudget from "../../../Models/DatabaseModels/CloudBudget";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import { OwnerNotificationDelivery } from "../../../Server/Utils/Notification/OwnerNotificationDeliveries";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import { CLOUD_BUDGET_ACCOUNT_SCOPE_UPDATE } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187771008-AddCloudBudgetScopesPeriodsAndPlans";
import CloudBudgetService, {
  CLOUD_BUDGET_ACCOUNT_ERROR,
  CLOUD_BUDGET_COST_GROUP_ERROR,
  CLOUD_BUDGET_FILTER_ERROR,
  CLOUD_BUDGET_FISCAL_YEAR_ERROR,
  CLOUD_BUDGET_MONTHLY_PLAN_ERROR,
  CLOUD_BUDGET_SCOPE_ERROR,
} from "../../../Server/Services/CloudBudgetService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import CloudBudgetNotices, {
  CloudBudgetNoticeFacts,
} from "../../../Server/Utils/CloudCost/CloudBudgetNotices";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CloudBudgetPeriod,
  CloudBudgetPlanSplit,
  CloudBudgetScope,
} from "../../../Types/Cloud/CloudBudget";
import {
  CloudCostRule,
  CloudCostRuleField,
  CloudCostRuleOperator,
} from "../../../Types/Cloud/CloudCostRules";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import { usersNamedBy } from "../../Helpers/InMemoryOwnerNotificationDeliveries";
import Name from "../../../Types/Name";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * CLOUD BUDGETS (#11008) EXECUTED ON POSTGRES. The ClickHouse suite reads a
 * budget's costs with Postgres' reads stood in for; only a real database
 * shows what the service, the migration and the notices do to real rows:
 *
 *   - a budget's scope has what it needs and nothing another scope needs,
 *     inferred as before scopes when a script names only an account; its
 *     filter reads as a cost group's rules and names only the project's
 *     records, as do its account, its cost group, its teams and people;
 *   - a month or a quarter is never split; a year typed by month has its
 *     twelve amounts, whose total is the budget's amount; an update keeps
 *     what it does not send and checks the whole as it will be stored;
 *   - a budget made before scopes and periods reads as it always did: the
 *     migration's defaults, and its update making an account's budget one;
 *   - the people a notice tells - those named, their teams' members who
 *     accepted, each once - planned once per threshold, told once, a
 *     stopped run's untold people told when it resumes, each given a
 *     setting that starts on by email and on the chat they have alerts on.
 *
 * Opt in with RUN_POSTGRES_CLOUD_BUDGET_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The STRUCTURE of every table the
 * service, the notices and the reference checks read or write is cloned into
 * a unique schema (search_path holds only that schema), dropped afterwards.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * CLOUD_BUDGET_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * CLOUD_BUDGET_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CLOUD_BUDGET_TESTS"] === "true"
    ? describe
    : describe.skip;

// The tables the services write, cloned whole.
const SERVICE_TABLES: Array<string> = [
  "CloudBudget",
  "CloudBudgetNotifyUser",
  "CloudBudgetNotifyTeam",
  "CloudBudgetOnCallDutyPolicy",
  "OwnerNotificationDelivery",
  "UserNotificationSetting",
];

/*
 * The tables they read, filled here by hand: every NOT NULL but the keys
 * is relaxed, so a fixture row names only what the test is about.
 */
const FIXTURE_TABLES: Array<string> = [
  "Project",
  "User",
  "Team",
  "TeamMember",
  "Label",
  "CloudAccount",
  "CloudCostView",
  "CloudCostGroup",
  "OnCallDutyPolicy",
  "AlertSeverity",
  "CloudCostSetting",
];

const KEPT_NOT_NULL: Array<string> = ["_id", "createdAt", "updatedAt"];

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const ADMIN_ID: ObjectID = ObjectID.generate();

const ACCOUNT: string = ObjectID.generate().toString();
const OTHER_ACCOUNT: string = ObjectID.generate().toString();
const VIEW: string = ObjectID.generate().toString();
const GROUP: string = ObjectID.generate().toString();
const OTHER_GROUP: string = ObjectID.generate().toString();
const PAYMENTS_TEAM: string = ObjectID.generate().toString();
const OTHER_TEAM: string = ObjectID.generate().toString();
const POLICY: string = ObjectID.generate().toString();
const FINANCE: string = ObjectID.generate().toString();
const PENDING: string = ObjectID.generate().toString();
const ANALYST: string = ObjectID.generate().toString();
const OUTSIDER: string = ObjectID.generate().toString();

function memberProps(
  permissions: Array<Permission>,
  projectId: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    tenantId: projectId,
    userId: ADMIN_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

const ADMIN: DatabaseCommonInteractionProps = memberProps([
  Permission.ProjectAdmin,
]);

function rule(
  field: CloudCostRuleField,
  values: Array<string>,
  key?: string,
): CloudCostRule {
  return {
    conditions: [
      {
        field,
        operator: CloudCostRuleOperator.Is,
        values,
        ...(key ? { key } : {}),
      },
    ],
  };
}

function person(id: string): User {
  const made: User = new User(new ObjectID(id));
  made.name = new Name("A person");
  made.email = new Email(`${id}@acme.test`);
  return made;
}

describePostgres("Cloud budgets against Postgres", () => {
  const schema: string = `cloud_budgets_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  let sent: Array<{ userId: string; eventType: string }> = [];

  async function insert(
    table: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    const columns: Array<string> = Object.keys(row);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        return row[column];
      }),
    );
  }

  async function stored(id: ObjectID): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT * FROM "${schema}"."CloudBudget" WHERE "_id" = $1`,
      [id.toString()],
    );
    return rows[0]!;
  }

  async function create(data: Record<string, unknown>): Promise<CloudBudget> {
    const budget: CloudBudget = new CloudBudget();
    budget.projectId = PROJECT_ID;
    budget.name = "A budget";
    budget.monthlyAmount = 1000;
    budget.currency = "USD";
    Object.assign(budget, data);

    return CloudBudgetService.create({ data: budget, props: ADMIN });
  }

  async function refused(data: Record<string, unknown>): Promise<string> {
    try {
      await create(data);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }

    throw new Error("The budget was saved.");
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["CLOUD_BUDGET_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["CLOUD_BUDGET_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["CLOUD_BUDGET_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of [...SERVICE_TABLES, ...FIXTURE_TABLES]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    for (const table of FIXTURE_TABLES) {
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO'`,
        [schema, table],
      );

      for (const column of columns) {
        if (!KEPT_NOT_NULL.includes(column.column_name)) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
          );
        }
      }
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const service of [
      CloudBudgetService,
      UserNotificationSettingService,
    ] as Array<DatabaseService<any>>) {
      jest.spyOn(service, "onTriggerRealtime").mockResolvedValue();
      jest.spyOn(service, "onTriggerWorkflow").mockResolvedValue();
    }

    // A saved budget is checked against its costs right after: not here.
    jest
      .spyOn(
        CloudBudgetService as unknown as { evaluateSoon: () => void },
        "evaluateSoon",
      )
      .mockImplementation(() => {});

    for (const project of [PROJECT_ID, OTHER_PROJECT_ID]) {
      await insert("Project", { _id: project.toString(), name: "Acme" });
    }

    for (const id of [
      ADMIN_ID.toString(),
      FINANCE,
      PENDING,
      ANALYST,
      OUTSIDER,
    ]) {
      await insert("User", { _id: id, email: `${id}@acme.test`, name: "A" });
    }

    await insert("Team", {
      _id: PAYMENTS_TEAM,
      projectId: PROJECT_ID.toString(),
      name: "Payments",
    });
    await insert("Team", {
      _id: OTHER_TEAM,
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Elsewhere",
    });

    // Finance and the admin are members; Pending has not accepted yet.
    for (const member of [
      { team: PAYMENTS_TEAM, user: FINANCE, accepted: true },
      { team: PAYMENTS_TEAM, user: ADMIN_ID.toString(), accepted: true },
      { team: PAYMENTS_TEAM, user: PENDING, accepted: false },
      { team: PAYMENTS_TEAM, user: ANALYST, accepted: true },
    ]) {
      await insert("TeamMember", {
        _id: ObjectID.generate().toString(),
        projectId: PROJECT_ID.toString(),
        teamId: member.team,
        userId: member.user,
        hasAcceptedInvitation: member.accepted,
      });
    }

    await insert("TeamMember", {
      _id: ObjectID.generate().toString(),
      projectId: OTHER_PROJECT_ID.toString(),
      teamId: OTHER_TEAM,
      userId: OUTSIDER,
      hasAcceptedInvitation: true,
    });

    await insert("CloudAccount", {
      _id: ACCOUNT,
      projectId: PROJECT_ID.toString(),
      name: "web-prod",
    });
    await insert("CloudAccount", {
      _id: OTHER_ACCOUNT,
      projectId: OTHER_PROJECT_ID.toString(),
      name: "elsewhere",
    });
    await insert("CloudCostView", {
      _id: VIEW,
      projectId: PROJECT_ID.toString(),
      name: "By team",
    });
    await insert("CloudCostGroup", {
      _id: GROUP,
      projectId: PROJECT_ID.toString(),
      cloudCostViewId: VIEW,
      name: "Payments",
      teamId: PAYMENTS_TEAM,
    });
    await insert("CloudCostGroup", {
      _id: OTHER_GROUP,
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Elsewhere",
    });
    await insert("OnCallDutyPolicy", {
      _id: POLICY,
      projectId: PROJECT_ID.toString(),
      name: "Finance on-call",
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    sent = [];
    await database.query(`DELETE FROM "${schema}"."OwnerNotificationDelivery"`);
    await database.query(`DELETE FROM "${schema}"."UserNotificationSetting"`);

    jest.spyOn(logger, "warn").mockImplementation((() => {
      // quiet
    }) as never);
    // The people a delivery tells, as the directory names them.
    jest.spyOn(UserService, "findBy").mockImplementation((async (data: {
      query: JSONObject;
    }) => {
      return usersNamedBy(
        [FINANCE, ANALYST, PENDING, OUTSIDER, ADMIN_ID.toString()].map(person),
        data.query,
      );
    }) as never);
    jest
      .spyOn(UserNotificationSettingService, "sendUserNotification")
      .mockImplementation((async (data: {
        userId: ObjectID;
        eventType: NotificationSettingEventType;
      }) => {
        sent.push({
          userId: data.userId.toString(),
          eventType: data.eventType,
        });
      }) as never);
  });

  describe("what a budget counts", () => {
    test("a budget that names nothing counts every account for a month, as every budget made before scopes did", async () => {
      const made: CloudBudget = await create({ currency: "usd" });
      const row: Record<string, unknown> = await stored(made.id!);

      expect(row).toMatchObject({
        scope: CloudBudgetScope.AllAccounts,
        period: CloudBudgetPeriod.Month,
        planSplit: CloudBudgetPlanSplit.None,
        fiscalYearStartMonth: 1,
        currency: "USD",
        alertThresholds: "80,100",
        notifyCostGroupTeam: true,
        cloudAccountId: null,
        cloudCostGroupId: null,
        filterRules: null,
      });
    });

    test("a script that names an account and no scope makes that account's budget, as before scopes", async () => {
      const made: CloudBudget = await create({
        cloudAccountId: new ObjectID(ACCOUNT),
      });

      expect(await stored(made.id!)).toMatchObject({
        scope: CloudBudgetScope.Account,
        cloudAccountId: ACCOUNT,
      });
    });

    test("each scope has what it needs: an account, a cost group, a filter with a condition", async () => {
      expect(await refused({ scope: CloudBudgetScope.Account })).toBe(
        CLOUD_BUDGET_ACCOUNT_ERROR,
      );
      expect(await refused({ scope: CloudBudgetScope.CostGroup })).toBe(
        CLOUD_BUDGET_COST_GROUP_ERROR,
      );
      expect(
        await refused({ scope: CloudBudgetScope.Filter, filterRules: [] }),
      ).toBe(CLOUD_BUDGET_FILTER_ERROR);
      // A rule with nothing in it is refused with what to fix, as a group's is.
      expect(
        await refused({
          scope: CloudBudgetScope.Filter,
          filterRules: [{ conditions: [] }],
        }),
      ).toBe("Rule 1 has no conditions. Add a condition, or remove the rule.");
      expect(await refused({ scope: "weekly" })).toBe(CLOUD_BUDGET_SCOPE_ERROR);
    });

    test("and nothing another scope needs: a cost group's budget keeps no account", async () => {
      const made: CloudBudget = await create({
        scope: CloudBudgetScope.CostGroup,
        cloudCostGroupId: new ObjectID(GROUP),
        cloudAccountId: new ObjectID(ACCOUNT),
        filterRules: [rule(CloudCostRuleField.Service, ["Amazon EC2"])],
      });

      expect(await stored(made.id!)).toMatchObject({
        scope: CloudBudgetScope.CostGroup,
        cloudCostGroupId: GROUP,
        cloudAccountId: null,
        filterRules: null,
      });
    });

    test("a filter reads as a cost group's rules, and names only the project's records", async () => {
      const ec2: CloudBudget = await create({
        scope: CloudBudgetScope.Filter,
        filterRules: [
          {
            conditions: [
              {
                field: CloudCostRuleField.Service,
                operator: CloudCostRuleOperator.Is,
                values: ["Amazon EC2"],
              },
              {
                field: CloudCostRuleField.Region,
                operator: CloudCostRuleOperator.Is,
                values: ["us-east-1"],
              },
            ],
          },
        ],
      });

      expect((await stored(ec2.id!))["filterRules"]).toEqual([
        {
          conditions: [
            {
              field: CloudCostRuleField.Service,
              operator: CloudCostRuleOperator.Is,
              values: ["Amazon EC2"],
            },
            {
              field: CloudCostRuleField.Region,
              operator: CloudCostRuleOperator.Is,
              values: ["us-east-1"],
            },
          ],
        },
      ]);

      // Another project's team and account are never named.
      await expect(
        create({
          scope: CloudBudgetScope.Filter,
          filterRules: [rule(CloudCostRuleField.OwnerTeam, [OTHER_TEAM])],
        }),
      ).rejects.toThrow();
      await expect(
        create({
          scope: CloudBudgetScope.Filter,
          filterRules: [rule(CloudCostRuleField.Account, [OTHER_ACCOUNT])],
        }),
      ).rejects.toThrow();

      // The project's own team is.
      const owned: CloudBudget = await create({
        scope: CloudBudgetScope.Filter,
        filterRules: [rule(CloudCostRuleField.OwnerTeam, [PAYMENTS_TEAM])],
      });
      expect((await stored(owned.id!))["scope"]).toBe(CloudBudgetScope.Filter);
    });

    test("another project's account, cost group, team or person is never named", async () => {
      await expect(
        create({
          scope: CloudBudgetScope.Account,
          cloudAccountId: new ObjectID(OTHER_ACCOUNT),
        }),
      ).rejects.toThrow();
      await expect(
        create({
          scope: CloudBudgetScope.CostGroup,
          cloudCostGroupId: new ObjectID(OTHER_GROUP),
        }),
      ).rejects.toThrow();

      const team: Team = new Team();
      team.id = new ObjectID(OTHER_TEAM);
      await expect(create({ notifyTeams: [team] })).rejects.toThrow();

      await expect(
        create({ notifyUsers: [person(OUTSIDER)] }),
      ).rejects.toThrow();
    });

    test("the people and teams it tells, and the on-call policies it pages, are kept", async () => {
      const team: Team = new Team();
      team.id = new ObjectID(PAYMENTS_TEAM);
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy.id = new ObjectID(POLICY);

      const made: CloudBudget = await create({
        notifyUsers: [person(FINANCE)],
        notifyTeams: [team],
        onCallDutyPolicies: [policy],
      });

      expect(
        await database.query(
          `SELECT "userId" FROM "${schema}"."CloudBudgetNotifyUser" WHERE "cloudBudgetId" = $1`,
          [made.id!.toString()],
        ),
      ).toEqual([{ userId: FINANCE }]);
      expect(
        await database.query(
          `SELECT "teamId" FROM "${schema}"."CloudBudgetNotifyTeam" WHERE "cloudBudgetId" = $1`,
          [made.id!.toString()],
        ),
      ).toEqual([{ teamId: PAYMENTS_TEAM }]);
      expect(
        await database.query(
          `SELECT "onCallDutyPolicyId" FROM "${schema}"."CloudBudgetOnCallDutyPolicy" WHERE "cloudBudgetId" = $1`,
          [made.id!.toString()],
        ),
      ).toEqual([{ onCallDutyPolicyId: POLICY }]);
    });
  });

  describe("how long and how it is spread", () => {
    test("a month or a quarter is never split, whatever is sent", async () => {
      const made: CloudBudget = await create({
        period: CloudBudgetPeriod.Quarter,
        fiscalYearStartMonth: 4,
        planSplit: CloudBudgetPlanSplit.ByMonth,
        monthlyPlan: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      });

      expect(await stored(made.id!)).toMatchObject({
        period: CloudBudgetPeriod.Quarter,
        fiscalYearStartMonth: 4,
        planSplit: CloudBudgetPlanSplit.None,
      });
    });

    test("a year typed by month has its twelve amounts, and their total is the budget's amount", async () => {
      const plan: Array<number> = [
        800, 800, 900, 900, 900, 1000, 1000, 1100, 1200, 1600, 900, 0,
      ];
      const made: CloudBudget = await create({
        period: CloudBudgetPeriod.Year,
        fiscalYearStartMonth: 4,
        planSplit: CloudBudgetPlanSplit.ByMonth,
        monthlyPlan: plan,
        monthlyAmount: 1,
      });
      const row: Record<string, unknown> = await stored(made.id!);

      expect(row["monthlyPlan"]).toEqual(plan);
      expect(Number(row["monthlyAmount"])).toBe(11100);

      expect(
        await refused({
          period: CloudBudgetPeriod.Year,
          planSplit: CloudBudgetPlanSplit.ByMonth,
          monthlyPlan: [100, 100, 100],
        }),
      ).toBe(CLOUD_BUDGET_MONTHLY_PLAN_ERROR);
      expect(
        await refused({
          period: CloudBudgetPeriod.Year,
          planSplit: CloudBudgetPlanSplit.ByMonth,
          monthlyPlan: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }),
      ).toBe(CLOUD_BUDGET_MONTHLY_PLAN_ERROR);
    });

    test("the fiscal year's first month is a month", async () => {
      expect(
        await refused({
          period: CloudBudgetPeriod.Year,
          fiscalYearStartMonth: 13,
        }),
      ).toBe(CLOUD_BUDGET_FISCAL_YEAR_ERROR);
    });

    test("an update keeps what it does not send, and checks the whole as it will be stored", async () => {
      const made: CloudBudget = await create({
        scope: CloudBudgetScope.Filter,
        filterRules: [rule(CloudCostRuleField.Service, ["Amazon S3"])],
        period: CloudBudgetPeriod.Year,
        fiscalYearStartMonth: 4,
        planSplit: CloudBudgetPlanSplit.ByMonth,
        monthlyPlan: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5],
      });

      // A new name leaves the rest as it is.
      await CloudBudgetService.updateOneById({
        id: made.id!,
        data: { name: "Storage" },
        props: ADMIN,
      });
      expect(await stored(made.id!)).toMatchObject({
        name: "Storage",
        scope: CloudBudgetScope.Filter,
        planSplit: CloudBudgetPlanSplit.ByMonth,
      });

      // A quarter is never split: the months typed are kept for later.
      await CloudBudgetService.updateOneById({
        id: made.id!,
        data: { period: CloudBudgetPeriod.Quarter } as never,
        props: ADMIN,
      });
      expect(await stored(made.id!)).toMatchObject({
        period: CloudBudgetPeriod.Quarter,
        planSplit: CloudBudgetPlanSplit.None,
        monthlyPlan: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5],
      });

      // An account's budget needs its account, whatever else is stored.
      await expect(
        CloudBudgetService.updateOneById({
          id: made.id!,
          data: { scope: CloudBudgetScope.Account } as never,
          props: ADMIN,
        }),
      ).rejects.toThrow(CLOUD_BUDGET_ACCOUNT_ERROR);

      // An account sent to a budget of every account makes it that account's.
      const every: CloudBudget = await create({});
      await CloudBudgetService.updateOneById({
        id: every.id!,
        data: { cloudAccountId: new ObjectID(ACCOUNT) } as never,
        props: ADMIN,
      });
      expect(await stored(every.id!)).toMatchObject({
        scope: CloudBudgetScope.Account,
        cloudAccountId: ACCOUNT,
      });
    });
  });

  describe("budgets made before scopes and periods", () => {
    test("read as they always did: a month, unsplit, and an account's budget once the migration's update has run", async () => {
      const withAccount: string = ObjectID.generate().toString();
      const withoutAccount: string = ObjectID.generate().toString();

      // Written with the columns a budget had before.
      for (const row of [
        { id: withAccount, account: ACCOUNT },
        { id: withoutAccount, account: null },
      ]) {
        await insert("CloudBudget", {
          _id: row.id,
          projectId: PROJECT_ID.toString(),
          name: "Old",
          isEnabled: true,
          cloudAccountId: row.account,
          monthlyAmount: 500,
          currency: "USD",
          alertThresholds: "80,100",
          alertOnProjection: true,
          alertOnAnomaly: false,
          version: 1,
        });
      }

      await database.query(CLOUD_BUDGET_ACCOUNT_SCOPE_UPDATE);

      const rows: Array<Record<string, unknown>> = await database.query(
        `SELECT "_id", "scope", "period", "planSplit", "fiscalYearStartMonth", "notifyCostGroupTeam", "monthlyPlan" FROM "${schema}"."CloudBudget" WHERE "_id" IN ($1, $2) ORDER BY "name", "_id"`,
        [withAccount, withoutAccount],
      );
      const byId: Record<string, Record<string, unknown>> = {};

      for (const row of rows) {
        byId[String(row["_id"])] = row;
      }

      expect(byId[withAccount]).toMatchObject({
        scope: CloudBudgetScope.Account,
        period: CloudBudgetPeriod.Month,
        planSplit: CloudBudgetPlanSplit.None,
        fiscalYearStartMonth: 1,
        notifyCostGroupTeam: true,
        monthlyPlan: null,
      });
      expect(byId[withoutAccount]).toMatchObject({
        scope: CloudBudgetScope.AllAccounts,
        period: CloudBudgetPeriod.Month,
      });
    });
  });

  describe("who a budget tells below 100%", () => {
    function facts(
      budgetId: ObjectID,
      threshold: number,
    ): CloudBudgetNoticeFacts {
      return {
        budgetId,
        projectId: PROJECT_ID,
        budgetName: "Payments",
        projectName: "Acme",
        threshold,
        title: `Cloud budget "Payments" passed ${threshold}%`,
        description:
          "This quarter's spend for the Payments cost group is $990 of $1,200 (83%).",
        budgetLink: "https://oneuptime.example/budget",
      };
    }

    test("those it names and its teams' members who accepted, each once", async () => {
      const people: Array<User> = await CloudBudgetNotices.getPeople({
        projectId: PROJECT_ID,
        userIds: [new ObjectID(FINANCE)],
        teamIds: [new ObjectID(PAYMENTS_TEAM)],
      });

      expect(
        people
          .map((user: User): string => {
            return user.id!.toString();
          })
          .sort(),
      ).toEqual([ADMIN_ID.toString(), ANALYST, FINANCE].sort());
    });

    test("a threshold is planned once, told once, each person given a setting that starts on by email", async () => {
      const budgetId: ObjectID = ObjectID.generate();
      const people: Array<User> = [person(FINANCE), person(ANALYST)];
      const plan: () => Promise<OwnerNotificationDelivery> = async () => {
        return CloudBudgetNotices.plan({
          projectId: PROJECT_ID,
          budgetId,
          windowKey: "2026-10/3",
          threshold: 80,
          people,
        });
      };

      const first: OwnerNotificationDelivery = await plan();
      // Planned again by another run: the same rows, not twice as many.
      await plan();

      const rows: Array<{ count: string }> = await database.query(
        `SELECT count(*) AS count FROM "${schema}"."OwnerNotificationDelivery" WHERE "eventId" = $1`,
        [budgetId.toString()],
      );
      expect(Number(rows[0]!.count)).toBe(2);

      expect(
        await CloudBudgetNotices.tell({
          delivery: first,
          facts: facts(budgetId, 80),
        }),
      ).toBe(2);
      expect(
        sent
          .map((entry: { userId: string }): string => {
            return entry.userId;
          })
          .sort(),
      ).toEqual([ANALYST, FINANCE].sort());
      expect(
        new Set(
          sent.map((entry: { eventType: string }): string => {
            return entry.eventType;
          }),
        ),
      ).toEqual(
        new Set([
          NotificationSettingEventType.SEND_CLOUD_BUDGET_THRESHOLD_NOTIFICATION,
        ]),
      );

      // Planned and told again: nobody is told twice.
      sent = [];
      expect(
        await CloudBudgetNotices.tell({
          delivery: await plan(),
          facts: facts(budgetId, 80),
        }),
      ).toBe(0);
      expect(sent).toEqual([]);

      // Each has a setting now, on by email.
      const settings: Array<Record<string, unknown>> = await database.query(
        `SELECT "userId", "alertByEmail" FROM "${schema}"."UserNotificationSetting" WHERE "eventType" = $1 ORDER BY "userId"`,
        [NotificationSettingEventType.SEND_CLOUD_BUDGET_THRESHOLD_NOTIFICATION],
      );
      expect(settings).toEqual(
        [FINANCE, ANALYST].sort().map((userId: string) => {
          return { userId, alertByEmail: true };
        }),
      );
    });

    test("a stopped run's untold people are told when it resumes; a budget gone is given up", async () => {
      const budgetId: ObjectID = ObjectID.generate();
      const goneId: ObjectID = ObjectID.generate();

      await CloudBudgetNotices.plan({
        projectId: PROJECT_ID,
        budgetId,
        windowKey: "2026-11/1",
        threshold: 90,
        people: [person(FINANCE)],
      });
      await CloudBudgetNotices.plan({
        projectId: PROJECT_ID,
        budgetId: goneId,
        windowKey: "2026-11/1",
        threshold: 80,
        people: [person(ANALYST)],
      });

      // The run that planned them stopped a day ago, before it told anyone.
      await database.query(
        `UPDATE "${schema}"."OwnerNotificationDelivery" SET "attemptedAt" = now() - interval '1 day' WHERE "eventId" IN ($1, $2)`,
        [budgetId.toString(), goneId.toString()],
      );

      const asked: Array<{ budgetId: string; threshold: number }> = [];

      await CloudBudgetNotices.resume({
        readFacts: async (data: { budgetId: ObjectID; threshold: number }) => {
          asked.push({
            budgetId: data.budgetId.toString(),
            threshold: data.threshold,
          });

          return data.budgetId.toString() === budgetId.toString()
            ? facts(budgetId, data.threshold)
            : null;
        },
      });

      // The occurrence keeps the threshold: 90 read back from it.
      expect(asked).toContainEqual({
        budgetId: budgetId.toString(),
        threshold: 90,
      });
      expect(
        sent.map((entry: { userId: string }): string => {
          return entry.userId;
        }),
      ).toEqual([FINANCE]);

      // The gone budget's delivery is given up, never told.
      const statuses: Array<{ eventId: string; status: string }> =
        await database.query(
          `SELECT "eventId", "status" FROM "${schema}"."OwnerNotificationDelivery" WHERE "eventId" IN ($1, $2)`,
          [budgetId.toString(), goneId.toString()],
        );
      expect(
        statuses.find((row: { eventId: string }): boolean => {
          return row.eventId === goneId.toString();
        })?.status,
      ).not.toBe("pending");
    });

    test("a setting of one's own starts on the chat accounts one has on for alerts, and is never touched again", async () => {
      await insert("UserNotificationSetting", {
        _id: ObjectID.generate().toString(),
        projectId: PROJECT_ID.toString(),
        userId: FINANCE,
        eventType:
          NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION,
        alertByEmail: true,
        alertBySlack: true,
        alertByMicrosoftTeams: false,
        alertBySMS: true,
        alertByCall: true,
        version: 1,
      });

      await UserNotificationSettingService.addCloudBudgetNotificationSettings(
        new ObjectID(FINANCE),
        PROJECT_ID,
      );
      await UserNotificationSettingService.addCloudBudgetNotificationSettings(
        new ObjectID(FINANCE),
        PROJECT_ID,
      );

      const rows: Array<Record<string, unknown>> = await database.query(
        `SELECT "alertByEmail", "alertBySlack", "alertByMicrosoftTeams", "alertBySMS", "alertByCall" FROM "${schema}"."UserNotificationSetting" WHERE "userId" = $1 AND "eventType" = $2`,
        [
          FINANCE,
          NotificationSettingEventType.SEND_CLOUD_BUDGET_THRESHOLD_NOTIFICATION,
        ],
      );

      // Never a text message or a call: a threshold below the budget pages nobody.
      expect(rows).toEqual([
        {
          alertByEmail: true,
          alertBySlack: true,
          alertByMicrosoftTeams: false,
          alertBySMS: false,
          alertByCall: false,
        },
      ]);
    });

    test("a member who joins now starts with it by email", async () => {
      await UserNotificationSettingService.addNewMemberCloudBudgetNotificationSettings(
        new ObjectID(ANALYST),
        PROJECT_ID,
      );

      const rows: Array<UserNotificationSetting> = await database.query(
        `SELECT "alertByEmail" FROM "${schema}"."UserNotificationSetting" WHERE "userId" = $1 AND "eventType" = $2`,
        [
          ANALYST,
          NotificationSettingEventType.SEND_CLOUD_BUDGET_THRESHOLD_NOTIFICATION,
        ],
      );

      expect(rows).toEqual([{ alertByEmail: true }]);
    });
  });
});
