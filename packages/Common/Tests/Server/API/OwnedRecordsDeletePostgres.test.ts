import { mockRouter } from "./Helpers";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import CacheGenerations from "../../../Server/Infrastructure/CacheGenerations";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import MonitorOwnerTeamService from "../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../Server/Services/MonitorService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import CustomRoleSync from "../../../Server/Utils/CustomRole/CustomRoleSync";
import { UnreadableParentException } from "../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import Response from "../../../Server/Utils/Response";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import MonitorOwnerTeam from "../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorTest from "../../../Models/DatabaseModels/MonitorTest";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageAnnouncementTemplate from "../../../Models/DatabaseModels/StatusPageAnnouncementTemplate";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, EntityMetadata } from "typeorm";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";

/*
 * WHAT A MEMBER LIMITED TO OWNED RECORDS DELETES, against a migrated
 * Postgres.
 *
 * A team's permission scoped to Owned "only applies to resources where this
 * team, or the user acting, is listed as an owner" (permissions docs). A
 * delete keeps to that as a list and an update do: a member whose monitor
 * permissions are all scoped to Owned deletes the monitors they or one of
 * their teams own, and no other - by id (POST /monitor/:id/delete-item and
 * DELETE /monitor/:id), by query, or by first making themselves an owner.
 * A delete was once narrowed by labels only, so the scope that kept such a
 * member's list and changes to their own monitors did not hold for it.
 *
 * Every request goes through the route, the real user middleware - which
 * reads the member's teams and their permission rows (a custom role's
 * copies included), or an API key and its rows, from the tables below - the
 * real MonitorService with its delete hooks, and the real permission
 * pipeline, query serializer and TypeORM, so the owner rule runs as the SQL
 * Postgres runs. Only what lies around the request is stood in for: the
 * session token, the permission cache, single sign-on, the audit trail,
 * workflow triggers, live updates, and the locks and shared cache
 * generations kept in Valkey.
 *
 *   - Each grant a member may hold scoped to Owned: Monitor Admin, Monitor
 *     Member, the monitor permissions themselves, Project Member, the All
 *     Operational Resources permissions, and a custom role's Monitor Admin.
 *   - Mixed grants: a delete scoped to Owned beside a read of every monitor
 *     is refused for the monitors it does not own; a delete of every
 *     monitor beside a read scoped to Owned reaches only what it reads; a
 *     grant over the whole project beside an owned one reaches every
 *     monitor (the broader grant wins).
 *   - Nobody makes themselves an owner of a monitor they may not read, nor
 *     takes its owners away.
 *   - The records of a monitor (its status timeline, its tests) and a status
 *     page's announcements and announcement templates keep to the owned
 *     monitors and status pages.
 *   - Across projects, from another project, without a session or with a
 *     viewer's permissions: refused. An API key holds no scope.
 *   - Every other kind with owners of its own, by id and by query.
 *
 * Opt in with RUN_POSTGRES_OWNED_RECORDS_DELETE_TESTS=true against a
 * database the registered migrations have been applied to, e.g. from
 * packages/Common:
 *
 *   RUN_POSTGRES_OWNED_RECORDS_DELETE_TESTS=true \
 *   OWNED_RECORDS_DELETE_TEST_DATABASE_HOST=127.0.0.1 \
 *   OWNED_RECORDS_DELETE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/API/OwnedRecordsDeletePostgres.test.ts --forceExit
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables it
 * writes are copied from public into a uniquely named schema that is
 * dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_OWNED_RECORDS_DELETE_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

// The audit trail of a write is kept elsewhere.
jest.mock("../../../Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      recordCreate: jest.fn(),
      recordUpdate: jest.fn(),
      recordDelete: jest.fn(),
    },
  };
});

// The tables every part of this suite writes.
const TABLES: Array<string> = [
  "User",
  "Project",
  "Team",
  "TeamMember",
  "TeamPermission",
  "TeamPermissionLabel",
  "Label",
  "CustomRole",
  "CustomRolePermission",
  "CustomRolePermissionLabel",
  "TeamCustomRole",
  "ApiKey",
  "ApiKeyPermission",
  "ApiKeyPermissionLabel",
  "Monitor",
  "MonitorLabel",
  "MonitorOwnerUser",
  "MonitorOwnerTeam",
  "MonitorStatusTimeline",
  "MonitorTest",
  "StatusPage",
  "StatusPageLabel",
  "StatusPageOwnerUser",
  "StatusPageOwnerTeam",
  "StatusPageAnnouncement",
  "AnnouncementStatusPage",
  "StatusPageAnnouncementTemplate",
  "AnnouncementTemplateStatusPage",
];

interface PermissionRow {
  permission: Permission;
  scope?: PermissionScope;
  // The labels a row scoped to Labels is limited to.
  labelIds?: Array<ObjectID>;
}

// The scope a row is stored with: Labels when it names labels, else All.
const scopeOf: (row: PermissionRow) => PermissionScope = (
  row: PermissionRow,
): PermissionScope => {
  return (
    row.scope ||
    (row.labelIds && row.labelIds.length > 0
      ? PermissionScope.Labels
      : PermissionScope.All)
  );
};

type Caller =
  | {
      kind: "member";
      userId: ObjectID;
      tenantId?: ObjectID | undefined;
      isMultiTenant?: boolean | undefined;
    }
  | { kind: "apiKey"; apiKey: ObjectID }
  | { kind: "anonymous"; tenantId: ObjectID };

// What a route answered.
interface Outcome {
  error?: unknown;
  ids?: Array<string>;
  item?: BaseModel | null;
  isEmptySuccess?: boolean;
}

// Who owns a record: the member, their team, somebody else, or nobody.
type Owner = "member" | "memberTeam" | "otherUser" | "otherTeam" | "nobody";

const OTHERS: Array<Owner> = ["otherUser", "otherTeam", "nobody"];

// A kind of record with owners of its own, swept by id and by query.
interface OwningKind {
  name: string;
  modelType: { new (): BaseModel };
  pair: OwnerTablePair;
}

/*
 * Every kind with owners of its own (OwnerTableRegistry) but the monitor,
 * which the rest of this suite runs through its own routes and service.
 */
const SWEPT_KINDS: Array<OwningKind> = Array.from(OwnerTableRegistry.entries())
  .filter(([name]: [string, OwnerTablePair]): boolean => {
    return name !== "Monitor";
  })
  .map(([name, pair]: [string, OwnerTablePair]): OwningKind => {
    const modelType: { new (): BaseModel } | undefined = (
      Entities as Array<{ new (): BaseModel }>
    ).find((each: { new (): BaseModel }): boolean => {
      return each.name === name;
    });

    if (!modelType) {
      throw new Error(`No model named ${name}.`);
    }

    return { name: name, modelType: modelType, pair: pair };
  });

// A JSON column whose rows are read through a shape of their own.
const JSON_COLUMN_VALUES: Dictionary<unknown> = {
  dashboardViewConfig: { _type: "DashboardViewConfig", components: [] },
};

// A kind's own read and delete permissions (Read Monitor, Delete Monitor).
const OWN_READ_OR_DELETE_PERMISSION: RegExp = /^(Read|Delete)/;

describePostgres(
  "what a member limited to owned records deletes, on Postgres",
  () => {
    const schema: string = `owned_delete_${ObjectID.generate()
      .toString()
      .split("-")
      .join("")}`;

    let database: DataSource;

    /*
     * The routes, as the app registers them: the monitor's own API and
     * service (with its delete hooks), the monitor's owner rows with
     * theirs, and plain services for the records read through a monitor or
     * a status page and for every other kind with owners.
     */
    new MonitorAPI();
    new BaseAPI(
      MonitorOwnerUser,
      MonitorOwnerUserService as unknown as DatabaseService<BaseModel>,
    );
    new BaseAPI(
      MonitorOwnerTeam,
      MonitorOwnerTeamService as unknown as DatabaseService<BaseModel>,
    );

    for (const modelType of [
      MonitorStatusTimeline,
      MonitorTest,
      StatusPageAnnouncement,
      StatusPageAnnouncementTemplate,
    ] as Array<{ new (): BaseModel }>) {
      new BaseAPI(
        modelType,
        new DatabaseService(modelType) as DatabaseService<BaseModel>,
      );
    }

    const sweptServices: Dictionary<DatabaseService<BaseModel>> = {};

    for (const kind of SWEPT_KINDS) {
      sweptServices[kind.name] = new DatabaseService(
        kind.modelType,
      ) as DatabaseService<BaseModel>;
      new BaseAPI(kind.modelType, sweptServices[kind.name]!);
    }

    // A label of the project, that a grant limited to labels names.
    const readLabelId: ObjectID = ObjectID.generate();

    // The member every request is made as, and the people around them.
    const memberId: ObjectID = ObjectID.generate();
    const otherUserId: ObjectID = ObjectID.generate();
    const outsiderId: ObjectID = ObjectID.generate();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    // The member's team, another team of the project, the outsider's team.
    const memberTeamId: ObjectID = ObjectID.generate();
    const otherTeamId: ObjectID = ObjectID.generate();
    const outsiderTeamId: ObjectID = ObjectID.generate();

    const member: Caller = {
      kind: "member",
      userId: memberId,
      tenantId: projectId,
    };

    // Every table the suite copied, and the columns a row of each needs.
    const copiedTables: Array<string> = [];
    const requiredColumns: Dictionary<
      Array<{ name: string; type: string; udt: string; length: number | null }>
    > = {};

    const insert: (
      table: string,
      row: Dictionary<unknown>,
    ) => Promise<void> = async (
      table: string,
      row: Dictionary<unknown>,
    ): Promise<void> => {
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
          const value: unknown = row[column];

          if (value instanceof ObjectID) {
            return value.toString();
          }

          if (
            value &&
            typeof value === "object" &&
            !(value instanceof Date) &&
            !Array.isArray(value)
          ) {
            return JSON.stringify(value);
          }

          return value;
        }),
      );
    };

    /*
     * A row of any table this suite copied, with every column a row needs
     * given a value of its type, and `row` over them.
     */
    const insertAnyRow: (
      table: string,
      row: Dictionary<unknown>,
    ) => Promise<void> = async (
      table: string,
      row: Dictionary<unknown>,
    ): Promise<void> => {
      const filled: Dictionary<unknown> = {};
      const id: string = ObjectID.generate().toString();

      for (const column of requiredColumns[table] || []) {
        if (column.name in row) {
          continue;
        }

        if (column.name in JSON_COLUMN_VALUES) {
          filled[column.name] = JSON_COLUMN_VALUES[column.name];
        } else if (column.udt === "uuid") {
          filled[column.name] = ObjectID.generate();
        } else if (
          column.udt === "varchar" ||
          column.udt === "text" ||
          column.udt === "bpchar"
        ) {
          const text: string = `${column.name}-${id}`;
          filled[column.name] = column.length
            ? text.slice(0, column.length)
            : text;
        } else if (
          ["int2", "int4", "int8", "numeric", "float4", "float8"].includes(
            column.udt,
          )
        ) {
          filled[column.name] = 1;
        } else if (column.udt === "bool") {
          filled[column.name] = false;
        } else if (["timestamptz", "timestamp", "date"].includes(column.udt)) {
          filled[column.name] = new Date();
        } else if (column.udt === "jsonb" || column.udt === "json") {
          filled[column.name] = {};
        } else if (column.type === "ARRAY") {
          filled[column.name] = "{}";
        } else if (column.type === "USER-DEFINED") {
          const labels: Array<{ enumlabel: string }> = await database.query(
            `SELECT e."enumlabel" FROM pg_enum e JOIN pg_type t ON t.oid = e."enumtypid" WHERE t."typname" = $1 ORDER BY e."enumsortorder" LIMIT 1`,
            [column.udt],
          );
          filled[column.name] = labels[0]?.enumlabel;
        } else {
          throw new Error(
            `${table}.${column.name}: no value for a column of type ${column.type}.`,
          );
        }
      }

      await insert(table, { ...filled, ...row });
    };

    const rowExists: (table: string, id: ObjectID) => Promise<boolean> = async (
      table: string,
      id: ObjectID,
    ): Promise<boolean> => {
      const rows: Array<unknown> = await database.query(
        `SELECT "_id" FROM "${schema}"."${table}" WHERE "_id" = $1 AND "deletedAt" IS NULL`,
        [id.toString()],
      );

      return rows.length > 0;
    };

    // The owner rows of a record in an owner table: their ids and owners.
    const ownerRowsOf: (
      table: string,
      column: string,
      id: ObjectID,
    ) => Promise<Array<Dictionary<string>>> = async (
      table: string,
      column: string,
      id: ObjectID,
    ): Promise<Array<Dictionary<string>>> => {
      const ownerColumn: string = table.endsWith("OwnerUser")
        ? "userId"
        : "teamId";

      return await database.query(
        `SELECT "_id", "${ownerColumn}" AS "owner" FROM "${schema}"."${table}" WHERE "${column}" = $1 ORDER BY "_id"`,
        [id.toString()],
      );
    };

    // A record of a kind with owners, owned by `owner`.
    const insertOwned: (data: {
      table: string;
      ownerUserTable: string;
      ownerTeamTable: string;
      ownerColumn: string;
      owner: Owner;
      row?: Dictionary<unknown>;
      projectId?: ObjectID;
    }) => Promise<ObjectID> = async (data: {
      table: string;
      ownerUserTable: string;
      ownerTeamTable: string;
      ownerColumn: string;
      owner: Owner;
      row?: Dictionary<unknown>;
      projectId?: ObjectID;
    }): Promise<ObjectID> => {
      const id: ObjectID = ObjectID.generate();
      const inProject: ObjectID = data.projectId || projectId;

      await insertAnyRow(data.table, {
        _id: id,
        projectId: inProject,
        version: 1,
        ...(data.row || {}),
      });

      if (data.owner === "nobody") {
        return id;
      }

      const isUser: boolean =
        data.owner === "member" || data.owner === "otherUser";

      await insertAnyRow(isUser ? data.ownerUserTable : data.ownerTeamTable, {
        _id: ObjectID.generate(),
        projectId: inProject,
        [data.ownerColumn]: id,
        ...(isUser
          ? { userId: data.owner === "member" ? memberId : otherUserId }
          : {
              teamId: data.owner === "memberTeam" ? memberTeamId : otherTeamId,
            }),
        version: 1,
      });

      return id;
    };

    const insertMonitor: (
      owner: Owner,
      inProject?: ObjectID,
    ) => Promise<ObjectID> = async (
      owner: Owner,
      inProject?: ObjectID,
    ): Promise<ObjectID> => {
      return await insertOwned({
        table: "Monitor",
        ownerUserTable: "MonitorOwnerUser",
        ownerTeamTable: "MonitorOwnerTeam",
        ownerColumn: "monitorId",
        owner: owner,
        row: { monitorType: "Manual" },
        ...(inProject ? { projectId: inProject } : {}),
      });
    };

    const insertStatusPage: (owner: Owner) => Promise<ObjectID> = async (
      owner: Owner,
    ): Promise<ObjectID> => {
      return await insertOwned({
        table: "StatusPage",
        ownerUserTable: "StatusPageOwnerUser",
        ownerTeamTable: "StatusPageOwnerTeam",
        ownerColumn: "statusPageId",
        owner: owner,
      });
    };

    // The member's team's own permission rows, replaced (and any role it had).
    const setGrants: (rows: Array<PermissionRow>) => Promise<void> = async (
      rows: Array<PermissionRow>,
    ): Promise<void> => {
      await database.query(
        `DELETE FROM "${schema}"."TeamPermissionLabel" WHERE "teamPermissionId" IN (SELECT "_id" FROM "${schema}"."TeamPermission" WHERE "teamId" = $1)`,
        [memberTeamId.toString()],
      );
      await database.query(
        `DELETE FROM "${schema}"."TeamPermission" WHERE "teamId" = $1`,
        [memberTeamId.toString()],
      );
      await database.query(
        `DELETE FROM "${schema}"."TeamCustomRole" WHERE "teamId" = $1`,
        [memberTeamId.toString()],
      );

      for (const row of rows) {
        const rowId: ObjectID = ObjectID.generate();

        await insert("TeamPermission", {
          _id: rowId,
          projectId: projectId,
          teamId: memberTeamId,
          permission: row.permission,
          isBlockPermission: false,
          scope: scopeOf(row),
          version: 1,
        });

        for (const labelId of row.labelIds || []) {
          await insert("TeamPermissionLabel", {
            teamPermissionId: rowId,
            labelId: labelId,
          });
        }
      }
    };

    /*
     * A custom role holding `rows`, given to the member's team (with no
     * rows of its own), its copies written by the one sync that writes them.
     */
    const giveCustomRole: (
      rows: Array<PermissionRow>,
    ) => Promise<void> = async (rows: Array<PermissionRow>): Promise<void> => {
      await setGrants([]);

      const roleId: ObjectID = ObjectID.generate();

      await insert("CustomRole", {
        _id: roleId,
        projectId: projectId,
        name: `Owned monitors ${roleId.toString()}`,
        slug: `owned-monitors-${roleId.toString()}`,
        version: 1,
      });

      for (const row of rows) {
        const rolePermissionId: ObjectID = ObjectID.generate();

        await insert("CustomRolePermission", {
          _id: rolePermissionId,
          projectId: projectId,
          customRoleId: roleId,
          permission: row.permission,
          scope: scopeOf(row),
          version: 1,
        });

        for (const labelId of row.labelIds || []) {
          await insert("CustomRolePermissionLabel", {
            customRolePermissionId: rolePermissionId,
            labelId: labelId,
          });
        }
      }

      await insert("TeamCustomRole", {
        _id: ObjectID.generate(),
        projectId: projectId,
        teamId: memberTeamId,
        customRoleId: roleId,
        version: 1,
      });

      await CustomRoleSync.syncRoles({
        projectId: projectId,
        customRoleIds: [roleId],
      });

      // The team holds the role's permissions as its copies, and only them.
      const copies: Array<Dictionary<string>> = await database.query(
        `SELECT "permission", "scope", "teamCustomRoleId" IS NOT NULL AS "isCopy" FROM "${schema}"."TeamPermission" WHERE "teamId" = $1 ORDER BY "permission"`,
        [memberTeamId.toString()],
      );

      expect(copies).toEqual(
        rows
          .map((row: PermissionRow): Dictionary<unknown> => {
            return {
              permission: row.permission,
              scope: scopeOf(row),
              isCopy: true,
            };
          })
          .sort((a: Dictionary<unknown>, b: Dictionary<unknown>): number => {
            return String(a["permission"]).localeCompare(
              String(b["permission"]),
            );
          }),
      );
    };

    // A new API key of the project with these permission rows.
    const createApiKey: (
      permissions: Array<Permission>,
    ) => Promise<ObjectID> = async (
      permissions: Array<Permission>,
    ): Promise<ObjectID> => {
      const id: ObjectID = ObjectID.generate();
      const apiKey: ObjectID = ObjectID.generate();

      await insert("ApiKey", {
        _id: id,
        projectId: projectId,
        name: `Key ${id.toString()}`,
        slug: `key-${id.toString()}`,
        apiKey: apiKey,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        version: 1,
      });

      for (const permission of permissions) {
        await insert("ApiKeyPermission", {
          _id: ObjectID.generate(),
          projectId: projectId,
          apiKeyId: id,
          permission: permission,
          isBlockPermission: false,
          version: 1,
        });
      }

      return apiKey;
    };

    const headersOf: (caller: Caller) => Dictionary<string> = (
      caller: Caller,
    ): Dictionary<string> => {
      if (caller.kind === "apiKey") {
        return { apikey: caller.apiKey.toString() };
      }

      if (caller.kind === "anonymous") {
        return { tenantid: caller.tenantId.toString() };
      }

      const headers: Dictionary<string> = {
        authorization: `Bearer ${caller.userId.toString()}`,
      };

      if (caller.tenantId) {
        headers["tenantid"] = caller.tenantId.toString();
      }

      if (caller.isMultiTenant) {
        headers["is-multi-tenant-query"] = "true";
      }

      return headers;
    };

    const requestOf: (data: {
      method: string;
      caller: Caller;
      id?: ObjectID | undefined;
      body?: JSONObject | undefined;
    }) => ExpressRequest = (data: {
      method: string;
      caller: Caller;
      id?: ObjectID | undefined;
      body?: JSONObject | undefined;
    }): ExpressRequest => {
      return {
        method: data.method.toUpperCase(),
        params: data.id ? { id: data.id.toString() } : {},
        query: {},
        cookies: {},
        headers: headersOf(data.caller),
        body: data.body || {},
      } as unknown as ExpressRequest;
    };

    const responseStub: () => ExpressResponse = (): ExpressResponse => {
      return {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        send: jest.fn(),
      } as unknown as ExpressResponse;
    };

    // Sends one request through its route's middleware and handler.
    const send: (data: {
      method: "post" | "delete";
      uri: string;
      caller: Caller;
      id?: ObjectID | undefined;
      body?: JSONObject | undefined;
    }) => Promise<Outcome> = async (data: {
      method: "post" | "delete";
      uri: string;
      caller: Caller;
      id?: ObjectID | undefined;
      body?: JSONObject | undefined;
    }): Promise<Outcome> => {
      jest.mocked(Response.sendEntityResponse).mockClear();
      jest.mocked(Response.sendEntityArrayResponse).mockClear();
      jest.mocked(Response.sendJsonObjectResponse).mockClear();
      jest.mocked(Response.sendEmptySuccessResponse).mockClear();
      jest.mocked(Response.sendErrorResponse).mockClear();

      const req: ExpressRequest = requestOf(data);
      const res: ExpressResponse = responseStub();
      const route: (typeof mockRouter.routes)[number] = mockRouter.match(
        data.method,
        data.uri,
      );

      for (const middleware of route.middlewares) {
        let isPassed: boolean = false;

        await middleware(req, res, ((error?: unknown) => {
          if (!error) {
            isPassed = true;
          }
        }) as NextFunction);

        if (!isPassed) {
          return {
            error: jest.mocked(Response.sendErrorResponse).mock.calls[0]?.[2],
          };
        }
      }

      let forwardedError: unknown = undefined;

      await route.handlerFunction(req, res, ((error: unknown) => {
        forwardedError = error;
      }) as NextFunction);

      if (forwardedError) {
        return { error: forwardedError };
      }

      const listCall: Array<unknown> | undefined = jest.mocked(
        Response.sendEntityArrayResponse,
      ).mock.calls[0];

      if (listCall) {
        return {
          ids: (listCall[2] as Array<BaseModel>)
            .map((model: BaseModel): string => {
              return model.id!.toString();
            })
            .sort(),
        };
      }

      const itemCall: Array<unknown> | undefined = jest.mocked(
        Response.sendEntityResponse,
      ).mock.calls[0];

      if (itemCall) {
        return { item: (itemCall[2] as BaseModel | null) || null };
      }

      if (
        jest.mocked(Response.sendEmptySuccessResponse).mock.calls.length > 0
      ) {
        return { isEmptySuccess: true };
      }

      throw new Error(`${data.uri} answered nothing.`);
    };

    // The two ways the app deletes one record by its id.
    type Removal = (
      path: string,
      caller: Caller,
      id: ObjectID,
    ) => Promise<Outcome>;

    const deleteItem: Removal = async (
      path: string,
      caller: Caller,
      id: ObjectID,
    ): Promise<Outcome> => {
      return await send({
        method: "post",
        uri: `${path}/:id/delete-item`,
        caller: caller,
        id: id,
      });
    };

    const deleteById: Removal = async (
      path: string,
      caller: Caller,
      id: ObjectID,
    ): Promise<Outcome> => {
      return await send({
        method: "delete",
        uri: `${path}/:id`,
        caller: caller,
        id: id,
      });
    };

    const REMOVALS: Array<[string, Removal]> = [
      ["POST <path>/:id/delete-item", deleteItem],
      ["DELETE <path>/:id", deleteById],
    ];

    // The props a caller's request carries, as the user middleware builds them.
    const propsOf: (
      caller: Caller,
    ) => Promise<DatabaseCommonInteractionProps> = async (
      caller: Caller,
    ): Promise<DatabaseCommonInteractionProps> => {
      const req: ExpressRequest = requestOf({ method: "post", caller });

      for (const middleware of mockRouter.match("post", "/monitor/get-list")
        .middlewares) {
        let isPassed: boolean = false;

        await middleware(req, responseStub(), ((error?: unknown) => {
          isPassed = !error;
        }) as NextFunction);

        expect(isPassed).toBe(true);
      }

      return await CommonAPI.getDatabaseCommonInteractionProps(req);
    };

    // Answered exactly as a monitor that does not exist.
    const expectMissing: (outcome: Outcome, name: string) => void = (
      outcome: Outcome,
      name: string,
    ): void => {
      expect(outcome.isEmptySuccess).toBeUndefined();
      expect(outcome.error).toBeInstanceOf(NotFoundException);
      expect((outcome.error as Error).message).toBe(`${name} not found.`);
    };

    const expectRefused: (outcome: Outcome) => void = (
      outcome: Outcome,
    ): void => {
      expect(outcome.isEmptySuccess).toBeUndefined();
      expect(outcome.error).toBeInstanceOf(Exception);
    };

    const expectDeleted: (outcome: Outcome) => void = (
      outcome: Outcome,
    ): void => {
      expect(outcome.error).toBeUndefined();
      expect(outcome.isEmptySuccess).toBe(true);
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["OWNED_RECORDS_DELETE_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["OWNED_RECORDS_DELETE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["OWNED_RECORDS_DELETE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        /*
         * No schema of its own: table names stay unqualified, so the tables
         * copied into the test schema are found first and every other table
         * a delete reads (the rows deleted along with a record) is found,
         * empty, in public.
         */
        synchronize: false,
        logging: ["error"],
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      // Each swept kind's table, its label links and its owner tables too.
      const tables: Array<string> = [...TABLES];

      for (const kind of SWEPT_KINDS) {
        const metadata: EntityMetadata = database.getMetadata(kind.modelType);
        const accessControlColumn: string | null =
          new kind.modelType().getAccessControlColumn();
        const labels: RelationMetadata | undefined =
          metadata.manyToManyRelations.find(
            (relation: RelationMetadata): boolean => {
              return relation.propertyName === accessControlColumn;
            },
          );

        for (const table of [
          metadata.tableName,
          labels?.junctionEntityMetadata?.tableName,
          database.getMetadata(kind.pair.ownerUserService.modelType).tableName,
          database.getMetadata(kind.pair.ownerTeamService.modelType).tableName,
        ]) {
          if (table && !tables.includes(table)) {
            tables.push(table);
          }
        }
      }

      for (const table of tables) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
        copiedTables.push(table);

        requiredColumns[table] = (
          await database.query(
            `SELECT "column_name", "data_type", "udt_name", "character_maximum_length" FROM information_schema.columns WHERE "table_schema" = 'public' AND "table_name" = $1 AND "is_nullable" = 'NO' AND "column_default" IS NULL`,
            [table],
          )
        ).map(
          (column: {
            column_name: string;
            data_type: string;
            udt_name: string;
            character_maximum_length: number | null;
          }) => {
            return {
              name: column.column_name,
              type: column.data_type,
              udt: column.udt_name,
              length: column.character_maximum_length,
            };
          },
        );
      }

      getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      getJestSpyOn(PostgresAppInstance, "getDataSource").mockReturnValue(
        database,
      );

      // The session token names the member; it is not a signed token here.
      getJestSpyOn(JSONWebToken, "decode").mockImplementation(((
        token: string,
      ): JSONWebTokenData => {
        return {
          userId: new ObjectID(token),
          isMasterAdmin: false,
          isGlobalLogin: true,
        } as JSONWebTokenData;
      }) as never);

      // Permissions are read from the tables every time: nothing is cached.
      getJestSpyOn(GlobalCache, "getJSONObject").mockResolvedValue(
        null as never,
      );
      getJestSpyOn(GlobalCache, "setJSON").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(GlobalCache, "deleteKey").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(RealtimeAccessChanges, "announce").mockReturnValue(
        undefined as never,
      );

      getJestSpyOn(UserService, "isUserBlocked").mockResolvedValue(
        false as never,
      );
      getJestSpyOn(UserService, "updateLastActive").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(ProjectService, "getRequireSsoForLogin").mockResolvedValue(
        false as never,
      );
      getJestSpyOn(
        GlobalConfigService,
        "getRequireSsoForLogin",
      ).mockResolvedValue(false as never);

      // Workflows and live updates run elsewhere.
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerWorkflow",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerRealtime",
      ).mockResolvedValue(undefined as never);

      // The locks and the shared cache generations (Valkey): always free.
      getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
        key: string;
        namespace: string;
      }): Promise<unknown> => {
        return { key: data.key, namespace: data.namespace };
      }) as never);
      getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined as never);
      getJestSpyOn(CacheGenerations.prototype, "bump").mockResolvedValue(
        undefined as never,
      );

      for (const [id, name] of [
        [projectId, "Owned records project"],
        [otherProjectId, "Another project"],
      ] as Array<[ObjectID, string]>) {
        await insert("Project", {
          _id: id,
          name: name,
          slug: id.toString(),
          version: 1,
        });
      }

      for (const id of [memberId, otherUserId, outsiderId]) {
        await insert("User", {
          _id: id,
          name: "Synthetic User",
          email: `${id.toString()}@example.com`,
          slug: id.toString(),
          version: 1,
        });
      }

      for (const [teamId, inProject, userId] of [
        [memberTeamId, projectId, memberId],
        [otherTeamId, projectId, otherUserId],
        [outsiderTeamId, otherProjectId, outsiderId],
      ] as Array<[ObjectID, ObjectID, ObjectID]>) {
        await insert("Team", {
          _id: teamId,
          projectId: inProject,
          name: `Team ${teamId.toString()}`,
          slug: teamId.toString(),
          version: 1,
        });
        await insert("TeamMember", {
          _id: ObjectID.generate(),
          projectId: inProject,
          teamId: teamId,
          userId: userId,
          hasAcceptedInvitation: true,
          version: 1,
        });
      }

      await insertAnyRow("Label", {
        _id: readLabelId,
        projectId: projectId,
        name: "Read by label",
        version: 1,
      });

      // The outsider may delete every monitor of their own project.
      await insert("TeamPermission", {
        _id: ObjectID.generate(),
        projectId: otherProjectId,
        teamId: outsiderTeamId,
        permission: Permission.MonitorAdmin,
        isBlockPermission: false,
        scope: PermissionScope.All,
        version: 1,
      });
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    /*
     * Every grant a member may hold scoped to Owned that lets them delete a
     * monitor. Each reaches the monitors the member or their team owns, and
     * no other.
     */
    const OWNED_GRANTS: Array<[string, () => Promise<void>]> = [
      [
        "Monitor Admin scoped to Owned",
        async (): Promise<void> => {
          await setGrants([
            {
              permission: Permission.MonitorAdmin,
              scope: PermissionScope.Owned,
            },
          ]);
        },
      ],
      [
        "Monitor Member scoped to Owned",
        async (): Promise<void> => {
          await setGrants([
            {
              permission: Permission.MonitorMember,
              scope: PermissionScope.Owned,
            },
          ]);
        },
      ],
      [
        "Read Monitor and Delete Monitor scoped to Owned",
        async (): Promise<void> => {
          await setGrants([
            {
              permission: Permission.ReadProjectMonitor,
              scope: PermissionScope.Owned,
            },
            {
              permission: Permission.DeleteProjectMonitor,
              scope: PermissionScope.Owned,
            },
          ]);
        },
      ],
      [
        "Project Member scoped to Owned",
        async (): Promise<void> => {
          await setGrants([
            {
              permission: Permission.ProjectMember,
              scope: PermissionScope.Owned,
            },
          ]);
        },
      ],
      [
        "the All Operational Resources read and delete scoped to Owned",
        async (): Promise<void> => {
          await setGrants([
            {
              permission: Permission.ReadAllOperationalResources,
              scope: PermissionScope.Owned,
            },
            {
              permission: Permission.DeleteAllOperationalResources,
              scope: PermissionScope.Owned,
            },
          ]);
        },
      ],
      [
        "a custom role's Monitor Admin scoped to Owned",
        async (): Promise<void> => {
          await giveCustomRole([
            {
              permission: Permission.MonitorAdmin,
              scope: PermissionScope.Owned,
            },
          ]);
        },
      ],
    ];

    describe.each(OWNED_GRANTS)(
      "a member holding %s",
      (_grant: string, grant: () => Promise<void>) => {
        beforeAll(async () => {
          await grant();
        });

        test("deletes a monitor they or their team own, by either route", async () => {
          for (const [route, remove] of REMOVALS) {
            for (const owner of ["member", "memberTeam"] as Array<Owner>) {
              const monitorId: ObjectID = await insertMonitor(owner);

              const outcome: Outcome = await remove(
                "/monitor",
                member,
                monitorId,
              );

              expect([route, owner, outcome.error]).toEqual([
                route,
                owner,
                undefined,
              ]);
              expectDeleted(outcome);
              expect([
                route,
                owner,
                await rowExists("Monitor", monitorId),
              ]).toEqual([route, owner, false]);
            }
          }
        });

        test("a monitor somebody else or nobody owns is answered as missing, by either route, and stays with its owners", async () => {
          for (const [route, remove] of REMOVALS) {
            for (const owner of OTHERS) {
              const monitorId: ObjectID = await insertMonitor(owner);
              const ownersBefore: Array<Dictionary<string>> = [
                ...(await ownerRowsOf(
                  "MonitorOwnerUser",
                  "monitorId",
                  monitorId,
                )),
                ...(await ownerRowsOf(
                  "MonitorOwnerTeam",
                  "monitorId",
                  monitorId,
                )),
              ];

              const outcome: Outcome = await remove(
                "/monitor",
                member,
                monitorId,
              );

              expect([route, owner, outcome.error]).toEqual([
                route,
                owner,
                expect.any(NotFoundException),
              ]);
              expectMissing(outcome, "Monitor");
              expect([
                route,
                owner,
                await rowExists("Monitor", monitorId),
              ]).toEqual([route, owner, true]);
              expect([
                ...(await ownerRowsOf(
                  "MonitorOwnerUser",
                  "monitorId",
                  monitorId,
                )),
                ...(await ownerRowsOf(
                  "MonitorOwnerTeam",
                  "monitorId",
                  monitorId,
                )),
              ]).toEqual(ownersBefore);
            }
          }
        });

        test("lists only the monitors they or their team own", async () => {
          const mine: ObjectID = await insertMonitor("member");
          const ours: ObjectID = await insertMonitor("memberTeam");
          const others: Array<ObjectID> = [];

          for (const owner of OTHERS) {
            others.push(await insertMonitor(owner));
          }

          const listed: Outcome = await send({
            method: "post",
            uri: "/monitor/get-list",
            caller: member,
            body: {
              query: JSONFunctions.serialize({
                _id: new Includes([mine, ours, ...others]),
              } as unknown as JSONObject),
              select: { _id: true },
              limit: 50,
            },
          });

          expect(listed.error).toBeUndefined();
          expect(listed.ids).toEqual([mine.toString(), ours.toString()].sort());
        });

        test("a delete by query, as the member, removes only the monitors they or their team own", async () => {
          const owned: Array<ObjectID> = [
            await insertMonitor("member"),
            await insertMonitor("memberTeam"),
          ];
          const others: Array<ObjectID> = [];

          for (const owner of OTHERS) {
            others.push(await insertMonitor(owner));
          }

          const removed: number = await MonitorService.deleteBy({
            query: { _id: new Includes([...owned, ...others]) },
            props: await propsOf(member),
            limit: 50,
            skip: 0,
          });

          expect(removed).toBe(2);

          for (const id of owned) {
            expect(await rowExists("Monitor", id)).toBe(false);
          }

          for (const id of others) {
            expect(await rowExists("Monitor", id)).toBe(true);
          }
        });

        test("a hard delete by query, as the member, removes only the monitors they or their team own", async () => {
          const owned: Array<ObjectID> = [
            await insertMonitor("member"),
            await insertMonitor("memberTeam"),
          ];
          const others: Array<ObjectID> = [];

          for (const owner of OTHERS) {
            others.push(await insertMonitor(owner));
          }

          await MonitorService.hardDeleteBy({
            query: { _id: new Includes([...owned, ...others]) },
            props: await propsOf(member),
            limit: 50,
            skip: 0,
          });

          for (const id of owned) {
            expect(await rowExists("Monitor", id)).toBe(false);
          }

          for (const id of others) {
            expect(await rowExists("Monitor", id)).toBe(true);
          }
        });
      },
    );

    describe("grants of two scopes", () => {
      test("a delete scoped to Owned beside a read of every monitor: the monitors it does not own are refused, as ones they may read but not delete", async () => {
        await setGrants([
          {
            permission: Permission.ReadProjectMonitor,
            scope: PermissionScope.All,
          },
          {
            permission: Permission.DeleteProjectMonitor,
            scope: PermissionScope.Owned,
          },
        ]);

        for (const owner of OTHERS) {
          const monitorId: ObjectID = await insertMonitor(owner);
          const outcome: Outcome = await deleteItem(
            "/monitor",
            member,
            monitorId,
          );

          expect(outcome.error).toBeInstanceOf(NotAuthorizedException);
          expect((outcome.error as Error).message).toBe(
            "You do not have permission to delete this monitor.",
          );
          expect(await rowExists("Monitor", monitorId)).toBe(true);
        }

        const mine: ObjectID = await insertMonitor("member");

        expectDeleted(await deleteItem("/monitor", member, mine));
        expect(await rowExists("Monitor", mine)).toBe(false);
      });

      test("a delete of every monitor beside a read scoped to Owned: a delete needs the read, so the others are answered as missing", async () => {
        await setGrants([
          {
            permission: Permission.ReadProjectMonitor,
            scope: PermissionScope.Owned,
          },
          {
            permission: Permission.DeleteProjectMonitor,
            scope: PermissionScope.All,
          },
        ]);

        for (const owner of OTHERS) {
          const monitorId: ObjectID = await insertMonitor(owner);

          expectMissing(
            await deleteItem("/monitor", member, monitorId),
            "Monitor",
          );
          expect(await rowExists("Monitor", monitorId)).toBe(true);
        }

        const ours: ObjectID = await insertMonitor("memberTeam");

        expectDeleted(await deleteById("/monitor", member, ours));
        expect(await rowExists("Monitor", ours)).toBe(false);
      });

      test("a grant over the whole project beside the owned one reaches every monitor: the broader grant wins", async () => {
        await setGrants([
          {
            permission: Permission.MonitorAdmin,
            scope: PermissionScope.Owned,
          },
          { permission: Permission.MonitorAdmin, scope: PermissionScope.All },
        ]);

        for (const owner of OTHERS) {
          const monitorId: ObjectID = await insertMonitor(owner);

          expectDeleted(await deleteItem("/monitor", member, monitorId));
          expect(await rowExists("Monitor", monitorId)).toBe(false);
        }
      });
    });

    describe("nobody makes themselves an owner of a monitor they may not read", () => {
      beforeAll(async () => {
        await setGrants([
          {
            permission: Permission.MonitorAdmin,
            scope: PermissionScope.Owned,
          },
        ]);
      });

      test.each([
        ["themselves", "/monitor-owner-user", "MonitorOwnerUser", "userId"],
        ["their team", "/monitor-owner-team", "MonitorOwnerTeam", "teamId"],
      ])(
        "adding %s as an owner is refused, and the monitor still cannot be deleted",
        async (
          _who: string,
          path: string,
          table: string,
          ownerColumn: string,
        ) => {
          for (const owner of OTHERS) {
            const monitorId: ObjectID = await insertMonitor(owner);
            const ownersBefore: Array<Dictionary<string>> = await ownerRowsOf(
              table,
              "monitorId",
              monitorId,
            );

            const added: Outcome = await send({
              method: "post",
              uri: path,
              caller: member,
              body: {
                data: JSONFunctions.serialize({
                  monitorId: monitorId,
                  [ownerColumn]:
                    ownerColumn === "userId" ? memberId : memberTeamId,
                  projectId: projectId,
                } as unknown as JSONObject),
              },
            });

            expect([owner, added.error]).toEqual([
              owner,
              expect.any(UnreadableParentException),
            ]);
            expect(added.item).toBeUndefined();
            expect(await ownerRowsOf(table, "monitorId", monitorId)).toEqual(
              ownersBefore,
            );

            expectMissing(
              await deleteItem("/monitor", member, monitorId),
              "Monitor",
            );
            expect(await rowExists("Monitor", monitorId)).toBe(true);
          }
        },
      );

      test("an owner row of their own monitor is not moved onto another monitor", async () => {
        const mine: ObjectID = await insertMonitor("member");
        const victim: ObjectID = await insertMonitor("otherTeam");
        const [ownRow] = await ownerRowsOf(
          "MonitorOwnerUser",
          "monitorId",
          mine,
        );

        const moved: Outcome = await send({
          method: "post",
          uri: "/monitor-owner-user/:id/update-item",
          caller: member,
          id: new ObjectID(ownRow!["_id"]!),
          body: {
            data: JSONFunctions.serialize({
              monitorId: victim,
            } as unknown as JSONObject),
          },
        });

        expectRefused(moved);
        expect(
          await ownerRowsOf("MonitorOwnerUser", "monitorId", mine),
        ).toEqual([ownRow]);
        expect(
          await ownerRowsOf("MonitorOwnerUser", "monitorId", victim),
        ).toEqual([]);

        expectMissing(await deleteItem("/monitor", member, victim), "Monitor");
        expect(await rowExists("Monitor", victim)).toBe(true);
      });

      test("the owners of a monitor they may not read are not taken away", async () => {
        for (const [path, table, owner] of [
          ["/monitor-owner-user", "MonitorOwnerUser", "otherUser"],
          ["/monitor-owner-team", "MonitorOwnerTeam", "otherTeam"],
        ] as Array<[string, string, Owner]>) {
          const monitorId: ObjectID = await insertMonitor(owner);
          const [ownerRow] = await ownerRowsOf(table, "monitorId", monitorId);

          expectRefused(
            await deleteItem(path, member, new ObjectID(ownerRow!["_id"]!)),
          );
          expect(await ownerRowsOf(table, "monitorId", monitorId)).toEqual([
            ownerRow,
          ]);
        }
      });
    });

    /*
     * A delete scoped to Owned beside a read of more monitors - the whole
     * project's, or those carrying a label. A member set up to "see every
     * monitor, manage your own" is a common shape, and the Owned scope must
     * still hold their delete to the monitors they or their team own: being
     * able to read a monitor is not being able to delete it.
     *
     * (A separate hardening - narrowing who may add or remove a monitor's
     * owners by the same Owned scope, so a broad reader cannot hand a
     * monitor to themselves by naming themselves its owner - is tracked on
     * its own, since it is a change to owner-management scope across every
     * kind that carries owners, not to the delete this suite covers.)
     */
    const READ_BEYOND_OWNED_GRANTS: Array<[string, () => Promise<void>]> = [
      [
        "Monitor Admin scoped to Owned beside Monitor Viewer over the whole project",
        async (): Promise<void> => {
          await setGrants([
            {
              permission: Permission.MonitorAdmin,
              scope: PermissionScope.Owned,
            },
            {
              permission: Permission.MonitorViewer,
              scope: PermissionScope.All,
            },
          ]);
        },
      ],
      [
        "Monitor Member scoped to Owned beside the Viewer role",
        async (): Promise<void> => {
          await setGrants([
            {
              permission: Permission.MonitorMember,
              scope: PermissionScope.Owned,
            },
            { permission: Permission.Viewer, scope: PermissionScope.All },
          ]);
        },
      ],
      [
        "Delete Monitor scoped to Owned beside Read Monitor over the whole project",
        async (): Promise<void> => {
          await setGrants([
            {
              permission: Permission.ReadProjectMonitor,
              scope: PermissionScope.All,
            },
            {
              permission: Permission.DeleteProjectMonitor,
              scope: PermissionScope.Owned,
            },
          ]);
        },
      ],
      [
        "Monitor Admin scoped to Owned beside Monitor Viewer limited to a label every monitor here carries",
        async (): Promise<void> => {
          await setGrants([
            {
              permission: Permission.MonitorAdmin,
              scope: PermissionScope.Owned,
            },
            {
              permission: Permission.MonitorViewer,
              labelIds: [readLabelId],
            },
          ]);
        },
      ],
      [
        "a custom role's Monitor Admin scoped to Owned and Monitor Viewer over the whole project",
        async (): Promise<void> => {
          await giveCustomRole([
            {
              permission: Permission.MonitorAdmin,
              scope: PermissionScope.Owned,
            },
            {
              permission: Permission.MonitorViewer,
              scope: PermissionScope.All,
            },
          ]);
        },
      ],
    ];

    // A monitor owned by `owner`, carrying the label a read may be limited to.
    const insertLabelledMonitor: (owner: Owner) => Promise<ObjectID> = async (
      owner: Owner,
    ): Promise<ObjectID> => {
      const monitorId: ObjectID = await insertMonitor(owner);

      await insert("MonitorLabel", {
        monitorId: monitorId,
        labelId: readLabelId,
      });

      return monitorId;
    };

    describe.each(READ_BEYOND_OWNED_GRANTS)(
      "a member holding %s",
      (_grant: string, grant: () => Promise<void>) => {
        beforeAll(async () => {
          await grant();
        });

        test("reads the monitors they do not own, and deletes only the ones they or their team own, by either route", async () => {
          const owned: Array<ObjectID> = [
            await insertLabelledMonitor("member"),
            await insertLabelledMonitor("memberTeam"),
          ];
          const others: Array<ObjectID> = [];

          for (const owner of OTHERS) {
            others.push(await insertLabelledMonitor(owner));
          }

          // They read every monitor, owned or not.
          const listed: Outcome = await send({
            method: "post",
            uri: "/monitor/get-list",
            caller: member,
            body: {
              query: JSONFunctions.serialize({
                _id: new Includes([...owned, ...others]),
              } as unknown as JSONObject),
              select: { _id: true },
              limit: 50,
            },
          });

          expect(listed.error).toBeUndefined();
          expect(listed.ids).toEqual(
            [...owned, ...others]
              .map((id: ObjectID): string => {
                return id.toString();
              })
              .sort(),
          );

          // A monitor they do not own is refused - as one they may read but not delete.
          for (const [route, remove] of REMOVALS) {
            for (const monitorId of others) {
              const outcome: Outcome = await remove(
                "/monitor",
                member,
                monitorId,
              );

              expect([route, outcome.error]).toEqual([
                route,
                expect.any(NotAuthorizedException),
              ]);
              expect((outcome.error as Error).message).toBe(
                "You do not have permission to delete this monitor.",
              );
              expect(await rowExists("Monitor", monitorId)).toBe(true);
            }
          }

          // The monitors they or their team own are deleted.
          for (const monitorId of owned) {
            expectDeleted(await deleteItem("/monitor", member, monitorId));
            expect(await rowExists("Monitor", monitorId)).toBe(false);
          }
        });

        test("a delete by query removes only the monitors they or their team own, though they read more", async () => {
          const owned: Array<ObjectID> = [
            await insertLabelledMonitor("member"),
            await insertLabelledMonitor("memberTeam"),
          ];
          const others: Array<ObjectID> = [];

          for (const owner of OTHERS) {
            others.push(await insertLabelledMonitor(owner));
          }

          const removed: number = await MonitorService.deleteBy({
            query: { _id: new Includes([...owned, ...others]) },
            props: await propsOf(member),
            limit: 50,
            skip: 0,
          });

          expect(removed).toBe(2);

          for (const id of owned) {
            expect(await rowExists("Monitor", id)).toBe(false);
          }

          for (const id of others) {
            expect(await rowExists("Monitor", id)).toBe(true);
          }
        });
      },
    );

    describe("the records of a monitor, and of a status page", () => {
      test.each([
        [
          "a status timeline entry",
          "/monitor-status-timeline",
          "MonitorStatusTimeline",
          new MonitorStatusTimeline().singularName!,
        ],
        [
          "a monitor test",
          "/monitor-test",
          "MonitorTest",
          new MonitorTest().singularName!,
        ],
      ])(
        "%s is deleted only on a monitor the member or their team owns",
        async (
          _what: string,
          path: string,
          table: string,
          singularName: string,
        ) => {
          await setGrants([
            {
              permission: Permission.MonitorAdmin,
              scope: PermissionScope.Owned,
            },
          ]);

          for (const owner of [
            "member",
            "memberTeam",
            ...OTHERS,
          ] as Array<Owner>) {
            const monitorId: ObjectID = await insertMonitor(owner);
            const rowId: ObjectID = ObjectID.generate();

            await insertAnyRow(table, {
              _id: rowId,
              projectId: projectId,
              monitorId: monitorId,
              version: 1,
            });

            const outcome: Outcome = await deleteItem(path, member, rowId);
            const isOwned: boolean =
              owner === "member" || owner === "memberTeam";

            if (isOwned) {
              expectDeleted(outcome);
            } else {
              expectMissing(outcome, singularName);
            }

            expect([owner, await rowExists(table, rowId)]).toEqual([
              owner,
              !isOwned,
            ]);
          }
        },
      );

      test.each([
        [
          "an announcement",
          "/status-page-announcement",
          "StatusPageAnnouncement",
          "AnnouncementStatusPage",
          "announcementId",
          [
            Permission.ReadStatusPageAnnouncement,
            Permission.DeleteStatusPageAnnouncement,
          ],
        ],
        [
          "an announcement template",
          "/status-page-announcement-template",
          "StatusPageAnnouncementTemplate",
          "AnnouncementTemplateStatusPage",
          "announcementTemplateId",
          [
            Permission.ReadStatusPageAnnouncementTemplate,
            Permission.DeleteStatusPageAnnouncementTemplate,
          ],
        ],
      ])(
        "%s is deleted only when a status page it is on is one the member or their team owns",
        async (
          _what: string,
          path: string,
          table: string,
          linkTable: string,
          linkColumn: string,
          permissions: Array<Permission>,
        ) => {
          // Status pages read only when owned; the record's own permissions over the project.
          await setGrants([
            {
              permission: Permission.ReadProjectStatusPage,
              scope: PermissionScope.Owned,
            },
            ...permissions.map((permission: Permission): PermissionRow => {
              return { permission: permission };
            }),
          ]);

          const ownedPage: ObjectID = await insertStatusPage("memberTeam");
          const otherPage: ObjectID = await insertStatusPage("otherTeam");
          const unownedPage: ObjectID = await insertStatusPage("nobody");

          for (const [pages, isReached] of [
            [[ownedPage], true],
            [[ownedPage, otherPage], true],
            [[otherPage], false],
            [[unownedPage], false],
            [[otherPage, unownedPage], false],
            [[], false],
          ] as Array<[Array<ObjectID>, boolean]>) {
            const rowId: ObjectID = ObjectID.generate();

            await insertAnyRow(table, {
              _id: rowId,
              projectId: projectId,
              version: 1,
            });

            for (const pageId of pages) {
              await insert(linkTable, {
                [linkColumn]: rowId,
                statusPageId: pageId,
              });
            }

            const outcome: Outcome = await deleteItem(path, member, rowId);

            if (isReached) {
              expectDeleted(outcome);
            } else {
              expect(outcome.error).toBeInstanceOf(NotFoundException);
            }

            expect([pages.length, await rowExists(table, rowId)]).toEqual([
              pages.length,
              !isReached,
            ]);
          }
        },
      );
    });

    describe("whoever else asks", () => {
      test("a viewer of every monitor deletes none, owned or not", async () => {
        await setGrants([
          { permission: Permission.MonitorViewer, scope: PermissionScope.All },
        ]);

        for (const owner of ["member", ...OTHERS] as Array<Owner>) {
          const monitorId: ObjectID = await insertMonitor(owner);
          const outcome: Outcome = await deleteItem(
            "/monitor",
            member,
            monitorId,
          );

          expect(outcome.error).toBeInstanceOf(NotAuthorizedException);
          expect(await rowExists("Monitor", monitorId)).toBe(true);
        }
      });

      test("a member of another project deletes none of this project's monitors", async () => {
        const monitorId: ObjectID = await insertMonitor("otherTeam");

        for (const [, remove] of REMOVALS) {
          expectRefused(
            await remove(
              "/monitor",
              { kind: "member", userId: outsiderId, tenantId: projectId },
              monitorId,
            ),
          );
          expect(await rowExists("Monitor", monitorId)).toBe(true);
        }
      });

      test("a request without a session deletes nothing", async () => {
        const monitorId: ObjectID = await insertMonitor("nobody");

        expectRefused(
          await deleteItem(
            "/monitor",
            { kind: "anonymous", tenantId: projectId },
            monitorId,
          ),
        );
        expect(await rowExists("Monitor", monitorId)).toBe(true);
      });

      test("a monitor of another project is answered as missing, even one the member's grant would reach there", async () => {
        await setGrants([
          { permission: Permission.MonitorAdmin, scope: PermissionScope.All },
        ]);

        const monitorId: ObjectID = await insertMonitor(
          "nobody",
          otherProjectId,
        );

        expectMissing(
          await deleteItem("/monitor", member, monitorId),
          "Monitor",
        );
        expect(await rowExists("Monitor", monitorId)).toBe(true);
      });

      test("a delete across projects is refused, even of a monitor the member owns", async () => {
        await setGrants([
          {
            permission: Permission.MonitorAdmin,
            scope: PermissionScope.Owned,
          },
        ]);

        const monitorId: ObjectID = await insertMonitor("member");

        expectRefused(
          await deleteItem(
            "/monitor",
            { kind: "member", userId: memberId, isMultiTenant: true },
            monitorId,
          ),
        );
        expect(await rowExists("Monitor", monitorId)).toBe(true);
      });

      /*
       * Keys carry no scope: ownership resolves against a person, and a key
       * is none (permissions docs: "Keys do not support the Owned scope").
       * A key's grant reaches what it names, over the whole project.
       */
      test("an API key holds no scope: its delete reaches every monitor its grant reaches", async () => {
        const apiKey: ObjectID = await createApiKey([
          Permission.ReadProjectMonitor,
          Permission.DeleteProjectMonitor,
        ]);

        for (const owner of OTHERS) {
          const monitorId: ObjectID = await insertMonitor(owner);

          expectDeleted(
            await deleteItem(
              "/monitor",
              { kind: "apiKey", apiKey: apiKey },
              monitorId,
            ),
          );
          expect(await rowExists("Monitor", monitorId)).toBe(false);
        }
      });
    });

    /*
     * Every other kind with owners of its own: a member holding its
     * delete and read permissions scoped to Owned deletes the records they
     * or their team own and no other, by id and by query.
     */
    describe.each(SWEPT_KINDS)("$name", (kind: OwningKind) => {
      const path: string = new kind.modelType().getCrudApiPath()!.toString();

      const singularName: string =
        new kind.modelType().singularName || "Record";

      const insertRecord: (owner: Owner) => Promise<ObjectID> = async (
        owner: Owner,
      ): Promise<ObjectID> => {
        return await insertOwned({
          table: database.getMetadata(kind.modelType).tableName,
          ownerUserTable: database.getMetadata(
            kind.pair.ownerUserService.modelType,
          ).tableName,
          ownerTeamTable: database.getMetadata(
            kind.pair.ownerTeamService.modelType,
          ).tableName,
          ownerColumn: kind.pair.fkColumn,
          owner: owner,
        });
      };

      const tableOf: () => string = (): string => {
        return database.getMetadata(kind.modelType).tableName;
      };

      beforeAll(async () => {
        const model: BaseModel = new kind.modelType();
        const permissions: Array<Permission> = Array.from(
          new Set<Permission>([
            ...model.deleteRecordPermissions,
            ...model.readRecordPermissions,
          ]),
        ).filter((permission: Permission): boolean => {
          return OWN_READ_OR_DELETE_PERMISSION.test(permission);
        });

        expect(permissions.length).toBeGreaterThanOrEqual(2);

        await setGrants(
          permissions.map((permission: Permission): PermissionRow => {
            return { permission: permission, scope: PermissionScope.Owned };
          }),
        );
      });

      test("by id: the records the member or their team own go, the others are answered as missing and stay", async () => {
        for (const owner of [
          "member",
          "memberTeam",
          ...OTHERS,
        ] as Array<Owner>) {
          const id: ObjectID = await insertRecord(owner);
          const outcome: Outcome = await deleteItem(path, member, id);
          const isOwned: boolean = owner === "member" || owner === "memberTeam";

          if (isOwned) {
            expect([owner, outcome.error]).toEqual([owner, undefined]);
            expectDeleted(outcome);
          } else {
            expectMissing(outcome, singularName);
          }

          expect([owner, await rowExists(tableOf(), id)]).toEqual([
            owner,
            !isOwned,
          ]);
        }
      });

      test("by query: only the records the member or their team own go", async () => {
        const owned: Array<ObjectID> = [
          await insertRecord("member"),
          await insertRecord("memberTeam"),
        ];
        const others: Array<ObjectID> = [];

        for (const owner of OTHERS) {
          others.push(await insertRecord(owner));
        }

        const removed: number = await sweptServices[kind.name]!.deleteBy({
          query: { _id: new Includes([...owned, ...others]) },
          props: await propsOf(member),
          limit: 50,
          skip: 0,
        });

        expect(removed).toBe(2);

        for (const id of owned) {
          expect(await rowExists(tableOf(), id)).toBe(false);
        }

        for (const id of others) {
          expect(await rowExists(tableOf(), id)).toBe(true);
        }
      });
    });

    test("the suite copied every table it writes", () => {
      expect(copiedTables.length).toBeGreaterThan(TABLES.length + 60);
    });
  },
);
