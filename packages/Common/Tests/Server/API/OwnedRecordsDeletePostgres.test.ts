import { mockRouter } from "./Helpers";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import CacheGenerations from "../../../Server/Infrastructure/CacheGenerations";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import { AddIncomingCallLogItemPolicy1803600000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1803600000000-AddIncomingCallLogItemPolicy";
import { AddIncomingCallLogItemPolicyIndexAndKey1803650000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1803650000000-AddIncomingCallLogItemPolicyIndexAndKey";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import IncomingCallLogItemService from "../../../Server/Services/IncomingCallLogItemService";
import MonitorOwnerTeamService from "../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyScheduleCalendarFeedService from "../../../Server/Services/OnCallDutyPolicyScheduleCalendarFeedService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import CreateScopeException from "../../../Server/Types/Database/Permissions/CreateScopeException";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import CustomRoleSync from "../../../Server/Utils/CustomRole/CustomRoleSync";
import {
  UnreadableParentException,
  UnreadableReferenceException,
} from "../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import Response from "../../../Server/Utils/Response";
import OwnerRuleAssignment from "../../../Server/Utils/Rules/OwnerRuleAssignment";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeInternalNote from "../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodeRoleMember from "../../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncomingCallLog from "../../../Models/DatabaseModels/IncomingCallLog";
import IncomingCallLogItem from "../../../Models/DatabaseModels/IncomingCallLogItem";
import IncomingCallStatus from "../../../Types/IncomingCall/IncomingCallStatus";
import IncomingCallPolicyEscalationRule from "../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorTest from "../../../Models/DatabaseModels/MonitorTest";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleCalendarFeed from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleCalendarFeed";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageAnnouncementTemplate from "../../../Models/DatabaseModels/StatusPageAnnouncementTemplate";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
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
import { buildNewScheduleLayer } from "../../../Types/OnCallDutyPolicy/ScheduleLayerDefaults";
import { isReadByEveryReader } from "../TestingUtils/OwnedScopeKinds";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, EntityMetadata, QueryRunner } from "typeorm";
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
 *   - An owner row is owned through its monitor: a member whose permission
 *     to add and remove owners is scoped to Owned adds and removes them only
 *     on the monitors they or their team own, however many more they read -
 *     by id, by query and through a create form's owners - and so does every
 *     other kind with owners of its own. Grants over the whole project, API
 *     keys and workflow steps add and remove any owner, and nobody moves an
 *     owner row to another monitor.
 *   - However the request is shaped: the monitor named by its relation, by
 *     both names or in capitals; a removal or a change by a query naming no
 *     monitor; from another project, across projects or without a session.
 *     A monitor created through its own route takes the owners its form
 *     picked, as its creator's own.
 *   - The records of a monitor (its status timeline, its tests) and a status
 *     page's announcements and announcement templates keep to the owned
 *     monitors and status pages.
 *   - Across projects, from another project, without a session or with a
 *     viewer's permissions: refused. An API key holds no scope.
 *   - Every other kind with owners of its own - monitor groups, on-call
 *     schedules, episodes, incoming call policies, templates, probes,
 *     runners and AI agents among them - by id and by query: what a member
 *     lists, changes and deletes of it, and whose owners they add and remove.
 *     A kind other records are set up with (TestingUtils/OwnedScopeKinds)
 *     is listed in full and changed only where owned.
 *   - The pickers of those kinds: a monitor's probes, an escalation rule's
 *     schedules, the incident and maintenance templates, the runners, the
 *     AI agents - and a status page's monitor groups, which keep to the
 *     owned ones as its monitors do.
 *   - The records that are part of a kind with owners - a schedule's layers,
 *     the people in them and its shared link, an incoming call policy's
 *     escalation rules and calls, an episode's notes and role members, the
 *     monitors a group holds - keep to its owners.
 *   - A Runner is read by every reader of Runners, but its key - which lets
 *     whoever holds it act as the Runner - only where the member or their
 *     team own the Runner: left out of the others, not matched by a filter
 *     or a search, not ordered by, and not filtered on through a Runner's
 *     owners.
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
  // A role's sync keeps the API keys given it too.
  "ApiKeyCustomRole",
  "Monitor",
  // The status a monitor created through its route starts in.
  "MonitorStatus",
  "MonitorLabel",
  "MonitorOwnerUser",
  "MonitorOwnerTeam",
  // What adding or removing a monitor's owner writes to its feed.
  "MonitorFeed",
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
  // The pickers of the kinds other records are set up with, and their parts.
  "MonitorProbe",
  "OnCallDutyPolicyEscalationRule",
  "OnCallDutyPolicyEscalationRuleSchedule",
  "OnCallDutyPolicyScheduleLayer",
  "OnCallDutyPolicyScheduleLayerUser",
  "OnCallDutyPolicyScheduleCalendarFeed",
  "IncomingCallPolicyEscalationRule",
  "IncomingCallLog",
  // Each attempt to reach someone during a call.
  "IncomingCallLogItem",
  "IncidentEpisodeRoleMember",
  "IncidentEpisodeInternalNote",
  // The monitors a group holds.
  "MonitorGroupResource",
  // What a status page shows: a monitor group among them.
  "StatusPageResource",
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

// A kind's own read permission (Read Monitor).
const OWN_READ_PERMISSION: RegExp = /^Read/;

// An owner table's own permissions to add, read and remove owners.
const OWN_OWNER_PERMISSION: RegExp = /^(Create|Read|Delete)/;

// A kind's own read and edit permissions (Read Monitor, Edit Monitor).
const OWN_READ_OR_EDIT_PERMISSION: RegExp = /^(Read|Edit)/;

// An owner table, by its name, and the kind it owns: MonitorOwnerUser.
const OWNER_TABLE_NAME: RegExp = /^(.+)Owner(User|Team)$/;

/*
 * The text columns a change of a kind writes in this suite, the first of
 * them the kind has and its permission to change it may write.
 */
const CHANGED_TEXT_COLUMNS: Array<string> = ["description", "name", "title"];

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

    // Each swept kind's owner tables (people and teams), by owner table name.
    const sweptOwnerServices: Dictionary<DatabaseService<BaseModel>> = {};

    for (const kind of SWEPT_KINDS) {
      sweptServices[kind.name] = new DatabaseService(
        kind.modelType,
      ) as DatabaseService<BaseModel>;
      new BaseAPI(kind.modelType, sweptServices[kind.name]!);

      for (const ownerService of [
        kind.pair.ownerUserService,
        kind.pair.ownerTeamService,
      ] as Array<{ modelType: { new (): BaseModel } }>) {
        const ownerModelType: { new (): BaseModel } = ownerService.modelType;

        sweptOwnerServices[ownerModelType.name] = new DatabaseService(
          ownerModelType,
        ) as DatabaseService<BaseModel>;
        new BaseAPI(ownerModelType, sweptOwnerServices[ownerModelType.name]!);
      }
    }

    /*
     * The records that pick a kind other records are set up with, and the
     * records that are part of a kind with owners - plain services, as the
     * swept kinds have: what is under test is the permission pipeline every
     * service runs. A schedule's shared link has its own service, which
     * mints the link's token.
     */
    const partServices: Dictionary<DatabaseService<BaseModel>> = {};

    for (const modelType of [
      MonitorProbe,
      OnCallDutyPolicyEscalationRuleSchedule,
      OnCallDutyPolicyScheduleLayer,
      OnCallDutyPolicyScheduleLayerUser,
      IncomingCallPolicyEscalationRule,
      IncomingCallLog,
      IncomingCallLogItem,
      IncidentEpisodeRoleMember,
      IncidentEpisodeInternalNote,
      MonitorGroupResource,
      StatusPageResource,
    ] as Array<{ new (): BaseModel }>) {
      partServices[modelType.name] = new DatabaseService(
        modelType,
      ) as DatabaseService<BaseModel>;
      new BaseAPI(modelType, partServices[modelType.name]!);
    }

    new BaseAPI(
      OnCallDutyPolicyScheduleCalendarFeed,
      OnCallDutyPolicyScheduleCalendarFeedService as unknown as DatabaseService<BaseModel>,
    );

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

    // Every owner row of a monitor: its people, then its teams.
    const monitorOwnersOf: (
      monitorId: ObjectID,
    ) => Promise<Array<Dictionary<string>>> = async (
      monitorId: ObjectID,
    ): Promise<Array<Dictionary<string>>> => {
      return [
        ...(await ownerRowsOf("MonitorOwnerUser", "monitorId", monitorId)),
        ...(await ownerRowsOf("MonitorOwnerTeam", "monitorId", monitorId)),
      ];
    };

    // An owner row written to its table directly: a person's or a team's.
    const insertOwnerRow: (data: {
      table: string;
      column: string;
      recordId: ObjectID;
      ownerId: ObjectID;
    }) => Promise<ObjectID> = async (data: {
      table: string;
      column: string;
      recordId: ObjectID;
      ownerId: ObjectID;
    }): Promise<ObjectID> => {
      const id: ObjectID = ObjectID.generate();

      await insertAnyRow(data.table, {
        _id: id,
        projectId: projectId,
        [data.column]: data.recordId,
        [data.table.endsWith("OwnerUser") ? "userId" : "teamId"]: data.ownerId,
        version: 1,
      });

      return id;
    };

    // An owner added through its table's own route, as the Owners tab adds one.
    const addOwner: (data: {
      caller: Caller;
      path: string;
      column: string;
      recordId: ObjectID;
      ownerColumn: "userId" | "teamId";
      ownerId: ObjectID;
    }) => Promise<Outcome> = async (data: {
      caller: Caller;
      path: string;
      column: string;
      recordId: ObjectID;
      ownerColumn: "userId" | "teamId";
      ownerId: ObjectID;
    }): Promise<Outcome> => {
      return await send({
        method: "post",
        uri: data.path,
        caller: data.caller,
        body: {
          data: JSONFunctions.serialize({
            [data.column]: data.recordId,
            [data.ownerColumn]: data.ownerId,
            projectId: projectId,
          } as unknown as JSONObject),
        },
      });
    };

    // A record created through its table's own route, as a form creates one.
    const createThrough: (data: {
      caller: Caller;
      path: string;
      row: Dictionary<unknown>;
    }) => Promise<Outcome> = async (data: {
      caller: Caller;
      path: string;
      row: Dictionary<unknown>;
    }): Promise<Outcome> => {
      return await send({
        method: "post",
        uri: data.path,
        caller: data.caller,
        body: {
          data: JSONFunctions.serialize({
            projectId: projectId,
            ...data.row,
          } as unknown as JSONObject),
        },
      });
    };

    // A record changed by its id through its table's own route.
    const updateThrough: (data: {
      caller: Caller;
      path: string;
      id: ObjectID;
      row: Dictionary<unknown>;
    }) => Promise<Outcome> = async (data: {
      caller: Caller;
      path: string;
      id: ObjectID;
      row: Dictionary<unknown>;
    }): Promise<Outcome> => {
      return await send({
        method: "post",
        uri: `${data.path}/:id/update-item`,
        caller: data.caller,
        id: data.id,
        body: {
          data: JSONFunctions.serialize(data.row as unknown as JSONObject),
        },
      });
    };

    // The ids of `ids` a list through the table's own route answers with.
    const listThrough: (data: {
      caller: Caller;
      path: string;
      ids: Array<ObjectID>;
    }) => Promise<Outcome> = async (data: {
      caller: Caller;
      path: string;
      ids: Array<ObjectID>;
    }): Promise<Outcome> => {
      return await send({
        method: "post",
        uri: `${data.path}/get-list`,
        caller: data.caller,
        body: {
          query: JSONFunctions.serialize({
            _id: new Includes(data.ids),
          } as unknown as JSONObject),
          select: { _id: true },
          limit: 50,
        },
      });
    };

    const idsOf: (ids: Array<ObjectID>) => Array<string> = (
      ids: Array<ObjectID>,
    ): Array<string> => {
      return ids
        .map((id: ObjectID): string => {
          return id.toString();
        })
        .sort();
    };

    // One column of a row, as Postgres holds it now; undefined once it is gone.
    const valueOf: (
      table: string,
      column: string,
      id: ObjectID,
    ) => Promise<unknown> = async (
      table: string,
      column: string,
      id: ObjectID,
    ): Promise<unknown> => {
      const rows: Array<Dictionary<unknown>> = await database.query(
        `SELECT "${column}" AS "value" FROM "${schema}"."${table}" WHERE "_id" = $1 AND "deletedAt" IS NULL`,
        [id.toString()],
      );

      return rows[0]?.["value"];
    };

    /*
     * A record the caller may read but not change or delete: refused, in
     * the words every by-id write answers with (getUnwrittenByIdError).
     */
    const expectReadableNotWritten: (
      outcome: Outcome,
      name: string,
      operation: "update" | "delete",
    ) => void = (
      outcome: Outcome,
      name: string,
      operation: "update" | "delete",
    ): void => {
      expect(outcome.isEmptySuccess).toBeUndefined();
      expect(outcome.error).toBeInstanceOf(NotAuthorizedException);
      expect((outcome.error as Error).message).toBe(
        `You do not have permission to ${operation} this ${name.toLowerCase()}.`,
      );
    };

    // A create refused because the record it belongs to is not the member's.
    const expectPartCreateRefused: (
      outcome: Outcome,
      part: { new (): BaseModel },
      kind: { new (): BaseModel },
    ) => void = (
      outcome: Outcome,
      part: { new (): BaseModel },
      kind: { new (): BaseModel },
    ): void => {
      expect(outcome.item).toBeUndefined();
      expect(outcome.error).toBeInstanceOf(CreateScopeException);
      expect((outcome.error as Error).message).toBe(
        `Your access lets you create ${new part().pluralName} only for the ${new kind().pluralName} you or your teams own.`,
      );
    };

    // The first text column of CHANGED_TEXT_COLUMNS `permissions` change.
    const changedTextColumnOf: (
      modelType: { new (): BaseModel },
      permissions: Array<Permission>,
    ) => string | undefined = (
      modelType: { new (): BaseModel },
      permissions: Array<Permission>,
    ): string | undefined => {
      const model: BaseModel = new modelType();

      return CHANGED_TEXT_COLUMNS.find((column: string): boolean => {
        const updaters: Array<Permission> =
          model.getColumnAccessControlFor(column)?.update || [];

        return (
          Boolean(model.getTableColumnMetadata(column)) &&
          permissions.some((permission: Permission): boolean => {
            return updaters.includes(permission);
          })
        );
      });
    };

    // Why an owner is not added: what the Owners tab shows.
    const OWNER_ADD_REFUSAL: (pluralName: string) => string = (
      pluralName: string,
    ): string => {
      return `Your access lets you add owners only to the ${pluralName} you or your teams own.`;
    };

    const expectOwnerAddRefused: (
      outcome: Outcome,
      pluralName: string,
    ) => void = (outcome: Outcome, pluralName: string): void => {
      expect(outcome.item).toBeUndefined();
      expect(outcome.error).toBeInstanceOf(CreateScopeException);
      expect((outcome.error as Error).message).toBe(
        OWNER_ADD_REFUSAL(pluralName),
      );
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
     * able to read a monitor is not being able to delete it - nor to make
     * themselves its owner (OWNER_MANAGING_GRANTS below).
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

    /*
     * AN OWNED-SCOPE GRANT ADDS AND REMOVES OWNERS ONLY ON MONITORS THE
     * MEMBER OWNS.
     *
     * Who owns a monitor is what the Owned scope reads to decide what a
     * member may manage, so an owner row is owned through its monitor: a
     * member whose permission to add and remove owners is scoped to Owned
     * adds and removes them only on the monitors they or their team own,
     * however many more they may read: reading a monitor is not owning it.
     * Every grant shape that reads more than it manages, the owner
     * permissions themselves, Project Member, and a custom role.
     */
    const OWNER_MANAGING_GRANTS: Array<[string, () => Promise<void>]> = [
      ...READ_BEYOND_OWNED_GRANTS.filter(
        ([name]: [string, () => Promise<void>]): boolean => {
          // The one shape above whose grants add no owners at all.
          return !name.startsWith("Delete Monitor scoped to Owned");
        },
      ),
      [
        "the owner permissions scoped to Owned beside Read Monitor and Read Monitor Owners over the whole project",
        async (): Promise<void> => {
          await setGrants([
            {
              permission: Permission.CreateMonitorOwnerUser,
              scope: PermissionScope.Owned,
            },
            {
              permission: Permission.DeleteMonitorOwnerUser,
              scope: PermissionScope.Owned,
            },
            {
              permission: Permission.CreateMonitorOwnerTeam,
              scope: PermissionScope.Owned,
            },
            {
              permission: Permission.DeleteMonitorOwnerTeam,
              scope: PermissionScope.Owned,
            },
            {
              permission: Permission.ReadProjectMonitor,
              scope: PermissionScope.All,
            },
            {
              permission: Permission.ReadMonitorOwnerUser,
              scope: PermissionScope.All,
            },
            {
              permission: Permission.ReadMonitorOwnerTeam,
              scope: PermissionScope.All,
            },
          ]);
        },
      ],
      [
        "Project Member scoped to Owned beside the Viewer role",
        async (): Promise<void> => {
          await setGrants([
            {
              permission: Permission.ProjectMember,
              scope: PermissionScope.Owned,
            },
            { permission: Permission.Viewer, scope: PermissionScope.All },
          ]);
        },
      ],
      [
        /*
         * Every permission on owners scoped to Owned - Monitor Admin's - and
         * the read of every monitor from a permission on monitors alone:
         * owners are read through the monitor, so they read every one.
         */
        "Monitor Admin scoped to Owned beside Read Monitor over the whole project",
        async (): Promise<void> => {
          await setGrants([
            {
              permission: Permission.MonitorAdmin,
              scope: PermissionScope.Owned,
            },
            {
              permission: Permission.ReadProjectMonitor,
              scope: PermissionScope.All,
            },
          ]);
        },
      ],
    ];

    // The monitor owner tables, the route that adds to each, and its names.
    const MONITOR_OWNER_TABLES: Array<{
      table: string;
      path: string;
      ownerColumn: "userId" | "teamId";
      singularName: string;
    }> = [
      {
        table: "MonitorOwnerUser",
        path: "/monitor-owner-user",
        ownerColumn: "userId",
        singularName: new MonitorOwnerUser().singularName!,
      },
      {
        table: "MonitorOwnerTeam",
        path: "/monitor-owner-team",
        ownerColumn: "teamId",
        singularName: new MonitorOwnerTeam().singularName!,
      },
    ];

    const MONITORS: string = new Monitor().pluralName!;

    describe.each(OWNER_MANAGING_GRANTS)(
      "an owned-scope grant adds and removes owners only on monitors the member owns: %s",
      (_grant: string, grant: () => Promise<void>) => {
        beforeAll(async () => {
          await grant();
        });

        test("adds no owner to a monitor they do not own - not themselves, their team or anyone else - and the monitor stays out of their hands", async () => {
          for (const owner of OTHERS) {
            const monitorId: ObjectID = await insertLabelledMonitor(owner);
            const ownersBefore: Array<Dictionary<string>> =
              await monitorOwnersOf(monitorId);

            for (const [who, path, ownerColumn, ownerId] of [
              ["themselves", "/monitor-owner-user", "userId", memberId],
              ["their team", "/monitor-owner-team", "teamId", memberTeamId],
              ["another person", "/monitor-owner-user", "userId", otherUserId],
              ["another team", "/monitor-owner-team", "teamId", otherTeamId],
            ] as Array<[string, string, "userId" | "teamId", ObjectID]>) {
              // One who owns it already is no owner to add.
              if (
                (owner === "otherUser" && ownerId === otherUserId) ||
                (owner === "otherTeam" && ownerId === otherTeamId)
              ) {
                continue;
              }

              const added: Outcome = await addOwner({
                caller: member,
                path: path,
                column: "monitorId",
                recordId: monitorId,
                ownerColumn: ownerColumn,
                ownerId: ownerId,
              });

              expect([owner, who, added.error]).toEqual([
                owner,
                who,
                expect.any(CreateScopeException),
              ]);
              expectOwnerAddRefused(added, MONITORS);
            }

            expect(await monitorOwnersOf(monitorId)).toEqual(ownersBefore);

            // They read it, and that is all: it is still not theirs to delete.
            const outcome: Outcome = await deleteItem(
              "/monitor",
              member,
              monitorId,
            );

            expect([owner, outcome.error]).toEqual([
              owner,
              expect.any(NotAuthorizedException),
            ]);
            expect(await rowExists("Monitor", monitorId)).toBe(true);
          }
        });

        test("removes no owner of a monitor they do not own, by either route or by query", async () => {
          const monitorId: ObjectID = await insertLabelledMonitor("otherUser");

          await insertOwnerRow({
            table: "MonitorOwnerTeam",
            column: "monitorId",
            recordId: monitorId,
            ownerId: otherTeamId,
          });

          const ownersBefore: Array<Dictionary<string>> =
            await monitorOwnersOf(monitorId);

          expect(ownersBefore).toHaveLength(2);

          for (const [route, remove] of REMOVALS) {
            for (const ownerTable of MONITOR_OWNER_TABLES) {
              const [ownerRow] = await ownerRowsOf(
                ownerTable.table,
                "monitorId",
                monitorId,
              );

              const outcome: Outcome = await remove(
                ownerTable.path,
                member,
                new ObjectID(ownerRow!["_id"]!),
              );

              // They may read the owner, but not take it away.
              expect([route, ownerTable.table, outcome.error]).toEqual([
                route,
                ownerTable.table,
                expect.any(NotAuthorizedException),
              ]);
              expect((outcome.error as Error).message).toBe(
                `You do not have permission to delete this ${ownerTable.singularName.toLowerCase()}.`,
              );
            }
          }

          for (const service of [
            MonitorOwnerUserService,
            MonitorOwnerTeamService,
          ] as Array<DatabaseService<BaseModel>>) {
            const removed: number = await service.deleteBy({
              query: { monitorId: monitorId } as never,
              props: await propsOf(member),
              limit: 50,
              skip: 0,
            });

            expect(removed).toBe(0);
          }

          expect(await monitorOwnersOf(monitorId)).toEqual(ownersBefore);
        });

        test("adds and removes the owners of a monitor they or their team own, by either route and by query", async () => {
          for (const owner of ["member", "memberTeam"] as Array<Owner>) {
            const monitorId: ObjectID = await insertLabelledMonitor(owner);

            // Another person and another team, added.
            for (const [ownerTable, ownerId] of [
              [MONITOR_OWNER_TABLES[0]!, otherUserId],
              [MONITOR_OWNER_TABLES[1]!, otherTeamId],
            ] as Array<[(typeof MONITOR_OWNER_TABLES)[number], ObjectID]>) {
              const added: Outcome = await addOwner({
                caller: member,
                path: ownerTable.path,
                column: "monitorId",
                recordId: monitorId,
                ownerColumn: ownerTable.ownerColumn,
                ownerId: ownerId,
              });

              expect([owner, ownerTable.table, added.error]).toEqual([
                owner,
                ownerTable.table,
                undefined,
              ]);
              expect(added.item).toBeTruthy();
            }

            const ownerRowOf: (
              table: string,
              ownerId: ObjectID,
            ) => Promise<Dictionary<string> | undefined> = async (
              table: string,
              ownerId: ObjectID,
            ): Promise<Dictionary<string> | undefined> => {
              return (await ownerRowsOf(table, "monitorId", monitorId)).find(
                (row: Dictionary<string>): boolean => {
                  return row["owner"] === ownerId.toString();
                },
              );
            };

            const personRow: Dictionary<string> | undefined = await ownerRowOf(
              "MonitorOwnerUser",
              otherUserId,
            );
            const teamRow: Dictionary<string> | undefined = await ownerRowOf(
              "MonitorOwnerTeam",
              otherTeamId,
            );

            expect([owner, Boolean(personRow), Boolean(teamRow)]).toEqual([
              owner,
              true,
              true,
            ]);

            // And taken off again: the person by one route, the team by the other.
            expectDeleted(
              await deleteItem(
                "/monitor-owner-user",
                member,
                new ObjectID(personRow!["_id"]!),
              ),
            );
            expectDeleted(
              await deleteById(
                "/monitor-owner-team",
                member,
                new ObjectID(teamRow!["_id"]!),
              ),
            );

            // What is left is the ownership that made it theirs.
            expect(
              (await monitorOwnersOf(monitorId)).map(
                (row: Dictionary<string>): string => {
                  return row["owner"]!;
                },
              ),
            ).toEqual([
              owner === "member"
                ? memberId.toString()
                : memberTeamId.toString(),
            ]);
          }

          // By query: another person is taken off the monitors they own, and only those.
          const ours: ObjectID = await insertLabelledMonitor("memberTeam");
          const theirs: ObjectID = await insertLabelledMonitor("otherTeam");

          for (const monitorId of [ours, theirs]) {
            await insertOwnerRow({
              table: "MonitorOwnerUser",
              column: "monitorId",
              recordId: monitorId,
              ownerId: otherUserId,
            });
          }

          const removed: number = await MonitorOwnerUserService.deleteBy({
            query: {
              monitorId: new Includes([ours, theirs]),
              userId: otherUserId,
            },
            props: await propsOf(member),
            limit: 50,
            skip: 0,
          });

          expect(removed).toBe(1);
          expect(
            await ownerRowsOf("MonitorOwnerUser", "monitorId", ours),
          ).toEqual([]);
          expect(
            (await ownerRowsOf("MonitorOwnerUser", "monitorId", theirs)).map(
              (row: Dictionary<string>): string => {
                return row["owner"]!;
              },
            ),
          ).toEqual([otherUserId.toString()]);
        });

        test("reads the owners of every monitor they may read", async () => {
          const monitorId: ObjectID = await insertLabelledMonitor("otherTeam");

          await insertOwnerRow({
            table: "MonitorOwnerUser",
            column: "monitorId",
            recordId: monitorId,
            ownerId: otherUserId,
          });

          for (const ownerTable of MONITOR_OWNER_TABLES) {
            const listed: Outcome = await send({
              method: "post",
              uri: `${ownerTable.path}/get-list`,
              caller: member,
              body: {
                query: JSONFunctions.serialize({
                  monitorId: monitorId,
                } as unknown as JSONObject),
                select: { _id: true },
                limit: 50,
              },
            });

            expect([ownerTable.table, listed.error]).toEqual([
              ownerTable.table,
              undefined,
            ]);
            expect(listed.ids).toEqual(
              (await ownerRowsOf(ownerTable.table, "monitorId", monitorId)).map(
                (row: Dictionary<string>): string => {
                  return row["_id"]!;
                },
              ),
            );
            expect(listed.ids).toHaveLength(1);
          }
        });
      },
    );

    describe("grants that reach the whole project add and remove the owners of any monitor", () => {
      const CALLERS: Array<[string, () => Promise<Caller>]> = [
        [
          "Monitor Admin over the whole project",
          async (): Promise<Caller> => {
            await setGrants([
              {
                permission: Permission.MonitorAdmin,
                scope: PermissionScope.All,
              },
            ]);

            return member;
          },
        ],
        [
          "Monitor Admin over the whole project beside Monitor Admin scoped to Owned: the broader grant wins",
          async (): Promise<Caller> => {
            await setGrants([
              {
                permission: Permission.MonitorAdmin,
                scope: PermissionScope.Owned,
              },
              {
                permission: Permission.MonitorAdmin,
                scope: PermissionScope.All,
              },
            ]);

            return member;
          },
        ],
        [
          "Project Admin, which no scope narrows - its row scoped to Owned all the same",
          async (): Promise<Caller> => {
            await setGrants([
              {
                permission: Permission.ProjectAdmin,
                scope: PermissionScope.Owned,
              },
            ]);

            return member;
          },
        ],
        [
          "an API key, which holds no scope",
          async (): Promise<Caller> => {
            return {
              kind: "apiKey",
              apiKey: await createApiKey([
                Permission.CreateMonitorOwnerUser,
                Permission.DeleteMonitorOwnerUser,
                Permission.ReadMonitorOwnerUser,
                Permission.CreateMonitorOwnerTeam,
                Permission.DeleteMonitorOwnerTeam,
                Permission.ReadMonitorOwnerTeam,
                Permission.ReadProjectMonitor,
              ]),
            };
          },
        ],
      ];

      test.each(CALLERS)(
        "%s",
        async (_who: string, callerOf: () => Promise<Caller>) => {
          const caller: Caller = await callerOf();

          for (const owner of OTHERS) {
            const monitorId: ObjectID = await insertMonitor(owner);

            // The member and their team, added.
            for (const [ownerTable, ownerId] of [
              [MONITOR_OWNER_TABLES[0]!, memberId],
              [MONITOR_OWNER_TABLES[1]!, memberTeamId],
            ] as Array<[(typeof MONITOR_OWNER_TABLES)[number], ObjectID]>) {
              const added: Outcome = await addOwner({
                caller: caller,
                path: ownerTable.path,
                column: "monitorId",
                recordId: monitorId,
                ownerColumn: ownerTable.ownerColumn,
                ownerId: ownerId,
              });

              expect([owner, ownerTable.table, added.error]).toEqual([
                owner,
                ownerTable.table,
                undefined,
              ]);
            }

            // And every owner taken off it again, by id.
            for (const ownerTable of MONITOR_OWNER_TABLES) {
              for (const ownerRow of await ownerRowsOf(
                ownerTable.table,
                "monitorId",
                monitorId,
              )) {
                expectDeleted(
                  await deleteItem(
                    ownerTable.path,
                    caller,
                    new ObjectID(ownerRow["_id"]!),
                  ),
                );
              }
            }

            expect(await monitorOwnersOf(monitorId)).toEqual([]);
          }
        },
      );

      test("a workflow step, which acts as a Project Admin, adds and removes the owners of any monitor", async () => {
        const props: DatabaseCommonInteractionProps =
          WorkflowPrincipal.getPropsWithoutPlan({
            projectId: projectId,
            workflowId: ObjectID.generate(),
          });

        for (const owner of OTHERS) {
          const monitorId: ObjectID = await insertMonitor(owner);

          const person: MonitorOwnerUser = new MonitorOwnerUser();
          person.projectId = projectId;
          person.monitorId = monitorId;
          person.userId = memberId;

          await MonitorOwnerUserService.create({ data: person, props: props });

          const team: MonitorOwnerTeam = new MonitorOwnerTeam();
          team.projectId = projectId;
          team.monitorId = monitorId;
          team.teamId = memberTeamId;

          await MonitorOwnerTeamService.create({ data: team, props: props });

          expect(
            (await monitorOwnersOf(monitorId)).map(
              (row: Dictionary<string>): string => {
                return row["owner"]!;
              },
            ),
          ).toEqual(
            expect.arrayContaining([
              memberId.toString(),
              memberTeamId.toString(),
            ]),
          );

          await MonitorOwnerUserService.deleteBy({
            query: { monitorId: monitorId },
            props: props,
            limit: 50,
            skip: 0,
          });
          await MonitorOwnerTeamService.deleteBy({
            query: { monitorId: monitorId },
            props: props,
            limit: 50,
            skip: 0,
          });

          expect(await monitorOwnersOf(monitorId)).toEqual([]);
        }
      });
    });

    describe("nobody moves an owner row: an owner is added or removed", () => {
      test.each([
        [
          "the member who owns the monitor, with Monitor Admin scoped to Owned",
          PermissionScope.Owned,
          Permission.MonitorAdmin,
        ],
        [
          "Monitor Admin over the whole project",
          PermissionScope.All,
          Permission.MonitorAdmin,
        ],
        ["Project Admin", PermissionScope.All, Permission.ProjectAdmin],
      ] as Array<[string, PermissionScope, Permission]>)(
        "%s moves no owner row to another monitor or another owner",
        async (
          _who: string,
          scope: PermissionScope,
          permission: Permission,
        ) => {
          await setGrants([{ permission: permission, scope: scope }]);

          const mine: ObjectID = await insertMonitor("member");
          const other: ObjectID = await insertMonitor("member");
          const [ownRow] = await ownerRowsOf(
            "MonitorOwnerUser",
            "monitorId",
            mine,
          );
          const otherOwners: Array<Dictionary<string>> = await ownerRowsOf(
            "MonitorOwnerUser",
            "monitorId",
            other,
          );

          for (const change of [
            { monitorId: other },
            { userId: otherUserId },
            // The same, by the relations.
            { monitor: { _id: other.toString() } },
            { user: { _id: otherUserId.toString() } },
          ] as Array<Dictionary<unknown>>) {
            const moved: Outcome = await send({
              method: "post",
              uri: "/monitor-owner-user/:id/update-item",
              caller: member,
              id: new ObjectID(ownRow!["_id"]!),
              body: {
                data: JSONFunctions.serialize(change as unknown as JSONObject),
              },
            });

            expectRefused(moved);
          }

          expect(
            await ownerRowsOf("MonitorOwnerUser", "monitorId", mine),
          ).toEqual([ownRow]);
          expect(
            await ownerRowsOf("MonitorOwnerUser", "monitorId", other),
          ).toEqual(otherOwners);
        },
      );
    });

    describe("the owners picked when a member creates a monitor", () => {
      const CREATORS: Array<[string, () => Promise<void>]> = [
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

      test.each(CREATORS)(
        "%s: anyone may be picked - themselves, their team, others - asked before the monitor is saved and added once it is theirs",
        async (_creator: string, grant: () => Promise<void>) => {
          await grant();

          const props: DatabaseCommonInteractionProps = await propsOf(member);

          // Before anything is saved: the monitor as it will be.
          const monitor: Monitor = new Monitor();
          monitor.projectId = projectId;
          monitor.name = "A monitor being created";

          await expect(
            OwnerRuleAssignment.checkOwnersPickedOnCreate({
              ownerUserService: MonitorOwnerUserService,
              ownerTeamService: MonitorOwnerTeamService,
              resourceIdColumn: "monitorId",
              resourceModelType: Monitor,
              resource: monitor,
              miscDataProps: {
                ownerUsers: [memberId, otherUserId],
                ownerTeams: [memberTeamId, otherTeamId],
              } as unknown as JSONObject,
              props: props,
            }),
          ).resolves.toBeUndefined();

          /*
           * Saved: its creator is its owner (DatabaseService makes them one
           * as it is saved), and the picks are added for them.
           */
          const monitorId: ObjectID = await insertMonitor("member");

          await MonitorService.addOwners(
            projectId,
            monitorId,
            [memberId, otherUserId],
            [memberTeamId, otherTeamId],
            false,
            props,
            true,
          );

          expect(
            (await monitorOwnersOf(monitorId))
              .map((row: Dictionary<string>): string => {
                return row["owner"]!;
              })
              .sort(),
          ).toEqual(
            [
              memberId.toString(),
              otherUserId.toString(),
              memberTeamId.toString(),
              otherTeamId.toString(),
            ].sort(),
          );
        },
      );

      test.each(CREATORS)(
        "%s: picks for a monitor its creator does not own are refused, not written for them",
        async (_creator: string, grant: () => Promise<void>) => {
          await grant();

          const props: DatabaseCommonInteractionProps = await propsOf(member);
          const monitorId: ObjectID = await insertMonitor("otherTeam");
          const ownersBefore: Array<Dictionary<string>> =
            await monitorOwnersOf(monitorId);

          await expect(
            MonitorService.addOwners(
              projectId,
              monitorId,
              [memberId],
              [memberTeamId],
              false,
              props,
              true,
            ),
          ).rejects.toThrow(OWNER_ADD_REFUSAL(MONITORS));

          expect(await monitorOwnersOf(monitorId)).toEqual(ownersBefore);
        },
      );
    });

    /*
     * HOWEVER THE REQUEST IS SHAPED, an owned-scope grant adds and removes
     * owners only on the monitors the member owns: the monitor named by its
     * relation instead of its ID, by both names, or in capitals; a removal
     * or a change by a query that names no monitor, or names one by its
     * relation; from another project, across projects or without a session.
     * And a monitor created through its own route takes the owners picked
     * in its form, as the creator's own.
     */
    describe("however the request is shaped, an owned-scope grant adds and removes owners only on monitors the member owns", () => {
      beforeAll(async () => {
        // The status a monitor created through its route starts in.
        await insertAnyRow("MonitorStatus", {
          _id: ObjectID.generate(),
          projectId: projectId,
          name: "Operational",
          isOperationalState: true,
          isOfflineState: false,
          priority: 1,
          version: 1,
        });

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
      });

      // An owner added through its table's own route, with `data` as sent.
      const addOwnerAs: (
        path: string,
        data: JSONObject,
        caller?: Caller,
      ) => Promise<Outcome> = async (
        path: string,
        data: JSONObject,
        caller?: Caller,
      ): Promise<Outcome> => {
        return await send({
          method: "post",
          uri: path,
          caller: caller || member,
          body: { data: JSONFunctions.serialize(data) },
        });
      };

      // The ways a request can name the monitor an owner is added to.
      const SHAPES: Array<
        [
          string,
          (monitorId: ObjectID) => {
            path: string;
            data: JSONObject;
            owner: ObjectID;
          },
        ]
      > = [
        [
          "the monitor by its relation, themselves by their ID",
          (monitorId: ObjectID) => {
            return {
              path: "/monitor-owner-user",
              data: {
                monitor: { _id: monitorId.toString() },
                userId: memberId,
                projectId: projectId,
              } as unknown as JSONObject,
              owner: memberId,
            };
          },
        ],
        [
          "the monitor and themselves by their relations",
          (monitorId: ObjectID) => {
            return {
              path: "/monitor-owner-user",
              data: {
                monitor: { _id: monitorId.toString() },
                user: { _id: memberId.toString() },
                projectId: projectId,
              } as unknown as JSONObject,
              owner: memberId,
            };
          },
        ],
        [
          "the monitor by both of its names",
          (monitorId: ObjectID) => {
            return {
              path: "/monitor-owner-user",
              data: {
                monitorId: monitorId,
                monitor: { _id: monitorId.toString() },
                userId: memberId,
                projectId: projectId,
              } as unknown as JSONObject,
              owner: memberId,
            };
          },
        ],
        [
          "the monitor's ID in capitals",
          (monitorId: ObjectID) => {
            return {
              path: "/monitor-owner-user",
              data: {
                monitorId: monitorId.toString().toUpperCase(),
                userId: memberId,
                projectId: projectId,
              } as unknown as JSONObject,
              owner: memberId,
            };
          },
        ],
        [
          "their team, the monitor and the team by their relations",
          (monitorId: ObjectID) => {
            return {
              path: "/monitor-owner-team",
              data: {
                monitor: { _id: monitorId.toString() },
                team: { _id: memberTeamId.toString() },
                projectId: projectId,
              } as unknown as JSONObject,
              owner: memberTeamId,
            };
          },
        ],
      ];

      test.each(SHAPES)(
        "%s: added to a monitor they own, refused on one they do not",
        async (
          _shape: string,
          shapeOf: (monitorId: ObjectID) => {
            path: string;
            data: JSONObject;
            owner: ObjectID;
          },
        ) => {
          // Another person's: refused, its owners as they were.
          const theirs: ObjectID = await insertLabelledMonitor("otherUser");
          const ownersBefore: Array<Dictionary<string>> =
            await monitorOwnersOf(theirs);
          const refused: { path: string; data: JSONObject } = shapeOf(theirs);

          expectOwnerAddRefused(
            await addOwnerAs(refused.path, refused.data),
            MONITORS,
          );
          expect(await monitorOwnersOf(theirs)).toEqual(ownersBefore);

          // Still not theirs to delete.
          expect(
            (await deleteItem("/monitor", member, theirs)).error,
          ).toBeInstanceOf(NotAuthorizedException);
          expect(await rowExists("Monitor", theirs)).toBe(true);

          /*
           * On a monitor of their own - their team's when they add
           * themselves, theirs when they add their team - the same request
           * adds the owner.
           */
          const ours: ObjectID = await insertLabelledMonitor(
            refused.path === "/monitor-owner-team" ? "member" : "memberTeam",
          );
          const added: { path: string; data: JSONObject; owner: ObjectID } =
            shapeOf(ours);
          const outcome: Outcome = await addOwnerAs(added.path, added.data);

          expect(outcome.error).toBeUndefined();
          expect(
            (await monitorOwnersOf(ours)).map(
              (row: Dictionary<string>): string => {
                return row["owner"]!;
              },
            ),
          ).toContain(added.owner.toString());
        },
      );

      test("a monitor they own by one name and one they do not by the other is refused, and neither gains an owner", async () => {
        const mine: ObjectID = await insertLabelledMonitor("member");
        const theirs: ObjectID = await insertLabelledMonitor("otherTeam");
        const mineBefore: Array<Dictionary<string>> =
          await monitorOwnersOf(mine);
        const theirsBefore: Array<Dictionary<string>> =
          await monitorOwnersOf(theirs);

        for (const [byId, byRelation] of [
          [mine, theirs],
          [theirs, mine],
        ] as Array<[ObjectID, ObjectID]>) {
          expectRefused(
            await addOwnerAs("/monitor-owner-team", {
              monitorId: byId,
              monitor: { _id: byRelation.toString() },
              teamId: memberTeamId,
              projectId: projectId,
            } as unknown as JSONObject),
          );
        }

        expect(await monitorOwnersOf(mine)).toEqual(mineBefore);
        expect(await monitorOwnersOf(theirs)).toEqual(theirsBefore);
      });

      test("a removal by a query that names no monitor, or names one by its relation, takes owners off only the monitors they own", async () => {
        const mine: ObjectID = await insertLabelledMonitor("member");
        const ours: ObjectID = await insertLabelledMonitor("memberTeam");
        const theirs: ObjectID = await insertLabelledMonitor("otherTeam");
        const nobodys: ObjectID = await insertLabelledMonitor("nobody");

        // A person who is no owner anywhere else, on all four.
        const departingId: ObjectID = ObjectID.generate();

        await insert("User", {
          _id: departingId,
          name: "Synthetic User",
          email: `${departingId.toString()}@example.com`,
          slug: departingId.toString(),
          version: 1,
        });

        for (const monitorId of [mine, ours, theirs, nobodys]) {
          await insertOwnerRow({
            table: "MonitorOwnerUser",
            column: "monitorId",
            recordId: monitorId,
            ownerId: departingId,
          });
        }

        const ownersOf: (
          monitorId: ObjectID,
        ) => Promise<Array<string>> = async (
          monitorId: ObjectID,
        ): Promise<Array<string>> => {
          return (
            await ownerRowsOf("MonitorOwnerUser", "monitorId", monitorId)
          ).map((row: Dictionary<string>): string => {
            return row["owner"]!;
          });
        };

        // By the monitor's relation: on theirs, nothing goes.
        expect(
          await MonitorOwnerUserService.deleteBy({
            query: {
              monitor: { _id: theirs.toString() },
              userId: departingId,
            } as never,
            props: await propsOf(member),
            limit: 50,
            skip: 0,
          }),
        ).toBe(0);
        expect(await ownersOf(theirs)).toContain(departingId.toString());

        // Naming no monitor: only the rows on the monitors they own go.
        expect(
          await MonitorOwnerUserService.deleteBy({
            query: { userId: departingId },
            props: await propsOf(member),
            limit: 50,
            skip: 0,
          }),
        ).toBe(2);

        expect(await ownersOf(mine)).toEqual([memberId.toString()]);
        expect(await ownersOf(ours)).toEqual([]);
        expect(await ownersOf(theirs)).toEqual([departingId.toString()]);
        expect(await ownersOf(nobodys)).toEqual([departingId.toString()]);
      });

      test("a change by query moves no owner row onto, or off, a monitor", async () => {
        const mine: ObjectID = await insertLabelledMonitor("member");
        const theirs: ObjectID = await insertLabelledMonitor("otherUser");
        const mineBefore: Array<Dictionary<string>> =
          await monitorOwnersOf(mine);
        const theirsBefore: Array<Dictionary<string>> =
          await monitorOwnersOf(theirs);

        for (const [query, data] of [
          // Theirs onto the member, by ID and by relation.
          [{ monitorId: theirs }, { userId: memberId }],
          [{ monitorId: theirs }, { user: { _id: memberId.toString() } }],
          // Theirs onto a monitor of their own, by ID and by relation.
          [{ monitorId: theirs }, { monitorId: mine }],
          [{ monitorId: theirs }, { monitor: { _id: mine.toString() } }],
          // Their own onto theirs, by ID and by relation.
          [{ monitorId: mine }, { monitorId: theirs }],
          [{ monitorId: mine }, { monitor: { _id: theirs.toString() } }],
          // Every row they may reach, onto theirs.
          [{}, { monitorId: theirs }],
        ] as Array<[JSONObject, JSONObject]>) {
          let changed: number = 0;

          try {
            changed = await MonitorOwnerUserService.updateBy({
              query: query as never,
              data: data as never,
              props: await propsOf(member),
              limit: 50,
              skip: 0,
            });
          } catch (error) {
            expect(error).toBeInstanceOf(Exception);
          }

          // Refused, or nothing it may change: either way, nothing moved.
          expect([query, data, changed]).toEqual([query, data, 0]);
          expect(await monitorOwnersOf(mine)).toEqual(mineBefore);
          expect(await monitorOwnersOf(theirs)).toEqual(theirsBefore);
        }
      });

      test("from another project, across projects or without a session, no owner is added or removed", async () => {
        const theirs: ObjectID = await insertLabelledMonitor("otherTeam");
        const ownersBefore: Array<Dictionary<string>> =
          await monitorOwnersOf(theirs);
        const [ownerRow] = await ownerRowsOf(
          "MonitorOwnerTeam",
          "monitorId",
          theirs,
        );

        const outsiderHere: Caller = {
          kind: "member",
          userId: outsiderId,
          tenantId: projectId,
        };
        // The outsider in their own project, where they may manage every monitor.
        const outsiderAtHome: Caller = {
          kind: "member",
          userId: outsiderId,
          tenantId: otherProjectId,
        };

        for (const caller of [
          outsiderHere,
          outsiderAtHome,
          { kind: "anonymous", tenantId: projectId } as Caller,
          { kind: "member", userId: memberId, isMultiTenant: true } as Caller,
        ]) {
          expectRefused(
            await addOwnerAs(
              "/monitor-owner-team",
              {
                monitorId: theirs,
                teamId:
                  caller.kind === "member" && caller.userId === outsiderId
                    ? outsiderTeamId
                    : memberTeamId,
                projectId: projectId,
              } as unknown as JSONObject,
              caller,
            ),
          );

          for (const [, remove] of REMOVALS) {
            expectRefused(
              await remove(
                "/monitor-owner-team",
                caller,
                new ObjectID(ownerRow!["_id"]!),
              ),
            );
          }
        }

        expect(await monitorOwnersOf(theirs)).toEqual(ownersBefore);
      });

      test("a monitor created through its own route takes the owners picked in its form, as its creator's own", async () => {
        const created: Outcome = await send({
          method: "post",
          uri: "/monitor",
          caller: member,
          body: {
            data: JSONFunctions.serialize({
              name: "A monitor created with owners picked",
              monitorType: "Manual",
              projectId: projectId,
            } as unknown as JSONObject),
            miscDataProps: JSONFunctions.serialize({
              ownerUsers: [otherUserId.toString()],
              ownerTeams: [memberTeamId.toString(), otherTeamId.toString()],
            } as unknown as JSONObject),
          },
        });

        expect(created.error).toBeUndefined();

        const monitorId: ObjectID = created.item!.id!;
        const expected: Array<string> = [
          memberId.toString(),
          otherUserId.toString(),
          memberTeamId.toString(),
          otherTeamId.toString(),
        ].sort();

        // The picks are added once the monitor is saved, after its first status.
        let owners: Array<string> = [];

        for (let attempt: number = 0; attempt < 100; attempt++) {
          owners = (await monitorOwnersOf(monitorId))
            .map((row: Dictionary<string>): string => {
              return row["owner"]!;
            })
            .sort();

          if (owners.length >= expected.length) {
            break;
          }

          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 100);
          });
        }

        expect(owners).toEqual(expected);

        // Theirs, then: they delete it.
        expectDeleted(await deleteItem("/monitor", member, monitorId));
        expect(await rowExists("Monitor", monitorId)).toBe(false);
      });
    });

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

      // Whether every reader of the kind reads all of it: one other records are set up with.
      const isReadInFull: boolean = isReadByEveryReader(kind.name);

      test("by id: the records the member or their team own go; the others stay - answered as missing, or refused as ones they may read when every reader reads the kind", async () => {
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
          } else if (isReadInFull) {
            expectReadableNotWritten(outcome, singularName, "delete");
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

      test("lists only the records the member or their team own - or every one, of a kind other records are set up with", async () => {
        const owned: Array<ObjectID> = [
          await insertRecord("member"),
          await insertRecord("memberTeam"),
        ];
        const others: Array<ObjectID> = [];

        for (const owner of OTHERS) {
          others.push(await insertRecord(owner));
        }

        const listed: Outcome = await listThrough({
          caller: member,
          path: path,
          ids: [...owned, ...others],
        });

        expect(listed.error).toBeUndefined();
        expect(listed.ids).toEqual(
          idsOf(isReadInFull ? [...owned, ...others] : owned),
        );
      });

      test("changes only the records the member or their team own, by id and by query", async () => {
        const model: BaseModel = new kind.modelType();
        const permissions: Array<Permission> = Array.from(
          new Set<Permission>([
            ...model.updateRecordPermissions,
            ...model.readRecordPermissions,
          ]),
        ).filter((permission: Permission): boolean => {
          return OWN_READ_OR_EDIT_PERMISSION.test(permission);
        });
        const column: string | undefined = changedTextColumnOf(
          kind.modelType,
          permissions,
        );

        expect([kind.name, typeof column]).toEqual([kind.name, "string"]);

        await setGrants(
          permissions.map((permission: Permission): PermissionRow => {
            return { permission: permission, scope: PermissionScope.Owned };
          }),
        );

        try {
          // By id, through the route.
          for (const owner of [
            "member",
            "memberTeam",
            ...OTHERS,
          ] as Array<Owner>) {
            const id: ObjectID = await insertRecord(owner);
            const before: unknown = await valueOf(tableOf(), column!, id);
            const isOwned: boolean =
              owner === "member" || owner === "memberTeam";

            const outcome: Outcome = await updateThrough({
              caller: member,
              path: path,
              id: id,
              row: { [column!]: `Changed ${id.toString()}` },
            });

            if (isOwned) {
              expect([owner, outcome.error]).toEqual([owner, undefined]);
            } else if (isReadInFull) {
              expectReadableNotWritten(outcome, singularName, "update");
            } else {
              expectMissing(outcome, singularName);
            }

            expect([owner, await valueOf(tableOf(), column!, id)]).toEqual([
              owner,
              isOwned ? `Changed ${id.toString()}` : before,
            ]);
          }

          // By query, as the member: only the owned ones change.
          const owned: Array<ObjectID> = [
            await insertRecord("member"),
            await insertRecord("memberTeam"),
          ];
          const others: Array<ObjectID> = [];

          for (const owner of OTHERS) {
            others.push(await insertRecord(owner));
          }

          const changed: number = await sweptServices[kind.name]!.updateBy({
            query: { _id: new Includes([...owned, ...others]) },
            data: { [column!]: "Changed by query" } as never,
            props: await propsOf(member),
            limit: 50,
            skip: 0,
          });

          expect(changed).toBe(2);

          for (const id of owned) {
            expect(await valueOf(tableOf(), column!, id)).toBe(
              "Changed by query",
            );
          }

          for (const id of others) {
            expect(await valueOf(tableOf(), column!, id)).not.toBe(
              "Changed by query",
            );
          }
        } finally {
          // The sweep's read and delete grants, back for what follows.
          await setGrants(
            Array.from(
              new Set<Permission>([
                ...model.deleteRecordPermissions,
                ...model.readRecordPermissions,
              ]),
            )
              .filter((permission: Permission): boolean => {
                return OWN_READ_OR_DELETE_PERMISSION.test(permission);
              })
              .map((permission: Permission): PermissionRow => {
                return {
                  permission: permission,
                  scope: PermissionScope.Owned,
                };
              }),
          );
        }
      });

      /*
       * Its owners, by a member who reads every record of the kind and whose
       * permissions to add, read and remove its owners are scoped to Owned:
       * an owner row is owned through its record.
       */
      describe("its owners", () => {
        interface KindOwnerTable {
          name: string;
          tableName: string;
          path: string;
          ownerColumn: "userId" | "teamId";
          singularName: string;
          service: DatabaseService<BaseModel>;
        }

        const ownerTables: () => Array<KindOwnerTable> =
          (): Array<KindOwnerTable> => {
            return (
              [
                kind.pair.ownerUserService,
                kind.pair.ownerTeamService,
              ] as Array<{ modelType: { new (): BaseModel } }>
            ).map((ownerService: { modelType: { new (): BaseModel } }) => {
              const ownerModel: BaseModel = new ownerService.modelType();

              return {
                name: ownerService.modelType.name,
                tableName: database.getMetadata(ownerService.modelType)
                  .tableName,
                path: ownerModel.getCrudApiPath()!.toString(),
                ownerColumn: ownerService.modelType.name.endsWith("OwnerUser")
                  ? "userId"
                  : "teamId",
                singularName: ownerModel.singularName || "Owner",
                service: sweptOwnerServices[ownerService.modelType.name]!,
              };
            });
          };

        const pluralName: string = new kind.modelType().pluralName || "Records";

        beforeAll(async () => {
          // The kind's own read over the whole project.
          const reads: Array<Permission> =
            new kind.modelType().readRecordPermissions.filter(
              (permission: Permission): boolean => {
                return OWN_READ_PERMISSION.test(permission);
              },
            );

          // Its owner tables' own create, read and delete permissions.
          const ownerPermissions: Array<Permission> = Array.from(
            new Set<Permission>(
              (
                [
                  kind.pair.ownerUserService,
                  kind.pair.ownerTeamService,
                ] as Array<{ modelType: { new (): BaseModel } }>
              ).flatMap(
                (ownerService: {
                  modelType: { new (): BaseModel };
                }): Array<Permission> => {
                  const ownerModel: BaseModel = new ownerService.modelType();

                  return [
                    ...ownerModel.createRecordPermissions,
                    ...ownerModel.readRecordPermissions,
                    ...ownerModel.deleteRecordPermissions,
                  ];
                },
              ),
            ),
          ).filter((permission: Permission): boolean => {
            return OWN_OWNER_PERMISSION.test(permission);
          });

          expect(reads.length).toBeGreaterThan(0);
          // Add, read and remove, for people and for teams.
          expect(ownerPermissions).toHaveLength(6);

          await setGrants([
            ...reads.map((permission: Permission): PermissionRow => {
              return { permission: permission, scope: PermissionScope.All };
            }),
            ...ownerPermissions.map((permission: Permission): PermissionRow => {
              return { permission: permission, scope: PermissionScope.Owned };
            }),
          ]);
        });

        test("adds an owner only to a record they or their team own", async () => {
          for (const owner of [
            "member",
            "memberTeam",
            ...OTHERS,
          ] as Array<Owner>) {
            const recordId: ObjectID = await insertRecord(owner);
            const isOwned: boolean =
              owner === "member" || owner === "memberTeam";

            for (const ownerTable of ownerTables()) {
              // Someone who does not own it yet: themselves or their team on another's.
              const ownerId: ObjectID =
                ownerTable.ownerColumn === "userId"
                  ? isOwned
                    ? otherUserId
                    : memberId
                  : isOwned
                    ? otherTeamId
                    : memberTeamId;

              const added: Outcome = await addOwner({
                caller: member,
                path: ownerTable.path,
                column: kind.pair.fkColumn,
                recordId: recordId,
                ownerColumn: ownerTable.ownerColumn,
                ownerId: ownerId,
              });

              if (isOwned) {
                expect([owner, ownerTable.name, added.error]).toEqual([
                  owner,
                  ownerTable.name,
                  undefined,
                ]);
              } else {
                expect([owner, ownerTable.name, added.error]).toEqual([
                  owner,
                  ownerTable.name,
                  expect.any(CreateScopeException),
                ]);
                expectOwnerAddRefused(added, pluralName);
              }

              expect([
                owner,
                ownerTable.name,
                (
                  await ownerRowsOf(
                    ownerTable.tableName,
                    kind.pair.fkColumn,
                    recordId,
                  )
                ).some((row: Dictionary<string>): boolean => {
                  return row["owner"] === ownerId.toString();
                }),
              ]).toEqual([owner, ownerTable.name, isOwned]);
            }
          }
        });

        test("removes owners only of a record they or their team own, by id and by query", async () => {
          const ours: ObjectID = await insertRecord("memberTeam");
          const theirs: ObjectID = await insertRecord("otherTeam");

          // Another person owns both; another team owns ours as well.
          for (const recordId of [ours, theirs]) {
            await insertOwnerRow({
              table: ownerTables()[0]!.tableName,
              column: kind.pair.fkColumn,
              recordId: recordId,
              ownerId: otherUserId,
            });
          }

          await insertOwnerRow({
            table: ownerTables()[1]!.tableName,
            column: kind.pair.fkColumn,
            recordId: ours,
            ownerId: otherTeamId,
          });

          const theirOwners: Array<Dictionary<string>> = [];

          for (const ownerTable of ownerTables()) {
            theirOwners.push(
              ...(await ownerRowsOf(
                ownerTable.tableName,
                kind.pair.fkColumn,
                theirs,
              )),
            );
          }

          // By id, either route: the owners of theirs stay.
          for (const [route, remove] of REMOVALS) {
            for (const ownerTable of ownerTables()) {
              const [ownerRow] = await ownerRowsOf(
                ownerTable.tableName,
                kind.pair.fkColumn,
                theirs,
              );

              const outcome: Outcome = await remove(
                ownerTable.path,
                member,
                new ObjectID(ownerRow!["_id"]!),
              );

              expect([route, ownerTable.name, outcome.error]).toEqual([
                route,
                ownerTable.name,
                expect.any(NotAuthorizedException),
              ]);
              expect((outcome.error as Error).message).toBe(
                `You do not have permission to delete this ${ownerTable.singularName.toLowerCase()}.`,
              );
            }
          }

          // By query: the other person and team leave ours, and only ours.
          for (const ownerTable of ownerTables()) {
            const removed: number = await ownerTable.service.deleteBy({
              query: {
                [kind.pair.fkColumn]: new Includes([ours, theirs]),
                [ownerTable.ownerColumn]:
                  ownerTable.ownerColumn === "userId"
                    ? otherUserId
                    : otherTeamId,
              } as never,
              props: await propsOf(member),
              limit: 50,
              skip: 0,
            });

            expect([ownerTable.name, removed]).toEqual([ownerTable.name, 1]);
          }

          const ourOwners: Array<Dictionary<string>> = [];
          const theirOwnersAfter: Array<Dictionary<string>> = [];

          for (const ownerTable of ownerTables()) {
            ourOwners.push(
              ...(await ownerRowsOf(
                ownerTable.tableName,
                kind.pair.fkColumn,
                ours,
              )),
            );
            theirOwnersAfter.push(
              ...(await ownerRowsOf(
                ownerTable.tableName,
                kind.pair.fkColumn,
                theirs,
              )),
            );
          }

          // Ours keeps the team that makes it theirs; theirs keeps every owner.
          expect(
            ourOwners.map((row: Dictionary<string>): string => {
              return row["owner"]!;
            }),
          ).toEqual([memberTeamId.toString()]);
          expect(theirOwnersAfter).toEqual(theirOwners);

          // And by id, on ours: an owner added back is taken off again.
          const personRowId: ObjectID = await insertOwnerRow({
            table: ownerTables()[0]!.tableName,
            column: kind.pair.fkColumn,
            recordId: ours,
            ownerId: otherUserId,
          });

          expectDeleted(
            await deleteItem(ownerTables()[0]!.path, member, personRowId),
          );
        });
      });
    });

    /*
     * THE PICKERS. A kind other records are set up with stays readable to
     * everyone who may pick one, whatever the scope of their grant: a
     * monitor's probes, an escalation rule's schedules, the templates an
     * incident or an event is declared from, the runners, the AI agents.
     * Changing and deleting one keeps to its owners. A monitor group is not
     * one of them: a status page picks the groups a member owns, as it picks
     * the monitors they own.
     */
    describe("the records other records are set up with, picked by a member whose grants are scoped to Owned", () => {
      // A record of a swept kind, owned by `owner`.
      const insertKind: (
        name: string,
        owner: Owner,
      ) => Promise<ObjectID> = async (
        name: string,
        owner: Owner,
      ): Promise<ObjectID> => {
        const kind: OwningKind = SWEPT_KINDS.find(
          (each: OwningKind): boolean => {
            return each.name === name;
          },
        )!;

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

      const pathOf: (modelType: { new (): BaseModel }) => string = (modelType: {
        new (): BaseModel;
      }): string => {
        return new modelType().getCrudApiPath()!.toString();
      };

      // Every kind of the pickers below is one the registry lets readers read in full.
      test("the kinds picked here are the ones other records are set up with", () => {
        for (const name of [
          "Probe",
          "OnCallDutyPolicySchedule",
          "IncidentTemplate",
          "ScheduledMaintenanceTemplate",
          "Runner",
          "AIAgent",
        ]) {
          expect([name, isReadByEveryReader(name)]).toEqual([name, true]);
          expect([
            name,
            Boolean(OwnerTableRegistry.get(name)?.ownedScopeLeavesReads),
          ]).toEqual([name, true]);
        }

        expect(isReadByEveryReader("MonitorGroup")).toBe(false);
      });

      test("Monitor Admin scoped to Owned: the probe picker lists the project's probes, and their own monitor runs on another team's probe", async () => {
        /*
         * A monitor's Probes page adds a probe with Create Monitor Probe
         * (Project Owners and Admins hold it): here in a custom role beside
         * Monitor Admin, both scoped to Owned.
         */
        await setGrants([
          { permission: Permission.MonitorAdmin, scope: PermissionScope.Owned },
          {
            permission: Permission.CreateMonitorProbe,
            scope: PermissionScope.Owned,
          },
        ]);

        const probes: Array<ObjectID> = [
          await insertKind("Probe", "member"),
          await insertKind("Probe", "otherTeam"),
          await insertKind("Probe", "nobody"),
        ];

        const listed: Outcome = await listThrough({
          caller: member,
          path: "/probe",
          ids: probes,
        });

        expect(listed.error).toBeUndefined();
        expect(listed.ids).toEqual(idsOf(probes));

        // Their monitor, on another team's probe and on nobody's.
        const monitorId: ObjectID = await insertMonitor("member");

        for (const probeId of probes.slice(1)) {
          const created: Outcome = await createThrough({
            caller: member,
            path: pathOf(MonitorProbe),
            row: { monitorId: monitorId, probeId: probeId },
          });

          expect([probeId.toString(), created.error]).toEqual([
            probeId.toString(),
            undefined,
          ]);

          const rows: Array<unknown> = await database.query(
            `SELECT "_id" FROM "${schema}"."MonitorProbe" WHERE "monitorId" = $1 AND "probeId" = $2`,
            [monitorId.toString(), probeId.toString()],
          );

          expect(rows).toHaveLength(1);
        }

        // Another team's monitor runs on no probe of theirs.
        const theirMonitor: ObjectID = await insertMonitor("otherTeam");

        expectRefused(
          await createThrough({
            caller: member,
            path: pathOf(MonitorProbe),
            row: { monitorId: theirMonitor, probeId: probes[0]! },
          }),
        );
      });

      test("Project Member scoped to Owned: every probe and AI agent listed, only their own changed or deleted", async () => {
        await setGrants([
          {
            permission: Permission.ProjectMember,
            scope: PermissionScope.Owned,
          },
        ]);

        for (const [name, path] of [
          ["Probe", "/probe"],
          ["AIAgent", "/ai-agent"],
        ] as Array<[string, string]>) {
          const mine: ObjectID = await insertKind(name, "member");
          const theirs: ObjectID = await insertKind(name, "otherTeam");
          const table: string = name;
          const singular: string =
            new (SWEPT_KINDS.find((each: OwningKind): boolean => {
              return each.name === name;
            })!.modelType)().singularName || name;

          const listed: Outcome = await listThrough({
            caller: member,
            path: path,
            ids: [mine, theirs],
          });

          expect([name, listed.ids]).toEqual([name, idsOf([mine, theirs])]);

          expectReadableNotWritten(
            await updateThrough({
              caller: member,
              path: path,
              id: theirs,
              row: { name: `Renamed ${theirs.toString()}` },
            }),
            singular,
            "update",
          );
          expectReadableNotWritten(
            await deleteItem(path, member, theirs),
            singular,
            "delete",
          );
          expect([name, await rowExists(table, theirs)]).toEqual([name, true]);

          expect(
            (
              await updateThrough({
                caller: member,
                path: path,
                id: mine,
                row: { name: `Renamed ${mine.toString()}` },
              })
            ).error,
          ).toBeUndefined();
          expect(await valueOf(table, "name", mine)).toBe(
            `Renamed ${mine.toString()}`,
          );
          expectDeleted(await deleteItem(path, member, mine));
        }
      });

      test("On-Call Member scoped to Owned: every schedule listed, another team's paged from their own policy's escalation rule, and theirs left as it is", async () => {
        await setGrants([
          {
            permission: Permission.OnCallMember,
            scope: PermissionScope.Owned,
          },
        ]);

        const theirs: ObjectID = await insertKind(
          "OnCallDutyPolicySchedule",
          "otherTeam",
        );
        const nobodys: ObjectID = await insertKind(
          "OnCallDutyPolicySchedule",
          "nobody",
        );

        expect(
          (
            await listThrough({
              caller: member,
              path: "/on-call-duty-policy-schedule",
              ids: [theirs, nobodys],
            })
          ).ids,
        ).toEqual(idsOf([theirs, nobodys]));

        // Their own policy, and its first escalation rule.
        const policyId: ObjectID = await insertKind(
          "OnCallDutyPolicy",
          "memberTeam",
        );
        const ruleId: ObjectID = ObjectID.generate();

        await insertAnyRow("OnCallDutyPolicyEscalationRule", {
          _id: ruleId,
          projectId: projectId,
          onCallDutyPolicyId: policyId,
          order: 1,
          version: 1,
        });

        const paged: Outcome = await createThrough({
          caller: member,
          path: pathOf(OnCallDutyPolicyEscalationRuleSchedule),
          row: {
            onCallDutyPolicyId: policyId,
            onCallDutyPolicyEscalationRuleId: ruleId,
            onCallDutyPolicyScheduleId: theirs,
          },
        });

        expect(paged.error).toBeUndefined();

        const rows: Array<unknown> = await database.query(
          `SELECT "_id" FROM "${schema}"."OnCallDutyPolicyEscalationRuleSchedule" WHERE "onCallDutyPolicyEscalationRuleId" = $1 AND "onCallDutyPolicyScheduleId" = $2`,
          [ruleId.toString(), theirs.toString()],
        );

        expect(rows).toHaveLength(1);

        // The schedule itself stays theirs: not renamed, not deleted, no owner added.
        const before: unknown = await valueOf(
          "OnCallDutyPolicySchedule",
          "name",
          theirs,
        );

        expectReadableNotWritten(
          await updateThrough({
            caller: member,
            path: "/on-call-duty-policy-schedule",
            id: theirs,
            row: { name: "Ours now" },
          }),
          new OnCallDutyPolicySchedule().singularName!,
          "update",
        );
        expect(
          await valueOf("OnCallDutyPolicySchedule", "name", theirs),
        ).toEqual(before);

        expectReadableNotWritten(
          await deleteItem("/on-call-duty-policy-schedule", member, theirs),
          new OnCallDutyPolicySchedule().singularName!,
          "delete",
        );
        expect(await rowExists("OnCallDutyPolicySchedule", theirs)).toBe(true);

        expectOwnerAddRefused(
          await addOwner({
            caller: member,
            path: "/on-call-duty-policy-schedule-owner-team",
            column: "onCallDutyPolicyScheduleId",
            recordId: theirs,
            ownerColumn: "teamId",
            ownerId: memberTeamId,
          }),
          new OnCallDutyPolicySchedule().pluralName!,
        );
      });

      test.each([
        {
          role: "Incident Member",
          permission: Permission.IncidentMember,
          name: "IncidentTemplate",
        },
        {
          role: "Scheduled Maintenance Member",
          permission: Permission.ScheduledMaintenanceMember,
          name: "ScheduledMaintenanceTemplate",
        },
        {
          role: "Runbook Admin",
          permission: Permission.RunbookAdmin,
          name: "Runner",
        },
      ] as Array<{ role: string; permission: Permission; name: string }>)(
        "$role scoped to Owned: every $name listed to pick from, only their own changed or deleted",
        async ({
          permission,
          name,
        }: {
          role: string;
          permission: Permission;
          name: string;
        }) => {
          await setGrants([
            { permission: permission, scope: PermissionScope.Owned },
          ]);

          const kind: OwningKind = SWEPT_KINDS.find(
            (each: OwningKind): boolean => {
              return each.name === name;
            },
          )!;
          const path: string = pathOf(kind.modelType);
          const singular: string = new kind.modelType().singularName!;
          const column: string = changedTextColumnOf(kind.modelType, [
            permission,
          ])!;

          expect(column).toBeDefined();

          const mine: ObjectID = await insertKind(name, "member");
          const ours: ObjectID = await insertKind(name, "memberTeam");
          const theirs: ObjectID = await insertKind(name, "otherTeam");
          const nobodys: ObjectID = await insertKind(name, "nobody");

          expect(
            (
              await listThrough({
                caller: member,
                path: path,
                ids: [mine, ours, theirs, nobodys],
              })
            ).ids,
          ).toEqual(idsOf([mine, ours, theirs, nobodys]));

          for (const id of [theirs, nobodys]) {
            expectReadableNotWritten(
              await updateThrough({
                caller: member,
                path: path,
                id: id,
                row: { [column]: "Changed" },
              }),
              singular,
              "update",
            );
            expectReadableNotWritten(
              await deleteItem(path, member, id),
              singular,
              "delete",
            );
            expect(await rowExists(name, id)).toBe(true);
          }

          for (const id of [mine, ours]) {
            expect(
              (
                await updateThrough({
                  caller: member,
                  path: path,
                  id: id,
                  row: { [column]: "Changed" },
                })
              ).error,
            ).toBeUndefined();
            expect(await valueOf(name, column, id)).toBe("Changed");
          }

          expectDeleted(await deleteItem(path, member, ours));
        },
      );

      test("Monitor Admin scoped to Owned: a status page's monitor group picker lists only their groups, as its monitor picker lists only their monitors", async () => {
        await setGrants([
          { permission: Permission.MonitorAdmin, scope: PermissionScope.Owned },
        ]);

        const groups: Array<ObjectID> = [
          await insertKind("MonitorGroup", "member"),
          await insertKind("MonitorGroup", "memberTeam"),
          await insertKind("MonitorGroup", "otherTeam"),
          await insertKind("MonitorGroup", "nobody"),
        ];
        const monitors: Array<ObjectID> = [
          await insertMonitor("member"),
          await insertMonitor("memberTeam"),
          await insertMonitor("otherTeam"),
          await insertMonitor("nobody"),
        ];

        expect(
          (
            await listThrough({
              caller: member,
              path: "/monitor-group",
              ids: groups,
            })
          ).ids,
        ).toEqual(idsOf(groups.slice(0, 2)));
        expect(
          (
            await listThrough({
              caller: member,
              path: "/monitor",
              ids: monitors,
            })
          ).ids,
        ).toEqual(idsOf(monitors.slice(0, 2)));

        // Another team's group is answered as missing, to a change as to a delete.
        expectMissing(
          await updateThrough({
            caller: member,
            path: "/monitor-group",
            id: groups[2]!,
            row: { name: "Ours now" },
          }),
          "Monitor Group",
        );
        expectMissing(
          await deleteItem("/monitor-group", member, groups[2]!),
          "Monitor Group",
        );
        expect(await rowExists("MonitorGroup", groups[2]!)).toBe(true);
      });

      /*
       * A group the member may not read is not one they name either: a
       * status page of theirs shows another team's monitor group only when
       * they may read it - picking one is reading it - however the request
       * names it.
       */
      test("Project Member scoped to Owned: a status page of theirs shows no monitor group of another team's, named by its id; beside a read of every group it shows any", async () => {
        const myPage: ObjectID = await insertKind("StatusPage", "memberTeam");
        const myGroup: ObjectID = await insertKind(
          "MonitorGroup",
          "memberTeam",
        );
        const theirGroup: ObjectID = await insertKind(
          "MonitorGroup",
          "otherTeam",
        );

        // Whether a status page resource showing `groupId` is written.
        const show: (groupId: ObjectID) => Promise<Outcome> = async (
          groupId: ObjectID,
        ): Promise<Outcome> => {
          return await createThrough({
            caller: member,
            path: pathOf(StatusPageResource),
            row: {
              statusPageId: myPage,
              monitorGroupId: groupId,
              displayName: `Group ${groupId.toString()}`,
              order: 1,
            },
          });
        };

        const shownCount: (groupId: ObjectID) => Promise<number> = async (
          groupId: ObjectID,
        ): Promise<number> => {
          return (
            await database.query(
              `SELECT "_id" FROM "${schema}"."StatusPageResource" WHERE "statusPageId" = $1 AND "monitorGroupId" = $2`,
              [myPage.toString(), groupId.toString()],
            )
          ).length;
        };

        await setGrants([
          {
            permission: Permission.ProjectMember,
            scope: PermissionScope.Owned,
          },
        ]);

        const refused: Outcome = await show(theirGroup);

        expect(refused.error).toBeInstanceOf(UnreadableReferenceException);
        expect(await shownCount(theirGroup)).toBe(0);

        expect((await show(myGroup)).error).toBeUndefined();
        expect(await shownCount(myGroup)).toBe(1);

        // A read of every group: any group can be picked.
        await setGrants([
          { permission: Permission.Viewer },
          {
            permission: Permission.ProjectMember,
            scope: PermissionScope.Owned,
          },
        ]);

        expect((await show(theirGroup)).error).toBeUndefined();
        expect(await shownCount(theirGroup)).toBe(1);
      });
    });

    /*
     * THE PARTS OF A KIND WITH OWNERS: a schedule's layers, the people in
     * them and its shared link; an incoming call policy's escalation rules
     * and the calls it took; an episode's notes and role members. They take their
     * owners from the record they are part of: a member whose grants are
     * scoped to Owned adds, changes and removes them only on the records
     * they or their teams own, and reads them as that record is read.
     */
    describe("the parts of a kind with owners keep to its owners", () => {
      const insertKind: (
        name: string,
        owner: Owner,
      ) => Promise<ObjectID> = async (
        name: string,
        owner: Owner,
      ): Promise<ObjectID> => {
        const kind: OwningKind = SWEPT_KINDS.find(
          (each: OwningKind): boolean => {
            return each.name === name;
          },
        )!;

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

      const pathOf: (modelType: { new (): BaseModel }) => string = (modelType: {
        new (): BaseModel;
      }): string => {
        return new modelType().getCrudApiPath()!.toString();
      };

      // A layer of a schedule, as a schedule's Layers page adds one.
      const layerRow: (
        scheduleId: ObjectID,
        name: string,
      ) => Dictionary<unknown> = (
        scheduleId: ObjectID,
        name: string,
      ): Dictionary<unknown> => {
        const layer: OnCallDutyPolicyScheduleLayer = buildNewScheduleLayer({
          onCallDutyPolicyScheduleId: scheduleId,
          projectId: projectId,
          name: name,
          order: 2,
        });

        return {
          onCallDutyPolicyScheduleId: scheduleId,
          name: name,
          order: 2,
          startsAt: layer.startsAt,
          handOffTime: layer.handOffTime,
          rotation: layer.rotation,
          restrictionTimes: layer.restrictionTimes,
        };
      };

      // A part of `parentId` written directly, as OneUptime writes one.
      const insertPart: (
        table: string,
        row: Dictionary<unknown>,
      ) => Promise<ObjectID> = async (
        table: string,
        row: Dictionary<unknown>,
      ): Promise<ObjectID> => {
        const id: ObjectID = ObjectID.generate();

        await insertAnyRow(table, {
          _id: id,
          projectId: projectId,
          version: 1,
          ...row,
        });

        return id;
      };

      test("On-Call Member scoped to Owned: the layers of another team's schedule, and the people in them, are listed and left as they are; their own schedule's are theirs to change", async () => {
        await setGrants([
          {
            permission: Permission.OnCallMember,
            scope: PermissionScope.Owned,
          },
        ]);

        const mine: ObjectID = await insertKind(
          "OnCallDutyPolicySchedule",
          "memberTeam",
        );
        const theirs: ObjectID = await insertKind(
          "OnCallDutyPolicySchedule",
          "otherTeam",
        );

        const myLayer: ObjectID = await insertPart(
          "OnCallDutyPolicyScheduleLayer",
          { onCallDutyPolicyScheduleId: mine, order: 1 },
        );
        const theirLayer: ObjectID = await insertPart(
          "OnCallDutyPolicyScheduleLayer",
          { onCallDutyPolicyScheduleId: theirs, order: 1 },
        );
        const myTurn: ObjectID = await insertPart(
          "OnCallDutyPolicyScheduleLayerUser",
          {
            onCallDutyPolicyScheduleId: mine,
            onCallDutyPolicyScheduleLayerId: myLayer,
            userId: memberId,
            order: 1,
          },
        );
        const theirTurn: ObjectID = await insertPart(
          "OnCallDutyPolicyScheduleLayerUser",
          {
            onCallDutyPolicyScheduleId: theirs,
            onCallDutyPolicyScheduleLayerId: theirLayer,
            userId: otherUserId,
            order: 1,
          },
        );

        // Read as the schedule is: everyone's.
        expect(
          (
            await listThrough({
              caller: member,
              path: pathOf(OnCallDutyPolicyScheduleLayer),
              ids: [myLayer, theirLayer],
            })
          ).ids,
        ).toEqual(idsOf([myLayer, theirLayer]));
        expect(
          (
            await listThrough({
              caller: member,
              path: pathOf(OnCallDutyPolicyScheduleLayerUser),
              ids: [myTurn, theirTurn],
            })
          ).ids,
        ).toEqual(idsOf([myTurn, theirTurn]));

        // No layer, and nobody in one, added to theirs.
        expectPartCreateRefused(
          await createThrough({
            caller: member,
            path: pathOf(OnCallDutyPolicyScheduleLayer),
            row: layerRow(theirs, "Our layer"),
          }),
          OnCallDutyPolicyScheduleLayer,
          OnCallDutyPolicySchedule,
        );
        expectPartCreateRefused(
          await createThrough({
            caller: member,
            path: pathOf(OnCallDutyPolicyScheduleLayerUser),
            row: {
              onCallDutyPolicyScheduleId: theirs,
              onCallDutyPolicyScheduleLayerId: theirLayer,
              userId: memberId,
              order: 2,
            },
          }),
          OnCallDutyPolicyScheduleLayerUser,
          OnCallDutyPolicySchedule,
        );

        /*
         * Theirs keeps its turns: nobody moves its hand-off, nobody puts
         * themselves in place of whoever takes a turn, and nothing is removed.
         */
        const handOffTime: Date = new Date("2030-01-01T09:00:00.000Z");
        const theirHandOff: unknown = await valueOf(
          "OnCallDutyPolicyScheduleLayer",
          "handOffTime",
          theirLayer,
        );

        expectReadableNotWritten(
          await updateThrough({
            caller: member,
            path: pathOf(OnCallDutyPolicyScheduleLayer),
            id: theirLayer,
            row: { handOffTime: handOffTime },
          }),
          new OnCallDutyPolicyScheduleLayer().singularName!,
          "update",
        );
        expect(
          await valueOf(
            "OnCallDutyPolicyScheduleLayer",
            "handOffTime",
            theirLayer,
          ),
        ).toEqual(theirHandOff);

        expectReadableNotWritten(
          await updateThrough({
            caller: member,
            path: pathOf(OnCallDutyPolicyScheduleLayerUser),
            id: theirTurn,
            row: { userId: memberId },
          }),
          new OnCallDutyPolicyScheduleLayerUser().singularName!,
          "update",
        );
        expect(
          await valueOf(
            "OnCallDutyPolicyScheduleLayerUser",
            "userId",
            theirTurn,
          ),
        ).toBe(otherUserId.toString());

        expectReadableNotWritten(
          await deleteItem(
            pathOf(OnCallDutyPolicyScheduleLayerUser),
            member,
            theirTurn,
          ),
          new OnCallDutyPolicyScheduleLayerUser().singularName!,
          "delete",
        );
        expectReadableNotWritten(
          await deleteItem(
            pathOf(OnCallDutyPolicyScheduleLayer),
            member,
            theirLayer,
          ),
          new OnCallDutyPolicyScheduleLayer().singularName!,
          "delete",
        );
        expect(
          await rowExists("OnCallDutyPolicyScheduleLayerUser", theirTurn),
        ).toBe(true);
        expect(
          await rowExists("OnCallDutyPolicyScheduleLayer", theirLayer),
        ).toBe(true);

        // Their own schedule's: added to, changed and removed.
        const added: Outcome = await createThrough({
          caller: member,
          path: pathOf(OnCallDutyPolicyScheduleLayer),
          row: layerRow(mine, "Our second layer"),
        });

        expect(added.error).toBeUndefined();
        expect(
          (
            await updateThrough({
              caller: member,
              path: pathOf(OnCallDutyPolicyScheduleLayer),
              id: myLayer,
              row: { handOffTime: handOffTime },
            })
          ).error,
        ).toBeUndefined();
        expect(
          await valueOf(
            "OnCallDutyPolicyScheduleLayer",
            "handOffTime",
            myLayer,
          ),
        ).toEqual(handOffTime);
        expect(
          (
            await updateThrough({
              caller: member,
              path: pathOf(OnCallDutyPolicyScheduleLayerUser),
              id: myTurn,
              row: { userId: otherUserId },
            })
          ).error,
        ).toBeUndefined();
        expect(
          await valueOf("OnCallDutyPolicyScheduleLayerUser", "userId", myTurn),
        ).toBe(otherUserId.toString());
        expectDeleted(
          await deleteItem(
            pathOf(OnCallDutyPolicyScheduleLayerUser),
            member,
            myTurn,
          ),
        );
      });

      test("On-Call Member scoped to Owned: the shared link of another team's schedule is not published, changed or taken down; their own schedule's is", async () => {
        await setGrants([
          {
            permission: Permission.OnCallMember,
            scope: PermissionScope.Owned,
          },
        ]);

        const mine: ObjectID = await insertKind(
          "OnCallDutyPolicySchedule",
          "member",
        );
        const theirs: ObjectID = await insertKind(
          "OnCallDutyPolicySchedule",
          "otherTeam",
        );
        const props: DatabaseCommonInteractionProps = await propsOf(member);

        // Publishing theirs: refused, and no link is made.
        const linkOf: (
          scheduleId: ObjectID,
        ) => Promise<OnCallDutyPolicyScheduleCalendarFeed> = (
          scheduleId: ObjectID,
        ): Promise<OnCallDutyPolicyScheduleCalendarFeed> => {
          const feed: OnCallDutyPolicyScheduleCalendarFeed =
            new OnCallDutyPolicyScheduleCalendarFeed();
          feed.projectId = projectId;
          feed.onCallDutyPolicyScheduleId = scheduleId;

          return OnCallDutyPolicyScheduleCalendarFeedService.create({
            data: feed,
            props: props,
          });
        };

        await expect(linkOf(theirs)).rejects.toThrow(
          new CreateScopeException(
            `Your access lets you create ${new OnCallDutyPolicyScheduleCalendarFeed().pluralName} only for the ${new OnCallDutyPolicySchedule().pluralName} you or your teams own.`,
          ),
        );
        expect(
          await database.query(
            `SELECT "_id" FROM "${schema}"."OnCallDutyPolicyScheduleCalendarFeed" WHERE "onCallDutyPolicyScheduleId" = $1`,
            [theirs.toString()],
          ),
        ).toHaveLength(0);

        // Their own: published.
        const myLink: OnCallDutyPolicyScheduleCalendarFeed = await linkOf(mine);

        expect(myLink.id).toBeDefined();

        // Theirs, published by its team: read, but neither turned off nor removed.
        const theirLink: ObjectID = await insertPart(
          "OnCallDutyPolicyScheduleCalendarFeed",
          { onCallDutyPolicyScheduleId: theirs, isEnabled: true },
        );

        expect(
          (
            await listThrough({
              caller: member,
              path: pathOf(OnCallDutyPolicyScheduleCalendarFeed),
              ids: [myLink.id!, theirLink],
            })
          ).ids,
        ).toEqual(idsOf([myLink.id!, theirLink]));

        expect(
          await OnCallDutyPolicyScheduleCalendarFeedService.updateOneBy({
            query: { _id: theirLink, projectId: projectId },
            data: { isEnabled: false },
            props: props,
          }),
        ).toBe(0);
        expect(
          await valueOf(
            "OnCallDutyPolicyScheduleCalendarFeed",
            "isEnabled",
            theirLink,
          ),
        ).toBe(true);

        expectReadableNotWritten(
          await deleteItem(
            pathOf(OnCallDutyPolicyScheduleCalendarFeed),
            member,
            theirLink,
          ),
          new OnCallDutyPolicyScheduleCalendarFeed().singularName!,
          "delete",
        );
        expect(
          await rowExists("OnCallDutyPolicyScheduleCalendarFeed", theirLink),
        ).toBe(true);

        // Their own link: turned off.
        expect(
          await OnCallDutyPolicyScheduleCalendarFeedService.updateOneBy({
            query: { _id: myLink.id!, projectId: projectId },
            data: { isEnabled: false },
            props: props,
          }),
        ).toBe(1);
      });

      test("Project Member scoped to Owned: an incoming call policy's escalation rules and calls are reached only on the policies they or their team own", async () => {
        await setGrants([
          {
            permission: Permission.ProjectMember,
            scope: PermissionScope.Owned,
          },
        ]);

        const mine: ObjectID = await insertKind(
          "IncomingCallPolicy",
          "memberTeam",
        );
        const theirs: ObjectID = await insertKind(
          "IncomingCallPolicy",
          "otherTeam",
        );

        const myRule: ObjectID = await insertPart(
          "IncomingCallPolicyEscalationRule",
          { incomingCallPolicyId: mine, order: 1 },
        );
        const theirRule: ObjectID = await insertPart(
          "IncomingCallPolicyEscalationRule",
          { incomingCallPolicyId: theirs, order: 1 },
        );
        const myCall: ObjectID = await insertPart("IncomingCallLog", {
          incomingCallPolicyId: mine,
        });
        const theirCall: ObjectID = await insertPart("IncomingCallLog", {
          incomingCallPolicyId: theirs,
        });

        // Who each call rang: the attempts, with their call's policy.
        const myAttempt: ObjectID = await insertPart("IncomingCallLogItem", {
          incomingCallLogId: myCall,
          incomingCallPolicyId: mine,
        });
        const theirAttempt: ObjectID = await insertPart("IncomingCallLogItem", {
          incomingCallLogId: theirCall,
          incomingCallPolicyId: theirs,
        });

        expect(
          (
            await listThrough({
              caller: member,
              path: pathOf(IncomingCallPolicyEscalationRule),
              ids: [myRule, theirRule],
            })
          ).ids,
        ).toEqual(idsOf([myRule]));
        expect(
          (
            await listThrough({
              caller: member,
              path: pathOf(IncomingCallLog),
              ids: [myCall, theirCall],
            })
          ).ids,
        ).toEqual(idsOf([myCall]));
        expect(
          (
            await listThrough({
              caller: member,
              path: pathOf(IncomingCallLogItem),
              ids: [myAttempt, theirAttempt],
            })
          ).ids,
        ).toEqual(idsOf([myAttempt]));

        // Nor read one by one, nor found by the call it was part of.
        expectMissing(
          await send({
            method: "post",
            uri: `${pathOf(IncomingCallLogItem)}/:id/get-item`,
            caller: member,
            id: theirAttempt,
            body: { select: { _id: true, userPhoneNumber: true } },
          }),
          new IncomingCallLogItem().singularName!,
        );
        expect(
          (
            await send({
              method: "post",
              uri: `${pathOf(IncomingCallLogItem)}/get-list`,
              caller: member,
              body: {
                query: JSONFunctions.serialize({
                  incomingCallLogId: theirCall,
                } as unknown as JSONObject),
                select: { _id: true },
                limit: 50,
              },
            })
          ).ids,
        ).toEqual([]);

        // No rule added to theirs, and theirs is answered as missing.
        const added: Outcome = await createThrough({
          caller: member,
          path: pathOf(IncomingCallPolicyEscalationRule),
          row: { incomingCallPolicyId: theirs, order: 2 },
        });

        expectRefused(added);
        expect(
          await database.query(
            `SELECT "_id" FROM "${schema}"."IncomingCallPolicyEscalationRule" WHERE "incomingCallPolicyId" = $1`,
            [theirs.toString()],
          ),
        ).toHaveLength(1);

        const ruleName: string = new IncomingCallPolicyEscalationRule()
          .singularName!;

        expectMissing(
          await updateThrough({
            caller: member,
            path: pathOf(IncomingCallPolicyEscalationRule),
            id: theirRule,
            row: { order: 5 },
          }),
          ruleName,
        );
        expectMissing(
          await deleteItem(
            pathOf(IncomingCallPolicyEscalationRule),
            member,
            theirRule,
          ),
          ruleName,
        );
        expect(
          await rowExists("IncomingCallPolicyEscalationRule", theirRule),
        ).toBe(true);

        // Their own policy's: added to and removed.
        expect(
          (
            await createThrough({
              caller: member,
              path: pathOf(IncomingCallPolicyEscalationRule),
              row: { incomingCallPolicyId: mine, order: 2 },
            })
          ).error,
        ).toBeUndefined();
        expectDeleted(
          await deleteItem(
            pathOf(IncomingCallPolicyEscalationRule),
            member,
            myRule,
          ),
        );
      });

      test("Viewer over the whole project beside Project Member scoped to Owned: every call, and who it rang, is read; the escalation rules are still changed only on their own policies", async () => {
        await setGrants([
          { permission: Permission.Viewer },
          {
            permission: Permission.ProjectMember,
            scope: PermissionScope.Owned,
          },
        ]);

        const mine: ObjectID = await insertKind(
          "IncomingCallPolicy",
          "memberTeam",
        );
        const theirs: ObjectID = await insertKind(
          "IncomingCallPolicy",
          "otherTeam",
        );

        const theirRule: ObjectID = await insertPart(
          "IncomingCallPolicyEscalationRule",
          { incomingCallPolicyId: theirs, order: 1 },
        );
        const myCall: ObjectID = await insertPart("IncomingCallLog", {
          incomingCallPolicyId: mine,
        });
        const theirCall: ObjectID = await insertPart("IncomingCallLog", {
          incomingCallPolicyId: theirs,
        });
        const myAttempt: ObjectID = await insertPart("IncomingCallLogItem", {
          incomingCallLogId: myCall,
          incomingCallPolicyId: mine,
        });
        const theirAttempt: ObjectID = await insertPart("IncomingCallLogItem", {
          incomingCallLogId: theirCall,
          incomingCallPolicyId: theirs,
        });

        expect(
          (
            await listThrough({
              caller: member,
              path: pathOf(IncomingCallLog),
              ids: [myCall, theirCall],
            })
          ).ids,
        ).toEqual(idsOf([myCall, theirCall]));
        expect(
          (
            await listThrough({
              caller: member,
              path: pathOf(IncomingCallLogItem),
              ids: [myAttempt, theirAttempt],
            })
          ).ids,
        ).toEqual(idsOf([myAttempt, theirAttempt]));

        // Another team's rule: read, not changed or removed.
        expect(
          (
            await listThrough({
              caller: member,
              path: pathOf(IncomingCallPolicyEscalationRule),
              ids: [theirRule],
            })
          ).ids,
        ).toEqual(idsOf([theirRule]));

        const ruleName: string = new IncomingCallPolicyEscalationRule()
          .singularName!;

        expectReadableNotWritten(
          await updateThrough({
            caller: member,
            path: pathOf(IncomingCallPolicyEscalationRule),
            id: theirRule,
            row: { order: 5 },
          }),
          ruleName,
          "update",
        );
        expectReadableNotWritten(
          await deleteItem(
            pathOf(IncomingCallPolicyEscalationRule),
            member,
            theirRule,
          ),
          ruleName,
          "delete",
        );
        expect(
          await valueOf("IncomingCallPolicyEscalationRule", "order", theirRule),
        ).toBe(1);
      });

      test("an attempt OneUptime writes while it rings someone names the policy of its call, whatever the write named", async () => {
        const mine: ObjectID = await insertKind(
          "IncomingCallPolicy",
          "memberTeam",
        );
        const theirs: ObjectID = await insertKind(
          "IncomingCallPolicy",
          "otherTeam",
        );
        const theirCall: ObjectID = await insertPart("IncomingCallLog", {
          incomingCallPolicyId: theirs,
        });

        for (const named of [undefined, mine]) {
          // As a call that rings someone writes it.
          const attempt: IncomingCallLogItem = new IncomingCallLogItem();
          attempt.projectId = projectId;
          attempt.incomingCallLogId = theirCall;
          attempt.status = IncomingCallStatus.Ringing;
          attempt.startedAt = new Date();
          attempt.isAnswered = false;

          if (named) {
            attempt.incomingCallPolicyId = named;
          }

          const written: IncomingCallLogItem =
            await IncomingCallLogItemService.create({
              data: attempt,
              props: { isRoot: true },
            });

          expect([
            named?.toString() || "none named",
            await valueOf(
              "IncomingCallLogItem",
              "incomingCallPolicyId",
              written.id!,
            ),
          ]).toEqual([named?.toString() || "none named", theirs.toString()]);
        }
      });

      test("Incident Member scoped to Owned: who holds a role on an episode is changed only on the episodes they or their team own", async () => {
        await setGrants([
          {
            permission: Permission.IncidentMember,
            scope: PermissionScope.Owned,
          },
        ]);

        const mine: ObjectID = await insertKind(
          "IncidentEpisode",
          "memberTeam",
        );
        const theirs: ObjectID = await insertKind(
          "IncidentEpisode",
          "otherTeam",
        );
        const roleId: ObjectID = ObjectID.generate();

        const myRole: ObjectID = await insertPart("IncidentEpisodeRoleMember", {
          incidentEpisodeId: mine,
          incidentRoleId: roleId,
          userId: otherUserId,
        });
        const theirRole: ObjectID = await insertPart(
          "IncidentEpisodeRoleMember",
          {
            incidentEpisodeId: theirs,
            incidentRoleId: roleId,
            userId: otherUserId,
          },
        );

        expect(
          (
            await listThrough({
              caller: member,
              path: pathOf(IncidentEpisodeRoleMember),
              ids: [myRole, theirRole],
            })
          ).ids,
        ).toEqual(idsOf([myRole]));

        // Nobody is put in a role on theirs, and nobody is taken out of one.
        expectRefused(
          await createThrough({
            caller: member,
            path: pathOf(IncidentEpisodeRoleMember),
            row: {
              incidentEpisodeId: theirs,
              incidentRoleId: roleId,
              userId: memberId,
            },
          }),
        );
        expect(
          await database.query(
            `SELECT "_id" FROM "${schema}"."IncidentEpisodeRoleMember" WHERE "incidentEpisodeId" = $1`,
            [theirs.toString()],
          ),
        ).toHaveLength(1);

        expectMissing(
          await deleteItem(
            pathOf(IncidentEpisodeRoleMember),
            member,
            theirRole,
          ),
          new IncidentEpisodeRoleMember().singularName!,
        );
        expect(await rowExists("IncidentEpisodeRoleMember", theirRole)).toBe(
          true,
        );

        // On their own episode, someone is taken out of a role.
        expectDeleted(
          await deleteItem(pathOf(IncidentEpisodeRoleMember), member, myRole),
        );
      });
    });

    /*
     * A RUNNER'S KEY IS ITS IDENTITY. Every reader of Runners reads every
     * Runner, so that a runbook step can pick one; but whoever presents a
     * Runner's key is handed the work meant for it, with the runbook secrets
     * and credentials that come with it. So a member who may read keys only
     * through a grant scoped to Owned reads the key of the Runners they or
     * their teams own, and of no other - however they ask.
     */
    describe("a Runner's key keeps to its owners, though every Runner is read", () => {
      const KEY_REFUSAL: string =
        "Your access lets you read the Agent Key only of the Runners you or your teams own, so you cannot sort or filter Runners by it.";

      // A key is unique across Runners, so every test makes its own.
      const keyOf: (name: string) => string = (name: string): string => {
        return `${name}-${ObjectID.generate().toString()}`;
      };

      const insertRunner: (
        owner: Owner,
        key: string,
      ) => Promise<ObjectID> = async (
        owner: Owner,
        key: string,
      ): Promise<ObjectID> => {
        return await insertOwned({
          table: "Runner",
          ownerUserTable: "RunnerOwnerUser",
          ownerTeamTable: "RunnerOwnerTeam",
          ownerColumn: "runnerId",
          owner: owner,
          row: { key: key },
        });
      };

      interface RunnersListed {
        // The Runners listed, by id, sorted.
        ids?: Array<string>;
        // The key read of each: undefined where it was left out.
        keys?: Dictionary<string | undefined>;
        error?: unknown;
      }

      const listRunners: (data: {
        caller: Caller;
        query: Dictionary<unknown>;
        sort?: Dictionary<unknown>;
      }) => Promise<RunnersListed> = async (data: {
        caller: Caller;
        query: Dictionary<unknown>;
        sort?: Dictionary<unknown>;
      }): Promise<RunnersListed> => {
        const outcome: Outcome = await send({
          method: "post",
          uri: "/runner/get-list",
          caller: data.caller,
          body: {
            query: JSONFunctions.serialize(data.query as unknown as JSONObject),
            select: { _id: true, name: true, key: true },
            ...(data.sort ? { sort: data.sort as JSONObject } : {}),
            limit: 50,
          },
        });

        if (outcome.error) {
          return { error: outcome.error };
        }

        const rows: Array<BaseModel> = jest.mocked(
          Response.sendEntityArrayResponse,
        ).mock.calls[0]![2] as Array<BaseModel>;

        const keys: Dictionary<string | undefined> = {};

        for (const row of rows) {
          keys[row.id!.toString()] =
            (row.getColumnValue("key") as string | null) || undefined;
        }

        return { ids: Object.keys(keys).sort(), keys: keys };
      };

      const runnersOf: (ids: Array<ObjectID>) => Dictionary<unknown> = (
        ids: Array<ObjectID>,
      ): Dictionary<unknown> => {
        return { _id: new Includes(ids) };
      };

      test.each([
        {
          grant: "Runbook Admin scoped to Owned",
          rows: [
            {
              permission: Permission.RunbookAdmin,
              scope: PermissionScope.Owned,
            },
          ],
        },
        {
          grant:
            "Runbook Viewer over the whole project beside Runbook Admin scoped to Owned",
          rows: [
            {
              permission: Permission.RunbookViewer,
              scope: PermissionScope.All,
            },
            {
              permission: Permission.RunbookAdmin,
              scope: PermissionScope.Owned,
            },
          ],
        },
      ] as Array<{ grant: string; rows: Array<PermissionRow> }>)(
        "$grant: every Runner listed and read, the key only of their own",
        async ({ rows }: { grant: string; rows: Array<PermissionRow> }) => {
          await setGrants(rows);

          const mineKey: string = keyOf("mine");
          const oursKey: string = keyOf("ours");

          const mine: ObjectID = await insertRunner("member", mineKey);
          const ours: ObjectID = await insertRunner("memberTeam", oursKey);
          const theirs: ObjectID = await insertRunner(
            "otherTeam",
            keyOf("theirs"),
          );
          const nobodys: ObjectID = await insertRunner(
            "nobody",
            keyOf("nobody"),
          );

          const listed: RunnersListed = await listRunners({
            caller: member,
            query: runnersOf([mine, ours, theirs, nobodys]),
          });

          // Every Runner is listed, the key only of the ones they own.
          expect(listed.ids).toEqual(idsOf([mine, ours, theirs, nobodys]));
          expect(listed.keys).toStrictEqual({
            [mine.toString()]: mineKey,
            [ours.toString()]: oursKey,
            [theirs.toString()]: undefined,
            [nobodys.toString()]: undefined,
          });

          // One by one: the Runner is read, its key only when it is theirs.
          for (const [id, key] of [
            [mine, mineKey],
            [theirs, undefined],
          ] as Array<[ObjectID, string | undefined]>) {
            const outcome: Outcome = await send({
              method: "post",
              uri: "/runner/:id/get-item",
              caller: member,
              id: id,
              body: { select: { _id: true, name: true, key: true } },
            });

            expect(outcome.error).toBeUndefined();
            expect(outcome.item?.id?.toString()).toBe(id.toString());
            expect(outcome.item?.getColumnValue("name")).toBeTruthy();
            expect(outcome.item?.getColumnValue("key") || undefined).toBe(key);
          }
        },
      );

      test("Runbook Admin scoped to Owned: a filter or a search on the key finds only their own Runners, and Runners are not ordered by it", async () => {
        await setGrants([
          { permission: Permission.RunbookAdmin, scope: PermissionScope.Owned },
        ]);

        const mineKey: string = keyOf("match-mine");
        const theirsKey: string = keyOf("match-theirs");

        const mine: ObjectID = await insertRunner("member", mineKey);
        const theirs: ObjectID = await insertRunner("otherTeam", theirsKey);
        const all: Array<ObjectID> = [mine, theirs];

        // By the key itself: another team's is never matched.
        expect(
          await listRunners({
            caller: member,
            query: { ...runnersOf(all), key: theirsKey },
          }),
        ).toStrictEqual({ ids: [], keys: {} });
        expect(
          await listRunners({
            caller: member,
            query: { ...runnersOf(all), key: mineKey },
          }),
        ).toStrictEqual({
          ids: idsOf([mine]),
          keys: { [mine.toString()]: mineKey },
        });

        // By a free-text search that reads the key: only their own.
        expect(
          await listRunners({
            caller: member,
            query: {
              ...runnersOf(all),
              search: new MultiSearch({
                value: "match-",
                fields: ["name", "key"],
              }),
            },
          }),
        ).toStrictEqual({
          ids: idsOf([mine]),
          keys: { [mine.toString()]: mineKey },
        });

        // Ordered by the key: refused, as a read of every key one guess at a time.
        const sorted: RunnersListed = await listRunners({
          caller: member,
          query: runnersOf(all),
          sort: { key: SortOrder.Ascending },
        });

        expect(sorted.error).toBeInstanceOf(NotAuthorizedException);
        expect((sorted.error as Error).message).toBe(KEY_REFUSAL);

        // Ordered by anything else, every Runner is listed.
        expect(
          (
            await listRunners({
              caller: member,
              query: runnersOf(all),
              sort: { name: SortOrder.Ascending },
            })
          ).ids,
        ).toEqual(idsOf(all));

        // A Runner's owners, matched by the key of the Runner they own: refused.
        const byOwners: Outcome = await send({
          method: "post",
          uri: "/runner-owner-user/get-list",
          caller: member,
          body: {
            query: JSONFunctions.serialize({
              runner: { key: theirsKey },
            } as unknown as JSONObject),
            select: { _id: true },
            limit: 50,
          },
        });

        expect(byOwners.error).toBeInstanceOf(NotAuthorizedException);
        expect((byOwners.error as Error).message).toBe(KEY_REFUSAL);
      });

      test("Runbook Admin over the whole project, and an API key: every Runner's key, filtered and ordered by it as before", async () => {
        await setGrants([
          { permission: Permission.RunbookAdmin, scope: PermissionScope.All },
        ]);

        const mineKey: string = keyOf("wide-mine");
        const theirsKey: string = keyOf("wide-theirs");

        const mine: ObjectID = await insertRunner("member", mineKey);
        const theirs: ObjectID = await insertRunner("otherTeam", theirsKey);
        const apiKey: ObjectID = await createApiKey([Permission.RunbookAdmin]);

        for (const caller of [
          member,
          { kind: "apiKey", apiKey: apiKey } as Caller,
        ]) {
          expect(
            await listRunners({
              caller: caller,
              query: runnersOf([mine, theirs]),
              sort: { key: SortOrder.Ascending },
            }),
          ).toStrictEqual({
            ids: idsOf([mine, theirs]),
            keys: {
              [mine.toString()]: mineKey,
              [theirs.toString()]: theirsKey,
            },
          });

          expect(
            await listRunners({
              caller: caller,
              query: { ...runnersOf([mine, theirs]), key: theirsKey },
            }),
          ).toStrictEqual({
            ids: idsOf([theirs]),
            keys: { [theirs.toString()]: theirsKey },
          });
        }
      });
    });

    /*
     * THE MONITORS A GROUP HOLDS ARE THE GROUP'S. They make the status a
     * status page shows for it, and nothing in a group changes the monitors
     * it holds, so a group's members are held to the group's owners: a
     * member whose permission to add monitors to groups is scoped to Owned
     * adds them to, and takes them out of, the groups they or their teams
     * own - any monitor they may read - and no other group, however many
     * groups they may read.
     */
    describe("the monitors a group holds keep to the group's owners", () => {
      const insertGroup: (owner: Owner) => Promise<ObjectID> = async (
        owner: Owner,
      ): Promise<ObjectID> => {
        return await insertOwned({
          table: "MonitorGroup",
          ownerUserTable: "MonitorGroupOwnerUser",
          ownerTeamTable: "MonitorGroupOwnerTeam",
          ownerColumn: "monitorGroupId",
          owner: owner,
        });
      };

      // A monitor in a group, as a project admin would have put it there.
      const insertMembership: (
        groupId: ObjectID,
        monitorId: ObjectID,
      ) => Promise<ObjectID> = async (
        groupId: ObjectID,
        monitorId: ObjectID,
      ): Promise<ObjectID> => {
        const id: ObjectID = ObjectID.generate();

        await insertAnyRow("MonitorGroupResource", {
          _id: id,
          projectId: projectId,
          monitorGroupId: groupId,
          monitorId: monitorId,
          version: 1,
        });

        return id;
      };

      const membershipsOf: (
        groupId: ObjectID,
      ) => Promise<Array<string>> = async (
        groupId: ObjectID,
      ): Promise<Array<string>> => {
        const rows: Array<{ monitorId: string }> = await database.query(
          `SELECT "monitorId" FROM "${schema}"."MonitorGroupResource" WHERE "monitorGroupId" = $1 AND "deletedAt" IS NULL ORDER BY "monitorId"`,
          [groupId.toString()],
        );

        return rows.map((row: { monitorId: string }): string => {
          return row.monitorId;
        });
      };

      const PATH: string = "/monitor-group-resource";

      test("Monitor Viewer over the whole project beside Monitor Admin scoped to Owned: a monitor of theirs is not put in another team's group, and their own group's owners take out any monitor", async () => {
        await setGrants([
          { permission: Permission.MonitorViewer, scope: PermissionScope.All },
          { permission: Permission.MonitorAdmin, scope: PermissionScope.Owned },
        ]);

        const myGroup: ObjectID = await insertGroup("member");
        const theirGroup: ObjectID = await insertGroup("otherTeam");
        const myMonitor: ObjectID = await insertMonitor("member");
        const theirMonitor: ObjectID = await insertMonitor("otherTeam");

        // Another team's group, which they read: no monitor of theirs goes in.
        expectPartCreateRefused(
          await createThrough({
            caller: member,
            path: PATH,
            row: { monitorGroupId: theirGroup, monitorId: myMonitor },
          }),
          MonitorGroupResource,
          MonitorGroup,
        );
        expect(await membershipsOf(theirGroup)).toEqual([]);

        // Their own group holds any monitor they read - another team's too.
        for (const monitorId of [myMonitor, theirMonitor]) {
          expect(
            (
              await createThrough({
                caller: member,
                path: PATH,
                row: { monitorGroupId: myGroup, monitorId: monitorId },
              })
            ).error,
          ).toBeUndefined();
        }
        expect(await membershipsOf(myGroup)).toEqual(
          idsOf([myMonitor, theirMonitor]),
        );

        // A monitor of theirs someone put in another team's group stays there.
        const inTheirs: ObjectID = await insertMembership(
          theirGroup,
          myMonitor,
        );

        expectReadableNotWritten(
          await deleteItem(PATH, member, inTheirs),
          "Monitor Group Resource",
          "delete",
        );
        expect(await membershipsOf(theirGroup)).toEqual(idsOf([myMonitor]));

        // Another team's monitor put in their group: theirs to take out.
        const intruder: ObjectID = await insertGroup("member");
        const placed: ObjectID = await insertMembership(intruder, theirMonitor);

        expectDeleted(await deleteItem(PATH, member, placed));
        expect(await membershipsOf(intruder)).toEqual([]);
      });

      test("Monitor Admin scoped to Owned: every monitor in their own group is listed, and nothing of another team's group", async () => {
        await setGrants([
          { permission: Permission.MonitorAdmin, scope: PermissionScope.Owned },
        ]);

        const myGroup: ObjectID = await insertGroup("memberTeam");
        const theirGroup: ObjectID = await insertGroup("otherTeam");
        const myMonitor: ObjectID = await insertMonitor("member");
        const theirMonitor: ObjectID = await insertMonitor("otherTeam");

        const memberships: Array<ObjectID> = [
          await insertMembership(myGroup, myMonitor),
          await insertMembership(myGroup, theirMonitor),
          await insertMembership(theirGroup, myMonitor),
          await insertMembership(theirGroup, theirMonitor),
        ];

        expect(
          (
            await listThrough({
              caller: member,
              path: PATH,
              ids: memberships,
            })
          ).ids,
        ).toEqual(idsOf(memberships.slice(0, 2)));

        // And a monitor of another team's group is not taken out of it.
        expectMissing(
          await deleteItem(PATH, member, memberships[2]!),
          "Monitor Group Resource",
        );
        expect(await membershipsOf(theirGroup)).toEqual(
          idsOf([myMonitor, theirMonitor]),
        );
      });

      test("the same permissions over the whole project put any monitor in any group, and take any out", async () => {
        await setGrants([
          { permission: Permission.MonitorAdmin, scope: PermissionScope.All },
        ]);

        const theirGroup: ObjectID = await insertGroup("otherTeam");
        const myMonitor: ObjectID = await insertMonitor("member");

        const created: Outcome = await createThrough({
          caller: member,
          path: PATH,
          row: { monitorGroupId: theirGroup, monitorId: myMonitor },
        });

        expect(created.error).toBeUndefined();
        expect(await membershipsOf(theirGroup)).toEqual(idsOf([myMonitor]));

        expectDeleted(await deleteItem(PATH, member, created.item!.id!));
        expect(await membershipsOf(theirGroup)).toEqual([]);
      });
    });

    test("an episode's notes are posted, read and removed only on the episodes the member or their team own - beside a read of every episode too", async () => {
      const insertEpisode: (owner: Owner) => Promise<ObjectID> = async (
        owner: Owner,
      ): Promise<ObjectID> => {
        return await insertOwned({
          table: "IncidentEpisode",
          ownerUserTable: "IncidentEpisodeOwnerUser",
          ownerTeamTable: "IncidentEpisodeOwnerTeam",
          ownerColumn: "incidentEpisodeId",
          owner: owner,
        });
      };

      const insertNote: (episodeId: ObjectID) => Promise<ObjectID> = async (
        episodeId: ObjectID,
      ): Promise<ObjectID> => {
        const id: ObjectID = ObjectID.generate();

        await insertAnyRow("IncidentEpisodeInternalNote", {
          _id: id,
          projectId: projectId,
          incidentEpisodeId: episodeId,
          note: "A note",
          version: 1,
        });

        return id;
      };

      const path: string = new IncidentEpisodeInternalNote()
        .getCrudApiPath()!
        .toString();
      const singular: string = new IncidentEpisodeInternalNote().singularName!;

      const mine: ObjectID = await insertEpisode("memberTeam");
      const theirs: ObjectID = await insertEpisode("otherTeam");
      const myNote: ObjectID = await insertNote(mine);
      const theirNote: ObjectID = await insertNote(theirs);

      /*
       * Incident Member scoped to Owned, and the same beside a read of every
       * episode: either way the notes keep to the episodes they own.
       */
      for (const grants of [
        [
          {
            permission: Permission.IncidentMember,
            scope: PermissionScope.Owned,
          },
        ],
        [
          {
            permission: Permission.ReadIncidentEpisode,
            scope: PermissionScope.All,
          },
          {
            permission: Permission.CreateIncidentEpisodeInternalNote,
            scope: PermissionScope.Owned,
          },
          {
            permission: Permission.ReadIncidentEpisodeInternalNote,
            scope: PermissionScope.Owned,
          },
          {
            permission: Permission.DeleteIncidentEpisodeInternalNote,
            scope: PermissionScope.Owned,
          },
        ],
      ] as Array<Array<PermissionRow>>) {
        await setGrants(grants);

        const scope: string = grants
          .map((row: PermissionRow): string => {
            return `${row.permission} ${scopeOf(row)}`;
          })
          .join(", ");

        expect([
          scope,
          (
            await listThrough({
              caller: member,
              path: path,
              ids: [myNote, theirNote],
            })
          ).ids,
        ]).toEqual([scope, idsOf([myNote])]);

        const posted: Outcome = await createThrough({
          caller: member,
          path: path,
          row: { incidentEpisodeId: theirs, note: "Ours now" },
        });

        expect([scope, posted.item]).toEqual([scope, undefined]);
        expectRefused(posted);
        expect(
          await database.query(
            `SELECT "_id" FROM "${schema}"."IncidentEpisodeInternalNote" WHERE "incidentEpisodeId" = $1`,
            [theirs.toString()],
          ),
        ).toHaveLength(1);

        expectMissing(await deleteItem(path, member, theirNote), singular);
        expect(await rowExists("IncidentEpisodeInternalNote", theirNote)).toBe(
          true,
        );

        expect([
          scope,
          (
            await createThrough({
              caller: member,
              path: path,
              row: { incidentEpisodeId: mine, note: "Our note" },
            })
          ).error,
        ]).toEqual([scope, undefined]);
      }

      // The refusal says why, for a member who reads every episode.
      const refused: Outcome = await createThrough({
        caller: member,
        path: path,
        row: { incidentEpisodeId: theirs, note: "Ours now" },
      });

      expectPartCreateRefused(
        refused,
        IncidentEpisodeInternalNote,
        IncidentEpisode,
      );
    });

    /*
     * THE ATTEMPTS OF THE CALLS MADE BEFORE THIS CHANGE take the policy of
     * their call: the migration adds the column and gives each attempt the
     * policy its call names, then the online migration indexes the column
     * and keys it to the policy - an attempt goes with its policy. Run
     * again, it changes nothing. In a schema of its own, with the three
     * tables as they were before it.
     */
    test("the attempts of the calls made before the change take the policy of their call, indexed and keyed to it, however often the migration runs", async () => {
      const before: string = `call_attempts_${ObjectID.generate()
        .toString()
        .replace(/-/g, "")}`;
      const runner: QueryRunner = database.createQueryRunner();

      const policyA: string = ObjectID.generate().toString();
      const policyB: string = ObjectID.generate().toString();
      const callA: string = ObjectID.generate().toString();
      const callB: string = ObjectID.generate().toString();
      const attempts: Dictionary<string> = {
        [ObjectID.generate().toString()]: policyA,
        [ObjectID.generate().toString()]: policyA,
        [ObjectID.generate().toString()]: policyB,
      };
      const callOf: (policyId: string) => string = (
        policyId: string,
      ): string => {
        return policyId === policyA ? callA : callB;
      };

      try {
        await database.query(`CREATE SCHEMA "${before}"`);

        for (const table of [
          "IncomingCallPolicy",
          "IncomingCallLog",
          "IncomingCallLogItem",
        ]) {
          await database.query(
            `CREATE TABLE "${before}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
          );
        }

        // The attempts' table as it was before the change.
        await database.query(
          `ALTER TABLE "${before}"."IncomingCallLogItem" DROP COLUMN "incomingCallPolicyId"`,
        );

        for (const policyId of [policyA, policyB]) {
          await database.query(
            `INSERT INTO "${before}"."IncomingCallPolicy" ("_id", "version", "projectId", "name", "slug") VALUES ($1, 1, $2, $3, $3)`,
            [policyId, projectId.toString(), `policy-${policyId}`],
          );
          await database.query(
            `INSERT INTO "${before}"."IncomingCallLog" ("_id", "version", "projectId", "incomingCallPolicyId") VALUES ($1, 1, $2, $3)`,
            [callOf(policyId), projectId.toString(), policyId],
          );
        }

        for (const [attemptId, policyId] of Object.entries(attempts)) {
          await database.query(
            `INSERT INTO "${before}"."IncomingCallLogItem" ("_id", "version", "projectId", "incomingCallLogId") VALUES ($1, 1, $2, $3)`,
            [attemptId, projectId.toString(), callOf(policyId)],
          );
        }

        await runner.query(`SET search_path TO "${before}"`);
        await new AddIncomingCallLogItemPolicy1803600000000().up(runner);

        for (let run: number = 0; run < 2; run++) {
          await new AddIncomingCallLogItemPolicyIndexAndKey1803650000000().up(
            runner,
          );
        }

        const rows: Array<{ _id: string; incomingCallPolicyId: string }> =
          await database.query(
            `SELECT "_id", "incomingCallPolicyId" FROM "${before}"."IncomingCallLogItem"`,
          );

        expect(
          Object.fromEntries(
            rows.map((row: { _id: string; incomingCallPolicyId: string }) => {
              return [row._id, row.incomingCallPolicyId];
            }),
          ),
        ).toEqual(attempts);

        const indexes: Array<{ isValid: boolean }> = await database.query(
          `SELECT x.indisvalid AS "isValid" FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2`,
          [before, "IDX_d728fcf2cd2e2bafbbb0ee8719"],
        );

        expect(indexes).toEqual([{ isValid: true }]);

        const keys: Array<{ isValidated: boolean; onDelete: string }> =
          await database.query(
            `SELECT con.convalidated AS "isValidated", con.confdeltype AS "onDelete" FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace WHERE n.nspname = $1 AND con.conname = $2`,
            [before, "FK_d728fcf2cd2e2bafbbb0ee87193"],
          );

        expect(keys).toEqual([{ isValidated: true, onDelete: "c" }]);

        // An attempt goes with its policy.
        await database.query(
          `DELETE FROM "${before}"."IncomingCallPolicy" WHERE "_id" = $1`,
          [policyB],
        );

        expect(
          (
            await database.query(
              `SELECT "_id" FROM "${before}"."IncomingCallLogItem" ORDER BY "_id"`,
            )
          ).map((row: { _id: string }): string => {
            return row._id;
          }),
        ).toEqual(
          Object.keys(attempts)
            .filter((attemptId: string): boolean => {
              return attempts[attemptId] === policyA;
            })
            .sort(),
        );
      } finally {
        await runner.query(`RESET search_path`).catch(() => {
          return undefined;
        });
        await runner.release();
        await database.query(`DROP SCHEMA IF EXISTS "${before}" CASCADE`);
      }
    });

    test("the sweep covers every kind with owner tables but the monitor, which the suite runs through its own routes", () => {
      const kinds: Set<string> = new Set<string>();

      for (const modelType of Entities as Array<{ new (): BaseModel }>) {
        const match: RegExpExecArray | null = OWNER_TABLE_NAME.exec(
          new modelType().tableName || "",
        );

        if (match) {
          kinds.add(match[1]!);
        }
      }

      expect(kinds.size).toBeGreaterThanOrEqual(37);
      expect(
        SWEPT_KINDS.map((kind: OwningKind): string => {
          return kind.name;
        }).sort(),
      ).toEqual(
        Array.from(kinds)
          .filter((kind: string): boolean => {
            return kind !== "Monitor";
          })
          .sort(),
      );
    });

    test("the suite copied every table it writes", () => {
      expect(copiedTables.length).toBeGreaterThan(TABLES.length + 60);
    });
  },
);
