import Entities from "../../../Models/DatabaseModels/Index";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import APIKeyAccessPermission from "../../../Server/Utils/APIKey/AccessPermission";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { DataSource, EntityManager } from "typeorm";

/*
 * RUN_POSTGRES_PERMISSION_BLOCK_TESTS=true opts into the local Postgres
 * regression suite. Load config.env and optionally override
 * PERMISSION_BLOCK_TEST_DATABASE_HOST / PERMISSION_BLOCK_TEST_DATABASE_PORT.
 * Only cloned tables in a unique schema are changed. The permission services,
 * database delete pipeline, permission loading and target-resource ACLs remain
 * real; only external cache writes, workflows and realtime notifications are
 * suppressed.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_PERMISSION_BLOCK_TESTS"] === "true"
    ? describe
    : describe.skip;

const projectId: ObjectID = ObjectID.generate();
const otherProjectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const parentId: ObjectID = ObjectID.generate();
const otherParentId: ObjectID = ObjectID.generate();
const labelId: ObjectID = ObjectID.generate();
const otherLabelId: ObjectID = ObjectID.generate();
const monitorId: ObjectID = ObjectID.generate();
const otherMonitorId: ObjectID = ObjectID.generate();

interface PermissionTarget {
  name: string;
  table: "ApiKeyPermission" | "TeamPermission";
  parentColumn: "apiKeyId" | "teamId";
  labelColumn: "apiKeyPermissionId" | "teamPermissionId";
  editor: Permission;
  reader: Permission;
  service: typeof ApiKeyPermissionService | typeof TeamPermissionService;
}

const targets: Array<PermissionTarget> = [
  {
    name: "API key",
    table: "ApiKeyPermission",
    parentColumn: "apiKeyId",
    labelColumn: "apiKeyPermissionId",
    editor: Permission.EditProjectApiKeyPermissions,
    reader: Permission.ReadProjectApiKey,
    service: ApiKeyPermissionService,
  },
  {
    name: "team",
    table: "TeamPermission",
    parentColumn: "teamId",
    labelColumn: "teamPermissionId",
    editor: Permission.EditProjectTeamPermissions,
    reader: Permission.ReadProjectTeam,
    service: TeamPermissionService,
  },
];

type DeleteMethod = "deleteOneBy" | "deleteBy" | "hardDeleteBy";
const deleteMethods: Array<DeleteMethod> = [
  "deleteOneBy",
  "deleteBy",
  "hardDeleteBy",
];

function grant(
  permission: Permission,
  data: Partial<UserPermission> = {},
): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission: false,
    ...data,
  };
}

function props(
  permissions: Array<UserPermission>,
  tenantId: ObjectID = projectId,
): DatabaseCommonInteractionProps {
  return {
    userId,
    tenantId,
    currentPlan: PlanType.Scale,
    userType: UserType.User,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [tenantId],
      globalPermissions: [Permission.User, Permission.CurrentUser],
    },
    userTenantAccessPermission: {
      [tenantId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: tenantId,
        permissions,
      },
    },
  };
}

describePostgres("permission block removal against Postgres", () => {
  const schema: string = `permission_block_test_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const monitorService: DatabaseService<Monitor> = new DatabaseService(Monitor);
  const tables: Array<string> = [
    "ApiKey",
    "ApiKeyPermission",
    "ApiKeyPermissionLabel",
    "Team",
    "TeamMember",
    "TeamPermission",
    "TeamPermissionLabel",
    "Label",
    "Monitor",
    "MonitorLabel",
  ];
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["PERMISSION_BLOCK_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["PERMISSION_BLOCK_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    for (const table of tables) {
      await database.query(
        `CREATE UNLOGGED TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`,
      );
    }
    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined);
    jest
      .spyOn(AccessTokenService, "refreshUserGlobalAccessPermission")
      .mockResolvedValue({
        _type: "UserGlobalAccessPermission",
        projectIds: [projectId],
        globalPermissions: [Permission.User, Permission.CurrentUser],
      });
    for (const target of targets) {
      jest
        .spyOn(target.service, "onTriggerWorkflow")
        .mockResolvedValue(undefined);
      jest
        .spyOn(target.service, "onTriggerRealtime")
        .mockResolvedValue(undefined);
    }
  });

  beforeEach(async () => {
    ApiKeyPermissionService.clearCache();
    // DELETE avoids a TRUNCATE file-sync for every table on each test case.
    await database.transaction(
      async (manager: EntityManager): Promise<void> => {
        for (const table of tables) {
          await manager.query(`DELETE FROM "${schema}"."${table}"`);
        }
        for (const [id, tenant] of [
          [parentId, projectId],
          [otherParentId, otherProjectId],
        ]) {
          await manager.query(
            'INSERT INTO "Team" ("_id", "projectId", "name", "slug", "version") VALUES ($1, $2, \'Synthetic team\', $3, 1)',
            [id!.toString(), tenant!.toString(), id!.toString()],
          );
          await manager.query(
            'INSERT INTO "ApiKey" ("_id", "projectId", "name", "slug", "apiKey", "expiresAt", "version") VALUES ($1, $2, \'Synthetic key\', $3, uuid_generate_v4(), NOW() + INTERVAL \'1 day\', 1)',
            [id!.toString(), tenant!.toString(), id!.toString()],
          );
        }
        await manager.query(
          'INSERT INTO "TeamMember" ("teamId", "projectId", "userId", "hasAcceptedInvitation", "version") VALUES ($1, $2, $3, true, 1)',
          [parentId.toString(), projectId.toString(), userId.toString()],
        );
        for (const [id, label] of [
          [monitorId, labelId],
          [otherMonitorId, otherLabelId],
        ]) {
          await manager.query(
            'INSERT INTO "Label" ("_id", "projectId", "name", "slug", "color", "version") VALUES ($1, $2, \'Synthetic label\', $3, \'#123456\', 1)',
            [label!.toString(), projectId.toString(), label!.toString()],
          );
          await manager.query(
            'INSERT INTO "Monitor" ("_id", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "version") VALUES ($1, $2, \'Synthetic monitor\', $3, \'Manual\', uuid_generate_v4(), 1)',
            [id!.toString(), projectId.toString(), id!.toString()],
          );
          await manager.query(
            'INSERT INTO "MonitorLabel" ("monitorId", "labelId") VALUES ($1, $2)',
            [id!.toString(), label!.toString()],
          );
        }
      },
    );
  });

  afterAll(async () => {
    ApiKeyPermissionService.clearCache();
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function seed(
    target: PermissionTarget,
    data: {
      permission?: Permission;
      block?: boolean;
      labels?: Array<ObjectID>;
      scope?: PermissionScope;
      tenant?: ObjectID;
      parent?: ObjectID;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${target.table}" ("_id", "projectId", "${target.parentColumn}", "permission", "isBlockPermission", "version") VALUES ($1, $2, $3, $4, $5, 1)`,
      [
        id.toString(),
        (data.tenant || projectId).toString(),
        (data.parent || parentId).toString(),
        data.permission || Permission.MonitorViewer,
        data.block || false,
      ],
    );
    if (target.table === "TeamPermission" && data.scope) {
      await database.query(
        'UPDATE "TeamPermission" SET "scope" = $1 WHERE "_id" = $2',
        [data.scope, id.toString()],
      );
    }
    for (const label of data.labels || []) {
      await database.query(
        `INSERT INTO "${target.table}Label" ("${target.labelColumn}", "labelId") VALUES ($1, $2)`,
        [id.toString(), label.toString()],
      );
    }
    return id;
  }

  async function storedIds(target: PermissionTarget): Promise<Array<string>> {
    const rows: Array<{ _id: string }> = await database.query(
      `SELECT "_id" FROM "${target.table}" ORDER BY "_id"`,
    );
    return rows.map((row: { _id: string }): string => {
      return row._id;
    });
  }

  async function effectiveProps(
    target: PermissionTarget,
  ): Promise<DatabaseCommonInteractionProps> {
    const permission: UserTenantAccessPermission | null =
      target.table === "ApiKeyPermission"
        ? await APIKeyAccessPermission.getApiTenantAccessPermission(
            projectId,
            parentId,
          )
        : await AccessTokenService.refreshUserTenantAccessPermission(
            userId,
            projectId,
          );
    expect(permission).not.toBeNull();
    const result: DatabaseCommonInteractionProps = props(
      permission!.permissions,
    );
    if (target.table === "ApiKeyPermission") {
      result.userType = UserType.API;
      result.userId = undefined;
      result.userGlobalAccessPermission =
        await APIKeyAccessPermission.getDefaultApiGlobalPermission(projectId);
    }
    return result;
  }

  async function visibleMonitors(
    target: PermissionTarget,
  ): Promise<Array<string>> {
    const rows: Array<Monitor> = await monitorService.findBy({
      query: {},
      select: { _id: true },
      skip: 0,
      limit: 10,
      props: await effectiveProps(target),
    });
    return rows
      .map((row: Monitor): string => {
        return row.id!.toString();
      })
      .sort();
  }

  async function remove(
    target: PermissionTarget,
    method: DeleteMethod,
    id: ObjectID,
    caller: DatabaseCommonInteractionProps,
  ): Promise<number> {
    const request: {
      query: { _id: ObjectID };
      props: DatabaseCommonInteractionProps;
      skip: number;
      limit: number;
    } = {
      query: { _id: id },
      props: caller,
      skip: 0,
      limit: 10,
    };
    return await target.service[method](request);
  }

  async function expectDelegationDenied(
    mutation: Promise<number>,
  ): Promise<void> {
    await expect(mutation).rejects.toBeInstanceOf(NotAuthorizedException);
    await expect(mutation).rejects.toThrow("cannot grant");
  }

  describe.each(targets)(
    "$name permission blocks",
    (target: PermissionTarget) => {
      test.each(deleteMethods)(
        "%s cannot turn a blocked allow into usable authority",
        async (method: DeleteMethod) => {
          const allowId: ObjectID = await seed(target);
          const blockId: ObjectID = await seed(target, { block: true });
          // Read the actual stored grant and block through the production resolver.
          await expect(visibleMonitors(target)).rejects.toBeInstanceOf(
            NotAuthorizedException,
          );
          await expect(
            remove(
              target,
              method,
              blockId,
              props([grant(target.editor), grant(target.reader)]),
            ),
          ).rejects.toBeInstanceOf(NotAuthorizedException);
          expect(await storedIds(target)).toEqual(
            [allowId.toString(), blockId.toString()].sort(),
          );
          await expect(visibleMonitors(target)).rejects.toBeInstanceOf(
            NotAuthorizedException,
          );

          expect(
            await remove(
              target,
              method,
              blockId,
              props([grant(Permission.ProjectOwner)]),
            ),
          ).toBe(1);
          // Successful deletion must invalidate the API-key cache warmed above.
          expect(await visibleMonitors(target)).toEqual(
            [monitorId.toString(), otherMonitorId.toString()].sort(),
          );
          expect(await storedIds(target)).toEqual([allowId.toString()]);
        },
      );

      test("cannot remove its own effective block even while holding a matching allow", async () => {
        await seed(target, { permission: target.editor });
        await seed(target, { permission: target.reader });
        await seed(target);
        const blockId: ObjectID = await seed(target, { block: true });
        const caller: DatabaseCommonInteractionProps =
          await effectiveProps(target);
        await expect(
          remove(target, "deleteOneBy", blockId, caller),
        ).rejects.toBeInstanceOf(NotAuthorizedException);
        expect(await storedIds(target)).toContain(blockId.toString());
        await expect(visibleMonitors(target)).rejects.toBeInstanceOf(
          NotAuthorizedException,
        );
      });

      test("a scoped block protects only its labelled resources until an authorized editor removes it", async () => {
        await seed(target);
        const blockId: ObjectID = await seed(target, {
          block: true,
          labels: [labelId],
          scope: PermissionScope.Labels,
        });
        expect(await visibleMonitors(target)).toEqual([
          otherMonitorId.toString(),
        ]);
        await expect(
          remove(
            target,
            "deleteOneBy",
            blockId,
            props([
              grant(target.editor),
              grant(Permission.MonitorViewer, {
                labelIds: [otherLabelId],
                scope: PermissionScope.Labels,
              }),
            ]),
          ),
        ).rejects.toBeInstanceOf(NotAuthorizedException);
        expect(await visibleMonitors(target)).toEqual([
          otherMonitorId.toString(),
        ]);
        expect(
          await remove(
            target,
            "deleteOneBy",
            blockId,
            props([
              grant(target.editor),
              grant(Permission.MonitorViewer, {
                labelIds: [labelId, otherLabelId],
                scope: PermissionScope.Labels,
              }),
            ]),
          ),
        ).toBe(1);
        expect(await visibleMonitors(target)).toEqual(
          [monitorId.toString(), otherMonitorId.toString()].sort(),
        );
      });

      test.each([PermissionScope.Labels, PermissionScope.Owned])(
        "%s authority cannot remove an unrestricted block",
        async (scope: PermissionScope) => {
          const blockId: ObjectID = await seed(target, { block: true });
          await expect(
            remove(
              target,
              "deleteOneBy",
              blockId,
              props([
                grant(target.editor),
                grant(Permission.MonitorViewer, {
                  scope,
                  labelIds: scope === PermissionScope.Labels ? [labelId] : [],
                }),
              ]),
            ),
          ).rejects.toBeInstanceOf(NotAuthorizedException);
          expect(await storedIds(target)).toEqual([blockId.toString()]);
        },
      );

      test("a mixed bulk request fails before deleting any row", async () => {
        const allowId: ObjectID = await seed(target);
        const blockId: ObjectID = await seed(target, { block: true });
        await expect(
          target.service.deleteBy({
            query: { projectId },
            skip: 0,
            limit: 10,
            props: props([grant(target.editor)]),
          }),
        ).rejects.toBeInstanceOf(NotAuthorizedException);
        expect(await storedIds(target)).toEqual(
          [allowId.toString(), blockId.toString()].sort(),
        );
      });

      test("an editor may still revoke an allow that it cannot itself grant", async () => {
        const allowId: ObjectID = await seed(target, {
          permission: Permission.ProjectOwner,
        });
        expect(
          await remove(
            target,
            "deleteOneBy",
            allowId,
            props([grant(target.editor)]),
          ),
        ).toBe(1);
        expect(await storedIds(target)).toEqual([]);
      });

      test.each(deleteMethods)(
        "%s cannot delete another tenant's block by its ID",
        async (method: DeleteMethod) => {
          const blockId: ObjectID = await seed(target, {
            block: true,
            tenant: otherProjectId,
            parent: otherParentId,
          });
          expect(
            await remove(
              target,
              method,
              blockId,
              props([grant(Permission.ProjectOwner)]),
            ),
          ).toBe(0);
          expect(await storedIds(target)).toEqual([blockId.toString()]);
        },
      );

      test("narrowing a stored block by update cannot bypass the removal ceiling", async () => {
        const blockId: ObjectID = await seed(target, { block: true });
        await expectDelegationDenied(
          target.service.updateOneBy({
            query: { _id: blockId },
            data: { permission: target.editor },
            props: props([grant(target.editor), grant(target.reader)]),
          }),
        );
        const rows: Array<{ permission: string; isBlockPermission: boolean }> =
          await database.query(
            `SELECT "permission", "isBlockPermission" FROM "${target.table}" WHERE "_id" = $1`,
            [blockId.toString()],
          );
        expect(rows).toEqual([
          { permission: Permission.MonitorViewer, isBlockPermission: true },
        ]);
      });

      test.each(["delete", "update"])(
        "%s relation filters cannot hide the rest of a stored block's labels",
        async (operation: string) => {
          const blockId: ObjectID = await seed(target, {
            block: true,
            labels: [labelId, otherLabelId],
            scope: PermissionScope.Labels,
          });
          const caller: DatabaseCommonInteractionProps = props([
            grant(target.editor),
            grant(target.reader),
            grant(Permission.MonitorViewer, {
              labelIds: [labelId],
              scope: PermissionScope.Labels,
            }),
          ]);
          const query: {
            _id: ObjectID;
            labels: Array<{ _id: string }>;
          } = {
            _id: blockId,
            labels: [{ _id: labelId.toString() }],
          };
          const mutation: Promise<number> =
            operation === "delete"
              ? target.service.deleteOneBy({
                  query,
                  props: caller,
                })
              : target.service.updateOneBy({
                  query,
                  data: { permission: target.editor },
                  props: caller,
                });
          await expectDelegationDenied(mutation);
          expect(await storedIds(target)).toEqual([blockId.toString()]);
          const labels: Array<{ labelId: string }> = await database.query(
            `SELECT "labelId" FROM "${target.table}Label" WHERE "${target.labelColumn}" = $1 ORDER BY "labelId"`,
            [blockId.toString()],
          );
          expect(
            labels.map((row: { labelId: string }): string => {
              return row.labelId;
            }),
          ).toEqual([labelId.toString(), otherLabelId.toString()].sort());
        },
      );

      test("an update page must validate the block actually selected after skip", async () => {
        const blockId: ObjectID = await seed(target, { block: true });
        const allowedId: ObjectID = await seed(target, {
          permission: target.editor,
        });
        await database.query(
          `UPDATE "${target.table}" SET "createdAt" = NOW() - INTERVAL '1 day' WHERE "_id" = $1`,
          [blockId.toString()],
        );
        await expectDelegationDenied(
          target.service.updateBy({
            query: { projectId },
            data: { permission: target.editor },
            skip: 1,
            limit: 1,
            props: props([grant(target.editor), grant(target.reader)]),
          }),
        );
        expect(await storedIds(target)).toEqual(
          [blockId.toString(), allowedId.toString()].sort(),
        );
        const rows: Array<{ permission: string }> = await database.query(
          `SELECT "permission" FROM "${target.table}" WHERE "_id" = $1`,
          [blockId.toString()],
        );
        expect(rows[0]?.permission).toBe(Permission.MonitorViewer);
      });
    },
  );
});
