import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageOwnerUserService from "../../../Server/Services/StatusPageOwnerUserService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Response from "../../../Server/Utils/Response";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import Label from "../../../Models/DatabaseModels/Label";
import LlmCostBudget from "../../../Models/DatabaseModels/LlmCostBudget";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageOwnerTeam from "../../../Models/DatabaseModels/StatusPageOwnerTeam";
import MetricPipelineRule from "../../../Models/DatabaseModels/MetricPipelineRule";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import Service from "../../../Models/DatabaseModels/Service";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ServerException from "../../../Types/Exception/ServerException";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, Logger } from "typeorm";

/*
 * THE RECORDS A CALLER REACHES THROUGH THE CRUD API, against a migrated
 * Postgres: every request here goes through the route BaseAPI registers, the
 * real user middleware - which reads the caller's teams and their
 * permission rows, or an API key and its permission rows, from the tables
 * below - and the real permission pipeline, query serializer and TypeORM.
 * Only the lookups around the request (the session token, the permission
 * cache, single sign-on, the audit trail and workflow triggers) are stubbed.
 *
 *   - A list, a count, a read, an update and a delete reach only the
 *     caller's project, whatever the request names: another project's id
 *     as `project`, `projectId` or inside `Includes`, a relation to another
 *     project's record by id, by `{ _id }` or by `Includes`, another
 *     project's record id in the path.
 *   - The label rule holds on every path, for teams and API keys alike: a
 *     grant limited to labels, a block with no labels, a block with labels,
 *     and both - on a model that carries labels (Alert) and on one whose
 *     rows carry the labels of the record they belong to (an alert's
 *     internal note).
 *   - A read across projects applies each project's own grants and blocks
 *     to that project's rows.
 *   - A record read through a parent - an alert's note, a status page's
 *     announcement - is created only under a parent its creator may read,
 *     a private alert only by the people it names and by project admins.
 *   - The one record a write names in a field of its own (a cost
 *     budget's service) is one its caller may read; an update that changes
 *     the labels a record carries keeps it within its editor's permission
 *     to change it; the records a create's hooks name besides are asked
 *     about too; a creator who may create only what they own owns it, or
 *     it is not created.
 *   - An AI insight follows the service it names.
 *   - The work per request does not grow with the rows it reads.
 *
 * The services are plain DatabaseServices: the pipeline under test is
 * BaseAPI -> DatabaseService -> ModelPermission, not a model's own hooks.
 *
 * Opt in with RUN_POSTGRES_RECORD_SCOPE_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_RECORD_SCOPE_TESTS=true \
 *   RECORD_SCOPE_TEST_DATABASE_HOST=127.0.0.1 \
 *   RECORD_SCOPE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/API/RecordScopeCrudPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables it
 * writes are copied from public into a uniquely named schema that is dropped
 * afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_RECORD_SCOPE_TESTS"] === "true"
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
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

// The audit trail of an update or a delete is written elsewhere.
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

// The tables this suite writes; every other table is read from public.
const TABLES: Array<string> = [
  "User",
  "Project",
  "Team",
  "TeamMember",
  "TeamPermission",
  "TeamPermissionLabel",
  "Label",
  "ApiKey",
  "ApiKeyPermission",
  "ApiKeyPermissionLabel",
  "Alert",
  "AlertLabel",
  "AlertInternalNote",
  "AlertOwnerUser",
  "AlertOwnerTeam",
  "StatusPageOwnerUser",
  "StatusPageOwnerTeam",
  "Service",
  "ServiceLabel",
  "ServiceOwnerUser",
  "ServiceOwnerTeam",
  "AIInsight",
  "StatusPage",
  "StatusPageLabel",
  "StatusPageAnnouncement",
  "AnnouncementStatusPage",
  "InventoryItem",
  "IncidentLabel",
  "AutoRemediationDecision",
  "MetricPipelineRule",
  "AlertService",
  "OnCallDutyPolicy",
  "OnCallDutyPolicyLabel",
  "OnCallDutyPolicyEscalationRule",
  "OnCallDutyPolicyOwnerUser",
  "OnCallDutyPolicyOwnerTeam",
  "LlmCostBudget",
];

interface PermissionRow {
  permission: Permission;
  labelIds?: Array<ObjectID>;
  isBlock?: boolean;
  scope?: PermissionScope;
}

type Caller =
  | {
      kind: "user";
      tenantId?: ObjectID | undefined;
      isMultiTenant?: boolean | undefined;
    }
  | {
      kind: "apiKey";
      apiKey: ObjectID;
      // A tenant header beside the key; the key names its own project.
      tenantHeader?: ObjectID | undefined;
    };

// What a route answered.
interface Outcome {
  error?: unknown;
  ids?: Array<string>;
  count?: number;
  item?: BaseModel | null;
  isEmptySuccess?: boolean;
}

describePostgres("the records the CRUD API reaches, on Postgres", () => {
  const schema: string = `record_scope_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  let database: DataSource;

  // Every statement the data source runs, for the work-per-request checks.
  const statements: Array<string> = [];

  const queryCounter: Logger = {
    logQuery: (query: string): void => {
      statements.push(query);
    },
    logQueryError: (): void => {},
    logQuerySlow: (): void => {},
    logSchemaBuild: (): void => {},
    logMigration: (): void => {},
    log: (): void => {},
  };

  const alertService: DatabaseService<Alert> = new DatabaseService(Alert);
  const noteService: DatabaseService<AlertInternalNote> = new DatabaseService(
    AlertInternalNote,
  );
  const insightService: DatabaseService<AIInsight> = new DatabaseService(
    AIInsight,
  );

  /*
   * The routes register on mockRouter as BaseAPI builds them: the services
   * are the plain DatabaseServices above.
   */
  new BaseAPI(Alert, alertService as DatabaseService<BaseModel>);
  new BaseAPI(AlertInternalNote, noteService as DatabaseService<BaseModel>);
  new BaseAPI(AIInsight, insightService as DatabaseService<BaseModel>);
  new BaseAPI(
    StatusPageAnnouncement,
    new DatabaseService(StatusPageAnnouncement) as DatabaseService<BaseModel>,
  );
  new BaseAPI(
    InventoryItem,
    new DatabaseService(InventoryItem) as DatabaseService<BaseModel>,
  );
  new BaseAPI(
    AutoRemediationDecision,
    new DatabaseService(AutoRemediationDecision) as DatabaseService<BaseModel>,
  );
  new BaseAPI(
    StatusPage,
    new DatabaseService(StatusPage) as DatabaseService<BaseModel>,
  );
  new BaseAPI(
    StatusPageOwnerTeam,
    new DatabaseService(StatusPageOwnerTeam) as DatabaseService<BaseModel>,
  );
  new BaseAPI(
    MetricPipelineRule,
    new DatabaseService(MetricPipelineRule) as DatabaseService<BaseModel>,
  );
  new BaseAPI(
    OnCallDutyPolicy,
    new DatabaseService(OnCallDutyPolicy) as DatabaseService<BaseModel>,
  );
  new BaseAPI(
    OnCallDutyPolicyEscalationRule,
    new DatabaseService(
      OnCallDutyPolicyEscalationRule,
    ) as DatabaseService<BaseModel>,
  );
  new BaseAPI(
    LlmCostBudget,
    new DatabaseService(LlmCostBudget) as DatabaseService<BaseModel>,
  );

  // The signed-in member: in the home project and the second project.
  const memberId: ObjectID = ObjectID.generate();
  // Somebody in the other project only.
  const outsiderId: ObjectID = ObjectID.generate();

  const homeProjectId: ObjectID = ObjectID.generate();
  const secondProjectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  const homeTeamId: ObjectID = ObjectID.generate();
  const secondTeamId: ObjectID = ObjectID.generate();
  const otherTeamId: ObjectID = ObjectID.generate();

  const productionLabelId: ObjectID = ObjectID.generate();
  const stagingLabelId: ObjectID = ObjectID.generate();
  const secondProductionLabelId: ObjectID = ObjectID.generate();
  const otherLabelId: ObjectID = ObjectID.generate();

  // Home project alerts: one per label, one with none.
  const productionAlertId: ObjectID = ObjectID.generate();
  const stagingAlertId: ObjectID = ObjectID.generate();
  const unlabelledAlertId: ObjectID = ObjectID.generate();
  // Second project alerts.
  const secondProductionAlertId: ObjectID = ObjectID.generate();
  const secondUnlabelledAlertId: ObjectID = ObjectID.generate();
  // Other project alerts.
  const otherAlertId: ObjectID = ObjectID.generate();
  const otherLabelledAlertId: ObjectID = ObjectID.generate();

  // One internal note on each home alert, and one in the other project.
  const productionNoteId: ObjectID = ObjectID.generate();
  const stagingNoteId: ObjectID = ObjectID.generate();
  const unlabelledNoteId: ObjectID = ObjectID.generate();
  const otherNoteId: ObjectID = ObjectID.generate();

  const productionServiceId: ObjectID = ObjectID.generate();
  const stagingServiceId: ObjectID = ObjectID.generate();
  const otherServiceId: ObjectID = ObjectID.generate();

  // Status pages carrying each label, and announcements shown on them.
  const productionStatusPageId: ObjectID = ObjectID.generate();
  const stagingStatusPageId: ObjectID = ObjectID.generate();
  const productionAnnouncementId: ObjectID = ObjectID.generate();
  const stagingAnnouncementId: ObjectID = ObjectID.generate();
  const bothPagesAnnouncementId: ObjectID = ObjectID.generate();
  const noPageAnnouncementId: ObjectID = ObjectID.generate();

  // Inventory items naming the services by a resource id of any kind.
  const productionItemId: ObjectID = ObjectID.generate();
  const stagingItemId: ObjectID = ObjectID.generate();
  const unnamedItemId: ObjectID = ObjectID.generate();

  /*
   * Incidents known only by their labels (the incident table is not read
   * here), and remediation decisions naming an incident, an alert, both or
   * neither.
   */
  const productionIncidentId: ObjectID = ObjectID.generate();
  const stagingIncidentId: ObjectID = ObjectID.generate();
  const unlabelledIncidentId: ObjectID = ObjectID.generate();
  const productionIncidentStagingAlertDecisionId: ObjectID =
    ObjectID.generate();
  const stagingIncidentDecisionId: ObjectID = ObjectID.generate();
  const unlabelledRecordsDecisionId: ObjectID = ObjectID.generate();
  const unnamedDecisionId: ObjectID = ObjectID.generate();

  const productionInsightId: ObjectID = ObjectID.generate();
  const stagingInsightId: ObjectID = ObjectID.generate();
  const projectInsightId: ObjectID = ObjectID.generate();
  const otherInsightId: ObjectID = ObjectID.generate();

  const homeAlertIds: Array<string> = [
    productionAlertId,
    stagingAlertId,
    unlabelledAlertId,
  ].map(String);

  const homeNoteIds: Array<string> = [
    productionNoteId,
    stagingNoteId,
    unlabelledNoteId,
  ].map(String);

  const otherProjectRowIds: Array<string> = [
    otherAlertId,
    otherLabelledAlertId,
    otherNoteId,
    otherInsightId,
  ].map(String);

  const sorted: (ids: Array<ObjectID | string>) => Array<string> = (
    ids: Array<ObjectID | string>,
  ): Array<string> => {
    return ids
      .map((id: ObjectID | string): string => {
        return id.toString();
      })
      .sort();
  };

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
        return value instanceof ObjectID ? value.toString() : value;
      }),
    );
  };

  const insertAlert: (data: {
    id: ObjectID;
    projectId: ObjectID;
    title: string;
    labelIds?: Array<ObjectID>;
  }) => Promise<void> = async (data: {
    id: ObjectID;
    projectId: ObjectID;
    title: string;
    labelIds?: Array<ObjectID>;
  }): Promise<void> => {
    await insert("Alert", {
      _id: data.id,
      projectId: data.projectId,
      title: data.title,
      // The state and severity tables are not read here.
      currentAlertStateId: ObjectID.generate(),
      alertSeverityId: ObjectID.generate(),
      version: 1,
    });

    for (const labelId of data.labelIds || []) {
      await insert("AlertLabel", { alertId: data.id, labelId: labelId });
    }
  };

  const insertNote: (data: {
    id: ObjectID;
    projectId: ObjectID;
    alertId: ObjectID;
  }) => Promise<void> = async (data: {
    id: ObjectID;
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<void> => {
    await insert("AlertInternalNote", {
      _id: data.id,
      projectId: data.projectId,
      alertId: data.alertId,
      note: "Synthetic note",
      version: 1,
    });
  };

  const insertInsight: (data: {
    id: ObjectID;
    projectId: ObjectID;
    serviceId: ObjectID | null;
  }) => Promise<void> = async (data: {
    id: ObjectID;
    projectId: ObjectID;
    serviceId: ObjectID | null;
  }): Promise<void> => {
    await insert("AIInsight", {
      _id: data.id,
      projectId: data.projectId,
      telemetryServiceId: data.serviceId,
      insightType: "NewException",
      status: "Detected",
      severity: "High",
      fingerprint: data.id.toString(),
      title: "Synthetic insight",
      detailMarkdown: "Synthetic insight",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      version: 1,
    });
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

  // Rows a test made for itself, removed as the database's owner.
  const removeRows: (
    rows: Array<[string, string, ObjectID]>,
  ) => Promise<void> = async (
    rows: Array<[string, string, ObjectID]>,
  ): Promise<void> => {
    for (const [table, column, id] of rows) {
      await database.query(
        `DELETE FROM "${schema}"."${table}" WHERE "${column}" = $1`,
        [id.toString()],
      );
    }
  };

  const readColumn: (
    table: string,
    id: ObjectID,
    column: string,
  ) => Promise<unknown> = async (
    table: string,
    id: ObjectID,
    column: string,
  ): Promise<unknown> => {
    const rows: Array<Dictionary<unknown>> = await database.query(
      `SELECT "${column}" FROM "${schema}"."${table}" WHERE "_id" = $1`,
      [id.toString()],
    );

    return rows[0]?.[column];
  };

  // The team's permission rows, replaced.
  const setTeamPermissions: (
    teamId: ObjectID,
    projectId: ObjectID,
    rows: Array<PermissionRow>,
  ) => Promise<void> = async (
    teamId: ObjectID,
    projectId: ObjectID,
    rows: Array<PermissionRow>,
  ): Promise<void> => {
    await database.query(
      `DELETE FROM "${schema}"."TeamPermissionLabel" WHERE "teamPermissionId" IN (SELECT "_id" FROM "${schema}"."TeamPermission" WHERE "teamId" = $1)`,
      [teamId.toString()],
    );
    await database.query(
      `DELETE FROM "${schema}"."TeamPermission" WHERE "teamId" = $1`,
      [teamId.toString()],
    );

    for (const row of rows) {
      const id: ObjectID = ObjectID.generate();

      await insert("TeamPermission", {
        _id: id,
        projectId: projectId,
        teamId: teamId,
        permission: row.permission,
        isBlockPermission: Boolean(row.isBlock),
        scope:
          row.scope ||
          (!row.isBlock && row.labelIds && row.labelIds.length > 0
            ? PermissionScope.Labels
            : PermissionScope.All),
        version: 1,
      });

      for (const labelId of row.labelIds || []) {
        await insert("TeamPermissionLabel", {
          teamPermissionId: id,
          labelId: labelId,
        });
      }
    }
  };

  /*
   * A new API key of the home project with these permission rows. A new key
   * for every set: a key's rows are cached by the key.
   */
  const createApiKey: (
    rows: Array<PermissionRow>,
    projectId?: ObjectID,
  ) => Promise<ObjectID> = async (
    rows: Array<PermissionRow>,
    projectId: ObjectID = homeProjectId,
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

    for (const row of rows) {
      const permissionId: ObjectID = ObjectID.generate();

      await insert("ApiKeyPermission", {
        _id: permissionId,
        projectId: projectId,
        apiKeyId: id,
        permission: row.permission,
        isBlockPermission: Boolean(row.isBlock),
        version: 1,
      });

      for (const labelId of row.labelIds || []) {
        await insert("ApiKeyPermissionLabel", {
          apiKeyPermissionId: permissionId,
          labelId: labelId,
        });
      }
    }

    return apiKey;
  };

  // The headers a caller's request carries.
  const headersOf: (caller: Caller) => Dictionary<string> = (
    caller: Caller,
  ): Dictionary<string> => {
    const headers: Dictionary<string> = {};

    if (caller.kind === "user") {
      headers["authorization"] = `Bearer ${memberId.toString()}`;

      if (caller.tenantId) {
        headers["tenantid"] = caller.tenantId.toString();
      }

      if (caller.isMultiTenant) {
        headers["is-multi-tenant-query"] = "true";
      }
    } else {
      headers["apikey"] = caller.apiKey.toString();

      if (caller.tenantHeader) {
        headers["tenantid"] = caller.tenantHeader.toString();
      }
    }

    return headers;
  };

  /*
   * The props a caller's request carries into the services, as the user
   * middleware builds them from the permission rows: for the services'
   * updates and deletes by query, which no CRUD route makes.
   */
  const propsOf: (
    caller: Caller,
  ) => Promise<DatabaseCommonInteractionProps> = async (
    caller: Caller,
  ): Promise<DatabaseCommonInteractionProps> => {
    const req: ExpressRequest = {
      method: "POST",
      params: {},
      query: {},
      cookies: {},
      headers: headersOf(caller),
      body: {},
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    } as unknown as ExpressResponse;

    for (const middleware of mockRouter.match("post", "/alert/get-list")
      .middlewares) {
      let isPassed: boolean = false;

      await middleware(req, res, ((error?: unknown) => {
        isPassed = !error;
      }) as NextFunction);

      expect(isPassed).toBe(true);
    }

    return await CommonAPI.getDatabaseCommonInteractionProps(req);
  };

  // Sends one request through its route, as Express would.
  const send: (data: {
    uri: string;
    caller: Caller;
    id?: ObjectID | undefined;
    body?: JSONObject | undefined;
  }) => Promise<Outcome> = async (data: {
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

    const req: ExpressRequest = {
      method: "POST",
      params: data.id ? { id: data.id.toString() } : {},
      query: {},
      cookies: {},
      headers: headersOf(data.caller),
      body: data.body || {},
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    } as unknown as ExpressResponse;

    const route: (typeof mockRouter.routes)[number] = mockRouter.match(
      "post",
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
        ids: sorted(
          (listCall[2] as Array<BaseModel>).map((model: BaseModel): string => {
            return model.id!.toString();
          }),
        ),
        count: (listCall[3] as PositiveNumber).toNumber(),
      };
    }

    const countCall: Array<unknown> | undefined = jest.mocked(
      Response.sendJsonObjectResponse,
    ).mock.calls[0];

    if (countCall) {
      return { count: (countCall[2] as JSONObject)["count"] as number };
    }

    const itemCall: Array<unknown> | undefined = jest.mocked(
      Response.sendEntityResponse,
    ).mock.calls[0];

    if (itemCall) {
      return { item: (itemCall[2] as BaseModel | null) || null };
    }

    if (jest.mocked(Response.sendEmptySuccessResponse).mock.calls.length > 0) {
      return { isEmptySuccess: true };
    }

    throw new Error(`${data.uri} answered nothing.`);
  };

  const list: (
    path: string,
    caller: Caller,
    query?: JSONObject,
  ) => Promise<Outcome> = async (
    path: string,
    caller: Caller,
    query: JSONObject = {},
  ): Promise<Outcome> => {
    return await send({
      uri: `${path}/get-list`,
      caller: caller,
      body: {
        query: JSONFunctions.serialize(query),
        select: { _id: true },
        limit: 50,
      },
    });
  };

  const count: (
    path: string,
    caller: Caller,
    query?: JSONObject,
  ) => Promise<Outcome> = async (
    path: string,
    caller: Caller,
    query: JSONObject = {},
  ): Promise<Outcome> => {
    return await send({
      uri: `${path}/count`,
      caller: caller,
      body: { query: JSONFunctions.serialize(query) },
    });
  };

  const getItem: (
    path: string,
    caller: Caller,
    id: ObjectID,
  ) => Promise<Outcome> = async (
    path: string,
    caller: Caller,
    id: ObjectID,
  ): Promise<Outcome> => {
    return await send({
      uri: `${path}/:id/get-item`,
      caller: caller,
      id: id,
      body: { select: { _id: true } },
    });
  };

  const update: (
    path: string,
    caller: Caller,
    id: ObjectID,
    data: JSONObject,
  ) => Promise<Outcome> = async (
    path: string,
    caller: Caller,
    id: ObjectID,
    data: JSONObject,
  ): Promise<Outcome> => {
    return await send({
      uri: `${path}/:id/update-item`,
      caller: caller,
      id: id,
      body: { data: JSONFunctions.serialize(data) },
    });
  };

  const remove: (
    path: string,
    caller: Caller,
    id: ObjectID,
  ) => Promise<Outcome> = async (
    path: string,
    caller: Caller,
    id: ObjectID,
  ): Promise<Outcome> => {
    return await send({
      uri: `${path}/:id/delete-item`,
      caller: caller,
      id: id,
    });
  };

  const expectRefused: (outcome: Outcome) => void = (
    outcome: Outcome,
  ): void => {
    expect(outcome.error).toBeInstanceOf(Exception);
    expect(outcome.ids).toBeUndefined();
    expect(outcome.count).toBeUndefined();
    expect(outcome.item).toBeUndefined();
  };

  // A read by id that reaches nothing: answered as a missing record (404).
  const expectNotFound: (outcome: Outcome) => void = (
    outcome: Outcome,
  ): void => {
    expect(outcome.error).toBeInstanceOf(NotFoundException);
    expect(outcome.item).toBeUndefined();
  };

  const homeUser: Caller = { kind: "user", tenantId: homeProjectId };

  const acrossProjects: Caller = { kind: "user", isMultiTenant: true };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["RECORD_SCOPE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["RECORD_SCOPE_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["RECORD_SCOPE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      /*
       * No schema of its own: table names stay unqualified, so the tables
       * copied into the test schema are found first and every other table a
       * read joins (a monitor, a host) is found, empty, in public.
       */
      synchronize: false,
      logger: queryCounter,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
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
    getJestSpyOn(GlobalCache, "getJSONObject").mockResolvedValue(null as never);
    getJestSpyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
    getJestSpyOn(GlobalCache, "deleteKey").mockResolvedValue(
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

    // Workflows run elsewhere.
    getJestSpyOn(
      DatabaseService.prototype,
      "onTriggerWorkflow",
    ).mockResolvedValue(undefined as never);

    for (const [id, name] of [
      [homeProjectId, "Home project"],
      [secondProjectId, "Second project"],
      [otherProjectId, "Other project"],
    ] as Array<[ObjectID, string]>) {
      await insert("Project", {
        _id: id,
        name: name,
        slug: id.toString(),
        version: 1,
      });
    }

    for (const id of [memberId, outsiderId]) {
      await insert("User", {
        _id: id,
        name: "Synthetic User",
        email: `${id.toString()}@example.com`,
        slug: id.toString(),
        version: 1,
      });
    }

    for (const [teamId, projectId, userId] of [
      [homeTeamId, homeProjectId, memberId],
      [secondTeamId, secondProjectId, memberId],
      [otherTeamId, otherProjectId, outsiderId],
    ] as Array<[ObjectID, ObjectID, ObjectID]>) {
      await insert("Team", {
        _id: teamId,
        projectId: projectId,
        name: `Team ${teamId.toString()}`,
        slug: teamId.toString(),
        version: 1,
      });
      await insert("TeamMember", {
        _id: ObjectID.generate(),
        projectId: projectId,
        teamId: teamId,
        userId: userId,
        hasAcceptedInvitation: true,
        version: 1,
      });
    }

    for (const [labelId, projectId, name] of [
      [productionLabelId, homeProjectId, "Production"],
      [stagingLabelId, homeProjectId, "Staging"],
      [secondProductionLabelId, secondProjectId, "Production"],
      [otherLabelId, otherProjectId, "Other project label"],
    ] as Array<[ObjectID, ObjectID, string]>) {
      await insert("Label", {
        _id: labelId,
        projectId: projectId,
        name: name,
        slug: labelId.toString(),
        color: "#000000",
        version: 1,
      });
    }

    await insertAlert({
      id: productionAlertId,
      projectId: homeProjectId,
      title: "Production alert",
      labelIds: [productionLabelId],
    });
    await insertAlert({
      id: stagingAlertId,
      projectId: homeProjectId,
      title: "Staging alert",
      labelIds: [stagingLabelId],
    });
    await insertAlert({
      id: unlabelledAlertId,
      projectId: homeProjectId,
      title: "Unlabelled alert",
    });
    await insertAlert({
      id: secondProductionAlertId,
      projectId: secondProjectId,
      title: "Second production alert",
      labelIds: [secondProductionLabelId],
    });
    await insertAlert({
      id: secondUnlabelledAlertId,
      projectId: secondProjectId,
      title: "Second unlabelled alert",
    });
    await insertAlert({
      id: otherAlertId,
      projectId: otherProjectId,
      title: "Other project alert",
    });
    await insertAlert({
      id: otherLabelledAlertId,
      projectId: otherProjectId,
      title: "Other project labelled alert",
      labelIds: [otherLabelId],
    });

    await insertNote({
      id: productionNoteId,
      projectId: homeProjectId,
      alertId: productionAlertId,
    });
    await insertNote({
      id: stagingNoteId,
      projectId: homeProjectId,
      alertId: stagingAlertId,
    });
    await insertNote({
      id: unlabelledNoteId,
      projectId: homeProjectId,
      alertId: unlabelledAlertId,
    });
    await insertNote({
      id: otherNoteId,
      projectId: otherProjectId,
      alertId: otherAlertId,
    });

    for (const [serviceId, projectId, labelIds] of [
      [productionServiceId, homeProjectId, [productionLabelId]],
      [stagingServiceId, homeProjectId, [stagingLabelId]],
      [otherServiceId, otherProjectId, []],
    ] as Array<[ObjectID, ObjectID, Array<ObjectID>]>) {
      await insert("Service", {
        _id: serviceId,
        projectId: projectId,
        name: `Service ${serviceId.toString()}`,
        slug: serviceId.toString(),
        version: 1,
      });

      for (const labelId of labelIds) {
        await insert("ServiceLabel", {
          serviceId: serviceId,
          labelId: labelId,
        });
      }
    }

    await insertInsight({
      id: productionInsightId,
      projectId: homeProjectId,
      serviceId: productionServiceId,
    });
    await insertInsight({
      id: stagingInsightId,
      projectId: homeProjectId,
      serviceId: stagingServiceId,
    });
    await insertInsight({
      id: projectInsightId,
      projectId: homeProjectId,
      serviceId: null,
    });
    await insertInsight({
      id: otherInsightId,
      projectId: otherProjectId,
      serviceId: otherServiceId,
    });

    // The member owns the staging alert and the production service.
    await insert("AlertOwnerUser", {
      _id: ObjectID.generate(),
      projectId: homeProjectId,
      userId: memberId,
      alertId: stagingAlertId,
      version: 1,
    });
    await insert("ServiceOwnerUser", {
      _id: ObjectID.generate(),
      projectId: homeProjectId,
      userId: memberId,
      serviceId: productionServiceId,
      version: 1,
    });

    for (const [statusPageId, labelId] of [
      [productionStatusPageId, productionLabelId],
      [stagingStatusPageId, stagingLabelId],
    ] as Array<[ObjectID, ObjectID]>) {
      await insert("StatusPage", {
        _id: statusPageId,
        projectId: homeProjectId,
        name: `Status page ${statusPageId.toString()}`,
        slug: statusPageId.toString(),
        version: 1,
      });
      await insert("StatusPageLabel", {
        statusPageId: statusPageId,
        labelId: labelId,
      });
    }

    for (const [announcementId, statusPageIds] of [
      [productionAnnouncementId, [productionStatusPageId]],
      [stagingAnnouncementId, [stagingStatusPageId]],
      [bothPagesAnnouncementId, [productionStatusPageId, stagingStatusPageId]],
      [noPageAnnouncementId, []],
    ] as Array<[ObjectID, Array<ObjectID>]>) {
      await insert("StatusPageAnnouncement", {
        _id: announcementId,
        projectId: homeProjectId,
        title: "Synthetic announcement",
        description: "Synthetic announcement",
        showAnnouncementAt: new Date(),
        version: 1,
      });

      for (const statusPageId of statusPageIds) {
        await insert("AnnouncementStatusPage", {
          announcementId: announcementId,
          statusPageId: statusPageId,
        });
      }
    }

    for (const [itemId, resourceId] of [
      [productionItemId, productionServiceId],
      [stagingItemId, stagingServiceId],
      [unnamedItemId, null],
    ] as Array<[ObjectID, ObjectID | null]>) {
      await insert("InventoryItem", {
        _id: itemId,
        projectId: homeProjectId,
        entityType: "service",
        entityKey: itemId.toString(),
        resourceType: resourceId ? "Service" : null,
        resourceId: resourceId,
        version: 1,
      });
    }

    for (const [incidentId, labelId] of [
      [productionIncidentId, productionLabelId],
      [stagingIncidentId, stagingLabelId],
    ] as Array<[ObjectID, ObjectID]>) {
      await insert("IncidentLabel", {
        incidentId: incidentId,
        labelId: labelId,
      });
    }

    for (const [decisionId, incidentId, alertId] of [
      [
        productionIncidentStagingAlertDecisionId,
        productionIncidentId,
        stagingAlertId,
      ],
      [stagingIncidentDecisionId, stagingIncidentId, null],
      [unlabelledRecordsDecisionId, unlabelledIncidentId, unlabelledAlertId],
      [unnamedDecisionId, null, null],
    ] as Array<[ObjectID, ObjectID | null, ObjectID | null]>) {
      await insert("AutoRemediationDecision", {
        _id: decisionId,
        projectId: homeProjectId,
        incidentId: incidentId,
        alertId: alertId,
        stage: "Evaluated",
        version: 1,
      });
    }

    await setTeamPermissions(homeTeamId, homeProjectId, [
      { permission: Permission.AlertMember },
    ]);
    await setTeamPermissions(secondTeamId, secondProjectId, [
      { permission: Permission.AlertMember },
    ]);
    await setTeamPermissions(otherTeamId, otherProjectId, [
      { permission: Permission.ProjectOwner },
    ]);
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  /*
   * The suite can see what it guards against: the rows of every project are
   * in the tables it reads, and a read that is not scoped to the caller
   * finds them.
   */
  test("an unscoped read reaches every project's rows", async () => {
    const alerts: Array<Alert> = await alertService.findBy({
      query: {},
      select: { _id: true },
      skip: 0,
      limit: 50,
      props: { isRoot: true },
    });

    expect(
      sorted(
        alerts.map((alert: Alert): string => {
          return alert.id!.toString();
        }),
      ),
    ).toEqual(
      sorted([
        ...homeAlertIds,
        secondProductionAlertId,
        secondUnlabelledAlertId,
        otherAlertId,
        otherLabelledAlertId,
      ]),
    );

    const notes: Array<AlertInternalNote> = await noteService.findBy({
      query: { alert: otherAlertId.toString() } as never,
      select: { _id: true },
      skip: 0,
      limit: 50,
      props: { isRoot: true },
    });

    expect(notes).toHaveLength(1);
  });

  /*
   * ANOTHER PROJECT, NAMED IN THE REQUEST. The request's project is the one
   * the session's tenant header, or the API key, names. A filter on another
   * project - by its relation or its key, by id, by `{ _id }` or inside
   * `Includes` - and a relation to another project's record, keep to that
   * project: they narrow the caller's rows, never replace the project.
   */
  describe.each([
    ["a member's session", "user"],
    ["an API key", "apiKey"],
  ] as Array<[string, "user" | "apiKey"]>)(
    "another project named in the request, by %s",
    (_label: string, kind: "user" | "apiKey") => {
      let caller: Caller;

      beforeAll(async () => {
        await setTeamPermissions(homeTeamId, homeProjectId, [
          { permission: Permission.AlertMember },
        ]);

        caller =
          kind === "user"
            ? homeUser
            : {
                kind: "apiKey",
                apiKey: await createApiKey([
                  { permission: Permission.AlertMember },
                ]),
              };
      });

      test.each([
        ["the project relation by id", { project: otherProjectId.toString() }],
        [
          "the project relation by { _id }",
          { project: { _id: otherProjectId.toString() } },
        ],
        [
          "the project relation in Includes",
          { project: new Includes([otherProjectId.toString()]) },
        ],
        [
          "both the project relation and its key",
          {
            project: otherProjectId.toString(),
            projectId: otherProjectId.toString(),
          },
        ],
      ] as Array<[string, JSONObject]>)(
        "a list and a count filtered on %s find nothing",
        async (_filter: string, query: JSONObject) => {
          const listed: Outcome = await list("/alert", caller, query);

          expect(listed.error).toBeUndefined();
          expect(listed.ids).toEqual([]);
          expect(listed.count).toBe(0);

          const counted: Outcome = await count("/alert", caller, query);

          expect(counted.error).toBeUndefined();
          expect(counted.count).toBe(0);
        },
      );

      test.each([
        ["the project key by id", { projectId: otherProjectId.toString() }],
        [
          "the project key in Includes",
          { projectId: new Includes([otherProjectId.toString()]) },
        ],
        [
          "the project key with the request's project in Includes",
          {
            projectId: new Includes([
              otherProjectId.toString(),
              homeProjectId.toString(),
            ]),
          },
        ],
      ] as Array<[string, JSONObject]>)(
        "a list and a count filtered on %s stay in the request's project",
        async (_filter: string, query: JSONObject) => {
          const listed: Outcome = await list("/alert", caller, query);

          expect(listed.error).toBeUndefined();
          expect(listed.ids).toEqual(sorted(homeAlertIds));
          expect(listed.count).toBe(3);

          const counted: Outcome = await count("/alert", caller, query);

          expect(counted.count).toBe(3);
        },
      );

      test.each([
        ["by id", { alert: otherAlertId.toString() }],
        ["by { _id }", { alert: { _id: otherAlertId.toString() } }],
        ["in Includes", { alert: new Includes([otherAlertId.toString()]) }],
        ["by its key", { alertId: otherAlertId.toString() }],
        [
          "by its key in Includes",
          { alertId: new Includes([otherAlertId.toString()]) },
        ],
      ] as Array<[string, JSONObject]>)(
        "notes filtered on another project's alert %s are not found",
        async (_filter: string, query: JSONObject) => {
          const listed: Outcome = await list(
            "/alert-internal-note",
            caller,
            query,
          );

          expect(listed.error).toBeUndefined();
          expect(listed.ids).toEqual([]);
          expect(listed.count).toBe(0);

          const counted: Outcome = await count(
            "/alert-internal-note",
            caller,
            query,
          );

          expect(counted.count).toBe(0);
        },
      );

      test("another project's records are not read by id", async () => {
        expectNotFound(await getItem("/alert", caller, otherAlertId));
        expectNotFound(await getItem("/alert", caller, otherLabelledAlertId));
        expectNotFound(
          await getItem("/alert-internal-note", caller, otherNoteId),
        );
      });

      test("another project's records are not changed by id", async () => {
        for (const [path, table, id, data, column] of [
          ["/alert", "Alert", otherAlertId, { title: "Changed" }, "title"],
          [
            "/alert",
            "Alert",
            otherLabelledAlertId,
            { title: "Changed" },
            "title",
          ],
          [
            "/alert-internal-note",
            "AlertInternalNote",
            otherNoteId,
            { note: "Changed" },
            "note",
          ],
        ] as Array<[string, string, ObjectID, JSONObject, string]>) {
          const before: unknown = await readColumn(table, id, column);

          expectRefused(await update(path, caller, id, data));

          expect(await readColumn(table, id, column)).toEqual(before);
        }
      });

      test("another project's records are not deleted by id", async () => {
        // Answered as missing, as a record that does not exist.
        for (const outcome of [
          await remove("/alert-internal-note", caller, otherNoteId),
          await remove("/alert", caller, otherAlertId),
          await remove("/alert", caller, otherLabelledAlertId),
        ]) {
          expect(outcome.error).toBeInstanceOf(NotFoundException);
        }

        expect(await rowExists("AlertInternalNote", otherNoteId)).toBe(true);
        expect(await rowExists("Alert", otherAlertId)).toBe(true);
        expect(await rowExists("Alert", otherLabelledAlertId)).toBe(true);
      });

      /*
       * A check of one record by id - the label rule of an update or a
       * delete - reads the record in the request's project only: another
       * project's record is answered like a missing one, and its labels are
       * neither weighed nor named.
       */
      test("another project's labelled record is answered like a missing one", async () => {
        const labelGrant: Array<PermissionRow> = [
          {
            permission: Permission.AlertMember,
            labelIds: [productionLabelId],
          },
        ];

        let labelCaller: Caller = caller;

        if (kind === "user") {
          await setTeamPermissions(homeTeamId, homeProjectId, labelGrant);
        } else {
          labelCaller = {
            kind: "apiKey",
            apiKey: await createApiKey(labelGrant),
          };
        }

        const titleBefore: unknown = await readColumn(
          "Alert",
          otherLabelledAlertId,
          "title",
        );

        for (const outcome of [
          await update("/alert", labelCaller, otherLabelledAlertId, {
            title: "Changed",
          }),
          await remove("/alert", labelCaller, otherLabelledAlertId),
        ]) {
          expectRefused(outcome);
          expect((outcome.error as Exception).message).not.toContain(
            "Other project label",
          );
        }

        expectNotFound(
          await getItem("/alert", labelCaller, otherLabelledAlertId),
        );
        expect(await readColumn("Alert", otherLabelledAlertId, "title")).toBe(
          titleBefore,
        );
        expect(await rowExists("Alert", otherLabelledAlertId)).toBe(true);

        await setTeamPermissions(homeTeamId, homeProjectId, [
          { permission: Permission.AlertMember },
        ]);
      });

      test("a record is not moved to another project", async () => {
        for (const data of [
          { projectId: otherProjectId.toString() },
          { project: otherProjectId.toString() },
        ] as Array<JSONObject>) {
          await update("/alert", caller, unlabelledAlertId, data);

          expect(
            String(await readColumn("Alert", unlabelledAlertId, "projectId")),
          ).toBe(homeProjectId.toString());
        }
      });
    },
  );

  test("an API key keeps to its own project whatever tenant header it sends", async () => {
    const apiKey: ObjectID = await createApiKey([
      { permission: Permission.AlertMember },
    ]);
    const caller: Caller = {
      kind: "apiKey",
      apiKey: apiKey,
      tenantHeader: otherProjectId,
    };

    const listed: Outcome = await list("/alert", caller);

    expect(listed.ids).toEqual(sorted(homeAlertIds));
    expect(
      (listed.ids || []).filter((id: string): boolean => {
        return otherProjectRowIds.includes(id);
      }),
    ).toEqual([]);
    expectNotFound(await getItem("/alert", caller, otherAlertId));
  });

  /*
   * THE LABEL RULE ON EVERY PATH. One set of permission rows per case, on
   * the member's team or on an API key; the alerts carry the production
   * label, the staging label and no label, and each internal note carries
   * the labels of its alert.
   */
  interface MatrixCase {
    // The rows of the team, or the key.
    rows: Array<PermissionRow>;
    // The alerts, and notes, the caller reaches; null when refused outright.
    readable: Array<"production" | "staging" | "unlabelled"> | null;
  }

  const alertBlocks: (labelIds: Array<ObjectID>) => Array<PermissionRow> = (
    labelIds: Array<ObjectID>,
  ): Array<PermissionRow> => {
    return [
      Permission.ReadAlert,
      Permission.EditAlert,
      Permission.DeleteAlert,
      Permission.ReadAlertInternalNote,
      Permission.EditAlertInternalNote,
      Permission.DeleteAlertInternalNote,
    ].map((permission: Permission): PermissionRow => {
      return { permission: permission, labelIds: labelIds, isBlock: true };
    });
  };

  // The All Operational Resources read, edit and delete permissions.
  const wildcardRows: (data: {
    labelIds?: Array<ObjectID>;
    isBlock?: boolean;
  }) => Array<PermissionRow> = (data: {
    labelIds?: Array<ObjectID>;
    isBlock?: boolean;
  }): Array<PermissionRow> => {
    return [
      Permission.ReadAllOperationalResources,
      Permission.EditAllOperationalResources,
      Permission.DeleteAllOperationalResources,
    ].map((permission: Permission): PermissionRow => {
      return {
        permission: permission,
        ...(data.labelIds ? { labelIds: data.labelIds } : {}),
        ...(data.isBlock ? { isBlock: true } : {}),
      };
    });
  };

  // An alert's notes, read, changed and deleted over the project.
  const noteGrants: () => Array<PermissionRow> = (): Array<PermissionRow> => {
    return [
      { permission: Permission.ReadAlertInternalNote },
      { permission: Permission.EditAlertInternalNote },
      { permission: Permission.DeleteAlertInternalNote },
    ];
  };

  const matrix: Array<[string, () => MatrixCase]> = [
    [
      "a grant over the project",
      (): MatrixCase => {
        return {
          rows: [{ permission: Permission.AlertMember }],
          readable: ["production", "staging", "unlabelled"],
        };
      },
    ],
    [
      "a block with no labels",
      (): MatrixCase => {
        return {
          rows: [{ permission: Permission.AlertMember }, ...alertBlocks([])],
          readable: null,
        };
      },
    ],
    [
      "a block with labels",
      (): MatrixCase => {
        return {
          rows: [
            { permission: Permission.AlertMember },
            ...alertBlocks([productionLabelId]),
          ],
          readable: ["staging", "unlabelled"],
        };
      },
    ],
    [
      "a grant limited to labels",
      (): MatrixCase => {
        return {
          rows: [
            {
              permission: Permission.AlertMember,
              labelIds: [productionLabelId],
            },
          ],
          readable: ["production"],
        };
      },
    ],
    [
      "a grant limited to labels and a block with labels",
      (): MatrixCase => {
        return {
          rows: [
            {
              permission: Permission.AlertMember,
              labelIds: [productionLabelId, stagingLabelId],
            },
            ...alertBlocks([productionLabelId]),
          ],
          readable: ["staging"],
        };
      },
    ],
    /*
     * The All Operational Resources permissions grant an alert like its own
     * permissions do, and narrow it the same way: limited to labels, they
     * reach the alerts carrying them, and a block with labels on one takes
     * those alerts away. The notes, which are not operational resources,
     * are granted over the project and read through the alerts.
     */
    [
      "an All Operational Resources grant limited to labels",
      (): MatrixCase => {
        return {
          rows: [
            ...wildcardRows({ labelIds: [productionLabelId] }),
            ...noteGrants(),
          ],
          readable: ["production"],
        };
      },
    ],
    [
      "an All Operational Resources grant and a block with labels on it",
      (): MatrixCase => {
        return {
          rows: [
            ...wildcardRows({}),
            ...wildcardRows({ labelIds: [productionLabelId], isBlock: true }),
            ...noteGrants(),
          ],
          readable: ["staging", "unlabelled"],
        };
      },
    ],
    [
      "an All Operational Resources grant limited to labels beside the alerts' own grant over the project",
      (): MatrixCase => {
        return {
          rows: [
            { permission: Permission.AlertMember },
            ...wildcardRows({ labelIds: [productionLabelId] }),
          ],
          readable: ["production", "staging", "unlabelled"],
        };
      },
    ],
    [
      "a block with labels on an All Operational Resources permission the caller is not granted",
      (): MatrixCase => {
        return {
          // The alerts are granted by their own permissions, not the wildcard.
          rows: [
            { permission: Permission.AlertMember },
            ...wildcardRows({ labelIds: [productionLabelId], isBlock: true }),
          ],
          readable: ["production", "staging", "unlabelled"],
        };
      },
    ],
  ];

  describe.each([
    ["a member's team", "user"],
    ["an API key", "apiKey"],
  ] as Array<[string, "user" | "apiKey"]>)(
    "the label rule, on %s",
    (_label: string, kind: "user" | "apiKey") => {
      describe.each(matrix)(
        "%s",
        (_case: string, getCase: () => MatrixCase) => {
          let caller: Caller;
          let matrixCase: MatrixCase;

          const alertIdOf: Dictionary<ObjectID> = {};
          const noteIdOf: Dictionary<ObjectID> = {};

          beforeAll(async () => {
            matrixCase = getCase();

            alertIdOf["production"] = productionAlertId;
            alertIdOf["staging"] = stagingAlertId;
            alertIdOf["unlabelled"] = unlabelledAlertId;
            noteIdOf["production"] = productionNoteId;
            noteIdOf["staging"] = stagingNoteId;
            noteIdOf["unlabelled"] = unlabelledNoteId;

            if (kind === "user") {
              await setTeamPermissions(
                homeTeamId,
                homeProjectId,
                matrixCase.rows,
              );
              caller = homeUser;
            } else {
              caller = {
                kind: "apiKey",
                apiKey: await createApiKey(matrixCase.rows),
              };
            }
          });

          const expectedIds: (
            idOf: Dictionary<ObjectID>,
            readable: Array<string>,
          ) => Array<string> = (
            idOf: Dictionary<ObjectID>,
            readable: Array<string>,
          ): Array<string> => {
            return sorted(
              readable.map((key: string): ObjectID => {
                return idOf[key]!;
              }),
            );
          };

          test("lists and counts", async () => {
            for (const [path, idOf] of [
              ["/alert", alertIdOf],
              ["/alert-internal-note", noteIdOf],
            ] as Array<[string, Dictionary<ObjectID>]>) {
              const listed: Outcome = await list(path, caller);
              const counted: Outcome = await count(path, caller);

              if (!matrixCase.readable) {
                expectRefused(listed);
                expectRefused(counted);
                continue;
              }

              expect(listed.error).toBeUndefined();
              expect(listed.ids).toEqual(
                expectedIds(idOf, matrixCase.readable),
              );
              expect(listed.count).toBe(matrixCase.readable.length);
              expect(counted.count).toBe(matrixCase.readable.length);
            }
          });

          test("reads by id", async () => {
            for (const [path, idOf] of [
              ["/alert", alertIdOf],
              ["/alert-internal-note", noteIdOf],
            ] as Array<[string, Dictionary<ObjectID>]>) {
              for (const key of ["production", "staging", "unlabelled"]) {
                const read: Outcome = await getItem(path, caller, idOf[key]!);

                if (!matrixCase.readable) {
                  expectRefused(read);
                  continue;
                }

                if (
                  matrixCase.readable.includes(
                    key as "production" | "staging" | "unlabelled",
                  )
                ) {
                  expect(read.item?.id?.toString()).toBe(idOf[key]!.toString());
                } else {
                  expectNotFound(read);
                }
              }
            }
          });

          test("updates", async () => {
            for (const [path, table, idOf, column] of [
              ["/alert", "Alert", alertIdOf, "title"],
              ["/alert-internal-note", "AlertInternalNote", noteIdOf, "note"],
            ] as Array<[string, string, Dictionary<ObjectID>, string]>) {
              for (const key of ["production", "staging", "unlabelled"]) {
                const id: ObjectID = idOf[key]!;
                const before: unknown = await readColumn(table, id, column);
                const value: string = `Changed ${ObjectID.generate().toString()}`;

                const outcome: Outcome = await update(path, caller, id, {
                  [column]: value,
                });

                if (
                  matrixCase.readable &&
                  matrixCase.readable.includes(
                    key as "production" | "staging" | "unlabelled",
                  )
                ) {
                  expect(outcome.error).toBeUndefined();
                  expect(outcome.isEmptySuccess).toBe(true);
                  expect(await readColumn(table, id, column)).toBe(value);
                } else {
                  expectRefused(outcome);
                  expect(await readColumn(table, id, column)).toEqual(before);
                }
              }
            }
          });

          test("deletes", async () => {
            for (const [key, labelIds] of [
              ["production", [productionLabelId]],
              ["staging", [stagingLabelId]],
              ["unlabelled", []],
            ] as Array<[string, Array<ObjectID>]>) {
              const alertId: ObjectID = ObjectID.generate();
              const noteId: ObjectID = ObjectID.generate();

              await insertAlert({
                id: alertId,
                projectId: homeProjectId,
                title: "Disposable alert",
                labelIds: labelIds,
              });
              await insertNote({
                id: noteId,
                projectId: homeProjectId,
                alertId: alertId,
              });

              const isDeletable: boolean = Boolean(
                matrixCase.readable &&
                  matrixCase.readable.includes(
                    key as "production" | "staging" | "unlabelled",
                  ),
              );

              const noteOutcome: Outcome = await remove(
                "/alert-internal-note",
                caller,
                noteId,
              );

              expect(await rowExists("AlertInternalNote", noteId)).toBe(
                !isDeletable,
              );

              const alertOutcome: Outcome = await remove(
                "/alert",
                caller,
                alertId,
              );

              expect(await rowExists("Alert", alertId)).toBe(!isDeletable);

              if (isDeletable) {
                expect(noteOutcome.isEmptySuccess).toBe(true);
                expect(alertOutcome.isEmptySuccess).toBe(true);
              } else {
                expectRefused(noteOutcome);
                expectRefused(alertOutcome);
              }

              await removeRows([
                ["AlertInternalNote", "_id", noteId],
                ["AlertLabel", "alertId", alertId],
                ["Alert", "_id", alertId],
              ]);
            }
          });

          /*
           * A service's update or delete by query - no CRUD route makes one -
           * is narrowed by the same rule as a read: the records left out of
           * the read are left out of the write.
           */
          test("updates and deletes by query", async () => {
            const props: DatabaseCommonInteractionProps = await propsOf(caller);
            const value: string = `Changed ${ObjectID.generate().toString()}`;

            if (!matrixCase.readable) {
              await expect(
                alertService.updateBy({
                  query: { _id: new Includes(homeAlertIds) },
                  data: { title: value },
                  props: props,
                  limit: 50,
                  skip: 0,
                }),
              ).rejects.toThrow(NotAuthorizedException);
              await expect(
                noteService.deleteBy({
                  query: { _id: new Includes(homeNoteIds) },
                  props: props,
                  limit: 50,
                  skip: 0,
                }),
              ).rejects.toThrow(NotAuthorizedException);

              for (const id of homeNoteIds) {
                expect(
                  await rowExists("AlertInternalNote", new ObjectID(id)),
                ).toBe(true);
              }

              return;
            }

            await alertService.updateBy({
              query: { _id: new Includes(homeAlertIds) },
              data: { title: value },
              props: props,
              limit: 50,
              skip: 0,
            });
            await noteService.updateBy({
              query: { _id: new Includes(homeNoteIds) },
              data: { note: value },
              props: props,
              limit: 50,
              skip: 0,
            });

            for (const key of ["production", "staging", "unlabelled"]) {
              const isWritable: boolean = matrixCase.readable.includes(
                key as "production" | "staging" | "unlabelled",
              );

              expect(
                (await readColumn("Alert", alertIdOf[key]!, "title")) === value,
              ).toBe(isWritable);
              expect(
                (await readColumn(
                  "AlertInternalNote",
                  noteIdOf[key]!,
                  "note",
                )) === value,
              ).toBe(isWritable);
            }

            const disposable: Array<{
              key: string;
              alertId: ObjectID;
              noteId: ObjectID;
            }> = [];

            for (const [key, labelIds] of [
              ["production", [productionLabelId]],
              ["staging", [stagingLabelId]],
              ["unlabelled", []],
            ] as Array<[string, Array<ObjectID>]>) {
              const alertId: ObjectID = ObjectID.generate();
              const noteId: ObjectID = ObjectID.generate();

              await insertAlert({
                id: alertId,
                projectId: homeProjectId,
                title: "Disposable alert",
                labelIds: labelIds,
              });
              await insertNote({
                id: noteId,
                projectId: homeProjectId,
                alertId: alertId,
              });

              disposable.push({ key: key, alertId: alertId, noteId: noteId });
            }

            await noteService.deleteBy({
              query: {
                _id: new Includes(
                  disposable.map((row: { noteId: ObjectID }): string => {
                    return row.noteId.toString();
                  }),
                ),
              },
              props: props,
              limit: 50,
              skip: 0,
            });
            await alertService.deleteBy({
              query: {
                _id: new Includes(
                  disposable.map((row: { alertId: ObjectID }): string => {
                    return row.alertId.toString();
                  }),
                ),
              },
              props: props,
              limit: 50,
              skip: 0,
            });

            for (const row of disposable) {
              const isDeletable: boolean = matrixCase.readable.includes(
                row.key as "production" | "staging" | "unlabelled",
              );

              expect(await rowExists("AlertInternalNote", row.noteId)).toBe(
                !isDeletable,
              );
              expect(await rowExists("Alert", row.alertId)).toBe(!isDeletable);

              await removeRows([
                ["AlertInternalNote", "_id", row.noteId],
                ["AlertLabel", "alertId", row.alertId],
                ["Alert", "_id", row.alertId],
              ]);
            }
          });
        },
      );
    },
  );

  /*
   * A RECORD READ THROUGH ITS PARENT (an alert's internal note) is changed
   * and deleted only on a parent the caller may read. A change also keeps
   * to the parents the caller may edit, as it always has; a delete is the
   * note's own permission, whatever the caller may delete of alerts.
   */
  describe("a record read through its parent, changed or deleted", () => {
    test("an announcement is changed when the caller may read one of its status pages and edit one", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        {
          permission: Permission.ReadProjectStatusPage,
          labelIds: [productionLabelId],
        },
        {
          permission: Permission.EditProjectStatusPage,
          labelIds: [stagingLabelId],
        },
        { permission: Permission.ReadStatusPageAnnouncement },
        { permission: Permission.EditStatusPageAnnouncement },
      ]);

      for (const [label, statusPageIds, isChangeable] of [
        ["both pages", [productionStatusPageId, stagingStatusPageId], true],
        ["the page it may read", [productionStatusPageId], false],
        ["the page it may edit", [stagingStatusPageId], false],
        ["no page", [], false],
      ] as Array<[string, Array<ObjectID>, boolean]>) {
        const announcementId: ObjectID = ObjectID.generate();

        await insert("StatusPageAnnouncement", {
          _id: announcementId,
          projectId: homeProjectId,
          title: "Disposable announcement",
          description: "Disposable announcement",
          showAnnouncementAt: new Date(),
          version: 1,
        });

        for (const statusPageId of statusPageIds) {
          await insert("AnnouncementStatusPage", {
            announcementId: announcementId,
            statusPageId: statusPageId,
          });
        }

        const value: string = `Changed ${ObjectID.generate().toString()}`;

        await update("/status-page-announcement", homeUser, announcementId, {
          title: value,
        });

        expect([
          label,
          await readColumn("StatusPageAnnouncement", announcementId, "title"),
        ]).toEqual([label, isChangeable ? value : "Disposable announcement"]);

        await removeRows([
          ["AnnouncementStatusPage", "announcementId", announcementId],
          ["StatusPageAnnouncement", "_id", announcementId],
        ]);
      }
    });

    test.each([
      [
        "the alert's edit grants limited to a label",
        [
          { permission: Permission.ReadAlert },
          { permission: Permission.EditAlert, labelIds: [productionLabelId] },
          { permission: Permission.ReadAlertInternalNote },
          { permission: Permission.EditAlertInternalNote },
        ],
        [
          ["staging", false],
          ["production", true],
        ],
      ],
      [
        "the alert's read grants limited to a label",
        [
          { permission: Permission.ReadAlert, labelIds: [productionLabelId] },
          { permission: Permission.ReadAlertInternalNote },
          { permission: Permission.EditAlertInternalNote },
        ],
        [
          ["staging", false],
          ["production", true],
        ],
      ],
      [
        "the alert's read and edit grants limited to different labels",
        [
          { permission: Permission.ReadAlert, labelIds: [productionLabelId] },
          { permission: Permission.EditAlert, labelIds: [stagingLabelId] },
          { permission: Permission.ReadAlertInternalNote },
          { permission: Permission.EditAlertInternalNote },
        ],
        [
          ["staging", false],
          ["production", false],
          ["both", true],
        ],
      ],
    ] as Array<[string, Array<PermissionRow>, Array<[string, boolean]>]>)(
      "a note is changed under %s only on an alert the caller may read and edit",
      async (
        _label: string,
        rows: Array<PermissionRow>,
        cases: Array<[string, boolean]>,
      ) => {
        await setTeamPermissions(homeTeamId, homeProjectId, rows);

        const labelsOf: Dictionary<Array<ObjectID>> = {
          production: [productionLabelId],
          staging: [stagingLabelId],
          both: [productionLabelId, stagingLabelId],
        };

        for (const [alertLabels, isChangeable] of cases) {
          const alertId: ObjectID = ObjectID.generate();
          const noteId: ObjectID = ObjectID.generate();

          await insertAlert({
            id: alertId,
            projectId: homeProjectId,
            title: "Disposable alert",
            labelIds: labelsOf[alertLabels]!,
          });
          await insertNote({
            id: noteId,
            projectId: homeProjectId,
            alertId: alertId,
          });

          const before: unknown = await readColumn(
            "AlertInternalNote",
            noteId,
            "note",
          );
          const value: string = `Changed ${ObjectID.generate().toString()}`;

          const outcome: Outcome = await update(
            "/alert-internal-note",
            homeUser,
            noteId,
            { note: value },
          );

          expect([
            alertLabels,
            await readColumn("AlertInternalNote", noteId, "note"),
          ]).toEqual([alertLabels, isChangeable ? value : before]);

          if (isChangeable) {
            expect(outcome.error).toBeUndefined();
          }

          await removeRows([
            ["AlertInternalNote", "_id", noteId],
            ["AlertLabel", "alertId", alertId],
            ["Alert", "_id", alertId],
          ]);
        }
      },
    );

    test.each([
      [
        "the alert's delete grants limited to another label",
        [
          { permission: Permission.ReadAlert },
          { permission: Permission.DeleteAlert, labelIds: [productionLabelId] },
          { permission: Permission.ReadAlertInternalNote },
          { permission: Permission.DeleteAlertInternalNote },
        ],
        true,
      ],
      [
        "the alert's read grants limited to another label",
        [
          { permission: Permission.ReadAlert, labelIds: [productionLabelId] },
          { permission: Permission.ReadAlertInternalNote },
          { permission: Permission.DeleteAlertInternalNote },
        ],
        false,
      ],
    ] as Array<[string, Array<PermissionRow>, boolean]>)(
      "a note of a staging alert, under %s",
      async (
        _label: string,
        rows: Array<PermissionRow>,
        isDeletable: boolean,
      ) => {
        await setTeamPermissions(homeTeamId, homeProjectId, rows);

        const alertId: ObjectID = ObjectID.generate();
        const noteId: ObjectID = ObjectID.generate();

        await insertAlert({
          id: alertId,
          projectId: homeProjectId,
          title: "Disposable alert",
          labelIds: [stagingLabelId],
        });
        await insertNote({
          id: noteId,
          projectId: homeProjectId,
          alertId: alertId,
        });

        const outcome: Outcome = await remove(
          "/alert-internal-note",
          homeUser,
          noteId,
        );

        expect(await rowExists("AlertInternalNote", noteId)).toBe(!isDeletable);

        if (isDeletable) {
          expect(outcome.isEmptySuccess).toBe(true);
        } else {
          // A note of an alert the caller may not read: answered as missing.
          expect(outcome.error).toBeInstanceOf(NotFoundException);
        }

        await removeRows([
          ["AlertInternalNote", "_id", noteId],
          ["AlertLabel", "alertId", alertId],
          ["Alert", "_id", alertId],
        ]);
      },
    );
  });

  /*
   * A RECORD READ THROUGH A PARENT ITS CALLER OWNS. When the caller's
   * grants to read the parent reach only the parents they or their teams
   * own, the records read through a parent are those of the owned parents
   * - whatever the scope of the permission for the records themselves -
   * for listing, counting, reading, changing and deleting alike. The member
   * owns the staging alert, and the staging status page here.
   */
  describe("a record read through a parent its caller owns", () => {
    const stagingPageOwnerId: ObjectID = ObjectID.generate();

    beforeAll(async () => {
      await insert("StatusPageOwnerUser", {
        _id: stagingPageOwnerId,
        projectId: homeProjectId,
        userId: memberId,
        statusPageId: stagingStatusPageId,
        version: 1,
      });
    });

    afterAll(async () => {
      await removeRows([["StatusPageOwnerUser", "_id", stagingPageOwnerId]]);
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
      ]);
    });

    test.each([
      ["over the project", undefined],
      ["limited to owned records too", PermissionScope.Owned],
    ] as Array<[string, PermissionScope | undefined]>)(
      "the notes of the owned alerts only, with the note permissions granted %s",
      async (_label: string, noteScope: PermissionScope | undefined) => {
        await setTeamPermissions(homeTeamId, homeProjectId, [
          { permission: Permission.ReadAlert, scope: PermissionScope.Owned },
          ...[
            Permission.ReadAlertInternalNote,
            Permission.EditAlertInternalNote,
            Permission.DeleteAlertInternalNote,
          ].map((permission: Permission): PermissionRow => {
            return {
              permission: permission,
              ...(noteScope ? { scope: noteScope } : {}),
            };
          }),
        ]);

        const listed: Outcome = await list("/alert-internal-note", homeUser);

        expect(listed.error).toBeUndefined();
        expect(listed.ids).toEqual([stagingNoteId.toString()]);
        expect(listed.count).toBe(1);
        expect((await count("/alert-internal-note", homeUser)).count).toBe(1);

        // The alerts themselves keep to the owned one, as before.
        expect((await list("/alert", homeUser)).ids).toEqual([
          stagingAlertId.toString(),
        ]);

        expect(
          (
            await getItem("/alert-internal-note", homeUser, stagingNoteId)
          ).item?.id?.toString(),
        ).toBe(stagingNoteId.toString());

        for (const noteId of [productionNoteId, unlabelledNoteId]) {
          expectNotFound(
            await getItem("/alert-internal-note", homeUser, noteId),
          );

          const before: unknown = await readColumn(
            "AlertInternalNote",
            noteId,
            "note",
          );
          const outcome: Outcome = await update(
            "/alert-internal-note",
            homeUser,
            noteId,
            { note: `Changed ${ObjectID.generate().toString()}` },
          );

          // A note of an alert the caller may not read: answered as missing.
          expect(outcome.error).toBeInstanceOf(NotFoundException);
          expect(await readColumn("AlertInternalNote", noteId, "note")).toEqual(
            before,
          );
        }

        const value: string = `Changed ${ObjectID.generate().toString()}`;
        const changed: Outcome = await update(
          "/alert-internal-note",
          homeUser,
          stagingNoteId,
          { note: value },
        );

        expect(changed.error).toBeUndefined();
        expect(changed.isEmptySuccess).toBe(true);
        expect(
          await readColumn("AlertInternalNote", stagingNoteId, "note"),
        ).toBe(value);
      },
    );

    test("a note is deleted only on an alert the caller owns", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.ReadAlert, scope: PermissionScope.Owned },
        { permission: Permission.ReadAlertInternalNote },
        { permission: Permission.DeleteAlertInternalNote },
      ]);

      for (const [label, isOwned] of [
        ["an owned alert", true],
        ["an alert somebody else owns", false],
      ] as Array<[string, boolean]>) {
        const alertId: ObjectID = ObjectID.generate();
        const noteId: ObjectID = ObjectID.generate();
        const ownerId: ObjectID = ObjectID.generate();

        await insertAlert({
          id: alertId,
          projectId: homeProjectId,
          title: "Disposable alert",
        });
        await insertNote({
          id: noteId,
          projectId: homeProjectId,
          alertId: alertId,
        });
        await insert("AlertOwnerUser", {
          _id: ownerId,
          projectId: homeProjectId,
          userId: isOwned ? memberId : outsiderId,
          alertId: alertId,
          version: 1,
        });

        const outcome: Outcome = await remove(
          "/alert-internal-note",
          homeUser,
          noteId,
        );

        expect([label, await rowExists("AlertInternalNote", noteId)]).toEqual([
          label,
          !isOwned,
        ]);

        if (isOwned) {
          expect(outcome.isEmptySuccess).toBe(true);
        } else {
          expect(outcome.error).toBeInstanceOf(NotFoundException);
        }

        await removeRows([
          ["AlertOwnerUser", "_id", ownerId],
          ["AlertInternalNote", "_id", noteId],
          ["Alert", "_id", alertId],
        ]);
      }
    });

    test("a service's update by query keeps to the notes of owned alerts", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.ReadAlert, scope: PermissionScope.Owned },
        { permission: Permission.ReadAlertInternalNote },
        { permission: Permission.EditAlertInternalNote },
      ]);

      const props: DatabaseCommonInteractionProps = await propsOf(homeUser);
      const value: string = `Changed ${ObjectID.generate().toString()}`;

      await noteService.updateBy({
        query: { _id: new Includes(homeNoteIds) },
        data: { note: value },
        props: props,
        limit: 50,
        skip: 0,
      });

      for (const [noteId, isOwned] of [
        [productionNoteId, false],
        [stagingNoteId, true],
        [unlabelledNoteId, false],
      ] as Array<[ObjectID, boolean]>) {
        expect([
          noteId.toString(),
          (await readColumn("AlertInternalNote", noteId, "note")) === value,
        ]).toEqual([noteId.toString(), isOwned]);
      }
    });

    /*
     * A status page's announcements are linked to their status pages
     * through a join table: an announcement is reached when one of its
     * status pages is one the caller owns.
     */
    test("the announcements of the owned status pages only", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        {
          permission: Permission.ReadProjectStatusPage,
          scope: PermissionScope.Owned,
        },
        { permission: Permission.ReadStatusPageAnnouncement },
        { permission: Permission.EditStatusPageAnnouncement },
      ]);

      const expected: Array<string> = sorted([
        stagingAnnouncementId,
        bothPagesAnnouncementId,
      ]);

      const listed: Outcome = await list("/status-page-announcement", homeUser);

      expect(listed.error).toBeUndefined();
      expect(listed.ids).toEqual(expected);
      expect(listed.count).toBe(expected.length);

      for (const announcementId of [
        productionAnnouncementId,
        noPageAnnouncementId,
      ]) {
        expectNotFound(
          await getItem("/status-page-announcement", homeUser, announcementId),
        );

        const outcome: Outcome = await update(
          "/status-page-announcement",
          homeUser,
          announcementId,
          { title: `Changed ${ObjectID.generate().toString()}` },
        );

        expect(outcome.error).toBeInstanceOf(NotFoundException);
        expect(
          await readColumn("StatusPageAnnouncement", announcementId, "title"),
        ).toBe("Synthetic announcement");
      }

      const value: string = `Changed ${ObjectID.generate().toString()}`;
      const changed: Outcome = await update(
        "/status-page-announcement",
        homeUser,
        stagingAnnouncementId,
        { title: value },
      );

      expect(changed.error).toBeUndefined();
      expect(
        await readColumn(
          "StatusPageAnnouncement",
          stagingAnnouncementId,
          "title",
        ),
      ).toBe(value);

      await database.query(
        `UPDATE "${schema}"."StatusPageAnnouncement" SET "title" = 'Synthetic announcement' WHERE "_id" = $1`,
        [stagingAnnouncementId.toString()],
      );
    });

    test("a grant over the project on the status pages reaches every announcement", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.ReadProjectStatusPage },
        { permission: Permission.ReadStatusPageAnnouncement },
      ]);

      const listed: Outcome = await list("/status-page-announcement", homeUser);

      expect(listed.error).toBeUndefined();
      expect(listed.ids).toEqual(
        sorted([
          productionAnnouncementId,
          stagingAnnouncementId,
          bothPagesAnnouncementId,
          noPageAnnouncementId,
        ]),
      );
    });
  });

  /*
   * A WRITE NEEDS A READ, through the CRUD routes, for a member's team and
   * an API key alike:
   *
   *   - a permission on an alert's notes without any permission on alerts
   *     reaches no note: reading, changing and deleting are all refused;
   *   - an edit or a delete broader than the read stops at what the caller
   *     may read, on alerts and on the notes read through them;
   *   - a write by id that reaches no record says so: as a missing record
   *     (404) when the caller may not read it - or it is not there - and as
   *     a refusal when they may read it but not change it;
   *   - an update or a delete by query keeps answering with how many rows
   *     it changed.
   */
  describe.each([
    ["a member's team", "user"],
    ["an API key", "apiKey"],
  ] as Array<[string, "user" | "apiKey"]>)(
    "a write needs a read, on %s",
    (_label: string, kind: "user" | "apiKey") => {
      const callerWith: (
        rows: Array<PermissionRow>,
      ) => Promise<Caller> = async (
        rows: Array<PermissionRow>,
      ): Promise<Caller> => {
        if (kind === "user") {
          await setTeamPermissions(homeTeamId, homeProjectId, rows);
          return homeUser;
        }

        return { kind: "apiKey", apiKey: await createApiKey(rows) };
      };

      afterAll(async () => {
        await setTeamPermissions(homeTeamId, homeProjectId, [
          { permission: Permission.AlertMember },
        ]);
      });

      // A disposable alert carrying these labels, with one note.
      const disposableAlertWithNote: (
        labelIds: Array<ObjectID>,
      ) => Promise<{ alertId: ObjectID; noteId: ObjectID }> = async (
        labelIds: Array<ObjectID>,
      ): Promise<{ alertId: ObjectID; noteId: ObjectID }> => {
        const alertId: ObjectID = ObjectID.generate();
        const noteId: ObjectID = ObjectID.generate();

        await insertAlert({
          id: alertId,
          projectId: homeProjectId,
          title: "Disposable alert",
          labelIds: labelIds,
        });
        await insertNote({
          id: noteId,
          projectId: homeProjectId,
          alertId: alertId,
        });

        return { alertId: alertId, noteId: noteId };
      };

      const removeDisposable: (rows: {
        alertId: ObjectID;
        noteId: ObjectID;
      }) => Promise<void> = async (rows: {
        alertId: ObjectID;
        noteId: ObjectID;
      }): Promise<void> => {
        await removeRows([
          ["AlertInternalNote", "_id", rows.noteId],
          ["AlertLabel", "alertId", rows.alertId],
          ["Alert", "_id", rows.alertId],
        ]);
      };

      const expectAnsweredAsMissing: (outcome: Outcome) => void = (
        outcome: Outcome,
      ): void => {
        expect(outcome.error).toBeInstanceOf(NotFoundException);
        expect(outcome.isEmptySuccess).toBeUndefined();
      };

      test("a permission on notes without any permission on alerts reaches no note", async () => {
        const caller: Caller = await callerWith([
          { permission: Permission.ReadAlertInternalNote },
          { permission: Permission.EditAlertInternalNote },
          { permission: Permission.DeleteAlertInternalNote },
        ]);

        const listed: Outcome = await list("/alert-internal-note", caller);

        expectRefused(listed);
        expect((listed.error as Exception).message).toContain(
          "It is read through its Alert",
        );
        expectRefused(await count("/alert-internal-note", caller));

        for (const noteId of [
          productionNoteId,
          stagingNoteId,
          unlabelledNoteId,
        ]) {
          expectRefused(await getItem("/alert-internal-note", caller, noteId));

          const before: unknown = await readColumn(
            "AlertInternalNote",
            noteId,
            "note",
          );

          expectRefused(
            await update("/alert-internal-note", caller, noteId, {
              note: `Changed ${ObjectID.generate().toString()}`,
            }),
          );
          expect(await readColumn("AlertInternalNote", noteId, "note")).toEqual(
            before,
          );
        }

        const disposable: { alertId: ObjectID; noteId: ObjectID } =
          await disposableAlertWithNote([]);

        expectRefused(
          await remove("/alert-internal-note", caller, disposable.noteId),
        );
        expect(await rowExists("AlertInternalNote", disposable.noteId)).toBe(
          true,
        );

        // Nor by query: a service's update or delete is refused the same way.
        const props: DatabaseCommonInteractionProps = await propsOf(caller);

        await expect(
          noteService.deleteBy({
            query: { _id: disposable.noteId.toString() },
            props: props,
            limit: 1,
            skip: 0,
          }),
        ).rejects.toThrow("It is read through its Alert");
        expect(await rowExists("AlertInternalNote", disposable.noteId)).toBe(
          true,
        );

        await removeDisposable(disposable);
      });

      test("the notes come back with a permission on alerts", async () => {
        const caller: Caller = await callerWith([
          { permission: Permission.ReadAlert },
          { permission: Permission.ReadAlertInternalNote },
        ]);

        const listed: Outcome = await list("/alert-internal-note", caller);

        expect(listed.error).toBeUndefined();
        expect(listed.ids).toEqual(sorted(homeNoteIds));
      });

      test("an edit broader than the read changes only the alerts and notes the caller may read", async () => {
        const caller: Caller = await callerWith([
          { permission: Permission.ReadAlert, labelIds: [productionLabelId] },
          { permission: Permission.EditAlert },
          { permission: Permission.ReadAlertInternalNote },
          { permission: Permission.EditAlertInternalNote },
        ]);

        for (const [path, table, id, column, isWritable] of [
          ["/alert", "Alert", productionAlertId, "title", true],
          ["/alert", "Alert", stagingAlertId, "title", false],
          ["/alert", "Alert", unlabelledAlertId, "title", false],
          [
            "/alert-internal-note",
            "AlertInternalNote",
            productionNoteId,
            "note",
            true,
          ],
          [
            "/alert-internal-note",
            "AlertInternalNote",
            stagingNoteId,
            "note",
            false,
          ],
          [
            "/alert-internal-note",
            "AlertInternalNote",
            unlabelledNoteId,
            "note",
            false,
          ],
        ] as Array<[string, string, ObjectID, string, boolean]>) {
          const before: unknown = await readColumn(table, id, column);
          const value: string = `Changed ${ObjectID.generate().toString()}`;

          const outcome: Outcome = await update(path, caller, id, {
            [column]: value,
          });

          if (isWritable) {
            expect(outcome.error).toBeUndefined();
            expect(outcome.isEmptySuccess).toBe(true);
            expect(await readColumn(table, id, column)).toBe(value);
          } else {
            // A record the caller may not read is answered as missing.
            expectAnsweredAsMissing(outcome);
            expect(await readColumn(table, id, column)).toEqual(before);
          }
        }
      });

      test("a delete broader than the read deletes only the alerts and notes the caller may read", async () => {
        const caller: Caller = await callerWith([
          { permission: Permission.ReadAlert, labelIds: [productionLabelId] },
          { permission: Permission.DeleteAlert },
          { permission: Permission.ReadAlertInternalNote },
          { permission: Permission.DeleteAlertInternalNote },
        ]);

        for (const [labelIds, isDeletable] of [
          [[productionLabelId], true],
          [[stagingLabelId], false],
          [[], false],
        ] as Array<[Array<ObjectID>, boolean]>) {
          const disposable: { alertId: ObjectID; noteId: ObjectID } =
            await disposableAlertWithNote(labelIds);

          const noteOutcome: Outcome = await remove(
            "/alert-internal-note",
            caller,
            disposable.noteId,
          );
          const alertOutcome: Outcome = await remove(
            "/alert",
            caller,
            disposable.alertId,
          );

          expect(await rowExists("AlertInternalNote", disposable.noteId)).toBe(
            !isDeletable,
          );
          expect(await rowExists("Alert", disposable.alertId)).toBe(
            !isDeletable,
          );

          if (isDeletable) {
            expect(noteOutcome.isEmptySuccess).toBe(true);
            expect(alertOutcome.isEmptySuccess).toBe(true);
          } else {
            expectAnsweredAsMissing(noteOutcome);
            expectAnsweredAsMissing(alertOutcome);
          }

          await removeDisposable(disposable);
        }
      });

      test("a record the caller may read but not change is refused, not answered as missing", async () => {
        const caller: Caller = await callerWith([
          { permission: Permission.ReadAlert },
          { permission: Permission.EditAlert, labelIds: [productionLabelId] },
          { permission: Permission.DeleteAlert, labelIds: [productionLabelId] },
          { permission: Permission.ReadAlertInternalNote },
          {
            permission: Permission.EditAlertInternalNote,
            labelIds: [productionLabelId],
          },
          {
            permission: Permission.DeleteAlertInternalNote,
            labelIds: [productionLabelId],
          },
        ]);

        for (const [path, id] of [
          ["/alert", stagingAlertId],
          ["/alert-internal-note", stagingNoteId],
        ] as Array<[string, ObjectID]>) {
          for (const outcome of [
            await update(path, caller, id, {
              [path === "/alert" ? "title" : "note"]: "Changed",
            }),
            await remove(path, caller, id),
          ]) {
            expectRefused(outcome);
            expect(outcome.error).toBeInstanceOf(NotAuthorizedException);
          }
        }

        expect(await rowExists("Alert", stagingAlertId)).toBe(true);
        expect(await rowExists("AlertInternalNote", stagingNoteId)).toBe(true);
      });

      test("a write by id of a record that is not there answers 404", async () => {
        const caller: Caller = await callerWith([
          { permission: Permission.AlertMember },
        ]);

        for (const path of ["/alert", "/alert-internal-note"]) {
          const missingId: ObjectID = ObjectID.generate();

          expectAnsweredAsMissing(
            await update(path, caller, missingId, {
              [path === "/alert" ? "title" : "note"]: "Changed",
            }),
          );
          expectAnsweredAsMissing(await remove(path, caller, missingId));
        }
      });

      test("an update or a delete by query keeps answering with how many rows it changed", async () => {
        const caller: Caller = await callerWith([
          { permission: Permission.ReadAlert, labelIds: [productionLabelId] },
          { permission: Permission.EditAlert },
          { permission: Permission.DeleteAlert },
        ]);
        const props: DatabaseCommonInteractionProps = await propsOf(caller);

        const updated: number = await alertService.updateBy({
          query: { _id: new Includes(homeAlertIds) },
          data: { title: `Changed ${ObjectID.generate().toString()}` },
          props: props,
          limit: 50,
          skip: 0,
        });

        expect(updated).toBe(1);

        const disposable: Array<{ alertId: ObjectID; noteId: ObjectID }> = [
          await disposableAlertWithNote([productionLabelId]),
          await disposableAlertWithNote([stagingLabelId]),
        ];

        const deleted: number = await alertService.deleteBy({
          query: {
            _id: new Includes(
              disposable.map((rows: { alertId: ObjectID }): string => {
                return rows.alertId.toString();
              }),
            ),
          },
          props: props,
          limit: 50,
          skip: 0,
        });

        expect(deleted).toBe(1);
        expect(await rowExists("Alert", disposable[0]!.alertId)).toBe(false);
        expect(await rowExists("Alert", disposable[1]!.alertId)).toBe(true);

        for (const rows of disposable) {
          await removeDisposable(rows);
        }
      });
    },
  );

  /*
   * A RECORD READ THROUGH A PARENT IS CREATED ONLY UNDER A PARENT ITS
   * CREATOR MAY READ (CreatePermission.checkParentPermission): through the
   * create route, the parent a note or an announcement names - by its key
   * under either name, or through the announcement's join table - is one a
   * read of the parent's table finds for the caller, or the create is
   * refused like one naming a record that does not exist, and nothing is
   * written.
   */
  describe("a record read through a parent, created", () => {
    // What the records this block creates begin with, to clear them after.
    const CREATED_NOTE_MARKER: string = "Created under a parent";

    const NOTE_PERMISSIONS: Array<PermissionRow> = [
      { permission: Permission.CreateAlertInternalNote },
      { permission: Permission.ReadAlertInternalNote },
    ];

    const ANNOUNCEMENT_PERMISSIONS: Array<PermissionRow> = [
      { permission: Permission.CreateStatusPageAnnouncement },
      { permission: Permission.ReadStatusPageAnnouncement },
    ];

    // The member owns the staging alert and no other (see the setup above).

    afterAll(async () => {
      await database.query(
        `DELETE FROM "${schema}"."AlertInternalNote" WHERE "note" LIKE $1`,
        [`${CREATED_NOTE_MARKER}%`],
      );
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
      ]);
    });

    // A note's text: findable afterwards whether or not it was written.
    const noteText: () => string = (): string => {
      return `${CREATED_NOTE_MARKER} ${ObjectID.generate().toString()}`;
    };

    const notesWithText: (text: string) => Promise<number> = async (
      text: string,
    ): Promise<number> => {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*) AS "count" FROM "${schema}"."AlertInternalNote" WHERE "note" = $1`,
        [text],
      );

      return Number(rows[0]?.count || 0);
    };

    const createNote: (
      caller: Caller,
      parent: JSONObject,
      text: string,
    ) => Promise<Outcome> = async (
      caller: Caller,
      parent: JSONObject,
      text: string,
    ): Promise<Outcome> => {
      return await send({
        uri: "/alert-internal-note",
        caller: caller,
        body: {
          data: JSONFunctions.serialize({ ...parent, note: text }),
        },
      });
    };

    // The refusal of a parent the caller may not read: that of a missing one.
    const expectRefusedAsMissing: (
      outcome: Outcome,
      field: string,
      id: ObjectID,
    ) => void = (outcome: Outcome, field: string, id: ObjectID): void => {
      expect(outcome.error).toBeInstanceOf(BadDataException);
      expect((outcome.error as Error).message).toContain(
        `references records that are not in this project: ${field} "${id.toString()}".`,
      );
      expect(outcome.item).toBeUndefined();
    };

    describe.each([
      ["a team member", "team"],
      ["an API key", "apiKey"],
    ] as Array<[string, "team" | "apiKey"]>)(
      "%s whose read of alerts is limited to a label",
      (_name: string, kind: "team" | "apiKey") => {
        const callerWith: (
          rows: Array<PermissionRow>,
        ) => Promise<Caller> = async (
          rows: Array<PermissionRow>,
        ): Promise<Caller> => {
          if (kind === "team") {
            await setTeamPermissions(homeTeamId, homeProjectId, rows);
            return homeUser;
          }

          return { kind: "apiKey", apiKey: await createApiKey(rows) };
        };

        test.each([
          ["by its ID column", "alertId"],
          ["by its relation", "alert"],
        ])(
          "creates a note on an alert carrying the label, named %s, and nowhere else",
          async (_naming: string, name: string) => {
            const caller: Caller = await callerWith([
              {
                permission: Permission.ReadAlert,
                labelIds: [productionLabelId],
              },
              ...NOTE_PERMISSIONS,
            ]);

            const named: (alertId: ObjectID) => JSONObject = (
              alertId: ObjectID,
            ): JSONObject => {
              return name === "alertId"
                ? { alertId: alertId }
                : { alert: { _id: alertId.toString() } };
            };

            const text: string = noteText();
            const created: Outcome = await createNote(
              caller,
              named(productionAlertId),
              text,
            );

            expect(created.error).toBeUndefined();
            expect(created.item?.id).toBeDefined();
            expect(await notesWithText(text)).toBe(1);

            for (const alertId of [
              stagingAlertId,
              unlabelledAlertId,
              // Another project's alert reads exactly like a missing one.
              otherLabelledAlertId,
              ObjectID.generate(),
            ]) {
              const refusedText: string = noteText();
              const refused: Outcome = await createNote(
                caller,
                named(alertId),
                refusedText,
              );

              expectRefusedAsMissing(refused, "Alert", alertId);
              expect(await notesWithText(refusedText)).toBe(0);
            }
          },
        );
      },
    );

    test("the two names of the parent must agree", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.ReadAlert, labelIds: [productionLabelId] },
        ...NOTE_PERMISSIONS,
      ]);

      const text: string = noteText();
      const refused: Outcome = await createNote(
        homeUser,
        {
          alertId: productionAlertId,
          alert: { _id: stagingAlertId.toString() },
        },
        text,
      );

      expect(refused.error).toBeInstanceOf(BadDataException);
      expect(await notesWithText(text)).toBe(0);
    });

    test("a member whose read of alerts reaches only what they own creates notes on owned alerts only", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.ReadAlert, scope: PermissionScope.Owned },
        ...NOTE_PERMISSIONS,
      ]);

      const text: string = noteText();
      const created: Outcome = await createNote(
        homeUser,
        { alertId: stagingAlertId },
        text,
      );

      expect(created.error).toBeUndefined();
      expect(await notesWithText(text)).toBe(1);

      for (const alertId of [productionAlertId, unlabelledAlertId]) {
        const refusedText: string = noteText();
        const refused: Outcome = await createNote(
          homeUser,
          { alertId: alertId },
          refusedText,
        );

        expectRefusedAsMissing(refused, "Alert", alertId);
        expect(await notesWithText(refusedText)).toBe(0);
      }
    });

    test("a block with labels on reading alerts leaves out the alerts carrying them", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.ReadAlert },
        {
          permission: Permission.ReadAlert,
          isBlock: true,
          labelIds: [stagingLabelId],
        },
        ...NOTE_PERMISSIONS,
      ]);

      for (const alertId of [productionAlertId, unlabelledAlertId]) {
        const text: string = noteText();
        const created: Outcome = await createNote(
          homeUser,
          { alertId: alertId },
          text,
        );

        expect(created.error).toBeUndefined();
        expect(await notesWithText(text)).toBe(1);
      }

      const refusedText: string = noteText();
      const refused: Outcome = await createNote(
        homeUser,
        { alertId: stagingAlertId },
        refusedText,
      );

      expectRefusedAsMissing(refused, "Alert", stagingAlertId);
      expect(await notesWithText(refusedText)).toBe(0);
    });

    test("a member who reads every alert creates notes on any of the project's alerts", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
      ]);

      for (const alertId of [
        productionAlertId,
        stagingAlertId,
        unlabelledAlertId,
      ]) {
        const text: string = noteText();
        const created: Outcome = await createNote(
          homeUser,
          { alertId: alertId },
          text,
        );

        expect(created.error).toBeUndefined();
        expect(await notesWithText(text)).toBe(1);
      }
    });

    test("a private alert takes notes from the people it names and from who sees every private alert", async () => {
      // A member who reads every alert, on alerts marked private.
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
      ]);
      await database.query(
        `UPDATE "${schema}"."Alert" SET "isPrivate" = true WHERE "_id" IN ($1, $2)`,
        [stagingAlertId.toString(), productionAlertId.toString()],
      );

      try {
        // The member owns the staging alert, so it names them.
        const text: string = noteText();
        const created: Outcome = await createNote(
          homeUser,
          { alertId: stagingAlertId },
          text,
        );

        expect(created.error).toBeUndefined();
        expect(await notesWithText(text)).toBe(1);

        // The production alert names nobody they are: it reads like a missing one.
        const refusedText: string = noteText();
        const refused: Outcome = await createNote(
          homeUser,
          { alertId: productionAlertId },
          refusedText,
        );

        expectRefusedAsMissing(refused, "Alert", productionAlertId);
        expect(await notesWithText(refusedText)).toBe(0);

        // A project admin sees every private alert.
        await setTeamPermissions(homeTeamId, homeProjectId, [
          { permission: Permission.ProjectAdmin },
        ]);

        const adminText: string = noteText();
        const adminCreated: Outcome = await createNote(
          homeUser,
          { alertId: productionAlertId },
          adminText,
        );

        expect(adminCreated.error).toBeUndefined();
        expect(await notesWithText(adminText)).toBe(1);
      } finally {
        await database.query(
          `UPDATE "${schema}"."Alert" SET "isPrivate" = false WHERE "_id" IN ($1, $2)`,
          [stagingAlertId.toString(), productionAlertId.toString()],
        );
      }
    });

    test("a member who may read no alert creates no note, and is told what to ask for", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, NOTE_PERMISSIONS);

      const text: string = noteText();
      const refused: Outcome = await createNote(
        homeUser,
        { alertId: productionAlertId },
        text,
      );

      expect(refused.error).toBeInstanceOf(NotAuthorizedException);
      expect((refused.error as Error).message).toContain(
        "It is read through its Alert, and you need one of these permissions to read Alerts:",
      );
      expect(await notesWithText(text)).toBe(0);
    });

    describe("an announcement, through its status pages", () => {
      const announcementsWithTitle: (title: string) => Promise<number> = async (
        title: string,
      ): Promise<number> => {
        const rows: Array<{ count: string }> = await database.query(
          `SELECT COUNT(*) AS "count" FROM "${schema}"."StatusPageAnnouncement" WHERE "title" = $1`,
          [title],
        );

        return Number(rows[0]?.count || 0);
      };

      const createAnnouncement: (
        statusPageIds: Array<ObjectID>,
        title: string,
      ) => Promise<Outcome> = async (
        statusPageIds: Array<ObjectID>,
        title: string,
      ): Promise<Outcome> => {
        return await send({
          uri: "/status-page-announcement",
          caller: homeUser,
          body: {
            data: JSONFunctions.serialize({
              title: title,
              description: "Synthetic announcement",
              showAnnouncementAt: new Date(),
              statusPages: statusPageIds.map(
                (statusPageId: ObjectID): JSONObject => {
                  return { _id: statusPageId.toString() };
                },
              ),
            }),
          },
        });
      };

      afterAll(async () => {
        const rows: Array<{ _id: string }> = await database.query(
          `SELECT "_id" FROM "${schema}"."StatusPageAnnouncement" WHERE "title" LIKE $1`,
          [`${CREATED_NOTE_MARKER}%`],
        );

        for (const createdRow of rows) {
          await removeRows([
            [
              "AnnouncementStatusPage",
              "announcementId",
              new ObjectID(createdRow._id),
            ],
            ["StatusPageAnnouncement", "_id", new ObjectID(createdRow._id)],
          ]);
        }
      });

      test("is created only on status pages the caller may read, each of them", async () => {
        await setTeamPermissions(homeTeamId, homeProjectId, [
          {
            permission: Permission.ReadProjectStatusPage,
            labelIds: [productionLabelId],
          },
          ...ANNOUNCEMENT_PERMISSIONS,
        ]);

        const title: string = noteText();
        const created: Outcome = await createAnnouncement(
          [productionStatusPageId],
          title,
        );

        expect(created.error).toBeUndefined();
        expect(await announcementsWithTitle(title)).toBe(1);

        for (const statusPageIds of [
          [stagingStatusPageId],
          // One page it may read does not carry a page it may not.
          [productionStatusPageId, stagingStatusPageId],
        ]) {
          const refusedTitle: string = noteText();
          const refused: Outcome = await createAnnouncement(
            statusPageIds,
            refusedTitle,
          );

          expectRefusedAsMissing(refused, "Status Pages", stagingStatusPageId);
          expect(await announcementsWithTitle(refusedTitle)).toBe(0);
        }
      });

      test("on no status page, only by a caller whose read reaches every page", async () => {
        await setTeamPermissions(homeTeamId, homeProjectId, [
          {
            permission: Permission.ReadProjectStatusPage,
            labelIds: [productionLabelId],
          },
          ...ANNOUNCEMENT_PERMISSIONS,
        ]);

        const refusedTitle: string = noteText();
        const refused: Outcome = await createAnnouncement([], refusedTitle);

        expect(refused.error).toBeInstanceOf(NotAuthorizedException);
        expect((refused.error as Error).message).toBe(
          "A Status Page Announcement you create must belong to a Status Page you can read: your access to Status Pages covers only some of them.",
        );
        expect(await announcementsWithTitle(refusedTitle)).toBe(0);

        await setTeamPermissions(homeTeamId, homeProjectId, [
          { permission: Permission.ReadProjectStatusPage },
          ...ANNOUNCEMENT_PERMISSIONS,
        ]);

        const title: string = noteText();
        const created: Outcome = await createAnnouncement([], title);

        expect(created.error).toBeUndefined();
        expect(await announcementsWithTitle(title)).toBe(1);
      });
    });
  });

  /*
   * A RECORD'S PARENTS AND THE RECORDS IT LISTS FOLLOW ITS EDITOR'S READ ON
   * AN UPDATE TOO, AND A CREATE STAYS WITHIN ITS CREATE PERMISSION.
   */
  describe("a record moved to another parent by an update", () => {
    const ANNOUNCEMENT_EDITOR: Array<PermissionRow> = [
      { permission: Permission.EditStatusPageAnnouncement },
      { permission: Permission.ReadStatusPageAnnouncement },
    ];

    // The status pages each announcement is on before this block.
    const PAGES_BEFORE: Array<[ObjectID, Array<ObjectID>]> = [
      [productionAnnouncementId, [productionStatusPageId]],
      [bothPagesAnnouncementId, [productionStatusPageId, stagingStatusPageId]],
    ];

    const pagesOf: (
      announcementId: ObjectID,
    ) => Promise<Array<string>> = async (
      announcementId: ObjectID,
    ): Promise<Array<string>> => {
      const rows: Array<{ statusPageId: string }> = await database.query(
        `SELECT "statusPageId" FROM "${schema}"."AnnouncementStatusPage" WHERE "announcementId" = $1`,
        [announcementId.toString()],
      );

      return sorted(
        rows.map((row: { statusPageId: string }): string => {
          return row.statusPageId;
        }),
      );
    };

    const restorePages: () => Promise<void> = async (): Promise<void> => {
      for (const [announcementId, statusPageIds] of PAGES_BEFORE) {
        await database.query(
          `DELETE FROM "${schema}"."AnnouncementStatusPage" WHERE "announcementId" = $1`,
          [announcementId.toString()],
        );

        for (const statusPageId of statusPageIds) {
          await insert("AnnouncementStatusPage", {
            announcementId: announcementId,
            statusPageId: statusPageId,
          });
        }
      }
    };

    afterEach(async () => {
      await restorePages();
    });

    afterAll(async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
      ]);
    });

    // The refusal of a parent the editor may not read: that of a missing one.
    const expectRefusedAsMissing: (
      outcome: Outcome,
      field: string,
      id: ObjectID,
    ) => void = (outcome: Outcome, field: string, id: ObjectID): void => {
      expect(outcome.error).toBeInstanceOf(BadDataException);
      expect((outcome.error as Error).message).toContain(
        `references records that are not in this project: ${field} "${id.toString()}".`,
      );
    };

    const pages: (ids: Array<ObjectID>) => Array<JSONObject> = (
      ids: Array<ObjectID>,
    ): Array<JSONObject> => {
      return ids.map((id: ObjectID): JSONObject => {
        return { _id: id.toString() };
      });
    };

    describe.each([
      ["a team member", "team"],
      ["an API key", "apiKey"],
    ] as Array<[string, "team" | "apiKey"]>)(
      "%s whose read of status pages is limited to a label",
      (_name: string, kind: "team" | "apiKey") => {
        const editor: () => Promise<Caller> = async (): Promise<Caller> => {
          const rows: Array<PermissionRow> = [
            {
              permission: Permission.ReadProjectStatusPage,
              labelIds: [productionLabelId],
            },
            ...ANNOUNCEMENT_EDITOR,
          ];

          if (kind === "team") {
            await setTeamPermissions(homeTeamId, homeProjectId, rows);
            return homeUser;
          }

          return { kind: "apiKey", apiKey: await createApiKey(rows) };
        };

        test("adds no status page the editor may not read to an announcement", async () => {
          const caller: Caller = await editor();

          const refused: Outcome = await update(
            "/status-page-announcement",
            caller,
            productionAnnouncementId,
            {
              statusPages: pages([productionStatusPageId, stagingStatusPageId]),
            },
          );

          expectRefusedAsMissing(refused, "Status Pages", stagingStatusPageId);
          expect(await pagesOf(productionAnnouncementId)).toEqual([
            productionStatusPageId.toString(),
          ]);
        });

        test("keeps a page an announcement is on already, unasked", async () => {
          const caller: Caller = await editor();

          const kept: Outcome = await update(
            "/status-page-announcement",
            caller,
            bothPagesAnnouncementId,
            {
              statusPages: pages([productionStatusPageId, stagingStatusPageId]),
            },
          );

          expect(kept.error).toBeUndefined();
          expect(await pagesOf(bothPagesAnnouncementId)).toEqual(
            sorted([productionStatusPageId, stagingStatusPageId]),
          );
        });

        test("leaves an announcement on no page only with a read that reaches every page", async () => {
          const caller: Caller = await editor();

          const refused: Outcome = await update(
            "/status-page-announcement",
            caller,
            productionAnnouncementId,
            { statusPages: [] },
          );

          expect(refused.error).toBeInstanceOf(NotAuthorizedException);
          expect((refused.error as Error).message).toBe(
            "A Status Page Announcement you change must belong to a Status Page you can read: your access to Status Pages covers only some of them.",
          );
          expect(await pagesOf(productionAnnouncementId)).toEqual([
            productionStatusPageId.toString(),
          ]);
        });
      },
    );

    test("an editor whose read of status pages reaches only the pages they own adds none they do not own", async () => {
      const ownerRowId: ObjectID = ObjectID.generate();

      await insert("StatusPageOwnerUser", {
        _id: ownerRowId,
        projectId: homeProjectId,
        userId: memberId,
        statusPageId: productionStatusPageId,
        isOwnerNotified: true,
        version: 1,
      });

      try {
        await setTeamPermissions(homeTeamId, homeProjectId, [
          {
            permission: Permission.ReadProjectStatusPage,
            scope: PermissionScope.Owned,
          },
          ...ANNOUNCEMENT_EDITOR,
        ]);

        const refused: Outcome = await update(
          "/status-page-announcement",
          homeUser,
          productionAnnouncementId,
          {
            statusPages: pages([productionStatusPageId, stagingStatusPageId]),
          },
        );

        expectRefusedAsMissing(refused, "Status Pages", stagingStatusPageId);
        expect(await pagesOf(productionAnnouncementId)).toEqual([
          productionStatusPageId.toString(),
        ]);
      } finally {
        await removeRows([["StatusPageOwnerUser", "_id", ownerRowId]]);
      }
    });

    test("a block with labels on reading status pages leaves out the pages carrying them", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.ReadProjectStatusPage },
        {
          permission: Permission.ReadProjectStatusPage,
          isBlock: true,
          labelIds: [stagingLabelId],
        },
        ...ANNOUNCEMENT_EDITOR,
      ]);

      const refused: Outcome = await update(
        "/status-page-announcement",
        homeUser,
        productionAnnouncementId,
        {
          statusPages: pages([productionStatusPageId, stagingStatusPageId]),
        },
      );

      expectRefusedAsMissing(refused, "Status Pages", stagingStatusPageId);
      expect(await pagesOf(productionAnnouncementId)).toEqual([
        productionStatusPageId.toString(),
      ]);
    });

    test("an editor who reads every status page moves an announcement to any page of the project", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.StatusPageAdmin },
      ]);

      const moved: Outcome = await update(
        "/status-page-announcement",
        homeUser,
        productionAnnouncementId,
        {
          statusPages: pages([productionStatusPageId, stagingStatusPageId]),
        },
      );

      expect(moved.error).toBeUndefined();
      expect(await pagesOf(productionAnnouncementId)).toEqual(
        sorted([productionStatusPageId, stagingStatusPageId]),
      );
    });

    describe("a rule of a service, moved to another service by either name", () => {
      const ruleId: ObjectID = ObjectID.generate();

      const RULE_EDITOR: Array<PermissionRow> = [
        { permission: Permission.EditProjectMetricPipelineRule },
        { permission: Permission.ReadProjectMetricPipelineRule },
        { permission: Permission.ReadService, labelIds: [productionLabelId] },
      ];

      const serviceOfRule: () => Promise<unknown> =
        async (): Promise<unknown> => {
          return await readColumn("MetricPipelineRule", ruleId, "serviceId");
        };

      beforeAll(async () => {
        await insert("MetricPipelineRule", {
          _id: ruleId,
          projectId: homeProjectId,
          name: "Drop debug metrics",
          ruleType: "Drop",
          serviceId: productionServiceId,
          version: 1,
        });
      });

      afterAll(async () => {
        await removeRows([["MetricPipelineRule", "_id", ruleId]]);
      });

      afterEach(async () => {
        await database.query(
          `UPDATE "${schema}"."MetricPipelineRule" SET "serviceId" = $1 WHERE "_id" = $2`,
          [productionServiceId.toString(), ruleId.toString()],
        );
      });

      describe.each([
        ["a team member", "team"],
        ["an API key", "apiKey"],
      ] as Array<[string, "team" | "apiKey"]>)(
        "%s whose read of services is limited to a label",
        (_name: string, kind: "team" | "apiKey") => {
          const editor: () => Promise<Caller> = async (): Promise<Caller> => {
            if (kind === "team") {
              await setTeamPermissions(homeTeamId, homeProjectId, RULE_EDITOR);
              return homeUser;
            }

            return { kind: "apiKey", apiKey: await createApiKey(RULE_EDITOR) };
          };

          test.each([
            ["its ID column", "serviceId"],
            ["its relation", "service"],
            ["both names, agreeing", "both"],
          ])(
            "moves no rule to a service the editor may not read, named by %s",
            async (_naming: string, naming: string) => {
              const caller: Caller = await editor();

              const named: JSONObject =
                naming === "serviceId"
                  ? { serviceId: stagingServiceId }
                  : naming === "service"
                    ? { service: { _id: stagingServiceId.toString() } }
                    : {
                        serviceId: stagingServiceId,
                        service: { _id: stagingServiceId.toString() },
                      };

              const refused: Outcome = await update(
                "/metric-pipeline-rule",
                caller,
                ruleId,
                named,
              );

              expectRefusedAsMissing(refused, "Service", stagingServiceId);
              expect(String(await serviceOfRule())).toBe(
                productionServiceId.toString(),
              );
            },
          );

          test("keeps the service a rule has, unasked", async () => {
            const caller: Caller = await editor();

            const kept: Outcome = await update(
              "/metric-pipeline-rule",
              caller,
              ruleId,
              { serviceId: productionServiceId, name: "Drop debug metrics" },
            );

            expect(kept.error).toBeUndefined();
            expect(String(await serviceOfRule())).toBe(
              productionServiceId.toString(),
            );
          });
        },
      );

      test("the two names of the service must agree", async () => {
        await setTeamPermissions(homeTeamId, homeProjectId, RULE_EDITOR);

        const refused: Outcome = await update(
          "/metric-pipeline-rule",
          homeUser,
          ruleId,
          {
            serviceId: productionServiceId,
            service: { _id: stagingServiceId.toString() },
          },
        );

        expect(refused.error).toBeInstanceOf(BadDataException);
        expect(String(await serviceOfRule())).toBe(
          productionServiceId.toString(),
        );
      });

      test("a service of another project reads like a missing one, to an editor who reads every service", async () => {
        await setTeamPermissions(homeTeamId, homeProjectId, [
          { permission: Permission.EditProjectMetricPipelineRule },
          { permission: Permission.ReadProjectMetricPipelineRule },
          { permission: Permission.ReadService },
        ]);

        const refused: Outcome = await update(
          "/metric-pipeline-rule",
          homeUser,
          ruleId,
          { serviceId: otherServiceId },
        );

        expectRefusedAsMissing(refused, "Service", otherServiceId);
        expect(String(await serviceOfRule())).toBe(
          productionServiceId.toString(),
        );
      });
    });
  });

  describe("a create permission limited to labels", () => {
    // What the status pages this block creates are named, to clear them after.
    const CREATED_PAGE_MARKER: string = "Created under a create scope";

    const pageName: () => string = (): string => {
      return `${CREATED_PAGE_MARKER} ${ObjectID.generate().toString()}`;
    };

    const pagesNamed: (name: string) => Promise<number> = async (
      name: string,
    ): Promise<number> => {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*) AS "count" FROM "${schema}"."StatusPage" WHERE "name" = $1`,
        [name],
      );

      return Number(rows[0]?.count || 0);
    };

    const createStatusPage: (
      caller: Caller,
      name: string,
      labelIds: Array<ObjectID>,
    ) => Promise<Outcome> = async (
      caller: Caller,
      name: string,
      labelIds: Array<ObjectID>,
    ): Promise<Outcome> => {
      return await send({
        uri: "/status-page",
        caller: caller,
        body: {
          data: JSONFunctions.serialize({
            name: name,
            labels: labelIds.map((labelId: ObjectID): JSONObject => {
              return { _id: labelId.toString() };
            }),
          }),
        },
      });
    };

    afterAll(async () => {
      const rows: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "${schema}"."StatusPage" WHERE "name" LIKE $1`,
        [`${CREATED_PAGE_MARKER}%`],
      );

      for (const created of rows) {
        await removeRows([
          ["StatusPageLabel", "statusPageId", new ObjectID(created._id)],
          ["StatusPageOwnerUser", "statusPageId", new ObjectID(created._id)],
          ["StatusPageOwnerTeam", "statusPageId", new ObjectID(created._id)],
          ["StatusPage", "_id", new ObjectID(created._id)],
        ]);
      }

      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
      ]);
    });

    describe.each([
      ["a team member", "team"],
      ["an API key", "apiKey"],
    ] as Array<[string, "team" | "apiKey"]>)(
      "%s",
      (_name: string, kind: "team" | "apiKey") => {
        const creatorWith: (
          rows: Array<PermissionRow>,
        ) => Promise<Caller> = async (
          rows: Array<PermissionRow>,
        ): Promise<Caller> => {
          if (kind === "team") {
            await setTeamPermissions(homeTeamId, homeProjectId, rows);
            return homeUser;
          }

          return { kind: "apiKey", apiKey: await createApiKey(rows) };
        };

        test("creates a status page carrying one of its labels, and no other", async () => {
          const caller: Caller = await creatorWith([
            {
              permission: Permission.CreateProjectStatusPage,
              labelIds: [productionLabelId],
            },
            {
              permission: Permission.ReadProjectStatusPage,
              labelIds: [productionLabelId],
            },
          ]);

          const name: string = pageName();
          const created: Outcome = await createStatusPage(caller, name, [
            productionLabelId,
          ]);

          expect(created.error).toBeUndefined();
          expect(await pagesNamed(name)).toBe(1);

          for (const labelIds of [[], [stagingLabelId]]) {
            const refusedName: string = pageName();
            const refused: Outcome = await createStatusPage(
              caller,
              refusedName,
              labelIds,
            );

            expect(refused.error).toBeInstanceOf(NotAuthorizedException);
            expect((refused.error as Error).message).toBe(
              "Your access lets you create Status Pages only with one of these labels: Production. Add one of them and try again.",
            );
            expect(await pagesNamed(refusedName)).toBe(0);
          }
        });

        test("with a permission over the whole project beside it, creates any", async () => {
          const caller: Caller = await creatorWith([
            {
              permission: Permission.CreateProjectStatusPage,
              labelIds: [productionLabelId],
            },
            { permission: Permission.CreateProjectStatusPage },
            { permission: Permission.ReadProjectStatusPage },
          ]);

          const name: string = pageName();
          const created: Outcome = await createStatusPage(caller, name, []);

          expect(created.error).toBeUndefined();
          expect(await pagesNamed(name)).toBe(1);
        });
      },
    );

    test("a block with labels on creating status pages refuses one carrying them", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.CreateProjectStatusPage },
        { permission: Permission.ReadProjectStatusPage },
        {
          permission: Permission.CreateProjectStatusPage,
          isBlock: true,
          labelIds: [stagingLabelId],
        },
      ]);

      const allowedName: string = pageName();
      expect(
        (await createStatusPage(homeUser, allowedName, [productionLabelId]))
          .error,
      ).toBeUndefined();

      const refusedName: string = pageName();
      const refused: Outcome = await createStatusPage(homeUser, refusedName, [
        productionLabelId,
        stagingLabelId,
      ]);

      expect(refused.error).toBeInstanceOf(NotAuthorizedException);
      expect((refused.error as Error).message).toContain(
        `is in your team's permission block list for the label "Staging"`,
      );
      expect(await pagesNamed(refusedName)).toBe(0);
    });

    test("a note goes only on an alert carrying a label of the permission to write notes", async () => {
      // Every alert is read; notes are written on Production alerts only.
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.ReadAlert },
        {
          permission: Permission.CreateAlertInternalNote,
          labelIds: [productionLabelId],
        },
        { permission: Permission.ReadAlertInternalNote },
      ]);

      const text: string = `${CREATED_PAGE_MARKER} note ${ObjectID.generate().toString()}`;

      try {
        const created: Outcome = await send({
          uri: "/alert-internal-note",
          caller: homeUser,
          body: {
            data: JSONFunctions.serialize({
              alertId: productionAlertId,
              note: text,
            }),
          },
        });

        expect(created.error).toBeUndefined();

        const refused: Outcome = await send({
          uri: "/alert-internal-note",
          caller: homeUser,
          body: {
            data: JSONFunctions.serialize({
              alertId: stagingAlertId,
              note: `${text} refused`,
            }),
          },
        });

        expect(refused.error).toBeInstanceOf(NotAuthorizedException);
        expect((refused.error as Error).message).toBe(
          "Your access lets you create Alert Internal Notes only for records with one of these labels: Production.",
        );
      } finally {
        await database.query(
          `DELETE FROM "${schema}"."AlertInternalNote" WHERE "note" LIKE $1`,
          [`${CREATED_PAGE_MARKER}%`],
        );
      }
    });

    describe("limited to owned records", () => {
      test("a person creates a status page, and becomes its owner", async () => {
        await setTeamPermissions(homeTeamId, homeProjectId, [
          {
            permission: Permission.CreateProjectStatusPage,
            scope: PermissionScope.Owned,
          },
          {
            permission: Permission.ReadProjectStatusPage,
            scope: PermissionScope.Owned,
          },
        ]);

        const name: string = pageName();
        const created: Outcome = await createStatusPage(homeUser, name, []);

        expect(created.error).toBeUndefined();

        const owners: Array<{ userId: string }> = await database.query(
          `SELECT o."userId" FROM "${schema}"."StatusPageOwnerUser" o JOIN "${schema}"."StatusPage" p ON p."_id" = o."statusPageId" WHERE p."name" = $1`,
          [name],
        );

        expect(
          owners.map((owner: { userId: string }): string => {
            return owner.userId;
          }),
        ).toEqual([memberId.toString()]);
      });

      test("a note goes only on an alert they or their teams own", async () => {
        // Every alert is read; notes are written on owned alerts only.
        await setTeamPermissions(homeTeamId, homeProjectId, [
          { permission: Permission.ReadAlert },
          {
            permission: Permission.CreateAlertInternalNote,
            scope: PermissionScope.Owned,
          },
          { permission: Permission.ReadAlertInternalNote },
        ]);

        const text: string = `${CREATED_PAGE_MARKER} owned note ${ObjectID.generate().toString()}`;

        try {
          // The member owns the staging alert.
          const created: Outcome = await send({
            uri: "/alert-internal-note",
            caller: homeUser,
            body: {
              data: JSONFunctions.serialize({
                alertId: stagingAlertId,
                note: text,
              }),
            },
          });

          expect(created.error).toBeUndefined();

          const refused: Outcome = await send({
            uri: "/alert-internal-note",
            caller: homeUser,
            body: {
              data: JSONFunctions.serialize({
                alertId: productionAlertId,
                note: `${text} refused`,
              }),
            },
          });

          expect(refused.error).toBeInstanceOf(NotAuthorizedException);
          expect((refused.error as Error).message).toBe(
            "Your access lets you create Alert Internal Notes only for the Alerts you or your teams own.",
          );

          const notes: Array<{ alertId: string }> = await database.query(
            `SELECT "alertId" FROM "${schema}"."AlertInternalNote" WHERE "note" LIKE $1`,
            [`${text}%`],
          );

          expect(
            notes.map((note: { alertId: string }): string => {
              return note.alertId;
            }),
          ).toEqual([stagingAlertId.toString()]);
        } finally {
          await database.query(
            `DELETE FROM "${schema}"."AlertInternalNote" WHERE "note" LIKE $1`,
            [`${CREATED_PAGE_MARKER}%`],
          );
        }
      });
    });

    describe("what a label-limited creator makes under a record they just made", () => {
      test("the owners picked for a status page carrying their label are added, as the creator", async () => {
        await setTeamPermissions(homeTeamId, homeProjectId, [
          {
            permission: Permission.StatusPageMember,
            labelIds: [productionLabelId],
          },
        ]);

        const name: string = pageName();
        const created: Outcome = await createStatusPage(homeUser, name, [
          productionLabelId,
        ]);

        expect(created.error).toBeUndefined();

        const pageId: ObjectID = created.item!.id!;

        const owner: Outcome = await send({
          uri: "/status-page-owner-team",
          caller: homeUser,
          body: {
            data: JSONFunctions.serialize({
              statusPageId: pageId,
              teamId: homeTeamId,
              isOwnerNotified: true,
            }),
          },
        });

        expect(owner.error).toBeUndefined();

        const rows: Array<{ teamId: string }> = await database.query(
          `SELECT "teamId" FROM "${schema}"."StatusPageOwnerTeam" WHERE "statusPageId" = $1`,
          [pageId.toString()],
        );

        expect(
          rows.map((row: { teamId: string }): string => {
            return row.teamId;
          }),
        ).toEqual([homeTeamId.toString()]);

        // A page without their label is never made, so nothing under it can fail.
        const refused: Outcome = await createStatusPage(
          homeUser,
          pageName(),
          [],
        );

        expect(refused.error).toBeInstanceOf(NotAuthorizedException);
      });

      test("the first escalation rule of an on-call policy carrying their label is added, as the creator", async () => {
        const autoOwner: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
          DatabaseService.prototype as never,
          "autoOwnerOnCreate",
        ).mockResolvedValue(undefined as never);

        try {
          await setTeamPermissions(homeTeamId, homeProjectId, [
            {
              permission: Permission.OnCallMember,
              labelIds: [productionLabelId],
            },
          ]);

          const policy: Outcome = await send({
            uri: "/on-call-duty-policy",
            caller: homeUser,
            body: {
              data: JSONFunctions.serialize({
                name: pageName(),
                labels: [{ _id: productionLabelId.toString() }],
              }),
            },
          });

          expect(policy.error).toBeUndefined();

          const policyId: ObjectID = policy.item!.id!;

          try {
            const rule: Outcome = await send({
              uri: "/on-call-duty-policy-escalation-rule",
              caller: homeUser,
              body: {
                data: JSONFunctions.serialize({
                  onCallDutyPolicyId: policyId,
                  name: "Level 1",
                  order: 1,
                }),
              },
            });

            expect(rule.error).toBeUndefined();

            const rules: Array<{ count: string }> = await database.query(
              `SELECT COUNT(*) AS "count" FROM "${schema}"."OnCallDutyPolicyEscalationRule" WHERE "onCallDutyPolicyId" = $1`,
              [policyId.toString()],
            );

            expect(Number(rules[0]?.count)).toBe(1);

            // A policy without their label is never made.
            const refused: Outcome = await send({
              uri: "/on-call-duty-policy",
              caller: homeUser,
              body: {
                data: JSONFunctions.serialize({ name: pageName() }),
              },
            });

            expect(refused.error).toBeInstanceOf(NotAuthorizedException);
          } finally {
            await removeRows([
              [
                "OnCallDutyPolicyEscalationRule",
                "onCallDutyPolicyId",
                policyId,
              ],
              ["OnCallDutyPolicyLabel", "onCallDutyPolicyId", policyId],
              ["OnCallDutyPolicy", "_id", policyId],
            ]);
          }
        } finally {
          autoOwner.mockRestore();
        }
      });
    });
  });

  describe("the records a write lists", () => {
    // What the alerts this block creates are titled, to clear them after.
    const CREATED_ALERT_MARKER: string = "Listed records";

    let autoOwner: ReturnType<typeof getJestSpyOn>;

    beforeAll(() => {
      // The creator's owner row of a new alert is not what this block is about.
      autoOwner = getJestSpyOn(
        DatabaseService.prototype as never,
        "autoOwnerOnCreate",
      ).mockResolvedValue(undefined as never);
    });

    afterAll(async () => {
      autoOwner.mockRestore();

      const rows: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "${schema}"."Alert" WHERE "title" LIKE $1`,
        [`${CREATED_ALERT_MARKER}%`],
      );

      for (const created of rows) {
        await removeRows([
          ["AlertService", "alertId", new ObjectID(created._id)],
          ["Alert", "_id", new ObjectID(created._id)],
        ]);
      }

      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
      ]);
    });

    const alertTitle: () => string = (): string => {
      return `${CREATED_ALERT_MARKER} ${ObjectID.generate().toString()}`;
    };

    const servicesOf: (alertId: ObjectID) => Promise<Array<string>> = async (
      alertId: ObjectID,
    ): Promise<Array<string>> => {
      const rows: Array<{ serviceId: string }> = await database.query(
        `SELECT "serviceId" FROM "${schema}"."AlertService" WHERE "alertId" = $1`,
        [alertId.toString()],
      );

      return sorted(
        rows.map((row: { serviceId: string }): string => {
          return row.serviceId;
        }),
      );
    };

    const createAlert: (
      caller: Caller,
      title: string,
      serviceIds: Array<ObjectID>,
    ) => Promise<Outcome> = async (
      caller: Caller,
      title: string,
      serviceIds: Array<ObjectID>,
    ): Promise<Outcome> => {
      return await send({
        uri: "/alert",
        caller: caller,
        body: {
          data: JSONFunctions.serialize({
            title: title,
            currentAlertStateId: ObjectID.generate(),
            alertSeverityId: ObjectID.generate(),
            labels: [{ _id: productionLabelId.toString() }],
            services: serviceIds.map((serviceId: ObjectID): JSONObject => {
              return { _id: serviceId.toString() };
            }),
          }),
        },
      });
    };

    const LABELLED_DECLARER: Array<PermissionRow> = [
      { permission: Permission.CreateAlert },
      { permission: Permission.EditAlert },
      { permission: Permission.ReadAlert },
      { permission: Permission.ReadService, labelIds: [productionLabelId] },
    ];

    const expectRefusedAsMissing: (
      outcome: Outcome,
      field: string,
      id: ObjectID,
    ) => void = (outcome: Outcome, field: string, id: ObjectID): void => {
      expect(outcome.error).toBeInstanceOf(BadDataException);
      expect((outcome.error as Error).message).toContain(
        `references records that are not in this project: ${field} "${id.toString()}".`,
      );
    };

    describe.each([
      ["a team member", "team"],
      ["an API key", "apiKey"],
    ] as Array<[string, "team" | "apiKey"]>)(
      "%s whose read of services is limited to a label",
      (_name: string, kind: "team" | "apiKey") => {
        const declarer: () => Promise<Caller> = async (): Promise<Caller> => {
          if (kind === "team") {
            await setTeamPermissions(
              homeTeamId,
              homeProjectId,
              LABELLED_DECLARER,
            );
            return homeUser;
          }

          return {
            kind: "apiKey",
            apiKey: await createApiKey(LABELLED_DECLARER),
          };
        };

        test("creates an alert listing only services carrying the label", async () => {
          const caller: Caller = await declarer();

          const created: Outcome = await createAlert(caller, alertTitle(), [
            productionServiceId,
          ]);

          expect(created.error).toBeUndefined();
          expect(await servicesOf(created.item!.id!)).toEqual([
            productionServiceId.toString(),
          ]);

          const title: string = alertTitle();
          const refused: Outcome = await createAlert(caller, title, [
            productionServiceId,
            stagingServiceId,
          ]);

          expectRefusedAsMissing(refused, "Services", stagingServiceId);

          const rows: Array<{ count: string }> = await database.query(
            `SELECT COUNT(*) AS "count" FROM "${schema}"."Alert" WHERE "title" = $1`,
            [title],
          );

          expect(Number(rows[0]?.count)).toBe(0);
        });

        test("an update adds only services the editor may read, and keeps the ones listed already", async () => {
          const caller: Caller = await declarer();

          const created: Outcome = await createAlert(caller, alertTitle(), [
            productionServiceId,
          ]);
          const alertId: ObjectID = created.item!.id!;

          const refused: Outcome = await update("/alert", caller, alertId, {
            services: [
              { _id: productionServiceId.toString() },
              { _id: stagingServiceId.toString() },
            ],
          });

          expectRefusedAsMissing(refused, "Services", stagingServiceId);
          expect(await servicesOf(alertId)).toEqual([
            productionServiceId.toString(),
          ]);

          // Listed already - put there by someone who reads it - and kept.
          await insert("AlertService", {
            alertId: alertId,
            serviceId: stagingServiceId,
          });

          const kept: Outcome = await update("/alert", caller, alertId, {
            services: [
              { _id: productionServiceId.toString() },
              { _id: stagingServiceId.toString() },
            ],
          });

          expect(kept.error).toBeUndefined();
          expect(await servicesOf(alertId)).toEqual(
            sorted([productionServiceId, stagingServiceId]),
          );
        });
      },
    );

    test("a responder who reads no services is held to the project: a service of another project reads like a missing one", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
      ]);

      const created: Outcome = await createAlert(homeUser, alertTitle(), [
        stagingServiceId,
      ]);

      expect(created.error).toBeUndefined();

      const refused: Outcome = await createAlert(homeUser, alertTitle(), [
        otherServiceId,
      ]);

      expectRefusedAsMissing(refused, "Services", otherServiceId);
    });
  });

  describe("the one record a write names in a field of its own", () => {
    // What the budgets this block creates are named, to clear them after.
    const CREATED_BUDGET_MARKER: string = "Named record";

    afterAll(async () => {
      await database.query(
        `DELETE FROM "${schema}"."LlmCostBudget" WHERE "name" LIKE $1`,
        [`${CREATED_BUDGET_MARKER}%`],
      );

      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
      ]);
    });

    const budgetName: () => string = (): string => {
      return `${CREATED_BUDGET_MARKER} ${ObjectID.generate().toString()}`;
    };

    const budgetsNamed: (name: string) => Promise<number> = async (
      name: string,
    ): Promise<number> => {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*) AS "count" FROM "${schema}"."LlmCostBudget" WHERE "name" = $1`,
        [name],
      );

      return Number(rows[0]?.count || 0);
    };

    const createBudget: (
      caller: Caller,
      name: string,
      reference: JSONObject,
    ) => Promise<Outcome> = async (
      caller: Caller,
      name: string,
      reference: JSONObject,
    ): Promise<Outcome> => {
      return await send({
        uri: "/llm-cost-budget",
        caller: caller,
        body: {
          data: JSONFunctions.serialize({
            name: name,
            isEnabled: true,
            dailyBudgetInUSD: 10,
            ...reference,
          }),
        },
      });
    };

    // Who keeps the project's budgets, without a word about services.
    const BUDGET_KEEPER: Array<PermissionRow> = [
      { permission: Permission.CreateProjectLlmCostBudget },
      { permission: Permission.EditProjectLlmCostBudget },
      { permission: Permission.ReadProjectLlmCostBudget },
    ];

    // The refusal of a service the caller may not read: that of a missing one.
    const expectRefusedAsMissing: (outcome: Outcome, id: ObjectID) => void = (
      outcome: Outcome,
      id: ObjectID,
    ): void => {
      expect(outcome.error).toBeInstanceOf(BadDataException);
      expect((outcome.error as Error).message).toBe(
        `This llm cost budget references records that are not in this project: Service "${id.toString()}". Please pick values from this project and try again.`,
      );
    };

    const byIdColumn: (id: ObjectID) => JSONObject = (
      id: ObjectID,
    ): JSONObject => {
      return { serviceId: id.toString() };
    };

    const byRelation: (id: ObjectID) => JSONObject = (
      id: ObjectID,
    ): JSONObject => {
      return { service: { _id: id.toString() } };
    };

    const byBoth: (id: ObjectID) => JSONObject = (id: ObjectID): JSONObject => {
      return { serviceId: id.toString(), service: { _id: id.toString() } };
    };

    describe.each([
      ["a team member", "team"],
      ["an API key", "apiKey"],
    ] as Array<[string, "team" | "apiKey"]>)(
      "%s whose read of services is limited to a label",
      (_name: string, kind: "team" | "apiKey") => {
        const keeper: () => Promise<Caller> = async (): Promise<Caller> => {
          const rows: Array<PermissionRow> = [
            ...BUDGET_KEEPER,
            {
              permission: Permission.ReadService,
              labelIds: [productionLabelId],
            },
          ];

          if (kind === "team") {
            await setTeamPermissions(homeTeamId, homeProjectId, rows);
            return homeUser;
          }

          return { kind: "apiKey", apiKey: await createApiKey(rows) };
        };

        test.each([
          ["by its ID column", byIdColumn],
          ["by its relation", byRelation],
          ["by both of its names", byBoth],
        ] as Array<[string, (id: ObjectID) => JSONObject]>)(
          "%s, names only a service carrying the label",
          async (_how: string, named: (id: ObjectID) => JSONObject) => {
            const caller: Caller = await keeper();

            const created: Outcome = await createBudget(
              caller,
              budgetName(),
              named(productionServiceId),
            );

            expect(created.error).toBeUndefined();
            expect(
              await readColumn("LlmCostBudget", created.item!.id!, "serviceId"),
            ).toBe(productionServiceId.toString());

            const name: string = budgetName();
            const refused: Outcome = await createBudget(
              caller,
              name,
              named(stagingServiceId),
            );

            expectRefusedAsMissing(refused, stagingServiceId);
            expect(await budgetsNamed(name)).toBe(0);
          },
        );

        test("an update points a budget only at a service the editor may read, and keeps the one it names already", async () => {
          const caller: Caller = await keeper();

          const created: Outcome = await createBudget(
            caller,
            budgetName(),
            byIdColumn(productionServiceId),
          );
          const budgetId: ObjectID = created.item!.id!;

          for (const named of [byIdColumn, byRelation]) {
            const refused: Outcome = await update(
              "/llm-cost-budget",
              caller,
              budgetId,
              named(stagingServiceId),
            );

            expectRefusedAsMissing(refused, stagingServiceId);
            expect(
              await readColumn("LlmCostBudget", budgetId, "serviceId"),
            ).toBe(productionServiceId.toString());
          }

          // Named already - by someone who reads it - and kept.
          await database.query(
            `UPDATE "${schema}"."LlmCostBudget" SET "serviceId" = $1 WHERE "_id" = $2`,
            [stagingServiceId.toString(), budgetId.toString()],
          );

          const kept: Outcome = await update(
            "/llm-cost-budget",
            caller,
            budgetId,
            { ...byIdColumn(stagingServiceId), dailyBudgetInUSD: 20 },
          );

          expect(kept.error).toBeUndefined();
          expect(await readColumn("LlmCostBudget", budgetId, "serviceId")).toBe(
            stagingServiceId.toString(),
          );
        });
      },
    );

    test("a keeper whose read of services reaches only what they own names only a service they own", async () => {
      // The member owns the production service.
      await setTeamPermissions(homeTeamId, homeProjectId, [
        ...BUDGET_KEEPER,
        { permission: Permission.ReadService, scope: PermissionScope.Owned },
      ]);

      const created: Outcome = await createBudget(
        homeUser,
        budgetName(),
        byRelation(productionServiceId),
      );

      expect(created.error).toBeUndefined();

      const name: string = budgetName();
      const refused: Outcome = await createBudget(
        homeUser,
        name,
        byRelation(stagingServiceId),
      );

      expectRefusedAsMissing(refused, stagingServiceId);
      expect(await budgetsNamed(name)).toBe(0);
    });

    test("a block with labels on reading services leaves out the services carrying them", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        ...BUDGET_KEEPER,
        { permission: Permission.ReadService },
        {
          permission: Permission.ReadService,
          isBlock: true,
          labelIds: [stagingLabelId],
        },
      ]);

      const created: Outcome = await createBudget(
        homeUser,
        budgetName(),
        byIdColumn(productionServiceId),
      );

      expect(created.error).toBeUndefined();

      const name: string = budgetName();
      const refused: Outcome = await createBudget(
        homeUser,
        name,
        byIdColumn(stagingServiceId),
      );

      expectRefusedAsMissing(refused, stagingServiceId);
      expect(await budgetsNamed(name)).toBe(0);
    });

    test("a keeper who reads no services is held to the project: a service of another project reads like a missing one", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, BUDGET_KEEPER);

      const created: Outcome = await createBudget(
        homeUser,
        budgetName(),
        byIdColumn(stagingServiceId),
      );

      expect(created.error).toBeUndefined();

      const refused: Outcome = await createBudget(
        homeUser,
        budgetName(),
        byIdColumn(otherServiceId),
      );

      expectRefusedAsMissing(refused, otherServiceId);
    });

    test("the two names must agree", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        ...BUDGET_KEEPER,
        { permission: Permission.ReadService },
      ]);

      const name: string = budgetName();
      const refused: Outcome = await createBudget(homeUser, name, {
        serviceId: productionServiceId.toString(),
        service: { _id: stagingServiceId.toString() },
      });

      expect(refused.error).toBeInstanceOf(BadDataException);
      expect(await budgetsNamed(name)).toBe(0);
    });
  });

  describe("an update that changes the labels a record carries", () => {
    let alertId: ObjectID;

    beforeEach(async () => {
      alertId = ObjectID.generate();

      await insertAlert({
        id: alertId,
        projectId: homeProjectId,
        title: "Relabelled alert",
        labelIds: [productionLabelId],
      });
    });

    afterEach(async () => {
      await removeRows([
        ["AlertLabel", "alertId", alertId],
        ["Alert", "_id", alertId],
      ]);
    });

    afterAll(async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
      ]);
    });

    const labelsOf: (id: ObjectID) => Promise<Array<string>> = async (
      id: ObjectID,
    ): Promise<Array<string>> => {
      const rows: Array<{ labelId: string }> = await database.query(
        `SELECT "labelId" FROM "${schema}"."AlertLabel" WHERE "alertId" = $1`,
        [id.toString()],
      );

      return sorted(
        rows.map((row: { labelId: string }): string => {
          return row.labelId;
        }),
      );
    };

    const relabel: (
      caller: Caller,
      labelIds: Array<ObjectID>,
    ) => Promise<Outcome> = async (
      caller: Caller,
      labelIds: Array<ObjectID>,
    ): Promise<Outcome> => {
      return await update("/alert", caller, alertId, {
        labels: labelIds.map((labelId: ObjectID): JSONObject => {
          return { _id: labelId.toString() };
        }),
      });
    };

    describe.each([
      ["a team member", "team"],
      ["an API key", "apiKey"],
    ] as Array<[string, "team" | "apiKey"]>)(
      "%s whose permission to change alerts is limited to a label",
      (_name: string, kind: "team" | "apiKey") => {
        const editor: () => Promise<Caller> = async (): Promise<Caller> => {
          const rows: Array<PermissionRow> = [
            { permission: Permission.ReadAlert },
            { permission: Permission.EditAlert, labelIds: [productionLabelId] },
          ];

          if (kind === "team") {
            await setTeamPermissions(homeTeamId, homeProjectId, rows);
            return homeUser;
          }

          return { kind: "apiKey", apiKey: await createApiKey(rows) };
        };

        test("a change that keeps one of its labels is written", async () => {
          const caller: Caller = await editor();

          const changed: Outcome = await relabel(caller, [
            productionLabelId,
            stagingLabelId,
          ]);

          expect(changed.error).toBeUndefined();
          expect(await labelsOf(alertId)).toEqual(
            sorted([productionLabelId, stagingLabelId]),
          );
        });

        test("a change that takes the last of its labels away is refused, and the labels are as they were", async () => {
          const caller: Caller = await editor();

          for (const labelIds of [[stagingLabelId], []]) {
            const refused: Outcome = await relabel(caller, labelIds);

            expect(refused.error).toBeInstanceOf(NotAuthorizedException);
            expect((refused.error as Error).message).toBe(
              "Your access lets you change Alerts only with one of these labels: Production. Keep one of them and try again.",
            );
            expect(await labelsOf(alertId)).toEqual([
              productionLabelId.toString(),
            ]);
          }
        });
      },
    );

    test("a block with labels on changing alerts refuses a change that gives one of them", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.ReadAlert },
        { permission: Permission.EditAlert },
        {
          permission: Permission.EditAlert,
          isBlock: true,
          labelIds: [stagingLabelId],
        },
      ]);

      const refused: Outcome = await relabel(homeUser, [
        productionLabelId,
        stagingLabelId,
      ]);

      expect(refused.error).toBeInstanceOf(NotAuthorizedException);
      expect((refused.error as Error).message).toBe(
        `You are not authorized to change this Alert because ${Permission.EditAlert} is in your team's permission block list for the label "Staging".`,
      );
      expect(await labelsOf(alertId)).toEqual([productionLabelId.toString()]);

      // Any other change of labels goes through.
      const changed: Outcome = await relabel(homeUser, []);

      expect(changed.error).toBeUndefined();
      expect(await labelsOf(alertId)).toEqual([]);
    });

    test("a permission over the whole project changes the labels any way", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.ReadAlert },
        { permission: Permission.EditAlert },
      ]);

      const changed: Outcome = await relabel(homeUser, [stagingLabelId]);

      expect(changed.error).toBeUndefined();
      expect(await labelsOf(alertId)).toEqual([stagingLabelId.toString()]);
    });

    test("an announcement moved off its editor's labels is refused, and stays where it was", async () => {
      const announcementId: ObjectID = ObjectID.generate();

      await insert("StatusPageAnnouncement", {
        _id: announcementId,
        projectId: homeProjectId,
        title: "Relabelled announcement",
        description: "Relabelled announcement",
        showAnnouncementAt: new Date(),
        version: 1,
      });
      await insert("AnnouncementStatusPage", {
        announcementId: announcementId,
        statusPageId: productionStatusPageId,
      });

      const pagesOf: () => Promise<Array<string>> = async (): Promise<
        Array<string>
      > => {
        const rows: Array<{ statusPageId: string }> = await database.query(
          `SELECT "statusPageId" FROM "${schema}"."AnnouncementStatusPage" WHERE "announcementId" = $1`,
          [announcementId.toString()],
        );

        return sorted(
          rows.map((row: { statusPageId: string }): string => {
            return row.statusPageId;
          }),
        );
      };

      try {
        // Every status page read; announcements changed on Production pages only.
        await setTeamPermissions(homeTeamId, homeProjectId, [
          { permission: Permission.ReadProjectStatusPage },
          { permission: Permission.ReadStatusPageAnnouncement },
          {
            permission: Permission.EditStatusPageAnnouncement,
            labelIds: [productionLabelId],
          },
        ]);

        const refused: Outcome = await update(
          "/status-page-announcement",
          homeUser,
          announcementId,
          { statusPages: [{ _id: stagingStatusPageId.toString() }] },
        );

        expect(refused.error).toBeInstanceOf(NotAuthorizedException);
        expect((refused.error as Error).message).toBe(
          "Your access lets you change Status Page Announcements only for records with one of these labels: Production.",
        );
        expect(await pagesOf()).toEqual([productionStatusPageId.toString()]);

        const kept: Outcome = await update(
          "/status-page-announcement",
          homeUser,
          announcementId,
          {
            statusPages: [
              { _id: productionStatusPageId.toString() },
              { _id: stagingStatusPageId.toString() },
            ],
          },
        );

        expect(kept.error).toBeUndefined();
        expect(await pagesOf()).toEqual(
          sorted([productionStatusPageId, stagingStatusPageId]),
        );
      } finally {
        await removeRows([
          ["AnnouncementStatusPage", "announcementId", announcementId],
          ["StatusPageAnnouncement", "_id", announcementId],
        ]);
      }
    });
  });

  describe("the records a create's hooks name besides what its caller sent", () => {
    const TEMPLATED_ALERT_MARKER: string = "Templated alert";

    /*
     * An alert service whose hook fills in the services the caller left
     * out, from a template, as a service that declares from a template does.
     */
    class TemplatedAlertService extends DatabaseService<Alert> {
      public templateServiceIds: Array<ObjectID> = [];

      public constructor() {
        super(Alert);
      }

      protected override async onBeforeCreate(
        createBy: CreateBy<Alert>,
      ): Promise<OnCreate<Alert>> {
        if (createBy.data.services === undefined) {
          createBy.data.services = this.templateServiceIds.map(
            (serviceId: ObjectID): Service => {
              const service: Service = new Service();
              service._id = serviceId.toString();
              return service;
            },
          );
        }

        return { createBy: createBy, carryForward: null };
      }
    }

    const templated: TemplatedAlertService = new TemplatedAlertService();

    let autoOwner: ReturnType<typeof getJestSpyOn>;

    beforeAll(() => {
      // The creator's owner row of a new alert is not what this block is about.
      autoOwner = getJestSpyOn(
        DatabaseService.prototype as never,
        "autoOwnerOnCreate",
      ).mockResolvedValue(undefined as never);
    });

    afterAll(async () => {
      autoOwner.mockRestore();

      const rows: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "${schema}"."Alert" WHERE "title" LIKE $1`,
        [`${TEMPLATED_ALERT_MARKER}%`],
      );

      for (const created of rows) {
        await removeRows([
          ["AlertService", "alertId", new ObjectID(created._id)],
          ["AlertLabel", "alertId", new ObjectID(created._id)],
          ["Alert", "_id", new ObjectID(created._id)],
        ]);
      }

      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
      ]);
    });

    const newAlert: (title: string) => Alert = (title: string): Alert => {
      const alert: Alert = new Alert();
      alert.title = title;
      alert.currentAlertStateId = ObjectID.generate();
      alert.alertSeverityId = ObjectID.generate();

      const label: Label = new Label();
      label._id = productionLabelId.toString();
      alert.labels = [label];

      return alert;
    };

    const alertsTitled: (title: string) => Promise<Array<string>> = async (
      title: string,
    ): Promise<Array<string>> => {
      const rows: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "${schema}"."Alert" WHERE "title" = $1`,
        [title],
      );

      return rows.map((row: { _id: string }): string => {
        return row._id;
      });
    };

    test("a service a template names is held to the declarer's read, as if they had named it", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.CreateAlert },
        { permission: Permission.EditAlert },
        { permission: Permission.ReadAlert },
        { permission: Permission.ReadService, labelIds: [productionLabelId] },
      ]);

      const props: DatabaseCommonInteractionProps = await propsOf(homeUser);

      // The template names a service the declarer may not read: nothing is made.
      templated.templateServiceIds = [stagingServiceId];

      const refusedTitle: string = `${TEMPLATED_ALERT_MARKER} ${ObjectID.generate().toString()}`;

      let refusal: unknown = undefined;

      try {
        await templated.create({ data: newAlert(refusedTitle), props: props });
      } catch (error) {
        refusal = error;
      }

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(
        `This alert references records that are not in this project: Services "${stagingServiceId.toString()}". Please pick values from this project and try again.`,
      );
      expect(await alertsTitled(refusedTitle)).toEqual([]);

      // One they may read is listed.
      templated.templateServiceIds = [productionServiceId];

      const title: string = `${TEMPLATED_ALERT_MARKER} ${ObjectID.generate().toString()}`;
      const created: Alert = await templated.create({
        data: newAlert(title),
        props: props,
      });

      const listed: Array<{ serviceId: string }> = await database.query(
        `SELECT "serviceId" FROM "${schema}"."AlertService" WHERE "alertId" = $1`,
        [created.id!.toString()],
      );

      expect(
        listed.map((row: { serviceId: string }): string => {
          return row.serviceId;
        }),
      ).toEqual([productionServiceId.toString()]);
    });
  });

  describe("a creator whose permission to create reaches only what they own", () => {
    const OWNED_PAGE_MARKER: string = "Owned-first page";

    afterAll(async () => {
      const rows: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "${schema}"."StatusPage" WHERE "name" LIKE $1`,
        [`${OWNED_PAGE_MARKER}%`],
      );

      for (const created of rows) {
        await removeRows([
          ["StatusPageOwnerUser", "statusPageId", new ObjectID(created._id)],
          ["StatusPage", "_id", new ObjectID(created._id)],
        ]);
      }

      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
      ]);
    });

    const pagesNamed: (name: string) => Promise<Array<string>> = async (
      name: string,
    ): Promise<Array<string>> => {
      // Removed for good, not marked deleted: no row of any kind is left.
      const rows: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "${schema}"."StatusPage" WHERE "name" = $1`,
        [name],
      );

      return rows.map((row: { _id: string }): string => {
        return row._id;
      });
    };

    const createPage: (name: string) => Promise<Outcome> = async (
      name: string,
    ): Promise<Outcome> => {
      return await send({
        uri: "/status-page",
        caller: homeUser,
        body: { data: JSONFunctions.serialize({ name: name }) },
      });
    };

    test("is made its owner, or what they create is removed and the create refused", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        {
          permission: Permission.CreateProjectStatusPage,
          scope: PermissionScope.Owned,
        },
        {
          permission: Permission.ReadProjectStatusPage,
          scope: PermissionScope.Owned,
        },
      ]);

      const failedInsert: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        StatusPageOwnerUserService,
        "create",
      ).mockRejectedValue(new Error("The database went away.") as never);

      const refusedName: string = `${OWNED_PAGE_MARKER} ${ObjectID.generate().toString()}`;

      try {
        const refused: Outcome = await createPage(refusedName);

        expect(refused.error).toBeInstanceOf(ServerException);
        expect((refused.error as Error).message).toBe(
          "This Status Page was not created: your access lets you create only the Status Pages you own, and you could not be made its owner. Please try again.",
        );
        expect(failedInsert).toHaveBeenCalledTimes(1);
      } finally {
        failedInsert.mockRestore();
      }

      expect(await pagesNamed(refusedName)).toEqual([]);

      // With the owner row written, the page is made, and theirs.
      const name: string = `${OWNED_PAGE_MARKER} ${ObjectID.generate().toString()}`;
      const created: Outcome = await createPage(name);

      expect(created.error).toBeUndefined();

      const owners: Array<{ userId: string }> = await database.query(
        `SELECT o."userId" FROM "${schema}"."StatusPageOwnerUser" o JOIN "${schema}"."StatusPage" p ON p."_id" = o."statusPageId" WHERE p."name" = $1`,
        [name],
      );

      expect(
        owners.map((owner: { userId: string }): string => {
          return owner.userId;
        }),
      ).toEqual([memberId.toString()]);
    });
  });

  /*
   * A READ ACROSS PROJECTS (the home page's alerts of every project): each
   * project's rows are narrowed by the member's grants and blocks in that
   * project, and a project whose grants refuse the read is left out.
   */
  describe("a read across projects", () => {
    test.each([
      [
        "a block with labels in one project leaves out that project's labelled rows",
        [{ permission: Permission.AlertMember }],
        [
          { permission: Permission.AlertMember },
          {
            permission: Permission.ReadAlert,
            labelIds: [secondProductionLabelId],
            isBlock: true,
          },
        ],
        [...homeAlertIds, secondUnlabelledAlertId.toString()],
      ],
      [
        "a block with labels applies in its own project only",
        [
          { permission: Permission.AlertMember },
          {
            permission: Permission.ReadAlert,
            labelIds: [productionLabelId],
            isBlock: true,
          },
        ],
        [{ permission: Permission.AlertMember }],
        [
          stagingAlertId.toString(),
          unlabelledAlertId.toString(),
          secondProductionAlertId.toString(),
          secondUnlabelledAlertId.toString(),
        ],
      ],
      [
        "a grant limited to labels in one project narrows that project only",
        [
          {
            permission: Permission.AlertMember,
            labelIds: [productionLabelId],
          },
        ],
        [{ permission: Permission.AlertMember }],
        [
          productionAlertId.toString(),
          secondProductionAlertId.toString(),
          secondUnlabelledAlertId.toString(),
        ],
      ],
      [
        "a block with no labels leaves that project out",
        [
          { permission: Permission.AlertMember },
          { permission: Permission.ReadAlert, labelIds: [], isBlock: true },
        ],
        [{ permission: Permission.AlertMember }],
        [
          secondProductionAlertId.toString(),
          secondUnlabelledAlertId.toString(),
        ],
      ],
      [
        "a grant limited to owned records reads the owned ones in its project",
        [
          {
            permission: Permission.AlertMember,
            scope: PermissionScope.Owned,
          },
        ],
        [
          { permission: Permission.AlertMember },
          {
            permission: Permission.ReadAlert,
            labelIds: [secondProductionLabelId],
            isBlock: true,
          },
        ],
        [stagingAlertId.toString(), secondUnlabelledAlertId.toString()],
      ],
    ] as Array<
      [string, Array<PermissionRow>, Array<PermissionRow>, Array<string>]
    >)(
      "%s",
      async (
        _label: string,
        homeRows: Array<PermissionRow>,
        secondRows: Array<PermissionRow>,
        expected: Array<string>,
      ) => {
        await setTeamPermissions(homeTeamId, homeProjectId, homeRows);
        await setTeamPermissions(secondTeamId, secondProjectId, secondRows);

        const listed: Outcome = await list("/alert", acrossProjects);

        expect(listed.error).toBeUndefined();
        expect(listed.ids).toEqual(sorted(expected));
        expect(listed.count).toBe(expected.length);

        const counted: Outcome = await count("/alert", acrossProjects);

        expect(counted.count).toBe(expected.length);
      },
    );

    test("filters on another project find nothing of it", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
      ]);
      await setTeamPermissions(secondTeamId, secondProjectId, [
        { permission: Permission.AlertMember },
      ]);

      const named: Outcome = await list("/alert", acrossProjects, {
        projectId: new Includes([
          homeProjectId.toString(),
          otherProjectId.toString(),
        ]),
      });

      expect(named.ids).toEqual(sorted(homeAlertIds));

      for (const query of [
        { project: otherProjectId.toString() },
        { project: { _id: otherProjectId.toString() } },
        { project: new Includes([otherProjectId.toString()]) },
        { _id: otherAlertId.toString() },
      ] as Array<JSONObject>) {
        const listed: Outcome = await list("/alert", acrossProjects, query);

        expect(listed.error).toBeUndefined();
        expect(listed.ids).toEqual([]);
        expect(listed.count).toBe(0);
      }

      /*
       * Each project's own id takes the place of a plain id on the project
       * key, as in a request made in one project: the caller's projects'
       * rows, never the named one's.
       */
      const keyed: Outcome = await list("/alert", acrossProjects, {
        projectId: otherProjectId.toString(),
      });

      expect(keyed.ids).toEqual(
        sorted([
          ...homeAlertIds,
          secondProductionAlertId,
          secondUnlabelledAlertId,
        ]),
      );
    });

    test("a read is refused when every project's block refuses it", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
        { permission: Permission.ReadAlert, isBlock: true },
      ]);
      await setTeamPermissions(secondTeamId, secondProjectId, [
        { permission: Permission.AlertMember },
        { permission: Permission.ReadAlert, isBlock: true },
      ]);

      expectRefused(await list("/alert", acrossProjects));
    });

    test("a block in the project the request names leaves out that project's records only", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
        { permission: Permission.ReadAlert, isBlock: true },
      ]);
      await setTeamPermissions(secondTeamId, secondProjectId, [
        { permission: Permission.AlertMember },
      ]);

      // The home page asks across projects with the project in view named.
      const listed: Outcome = await list("/alert", {
        kind: "user",
        tenantId: homeProjectId,
        isMultiTenant: true,
      });

      expect(listed.error).toBeUndefined();
      expect(listed.ids).toEqual(
        sorted([secondProductionAlertId, secondUnlabelledAlertId]),
      );
      expect(listed.count).toBe(2);
    });
  });

  /*
   * RECORDS THAT CARRY THE LABELS OF THE RECORDS THEY NAME, as the database
   * weighs them: an announcement those of every status page it is shown
   * on, an inventory item those of the resource its id names, whatever kind
   * of resource that is, a remediation decision those of its incident and
   * its alert. A block leaves out a record when one of them carries a
   * blocked label; a grant limited to labels reaches it when one of them
   * carries a granted label, and a record that names none of them stays.
   */
  describe("records that carry the labels of the records they name", () => {
    test.each([
      [
        "a grant over the project",
        [{ permission: Permission.StatusPageMember }],
        [
          productionAnnouncementId,
          stagingAnnouncementId,
          bothPagesAnnouncementId,
          noPageAnnouncementId,
        ],
      ],
      [
        "a block with labels",
        [
          { permission: Permission.StatusPageMember },
          {
            permission: Permission.ReadStatusPageAnnouncement,
            labelIds: [productionLabelId],
            isBlock: true,
          },
        ],
        [stagingAnnouncementId, noPageAnnouncementId],
      ],
      [
        "a grant limited to labels",
        [
          {
            permission: Permission.StatusPageMember,
            labelIds: [productionLabelId],
          },
        ],
        // Shown on a production page, whatever else it is shown on.
        [productionAnnouncementId, bothPagesAnnouncementId],
      ],
      [
        "a grant limited to labels and a block with labels",
        [
          {
            permission: Permission.StatusPageMember,
            labelIds: [productionLabelId, stagingLabelId],
          },
          {
            permission: Permission.ReadStatusPageAnnouncement,
            labelIds: [productionLabelId],
            isBlock: true,
          },
        ],
        [stagingAnnouncementId],
      ],
    ] as Array<[string, Array<PermissionRow>, Array<ObjectID>]>)(
      "announcements on status pages, under %s",
      async (
        _label: string,
        rows: Array<PermissionRow>,
        expected: Array<ObjectID>,
      ) => {
        await setTeamPermissions(homeTeamId, homeProjectId, rows);

        const listed: Outcome = await list(
          "/status-page-announcement",
          homeUser,
        );

        expect(listed.error).toBeUndefined();
        expect(listed.ids).toEqual(sorted(expected));
        expect(listed.count).toBe(expected.length);
      },
    );

    test.each([
      [
        "a grant over the project",
        [{ permission: Permission.TelemetryMember }],
        [productionItemId, stagingItemId, unnamedItemId],
      ],
      [
        "a block with labels",
        [
          { permission: Permission.TelemetryMember },
          {
            permission: Permission.ReadTelemetryService,
            labelIds: [productionLabelId],
            isBlock: true,
          },
        ],
        [stagingItemId, unnamedItemId],
      ],
      [
        "a grant limited to labels",
        [
          {
            permission: Permission.TelemetryMember,
            labelIds: [productionLabelId],
          },
        ],
        [productionItemId, unnamedItemId],
      ],
    ] as Array<[string, Array<PermissionRow>, Array<ObjectID>]>)(
      "inventory items naming a resource of any kind, under %s",
      async (
        _label: string,
        rows: Array<PermissionRow>,
        expected: Array<ObjectID>,
      ) => {
        await setTeamPermissions(homeTeamId, homeProjectId, rows);

        const listed: Outcome = await list("/inventory-item", homeUser);

        expect(listed.error).toBeUndefined();
        expect(listed.ids).toEqual(sorted(expected));
        expect(listed.count).toBe(expected.length);
      },
    );
    test.each([
      [
        "a grant over the project",
        [{ permission: Permission.ProjectMember }],
        [
          productionIncidentStagingAlertDecisionId,
          stagingIncidentDecisionId,
          unlabelledRecordsDecisionId,
          unnamedDecisionId,
        ],
      ],
      [
        "a grant limited to the incident's label",
        [
          {
            permission: Permission.ProjectMember,
            labelIds: [productionLabelId],
          },
        ],
        [productionIncidentStagingAlertDecisionId, unnamedDecisionId],
      ],
      [
        "a grant limited to the alert's label",
        [
          {
            permission: Permission.ProjectMember,
            labelIds: [stagingLabelId],
          },
        ],
        [
          productionIncidentStagingAlertDecisionId,
          stagingIncidentDecisionId,
          unnamedDecisionId,
        ],
      ],
      [
        "a block with the incident's label",
        [
          { permission: Permission.ProjectMember },
          {
            permission: Permission.ProjectMember,
            labelIds: [productionLabelId],
            isBlock: true,
          },
        ],
        [
          stagingIncidentDecisionId,
          unlabelledRecordsDecisionId,
          unnamedDecisionId,
        ],
      ],
      [
        "a block with the alert's label",
        [
          { permission: Permission.ProjectMember },
          {
            permission: Permission.ProjectMember,
            labelIds: [stagingLabelId],
            isBlock: true,
          },
        ],
        [unlabelledRecordsDecisionId, unnamedDecisionId],
      ],
    ] as Array<[string, Array<PermissionRow>, Array<ObjectID>]>)(
      "remediation decisions naming an incident and an alert, under %s",
      async (
        _label: string,
        rows: Array<PermissionRow>,
        expected: Array<ObjectID>,
      ) => {
        await setTeamPermissions(homeTeamId, homeProjectId, rows);

        const listed: Outcome = await list(
          "/auto-remediation-decision",
          homeUser,
        );

        expect(listed.error).toBeUndefined();
        expect(listed.ids).toEqual(sorted(expected));
        expect(listed.count).toBe(expected.length);

        // Read one by one, as listed.
        for (const id of [
          productionIncidentStagingAlertDecisionId,
          stagingIncidentDecisionId,
          unlabelledRecordsDecisionId,
          unnamedDecisionId,
        ]) {
          const read: Outcome = await getItem(
            "/auto-remediation-decision",
            homeUser,
            id,
          );

          const isExpected: boolean = expected.some(
            (expectedId: ObjectID): boolean => {
              return expectedId.toString() === id.toString();
            },
          );

          expect([id.toString(), Boolean(read.item)]).toEqual([
            id.toString(),
            isExpected,
          ]);

          if (!isExpected) {
            // One it may not read is answered as a missing one.
            expectNotFound(read);
          }
        }
      },
    );
  });

  /*
   * AN AI INSIGHT is about the service it names, when it names one: it
   * follows that service's labels and owners. An insight about no service
   * is the project's own.
   */
  describe("an AI insight", () => {
    const projectInsights: Array<string> = [
      productionInsightId,
      stagingInsightId,
      projectInsightId,
    ].map(String);

    test.each([
      [
        "a grant over the project reads every insight of the project",
        [{ permission: Permission.ProjectMember }],
        projectInsights,
      ],
      [
        "a block with labels leaves out the insights about labelled services",
        [
          { permission: Permission.ProjectMember },
          {
            permission: Permission.ProjectMember,
            labelIds: [productionLabelId],
            isBlock: true,
          },
        ],
        [stagingInsightId.toString(), projectInsightId.toString()],
      ],
      [
        "a grant limited to labels reads the insights about those services and the project's own",
        [
          {
            permission: Permission.ProjectMember,
            labelIds: [productionLabelId],
          },
        ],
        [productionInsightId.toString(), projectInsightId.toString()],
      ],
      [
        "a grant limited to owned records reads the insights about owned services and the project's own",
        [
          {
            permission: Permission.ProjectMember,
            scope: PermissionScope.Owned,
          },
        ],
        [productionInsightId.toString(), projectInsightId.toString()],
      ],
    ] as Array<[string, Array<PermissionRow>, Array<string>]>)(
      "%s",
      async (
        _label: string,
        rows: Array<PermissionRow>,
        expected: Array<string>,
      ) => {
        await setTeamPermissions(homeTeamId, homeProjectId, rows);

        const listed: Outcome = await list("/ai-insight", homeUser);

        expect(listed.error).toBeUndefined();
        expect(listed.ids).toEqual(sorted(expected));
        expect(listed.count).toBe(expected.length);

        for (const id of projectInsights) {
          const read: Outcome = await getItem(
            "/ai-insight",
            homeUser,
            new ObjectID(id),
          );

          expect(read.item ? read.item.id!.toString() : null).toBe(
            expected.includes(id) ? id : null,
          );

          if (!expected.includes(id)) {
            expectNotFound(read);
          }
        }
      },
    );

    test("another project's service and insights are not reached", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.ProjectMember },
      ]);

      for (const query of [
        { telemetryServiceId: otherServiceId.toString() },
        { project: otherProjectId.toString() },
        { _id: otherInsightId.toString() },
      ] as Array<JSONObject>) {
        const listed: Outcome = await list("/ai-insight", homeUser, query);

        expect(listed.ids).toEqual([]);
        expect(listed.count).toBe(0);
      }

      expectNotFound(await getItem("/ai-insight", homeUser, otherInsightId));
    });

    test("a block with labels holds on a delete", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.ProjectAdmin },
        {
          permission: Permission.ProjectAdmin,
          labelIds: [productionLabelId],
          isBlock: true,
        },
      ]);

      for (const [serviceId, isDeletable] of [
        [productionServiceId, false],
        [stagingServiceId, true],
        [null, true],
      ] as Array<[ObjectID | null, boolean]>) {
        const id: ObjectID = ObjectID.generate();

        await insertInsight({
          id: id,
          projectId: homeProjectId,
          serviceId: serviceId,
        });

        const outcome: Outcome = await remove("/ai-insight", homeUser, id);

        expect(await rowExists("AIInsight", id)).toBe(!isDeletable);

        if (!isDeletable) {
          expectRefused(outcome);
        }

        await removeRows([["AIInsight", "_id", id]]);
      }
    });
  });

  /*
   * THE WORK PER REQUEST: the label rule is part of the query the database
   * runs, so a request runs the same statements however many rows it reads.
   */
  describe("the work per request", () => {
    const statementsOf: (
      run: () => Promise<Outcome>,
    ) => Promise<number> = async (
      run: () => Promise<Outcome>,
    ): Promise<number> => {
      const before: number = statements.length;
      const outcome: Outcome = await run();

      expect(outcome.error).toBeUndefined();

      return statements.length - before;
    };

    test("does not grow with the rows a request reads", async () => {
      await setTeamPermissions(homeTeamId, homeProjectId, [
        { permission: Permission.AlertMember },
        ...alertBlocks([productionLabelId]),
      ]);
      await setTeamPermissions(secondTeamId, secondProjectId, [
        { permission: Permission.AlertMember },
        {
          permission: Permission.ReadAlert,
          labelIds: [secondProductionLabelId],
          isBlock: true,
        },
      ]);

      const requests: Array<() => Promise<Outcome>> = [
        (): Promise<Outcome> => {
          return list("/alert", acrossProjects);
        },
        (): Promise<Outcome> => {
          return list("/alert", homeUser);
        },
        (): Promise<Outcome> => {
          return list("/alert-internal-note", homeUser);
        },
      ];

      // Warm what a first request reads once.
      for (const request of requests) {
        await statementsOf(request);
      }

      const before: Array<number> = [];

      for (const request of requests) {
        before.push(await statementsOf(request));
      }

      for (let index: number = 0; index < 20; index++) {
        for (const [projectId, labelIds] of [
          [homeProjectId, [productionLabelId]],
          [homeProjectId, [stagingLabelId]],
          [homeProjectId, []],
          [secondProjectId, [secondProductionLabelId]],
        ] as Array<[ObjectID, Array<ObjectID>]>) {
          const alertId: ObjectID = ObjectID.generate();

          await insertAlert({
            id: alertId,
            projectId: projectId,
            title: "Bulk alert",
            labelIds: labelIds,
          });
          await insertNote({
            id: ObjectID.generate(),
            projectId: projectId,
            alertId: alertId,
          });
        }
      }

      const after: Array<number> = [];

      for (const request of requests) {
        after.push(await statementsOf(request));
      }

      expect(after).toEqual(before);
    });
  });
});
