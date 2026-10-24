import Entities from "../../../Models/DatabaseModels/Index";
import ApiKeyCustomRole from "../../../Models/DatabaseModels/ApiKeyCustomRole";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import CacheGenerations from "../../../Server/Infrastructure/CacheGenerations";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import ApiKeyCustomRoleService from "../../../Server/Services/ApiKeyCustomRoleService";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import CustomRolePermissionService from "../../../Server/Services/CustomRolePermissionService";
import CustomRoleService from "../../../Server/Services/CustomRoleService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import TeamCustomRoleService from "../../../Server/Services/TeamCustomRoleService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import APIKeyAccessPermission from "../../../Server/Utils/APIKey/AccessPermission";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  API_KEY_ALREADY_HAS_ROLE_MESSAGE,
  CUSTOM_ROLE_NOT_READABLE_MESSAGE,
  getApiKeyRoleCopyChangeRefusedMessage,
  getCustomRoleGrantRefusedMessage,
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
 * CUSTOM ROLES GIVEN TO API KEYS, AGAINST A MIGRATED POSTGRES.
 *
 * Opt in with RUN_POSTGRES_API_KEY_CUSTOM_ROLE_TESTS=true against a database
 * the registered migrations (1806500000000-AddApiKeyCustomRoles and
 * 1806510000000-AddApiKeyPermissionCustomRoleLinks included) have been
 * applied to, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_API_KEY_CUSTOM_ROLE_TESTS=true \
 *   API_KEY_CUSTOM_ROLE_TEST_DATABASE_HOST=127.0.0.1 \
 *   API_KEY_CUSTOM_ROLE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/ApiKeyCustomRolesPostgres.test.ts --forceExit
 *
 * Without the flag the suite is skipped (the Common test job's Postgres is
 * not migrated); the Postgres Schema Drift workflow runs it.
 *
 * What it holds, with the production services, hooks, the sync, the API key
 * permission cache and the permission layer running unchanged:
 *
 *   - a role gives a key exactly what giving the key the same permissions
 *     directly gives: the permissions an API key request carries
 *     (APIKeyAccessPermission, as the middleware builds them) are equal,
 *     and so is what each key may read - alone, beside the key's own
 *     permissions, under a block of the key's, limited to labels;
 *   - a permission the role limits to what is owned gives a key nothing;
 *   - every change - giving the role, a permission added to it, changed,
 *     taken out, the role taken from the key, the role deleted - reaches
 *     the key's very next request, though its permissions were cached, and
 *     starts a new generation of the project's cached key permissions for
 *     every other server;
 *   - nobody gives a key through a role what they could not give it
 *     directly, nor a role they may not read; a role and a key never meet
 *     across projects; a key's copies are changed only through the role;
 *   - taking anything away (the role from the key, the role, the role's
 *     permission, the key) removes the copies in the same DELETE, as the
 *     migrations' foreign keys declare;
 *   - the key permissions that existed before the migration are untouched.
 *
 * The tables run in a uniquely named schema of structure-only clones of the
 * migrated tables; the foreign keys between them are copied from the
 * migrated tables' own definitions, so a cascade seen here is the one the
 * migrations declared. Only the cache (Valkey), the lock, realtime, workflow
 * and audit side effects are stood in for.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_API_KEY_CUSTOM_ROLE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "User",
  "Label",
  "ApiKey",
  "ApiKeyPermission",
  "ApiKeyPermissionLabel",
  "CustomRole",
  "CustomRolePermission",
  "CustomRolePermissionLabel",
  "ApiKeyCustomRole",
  "Team",
  "TeamMember",
  "TeamCustomRole",
  "TeamPermission",
  "TeamPermissionLabel",
  "Monitor",
  "MonitorLabel",
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

// An API key permission row as Postgres holds it, labels included.
interface StoredRow {
  id: string;
  permission: string;
  isBlockPermission: boolean;
  labelIds: Array<string>;
  customRoleId: string | null;
  apiKeyCustomRoleId: string | null;
  customRolePermissionId: string | null;
}

// A permission, as an API key request carries it, for comparing.
interface HeldRow {
  permission: string;
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

describePostgres(
  "custom roles given to API keys, against a migrated Postgres",
  () => {
    const schema: string = `api_key_roles_${ObjectID.generate()
      .toString()
      .split("-")
      .join("")}`;

    const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();
    const locks: InMemoryLocks = new InMemoryLocks();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    const production: ObjectID = ObjectID.generate();
    const staging: ObjectID = ObjectID.generate();

    // Given roles in the tests.
    const roleKey: ObjectID = ObjectID.generate();
    const secondRoleKey: ObjectID = ObjectID.generate();
    // Given the same permissions directly, to compare with.
    const directKey: ObjectID = ObjectID.generate();
    const otherProjectKey: ObjectID = ObjectID.generate();

    const productionMonitor: ObjectID = ObjectID.generate();
    const stagingMonitor: ObjectID = ObjectID.generate();
    const unlabelledMonitor: ObjectID = ObjectID.generate();

    const monitorService: DatabaseService<Monitor> = new DatabaseService(
      Monitor,
    );

    const cache: Map<string, JSONObject> = new Map<string, JSONObject>();
    // The projects whose cached key permissions every server was told to forget.
    let forgottenProjects: Array<string> = [];

    let database: DataSource;

    const owner: DatabaseCommonInteractionProps = propsHolding([
      grant(Permission.ProjectOwner, { scope: PermissionScope.All }),
    ]);

    const admin: DatabaseCommonInteractionProps = propsHolding([
      grant(Permission.ProjectAdmin, { scope: PermissionScope.All }),
    ]);

    /*
     * May change what a key can do and read the project's roles, and holds
     * Incident Member for the whole project and Monitor Viewer for production
     * only - nothing else.
     */
    const keyEditor: DatabaseCommonInteractionProps = propsHolding([
      grant(Permission.EditProjectApiKeyPermissions, {
        scope: PermissionScope.All,
      }),
      grant(Permission.ReadProjectApiKey, { scope: PermissionScope.All }),
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
        host:
          process.env["API_KEY_CUSTOM_ROLE_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["API_KEY_CUSTOM_ROLE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["API_KEY_CUSTOM_ROLE_TEST_DATABASE_NAME"] ||
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

      // The key copies' foreign keys are among them, as the migration declared.
      expect(
        foreignKeys
          .filter((foreignKey: ForeignKeyRow): boolean => {
            return foreignKey.table === "ApiKeyPermission";
          })
          .map((foreignKey: ForeignKeyRow): string => {
            return foreignKey.referencedTable;
          })
          .sort(),
      ).toEqual(
        expect.arrayContaining([
          "ApiKey",
          "ApiKeyCustomRole",
          "CustomRole",
          "CustomRolePermission",
        ]),
      );

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

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
          },
        );
      jest
        .spyOn(GlobalCache, "getJSONObject")
        .mockImplementation(
          async (
            namespace: string,
            key: string,
          ): Promise<JSONObject | null> => {
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

      // Every new generation of a project's cached key permissions, as the servers would see it.
      const bump: (keys: Array<string>) => Promise<void> =
        CacheGenerations.prototype.bump;
      jest
        .spyOn(CacheGenerations.prototype, "bump")
        .mockImplementation(async function (
          this: CacheGenerations,
          keys: Array<string>,
        ): Promise<void> {
          forgottenProjects.push(...keys);
          await bump.call(this, keys);
        });

      locks.install();

      jest.spyOn(AuditLogService, "recordCreate").mockResolvedValue(undefined);
      jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue(undefined);
      jest.spyOn(AuditLogService, "recordDelete").mockResolvedValue(undefined);

      for (const service of [
        CustomRoleService,
        CustomRolePermissionService,
        ApiKeyCustomRoleService,
        ApiKeyPermissionService,
        ApiKeyService,
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
      forgottenProjects = [];
      ApiKeyPermissionService.clearCache();

      await database.query(
        [...TABLES]
          .reverse()
          .map((table: string): string => {
            return `DELETE FROM "${schema}"."${table}"`;
          })
          .join("; "),
      );

      for (const [id, name] of [
        [projectId, "Key roles project"],
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

      for (const [id, project, name] of [
        [roleKey, projectId, "Deploy reporter"],
        [secondRoleKey, projectId, "Status bot"],
        [directKey, projectId, "Direct"],
        [otherProjectKey, otherProjectId, "Theirs"],
      ] as Array<[ObjectID, ObjectID, string]>) {
        await insert("ApiKey", {
          _id: id.toString(),
          projectId: project.toString(),
          name: name,
          slug: `key-${id.toString()}`,
          apiKey: ObjectID.generate().toString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          version: 1,
        });
      }

      for (const [id, label] of [
        [productionMonitor, production],
        [stagingMonitor, staging],
        [unlabelledMonitor, null],
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

    async function createRole(name: string): Promise<ObjectID> {
      const role: CustomRole = new CustomRole();
      role.projectId = projectId;
      role.name = name;

      return (
        await CustomRoleService.create({
          data: role,
          props: owner,
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

    async function giveRoleToKey(
      apiKeyId: ObjectID,
      customRoleId: ObjectID,
      props: DatabaseCommonInteractionProps = owner,
    ): Promise<ObjectID> {
      const given: ApiKeyCustomRole = new ApiKeyCustomRole();
      given.projectId = projectId;
      given.apiKeyId = apiKeyId;
      given.customRoleId = customRoleId;

      return (
        await ApiKeyCustomRoleService.create({
          data: given,
          props: props,
        })
      ).id!;
    }

    async function giveKeyDirectly(
      apiKeyId: ObjectID,
      permission: Permission,
      data: {
        labels?: Array<ObjectID> | undefined;
        isBlockPermission?: boolean | undefined;
        props?: DatabaseCommonInteractionProps | undefined;
      } = {},
    ): Promise<ObjectID> {
      const row: ApiKeyPermission = new ApiKeyPermission();
      row.projectId = projectId;
      row.apiKeyId = apiKeyId;
      row.permission = permission;
      row.isBlockPermission = Boolean(data.isBlockPermission);

      if (data.labels) {
        row.labels = labelsOf(data.labels);
      }

      return (
        await ApiKeyPermissionService.create({
          data: row,
          props: data.props || owner,
        })
      ).id!;
    }

    /*
     * Every permission row of a key, as Postgres holds it: by permission,
     * the key's own row before a role's copy of the same permission (ids are
     * random, so they alone would order the two by chance).
     */
    async function rowsOfKey(apiKeyId: ObjectID): Promise<Array<StoredRow>> {
      const rows: Array<{
        _id: string;
        permission: string;
        isBlockPermission: boolean;
        customRoleId: string | null;
        apiKeyCustomRoleId: string | null;
        customRolePermissionId: string | null;
      }> = await database.query(
        `SELECT "_id", "permission", "isBlockPermission", "customRoleId", "apiKeyCustomRoleId", "customRolePermissionId"
         FROM "${schema}"."ApiKeyPermission" WHERE "apiKeyId" = $1 ORDER BY "permission", ("apiKeyCustomRoleId" IS NOT NULL), "_id"`,
        [apiKeyId.toString()],
      );

      const result: Array<StoredRow> = [];

      for (const row of rows) {
        const labels: Array<{ labelId: string }> = await database.query(
          `SELECT "labelId" FROM "${schema}"."ApiKeyPermissionLabel" WHERE "apiKeyPermissionId" = $1 ORDER BY "labelId"`,
          [row._id],
        );

        result.push({
          id: row._id,
          permission: row.permission,
          isBlockPermission: row.isBlockPermission,
          labelIds: labels.map((label: { labelId: string }): string => {
            return label.labelId;
          }),
          customRoleId: row.customRoleId,
          apiKeyCustomRoleId: row.apiKeyCustomRoleId,
          customRolePermissionId: row.customRolePermissionId,
        });
      }

      return result;
    }

    async function copiesOnKey(apiKeyId: ObjectID): Promise<Array<StoredRow>> {
      return (await rowsOfKey(apiKeyId)).filter((row: StoredRow): boolean => {
        return Boolean(row.customRoleId);
      });
    }

    async function count(table: string): Promise<number> {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*)::text AS "count" FROM "${schema}"."${table}"`,
      );

      return Number(rows[0]?.count || 0);
    }

    /*
     * The permissions a request made with the key carries, as the middleware
     * builds them (ProjectAuthorization): read through the key permission
     * cache, never cleared here - so a change a test makes reaches it only if
     * the change itself made the cache forget.
     */
    async function heldByKey(apiKeyId: ObjectID): Promise<Array<HeldRow>> {
      const permission: UserTenantAccessPermission =
        await APIKeyAccessPermission.getApiTenantAccessPermission(
          projectId,
          apiKeyId,
        );

      // The defaults every key carries, whatever it was given.
      const defaults: Array<Permission> =
        UserPermissionUtil.getDefaultUserTenantAccessPermission(
          projectId,
        ).permissions.map((row: UserPermission): Permission => {
          return row.permission;
        });

      return permission.permissions
        .filter((row: UserPermission): boolean => {
          return !defaults.includes(row.permission);
        })
        .map((row: UserPermission): HeldRow => {
          return {
            permission: row.permission,
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

    // The props a request made with the key carries.
    async function requestWithKey(
      apiKeyId: ObjectID,
    ): Promise<DatabaseCommonInteractionProps> {
      const permission: UserTenantAccessPermission =
        await APIKeyAccessPermission.getApiTenantAccessPermission(
          projectId,
          apiKeyId,
        );

      return {
        tenantId: projectId,
        userType: UserType.API,
        ...ON_HIGHEST_PLAN,
        userGlobalAccessPermission:
          await APIKeyAccessPermission.getDefaultApiGlobalPermission(projectId),
        userTenantAccessPermission: {
          [projectId.toString()]: permission,
        },
      };
    }

    // The monitors a request made with the key reads, or null when it may read none.
    async function monitorsReadByKey(
      apiKeyId: ObjectID,
    ): Promise<Array<string> | null> {
      try {
        const monitors: Array<Monitor> = await monitorService.findBy({
          query: {},
          select: { _id: true },
          skip: 0,
          limit: 50,
          props: await requestWithKey(apiKeyId),
        });

        return monitors
          .map((monitor: Monitor): string => {
            return monitor.id!.toString().toLowerCase();
          })
          .sort();
      } catch (err) {
        if ((err as Exception).message?.includes("permission")) {
          return null;
        }

        throw err;
      }
    }

    async function refusal(work: () => Promise<unknown>): Promise<string> {
      try {
        await work();
      } catch (err) {
        return (err as Exception).message || String(err);
      }

      throw new Error("Expected a refusal, but the write went through.");
    }

    const lower: (id: ObjectID) => string = (id: ObjectID): string => {
      return id.toString().toLowerCase();
    };

    function wasForgotten(): boolean {
      return forgottenProjects.includes(lower(projectId));
    }

    describe("a role gives a key exactly what giving the same permissions directly gives", () => {
      test("the permissions a request with the key carries are equal, and so is what each key may read", async () => {
        const role: ObjectID = await createRole("Deploy Reporter");
        await addToRole(role, Permission.IncidentMember);
        await addToRole(role, Permission.MonitorViewer, {
          scope: PermissionScope.Labels,
          labels: [production],
        });

        await giveRoleToKey(roleKey, role);
        await giveKeyDirectly(directKey, Permission.IncidentMember);
        await giveKeyDirectly(directKey, Permission.MonitorViewer, {
          labels: [production],
        });

        const throughRole: Array<HeldRow> = await heldByKey(roleKey);

        expect(throughRole).toEqual(await heldByKey(directKey));
        expect(throughRole).toEqual(
          expect.arrayContaining([
            {
              permission: Permission.MonitorViewer,
              labelIds: [lower(production)],
              isBlockPermission: false,
            },
            {
              permission: Permission.IncidentMember,
              labelIds: [],
              isBlockPermission: false,
            },
          ]),
        );

        // Limited to the production label, through the role as directly.
        expect(await monitorsReadByKey(roleKey)).toEqual([
          lower(productionMonitor),
        ]);
        expect(await monitorsReadByKey(directKey)).toEqual([
          lower(productionMonitor),
        ]);
      });

      test("a role's permission for the whole project reaches every monitor", async () => {
        const role: ObjectID = await createRole("Watcher");
        await addToRole(role, Permission.MonitorViewer);
        await giveRoleToKey(roleKey, role);

        expect(await monitorsReadByKey(roleKey)).toEqual(
          [productionMonitor, stagingMonitor, unlabelledMonitor]
            .map(lower)
            .sort(),
        );
      });

      test("a permission the role limits to what is owned gives a key nothing: a key owns nothing", async () => {
        const role: ObjectID = await createRole("Own Monitors");
        await addToRole(role, Permission.MonitorViewer, {
          scope: PermissionScope.Owned,
        });
        await addToRole(role, Permission.IncidentMember);
        await giveRoleToKey(roleKey, role);

        expect(
          (await copiesOnKey(roleKey)).map((row: StoredRow): string => {
            return row.permission;
          }),
        ).toEqual([Permission.IncidentMember]);
        expect(
          (await heldByKey(roleKey)).some((row: HeldRow): boolean => {
            return row.permission === Permission.MonitorViewer;
          }),
        ).toBe(false);
        expect(await monitorsReadByKey(roleKey)).toBeNull();
      });

      test("a key's own permissions and its roles' sit side by side, and a role adds to them", async () => {
        await giveKeyDirectly(roleKey, Permission.IncidentMember);

        const role: ObjectID = await createRole("Watcher");
        await addToRole(role, Permission.IncidentMember);
        await addToRole(role, Permission.MonitorViewer, {
          scope: PermissionScope.Labels,
          labels: [staging],
        });
        const given: ObjectID = await giveRoleToKey(roleKey, role);

        const rows: Array<StoredRow> = await rowsOfKey(roleKey);
        expect(
          rows.map((row: StoredRow): string => {
            return `${row.permission}:${row.apiKeyCustomRoleId ? "role" : "own"}`;
          }),
        ).toEqual([
          `${Permission.IncidentMember}:own`,
          `${Permission.IncidentMember}:role`,
          `${Permission.MonitorViewer}:role`,
        ]);
        expect(await monitorsReadByKey(roleKey)).toEqual([
          lower(stagingMonitor),
        ]);

        // Taking the role away keeps the key's own permission.
        await ApiKeyCustomRoleService.deleteOneById({
          id: given,
          props: owner,
        });

        expect(
          (await rowsOfKey(roleKey)).map((row: StoredRow): string => {
            return `${row.permission}:${row.apiKeyCustomRoleId ? "role" : "own"}`;
          }),
        ).toEqual([`${Permission.IncidentMember}:own`]);
      });

      test("a key's own block wins over a role", async () => {
        const role: ObjectID = await createRole("Watcher");
        await addToRole(role, Permission.MonitorViewer);
        await giveRoleToKey(roleKey, role);

        /*
         * The block sits beside the role's copy of the same permission. (A key
         * holds a permission of its own once, allow or block: the same
         * comparison with a key given Monitor Viewer directly cannot be made.)
         */
        await giveKeyDirectly(roleKey, Permission.MonitorViewer, {
          isBlockPermission: true,
          labels: [staging],
        });

        expect(await monitorsReadByKey(roleKey)).toEqual(
          [productionMonitor, unlabelledMonitor].map(lower).sort(),
        );
      });

      test("two roles holding the same permission are kept apart: taking one away leaves the other's", async () => {
        const first: ObjectID = await createRole("First");
        const second: ObjectID = await createRole("Second");
        await addToRole(first, Permission.MonitorViewer);
        await addToRole(second, Permission.MonitorViewer);

        const givenFirst: ObjectID = await giveRoleToKey(roleKey, first);
        await giveRoleToKey(roleKey, second);

        expect(await copiesOnKey(roleKey)).toHaveLength(2);

        await ApiKeyCustomRoleService.deleteOneById({
          id: givenFirst,
          props: owner,
        });

        expect(
          (await copiesOnKey(roleKey)).map((row: StoredRow): string | null => {
            return row.customRoleId;
          }),
        ).toEqual([lower(second)]);
        expect((await monitorsReadByKey(roleKey))?.length).toBe(3);
      });
    });

    describe("every change reaches the key's very next request", () => {
      test("giving the role, a permission added, changed and taken out, the role taken away and deleted - each read at once, and every server told", async () => {
        const role: ObjectID = await createRole("Deploy Reporter");
        await addToRole(role, Permission.IncidentMember);

        // Cached before the role is given.
        expect(await heldByKey(roleKey)).toEqual([]);

        forgottenProjects = [];
        const given: ObjectID = await giveRoleToKey(roleKey, role);
        expect(
          (await heldByKey(roleKey)).map((row: HeldRow): string => {
            return row.permission;
          }),
        ).toEqual([Permission.IncidentMember]);
        expect(wasForgotten()).toBe(true);

        // A permission added to the role.
        forgottenProjects = [];
        const monitors: ObjectID = await addToRole(
          role,
          Permission.MonitorViewer,
          { scope: PermissionScope.Labels, labels: [production] },
        );
        expect(await monitorsReadByKey(roleKey)).toEqual([
          lower(productionMonitor),
        ]);
        expect(wasForgotten()).toBe(true);

        // Its labels changed.
        forgottenProjects = [];
        await CustomRolePermissionService.updateOneById({
          id: monitors,
          data: {
            labels: labelsOf([staging]),
          } as never,
          props: owner,
        });
        expect(await monitorsReadByKey(roleKey)).toEqual([
          lower(stagingMonitor),
        ]);
        expect(wasForgotten()).toBe(true);

        // Limited to what is owned: the key holds nothing of it any more.
        forgottenProjects = [];
        await CustomRolePermissionService.updateOneById({
          id: monitors,
          data: {
            scope: PermissionScope.Owned,
            labels: [],
          } as never,
          props: owner,
        });
        expect(await monitorsReadByKey(roleKey)).toBeNull();
        expect(wasForgotten()).toBe(true);

        // Back to the whole project.
        await CustomRolePermissionService.updateOneById({
          id: monitors,
          data: {
            scope: PermissionScope.All,
          } as never,
          props: owner,
        });
        expect((await monitorsReadByKey(roleKey))?.length).toBe(3);

        // Taken out of the role.
        forgottenProjects = [];
        await CustomRolePermissionService.deleteOneById({
          id: monitors,
          props: owner,
        });
        expect(await monitorsReadByKey(roleKey)).toBeNull();
        expect(wasForgotten()).toBe(true);

        // The role taken from the key.
        forgottenProjects = [];
        await ApiKeyCustomRoleService.deleteOneById({
          id: given,
          props: owner,
        });
        expect(await heldByKey(roleKey)).toEqual([]);
        expect(wasForgotten()).toBe(true);

        // Given again, then the role deleted.
        await giveRoleToKey(roleKey, role);
        expect((await heldByKey(roleKey)).length).toBe(1);

        forgottenProjects = [];
        await CustomRoleService.deleteOneById({
          id: role,
          props: owner,
        });
        expect(await heldByKey(roleKey)).toEqual([]);
        expect(wasForgotten()).toBe(true);
        expect(await count("ApiKeyCustomRole")).toBe(0);
        expect(await copiesOnKey(roleKey)).toEqual([]);
      });

      test("a change to a role reaches every key with it, and none without it", async () => {
        const role: ObjectID = await createRole("Status Bot");
        await addToRole(role, Permission.IncidentMember);
        await giveRoleToKey(roleKey, role);
        await giveRoleToKey(secondRoleKey, role);

        // Cached for all three.
        await heldByKey(roleKey);
        await heldByKey(secondRoleKey);
        expect(await heldByKey(directKey)).toEqual([]);

        await addToRole(role, Permission.AlertViewer);

        for (const key of [roleKey, secondRoleKey]) {
          expect(
            (await heldByKey(key)).map((row: HeldRow): string => {
              return row.permission;
            }),
          ).toEqual([Permission.AlertViewer, Permission.IncidentMember].sort());
        }

        expect(await heldByKey(directKey)).toEqual([]);
      });
    });

    describe("nobody gives a key through a role what they could not give it directly", () => {
      test("someone who may change what a key can do gives only roles made of what they hold, at their scope", async () => {
        const theirs: ObjectID = await createRole("Theirs to give");
        await addToRole(theirs, Permission.IncidentMember);
        await addToRole(theirs, Permission.MonitorViewer, {
          scope: PermissionScope.Labels,
          labels: [production],
        });
        // Limited to what is owned: gives a key nothing, so nothing to weigh.
        await addToRole(theirs, Permission.AlertAdmin, {
          scope: PermissionScope.Owned,
        });

        await giveRoleToKey(roleKey, theirs, keyEditor);
        expect(await copiesOnKey(roleKey)).toHaveLength(2);

        const wider: ObjectID = await createRole("Wider");
        await addToRole(wider, Permission.MonitorViewer, {
          scope: PermissionScope.Labels,
          labels: [staging],
        });

        expect(
          await refusal(() => {
            return giveRoleToKey(secondRoleKey, wider, keyEditor);
          }),
        ).toBe(
          getCustomRoleGrantRefusedMessage({
            roleName: "Wider",
            permission: Permission.MonitorViewer,
          }),
        );

        // Refused before anything was written: the key holds nothing of it.
        expect(await rowsOfKey(secondRoleKey)).toEqual([]);
        expect(await count("ApiKeyCustomRole")).toBe(1);
      });

      test("someone who may change what a key can do but not see the project's roles gives none", async () => {
        const role: ObjectID = await createRole("Deploy Reporter");
        await addToRole(role, Permission.IncidentMember);

        const keysOnly: DatabaseCommonInteractionProps = propsHolding([
          grant(Permission.EditProjectApiKeyPermissions, {
            scope: PermissionScope.All,
          }),
          grant(Permission.ReadProjectApiKey, { scope: PermissionScope.All }),
          grant(Permission.IncidentMember, { scope: PermissionScope.All }),
        ]);

        expect(
          await refusal(() => {
            return giveRoleToKey(roleKey, role, keysOnly);
          }),
        ).toBe(CUSTOM_ROLE_NOT_READABLE_MESSAGE);
        expect(await count("ApiKeyCustomRole")).toBe(0);
      });

      test("someone who may not change what a key can do gives no role at all", async () => {
        const role: ObjectID = await createRole("Deploy Reporter");
        await addToRole(role, Permission.IncidentMember);

        const reader: DatabaseCommonInteractionProps = propsHolding([
          grant(Permission.ReadProjectApiKey, { scope: PermissionScope.All }),
          grant(Permission.ReadProjectTeam, { scope: PermissionScope.All }),
          grant(Permission.IncidentMember, { scope: PermissionScope.All }),
        ]);

        await refusal(() => {
          return giveRoleToKey(roleKey, role, reader);
        });
        expect(await count("ApiKeyCustomRole")).toBe(0);
      });

      test("widening a role a key holds past what the editor holds is refused, and the key keeps what it had", async () => {
        const role: ObjectID = await createRole("Deploy Reporter");
        const monitors: ObjectID = await addToRole(
          role,
          Permission.MonitorViewer,
          { scope: PermissionScope.Labels, labels: [production] },
        );
        await giveRoleToKey(roleKey, role);

        const teamEditor: DatabaseCommonInteractionProps = propsHolding([
          grant(Permission.EditProjectTeamPermissions, {
            scope: PermissionScope.All,
          }),
          grant(Permission.ReadProjectTeam, { scope: PermissionScope.All }),
          grant(Permission.MonitorViewer, {
            scope: PermissionScope.Labels,
            labelIds: [production],
          }),
        ]);

        await refusal(() => {
          return CustomRolePermissionService.updateOneById({
            id: monitors,
            data: { scope: PermissionScope.All, labels: [] } as never,
            props: teamEditor,
          });
        });

        expect(await monitorsReadByKey(roleKey)).toEqual([
          lower(productionMonitor),
        ]);
      });

      test("the same role is given to a key once", async () => {
        const role: ObjectID = await createRole("Deploy Reporter");
        await addToRole(role, Permission.IncidentMember);
        await giveRoleToKey(roleKey, role);

        expect(
          await refusal(() => {
            return giveRoleToKey(roleKey, role);
          }),
        ).toBe(API_KEY_ALREADY_HAS_ROLE_MESSAGE);
      });
    });

    describe("a role and a key stay in their project", () => {
      test("a role is not given to another project's key", async () => {
        const role: ObjectID = await createRole("Deploy Reporter");
        await addToRole(role, Permission.IncidentMember);

        // Answered as every reference to another project's record is.
        expect(
          await refusal(() => {
            return giveRoleToKey(otherProjectKey, role);
          }),
        ).toContain("references records that are not in this project");
        expect(await count("ApiKeyCustomRole")).toBe(0);
      });

      test("a key is not given another project's role", async () => {
        await insert("CustomRole", {
          _id: ObjectID.generate().toString(),
          projectId: otherProjectId.toString(),
          name: "Theirs",
          slug: `role-${ObjectID.generate().toString()}`,
          permissionCount: 0,
          version: 1,
        });
        const theirs: Array<{ _id: string }> = await database.query(
          `SELECT "_id" FROM "${schema}"."CustomRole" WHERE "projectId" = $1`,
          [otherProjectId.toString()],
        );

        await refusal(() => {
          return giveRoleToKey(roleKey, new ObjectID(theirs[0]!._id));
        });
        expect(await count("ApiKeyCustomRole")).toBe(0);
      });
    });

    describe("a key's copies are the role's", () => {
      test("a copy is not changed or removed on its own, even by a project admin; the role names itself in the refusal", async () => {
        const role: ObjectID = await createRole("Deploy Reporter");
        await addToRole(role, Permission.IncidentMember);
        await giveRoleToKey(roleKey, role);

        const copy: StoredRow = (await copiesOnKey(roleKey))[0]!;
        const expected: string = getApiKeyRoleCopyChangeRefusedMessage({
          roleName: "Deploy Reporter",
          permission: Permission.IncidentMember,
        });

        expect(
          await refusal(() => {
            return ApiKeyPermissionService.updateOneById({
              id: new ObjectID(copy.id),
              data: { labels: labelsOf([production]) } as never,
              props: admin,
            });
          }),
        ).toBe(expected);
        expect(
          await refusal(() => {
            return ApiKeyPermissionService.deleteOneById({
              id: new ObjectID(copy.id),
              props: admin,
            });
          }),
        ).toBe(expected);

        expect(await copiesOnKey(roleKey)).toEqual([copy]);
      });

      test("a request may not write a copy's marks", async () => {
        const role: ObjectID = await createRole("Deploy Reporter");

        const row: ApiKeyPermission = new ApiKeyPermission();
        row.projectId = projectId;
        row.apiKeyId = roleKey;
        row.permission = Permission.IncidentMember;
        row.customRoleId = role;

        await refusal(() => {
          return ApiKeyPermissionService.create({ data: row, props: owner });
        });
        expect(await rowsOfKey(roleKey)).toEqual([]);
      });
    });

    describe("taking anything away takes the copies in the same delete", () => {
      test("a deleted key takes its hold of the role and the copies with it", async () => {
        const role: ObjectID = await createRole("Deploy Reporter");
        await addToRole(role, Permission.IncidentMember);
        await giveRoleToKey(roleKey, role);
        await giveRoleToKey(secondRoleKey, role);

        await database.query(
          `DELETE FROM "${schema}"."ApiKey" WHERE "_id" = $1`,
          [roleKey.toString()],
        );

        expect(await rowsOfKey(roleKey)).toEqual([]);
        expect(await count("ApiKeyCustomRole")).toBe(1);
        expect(await copiesOnKey(secondRoleKey)).toHaveLength(1);
      });

      test("a deleted label goes from the role's permission and every key's copy, as from a direct one", async () => {
        const role: ObjectID = await createRole("Watcher");
        await addToRole(role, Permission.MonitorViewer, {
          scope: PermissionScope.Labels,
          labels: [production, staging],
        });
        await giveRoleToKey(roleKey, role);

        await database.query(
          `DELETE FROM "${schema}"."Label" WHERE "_id" = $1`,
          [staging.toString()],
        );

        expect((await copiesOnKey(roleKey))[0]!.labelIds).toEqual([
          lower(production),
        ]);
      });
    });

    describe("what was there before the migration", () => {
      test("a key permission written before custom roles is a direct one: untouched by syncs, and changed as before", async () => {
        const before: ObjectID = ObjectID.generate();
        await insert("ApiKeyPermission", {
          _id: before.toString(),
          projectId: projectId.toString(),
          apiKeyId: roleKey.toString(),
          permission: Permission.IncidentMember,
          isBlockPermission: false,
          version: 1,
        });

        const role: ObjectID = await createRole("Deploy Reporter");
        await addToRole(role, Permission.IncidentMember);
        await giveRoleToKey(roleKey, role);
        await addToRole(role, Permission.AlertViewer);

        const own: Array<StoredRow> = (await rowsOfKey(roleKey)).filter(
          (row: StoredRow): boolean => {
            return !row.customRoleId;
          },
        );

        expect(own).toEqual([
          {
            id: lower(before),
            permission: Permission.IncidentMember,
            isBlockPermission: false,
            labelIds: [],
            customRoleId: null,
            apiKeyCustomRoleId: null,
            customRolePermissionId: null,
          },
        ]);

        await ApiKeyPermissionService.updateOneById({
          id: before,
          data: { permission: Permission.IncidentViewer } as never,
          props: owner,
        });

        expect(
          (await rowsOfKey(roleKey)).find((row: StoredRow): boolean => {
            return row.id === lower(before);
          })?.permission,
        ).toBe(Permission.IncidentViewer);
      });
    });
  },
);
