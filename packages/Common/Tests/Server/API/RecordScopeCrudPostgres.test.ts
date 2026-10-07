import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
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
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
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
        expect((await getItem("/alert", caller, otherAlertId)).item).toBeNull();
        expect(
          (await getItem("/alert", caller, otherLabelledAlertId)).item,
        ).toBeNull();
        expect(
          (await getItem("/alert-internal-note", caller, otherNoteId)).item,
        ).toBeNull();
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
        await remove("/alert-internal-note", caller, otherNoteId);
        await remove("/alert", caller, otherAlertId);
        await remove("/alert", caller, otherLabelledAlertId);

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

        expect(
          (await getItem("/alert", labelCaller, otherLabelledAlertId)).item,
        ).toBeNull();
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
    expect((await getItem("/alert", caller, otherAlertId)).item).toBeNull();
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
                  expect(read.item).toBeNull();
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
   * A RECORD READ THROUGH ITS PARENT (an alert's internal note) is deleted
   * with its own delete permissions, from a parent the caller may read: the
   * parent's delete grants are about deleting the parent.
   */
  describe("a delete of a record read through its parent", () => {
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

          expect([id.toString(), Boolean(read.item)]).toEqual([
            id.toString(),
            expected.some((expectedId: ObjectID): boolean => {
              return expectedId.toString() === id.toString();
            }),
          ]);
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

      expect(
        (await getItem("/ai-insight", homeUser, otherInsightId)).item,
      ).toBeNull();
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
