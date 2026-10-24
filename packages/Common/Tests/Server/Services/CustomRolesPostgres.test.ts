import Entities from "../../../Models/DatabaseModels/Index";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Team from "../../../Models/DatabaseModels/Team";
import TeamCustomRole from "../../../Models/DatabaseModels/TeamCustomRole";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import CustomRolePermissionService from "../../../Server/Services/CustomRolePermissionService";
import CustomRoleService from "../../../Server/Services/CustomRoleService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import TeamCustomRoleService from "../../../Server/Services/TeamCustomRoleService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import PermissionNamespace from "../../../Server/Types/Permission/PermissionNamespace";
import CustomRoleSync from "../../../Server/Utils/CustomRole/CustomRoleSync";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  PROJECT_OWNER_NOT_IN_A_CUSTOM_ROLE_MESSAGE,
  TEAM_NOT_EDITABLE_FOR_ROLES_MESSAGE,
} from "../../../Types/Team/CustomRole";
import UserType from "../../../Types/UserType";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import {
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import InMemoryLocks from "../TestingUtils/InMemoryLocks";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
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
import { DataSource, Logger } from "typeorm";

/*
 * CUSTOM ROLES AGAINST A MIGRATED POSTGRES.
 *
 * Opt in with RUN_POSTGRES_CUSTOM_ROLE_TESTS=true against a database the
 * registered migrations (1803100000000-AddCustomRoles and
 * 1803150000000-AddTeamPermissionCustomRoleLinks included) have been applied
 * to, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_CUSTOM_ROLE_TESTS=true \
 *   CUSTOM_ROLE_TEST_DATABASE_HOST=127.0.0.1 \
 *   CUSTOM_ROLE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/CustomRolesPostgres.test.ts --forceExit
 *
 * Without the flag the suite is skipped (the Common test job's Postgres is
 * not migrated); the Postgres Schema Drift workflow runs it.
 *
 * What it holds, with the production services, hooks and permission layer
 * running unchanged:
 *
 *   - a role gives exactly what giving the same permissions directly gives:
 *     the cached permission sets of a member who has them through a role and
 *     of one who has them directly are equal, and so is what each may read;
 *   - every team given a role holds a copy of each of its permissions, kept
 *     equal to the role as it changes, and the cached permissions of every
 *     member of every team that has it are rebuilt at once - nobody else's;
 *   - taking anything away (a permission, the role from a team, the role
 *     itself, the team, a label) removes the copies in the same DELETE, as
 *     the migration's foreign keys declare;
 *   - nobody puts into a role, or gives through one, a permission they could
 *     not give a team directly; Project Owner is never in a role; a role never
 *     reaches another project; the copies are changed only through the role;
 *   - the team permissions that existed before the migration are untouched.
 *
 * The tables run in a uniquely named schema of structure-only clones of the
 * migrated tables; the foreign keys between them are copied from the
 * migrated tables' own definitions, so a cascade seen here is the one the
 * migrations declared. Only the cache (Valkey), the lock, realtime, workflow
 * and audit side effects are stood in for.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CUSTOM_ROLE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "User",
  "Label",
  "Team",
  "TeamMember",
  "CustomRole",
  "CustomRolePermission",
  "CustomRolePermissionLabel",
  "TeamCustomRole",
  "TeamPermission",
  "TeamPermissionLabel",
  // The sync keeps the API keys given a role too (ApiKeyCustomRolesPostgres).
  "ApiKey",
  "ApiKeyPermission",
  "ApiKeyPermissionLabel",
  "ApiKeyCustomRole",
  "Monitor",
  "MonitorLabel",
  "MonitorOwnerTeam",
  "MonitorOwnerUser",
];

// Copies a migrated foreign key's definition so it names the schema's clone.
const REFERENCES_PUBLIC: RegExp = /REFERENCES public\./g;

interface ForeignKeyRow {
  table: string;
  name: string;
  referencedTable: string;
  definition: string;
}

type SqlRow = Record<string, unknown>;

// A team permission row as Postgres holds it, labels included.
interface StoredRow {
  id: string;
  permission: string;
  scope: string;
  isBlockPermission: boolean;
  labelIds: Array<string>;
  customRoleId: string | null;
  teamCustomRoleId: string | null;
  customRolePermissionId: string | null;
}

// A permission, as a member's cached permission set holds it, for comparing.
interface HeldRow {
  permission: string;
  scope: string;
  labelIds: Array<string>;
  isBlockPermission: boolean;
}

class FailedQueryRecorder implements Logger {
  public failures: Array<string> = [];

  public logQuery(): void {
    return;
  }

  public logQueryError(error: string | Error, query: string): void {
    this.failures.push(
      `${error instanceof Error ? error.message : error} in: ${query}`,
    );
  }

  public logQuerySlow(): void {
    return;
  }

  public logSchemaBuild(): void {
    return;
  }

  public logMigration(): void {
    return;
  }

  public log(): void {
    return;
  }
}

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

const grant: (
  permission: Permission,
  data?: Partial<UserPermission>,
) => UserPermission = (
  permission: Permission,
  data: Partial<UserPermission> = {},
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    ...data,
  };
};

describePostgres("custom roles against a migrated Postgres", () => {
  const schema: string = `custom_roles_${ObjectID.generate()
    .toString()
    .split("-")
    .join("")}`;

  const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();
  const locks: InMemoryLocks = new InMemoryLocks();

  // The project the roles are made in, and another one.
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  const production: ObjectID = ObjectID.generate();
  const staging: ObjectID = ObjectID.generate();
  const otherProjectLabel: ObjectID = ObjectID.generate();

  // Owners: comes with the project; its permissions can't be changed.
  const ownersTeam: ObjectID = ObjectID.generate();
  // Given roles in the tests.
  const roleTeam: ObjectID = ObjectID.generate();
  const secondRoleTeam: ObjectID = ObjectID.generate();
  // Given the same permissions directly, to compare with.
  const directTeam: ObjectID = ObjectID.generate();
  const otherProjectTeam: ObjectID = ObjectID.generate();

  const roleMember: ObjectID = ObjectID.generate();
  const memberOfBothRoleTeams: ObjectID = ObjectID.generate();
  const directMember: ObjectID = ObjectID.generate();
  const invitedToRoleTeam: ObjectID = ObjectID.generate();
  const otherProjectMember: ObjectID = ObjectID.generate();

  const productionMonitor: ObjectID = ObjectID.generate();
  const stagingMonitor: ObjectID = ObjectID.generate();
  const unlabelledMonitor: ObjectID = ObjectID.generate();
  const monitorBothTeamsOwn: ObjectID = ObjectID.generate();

  const monitorService: DatabaseService<Monitor> = new DatabaseService(Monitor);

  // What GlobalCache holds, and which members' permission sets were rebuilt.
  const cache: Map<string, JSONObject> = new Map<string, JSONObject>();
  let refreshedMembers: Array<string> = [];

  let database: DataSource;

  const owner: DatabaseCommonInteractionProps = propsHolding([
    grant(Permission.ProjectOwner, { scope: PermissionScope.All }),
  ]);

  const admin: DatabaseCommonInteractionProps = propsHolding([
    grant(Permission.ProjectAdmin, { scope: PermissionScope.All }),
  ]);

  /*
   * May change what teams can do, and holds Incident Member for the whole
   * project and Monitor Viewer for production only - nothing else.
   */
  const teamEditor: DatabaseCommonInteractionProps = propsHolding([
    grant(Permission.EditProjectTeamPermissions, {
      scope: PermissionScope.All,
    }),
    grant(Permission.InviteProjectTeamMembers, { scope: PermissionScope.All }),
    grant(Permission.ReadProjectTeam, { scope: PermissionScope.All }),
    grant(Permission.IncidentMember, { scope: PermissionScope.All }),
    grant(Permission.MonitorViewer, {
      scope: PermissionScope.Labels,
      labelIds: [production],
    }),
  ]);

  function propsHolding(
    permissions: Array<UserPermission>,
    tenantId: ObjectID = projectId,
  ): DatabaseCommonInteractionProps {
    return {
      userId: ObjectID.generate(),
      tenantId: tenantId,
      userType: UserType.User,
      ...ON_HIGHEST_PLAN,
      userGlobalAccessPermission: {
        _type: "UserGlobalAccessPermission",
        projectIds: [tenantId],
        globalPermissions: [Permission.User, Permission.CurrentUser],
      },
      userTenantAccessPermission: {
        [tenantId.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: tenantId,
          permissions: permissions,
        },
      },
    };
  }

  beforeAll(async () => {
    /*
     * Custom roles are an Enterprise Edition feature: the edition check
     * refuses every role write in a process with no enterprise module.
     */
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.CustomRoles]);

    database = new DataSource({
      type: "postgres",
      host: process.env["CUSTOM_ROLE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["CUSTOM_ROLE_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["CUSTOM_ROLE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema: schema,
      synchronize: false,
      logging: ["error"],
      logger: failedQueries,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();

    // The migrated foreign keys between these tables, read before the clones exist.
    const foreignKeys: Array<ForeignKeyRow> = await database.query(
      `SELECT t.relname AS "table",
              c.conname AS "name",
              r.relname AS "referencedTable",
              pg_get_constraintdef(c.oid) AS "definition"
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_class r ON r.oid = c.confrelid
        WHERE n.nspname = 'public' AND t.relname = ANY($1) AND c.contype = 'f'
        ORDER BY t.relname, c.conname`,
      [TABLES],
    );

    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    for (const foreignKey of foreignKeys) {
      /*
       * Only the keys between the records these tests make: User is cloned
       * for the joins an audited delete reads, and holds no rows.
       */
      if (
        !TABLES.includes(foreignKey.referencedTable) ||
        foreignKey.referencedTable === "User"
      ) {
        continue;
      }

      await database.query(
        `ALTER TABLE "${schema}"."${foreignKey.table}" ADD CONSTRAINT "${foreignKey.name}" ${foreignKey.definition.replace(
          REFERENCES_PUBLIC,
          "REFERENCES ",
        )}`,
      );
    }

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    // The cache, as Valkey would hold it.
    jest
      .spyOn(GlobalCache, "setJSON")
      .mockImplementation(
        async (
          namespace: string,
          key: string,
          value: JSONObject,
        ): Promise<void> => {
          cache.set(`${namespace}|${key}`, JSON.parse(JSON.stringify(value)));

          if (namespace === PermissionNamespace.ProjectPermission) {
            refreshedMembers.push(key.split(":")[0]!.toLowerCase());
          }
        },
      );
    jest
      .spyOn(GlobalCache, "getJSONObject")
      .mockImplementation(
        async (namespace: string, key: string): Promise<JSONObject | null> => {
          return cache.get(`${namespace}|${key}`) || null;
        },
      );
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockImplementation(
        async (namespace: string, key: string): Promise<void> => {
          cache.delete(`${namespace}|${key}`);
        },
      );
    jest.spyOn(RealtimeAccessChanges, "announce").mockReturnValue(undefined);

    locks.install();

    jest.spyOn(AuditLogService, "recordCreate").mockResolvedValue(undefined);
    jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue(undefined);
    jest.spyOn(AuditLogService, "recordDelete").mockResolvedValue(undefined);

    for (const service of [
      CustomRoleService,
      CustomRolePermissionService,
      TeamCustomRoleService,
      TeamPermissionService,
    ] as unknown as Array<DatabaseService<never>>) {
      jest.spyOn(service, "onTriggerRealtime").mockResolvedValue(undefined);
      jest.spyOn(service, "onTriggerWorkflow").mockResolvedValue(undefined);
    }
  });

  beforeEach(async () => {
    failedQueries.failures = [];
    cache.clear();
    refreshedMembers = [];

    await database.query(
      [...TABLES]
        .reverse()
        .map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        })
        .join("; "),
    );

    for (const [id, name] of [
      [projectId, "Roles project"],
      [otherProjectId, "Another project"],
    ] as Array<[ObjectID, string]>) {
      await insert("Project", {
        _id: id.toString(),
        name: name,
        slug: `project-${id.toString()}`,
        version: 1,
      });
    }

    for (const [id, project, name] of [
      [production, projectId, "Production"],
      [staging, projectId, "Staging"],
      [otherProjectLabel, otherProjectId, "Theirs"],
    ] as Array<[ObjectID, ObjectID, string]>) {
      await insert("Label", {
        _id: id.toString(),
        projectId: project.toString(),
        name: name,
        slug: `label-${id.toString()}`,
        color: "#123456",
        version: 1,
      });
    }

    for (const [id, project, name, editable] of [
      [ownersTeam, projectId, "Owners", false],
      [roleTeam, projectId, "Responders", true],
      [secondRoleTeam, projectId, "Leads", true],
      [directTeam, projectId, "Direct", true],
      [otherProjectTeam, otherProjectId, "Theirs", true],
    ] as Array<[ObjectID, ObjectID, string, boolean]>) {
      await insert("Team", {
        _id: id.toString(),
        projectId: project.toString(),
        name: name,
        slug: `team-${id.toString()}`,
        isPermissionsEditable: editable,
        version: 1,
      });
    }

    for (const [team, project, user, accepted] of [
      [roleTeam, projectId, roleMember, true],
      [roleTeam, projectId, memberOfBothRoleTeams, true],
      [secondRoleTeam, projectId, memberOfBothRoleTeams, true],
      [roleTeam, projectId, invitedToRoleTeam, false],
      [directTeam, projectId, directMember, true],
      [otherProjectTeam, otherProjectId, otherProjectMember, true],
    ] as Array<[ObjectID, ObjectID, ObjectID, boolean]>) {
      await insert("TeamMember", {
        _id: ObjectID.generate().toString(),
        teamId: team.toString(),
        projectId: project.toString(),
        userId: user.toString(),
        hasAcceptedInvitation: accepted,
        version: 1,
      });
    }

    for (const [id, label] of [
      [productionMonitor, production],
      [stagingMonitor, staging],
      [unlabelledMonitor, null],
      [monitorBothTeamsOwn, null],
    ] as Array<[ObjectID, ObjectID | null]>) {
      await insert("Monitor", {
        _id: id.toString(),
        projectId: projectId.toString(),
        name: `Monitor ${id.toString()}`,
        slug: `monitor-${id.toString()}`,
        monitorType: "Manual",
        currentMonitorStatusId: ObjectID.generate().toString(),
        version: 1,
      });

      if (label) {
        await insert("MonitorLabel", {
          monitorId: id.toString(),
          labelId: label.toString(),
        });
      }
    }

    // Owned by the team given the role and the team given the same directly.
    for (const team of [roleTeam, directTeam]) {
      await insert("MonitorOwnerTeam", {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        monitorId: monitorBothTeamsOwn.toString(),
        teamId: team.toString(),
        version: 1,
      });
    }
  });

  afterEach(() => {
    // A statement Postgres refused fails the test, even if a caller caught it.
    expect(failedQueries.failures).toEqual([]);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    uninstallEnterpriseModule();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function insert(table: string, row: SqlRow): Promise<void> {
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

  function labelsOf(labelIds: Array<ObjectID>): Array<Label> {
    return labelIds.map((labelId: ObjectID): Label => {
      return new Label(labelId);
    });
  }

  async function createRole(
    name: string,
    props: DatabaseCommonInteractionProps = owner,
  ): Promise<ObjectID> {
    const role: CustomRole = new CustomRole();
    role.projectId = projectId;
    role.name = name;

    return (
      await CustomRoleService.create({
        data: role,
        props: props,
      })
    ).id!;
  }

  async function addToRole(
    customRoleId: ObjectID,
    permission: Permission,
    data: {
      scope?: PermissionScope | undefined;
      labels?: Array<ObjectID> | undefined;
      props?: DatabaseCommonInteractionProps | undefined;
    } = {},
  ): Promise<ObjectID> {
    const row: CustomRolePermission = new CustomRolePermission();
    row.projectId = projectId;
    row.customRoleId = customRoleId;
    row.permission = permission;
    row.scope = data.scope || PermissionScope.All;

    if (data.labels) {
      row.labels = labelsOf(data.labels);
    }

    return (
      await CustomRolePermissionService.create({
        data: row,
        props: data.props || owner,
      })
    ).id!;
  }

  async function giveRole(
    teamId: ObjectID,
    customRoleId: ObjectID,
    props: DatabaseCommonInteractionProps = owner,
  ): Promise<ObjectID> {
    const given: TeamCustomRole = new TeamCustomRole();
    given.projectId = projectId;
    given.teamId = teamId;
    given.customRoleId = customRoleId;

    return (
      await TeamCustomRoleService.create({
        data: given,
        props: props,
      })
    ).id!;
  }

  async function giveDirectly(
    teamId: ObjectID,
    permission: Permission,
    data: {
      scope?: PermissionScope | undefined;
      labels?: Array<ObjectID> | undefined;
      isBlockPermission?: boolean | undefined;
      props?: DatabaseCommonInteractionProps | undefined;
    } = {},
  ): Promise<ObjectID> {
    const row: TeamPermission = new TeamPermission();
    row.projectId = projectId;
    row.teamId = teamId;
    row.permission = permission;
    row.scope = data.scope || PermissionScope.All;
    row.isBlockPermission = Boolean(data.isBlockPermission);

    if (data.labels) {
      row.labels = labelsOf(data.labels);
    }

    return (
      await TeamPermissionService.create({
        data: row,
        props: data.props || owner,
      })
    ).id!;
  }

  // Every permission row of a team, as Postgres holds it.
  async function rowsOfTeam(teamId: ObjectID): Promise<Array<StoredRow>> {
    const rows: Array<{
      _id: string;
      permission: string;
      scope: string;
      isBlockPermission: boolean;
      customRoleId: string | null;
      teamCustomRoleId: string | null;
      customRolePermissionId: string | null;
    }> = await database.query(
      `SELECT "_id", "permission", "scope", "isBlockPermission", "customRoleId", "teamCustomRoleId", "customRolePermissionId"
         FROM "${schema}"."TeamPermission" WHERE "teamId" = $1 ORDER BY "permission", "_id"`,
      [teamId.toString()],
    );

    const result: Array<StoredRow> = [];

    for (const row of rows) {
      const labels: Array<{ labelId: string }> = await database.query(
        `SELECT "labelId" FROM "${schema}"."TeamPermissionLabel" WHERE "teamPermissionId" = $1 ORDER BY "labelId"`,
        [row._id],
      );

      result.push({
        id: row._id,
        permission: row.permission,
        scope: row.scope,
        isBlockPermission: row.isBlockPermission,
        labelIds: labels.map((label: { labelId: string }): string => {
          return label.labelId;
        }),
        customRoleId: row.customRoleId,
        teamCustomRoleId: row.teamCustomRoleId,
        customRolePermissionId: row.customRolePermissionId,
      });
    }

    return result;
  }

  async function copiesOnTeam(teamId: ObjectID): Promise<Array<StoredRow>> {
    return (await rowsOfTeam(teamId)).filter((row: StoredRow): boolean => {
      return Boolean(row.customRoleId);
    });
  }

  async function count(table: string): Promise<number> {
    const rows: Array<{ count: string }> = await database.query(
      `SELECT COUNT(*)::text AS "count" FROM "${schema}"."${table}"`,
    );

    return Number(rows[0]?.count || 0);
  }

  async function permissionCountOf(customRoleId: ObjectID): Promise<number> {
    const rows: Array<{ permissionCount: number }> = await database.query(
      `SELECT "permissionCount" FROM "${schema}"."CustomRole" WHERE "_id" = $1`,
      [customRoleId.toString()],
    );

    return rows[0]?.permissionCount ?? -1;
  }

  // A member's permission set as their requests carry it, rebuilt now.
  async function heldBy(userId: ObjectID): Promise<Array<HeldRow>> {
    const permission: UserTenantAccessPermission | null =
      await AccessTokenService.refreshUserTenantAccessPermission(
        userId,
        projectId,
      );

    return (permission?.permissions || [])
      .map((row: UserPermission): HeldRow => {
        return {
          permission: row.permission,
          scope: row.scope || "",
          labelIds: (row.labelIds || [])
            .map((labelId: ObjectID | string): string => {
              return labelId.toString().toLowerCase();
            })
            .sort(),
          isBlockPermission: Boolean(row.isBlockPermission),
        };
      })
      .sort((a: HeldRow, b: HeldRow): number => {
        return JSON.stringify(a).localeCompare(JSON.stringify(b));
      });
  }

  // The props a member's requests carry, from their cached permission set.
  async function requestOf(
    userId: ObjectID,
    teamIds: Array<ObjectID>,
  ): Promise<DatabaseCommonInteractionProps> {
    const permission: UserTenantAccessPermission | null =
      await AccessTokenService.refreshUserTenantAccessPermission(
        userId,
        projectId,
      );

    return {
      userId: userId,
      tenantId: projectId,
      userType: UserType.User,
      ...ON_HIGHEST_PLAN,
      userTeamIds: teamIds,
      userGlobalAccessPermission: {
        _type: "UserGlobalAccessPermission",
        projectIds: [projectId],
        globalPermissions: [Permission.User, Permission.CurrentUser],
      },
      userTenantAccessPermission: {
        [projectId.toString()]: permission!,
      },
    };
  }

  async function monitorsReadBy(
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<string>> {
    const monitors: Array<Monitor> = await monitorService.findBy({
      query: {},
      select: { _id: true },
      skip: 0,
      limit: 50,
      props: props,
    });

    return monitors
      .map((monitor: Monitor): string => {
        return monitor.id!.toString().toLowerCase();
      })
      .sort();
  }

  async function refusal(work: () => Promise<unknown>): Promise<string> {
    try {
      await work();
    } catch (err) {
      return (err as Exception).message || String(err);
    }

    throw new Error("Expected a refusal, but the write went through.");
  }

  function wasRefreshed(userId: ObjectID): boolean {
    return refreshedMembers.includes(userId.toString().toLowerCase());
  }

  const lower: (id: ObjectID) => string = (id: ObjectID): string => {
    return id.toString().toLowerCase();
  };

  describe("a role gives exactly what giving the same permissions directly gives", () => {
    test("the cached permission sets are equal, and so is what each member may read", async () => {
      const role: ObjectID = await createRole("Incident Responder");

      const shapes: Array<{
        permission: Permission;
        scope: PermissionScope;
        labels?: Array<ObjectID>;
      }> = [
        { permission: Permission.IncidentMember, scope: PermissionScope.All },
        {
          permission: Permission.MonitorViewer,
          scope: PermissionScope.Labels,
          labels: [production],
        },
        { permission: Permission.AlertViewer, scope: PermissionScope.Owned },
        {
          permission: Permission.ReadProjectMonitor,
          scope: PermissionScope.Owned,
        },
        { permission: Permission.SettingsViewer, scope: PermissionScope.All },
      ];

      for (const shape of shapes) {
        await addToRole(role, shape.permission, {
          scope: shape.scope,
          labels: shape.labels,
        });
        await giveDirectly(directTeam, shape.permission, {
          scope: shape.scope,
          labels: shape.labels,
        });
      }

      await giveRole(roleTeam, role);

      const throughRole: Array<HeldRow> = await heldBy(roleMember);
      const direct: Array<HeldRow> = await heldBy(directMember);

      expect(throughRole).toEqual(direct);
      expect(
        throughRole.filter((row: HeldRow): boolean => {
          return row.permission === Permission.MonitorViewer;
        }),
      ).toEqual([
        {
          permission: Permission.MonitorViewer,
          scope: PermissionScope.Labels,
          labelIds: [lower(production)],
          isBlockPermission: false,
        },
      ]);

      // And so is what each may read.
      const readThroughRole: Array<string> = await monitorsReadBy(
        await requestOf(roleMember, [roleTeam]),
      );
      const readDirectly: Array<string> = await monitorsReadBy(
        await requestOf(directMember, [directTeam]),
      );

      expect(readThroughRole.length).toBeGreaterThan(0);
      expect(readThroughRole).toEqual(readDirectly);
    });

    test.each([
      {
        name: "limited to labels reaches exactly the monitors carrying one",
        scope: PermissionScope.Labels,
        labels: (): Array<ObjectID> => {
          return [production];
        },
        reads: (): Array<ObjectID> => {
          return [productionMonitor];
        },
      },
      {
        name: "scoped to Owned reaches exactly the monitors the team owns",
        scope: PermissionScope.Owned,
        labels: (): Array<ObjectID> => {
          return [];
        },
        reads: (): Array<ObjectID> => {
          return [monitorBothTeamsOwn];
        },
      },
      {
        name: "for all resources reaches every monitor",
        scope: PermissionScope.All,
        labels: (): Array<ObjectID> => {
          return [];
        },
        reads: (): Array<ObjectID> => {
          return [
            productionMonitor,
            stagingMonitor,
            unlabelledMonitor,
            monitorBothTeamsOwn,
          ];
        },
      },
    ])(
      "a role's Monitor Viewer $name, as the same given directly does",
      async (shape: {
        scope: PermissionScope;
        labels: () => Array<ObjectID>;
        reads: () => Array<ObjectID>;
      }) => {
        const role: ObjectID = await createRole("Monitor Watcher");
        await addToRole(role, Permission.MonitorViewer, {
          scope: shape.scope,
          labels: shape.labels().length > 0 ? shape.labels() : undefined,
        });
        await giveRole(roleTeam, role);
        await giveDirectly(directTeam, Permission.MonitorViewer, {
          scope: shape.scope,
          labels: shape.labels().length > 0 ? shape.labels() : undefined,
        });

        const expected: Array<string> = shape.reads().map(lower).sort();

        expect(
          await monitorsReadBy(await requestOf(roleMember, [roleTeam])),
        ).toEqual(expected);
        expect(
          await monitorsReadBy(await requestOf(directMember, [directTeam])),
        ).toEqual(expected);
      },
    );

    test("a team's block wins over a role exactly as it wins over a direct permission", async () => {
      const role: ObjectID = await createRole("Monitor Watcher");
      await addToRole(role, Permission.MonitorViewer);
      await giveRole(roleTeam, role);
      await giveDirectly(directTeam, Permission.MonitorViewer);

      for (const team of [roleTeam, directTeam]) {
        await giveDirectly(team, Permission.MonitorViewer, {
          isBlockPermission: true,
          scope: PermissionScope.Labels,
          labels: [staging],
        });
      }

      expect(await heldBy(roleMember)).toEqual(await heldBy(directMember));

      const readThroughRole: Array<string> = await monitorsReadBy(
        await requestOf(roleMember, [roleTeam]),
      );

      expect(readThroughRole).toEqual(
        await monitorsReadBy(await requestOf(directMember, [directTeam])),
      );
      expect(readThroughRole).not.toContain(lower(stagingMonitor));
      expect(readThroughRole).toContain(lower(productionMonitor));
    });

    test("a member of a team without the role gets nothing from it", async () => {
      const role: ObjectID = await createRole("Incident Responder");
      await addToRole(role, Permission.IncidentAdmin);
      await giveRole(roleTeam, role);

      const held: Array<HeldRow> = await heldBy(directMember);

      expect(
        held.some((row: HeldRow): boolean => {
          return row.permission === Permission.IncidentAdmin;
        }),
      ).toBe(false);
    });

    test("someone invited who has not accepted holds nothing of the role", async () => {
      const role: ObjectID = await createRole("Incident Responder");
      await addToRole(role, Permission.IncidentAdmin);
      await giveRole(roleTeam, role);

      expect(
        await AccessTokenService.refreshUserTenantAccessPermission(
          invitedToRoleTeam,
          projectId,
        ),
      ).toBeNull();
      expect(wasRefreshed(invitedToRoleTeam)).toBe(false);
    });
  });

  describe("the copies follow the role", () => {
    test("giving a role copies each of its permissions onto the team, marked with the role; the team's own stay as they are", async () => {
      const ownPermission: ObjectID = await giveDirectly(
        roleTeam,
        Permission.WorkflowViewer,
      );
      const role: ObjectID = await createRole("Incident Responder");
      const incidents: ObjectID = await addToRole(
        role,
        Permission.IncidentMember,
      );
      const monitors: ObjectID = await addToRole(
        role,
        Permission.MonitorViewer,
        { scope: PermissionScope.Labels, labels: [production, staging] },
      );

      refreshedMembers = [];
      const given: ObjectID = await giveRole(roleTeam, role);

      const rows: Array<StoredRow> = await rowsOfTeam(roleTeam);

      expect(rows).toHaveLength(3);
      expect(
        rows.find((row: StoredRow): boolean => {
          return row.id === lower(ownPermission);
        }),
      ).toEqual({
        id: lower(ownPermission),
        permission: Permission.WorkflowViewer,
        scope: PermissionScope.All,
        isBlockPermission: false,
        labelIds: [],
        customRoleId: null,
        teamCustomRoleId: null,
        customRolePermissionId: null,
      });

      const copies: Array<StoredRow> = await copiesOnTeam(roleTeam);

      expect(
        copies.map((row: StoredRow): Omit<StoredRow, "id"> => {
          // Every field but the row's own id, which the database picks.
          const rest: Partial<StoredRow> = { ...row };
          delete rest.id;
          return rest as Omit<StoredRow, "id">;
        }),
      ).toEqual([
        {
          permission: Permission.IncidentMember,
          scope: PermissionScope.All,
          isBlockPermission: false,
          labelIds: [],
          customRoleId: lower(role),
          teamCustomRoleId: lower(given),
          customRolePermissionId: lower(incidents),
        },
        {
          permission: Permission.MonitorViewer,
          scope: PermissionScope.Labels,
          isBlockPermission: false,
          labelIds: [lower(production), lower(staging)].sort(),
          customRoleId: lower(role),
          teamCustomRoleId: lower(given),
          customRolePermissionId: lower(monitors),
        },
      ]);

      // Its accepted members are rebuilt at once; nobody else.
      expect(wasRefreshed(roleMember)).toBe(true);
      expect(wasRefreshed(memberOfBothRoleTeams)).toBe(true);
      expect(wasRefreshed(directMember)).toBe(false);
      expect(wasRefreshed(invitedToRoleTeam)).toBe(false);
      expect(wasRefreshed(otherProjectMember)).toBe(false);
    });

    test("a permission added to a role reaches every team with it, and refreshes their members only", async () => {
      const role: ObjectID = await createRole("Team Lead");
      await giveRole(roleTeam, role);
      await giveRole(secondRoleTeam, role);

      refreshedMembers = [];
      await addToRole(role, Permission.AlertMember);

      for (const team of [roleTeam, secondRoleTeam]) {
        expect(
          (await copiesOnTeam(team)).map((row: StoredRow): string => {
            return row.permission;
          }),
        ).toEqual([Permission.AlertMember]);
      }

      expect(await copiesOnTeam(directTeam)).toEqual([]);
      expect(await permissionCountOf(role)).toBe(1);

      expect(wasRefreshed(roleMember)).toBe(true);
      expect(wasRefreshed(memberOfBothRoleTeams)).toBe(true);
      expect(wasRefreshed(directMember)).toBe(false);

      // The member's requests carry it from now on.
      expect(
        (await heldBy(roleMember)).map((row: HeldRow): string => {
          return row.permission;
        }),
      ).toContain(Permission.AlertMember);
    });

    test("changing a permission in a role - its scope, its labels, the permission itself - changes every team's copy", async () => {
      const role: ObjectID = await createRole("Monitor Watcher");
      const row: ObjectID = await addToRole(role, Permission.MonitorViewer);
      await giveRole(roleTeam, role);
      await giveRole(secondRoleTeam, role);

      refreshedMembers = [];

      const toProduction: QueryDeepPartialEntity<CustomRolePermission> = {
        scope: PermissionScope.Labels,
        labels: labelsOf([production]),
      } as unknown as QueryDeepPartialEntity<CustomRolePermission>;

      await CustomRolePermissionService.updateOneById({
        id: row,
        data: toProduction,
        props: owner,
      });

      for (const team of [roleTeam, secondRoleTeam]) {
        const copies: Array<StoredRow> = await copiesOnTeam(team);
        expect(copies).toHaveLength(1);
        expect(copies[0]).toMatchObject({
          permission: Permission.MonitorViewer,
          scope: PermissionScope.Labels,
          labelIds: [lower(production)],
          customRolePermissionId: lower(row),
        });
      }

      expect(wasRefreshed(roleMember)).toBe(true);
      expect(wasRefreshed(memberOfBothRoleTeams)).toBe(true);

      // What the member reads follows at once: production only.
      expect(
        await monitorsReadBy(await requestOf(roleMember, [roleTeam])),
      ).toEqual([lower(productionMonitor)]);

      const toBoth: QueryDeepPartialEntity<CustomRolePermission> = {
        labels: labelsOf([production, staging]),
      } as unknown as QueryDeepPartialEntity<CustomRolePermission>;

      await CustomRolePermissionService.updateOneById({
        id: row,
        data: toBoth,
        props: owner,
      });

      expect((await copiesOnTeam(roleTeam))[0]!.labelIds).toEqual(
        [lower(production), lower(staging)].sort(),
      );

      await CustomRolePermissionService.updateOneById({
        id: row,
        data: {
          permission: Permission.MonitorMember,
          scope: PermissionScope.All,
          labels: [],
        },
        props: owner,
      });

      for (const team of [roleTeam, secondRoleTeam]) {
        const copies: Array<StoredRow> = await copiesOnTeam(team);
        expect(copies).toHaveLength(1);
        expect(copies[0]).toMatchObject({
          permission: Permission.MonitorMember,
          scope: PermissionScope.All,
          labelIds: [],
        });
      }

      expect(await permissionCountOf(role)).toBe(1);
    });

    test("taking a permission out of a role takes it from every team, in the same delete", async () => {
      const role: ObjectID = await createRole("Team Lead");
      const kept: ObjectID = await addToRole(role, Permission.IncidentMember);
      const removed: ObjectID = await addToRole(role, Permission.AlertMember);
      await giveRole(roleTeam, role);
      await giveRole(secondRoleTeam, role);
      expect(await permissionCountOf(role)).toBe(2);

      refreshedMembers = [];
      await CustomRolePermissionService.deleteOneById({
        id: removed,
        props: owner,
      });

      for (const team of [roleTeam, secondRoleTeam]) {
        expect(
          (await copiesOnTeam(team)).map((row: StoredRow): string | null => {
            return row.customRolePermissionId;
          }),
        ).toEqual([lower(kept)]);
      }

      expect(await permissionCountOf(role)).toBe(1);
      expect(wasRefreshed(roleMember)).toBe(true);
      expect(wasRefreshed(memberOfBothRoleTeams)).toBe(true);
      expect(
        (await heldBy(roleMember)).map((row: HeldRow): string => {
          return row.permission;
        }),
      ).not.toContain(Permission.AlertMember);
    });

    test("taking a role from a team takes its copies from that team only", async () => {
      const ownPermission: ObjectID = await giveDirectly(
        roleTeam,
        Permission.WorkflowViewer,
      );
      const role: ObjectID = await createRole("Team Lead");
      await addToRole(role, Permission.IncidentMember);
      const given: ObjectID = await giveRole(roleTeam, role);
      await giveRole(secondRoleTeam, role);

      refreshedMembers = [];
      await TeamCustomRoleService.deleteOneById({ id: given, props: owner });

      expect(
        (await rowsOfTeam(roleTeam)).map((row: StoredRow): string => {
          return row.id;
        }),
      ).toEqual([lower(ownPermission)]);
      expect(await copiesOnTeam(secondRoleTeam)).toHaveLength(1);
      expect(wasRefreshed(roleMember)).toBe(true);
      expect(wasRefreshed(directMember)).toBe(false);
      expect(
        (await heldBy(roleMember)).map((row: HeldRow): string => {
          return row.permission;
        }),
      ).not.toContain(Permission.IncidentMember);
    });

    test("deleting a role takes its permissions, every team's hold of it and every copy; the teams and their own permissions stay", async () => {
      const ownPermission: ObjectID = await giveDirectly(
        roleTeam,
        Permission.WorkflowViewer,
      );
      const role: ObjectID = await createRole("Team Lead");
      await addToRole(role, Permission.IncidentMember);
      await addToRole(role, Permission.MonitorViewer, {
        scope: PermissionScope.Labels,
        labels: [production],
      });
      await giveRole(roleTeam, role);
      await giveRole(secondRoleTeam, role);

      refreshedMembers = [];
      await CustomRoleService.deleteOneById({ id: role, props: owner });

      expect(await count("CustomRole")).toBe(0);
      expect(await count("CustomRolePermission")).toBe(0);
      expect(await count("CustomRolePermissionLabel")).toBe(0);
      expect(await count("TeamCustomRole")).toBe(0);
      expect(await copiesOnTeam(roleTeam)).toEqual([]);
      expect(await copiesOnTeam(secondRoleTeam)).toEqual([]);
      expect(
        (await rowsOfTeam(roleTeam)).map((row: StoredRow): string => {
          return row.id;
        }),
      ).toEqual([lower(ownPermission)]);
      expect(await count("Team")).toBe(5);

      expect(wasRefreshed(roleMember)).toBe(true);
      expect(wasRefreshed(memberOfBothRoleTeams)).toBe(true);
      expect(wasRefreshed(directMember)).toBe(false);
    });

    test("a deleted team takes its hold of the role and the copies with it", async () => {
      const role: ObjectID = await createRole("Team Lead");
      await addToRole(role, Permission.IncidentMember);
      await giveRole(roleTeam, role);
      await giveRole(secondRoleTeam, role);

      await database.query(`DELETE FROM "${schema}"."Team" WHERE "_id" = $1`, [
        roleTeam.toString(),
      ]);

      expect(await count("TeamCustomRole")).toBe(1);
      expect(await copiesOnTeam(roleTeam)).toEqual([]);
      expect(await copiesOnTeam(secondRoleTeam)).toHaveLength(1);
    });

    test("a deleted label goes from the role's permission and every team's copy, as from a direct one", async () => {
      const role: ObjectID = await createRole("Monitor Watcher");
      await addToRole(role, Permission.MonitorViewer, {
        scope: PermissionScope.Labels,
        labels: [production, staging],
      });
      await giveRole(roleTeam, role);
      await giveDirectly(directTeam, Permission.MonitorViewer, {
        scope: PermissionScope.Labels,
        labels: [production, staging],
      });

      await database.query(`DELETE FROM "${schema}"."Label" WHERE "_id" = $1`, [
        staging.toString(),
      ]);

      expect((await copiesOnTeam(roleTeam))[0]!.labelIds).toEqual([
        lower(production),
      ]);
      expect(await heldBy(roleMember)).toEqual(await heldBy(directMember));
    });

    test("a sync changes nothing when the copies are already right, and puts back what was lost or added behind the role's back", async () => {
      const role: ObjectID = await createRole("Team Lead");
      await addToRole(role, Permission.IncidentMember);
      await addToRole(role, Permission.AlertMember);
      const given: ObjectID = await giveRole(roleTeam, role);

      expect(
        await CustomRoleSync.syncRoles({
          projectId: projectId,
          customRoleIds: [role],
        }),
      ).toEqual([]);

      const before: Array<StoredRow> = await copiesOnTeam(roleTeam);

      // One copy lost, and a stray one claiming to be the role's.
      await database.query(
        `DELETE FROM "${schema}"."TeamPermission" WHERE "_id" = $1`,
        [before[0]!.id],
      );
      await insert("TeamPermission", {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        teamId: roleTeam.toString(),
        permission: Permission.ProjectAdmin,
        scope: PermissionScope.All,
        isBlockPermission: false,
        customRoleId: role.toString(),
        teamCustomRoleId: given.toString(),
        customRolePermissionId: before[1]!.customRolePermissionId,
        version: 1,
      });

      const changed: Array<ObjectID> = await CustomRoleSync.syncRoles({
        projectId: projectId,
        customRoleIds: [role],
      });

      expect(changed.map(lower)).toEqual([lower(roleTeam)]);

      const after: Array<StoredRow> = await copiesOnTeam(roleTeam);

      expect(
        after.map((row: StoredRow): string => {
          return row.permission;
        }),
      ).toEqual([Permission.AlertMember, Permission.IncidentMember]);
    });

    test("two syncs of a project run one at a time, and end with what the role holds", async () => {
      const role: ObjectID = await createRole("Team Lead");
      await addToRole(role, Permission.IncidentMember);
      await giveRole(roleTeam, role);
      await database.query(
        `DELETE FROM "${schema}"."TeamPermission" WHERE "teamId" = $1`,
        [roleTeam.toString()],
      );
      locks.events = [];

      await Promise.all([
        CustomRoleSync.syncRoles({ projectId, customRoleIds: [role] }),
        CustomRoleSync.syncRoles({ projectId, customRoleIds: [role] }),
      ]);

      // The second waited for the first to finish before it read anything.
      const label: string = `${CustomRoleSync.LOCK_NAMESPACE}/${projectId.toString()}`;
      expect(locks.events).toEqual([
        `lock:${label}`,
        `wait:${label}`,
        `release:${label}`,
        `lock:${label}`,
        `release:${label}`,
      ]);
      expect(await copiesOnTeam(roleTeam)).toHaveLength(1);
    });
  });

  describe("nobody gives through a role what they could not give directly", () => {
    test("Project Owner is never part of a role, not even for a project owner", async () => {
      const role: ObjectID = await createRole("Everything");

      expect(
        await refusal(() => {
          return addToRole(role, Permission.ProjectOwner);
        }),
      ).toBe(PROJECT_OWNER_NOT_IN_A_CUSTOM_ROLE_MESSAGE);
      expect(await count("CustomRolePermission")).toBe(0);
    });

    test("someone who may change what teams can do puts in a role only what they hold, at their scope", async () => {
      const role: ObjectID = await createRole("Incident Responder", teamEditor);

      await addToRole(role, Permission.IncidentMember, { props: teamEditor });
      await addToRole(role, Permission.MonitorViewer, {
        scope: PermissionScope.Labels,
        labels: [production],
        props: teamEditor,
      });

      for (const attempt of [
        (): Promise<ObjectID> => {
          return addToRole(role, Permission.ProjectAdmin, {
            props: teamEditor,
          });
        },
        (): Promise<ObjectID> => {
          return addToRole(role, Permission.IncidentAdmin, {
            props: teamEditor,
          });
        },
        // Held for production only: not for the whole project, nor for staging.
        (): Promise<ObjectID> => {
          return addToRole(role, Permission.MonitorMember, {
            props: teamEditor,
          });
        },
      ]) {
        expect(await refusal(attempt)).toContain("You cannot grant");
      }

      // Monitor Viewer is held for production only.
      const otherRole: ObjectID = await createRole(
        "Monitor Watcher",
        teamEditor,
      );
      expect(
        await refusal(() => {
          return addToRole(otherRole, Permission.MonitorViewer, {
            props: teamEditor,
          });
        }),
      ).toContain("You cannot grant Monitor Viewer");
      expect(
        await refusal(() => {
          return addToRole(otherRole, Permission.MonitorViewer, {
            scope: PermissionScope.Labels,
            labels: [staging],
            props: teamEditor,
          });
        }),
      ).toContain("You cannot grant Monitor Viewer");

      expect(await permissionCountOf(role)).toBe(2);
    });

    test("widening a role's permission past what the editor holds is refused, and the copies stay as they were", async () => {
      const role: ObjectID = await createRole("Monitor Watcher");
      const row: ObjectID = await addToRole(role, Permission.MonitorViewer, {
        scope: PermissionScope.Labels,
        labels: [production],
      });
      await giveRole(roleTeam, role);

      expect(
        await refusal(() => {
          return CustomRolePermissionService.updateOneById({
            id: row,
            data: { scope: PermissionScope.All, labels: [] },
            props: teamEditor,
          });
        }),
      ).toContain("You cannot grant Monitor Viewer");

      expect(
        await refusal(() => {
          return CustomRolePermissionService.updateOneById({
            id: row,
            data: {
              permission: Permission.ProjectAdmin,
              scope: PermissionScope.All,
              labels: [],
            },
            props: teamEditor,
          });
        }),
      ).toContain("You cannot grant Project Admin");

      const copies: Array<StoredRow> = await copiesOnTeam(roleTeam);
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({
        permission: Permission.MonitorViewer,
        scope: PermissionScope.Labels,
        labelIds: [lower(production)],
      });
    });

    test("a role holding a permission the giver can't give is not given, and the team holds nothing of it", async () => {
      const role: ObjectID = await createRole("Admins");
      await addToRole(role, Permission.ProjectAdmin);
      await addToRole(role, Permission.IncidentMember);

      const message: string = await refusal(() => {
        return giveRole(roleTeam, role, teamEditor);
      });

      expect(message).toBe(
        "You can't give Admins: it has Project Admin, and your own access doesn't include that permission at the same or a broader scope.",
      );
      expect(await count("TeamCustomRole")).toBe(0);
      expect(await copiesOnTeam(roleTeam)).toEqual([]);

      // A role of what they hold is theirs to give.
      const theirs: ObjectID = await createRole("Responders");
      await addToRole(theirs, Permission.IncidentMember);
      await giveRole(roleTeam, theirs, teamEditor);
      expect(await copiesOnTeam(roleTeam)).toHaveLength(1);
    });

    test("someone blocked from a permission puts it in no role and gives no role holding it", async () => {
      const blocked: DatabaseCommonInteractionProps = propsHolding([
        grant(Permission.ProjectAdmin, { scope: PermissionScope.All }),
        grant(Permission.IncidentAdmin, { scope: PermissionScope.All }),
        grant(Permission.IncidentAdmin, {
          isBlockPermission: true,
          labelIds: [],
        }),
      ]);

      const role: ObjectID = await createRole("Incident Admins");
      expect(
        await refusal(() => {
          return addToRole(role, Permission.IncidentAdmin, { props: blocked });
        }),
      ).toContain("Incident Admin");

      await addToRole(role, Permission.IncidentAdmin);
      expect(
        await refusal(() => {
          return giveRole(roleTeam, role, blocked);
        }),
      ).toContain("Incident Admin");
    });

    test("inviting someone to a team with a role is held to the role's permissions", async () => {
      const role: ObjectID = await createRole("Admins");
      await addToRole(role, Permission.ProjectAdmin);
      await giveRole(roleTeam, role);

      // The editor may invite, but could not give Project Admin: not to this team.
      expect(
        await refusal(() => {
          return TeamPermissionService.assertCanGrantTeamPermissions({
            teamId: roleTeam,
            projectId: projectId,
            props: teamEditor,
          });
        }),
      ).toContain("Project Admin");

      await TeamPermissionService.assertCanGrantTeamPermissions({
        teamId: roleTeam,
        projectId: projectId,
        props: admin,
      });
    });

    test("a member who may not change what teams can do makes no role, adds nothing to one and gives none", async () => {
      const member: DatabaseCommonInteractionProps = propsHolding([
        grant(Permission.ProjectMember, { scope: PermissionScope.All }),
      ]);
      const role: ObjectID = await createRole("Responders");
      await addToRole(role, Permission.IncidentMember);

      expect(
        await refusal(() => {
          return createRole("Mine", member);
        }),
      ).toContain("permission");
      expect(
        await refusal(() => {
          return addToRole(role, Permission.IncidentMember, { props: member });
        }),
      ).toContain("permission");
      expect(
        await refusal(() => {
          return giveRole(roleTeam, role, member);
        }),
      ).toContain("permission");
      expect(await count("TeamCustomRole")).toBe(0);
    });
  });

  describe("a role stays in its project", () => {
    test("a role is not given to another project's team, nor a team another project's role", async () => {
      const role: ObjectID = await createRole("Responders");
      await addToRole(role, Permission.IncidentMember);

      expect(
        await refusal(() => {
          return giveRole(otherProjectTeam, role);
        }),
      ).toContain("references records that are not in this project");

      const theirs: DatabaseCommonInteractionProps = propsHolding(
        [grant(Permission.ProjectOwner, { scope: PermissionScope.All })],
        otherProjectId,
      );
      const given: TeamCustomRole = new TeamCustomRole();
      given.projectId = otherProjectId;
      given.teamId = otherProjectTeam;
      given.customRoleId = role;

      expect(
        await refusal(() => {
          return TeamCustomRoleService.create({ data: given, props: theirs });
        }),
      ).toContain("references records that are not in this project");

      expect(await count("TeamCustomRole")).toBe(0);
      expect(await rowsOfTeam(otherProjectTeam)).toEqual([]);
    });

    test("a role's permission is limited to the project's own labels", async () => {
      const role: ObjectID = await createRole("Monitor Watcher");

      expect(
        await refusal(() => {
          return addToRole(role, Permission.MonitorViewer, {
            scope: PermissionScope.Labels,
            labels: [otherProjectLabel],
          });
        }),
      ).toContain("references records that are not in this project");
      expect(await count("CustomRolePermission")).toBe(0);
    });

    test("Owners and Admin are never given a role", async () => {
      const role: ObjectID = await createRole("Responders");

      expect(
        await refusal(() => {
          return giveRole(ownersTeam, role);
        }),
      ).toBe(TEAM_NOT_EDITABLE_FOR_ROLES_MESSAGE);
    });

    /*
     * The role's page gives it from a team picker, which sends the team as
     * the relation - `team: { _id }` - not as teamId. The checks hold the
     * team the row is written with, whichever name the request uses.
     */
    test("a give naming the team by its relation is checked as one naming teamId; two names for two teams are refused", async () => {
      const role: ObjectID = await createRole("Responders");
      await addToRole(role, Permission.IncidentMember);

      const teamNamed: (teamId: ObjectID) => Team = (
        teamId: ObjectID,
      ): Team => {
        const team: Team = new Team();
        team._id = teamId.toString();
        return team;
      };

      const toOwners: TeamCustomRole = new TeamCustomRole();
      toOwners.projectId = projectId;
      toOwners.team = teamNamed(ownersTeam);
      toOwners.customRoleId = role;

      expect(
        await refusal(() => {
          return TeamCustomRoleService.create({ data: toOwners, props: owner });
        }),
      ).toBe(TEAM_NOT_EDITABLE_FOR_ROLES_MESSAGE);

      // A team that may take the role under teamId, Owners under the relation.
      const twoTeams: TeamCustomRole = new TeamCustomRole();
      twoTeams.projectId = projectId;
      twoTeams.teamId = roleTeam;
      twoTeams.team = teamNamed(ownersTeam);
      twoTeams.customRoleId = role;

      expect(
        await refusal(() => {
          return TeamCustomRoleService.create({ data: twoTeams, props: owner });
        }),
      ).toContain("Conflicting");

      const toOtherProject: TeamCustomRole = new TeamCustomRole();
      toOtherProject.projectId = projectId;
      toOtherProject.team = teamNamed(otherProjectTeam);
      toOtherProject.customRoleId = role;

      expect(
        await refusal(() => {
          return TeamCustomRoleService.create({
            data: toOtherProject,
            props: owner,
          });
        }),
      ).toContain("references records that are not in this project");

      expect(await count("TeamCustomRole")).toBe(0);
      expect(await copiesOnTeam(ownersTeam)).toEqual([]);

      // The relation alone, for a team that can take it: given, as from teamId.
      const byRelation: TeamCustomRole = new TeamCustomRole();
      byRelation.projectId = projectId;
      byRelation.team = teamNamed(roleTeam);
      byRelation.customRoleId = role;

      await TeamCustomRoleService.create({ data: byRelation, props: owner });

      expect(
        (await copiesOnTeam(roleTeam)).map((row: StoredRow): string => {
          return String(row.permission);
        }),
      ).toEqual([Permission.IncidentMember]);
      expect(wasRefreshed(roleMember)).toBe(true);
    });
  });

  describe("a team's copies are the role's", () => {
    test("a copy is not changed or removed on its own, even by a project admin; the role names itself in the refusal", async () => {
      const role: ObjectID = await createRole("Incident Responder");
      await addToRole(role, Permission.IncidentMember);
      await giveRole(roleTeam, role);
      const copy: StoredRow = (await copiesOnTeam(roleTeam))[0]!;

      const expected: string =
        "Incident Member comes with the custom role Incident Responder. Change the role, or take the role away from the team.";

      expect(
        await refusal(() => {
          return TeamPermissionService.updateOneById({
            id: new ObjectID(copy.id),
            data: { scope: PermissionScope.Owned },
            props: admin,
          });
        }),
      ).toBe(expected);
      expect(
        await refusal(() => {
          return TeamPermissionService.deleteOneById({
            id: new ObjectID(copy.id),
            props: admin,
          });
        }),
      ).toBe(expected);
      expect(
        await refusal(() => {
          return TeamPermissionService.deleteBy({
            query: { teamId: roleTeam },
            limit: 100,
            skip: 0,
            props: admin,
          });
        }),
      ).toBe(expected);

      expect(await copiesOnTeam(roleTeam)).toHaveLength(1);
    });

    test("a request may not write a copy's marks", async () => {
      const role: ObjectID = await createRole("Incident Responder");
      const row: TeamPermission = new TeamPermission();
      row.projectId = projectId;
      row.teamId = roleTeam;
      row.permission = Permission.IncidentMember;
      row.customRoleId = role;

      // Not even a project owner, who may give any permission.
      expect(
        await refusal(() => {
          return TeamPermissionService.create({ data: row, props: owner });
        }),
      ).toContain("customRoleId");
      expect(await rowsOfTeam(roleTeam)).toEqual([]);
    });

    test("a team may hold a permission of its own beside the role's copy, and keeps it when the role goes", async () => {
      const role: ObjectID = await createRole("Incident Responder");
      await addToRole(role, Permission.IncidentMember);
      const given: ObjectID = await giveRole(roleTeam, role);

      const own: ObjectID = await giveDirectly(
        roleTeam,
        Permission.IncidentMember,
      );

      // A second one of its own is still refused, as before.
      expect(
        await refusal(() => {
          return giveDirectly(roleTeam, Permission.IncidentMember);
        }),
      ).toBe("This permission is already assigned to this team.");

      await TeamCustomRoleService.deleteOneById({ id: given, props: owner });

      expect(
        (await rowsOfTeam(roleTeam)).map((row: StoredRow): string => {
          return row.id;
        }),
      ).toEqual([lower(own)]);
      expect(
        (await heldBy(roleMember)).map((row: HeldRow): string => {
          return row.permission;
        }),
      ).toContain(Permission.IncidentMember);
    });

    test("a block with labels sits beside a role's labelled permission of the same kind", async () => {
      const role: ObjectID = await createRole("Monitor Watcher");
      await addToRole(role, Permission.MonitorViewer, {
        scope: PermissionScope.Labels,
        labels: [production],
      });
      await giveRole(roleTeam, role);

      await giveDirectly(roleTeam, Permission.MonitorViewer, {
        isBlockPermission: true,
        scope: PermissionScope.Labels,
        labels: [staging],
      });

      expect(await rowsOfTeam(roleTeam)).toHaveLength(2);
    });
  });

  describe("names", () => {
    test("a name is unique in the project whatever its case and spacing, and never a built-in role's", async () => {
      await createRole("Incident Responder");

      for (const name of [
        "incident responder",
        "  Incident   Responder ",
        "INCIDENT RESPONDER",
      ]) {
        expect(
          await refusal(() => {
            return createRole(name);
          }),
        ).toContain("There is already a role called");
      }

      expect(
        await refusal(() => {
          return createRole("project admin");
        }),
      ).toBe(
        "Project Admin is a built-in role. Pick another name for your role.",
      );
      expect(
        await refusal(() => {
          return createRole("   ");
        }),
      ).toBe("Give the role a name.");

      const lead: ObjectID = await createRole("  Team   Lead ");
      const stored: Array<{ name: string }> = await database.query(
        `SELECT "name" FROM "${schema}"."CustomRole" WHERE "_id" = $1`,
        [lead.toString()],
      );
      expect(stored[0]!.name).toBe("Team Lead");

      expect(
        await refusal(() => {
          return CustomRoleService.updateOneById({
            id: lead,
            data: { name: "incident RESPONDER" },
            props: owner,
          });
        }),
      ).toContain("There is already a role called");

      // Renaming a role to its own name, cased differently, is fine.
      await CustomRoleService.updateOneById({
        id: lead,
        data: { name: "team lead" },
        props: owner,
      });

      // The same name in another project is that project's.
      const theirs: CustomRole = new CustomRole();
      theirs.projectId = otherProjectId;
      theirs.name = "Incident Responder";
      await CustomRoleService.create({
        data: theirs,
        props: propsHolding(
          [grant(Permission.ProjectOwner, { scope: PermissionScope.All })],
          otherProjectId,
        ),
      });
      expect(await count("CustomRole")).toBe(3);
    });

    test("a role's permission count is OneUptime's: what a create sends is ignored, and a change is refused", async () => {
      const role: CustomRole = new CustomRole();
      role.projectId = projectId;
      role.name = "Counted";
      role.permissionCount = 99;

      const created: ObjectID = (
        await CustomRoleService.create({ data: role, props: owner })
      ).id!;

      expect(await permissionCountOf(created)).toBe(0);

      expect(
        await refusal(() => {
          return CustomRoleService.updateOneById({
            id: created,
            data: { permissionCount: 5 },
            props: owner,
          });
        }),
      ).toContain("permissionCount");

      await addToRole(created, Permission.IncidentMember);
      expect(await permissionCountOf(created)).toBe(1);
    });
  });

  describe("what was there before the migration", () => {
    test("a team permission written before custom roles is a direct one: untouched by syncs, and changed as before", async () => {
      const legacy: ObjectID = ObjectID.generate();
      await insert("TeamPermission", {
        _id: legacy.toString(),
        projectId: projectId.toString(),
        teamId: roleTeam.toString(),
        permission: Permission.IncidentMember,
        isBlockPermission: false,
        version: 1,
      });

      const role: ObjectID = await createRole("Team Lead");
      await addToRole(role, Permission.AlertMember);
      await giveRole(roleTeam, role);
      await CustomRoleSync.syncRoles({ projectId, customRoleIds: [role] });

      const legacyRow: StoredRow | undefined = (
        await rowsOfTeam(roleTeam)
      ).find((row: StoredRow): boolean => {
        return row.id === lower(legacy);
      });

      expect(legacyRow).toEqual({
        id: lower(legacy),
        permission: Permission.IncidentMember,
        scope: PermissionScope.All,
        isBlockPermission: false,
        labelIds: [],
        customRoleId: null,
        teamCustomRoleId: null,
        customRolePermissionId: null,
      });

      await TeamPermissionService.updateOneById({
        id: legacy,
        data: { scope: PermissionScope.Owned },
        props: owner,
      });
      await TeamPermissionService.deleteOneById({ id: legacy, props: owner });

      expect(
        (await rowsOfTeam(roleTeam)).map((row: StoredRow): string => {
          return row.permission;
        }),
      ).toEqual([Permission.AlertMember]);
    });

    test("root reads of team permissions, as every check makes them, see the copies like any other row", async () => {
      const role: ObjectID = await createRole("Team Lead");
      await addToRole(role, Permission.AlertMember);
      await giveRole(roleTeam, role);

      const rows: Array<TeamPermission> = await TeamPermissionService.findBy({
        query: { teamId: roleTeam, projectId: projectId },
        select: { permission: true, scope: true },
        skip: 0,
        limit: 10,
        props: ROOT,
      });

      expect(
        rows.map((row: TeamPermission): string => {
          return row.permission!;
        }),
      ).toEqual([Permission.AlertMember]);
    });
  });
});
