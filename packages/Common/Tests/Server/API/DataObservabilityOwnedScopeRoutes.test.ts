import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import { FindOperator } from "typeorm";
import CommonAPI from "../../../Server/API/CommonAPI";
import DataObservabilityAPI from "../../../Server/API/DataObservabilityAPI";
import AlertService from "../../../Server/Services/AlertService";
import DataAssetFeedService from "../../../Server/Services/DataAssetFeedService";
import DataAssetService from "../../../Server/Services/DataAssetService";
import DataCheckService from "../../../Server/Services/DataCheckService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import DataTableDashboards from "../../../Server/Utils/DataObservability/Bi/DataTableDashboards";
import DataAiAppTables from "../../../Server/Utils/DataObservability/DataAiAppTables";
import DataAlertExplanationReader from "../../../Server/Utils/DataObservability/DataAlertExplanation";
import DataCheckAlerts from "../../../Server/Utils/DataObservability/DataCheckAlerts";
import DataCheckFromSentence from "../../../Server/Utils/DataObservability/DataCheckFromSentence";
import DataObservabilityAttentionCount from "../../../Server/Utils/DataObservability/DataObservabilityAttentionCount";
import DataObservabilityAttentionReader, {
  DataObservabilityAttention,
} from "../../../Server/Utils/DataObservability/DataObservabilityAttentionReader";
import DataObservabilityIssues from "../../../Server/Utils/DataObservability/DataObservabilityIssues";
import DataObservabilityReadScope, {
  DataObservabilityScope,
} from "../../../Server/Utils/DataObservability/DataObservabilityReadScope";
import DataTableAnswerer from "../../../Server/Utils/DataObservability/DataTableAnswer";
import DataTableErrors from "../../../Server/Utils/DataObservability/DataTableErrors";
import DataTableSensitivity from "../../../Server/Utils/DataObservability/DataTableSensitivity";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Alert from "../../../Models/DatabaseModels/Alert";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import {
  DATA_OBSERVABILITY_API_ROUTES,
  DataObservabilityAiAppTable,
  DataObservabilityIssuesResponse,
  DataObservabilityOverview,
  DataObservabilityStoreSummary,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import {
  DataAttentionItem,
  DataAttentionKind,
  DataCheckHealth,
  DataCheckHealthAnswer,
} from "../../../Types/DataObservability/DataObservabilityAttention";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

/*
 * DATA OBSERVABILITY'S OWN ROUTES ANSWER ONLY ABOUT WHAT THE CALLER MAY READ
 * (#6553).
 *
 * A role limited to what its members own, or to some labels, reads those
 * tables, checks and pipelines on the generic routes. Data Observability's
 * own routes - the Overview, the Issues page, the menu's count, a check's
 * health, a table's answers - read as OneUptime, so each narrows its reads
 * by the caller's scope (DataObservabilityReadScope, pinned on its own):
 * lists hold, and counts count, the records the caller may read; a route
 * about one table or check answers only for one they may read, or change;
 * and an alert is explained only to someone who may read it.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const MEMBER: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000001");

function id(suffix: string): string {
  return `33333333-3333-4333-8333-${suffix.padStart(12, "0")}`;
}

// A database holding a table the caller owns, and one holding none of theirs.
const STORE_OWNED: string = id("1");
const STORE_NOT_OWNED: string = id("2");
const TABLE_OWNED: string = id("101");
const TABLE_NOT_OWNED: string = id("102");
const CHECK_OWNED: string = id("201");
const CHECK_NOT_OWNED: string = id("202");
const ALERT: string = id("301");

function person(permission: Permission): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT,
    userId: MEMBER,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT,
        permissions: [
          {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
  };
}

// Someone who may read, or change, data assets: their role decides which.
const READER: DatabaseCommonInteractionProps = person(Permission.ReadDataAsset);
const EDITOR: DatabaseCommonInteractionProps = person(Permission.EditDataAsset);

// What a role limited to what its members own reads: the pipeline's query, here.
const OWNED_TABLES: FindOperator<unknown> = QueryHelper.any([TABLE_OWNED]);
const NARROWED: DataObservabilityScope = {
  isWholeProject: false,
  assetQuery: { projectId: PROJECT, _id: OWNED_TABLES },
  checkQuery: { projectId: PROJECT, dataAssetId: OWNED_TABLES },
  pipelineQuery: { projectId: PROJECT, _id: QueryHelper.any([]) },
};
const WHOLE_PROJECT: DataObservabilityScope =
  DataObservabilityReadScope.wholeProject(PROJECT);

function model<T>(Type: { new (): T }, fields: Record<string, unknown>): T {
  const row: T = new Type();

  for (const [column, value] of Object.entries(fields)) {
    (row as unknown as Record<string, unknown>)[column] = value;
  }

  return row;
}

function dataStore(storeId: string, name: string): DataStore {
  return model(DataStore, {
    _id: storeId,
    projectId: PROJECT,
    name,
    kind: DataStoreKind.PostgreSql,
    connectionString: "postgres://reader@db/orders",
    isTableHealthEnabled: true,
    tableHealthStatus: "Failed",
    tableHealthMessage: "password authentication failed",
    tableHealthAssetCount: 1,
  });
}

function table(tableId: string, storeId: string, key: string): DataAsset {
  return model(DataAsset, {
    _id: tableId,
    assetKey: key,
    assetKind: DataAssetKind.Table,
    dataStoreId: new ObjectID(storeId),
    dataStoreName: storeId === STORE_OWNED ? "orders-db" : "finance-db",
    // Every quarter of an hour, last changed four hours ago: late.
    lastChangedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
    updateIntervalInSeconds: 900,
    isDropped: false,
  });
}

let scope: DataObservabilityScope;
let assetQueries: Array<Record<string, unknown>>;
let feedQueries: Array<Record<string, unknown>>;

/*
 * The tables the database hands back for a query: the caller's own when
 * their scope narrows the read, every table when it does not.
 */
function tablesFor(query: Record<string, unknown>): Array<DataAsset> {
  const all: Array<DataAsset> = [
    table(TABLE_OWNED, STORE_OWNED, "public.orders"),
    table(TABLE_NOT_OWNED, STORE_NOT_OWNED, "public.salaries"),
  ];

  return query["_id"] ? [all[0]!] : all;
}

function stubSources(): void {
  scope = NARROWED;
  assetQueries = [];
  feedQueries = [];

  jest
    .spyOn(DataObservabilityReadScope, "get")
    .mockImplementation(async () => {
      return scope;
    });

  jest.spyOn(DataStoreService, "findBy").mockImplementation((async (findBy: {
    query: { kind?: Includes };
  }) => {
    // The databases; the buckets, which none of these are, come second.
    return findBy.query.kind?.values
      .map(String)
      .includes(DataStoreKind.PostgreSql)
      ? [
          dataStore(STORE_OWNED, "orders-db"),
          dataStore(STORE_NOT_OWNED, "finance-db"),
        ]
      : [];
  }) as never);

  jest.spyOn(DataAssetService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
  }) => {
    assetQueries.push(findBy.query);
    return tablesFor(findBy.query);
  }) as never);

  jest
    .spyOn(DataAssetFeedService, "countBy")
    .mockImplementation((async (countBy: {
      query: Record<string, unknown>;
    }) => {
      feedQueries.push(countBy.query);
      return {
        toNumber: (): number => {
          return 0;
        },
      };
    }) as never);
  jest
    .spyOn(DataAssetFeedService, "findBy")
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }) => {
      feedQueries.push(findBy.query);
      return [];
    }) as never);

  jest
    .spyOn(DataObservabilityAttentionReader, "getAlertMonitorCountByStore")
    .mockResolvedValue(new Map());
  jest
    .spyOn(DataObservabilityAttentionReader, "getOwnerCounts")
    .mockResolvedValue({ tableOwnerCount: 0, ownerRuleCount: 0 });
}

function attentionOf(items: Array<DataAttentionItem>): DataObservabilityAttention {
  return {
    items,
    failingCheckCount: 0,
    checkCount: 0,
    pipelineCount: 0,
    storeIdByCheckId: new Map(),
  };
}

function lateTableItem(tableId: string, storeId: string): DataAttentionItem {
  return {
    kind: DataAttentionKind.TableLate,
    name: tableId === TABLE_OWNED ? "public.orders" : "public.salaries",
    where: null,
    message: null,
    overdueBySeconds: 1_000,
    since: null,
    dataStoreId: storeId,
    dataAssetId: tableId,
    dataPipelineId: null,
    dataCheckId: null,
    dataProductId: null,
    dataReconciliationId: null,
    alert: null,
  };
}

type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RouteHandler }>;
  };
};

// A route's own handler - the last on it, past the session and off-switch middleware.
function routeHandler(path: string): RouteHandler {
  const router: ExpressRouter = new DataObservabilityAPI().getRouter();
  const layer: RouterLayer | undefined = (
    router as unknown as { stack: Array<RouterLayer> }
  ).stack.find((candidate: RouterLayer): boolean => {
    return (
      candidate.route?.path === path && candidate.route.methods["post"] === true
    );
  });

  expect(layer?.route?.stack.length).toBeGreaterThanOrEqual(3);

  return layer!.route!.stack[layer!.route!.stack.length - 1]!.handle;
}

interface RouteOutcome {
  sent: JSONObject | null;
  error: Error | null;
}

async function callRoute(data: {
  path: string;
  props: DatabaseCommonInteractionProps;
  body?: JSONObject;
  id?: string;
}): Promise<RouteOutcome> {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(data.props);

  const sent: Mock<(...args: Array<unknown>) => unknown> = jest.fn();
  const next: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

  jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation(sent as never);

  await routeHandler(data.path)(
    {
      body: data.body || {},
      params: data.id ? { id: data.id } : {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return {
    sent: sent.mock.calls[0] ? (sent.mock.calls[0][2] as JSONObject) : null,
    error: next.mock.calls[0] ? (next.mock.calls[0][0] as Error) : null,
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
  stubSources();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the menu's count", () => {
  test("counts what the caller may read: their scope, worked out from their own grants", async () => {
    const count: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataObservabilityAttentionCount, "count")
      .mockResolvedValue(3 as never);

    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.attentionCount,
      props: READER,
    });

    expect(outcome.error).toBeNull();
    expect(outcome.sent).toEqual({ count: 3 });
    expect(DataObservabilityReadScope.get).toHaveBeenCalledWith(
      PROJECT,
      READER,
    );
    expect(count).toHaveBeenCalledTimes(1);
    expect(count.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT,
      scope: NARROWED,
    });
    expect((count.mock.calls[0]![0] as { now: Date }).now).toBeInstanceOf(
      Date,
    );
  });

  test("a caller the scope refuses is told so, and nothing is counted", async () => {
    jest
      .spyOn(DataObservabilityReadScope, "get")
      .mockRejectedValue(new Error("You do not have permission.") as never);
    const count: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataObservabilityAttentionCount,
      "count",
    );

    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.attentionCount,
      props: READER,
    });

    expect(outcome.sent).toBeNull();
    expect(outcome.error?.message).toBe("You do not have permission.");
    expect(count).not.toHaveBeenCalled();
  });
});

describe("the Issues page", () => {
  test("is worked out from the tables, checks and pipelines the caller may read", async () => {
    const reads: Array<Parameters<typeof DataObservabilityAttentionReader.read>[0]> =
      [];

    jest
      .spyOn(DataObservabilityAttentionReader, "read")
      .mockImplementation(
        async (
          data: Parameters<typeof DataObservabilityAttentionReader.read>[0],
        ) => {
          reads.push(data);
          return attentionOf([lateTableItem(TABLE_OWNED, STORE_OWNED)]);
        },
      );
    const answer: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataObservabilityIssues, "answer")
      .mockResolvedValue({
        items: [],
        count: 1,
        totalCount: 1,
        skip: 0,
        limit: 25,
        stores: [],
        owners: [],
      } as DataObservabilityIssuesResponse as never);

    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.issues,
      props: READER,
      body: { limit: 10 },
    });

    expect(outcome.error).toBeNull();
    // The tables read are the caller's: their scope's query.
    expect(assetQueries).toEqual([NARROWED.assetQuery]);
    // Its checks and pipelines are read with the same scope.
    expect(reads).toHaveLength(1);
    expect(reads[0]!.scope).toBe(NARROWED);
    expect(reads[0]!.reader).toBe(READER);
    // Only the database holding a table of theirs.
    expect(
      reads[0]!.stores.map((store: DataObservabilityStoreSummary): string => {
        return store.dataStoreId;
      }),
    ).toEqual([STORE_OWNED]);
    expect(
      reads[0]!.lateAssets.map((late: { dataAssetId: string }): string => {
        return late.dataAssetId;
      }),
    ).toEqual([TABLE_OWNED]);

    const given: Parameters<typeof DataObservabilityIssues.answer>[0] = answer
      .mock.calls[0]![0] as Parameters<typeof DataObservabilityIssues.answer>[0];

    expect(given.reader).toBe(READER);
    expect(given.request).toEqual({ skip: 0, limit: 10 });
    expect(
      given.stores.map((store: DataObservabilityStoreSummary): string => {
        return store.dataStoreId;
      }),
    ).toEqual([STORE_OWNED]);
    expect(given.items).toHaveLength(1);
  });

  test("a filter it cannot read is refused before anything is read", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataObservabilityAttentionReader,
      "read",
    );

    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.issues,
      props: READER,
      body: { dataStoreId: "orders-db" },
    });

    expect(outcome.sent).toBeNull();
    expect(outcome.error?.message).toMatch(/database/i);
    expect(DataObservabilityReadScope.get).not.toHaveBeenCalled();
    expect(assetQueries).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("the Overview", () => {
  beforeEach(() => {
    jest
      .spyOn(DataObservabilityAttentionReader, "read")
      .mockResolvedValue(attentionOf([]));
  });

  test("counts the caller's tables, lists the databases holding them, and their schema changes only", async () => {
    const overview: DataObservabilityOverview =
      await DataObservabilityAPI.getOverview(PROJECT, READER);

    expect(assetQueries).toEqual([NARROWED.assetQuery]);
    expect(overview.assetCount).toBe(1);
    expect(overview.lateAssetCount).toBe(1);
    expect(
      overview.lateAssets.map((late: { dataAssetId: string }): string => {
        return late.dataAssetId;
      }),
    ).toEqual([TABLE_OWNED]);
    expect(
      overview.stores.map((store: DataObservabilityStoreSummary): string => {
        return store.name;
      }),
    ).toEqual(["orders-db"]);
    expect(overview.storeCount).toBe(1);
    expect(overview.failingStoreCount).toBe(1);
    expect(overview.setup.storeCount).toBe(1);

    // The schema changes counted and listed: of their tables only.
    expect(feedQueries).toHaveLength(2);

    for (const query of feedQueries) {
      expect(query["projectId"]).toEqual(PROJECT);
      expect(query["dataAssetId"]).toBeInstanceOf(FindOperator);
      expect(
        Object.values(
          (query["dataAssetId"] as FindOperator<unknown>)
            .objectLiteralParameters || {},
        ).flat(),
      ).toEqual([TABLE_OWNED]);
    }
  });

  test("a narrowed caller who may read no table sees no database and no schema change", async () => {
    jest.spyOn(DataAssetService, "findBy").mockResolvedValue([] as never);

    const overview: DataObservabilityOverview =
      await DataObservabilityAPI.getOverview(PROJECT, READER);

    expect(overview.stores).toEqual([]);
    expect(overview.assetCount).toBe(0);
    expect(overview.failingStoreCount).toBe(0);

    for (const query of feedQueries) {
      // No ids: a condition nothing matches, never one left off.
      expect(query["dataAssetId"]).toBeInstanceOf(FindOperator);
      expect(
        (query["dataAssetId"] as FindOperator<unknown>).getSql?.("c"),
      ).toBe("TRUE = FALSE");
    }
  });

  test("a caller who reads the whole project sees it all, as before", async () => {
    scope = WHOLE_PROJECT;

    const overview: DataObservabilityOverview =
      await DataObservabilityAPI.getOverview(PROJECT, READER);

    expect(assetQueries).toEqual([{ projectId: PROJECT }]);
    expect(overview.assetCount).toBe(2);
    expect(
      overview.stores.map((store: DataObservabilityStoreSummary): string => {
        return store.name;
      }),
    ).toEqual(["orders-db", "finance-db"]);

    for (const query of feedQueries) {
      expect(query["dataAssetId"]).toBeUndefined();
      expect(query["projectId"]).toEqual(PROJECT);
    }
  });
});

describe("the databases (stores route)", () => {
  test("a narrowed caller is told of the databases holding a table they may read", async () => {
    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.stores,
      props: READER,
    });

    expect(outcome.error).toBeNull();
    expect(
      (outcome.sent!["stores"] as Array<JSONObject>).map(
        (store: JSONObject): unknown => {
          return store["dataStoreId"];
        },
      ),
    ).toEqual([STORE_OWNED]);
  });

  test("a caller reading the whole project is told of every one", async () => {
    scope = WHOLE_PROJECT;

    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.stores,
      props: READER,
    });

    expect(
      (outcome.sent!["stores"] as Array<JSONObject>).map(
        (store: JSONObject): unknown => {
          return store["dataStoreId"];
        },
      ),
    ).toEqual([STORE_OWNED, STORE_NOT_OWNED]);
  });
});

describe("how each check stands (checkHealth route)", () => {
  test("a check the caller may not read is left out, as a check of another project is", async () => {
    const checkQueries: Array<Record<string, unknown>> = [];

    jest.spyOn(DataCheckService, "findBy").mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }) => {
      checkQueries.push(findBy.query);
      // The database narrows the read: their check only.
      return [model(DataCheck, { _id: CHECK_OWNED, isEnabled: true })];
    }) as never);
    const health: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataObservabilityAttentionReader, "getCheckHealth")
      .mockImplementation((async (data: { checks: Array<DataCheck> }) => {
        return new Map<string, DataCheckHealthAnswer>(
          data.checks.map((check: DataCheck) => {
            return [
              check.id!.toString(),
              { health: DataCheckHealth.Failing, alert: null },
            ];
          }),
        );
      }) as never);

    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.checkHealth,
      props: READER,
      body: { dataCheckIds: [CHECK_OWNED, CHECK_NOT_OWNED] },
    });

    expect(outcome.error).toBeNull();
    expect(Object.keys(outcome.sent!["checks"] as JSONObject)).toEqual([
      CHECK_OWNED,
    ]);
    // Their scope's condition, with the ids asked for beside it.
    expect(checkQueries).toHaveLength(1);
    expect(checkQueries[0]!["dataAssetId"]).toBe(OWNED_TABLES);
    expect(checkQueries[0]!["projectId"]).toEqual(PROJECT);
    expect(checkQueries[0]!["_id"]).toBeInstanceOf(FindOperator);
    // Its alerts as the caller may see them.
    expect(
      (health.mock.calls[0]![0] as { reader: DatabaseCommonInteractionProps })
        .reader,
    ).toBe(READER);
  });
});

describe("an alert explained (alertExplanation route)", () => {
  test("only to someone who may read the alert: asked as them, never as OneUptime", async () => {
    const lookups: Array<{
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    }> = [];

    jest.spyOn(AlertService, "findOneBy").mockImplementation((async (findBy: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    }) => {
      lookups.push(findBy);
      return null;
    }) as never);
    const explain: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataAlertExplanationReader,
      "read",
    );

    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.alertExplanation(":id"),
      props: READER,
      id: ALERT,
    });

    expect(outcome.sent).toBeNull();
    expect(outcome.error?.message).toBe("Alert not found.");
    expect(explain).not.toHaveBeenCalled();
    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.props).toBe(READER);
    expect(lookups[0]!.query["projectId"]).toEqual(PROJECT);
    expect(String(lookups[0]!.query["_id"])).toBe(ALERT);
  });

  test("someone who may read it is told what caused it", async () => {
    jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(model(Alert, { _id: ALERT }) as never);
    jest
      .spyOn(DataAlertExplanationReader, "read")
      .mockResolvedValue({ summary: "orders is late" } as never);

    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.alertExplanation(":id"),
      props: READER,
      id: ALERT,
    });

    expect(outcome.error).toBeNull();
    expect(outcome.sent).toEqual({
      explanation: { summary: "orders is late" },
    });
  });
});

describe("an action on one check", () => {
  test.each([
    ["Turn alert on", DATA_OBSERVABILITY_API_ROUTES.checkAlert(":id")],
    ["Run now", DATA_OBSERVABILITY_API_ROUTES.checkRunNow(":id")],
  ])(
    "%s: refused on a check the caller may not change, and nothing changes",
    async (_action: string, path: string) => {
      const canChange: ReturnType<typeof jest.spyOn> = jest
        .spyOn(DataObservabilityReadScope, "canChangeCheck")
        .mockResolvedValue(false as never);
      const sync: ReturnType<typeof jest.spyOn> = jest.spyOn(
        DataCheckAlerts,
        "sync",
      );
      const write: ReturnType<typeof jest.spyOn> = jest.spyOn(
        DataCheckService,
        "updateColumnsByIdWithoutHooks",
      );

      const outcome: RouteOutcome = await callRoute({
        path,
        props: EDITOR,
        id: CHECK_NOT_OWNED,
      });

      expect(outcome.sent).toBeNull();
      expect(outcome.error?.message).toBe("Data check not found.");
      expect(sync).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(canChange.mock.calls[0]![0]).toMatchObject({
        projectId: PROJECT,
        props: EDITOR,
      });
      expect(
        String(
          (canChange.mock.calls[0]![0] as { dataCheckId: ObjectID })
            .dataCheckId,
        ),
      ).toBe(CHECK_NOT_OWNED);
    },
  );

  test("Turn alert on: taken on a check the caller may change", async () => {
    jest
      .spyOn(DataObservabilityReadScope, "canChangeCheck")
      .mockResolvedValue(true as never);
    const sync: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataCheckAlerts, "sync")
      .mockResolvedValue({ monitorId: id("401") } as never);

    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.checkAlert(":id"),
      props: EDITOR,
      id: CHECK_OWNED,
    });

    expect(outcome.error).toBeNull();
    expect(outcome.sent).toEqual({ monitorId: id("401") });
    expect(sync.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT,
      props: EDITOR,
    });
  });

  test("Run now: taken on a check the caller may change", async () => {
    jest
      .spyOn(DataObservabilityReadScope, "canChangeCheck")
      .mockResolvedValue(true as never);
    jest
      .spyOn(DataCheckService, "findOneBy")
      .mockResolvedValue(
        model(DataCheck, { _id: CHECK_OWNED, dataStoreId: undefined }) as never,
      );

    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.checkRunNow(":id"),
      props: EDITOR,
      id: CHECK_OWNED,
    });

    // Past the scope: on to the check itself, which here reads no database.
    expect(outcome.error?.message).toBe("Data check not found.");
    expect(DataCheckService.findOneBy).toHaveBeenCalledTimes(1);
  });
});

describe("a route about one table", () => {
  const ROUTES: Array<
    [string, string, DatabaseCommonInteractionProps, () => unknown]
  > = [
    [
      "Draft a check",
      DATA_OBSERVABILITY_API_ROUTES.checkSuggest,
      EDITOR,
      (): unknown => {
        return jest
          .spyOn(DataCheckFromSentence, "draft")
          .mockResolvedValue({} as never);
      },
    ],
    [
      "Dashboards reading it",
      DATA_OBSERVABILITY_API_ROUTES.tableDashboards,
      READER,
      (): unknown => {
        return jest
          .spyOn(DataTableDashboards, "find")
          .mockResolvedValue([] as never);
      },
    ],
    [
      "Its sensitive columns",
      DATA_OBSERVABILITY_API_ROUTES.tableSensitivity,
      READER,
      (): unknown => {
        return jest
          .spyOn(DataTableSensitivity, "read")
          .mockResolvedValue([] as never);
      },
    ],
    [
      "Its errors",
      DATA_OBSERVABILITY_API_ROUTES.tableErrors,
      READER,
      (): unknown => {
        return jest.spyOn(DataTableErrors, "read").mockResolvedValue({} as never);
      },
    ],
  ];

  test.each(ROUTES)(
    "%s: answers \"Table not found.\" for a table the caller may not read, and reads nothing of it",
    async (
      _what: string,
      path: string,
      props: DatabaseCommonInteractionProps,
      stubReader: () => unknown,
    ) => {
      const canRead: ReturnType<typeof jest.spyOn> = jest
        .spyOn(DataObservabilityReadScope, "canReadTable")
        .mockResolvedValue(false as never);
      const reader: ReturnType<typeof jest.spyOn> =
        stubReader() as ReturnType<typeof jest.spyOn>;

      const outcome: RouteOutcome = await callRoute({
        path,
        props,
        body: { dataAssetId: TABLE_NOT_OWNED, sentence: "never empty" },
      });

      expect(outcome.sent).toBeNull();
      expect(outcome.error?.message).toBe("Table not found.");
      expect(reader).not.toHaveBeenCalled();
      expect(canRead.mock.calls[0]![0]).toMatchObject({
        projectId: PROJECT,
        props,
      });
      expect(
        String(
          (canRead.mock.calls[0]![0] as { dataAssetId: ObjectID }).dataAssetId,
        ),
      ).toBe(TABLE_NOT_OWNED);
    },
  );

  test.each(ROUTES)(
    "%s: answers for a table the caller may read",
    async (
      _what: string,
      path: string,
      props: DatabaseCommonInteractionProps,
      stubReader: () => unknown,
    ) => {
      jest
        .spyOn(DataObservabilityReadScope, "canReadTable")
        .mockResolvedValue(true as never);
      const reader: ReturnType<typeof jest.spyOn> =
        stubReader() as ReturnType<typeof jest.spyOn>;

      const outcome: RouteOutcome = await callRoute({
        path,
        props,
        body: { dataAssetId: TABLE_OWNED, sentence: "never empty" },
      });

      expect(outcome.error).toBeNull();
      expect(reader).toHaveBeenCalledTimes(1);
    },
  );
});

describe("a table asked about by name (tableFreshness route, the MCP server's)", () => {
  beforeEach(() => {
    jest
      .spyOn(DataTableAnswerer, "findTables")
      .mockResolvedValue([
        table(TABLE_OWNED, STORE_OWNED, "public.orders"),
        table(TABLE_NOT_OWNED, STORE_NOT_OWNED, "public.orders"),
      ] as never);
    // Nothing to tell of either: the route only says which it asked about.
    jest.spyOn(DataTableAnswerer, "answer").mockResolvedValue(null as never);
  });

  function answeredTables(): Array<string> {
    return (
      (DataTableAnswerer.answer as unknown as Mock<() => unknown>).mock
        .calls as unknown as Array<[ObjectID, ObjectID]>
    ).map((call: [ObjectID, ObjectID]): string => {
      return String(call[1]);
    });
  }

  test("only the tables of that name the caller may read are answered", async () => {
    const readable: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataObservabilityReadScope, "getReadableIds")
      .mockResolvedValue(new Set([TABLE_OWNED]) as never);

    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.tableFreshness,
      props: READER,
      body: { table: "public.orders" },
    });

    expect(outcome.error).toBeNull();
    expect(answeredTables()).toEqual([TABLE_OWNED]);
    expect(readable.mock.calls[0]![0]).toMatchObject({
      query: NARROWED.assetQuery,
      ids: [TABLE_OWNED, TABLE_NOT_OWNED],
    });
  });

  test("a caller reading the whole project is answered for both, and nothing more is read", async () => {
    scope = WHOLE_PROJECT;
    const readable: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataObservabilityReadScope,
      "getReadableIds",
    );

    await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.tableFreshness,
      props: READER,
      body: { table: "public.orders" },
    });

    expect(answeredTables()).toEqual([TABLE_OWNED, TABLE_NOT_OWNED]);
    expect(readable).not.toHaveBeenCalled();
  });
});

describe("the late tables AI apps read (aiAppTables route)", () => {
  function aiTable(tableId: string): DataObservabilityAiAppTable {
    return { dataAssetId: tableId } as unknown as DataObservabilityAiAppTable;
  }

  beforeEach(() => {
    jest
      .spyOn(DataAiAppTables, "readLate")
      .mockResolvedValue([
        aiTable(TABLE_OWNED),
        aiTable(TABLE_NOT_OWNED),
        aiTable(TABLE_OWNED),
      ] as never);
  });

  test("a narrowed caller is told of the ones they may read, each table asked about once", async () => {
    const readable: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataObservabilityReadScope, "getReadableIds")
      .mockResolvedValue(new Set([TABLE_OWNED]) as never);

    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.aiAppTables,
      props: READER,
    });

    expect(outcome.error).toBeNull();
    expect(outcome.sent!["tables"]).toEqual([
      aiTable(TABLE_OWNED),
      aiTable(TABLE_OWNED),
    ]);
    expect(readable.mock.calls[0]![0]).toMatchObject({
      query: NARROWED.assetQuery,
      ids: [TABLE_OWNED, TABLE_NOT_OWNED],
    });
  });

  test("a caller reading the whole project is told of every one", async () => {
    scope = WHOLE_PROJECT;
    const readable: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataObservabilityReadScope,
      "getReadableIds",
    );

    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.aiAppTables,
      props: READER,
    });

    expect(outcome.sent!["tables"]).toHaveLength(3);
    expect(readable).not.toHaveBeenCalled();
  });
});
