import Entities from "../../../../Models/DatabaseModels/Index";
import ToolImportRecord from "../../../../Models/DatabaseModels/ToolImportRecord";
import ToolImportRun from "../../../../Models/DatabaseModels/ToolImportRun";
import { IsBillingEnabled } from "../../../../Server/EnvironmentConfig";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Queue from "../../../../Server/Infrastructure/Queue";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import MailService from "../../../../Server/Services/MailService";
import ProjectService from "../../../../Server/Services/ProjectService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import ToolImportRecordService from "../../../../Server/Services/ToolImportRecordService";
import ToolImportRunService from "../../../../Server/Services/ToolImportRunService";
import logger from "../../../../Server/Utils/Logger";
import ProductAnalytics from "../../../../Server/Utils/ProductAnalytics";
import { ToolImportTransport } from "../../../../Server/Utils/ToolImport/ToolImportHttpClient";
import ToolImportRunExecutor from "../../../../Server/Utils/ToolImport/ToolImportRunExecutor";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import {
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../Types/ToolImport/ToolImportNote";
import {
  ToolImportAction,
  ToolImportOutcome,
  ToolImportPlan,
  ToolImportPlanItem,
  ToolImportReport,
  ToolImportReportItem,
} from "../../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import ToolImportRunStatus from "../../../../Types/ToolImport/ToolImportRunStatus";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import { OPSGENIE_KEY, opsGenieApi } from "./OpsGenieFixtures";
import { FixtureApi } from "./ToolImportFixtureTransport";
import { DataSource } from "typeorm";

/*
 * AN IMPORT FROM ANOTHER TOOL, END TO END, AGAINST A REAL, MIGRATED DATABASE.
 *
 * The unit suites pin each decision with the database faked. What only a
 * database can show is that the whole life of an import holds when the real
 * services run the real queries: the key is stored encrypted and is gone
 * the moment the read ends; the preview and the import are worked out from
 * what the project really has; every record is created through OneUptime's
 * own services as the person who started it - their permissions, and their
 * project's plan when billing is on - and remembered with the tool's id;
 * running it again, even sending the same items again, creates nothing
 * twice; someone who left the project before the worker ran creates
 * nothing; and the database itself never holds two records of one item of
 * the other tool.
 *
 * The other tool is the Opsgenie fixture account (OpsGenieFixtures): no
 * test reaches a real tool. What lives in Redis (locks, the job queue, the
 * permission cache), the project's plan and outgoing mail are stood in for;
 * everything else is real.
 *
 * Opt in with RUN_POSTGRES_TOOL_IMPORT_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check, which runs this suite with billing
 * off and again with BILLING_ENABLED=true. Every table's STRUCTURE is cloned
 * into a unique schema (its search_path holds that schema first) that is
 * dropped afterwards, so nothing lands in the database's own tables; every
 * row is synthetic. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from TOOL_IMPORT_TEST_DATABASE_NAME or DATABASE_NAME, endpoint
 * from TOOL_IMPORT_TEST_DATABASE_HOST / _PORT (default localhost:5400,
 * Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_TOOL_IMPORT_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_ID: ObjectID = new ObjectID(
  "71111111-1111-4111-8111-111111111111",
);

const OWNERS_TEAM_ID: ObjectID = new ObjectID(
  "72222222-2222-4222-8222-222222222221",
);
const MEMBERS_TEAM_ID: ObjectID = new ObjectID(
  "72222222-2222-4222-8222-222222222222",
);

// The project's owner, who may bring everything over.
const SAM_ID: ObjectID = new ObjectID("73333333-3333-4333-8333-333333333331");
// Already a member: Opsgenie's Bob, by his email.
const BOB_MEMBER_ID: ObjectID = new ObjectID(
  "73333333-3333-4333-8333-333333333332",
);
// A member: may create services and on-call records, not teams or invitations.
const MIA_ID: ObjectID = new ObjectID("73333333-3333-4333-8333-333333333333");

const BOB_EMAIL: string = "bob@example.com";
const ALICE_EMAIL: string = "alice@example.com";

const LEFT_PROJECT_MESSAGE: string =
  "You are no longer a member of this project, so the import was stopped.";

const SCHEMA_NAME_DASHES: RegExp = /-/g;

type CountedTable =
  | "Team"
  | "TeamMember"
  | "User"
  | "Service"
  | "ServiceOwnerTeam"
  | "OnCallDutyPolicySchedule"
  | "OnCallDutyPolicyScheduleLayer"
  | "OnCallDutyPolicyScheduleLayerUser"
  | "OnCallDutyPolicy"
  | "OnCallDutyPolicyEscalationRule"
  | "ToolImportRecord";

const COUNTED_TABLES: Array<CountedTable> = [
  "Team",
  "TeamMember",
  "User",
  "Service",
  "ServiceOwnerTeam",
  "OnCallDutyPolicySchedule",
  "OnCallDutyPolicyScheduleLayer",
  "OnCallDutyPolicyScheduleLayerUser",
  "OnCallDutyPolicy",
  "OnCallDutyPolicyEscalationRule",
  "ToolImportRecord",
];

type TableCounts = Record<CountedTable, number>;

interface Membership {
  team: string;
  email: string;
  accepted: boolean;
}

interface Layer {
  schedule: string;
  layer: string;
  people: Array<string>;
}

interface Level {
  policy: string;
  order: number;
  escalateAfterInMinutes: number;
  pages: Array<string>;
}

interface Owner {
  of: string;
  team: string;
}

function userPermission(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
  };
}

function isCreated(item: ToolImportReportItem): boolean {
  return (
    item.outcome === ToolImportOutcome.Created ||
    item.outcome === ToolImportOutcome.Invited
  );
}

describePostgres("an import from another tool, against Postgres", () => {
  const schema: string = `tool_import_${ObjectID.generate()
    .toString()
    .replace(SCHEMA_NAME_DASHES, "")}`;
  let database: DataSource;
  let tables: Array<string> = [];

  // What each person may do in the project, as the permission cache holds it.
  let tenantPermissions: Map<string, Array<Permission>>;
  let currentPlan: PlanType;
  let api: FixtureApi;
  let mailCount: number;
  let queuedJobs: Array<unknown>;
  const originalTransportFactory: (
    hosts: Array<string>,
  ) => ToolImportTransport = ToolImportRunExecutor.transportFactory;

  function globalPermission(userId: ObjectID): UserGlobalAccessPermission {
    return {
      _type: "UserGlobalAccessPermission",
      projectIds: tenantPermissions.has(userId.toString()) ? [PROJECT_ID] : [],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
    };
  }

  function tenantPermission(
    userId: ObjectID,
  ): UserTenantAccessPermission | null {
    const permissions: Array<Permission> | undefined = tenantPermissions.get(
      userId.toString(),
    );

    if (!permissions) {
      return null;
    }

    return {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: permissions.map(userPermission),
    };
  }

  // The props a request of the person carries, as the API builds them.
  function propsOf(userId: ObjectID): DatabaseCommonInteractionProps {
    return {
      userId: userId,
      tenantId: PROJECT_ID,
      userGlobalAccessPermission: globalPermission(userId),
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: tenantPermission(userId)!,
      },
    } as DatabaseCommonInteractionProps;
  }

  async function insertUser(data: {
    id: ObjectID;
    email: string;
    name: string;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."User" ("_id", "version", "email", "name", "slug", "isEmailVerified") VALUES ($1, 1, $2, $3, $4, true)`,
      [data.id.toString(), data.email, data.name, data.id.toString()],
    );
  }

  async function insertTeam(data: {
    id: ObjectID;
    name: string;
    permission: Permission;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Team" ("_id", "version", "projectId", "name", "slug") VALUES ($1, 1, $2, $3, $4)`,
      [
        data.id.toString(),
        PROJECT_ID.toString(),
        data.name,
        `${data.name.toLowerCase()}-${data.id.toString()}`,
      ],
    );
    await database.query(
      `INSERT INTO "${schema}"."TeamPermission" ("_id", "version", "projectId", "teamId", "permission", "isBlockPermission") VALUES ($1, 1, $2, $3, $4, false)`,
      [
        ObjectID.generate().toString(),
        PROJECT_ID.toString(),
        data.id.toString(),
        data.permission,
      ],
    );
  }

  async function insertMembership(data: {
    userId: ObjectID;
    teamId: ObjectID;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."TeamMember" ("_id", "version", "projectId", "userId", "teamId", "hasAcceptedInvitation", "invitationAcceptedAt") VALUES ($1, 1, $2, $3, $4, true, now())`,
      [
        ObjectID.generate().toString(),
        PROJECT_ID.toString(),
        data.userId.toString(),
        data.teamId.toString(),
      ],
    );
  }

  async function countRows(table: CountedTable): Promise<number> {
    const rows: Array<{ count: string }> = await database.query(
      `SELECT COUNT(*)::text AS count FROM "${schema}"."${table}" WHERE "deletedAt" IS NULL`,
    );

    return Number(rows[0]!.count);
  }

  async function countAll(): Promise<TableCounts> {
    const counts: Partial<TableCounts> = {};

    for (const table of COUNTED_TABLES) {
      counts[table] = await countRows(table);
    }

    return counts as TableCounts;
  }

  function added(after: TableCounts, before: TableCounts): TableCounts {
    const difference: Partial<TableCounts> = {};

    for (const table of COUNTED_TABLES) {
      difference[table] = after[table] - before[table];
    }

    return difference as TableCounts;
  }

  async function namesIn(
    table: "Team" | "Service" | "OnCallDutyPolicySchedule" | "OnCallDutyPolicy",
  ): Promise<Array<string>> {
    const rows: Array<{ name: string }> = await database.query(
      `SELECT "name" FROM "${schema}"."${table}" WHERE "projectId" = $1 AND "deletedAt" IS NULL ORDER BY "name"`,
      [PROJECT_ID.toString()],
    );

    return rows.map((row: { name: string }): string => {
      return row.name;
    });
  }

  async function memberships(): Promise<Array<Membership>> {
    return await database.query(
      `SELECT t."name" AS team, u."email", m."hasAcceptedInvitation" AS accepted
         FROM "${schema}"."TeamMember" m
         JOIN "${schema}"."Team" t ON t."_id" = m."teamId"
         JOIN "${schema}"."User" u ON u."_id" = m."userId"
        WHERE m."projectId" = $1
        ORDER BY 1, 2`,
      [PROJECT_ID.toString()],
    );
  }

  async function layers(): Promise<Array<Layer>> {
    const rows: Array<{ schedule: string; layer: string; email: string }> =
      await database.query(
        `SELECT s."name" AS schedule, l."name" AS layer, u."email"
           FROM "${schema}"."OnCallDutyPolicyScheduleLayer" l
           JOIN "${schema}"."OnCallDutyPolicySchedule" s ON s."_id" = l."onCallDutyPolicyScheduleId"
           LEFT JOIN "${schema}"."OnCallDutyPolicyScheduleLayerUser" lu ON lu."onCallDutyPolicyScheduleLayerId" = l."_id"
           LEFT JOIN "${schema}"."User" u ON u."_id" = lu."userId"
          ORDER BY s."name", l."order", lu."order"`,
      );
    const byLayer: Array<Layer> = [];

    for (const row of rows) {
      let layer: Layer | undefined = byLayer.find((candidate: Layer) => {
        return (
          candidate.schedule === row.schedule && candidate.layer === row.layer
        );
      });

      if (!layer) {
        layer = { schedule: row.schedule, layer: row.layer, people: [] };
        byLayer.push(layer);
      }

      if (row.email) {
        layer.people.push(row.email);
      }
    }

    return byLayer;
  }

  async function levels(): Promise<Array<Level>> {
    const rules: Array<{
      _id: string;
      policy: string;
      order: number;
      escalateAfterInMinutes: number;
    }> = await database.query(
      `SELECT r."_id"::text AS "_id", p."name" AS policy, r."order", r."escalateAfterInMinutes"
         FROM "${schema}"."OnCallDutyPolicyEscalationRule" r
         JOIN "${schema}"."OnCallDutyPolicy" p ON p."_id" = r."onCallDutyPolicyId"
        ORDER BY p."name", r."order"`,
    );
    const targets: Array<{ ruleId: string; target: string }> =
      await database.query(
        `SELECT x."onCallDutyPolicyEscalationRuleId"::text AS "ruleId", 'user ' || u."email" AS target
           FROM "${schema}"."OnCallDutyPolicyEscalationRuleUser" x JOIN "${schema}"."User" u ON u."_id" = x."userId"
         UNION ALL
         SELECT x."onCallDutyPolicyEscalationRuleId"::text, 'team ' || t."name"
           FROM "${schema}"."OnCallDutyPolicyEscalationRuleTeam" x JOIN "${schema}"."Team" t ON t."_id" = x."teamId"
         UNION ALL
         SELECT x."onCallDutyPolicyEscalationRuleId"::text, 'schedule ' || s."name"
           FROM "${schema}"."OnCallDutyPolicyEscalationRuleSchedule" x JOIN "${schema}"."OnCallDutyPolicySchedule" s ON s."_id" = x."onCallDutyPolicyScheduleId"
         ORDER BY 2`,
      );

    return rules.map(
      (rule: {
        _id: string;
        policy: string;
        order: number;
        escalateAfterInMinutes: number;
      }): Level => {
        return {
          policy: rule.policy,
          order: rule.order,
          escalateAfterInMinutes: rule.escalateAfterInMinutes,
          pages: targets
            .filter((target: { ruleId: string }): boolean => {
              return target.ruleId === rule._id;
            })
            .map((target: { target: string }): string => {
              return target.target;
            }),
        };
      },
    );
  }

  async function owners(): Promise<Array<Owner>> {
    return await database.query(
      `SELECT 'service ' || s."name" AS "of", t."name" AS team FROM "${schema}"."ServiceOwnerTeam" o JOIN "${schema}"."Service" s ON s."_id" = o."serviceId" JOIN "${schema}"."Team" t ON t."_id" = o."teamId"
       UNION ALL
       SELECT 'schedule ' || s."name", t."name" FROM "${schema}"."OnCallDutyPolicyScheduleOwnerTeam" o JOIN "${schema}"."OnCallDutyPolicySchedule" s ON s."_id" = o."onCallDutyPolicyScheduleId" JOIN "${schema}"."Team" t ON t."_id" = o."teamId"
       UNION ALL
       SELECT 'policy ' || p."name", t."name" FROM "${schema}"."OnCallDutyPolicyOwnerTeam" o JOIN "${schema}"."OnCallDutyPolicy" p ON p."_id" = o."onCallDutyPolicyId" JOIN "${schema}"."Team" t ON t."_id" = o."teamId"
       ORDER BY 1`,
    );
  }

  async function readRun(runId: ObjectID): Promise<ToolImportRun> {
    const run: ToolImportRun | null = await ToolImportRunService.findOneById({
      id: runId,
      select: {
        _id: true,
        projectId: true,
        source: true,
        status: true,
        snapshot: true,
        report: true,
        error: true,
        apiKey: true,
        createdByUserId: true,
      },
      props: { isRoot: true },
    });

    expect(run).not.toBeNull();

    return run!;
  }

  async function rawRun(
    runId: ObjectID,
  ): Promise<{ apiKey: string | null; snapshot: string | null }> {
    const rows: Array<{ apiKey: string | null; snapshot: string | null }> =
      await database.query(
        `SELECT "apiKey", "snapshot"::text AS "snapshot" FROM "${schema}"."ToolImportRun" WHERE "_id" = $1`,
        [runId.toString()],
      );

    expect(rows).toHaveLength(1);

    return rows[0]!;
  }

  // The person reads Opsgenie (the fixture account) with their key.
  async function readOpsGenie(userId: ObjectID): Promise<ObjectID> {
    const runId: ObjectID = await ToolImportRunExecutor.startRead({
      projectId: PROJECT_ID,
      userId: userId,
      source: ToolImportSource.OpsGenie,
      region: "US",
      apiKey: OPSGENIE_KEY,
    });

    await ToolImportRunExecutor.executeRun(runId);

    expect((await readRun(runId)).status).toBe(
      ToolImportRunStatus.ReadyToReview,
    );

    return runId;
  }

  // The preview, as the page asks for it.
  async function previewOf(
    runId: ObjectID,
    userId: ObjectID,
  ): Promise<ToolImportPlan> {
    return await ToolImportRunExecutor.getPlan({
      run: await readRun(runId),
      projectId: PROJECT_ID,
      props: propsOf(userId),
    });
  }

  function tickedByDefault(plan: ToolImportPlan): Array<string> {
    return plan.items
      .filter((item: ToolImportPlanItem): boolean => {
        return item.isSelectable && item.isSelectedByDefault;
      })
      .map((item: ToolImportPlanItem): string => {
        return item.key;
      });
  }

  // The person starts the import with these keys; the worker runs it.
  async function runImport(data: {
    runId: ObjectID;
    userId: ObjectID;
    selectedKeys: Array<string>;
    inviteTeamId: string | null;
    beforeWorker?: (() => Promise<void>) | undefined;
  }): Promise<ToolImportRun> {
    await ToolImportRunExecutor.startImport({
      runId: data.runId,
      projectId: PROJECT_ID,
      props: propsOf(data.userId),
      selection: {
        selectedKeys: data.selectedKeys,
        inviteTeamId: data.inviteTeamId,
      },
    });

    if (data.beforeWorker) {
      await data.beforeWorker();
    }

    await ToolImportRunExecutor.executeRun(data.runId);

    return await readRun(data.runId);
  }

  // Read, preview and import what the preview ticks, as the person.
  async function importEverythingTicked(userId: ObjectID): Promise<{
    plan: ToolImportPlan;
    run: ToolImportRun;
    report: ToolImportReport;
    selectedKeys: Array<string>;
  }> {
    const runId: ObjectID = await readOpsGenie(userId);
    const plan: ToolImportPlan = await previewOf(runId, userId);
    const selectedKeys: Array<string> = tickedByDefault(plan);
    const run: ToolImportRun = await runImport({
      runId: runId,
      userId: userId,
      selectedKeys: selectedKeys,
      inviteTeamId: plan.defaultInviteTeamId,
    });

    return {
      plan,
      run,
      report: run.report as unknown as ToolImportReport,
      selectedKeys,
    };
  }

  function itemNamed(plan: ToolImportPlan, name: string): ToolImportPlanItem {
    const item: ToolImportPlanItem | undefined = plan.items.find(
      (candidate: ToolImportPlanItem): boolean => {
        return candidate.name === name;
      },
    );

    expect(item).toBeDefined();

    return item!;
  }

  function reasonOf(item: ToolImportPlanItem): string | undefined {
    return item.reason?.code;
  }

  function hasNote(
    item: ToolImportPlanItem,
    code: ToolImportNoteCode,
  ): boolean {
    return item.notes.some((note: ToolImportNote): boolean => {
      return note.code === code;
    });
  }

  function failuresIn(
    report: ToolImportReport,
  ): Array<{ name: string; error?: string | undefined }> {
    return report.items
      .filter((item: ToolImportReportItem): boolean => {
        return item.outcome === ToolImportOutcome.Failed;
      })
      .map((item: ToolImportReportItem) => {
        return { name: item.name, error: item.error };
      });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["TOOL_IMPORT_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["TOOL_IMPORT_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["TOOL_IMPORT_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    /*
     * Every table, so whatever a service's hooks touch lands here and never
     * in the database's own tables. Constraints and indexes come with them:
     * a record the import creates must be a whole one.
     */
    tables = (
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
  }, 180000);

  afterAll(async () => {
    ToolImportRunExecutor.transportFactory = originalTransportFactory;

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
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

    // Locks and the job queue live in Redis: the test is the worker.
    jest.spyOn(Semaphore, "lock").mockImplementation((async () => {
      return {} as SemaphoreMutex;
    }) as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
    queuedJobs = [];
    jest.spyOn(Queue, "addJob").mockImplementation((async (
      ...args: Array<unknown>
    ) => {
      queuedJobs.push(args);
      return undefined;
    }) as never);

    // The permission cache lives in Redis: each person's, as set here.
    tenantPermissions = new Map<string, Array<Permission>>([
      [SAM_ID.toString(), [Permission.ProjectOwner]],
      [BOB_MEMBER_ID.toString(), [Permission.ProjectMember]],
      [MIA_ID.toString(), [Permission.ProjectMember]],
    ]);
    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockImplementation(async (userId: ObjectID) => {
        return globalPermission(userId);
      });
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockImplementation(async (userId: ObjectID) => {
        return tenantPermission(userId);
      });
    jest
      .spyOn(AccessTokenService, "refreshUserAllPermissions")
      .mockResolvedValue(undefined);
    jest
      .spyOn(AccessTokenService, "refreshUserGlobalAccessPermission")
      .mockResolvedValue(globalPermission(SAM_ID));
    jest
      .spyOn(AccessTokenService, "refreshUserTenantAccessPermission")
      .mockResolvedValue(null);

    // The project's plan, read only when billing is on.
    currentPlan = PlanType.Scale;
    jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockImplementation(async () => {
        return { plan: currentPlan, isSubscriptionUnpaid: false };
      });
    jest
      .spyOn(
        TeamMemberService,
        "updateSubscriptionSeatsByUniqueTeamMembersInProject",
      )
      .mockResolvedValue(undefined);

    mailCount = 0;
    jest.spyOn(MailService, "sendMail").mockImplementation((async () => {
      mailCount += 1;
    }) as never);
    jest.spyOn(ProductAnalytics, "captureForUser").mockReturnValue(undefined);

    api = opsGenieApi();
    ToolImportRunExecutor.transportFactory = (): ToolImportTransport => {
      return api.transport;
    };

    await database.query(
      `TRUNCATE ${tables
        .map((table: string): string => {
          return `"${schema}"."${table}"`;
        })
        .join(", ")}`,
    );

    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "version", "name", "slug") VALUES ($1, 1, 'Acme', $2)`,
      [PROJECT_ID.toString(), `acme-${PROJECT_ID.toString()}`],
    );
    await insertUser({ id: SAM_ID, email: "sam@acme.test", name: "Sam" });
    await insertUser({ id: BOB_MEMBER_ID, email: BOB_EMAIL, name: "Bob" });
    await insertUser({ id: MIA_ID, email: "mia@acme.test", name: "Mia" });
    await insertTeam({
      id: OWNERS_TEAM_ID,
      name: "Owners",
      permission: Permission.ProjectOwner,
    });
    await insertTeam({
      id: MEMBERS_TEAM_ID,
      name: "Members",
      permission: Permission.ProjectMember,
    });
    await insertMembership({ userId: SAM_ID, teamId: OWNERS_TEAM_ID });
    await insertMembership({ userId: BOB_MEMBER_ID, teamId: MEMBERS_TEAM_ID });
    await insertMembership({ userId: MIA_ID, teamId: MEMBERS_TEAM_ID });
  }, 60000);

  afterEach(() => {
    ToolImportRunExecutor.transportFactory = originalTransportFactory;
    jest.restoreAllMocks();
  });

  test("the key is stored encrypted, only while the read runs, and never queued", async () => {
    const runId: ObjectID = await ToolImportRunExecutor.startRead({
      projectId: PROJECT_ID,
      userId: SAM_ID,
      source: ToolImportSource.OpsGenie,
      region: "US",
      apiKey: OPSGENIE_KEY,
    });

    // At rest it is not the key; read back through the service, it is.
    const stored: { apiKey: string | null } = await rawRun(runId);
    expect(stored.apiKey).toBeTruthy();
    expect(stored.apiKey).not.toContain(OPSGENIE_KEY);
    expect((await readRun(runId)).apiKey).toBe(OPSGENIE_KEY);

    // The job carries the run's id, never the key.
    expect(queuedJobs).toHaveLength(1);
    expect(JSON.stringify(queuedJobs)).not.toContain(OPSGENIE_KEY);

    await ToolImportRunExecutor.executeRun(runId);

    const afterRead: { apiKey: string | null; snapshot: string | null } =
      await rawRun(runId);

    expect((await readRun(runId)).status).toBe(
      ToolImportRunStatus.ReadyToReview,
    );
    expect(afterRead.apiKey).toBeNull();
    expect(afterRead.snapshot).toBeTruthy();
    expect(afterRead.snapshot).not.toContain(OPSGENIE_KEY);
    expect(api.requests.length).toBeGreaterThan(0);
    expect(
      api.requests.every((request: { url: string }): boolean => {
        return request.url.startsWith("https://api.opsgenie.com/");
      }),
    ).toBe(true);
  });

  test("a read the tool refuses keeps no key and nothing that was read", async () => {
    api = opsGenieApi().add({
      path: "/v2/account",
      answers: [
        {
          statusCode: 401,
          bodyText: '{"message":"Could not authenticate"}',
          bodyJson: { message: "Could not authenticate" },
          headers: {},
        },
      ],
    });

    const runId: ObjectID = await ToolImportRunExecutor.startRead({
      projectId: PROJECT_ID,
      userId: SAM_ID,
      source: ToolImportSource.OpsGenie,
      region: "US",
      apiKey: OPSGENIE_KEY,
    });
    await ToolImportRunExecutor.executeRun(runId);

    const run: ToolImportRun = await readRun(runId);
    const stored: { apiKey: string | null; snapshot: string | null } =
      await rawRun(runId);

    expect(run.status).toBe(ToolImportRunStatus.Failed);
    expect(run.error).toContain("Opsgenie did not accept the API key.");
    expect(run.error).not.toContain(OPSGENIE_KEY);
    expect(stored).toEqual({ apiKey: null, snapshot: null });
  });

  test("the owner's import creates through the real services, remembers each record, and never creates one twice", async () => {
    const before: TableCounts = await countAll();
    const first: {
      plan: ToolImportPlan;
      run: ToolImportRun;
      report: ToolImportReport;
      selectedKeys: Array<string>;
    } = await importEverythingTicked(SAM_ID);

    // What the project has is used; who is not in it is invited.
    expect(itemNamed(first.plan, "Bob Marley").action).toBe(
      ToolImportAction.Match,
    );
    expect(itemNamed(first.plan, "Alice Wong").action).toBe(
      ToolImportAction.Invite,
    );
    expect(reasonOf(itemNamed(first.plan, "Carol Jones"))).toBe(
      ToolImportNoteCode.PersonDeactivated,
    );
    expect(first.plan.defaultInviteTeamId).toBe(MEMBERS_TEAM_ID.toString());

    expect({ status: first.run.status, error: first.run.error }).toEqual({
      status: ToolImportRunStatus.Completed,
      error: null,
    });
    expect(failuresIn(first.report)).toEqual([]);

    expect(await namesIn("Team")).toEqual([
      "Members",
      "Owners",
      "Payments",
      "Platform",
    ]);
    expect(await memberships()).toEqual([
      { team: "Members", email: ALICE_EMAIL, accepted: false },
      { team: "Members", email: BOB_EMAIL, accepted: true },
      { team: "Members", email: "mia@acme.test", accepted: true },
      { team: "Owners", email: "sam@acme.test", accepted: true },
      { team: "Payments", email: BOB_EMAIL, accepted: true },
      { team: "Platform", email: ALICE_EMAIL, accepted: false },
      { team: "Platform", email: BOB_EMAIL, accepted: true },
    ]);
    expect(mailCount).toBeGreaterThan(0);

    expect(await namesIn("Service")).toEqual(["Checkout"]);
    expect(await namesIn("OnCallDutyPolicySchedule")).toEqual([
      "Platform_schedule",
    ]);
    expect(await layers()).toEqual([
      {
        schedule: "Platform_schedule",
        layer: "Business hours",
        people: [ALICE_EMAIL, BOB_EMAIL],
      },
      {
        schedule: "Platform_schedule",
        layer: "After hours",
        people: [BOB_EMAIL],
      },
    ]);
    expect(await namesIn("OnCallDutyPolicy")).toEqual(["Platform_escalation"]);
    expect(
      (await levels()).map((level: Level) => {
        return [level.order, level.pages];
      }),
    ).toEqual([
      [1, ["schedule Platform_schedule"]],
      [2, [`user ${BOB_EMAIL}`]],
      [3, ["team Platform"]],
    ]);
    expect(await owners()).toEqual([
      { of: "policy Platform_escalation", team: "Platform" },
      { of: "schedule Platform_schedule", team: "Platform" },
      { of: "service Checkout", team: "Payments" },
    ]);

    // Each record created is remembered, once, by the tool's id.
    const remembered: Array<{ kind: string; isComplete: boolean }> =
      await database.query(
        `SELECT "kind", "isComplete" FROM "${schema}"."ToolImportRecord" WHERE "projectId" = $1 AND "source" = $2 ORDER BY "kind"`,
        [PROJECT_ID.toString(), ToolImportSource.OpsGenie],
      );
    expect(remembered).toEqual([
      { kind: ToolImportResourceKind.OnCallPolicy, isComplete: true },
      { kind: ToolImportResourceKind.OnCallSchedule, isComplete: true },
      { kind: ToolImportResourceKind.Person, isComplete: true },
      { kind: ToolImportResourceKind.Service, isComplete: true },
      { kind: ToolImportResourceKind.Team, isComplete: true },
      { kind: ToolImportResourceKind.Team, isComplete: true },
    ]);
    expect(remembered).toHaveLength(
      first.report.items.filter(isCreated).length,
    );

    const afterFirst: TableCounts = await countAll();
    const mailsAfterFirst: number = mailCount;
    expect(added(afterFirst, before)).toEqual({
      Team: 2,
      TeamMember: 4,
      User: 1,
      Service: 1,
      ServiceOwnerTeam: 1,
      OnCallDutyPolicySchedule: 1,
      OnCallDutyPolicyScheduleLayer: 2,
      OnCallDutyPolicyScheduleLayerUser: 3,
      OnCallDutyPolicy: 1,
      OnCallDutyPolicyEscalationRule: 3,
      ToolImportRecord: 6,
    });

    /*
     * Again: read again, and send the very same items again - more than
     * the page would. Everything the first import made is known, and
     * nothing is made twice.
     */
    const secondRunId: ObjectID = await readOpsGenie(SAM_ID);
    const secondPlan: ToolImportPlan = await previewOf(secondRunId, SAM_ID);

    for (const key of first.selectedKeys) {
      const item: ToolImportPlanItem | undefined = secondPlan.items.find(
        (candidate: ToolImportPlanItem): boolean => {
          return candidate.key === key;
        },
      );

      // Who was invited is in the project now: a member like any other.
      expect({
        key,
        action: item?.action,
        selectable: item?.isSelectable,
      }).toEqual({
        key,
        action:
          item?.kind === ToolImportResourceKind.Person
            ? ToolImportAction.Match
            : ToolImportAction.AlreadyImported,
        selectable: false,
      });
    }

    const again: ToolImportRun = await runImport({
      runId: secondRunId,
      userId: SAM_ID,
      selectedKeys: first.selectedKeys,
      inviteTeamId: MEMBERS_TEAM_ID.toString(),
    });
    const againReport: ToolImportReport =
      again.report as unknown as ToolImportReport;

    expect(again.status).toBe(ToolImportRunStatus.Completed);
    expect(againReport.items.filter(isCreated)).toEqual([]);
    expect(failuresIn(againReport)).toEqual([]);
    expect(await countAll()).toEqual(afterFirst);
    expect(mailCount).toBe(mailsAfterFirst);
  }, 180000);

  test("a member brings over only what they may create themselves: no teams and no invitations", async () => {
    const before: TableCounts = await countAll();
    const membersBefore: Array<Membership> = await memberships();
    const imported: {
      plan: ToolImportPlan;
      run: ToolImportRun;
      report: ToolImportReport;
    } = await importEverythingTicked(MIA_ID);

    expect(reasonOf(itemNamed(imported.plan, "Platform"))).toBe(
      ToolImportNoteCode.NoPermission,
    );
    expect(itemNamed(imported.plan, "Platform").isSelectable).toBe(false);
    expect(reasonOf(itemNamed(imported.plan, "Alice Wong"))).toBe(
      ToolImportNoteCode.NoPermission,
    );
    expect(itemNamed(imported.plan, "Bob Marley").action).toBe(
      ToolImportAction.Match,
    );

    expect(imported.run.status).toBe(ToolImportRunStatus.Completed);
    expect(failuresIn(imported.report)).toEqual([]);

    // Nothing they could not have created by hand.
    expect(await namesIn("Team")).toEqual(["Members", "Owners"]);
    expect(await memberships()).toEqual(membersBefore);
    expect(mailCount).toBe(0);

    // What they may create comes over, with the people already in the project.
    expect(await namesIn("Service")).toEqual(["Checkout"]);
    expect(await layers()).toEqual([
      {
        schedule: "Platform_schedule",
        layer: "Business hours",
        people: [BOB_EMAIL],
      },
      {
        schedule: "Platform_schedule",
        layer: "After hours",
        people: [BOB_EMAIL],
      },
    ]);
    expect(
      (await levels()).map((level: Level) => {
        return level.pages;
      }),
    ).toEqual([["schedule Platform_schedule"], [`user ${BOB_EMAIL}`]]);
    expect(await owners()).toEqual([]);

    const difference: TableCounts = added(await countAll(), before);
    expect([difference.Team, difference.TeamMember, difference.User]).toEqual([
      0, 0, 0,
    ]);
  }, 180000);

  test("someone who left the project after starting an import brings nothing over", async () => {
    const runId: ObjectID = await readOpsGenie(MIA_ID);
    const plan: ToolImportPlan = await previewOf(runId, MIA_ID);
    const before: TableCounts = await countAll();

    const run: ToolImportRun = await runImport({
      runId: runId,
      userId: MIA_ID,
      selectedKeys: tickedByDefault(plan),
      inviteTeamId: null,
      beforeWorker: async (): Promise<void> => {
        // Mia leaves the project before the worker picks the import up.
        await database.query(
          `DELETE FROM "${schema}"."TeamMember" WHERE "userId" = $1`,
          [MIA_ID.toString()],
        );
        tenantPermissions.delete(MIA_ID.toString());
      },
    });

    expect({ status: run.status, error: run.error }).toEqual({
      status: ToolImportRunStatus.Failed,
      error: LEFT_PROJECT_MESSAGE,
    });
    expect(await countAll()).toEqual({
      ...before,
      TeamMember: before.TeamMember - 1,
    });
  }, 180000);

  test("on a plan without what the tool brings, that part is not brought over (billing on); without billing, the plan does not matter", async () => {
    currentPlan = PlanType.Free;

    const before: TableCounts = await countAll();
    const imported: {
      plan: ToolImportPlan;
      run: ToolImportRun;
      report: ToolImportReport;
    } = await importEverythingTicked(SAM_ID);

    expect(imported.run.status).toBe(ToolImportRunStatus.Completed);
    expect(failuresIn(imported.report)).toEqual([]);

    const difference: TableCounts = added(await countAll(), before);

    if (!IsBillingEnabled) {
      expect([difference.Team, difference.OnCallDutyPolicySchedule]).toEqual([
        2, 1,
      ]);
      expect(await namesIn("Service")).toEqual(["Checkout"]);
      return;
    }

    // Teams need Scale, schedules Growth, and the Free plan has one member.
    expect(reasonOf(itemNamed(imported.plan, "Platform"))).toBe(
      ToolImportNoteCode.NeedsPlan,
    );
    expect(itemNamed(imported.plan, "Platform").reason?.values).toEqual({
      plan: PlanType.Scale,
    });
    expect(reasonOf(itemNamed(imported.plan, "Platform_schedule"))).toBe(
      ToolImportNoteCode.NeedsPlan,
    );
    expect(reasonOf(itemNamed(imported.plan, "Alice Wong"))).toBe(
      ToolImportNoteCode.NeedsPlan,
    );
    expect(
      hasNote(
        itemNamed(imported.plan, "Platform_escalation"),
        ToolImportNoteCode.PolicyFreePlanOneLevel,
      ),
    ).toBe(true);

    expect(difference).toEqual({
      ...difference,
      Team: 0,
      TeamMember: 0,
      User: 0,
      ServiceOwnerTeam: 0,
      OnCallDutyPolicySchedule: 0,
      OnCallDutyPolicyScheduleLayer: 0,
      OnCallDutyPolicyScheduleLayerUser: 0,
    });
    expect(await namesIn("Service")).toEqual(["Checkout"]);

    /*
     * One level, on the Free plan: the first that pages someone brought
     * over. The schedule its first level pages needs Growth, so it is
     * Bob, whom the next level pages.
     */
    expect(
      (await levels()).map((level: Level) => {
        return [level.policy, level.pages];
      }),
    ).toEqual([["Platform_escalation", [`user ${BOB_EMAIL}`]]]);
    expect(mailCount).toBe(0);
  }, 180000);

  test("the database holds one record of each item of the other tool", async () => {
    const run: ToolImportRun = new ToolImportRun();
    run.projectId = PROJECT_ID;
    run.source = ToolImportSource.OpsGenie;
    run.status = ToolImportRunStatus.Completed;
    run.createdByUserId = SAM_ID;
    const runId: ObjectID = (
      await ToolImportRunService.create({ data: run, props: { isRoot: true } })
    ).id!;

    const remember: () => Promise<ToolImportRecord> =
      async (): Promise<ToolImportRecord> => {
        const record: ToolImportRecord = new ToolImportRecord();
        record.projectId = PROJECT_ID;
        record.toolImportRunId = runId;
        record.source = ToolImportSource.OpsGenie;
        record.kind = ToolImportResourceKind.Team;
        record.sourceId = "team-1";
        record.recordId = ObjectID.generate();
        record.isComplete = true;

        return await ToolImportRecordService.create({
          data: record,
          props: { isRoot: true },
        });
      };

    const first: ToolImportRecord = await remember();
    await expect(remember()).rejects.toThrow();

    // Once forgotten, the item may be brought over again.
    await ToolImportRecordService.deleteOneById({
      id: first.id!,
      props: { isRoot: true },
    });
    await expect(remember()).resolves.toBeDefined();
    expect(await countRows("ToolImportRecord")).toBe(1);
  });
});
