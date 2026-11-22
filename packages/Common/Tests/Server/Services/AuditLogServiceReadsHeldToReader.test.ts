import "../TestingUtils/Init";
import BaseAnalyticsAPI from "../../../Server/API/BaseAnalyticsAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import CloudBudgetService from "../../../Server/Services/CloudBudgetService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectService from "../../../Server/Services/ProjectService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import { AuditLogService } from "../../../Server/Services/AuditLogService";
import AggregateBy from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import CountBy from "../../../Server/Types/AnalyticsDatabase/CountBy";
import ExistsBy from "../../../Server/Types/AnalyticsDatabase/ExistsBy";
import FindBy from "../../../Server/Types/AnalyticsDatabase/FindBy";
import DatabaseFindBy from "../../../Server/Types/Database/FindBy";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AuditLog from "../../../Models/AnalyticsModels/AuditLog";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudBudget from "../../../Models/DatabaseModels/CloudBudget";
import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import { AUDIT_LOG_HIDDEN_VALUE } from "../../../Types/AuditLog/AuditLogHiddenValues";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Dictionary from "../../../Types/Dictionary";
import JSONFunctions from "../../../Types/JSONFunctions";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { mockRouter } from "../API/Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

/*
 * EVERY READ OF THE AUDIT LOG IS HELD TO ITS READER'S READ OF THE RECORDS
 * (#10642): the list, an entry, the count beside the list, an aggregate and
 * an existence check, through the routes the App serves for /audit-log
 * (BaseAnalyticsAPI) - which the Dashboard, an API key and the MCP server
 * all read through - and AuditLogService itself. The read checks are the
 * real ones; only ClickHouse, and the reader's own read of the records
 * entries are about, are answered here.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10642000-0000-4000-8000-000000000101",
);
const USER_ID: ObjectID = new ObjectID("10642000-0000-4000-8000-000000000102");
const CASE_ID: ObjectID = new ObjectID("10642000-0000-4000-8000-0000000001c1");
const BUDGET_ID: ObjectID = new ObjectID(
  "10642000-0000-4000-8000-0000000001b1",
);

const SECURITY_CASE: string = "Security Case";
const CLOUD_BUDGET: string =
  new CloudBudget().apiSingularName || new CloudBudget().singularName || "";

// Two entries as ClickHouse stores them: a security case's, a budget's.
const STORED_ENTRIES: Array<JSONObject> = [
  {
    _id: "10642000-0000-4000-8000-0000000001e1",
    projectId: PROJECT_ID.toString(),
    createdAt: "2026-11-20 10:00:00",
    resourceType: SECURITY_CASE,
    resourceId: CASE_ID.toString(),
    resourceName: "Ransomware on the payments host",
    action: AuditLogAction.Update,
    userEmail: "jane@example.com",
    changes: JSON.stringify([
      { field: "verdict", oldValue: "Suspicious", newValue: "Malicious" },
      {
        field: "aiTriageReport",
        oldValue: null,
        newValue: "The host payments-01 encrypted 4,000 files",
      },
    ]),
  },
  {
    _id: "10642000-0000-4000-8000-0000000001e2",
    projectId: PROJECT_ID.toString(),
    createdAt: "2026-11-20 09:00:00",
    resourceType: CLOUD_BUDGET,
    resourceId: BUDGET_ID.toString(),
    resourceName: "Production spend",
    action: AuditLogAction.Update,
    userEmail: "jane@example.com",
    changes: JSON.stringify([
      { field: "name", oldValue: "Prod", newValue: "Production spend" },
    ]),
  },
];

interface Row {
  permission: Permission;
  labelIds?: Array<ObjectID> | undefined;
  isBlockPermission?: boolean | undefined;
}

function toTenantPermission(rows: Array<Row>): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows.map((row: Row): UserPermission => {
      return {
        _type: "UserPermission",
        permission: row.permission,
        labelIds: row.labelIds || [],
        isBlockPermission: Boolean(row.isBlockPermission),
      };
    }),
  };
}

// A person's request, as getUserMiddleware leaves it.
function personRequest(rows: Array<Row>, body: JSONObject): ExpressRequest {
  const tenantPermissions: Dictionary<UserTenantAccessPermission> = {
    [PROJECT_ID.toString()]: toTenantPermission([
      { permission: Permission.CurrentUser },
      { permission: Permission.ProjectUser },
      ...rows,
    ]),
  };

  return {
    params: {},
    query: {},
    headers: { tenantid: PROJECT_ID.toString() },
    body: body,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userAuthorization: {
      userId: USER_ID,
      email: "reader@example.com",
      name: "Reader",
      isMasterAdmin: false,
    },
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: tenantPermissions,
    userTeamIds: [],
  } as unknown as ExpressRequest;
}

// A project API key's request, as ProjectMiddleware leaves it.
function apiKeyRequest(rows: Array<Row>, body: JSONObject): ExpressRequest {
  return {
    params: {},
    query: {},
    headers: {},
    body: body,
    tenantId: PROJECT_ID,
    userType: UserType.API,
    apiKeyId: ObjectID.generate(),
    apiKeyName: "SIEM reader",
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: toTenantPermission(rows),
    },
  } as unknown as ExpressRequest;
}

const SETTINGS_ADMIN: Array<Row> = [{ permission: Permission.SettingsAdmin }];
const READ_AUDIT_LOG: Array<Row> = [{ permission: Permission.ReadAuditLog }];
const PROJECT_ADMIN: Array<Row> = [{ permission: Permission.ProjectAdmin }];

const SELECT_EVERYTHING_THE_TABLE_SHOWS: JSONObject = {
  createdAt: true,
  action: true,
  userEmail: true,
  resourceName: true,
  changes: true,
};

let service: AuditLogService;
let statements: Array<{ kind: string; statement: Statement }>;
let lastColumns: Array<string>;
let lastKind: string;
// The resource types the entries a grouped read matches carry.
let matchedTypes: Array<string>;
let countAnswer: number;

async function callRoute(
  method: "POST",
  uri: string,
  req: ExpressRequest,
): Promise<{ thrownToNext: unknown }> {
  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  let thrownToNext: unknown = undefined;

  await mockRouter.match(method, uri).handlerFunction(req, res, ((
    err?: unknown,
  ) => {
    thrownToNext = err;
  }) as NextFunction);

  return { thrownToNext };
}

function sentList(): Array<AuditLog> {
  const sendEntityArrayResponse: jest.Mock =
    Response.sendEntityArrayResponse as unknown as jest.Mock;

  expect(sendEntityArrayResponse).toHaveBeenCalledTimes(1);

  return sendEntityArrayResponse.mock.calls[0]![2] as Array<AuditLog>;
}

function sentJson(): JSONObject {
  const sendJsonObjectResponse: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  expect(sendJsonObjectResponse).toHaveBeenCalledTimes(1);

  return sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
}

function changesOf(entry: AuditLog): Array<JSONObject> {
  return (entry.changes || []) as Array<JSONObject>;
}

type AnyService = DatabaseService<BaseModel>;

/*
 * What the reader's own read of a table finds, for the tables a test names:
 * answered from DatabaseService's own findBy, so each service still reads as
 * one that narrows its reads before querying only
 * (readsEveryRecordInProject).
 */
const foundByService: Map<
  AnyService,
  { ids: Array<ObjectID>; asked: Array<DatabaseFindBy<BaseModel>> }
> = new Map();

function answerRecordReads(): void {
  const original: AnyService["findBy"] = DatabaseService.prototype.findBy;

  jest
    .spyOn(DatabaseService.prototype, "findBy")
    .mockImplementation(async function (
      this: AnyService,
      findBy: DatabaseFindBy<BaseModel>,
    ): Promise<Array<BaseModel>> {
      const found:
        | { ids: Array<ObjectID>; asked: Array<DatabaseFindBy<BaseModel>> }
        | undefined = foundByService.get(this);

      if (!found) {
        return await original.call(this, findBy);
      }

      found.asked.push(findBy);

      const condition: FindOperator<unknown> = (
        findBy.query as unknown as { _id: FindOperator<unknown> }
      )._id;
      const askedIds: Array<string> = Object.values(
        condition.objectLiteralParameters || {},
      )[0] as Array<string>;

      return found.ids
        .filter((id: ObjectID): boolean => {
          return askedIds.includes(id.toString());
        })
        .map((id: ObjectID): BaseModel => {
          const model: BaseModel = new this.modelType() as BaseModel;
          model._id = id.toString();
          return model;
        });
    } as never);
}

// The reader's own read of security cases finds `ids`.
function casesFound(ids: Array<ObjectID>): Array<DatabaseFindBy<BaseModel>> {
  const asked: Array<DatabaseFindBy<BaseModel>> = [];

  foundByService.set(SecurityCaseService as unknown as AnyService, {
    ids,
    asked,
  });

  return asked;
}

describe("AuditLogService: every read held to its reader", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRouter.routes = [];

    // The plan that gates nothing: only the permissions here decide.
    getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Enterprise,
      isSubscriptionUnpaid: false,
    });
    getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(
      undefined,
    );

    service = new AuditLogService();
    new BaseAnalyticsAPI<AuditLog, AuditLogService>(AuditLog, service);

    statements = [];
    lastColumns = [];
    lastKind = "";
    matchedTypes = [SECURITY_CASE, CLOUD_BUDGET];
    countAnswer = 2;

    const originalFind: AuditLogService["toFindStatement"] =
      service.toFindStatement.bind(service);
    jest
      .spyOn(service, "toFindStatement")
      .mockImplementation((findBy: FindBy<AuditLog>) => {
        const built: ReturnType<AuditLogService["toFindStatement"]> =
          originalFind(findBy);
        lastKind =
          findBy.groupBy && Object.keys(findBy.groupBy).length > 0
            ? "grouped"
            : "find";
        lastColumns = built.columns;
        statements.push({ kind: lastKind, statement: built.statement });
        return built;
      });

    const originalCount: AuditLogService["toCountStatement"] =
      service.toCountStatement.bind(service);
    jest
      .spyOn(service, "toCountStatement")
      .mockImplementation((countBy: CountBy<AuditLog>) => {
        const built: Statement = originalCount(countBy);
        lastKind = "count";
        statements.push({ kind: lastKind, statement: built });
        return built;
      });

    const originalExists: AuditLogService["toExistsStatement"] =
      service.toExistsStatement.bind(service);
    jest
      .spyOn(service, "toExistsStatement")
      .mockImplementation((existsBy: ExistsBy<AuditLog>) => {
        const built: Statement = originalExists(existsBy);
        lastKind = "exists";
        statements.push({ kind: lastKind, statement: built });
        return built;
      });

    const originalAggregate: AuditLogService["toAggregateStatement"] =
      service.toAggregateStatement.bind(service);
    jest
      .spyOn(service, "toAggregateStatement")
      .mockImplementation((aggregateBy: AggregateBy<AuditLog>) => {
        const built: ReturnType<AuditLogService["toAggregateStatement"]> =
          originalAggregate(aggregateBy);
        lastKind = "aggregate";
        statements.push({ kind: lastKind, statement: built.statement });
        return built;
      });

    jest.spyOn(service, "executeQuery").mockImplementation(() => {
      let data: Array<JSONObject> = [];

      if (lastKind === "grouped") {
        data = matchedTypes.map((resourceType: string): JSONObject => {
          return { resourceType };
        });
      } else if (lastKind === "find") {
        data = STORED_ENTRIES.map((stored: JSONObject): JSONObject => {
          const row: JSONObject = {};

          for (const column of lastColumns) {
            if (stored[column] !== undefined) {
              row[column] = stored[column]!;
            }
          }

          return row;
        });
      } else if (lastKind === "count") {
        data = [{ count: String(countAnswer) }];
      } else if (lastKind === "exists") {
        data = [{ exists: 1 }];
      } else if (lastKind === "aggregate") {
        data = [{ createdAt: "2026-11-20 10:00:00", _id: 2 }];
      }

      return Promise.resolve({
        json: () => {
          return Promise.resolve({ data });
        },
      } as never);
    });

    // The reader's read of budgets finds the budget, for those who read one.
    foundByService.clear();
    answerRecordReads();
    foundByService.set(CloudBudgetService as unknown as AnyService, {
      ids: [BUDGET_ID],
      asked: [],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    foundByService.clear();
  });

  describe("the list (POST /audit-log/get-list)", () => {
    test("a Settings Admin's list names the security case's fields, with no values and no name; the budget, theirs to read, reads as recorded", async () => {
      casesFound([CASE_ID]);

      const result: { thrownToNext: unknown } = await callRoute(
        "POST",
        "/audit-log/get-list",
        personRequest(SETTINGS_ADMIN, {
          query: {},
          select: SELECT_EVERYTHING_THE_TABLE_SHOWS,
        }),
      );

      expect(result.thrownToNext).toBeUndefined();

      const [caseEntry, budgetEntry] = sentList();

      expect(caseEntry!.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
      expect(changesOf(caseEntry!)).toEqual([
        {
          field: "verdict",
          valueHidden: true,
          oldValue: AUDIT_LOG_HIDDEN_VALUE,
          newValue: AUDIT_LOG_HIDDEN_VALUE,
        },
        {
          field: "aiTriageReport",
          valueHidden: true,
          oldValue: AUDIT_LOG_HIDDEN_VALUE,
          newValue: AUDIT_LOG_HIDDEN_VALUE,
        },
      ]);
      expect(caseEntry!.userEmail).toBe("jane@example.com");

      expect(budgetEntry!.resourceName).toBe("Production spend");
      expect(changesOf(budgetEntry!)).toEqual([
        { field: "name", oldValue: "Prod", newValue: "Production spend" },
      ]);

      /*
       * The columns the hold reads by were read with the list, and are not
       * handed back: the list asked for neither.
       */
      const find: Statement = statements.find(
        (item: { kind: string }): boolean => {
          return item.kind === "find";
        },
      )!.statement;
      expect(JSON.stringify(find.query_params)).toContain("resourceType");
      expect(JSON.stringify(find.query_params)).toContain("resourceId");
      expect(caseEntry!.toJSON()["resourceType"]).toBeUndefined();
      expect(caseEntry!.toJSON()["resourceId"]).toBeUndefined();
    });

    test("an API key with Read Audit Log reads no values of either: it may read neither record", async () => {
      casesFound([CASE_ID]);

      await callRoute(
        "POST",
        "/audit-log/get-list",
        apiKeyRequest(READ_AUDIT_LOG, {
          query: {},
          select: SELECT_EVERYTHING_THE_TABLE_SHOWS,
        }),
      );

      for (const entry of sentList()) {
        expect(entry.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);

        for (const change of changesOf(entry)) {
          expect(change["valueHidden"]).toBe(true);
        }
      }

      expect(
        JSON.stringify(
          sentList().map((entry: AuditLog) => {
            return entry.toJSON();
          }),
        ),
      ).not.toMatch(/Malicious|payments-01|Production spend|Prod\b/);
    });

    test("a Project Admin's list reads every entry as recorded", async () => {
      casesFound([CASE_ID]);

      await callRoute(
        "POST",
        "/audit-log/get-list",
        personRequest(PROJECT_ADMIN, {
          query: {},
          select: SELECT_EVERYTHING_THE_TABLE_SHOWS,
        }),
      );

      const [caseEntry, budgetEntry] = sentList();

      expect(caseEntry!.resourceName).toBe("Ransomware on the payments host");
      expect(changesOf(caseEntry!)[0]).toEqual({
        field: "verdict",
        oldValue: "Suspicious",
        newValue: "Malicious",
      });
      expect(budgetEntry!.resourceName).toBe("Production spend");
    });

    test("a list that reads neither names nor changes looks no record up", async () => {
      const asked: Array<DatabaseFindBy<BaseModel>> = casesFound([CASE_ID]);
      const readsEvery: jest.SpyInstance = getJestSpyOn(
        SecurityCaseService,
        "readsEveryRecordInProject",
      );

      await callRoute(
        "POST",
        "/audit-log/get-list",
        personRequest(SETTINGS_ADMIN, {
          query: {},
          select: { createdAt: true, action: true, userEmail: true },
        }),
      );

      expect(sentList()).toHaveLength(2);
      expect(asked).toHaveLength(0);
      expect(readsEvery).not.toHaveBeenCalled();
      expect(
        statements.filter((item: { kind: string }): boolean => {
          return item.kind === "grouped";
        }),
      ).toHaveLength(0);
    });

    test("a filter on the resource name reads only the types whose names the reader reads in full", async () => {
      casesFound([CASE_ID]);

      await callRoute(
        "POST",
        "/audit-log/get-list",
        personRequest(SETTINGS_ADMIN, {
          query: { resourceName: { _type: "Search", value: "pay" } },
          select: SELECT_EVERYTHING_THE_TABLE_SHOWS,
        }),
      );

      // First the types the filter matches, then the list, of those read in full.
      expect(
        statements.map((item: { kind: string }): string => {
          return item.kind;
        }),
      ).toEqual(["grouped", "find"]);

      const find: Statement = statements[1]!.statement;
      const params: string = JSON.stringify(find.query_params);
      expect(params).toContain(CLOUD_BUDGET);
      expect(params).not.toContain(SECURITY_CASE);
    });

    test("an order by the resource name is held the same way", async () => {
      casesFound([CASE_ID]);

      await callRoute(
        "POST",
        "/audit-log/get-list",
        personRequest(SETTINGS_ADMIN, {
          query: {},
          select: SELECT_EVERYTHING_THE_TABLE_SHOWS,
          sort: { resourceName: SortOrder.Ascending },
        }),
      );

      const find: Statement = statements[statements.length - 1]!.statement;
      expect(JSON.stringify(find.query_params)).not.toContain(SECURITY_CASE);
    });

    test("a list grouped by the resource name groups only the names the reader reads", async () => {
      casesFound([CASE_ID]);

      await callRoute(
        "POST",
        "/audit-log/get-list",
        personRequest(SETTINGS_ADMIN, {
          query: {},
          groupBy: { resourceName: true },
        }),
      );

      const grouped: Array<{ kind: string; statement: Statement }> =
        statements.filter((item: { kind: string }): boolean => {
          return item.kind === "grouped";
        });

      // The types it matches, then the grouped list itself, of those only.
      expect(grouped).toHaveLength(2);
      expect(JSON.stringify(grouped[1]!.statement.query_params)).not.toContain(
        SECURITY_CASE,
      );
    });

    test("the Resource Type filter's options (grouped by type) are no name and look nothing up", async () => {
      const asked: Array<DatabaseFindBy<BaseModel>> = casesFound([CASE_ID]);

      await callRoute(
        "POST",
        "/audit-log/get-list",
        personRequest(SETTINGS_ADMIN, {
          query: {},
          select: { resourceType: true },
          groupBy: { resourceType: true },
          sort: { resourceType: SortOrder.Ascending },
        }),
      );

      expect(statements).toHaveLength(1);
      expect(asked).toHaveLength(0);
    });

    test("a filter that leaves the reader nothing they read in full answers no entries, and reads none", async () => {
      matchedTypes = [SECURITY_CASE];
      casesFound([CASE_ID]);

      await callRoute(
        "POST",
        "/audit-log/get-list",
        personRequest(SETTINGS_ADMIN, {
          query: { resourceName: { _type: "Search", value: "Ransom" } },
          select: SELECT_EVERYTHING_THE_TABLE_SHOWS,
        }),
      );

      expect(sentList()).toHaveLength(0);
      expect(
        statements.map((item: { kind: string }): string => {
          return item.kind;
        }),
      ).toEqual(["grouped"]);
    });
  });

  describe("an entry (POST /audit-log/:id/get-item)", () => {
    test("an API key with Read Audit Log reads the security case's entry without its values or name", async () => {
      casesFound([CASE_ID]);

      const req: ExpressRequest = apiKeyRequest(READ_AUDIT_LOG, {
        select: SELECT_EVERYTHING_THE_TABLE_SHOWS,
      });
      (req as unknown as { params: JSONObject }).params = {
        id: STORED_ENTRIES[0]!["_id"]!,
      };

      const result: { thrownToNext: unknown } = await callRoute(
        "POST",
        "/audit-log/:id/get-item",
        req,
      );

      expect(result.thrownToNext).toBeUndefined();

      const sendEntityResponse: jest.Mock =
        Response.sendEntityResponse as unknown as jest.Mock;
      const entry: AuditLog = sendEntityResponse.mock.calls[0]![2] as AuditLog;

      expect(entry.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);
      expect(changesOf(entry)[0]!["valueHidden"]).toBe(true);
      expect(changesOf(entry)[0]!["newValue"]).toBe(AUDIT_LOG_HIDDEN_VALUE);
    });
  });

  describe("the count (POST /audit-log/count)", () => {
    test("counts, by a resource name, only the entries whose names the reader reads", async () => {
      casesFound([CASE_ID]);

      await callRoute(
        "POST",
        "/audit-log/count",
        personRequest(SETTINGS_ADMIN, {
          query: { resourceName: { _type: "Search", value: "pay" } },
        }),
      );

      expect(sentJson()).toEqual({ count: 2 });

      const count: Statement = statements.find(
        (item: { kind: string }): boolean => {
          return item.kind === "count";
        },
      )!.statement;
      expect(JSON.stringify(count.query_params)).toContain(CLOUD_BUDGET);
      expect(JSON.stringify(count.query_params)).not.toContain(SECURITY_CASE);
    });

    test("is 0, unread, when the filter matches only entries whose names the reader may not read", async () => {
      matchedTypes = [SECURITY_CASE];

      await callRoute(
        "POST",
        "/audit-log/count",
        apiKeyRequest(READ_AUDIT_LOG, {
          query: { resourceName: { _type: "Search", value: "Ransom" } },
        }),
      );

      expect(sentJson()).toEqual({ count: 0 });
      expect(
        statements.filter((item: { kind: string }): boolean => {
          return item.kind === "count";
        }),
      ).toHaveLength(0);
    });

    test("a count by anything else is the list's count, held to nothing", async () => {
      await callRoute(
        "POST",
        "/audit-log/count",
        personRequest(SETTINGS_ADMIN, {
          query: { action: AuditLogAction.Update },
        }),
      );

      expect(sentJson()).toEqual({ count: 2 });
      expect(
        statements.map((item: { kind: string }): string => {
          return item.kind;
        }),
      ).toEqual(["count"]);
    });
  });

  describe("an aggregate (POST /audit-log/aggregate)", () => {
    test("grouped by the resource name, it groups only names the reader reads - and is never served from the shared cache", async () => {
      casesFound([CASE_ID]);
      const cacheRead: jest.SpyInstance = getJestSpyOn(
        GlobalCache,
        "getJSONObject",
      );
      const cacheWrite: jest.SpyInstance = getJestSpyOn(GlobalCache, "setJSON");

      const result: { thrownToNext: unknown } = await callRoute(
        "POST",
        "/audit-log/aggregate",
        personRequest(SETTINGS_ADMIN, {
          aggregateBy: JSONFunctions.serialize({
            query: {},
            aggregateColumnName: "_id",
            aggregationTimestampColumnName: "createdAt",
            aggregationType: AggregationType.Count,
            startTimestamp: new Date("2026-11-19T00:00:00.000Z"),
            endTimestamp: new Date("2026-11-21T00:00:00.000Z"),
            groupBy: { resourceName: true },
            limit: 10,
            skip: 0,
          } as JSONObject),
        }),
      );

      expect(result.thrownToNext).toBeUndefined();

      const aggregate: Statement = statements.find(
        (item: { kind: string }): boolean => {
          return item.kind === "aggregate";
        },
      )!.statement;
      expect(JSON.stringify(aggregate.query_params)).not.toContain(
        SECURITY_CASE,
      );

      expect(service.sharesAggregatesAcrossReaders()).toBe(false);
      expect(cacheRead).not.toHaveBeenCalled();
      expect(cacheWrite).not.toHaveBeenCalled();
    });

    test("left nothing it reads in full, it answers no rows, unread", async () => {
      matchedTypes = [SECURITY_CASE];

      await callRoute(
        "POST",
        "/audit-log/aggregate",
        apiKeyRequest(READ_AUDIT_LOG, {
          aggregateBy: JSONFunctions.serialize({
            query: { changes: new Search("Malicious") },
            aggregateColumnName: "_id",
            aggregationTimestampColumnName: "createdAt",
            aggregationType: AggregationType.Count,
            startTimestamp: new Date("2026-11-19T00:00:00.000Z"),
            endTimestamp: new Date("2026-11-21T00:00:00.000Z"),
            limit: 10,
            skip: 0,
          } as JSONObject),
        }),
      );

      expect(sentJson()["data"]).toEqual([]);
      expect(
        statements.filter((item: { kind: string }): boolean => {
          return item.kind === "aggregate";
        }),
      ).toHaveLength(0);
    });
  });

  describe("an existence check (existsBy)", () => {
    test("by the changes, it finds only entries whose values the reader reads in full", async () => {
      matchedTypes = [SECURITY_CASE];

      await expect(
        service.existsBy({
          query: { changes: new Search("Malicious") },
          props: {
            userId: USER_ID,
            userType: UserType.User,
            tenantId: PROJECT_ID,
            userTenantAccessPermission: {
              [PROJECT_ID.toString()]: toTenantPermission([
                ...SETTINGS_ADMIN,
                { permission: Permission.CurrentUser },
              ]),
            },
            currentPlan: PlanType.Enterprise,
            isSubscriptionUnpaid: false,
          },
        }),
      ).resolves.toBe(false);

      expect(
        statements.filter((item: { kind: string }): boolean => {
          return item.kind === "exists";
        }),
      ).toHaveLength(0);
    });

    test("by anything else it is asked as it was", async () => {
      await expect(
        service.existsBy({
          query: { action: AuditLogAction.Update },
          props: { isRoot: true, tenantId: PROJECT_ID },
        }),
      ).resolves.toBe(true);
    });
  });

  describe("OneUptime itself and a server admin", () => {
    test.each([
      ["OneUptime itself", { isRoot: true }],
      ["a server admin", { isMasterAdmin: true, userId: USER_ID }],
    ])(
      "%s reads every entry as recorded, filters by names included",
      async (_name: string, extra: DatabaseCommonInteractionProps) => {
        const asked: Array<DatabaseFindBy<BaseModel>> = casesFound([]);

        const entries: Array<AuditLog> = await service.findBy({
          query: { resourceName: new Search("pay") },
          select: { resourceName: true, changes: true },
          skip: 0,
          limit: 10,
          props: { tenantId: PROJECT_ID, ...extra },
        });

        expect(entries[0]!.resourceName).toBe(
          "Ransomware on the payments host",
        );
        expect(changesOf(entries[0]!)[0]!["newValue"]).toBe("Malicious");
        expect(asked).toHaveLength(0);
        expect(
          statements.map((item: { kind: string }): string => {
            return item.kind;
          }),
        ).toEqual(["find"]);
      },
    );
  });

  test("a query narrowed by type keeps to it: the hold reads the types the query itself matches", async () => {
    casesFound([CASE_ID]);
    matchedTypes = [CLOUD_BUDGET];

    const props: DatabaseCommonInteractionProps = {
      userId: USER_ID,
      userType: UserType.User,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: toTenantPermission([
          ...SETTINGS_ADMIN,
          { permission: Permission.CurrentUser },
        ]),
      },
      currentPlan: PlanType.Enterprise,
      isSubscriptionUnpaid: false,
    };

    await expect(
      service.countBy({
        query: {
          resourceType: new Includes([CLOUD_BUDGET]),
          resourceName: new Search("spend"),
        },
        props: props,
      }),
    ).resolves.toEqual(new PositiveNumber(2));

    // Everything it matched is read in full: the query is left as it was.
    const grouped: Statement = statements[0]!.statement;
    expect(JSON.stringify(grouped.query_params)).toContain(CLOUD_BUDGET);
    expect(
      statements.map((item: { kind: string }): string => {
        return item.kind;
      }),
    ).toEqual(["grouped", "count"]);
  });
});
