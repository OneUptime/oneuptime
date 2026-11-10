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
import AlertStateService from "../../../Server/Services/AlertStateService";
import DataAssetFeedService from "../../../Server/Services/DataAssetFeedService";
import DataAssetService from "../../../Server/Services/DataAssetService";
import DataCheckService from "../../../Server/Services/DataCheckService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import DataObservabilityAttentionReader, {
  DataObservabilityAttention,
} from "../../../Server/Utils/DataObservability/DataObservabilityAttentionReader";
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
  DataCheckRunStatus,
  DataCheckType,
} from "../../../Types/DataObservability/DataCheckType";
import {
  DATA_OBSERVABILITY_API_ROUTES,
  DataObservabilityOverview,
  DataObservabilityOverviewAsset,
  MAX_CHECK_HEALTH_IDS,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import {
  DataAttentionItem,
  DataAttentionKind,
  DataCheckHealth,
  MAX_DATA_ATTENTION_ITEMS,
} from "../../../Types/DataObservability/DataObservabilityAttention";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { StoredRow, rowMatchesWhere } from "../TestingUtils/InMemoryRepository";

/*
 * THE OVERVIEW SAYS WHAT NEEDS SOMEONE, AND WHAT IS LEFT TO SET UP.
 *
 * The Overview route hands back, beside its figures, the items that need
 * someone now (DataObservabilityAttentionReader, pinned on its own), cut to
 * the most urgent twenty with the count of all, and the setup a project has
 * done: how many of its watched databases have an alert on, the first one
 * that has none - where Set Up Alerts goes - and its checks, pipelines and
 * owners. The alerts named are its caller's to see, so the route reads
 * them as its caller. The Checks page asks how each of its checks stands
 * through its own route, for at most 200 at a time, of the caller's project
 * only, with the same privacy.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

function id(suffix: string): string {
  return `33333333-3333-4333-8333-${suffix.padStart(12, "0")}`;
}

const STORE_ALERTED: string = id("1");
const STORE_SILENT: string = id("2");
const STORE_UNWATCHED: string = id("3");
const STORE_NOT_CONNECTED: string = id("4");
const STORE_SILENT_TOO: string = id("5");

const TABLE_LATE: string = id("101");
const TABLE_FRESH: string = id("102");
const TABLE_DROPPED: string = id("103");

const NOW_MS: number = Date.now();

// People of the project.
const MEMBER: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000001");
const OWNER: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000002");

function person(
  userId: ObjectID,
  permission: Permission,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT,
    userId: userId,
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

const VIEWER: DatabaseCommonInteractionProps = person(
  MEMBER,
  Permission.Viewer,
);
const ALERT_OWNER: DatabaseCommonInteractionProps = person(
  OWNER,
  Permission.ProjectMember,
);

function model<T>(Type: { new (): T }, fields: StoredRow): T {
  const row: T = new Type();

  for (const [column, value] of Object.entries(fields)) {
    (row as unknown as StoredRow)[column] = value;
  }

  return row;
}

function dataStore(storeId: string, fields: StoredRow): DataStore {
  return model(DataStore, {
    _id: storeId,
    projectId: PROJECT,
    kind: DataStoreKind.PostgreSql,
    connectionString: "postgres://reader@db/orders",
    isTableHealthEnabled: true,
    tableHealthStatus: "Collected",
    tableHealthAssetCount: 3,
    ...fields,
  });
}

let stores: Array<DataStore>;
let assets: Array<DataAsset>;
let alertMonitors: Map<string, number>;
let attention: DataObservabilityAttention;
let reads: Array<{
  reader: DatabaseCommonInteractionProps;
  lateAssets: Array<DataObservabilityOverviewAsset>;
  storeIds: Array<string>;
}>;

function attentionItem(index: number): DataAttentionItem {
  return {
    kind: DataAttentionKind.TableLate,
    name: `public.table_${String(index).padStart(2, "0")}`,
    where: "orders-db",
    message: null,
    overdueBySeconds: 1_000 - index,
    since: null,
    dataStoreId: STORE_ALERTED,
    dataAssetId: id(String(200 + index)),
    dataPipelineId: null,
    dataCheckId: null,
    dataProductId: null,
    dataReconciliationId: null,
    alert: null,
  };
}

function stubOverviewSources(): void {
  stores = [
    dataStore(STORE_ALERTED, { name: "orders-db" }),
    dataStore(STORE_SILENT, {
      name: "warehouse",
      tableHealthStatus: "Failed",
      tableHealthMessage: "password authentication failed",
    }),
    // Connected, but nobody asked to watch it: it needs no alerts.
    dataStore(STORE_UNWATCHED, {
      name: "archive",
      isTableHealthEnabled: false,
    }),
    // No way in: one of the suggestions, not a database of the Overview.
    dataStore(STORE_NOT_CONNECTED, {
      name: "found-in-aws",
      connectionString: undefined,
    }),
    dataStore(STORE_SILENT_TOO, { name: "zz-events" }),
  ];

  assets = [
    model(DataAsset, {
      _id: TABLE_LATE,
      assetKey: "public.payments",
      assetKind: DataAssetKind.Table,
      dataStoreId: new ObjectID(STORE_ALERTED),
      dataStoreName: "orders-db",
      // Every quarter of an hour, last changed four hours ago.
      lastChangedAt: new Date(NOW_MS - 4 * 60 * 60 * 1000),
      updateIntervalInSeconds: 900,
      isDropped: false,
    }),
    model(DataAsset, {
      _id: TABLE_FRESH,
      assetKey: "public.orders",
      assetKind: DataAssetKind.Table,
      dataStoreId: new ObjectID(STORE_ALERTED),
      dataStoreName: "orders-db",
      lastChangedAt: new Date(NOW_MS - 60 * 1000),
      updateIntervalInSeconds: 900,
      isDropped: false,
    }),
    model(DataAsset, {
      _id: TABLE_DROPPED,
      assetKey: "public.old",
      assetKind: DataAssetKind.Table,
      dataStoreId: new ObjectID(STORE_ALERTED),
      isDropped: true,
    }),
  ];

  alertMonitors = new Map([[STORE_ALERTED, 4]]);

  attention = {
    items: Array.from({ length: 25 }, (_value: unknown, index: number) => {
      return attentionItem(index);
    }),
    failingCheckCount: 2,
    checkCount: 4,
    pipelineCount: 1,
  };

  reads = [];

  jest.spyOn(DataStoreService, "findBy").mockImplementation((async (findBy: {
    query: { kind: Includes };
  }) => {
    // The databases; the buckets, which none of these are, come second.
    return findBy.query.kind.values
      .map(String)
      .includes(DataStoreKind.PostgreSql)
      ? stores
      : [];
  }) as never);

  jest.spyOn(DataAssetService, "findBy").mockImplementation((async () => {
    return assets;
  }) as never);

  jest.spyOn(DataAssetFeedService, "countBy").mockResolvedValue({
    toNumber: (): number => {
      return 0;
    },
  } as never);
  jest.spyOn(DataAssetFeedService, "findBy").mockResolvedValue([] as never);

  jest
    .spyOn(DataObservabilityAttentionReader, "getAlertMonitorCountByStore")
    .mockImplementation(async () => {
      return alertMonitors;
    });

  jest
    .spyOn(DataObservabilityAttentionReader, "read")
    .mockImplementation(async (data) => {
      reads.push({
        reader: data.reader,
        lateAssets: data.lateAssets,
        storeIds: data.stores.map((store) => {
          return store.dataStoreId;
        }),
      });
      return attention;
    });

  jest
    .spyOn(DataObservabilityAttentionReader, "getOwnerCounts")
    .mockResolvedValue({ tableOwnerCount: 3, ownerRuleCount: 0 });
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

// A route's own handler, past the session middleware, from the router the API builds.
function routeHandler(path: string): RouteHandler {
  const router: ExpressRouter = new DataObservabilityAPI().getRouter();
  const layer: RouterLayer | undefined = (
    router as unknown as { stack: Array<RouterLayer> }
  ).stack.find((candidate: RouterLayer): boolean => {
    return (
      candidate.route?.path === path && candidate.route.methods["post"] === true
    );
  });

  expect(layer?.route?.stack).toHaveLength(3);

  return layer!.route!.stack[2]!.handle;
}

interface RouteOutcome {
  sent: JSONObject | null;
  error: Error | null;
}

async function callRoute(
  path: string,
  props: DatabaseCommonInteractionProps,
  body: JSONObject = {},
): Promise<RouteOutcome> {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);

  const sent: Mock<(...args: Array<unknown>) => unknown> = jest.fn();
  const next: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

  jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation(sent as never);

  await routeHandler(path)(
    { body } as unknown as ExpressRequest,
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
  stubOverviewSources();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the Overview's answer", () => {
  test("each database says how many alerts it has on: none is 0, never missing", async () => {
    const overview: DataObservabilityOverview =
      await DataObservabilityAPI.getOverview(PROJECT, VIEWER);

    expect(
      Object.fromEntries(
        overview.stores.map((store) => {
          return [store.name, store.alertMonitorCount];
        }),
      ),
    ).toEqual({
      "orders-db": 4,
      warehouse: 0,
      archive: 0,
      "zz-events": 0,
    });
  });

  test("the setup: watched databases only, with the first one that has no alert on", async () => {
    const overview: DataObservabilityOverview =
      await DataObservabilityAPI.getOverview(PROJECT, VIEWER);

    expect(overview.setup).toEqual({
      // orders-db, warehouse, zz-events: not archive, which nobody watches.
      storeCount: 3,
      storesWithAlertsCount: 1,
      firstStoreWithoutAlertsId: STORE_SILENT,
      checkCount: 4,
      pipelineCount: 1,
      tableOwnerCount: 3,
      ownerRuleCount: 0,
    });
    // Every database the Overview lists, watched or not, is still counted as connected.
    expect(overview.storeCount).toBe(4);
  });

  test("every watched database with an alert on: alerts are done, and nowhere to send anyone", async () => {
    alertMonitors = new Map([
      [STORE_ALERTED, 4],
      [STORE_SILENT, 1],
      [STORE_SILENT_TOO, 2],
    ]);

    const overview: DataObservabilityOverview =
      await DataObservabilityAPI.getOverview(PROJECT, VIEWER);

    expect(overview.setup.storesWithAlertsCount).toBe(3);
    expect(overview.setup.storeCount).toBe(3);
    expect(overview.setup.firstStoreWithoutAlertsId).toBeNull();
  });

  test("the most urgent twenty are handed back, with the count of all", async () => {
    const overview: DataObservabilityOverview =
      await DataObservabilityAPI.getOverview(PROJECT, VIEWER);

    expect(overview.attention).toHaveLength(MAX_DATA_ATTENTION_ITEMS);
    expect(overview.attention[0]!.name).toBe("public.table_00");
    expect(overview.attentionCount).toBe(25);
    expect(overview.failingCheckCount).toBe(2);
  });

  test("what needs someone is read with the stores and late tables the Overview found, each table with its database", async () => {
    await DataObservabilityAPI.getOverview(PROJECT, VIEWER);

    expect(reads).toHaveLength(1);
    expect(reads[0]!.storeIds).toEqual([
      STORE_ALERTED,
      STORE_SILENT,
      STORE_UNWATCHED,
      STORE_SILENT_TOO,
    ]);
    expect(
      reads[0]!.lateAssets.map((asset: DataObservabilityOverviewAsset) => {
        return [asset.assetKey, asset.dataStoreId];
      }),
    ).toEqual([["public.payments", STORE_ALERTED]]);
  });

  test("read as nobody unless someone is named: no private alert is named by default", async () => {
    await DataObservabilityAPI.getOverview(PROJECT);

    expect(reads[0]!.reader).toEqual({});
  });

  test("the route reads them as its caller", async () => {
    const outcome: RouteOutcome = await callRoute(
      DATA_OBSERVABILITY_API_ROUTES.overview,
      ALERT_OWNER,
    );

    expect(outcome.error).toBeNull();
    expect(reads[0]!.reader).toBe(ALERT_OWNER);
    expect((outcome.sent!["setup"] as JSONObject)["storeCount"]).toBe(3);
    expect(outcome.sent!["attentionCount"]).toBe(25);
  });

  test("a project with nothing connected: nothing to set up but the first step", async () => {
    stores = [];
    assets = [];
    attention = {
      items: [],
      failingCheckCount: 0,
      checkCount: 0,
      pipelineCount: 0,
    };

    const overview: DataObservabilityOverview =
      await DataObservabilityAPI.getOverview(PROJECT, VIEWER);

    expect(overview.storeCount).toBe(0);
    expect(overview.attention).toEqual([]);
    expect(overview.attentionCount).toBe(0);
    expect(overview.setup).toMatchObject({
      storeCount: 0,
      storesWithAlertsCount: 0,
      firstStoreWithoutAlertsId: null,
    });
  });
});

describe("how each check of the Checks page stands", () => {
  const RESOLVED: string = id("701");
  const CREATED: string = id("702");

  const CHECK_PASSING: string = id("301");
  const CHECK_FAILING_PRIVATE: string = id("302");
  const CHECK_COULD_NOT_RUN: string = id("303");
  const CHECK_OF_ANOTHER_PROJECT: string = id("304");

  const MONITOR_PASSING: string = id("401");
  const MONITOR_PRIVATE: string = id("402");

  let checks: Array<DataCheck>;
  let alertRows: Array<StoredRow>;
  let checkQueries: Array<Record<string, unknown>>;

  // A private alert's owners pass the clause; nobody else does.
  function passesPrivacyClause(clause: unknown, row: StoredRow): boolean {
    if (clause === undefined) {
      return true;
    }

    if (!(clause instanceof FindOperator) || !clause.getSql) {
      throw new Error(`Not an alert privacy clause: ${String(clause)}`);
    }

    const sql: string = clause.getSql("c");
    const isPrivate: boolean = row["isPrivate"] === true;

    if (sql === "(c IS NULL OR c = FALSE)") {
      return !isPrivate;
    }

    const userIds: Array<string> = Object.values(
      (clause.objectLiteralParameters as Record<string, unknown>) || {},
    ).map(String);

    if (
      sql.startsWith("(c IS NULL OR c = FALSE OR ") &&
      sql.includes('"AlertOwnerUser"') &&
      userIds.length === 1
    ) {
      return !isPrivate || userIds[0] === OWNER.toString();
    }

    throw new Error(`An alert privacy clause this test does not read: ${sql}`);
  }

  beforeEach(() => {
    checkQueries = [];
    checks = [
      model(DataCheck, {
        _id: CHECK_PASSING,
        projectId: PROJECT,
        checkType: DataCheckType.RowCount,
        isEnabled: true,
        lastRunAt: new Date(NOW_MS - 60 * 60 * 1000),
        lastRunStatus: DataCheckRunStatus.Ran,
        monitorId: new ObjectID(MONITOR_PASSING),
      }),
      model(DataCheck, {
        _id: CHECK_FAILING_PRIVATE,
        projectId: PROJECT,
        checkType: DataCheckType.CustomSql,
        isEnabled: true,
        lastRunAt: new Date(NOW_MS - 60 * 60 * 1000),
        lastRunStatus: DataCheckRunStatus.Ran,
        monitorId: new ObjectID(MONITOR_PRIVATE),
      }),
      model(DataCheck, {
        _id: CHECK_COULD_NOT_RUN,
        projectId: PROJECT,
        checkType: DataCheckType.NullPercent,
        isEnabled: true,
        lastRunAt: new Date(NOW_MS - 60 * 60 * 1000),
        lastRunStatus: DataCheckRunStatus.Failed,
      }),
      model(DataCheck, {
        _id: CHECK_OF_ANOTHER_PROJECT,
        projectId: OTHER_PROJECT,
        checkType: DataCheckType.RowCount,
        isEnabled: true,
        lastRunAt: new Date(NOW_MS - 60 * 60 * 1000),
        lastRunStatus: DataCheckRunStatus.Failed,
      }),
    ];
    alertRows = [
      {
        _id: id("801"),
        projectId: PROJECT.toString(),
        title: "rows arrive was failing",
        alertNumberWithPrefix: "ALT-1",
        monitorId: MONITOR_PASSING,
        currentAlertStateId: RESOLVED,
        isPrivate: false,
      },
      {
        _id: id("802"),
        projectId: PROJECT.toString(),
        title: "Payroll totals do not add up",
        alertNumberWithPrefix: "ALT-2",
        monitorId: MONITOR_PRIVATE,
        currentAlertStateId: CREATED,
        isPrivate: true,
      },
    ];

    jest.spyOn(DataCheckService, "findBy").mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }) => {
      checkQueries.push(findBy.query);
      return checks.filter((check: DataCheck): boolean => {
        return rowMatchesWhere(check as unknown as StoredRow, findBy.query);
      });
    }) as never);

    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([new ObjectID(CREATED)] as never);

    jest.spyOn(AlertService, "findBy").mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }) => {
      const { isPrivate, ...rest } = findBy.query;

      return alertRows
        .filter((row: StoredRow): boolean => {
          return (
            rowMatchesWhere(row, rest) && passesPrivacyClause(isPrivate, row)
          );
        })
        .map((row: StoredRow): Alert => {
          return model(Alert, {
            ...row,
            monitorId: new ObjectID(String(row["monitorId"])),
          });
        });
    }) as never);
  });

  test("each check by id: passing, could not run - and failing only to those who may see its alert", async () => {
    const asked: Array<string> = [
      CHECK_PASSING,
      CHECK_FAILING_PRIVATE,
      CHECK_COULD_NOT_RUN,
    ];

    const toOwner: RouteOutcome = await callRoute(
      DATA_OBSERVABILITY_API_ROUTES.checkHealth,
      ALERT_OWNER,
      { dataCheckIds: asked },
    );
    const toViewer: RouteOutcome = await callRoute(
      DATA_OBSERVABILITY_API_ROUTES.checkHealth,
      VIEWER,
      { dataCheckIds: asked },
    );

    expect(toOwner.error).toBeNull();
    expect(toOwner.sent).toEqual({
      checks: {
        [CHECK_PASSING]: { health: DataCheckHealth.Passing, alert: null },
        [CHECK_FAILING_PRIVATE]: {
          health: DataCheckHealth.Failing,
          alert: {
            alertId: id("802"),
            number: "ALT-2",
            title: "Payroll totals do not add up",
          },
        },
        [CHECK_COULD_NOT_RUN]: {
          health: DataCheckHealth.CouldNotRun,
          alert: null,
        },
      },
    });

    // The viewer may not see the private alert: its number and title are nowhere.
    expect(
      (toViewer.sent!["checks"] as JSONObject)[CHECK_FAILING_PRIVATE],
    ).toEqual({ health: DataCheckHealth.Passing, alert: null });
    expect(JSON.stringify(toViewer.sent)).not.toContain("Payroll");
  });

  test("a check of another project is not answered, though its id was asked", async () => {
    const outcome: RouteOutcome = await callRoute(
      DATA_OBSERVABILITY_API_ROUTES.checkHealth,
      ALERT_OWNER,
      { dataCheckIds: [CHECK_PASSING, CHECK_OF_ANOTHER_PROJECT] },
    );

    expect(Object.keys(outcome.sent!["checks"] as JSONObject)).toEqual([
      CHECK_PASSING,
    ]);
  });

  test("what is not an id is left out, and each id is asked once", async () => {
    const outcome: RouteOutcome = await callRoute(
      DATA_OBSERVABILITY_API_ROUTES.checkHealth,
      ALERT_OWNER,
      {
        dataCheckIds: [
          CHECK_PASSING,
          CHECK_PASSING,
          "not-an-id",
          42,
          null,
          "' OR 1=1 --",
        ] as unknown as Array<string>,
      },
    );

    expect(outcome.error).toBeNull();
    expect(checkQueries).toHaveLength(1);
    expect(
      Object.values(
        (checkQueries[0]!["_id"] as FindOperator<unknown>)
          .objectLiteralParameters || {},
      ),
    ).toEqual([[CHECK_PASSING]]);
    expect(Object.keys(outcome.sent!["checks"] as JSONObject)).toEqual([
      CHECK_PASSING,
    ]);
  });

  test("nothing that is an id: nothing is read, and nothing answered", async () => {
    const outcome: RouteOutcome = await callRoute(
      DATA_OBSERVABILITY_API_ROUTES.checkHealth,
      ALERT_OWNER,
      { dataCheckIds: ["nope"] },
    );

    expect(outcome.sent).toEqual({ checks: {} });
    expect(checkQueries).toHaveLength(0);
  });

  test("no list of checks: a 400 that says what to send", async () => {
    for (const body of [{}, { dataCheckIds: "x" }, { dataCheckIds: null }]) {
      const outcome: RouteOutcome = await callRoute(
        DATA_OBSERVABILITY_API_ROUTES.checkHealth,
        ALERT_OWNER,
        body as JSONObject,
      );

      expect(outcome.sent).toBeNull();
      expect(outcome.error?.message).toBe("Name the checks: dataCheckIds.");
    }
  });

  test(`at most ${MAX_CHECK_HEALTH_IDS} checks at a time, which a page of the table never passes`, async () => {
    const many: (count: number) => Array<string> = (
      count: number,
    ): Array<string> => {
      return Array.from({ length: count }, (_value: unknown, index: number) => {
        return `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`;
      });
    };

    const tooMany: RouteOutcome = await callRoute(
      DATA_OBSERVABILITY_API_ROUTES.checkHealth,
      ALERT_OWNER,
      { dataCheckIds: many(MAX_CHECK_HEALTH_IDS + 1) },
    );

    expect(tooMany.error?.message).toBe(
      `Ask for at most ${MAX_CHECK_HEALTH_IDS} checks at a time.`,
    );
    expect(checkQueries).toHaveLength(0);

    const enough: RouteOutcome = await callRoute(
      DATA_OBSERVABILITY_API_ROUTES.checkHealth,
      ALERT_OWNER,
      { dataCheckIds: many(MAX_CHECK_HEALTH_IDS) },
    );

    expect(enough.error).toBeNull();
    expect(checkQueries).toHaveLength(1);
  });

  test("anyone who may read data assets may ask; someone of no project may not", async () => {
    const outcome: RouteOutcome = await callRoute(
      DATA_OBSERVABILITY_API_ROUTES.checkHealth,
      { userId: MEMBER, userType: UserType.User, tenantId: PROJECT },
      { dataCheckIds: [CHECK_PASSING] },
    );

    expect(outcome.sent).toBeNull();
    expect(outcome.error).not.toBeNull();
    expect(checkQueries).toHaveLength(0);
  });
});
