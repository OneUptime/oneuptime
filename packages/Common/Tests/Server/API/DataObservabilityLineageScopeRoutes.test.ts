import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import CommonAPI from "../../../Server/API/CommonAPI";
import DataObservabilityAPI from "../../../Server/API/DataObservabilityAPI";
import DataAlertService from "../../../Server/Services/DataAlertService";
import DataAssetLineageService from "../../../Server/Services/DataAssetLineageService";
import DataAssetService from "../../../Server/Services/DataAssetService";
import DataAssetUsageService from "../../../Server/Services/DataAssetUsageService";
import DataBiConnectionService from "../../../Server/Services/DataBiConnectionService";
import DataDashboardService from "../../../Server/Services/DataDashboardService";
import DataPipelineService from "../../../Server/Services/DataPipelineService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import DataTableDashboards from "../../../Server/Utils/DataObservability/Bi/DataTableDashboards";
import DataAlertLineageReader, {
  DataAlertLineageRow,
  DataAlertRowReader,
} from "../../../Server/Utils/DataObservability/DataAlertLineage";
import DataLineageMapReader from "../../../Server/Utils/DataObservability/DataLineageMap";
import DataObservabilityReadScope, {
  DataObservabilityScope,
} from "../../../Server/Utils/DataObservability/DataObservabilityReadScope";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../Server/Utils/AI/Toolbox/Index";
import DataTableAnswerer, {
  DataTableAnswer,
} from "../../../Server/Utils/DataObservability/DataTableAnswer";
import { DataAssetFreshness } from "../../../Types/DataObservability/DataAssetFreshness";
import DataTableLineageReader, {
  DataLineageEdgeRow,
} from "../../../Server/Utils/DataObservability/DataTableLineage";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../Models/DatabaseModels/DataAssetLineage";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import DataBiTool from "../../../Types/DataObservability/DataBiTool";
import { DATA_OBSERVABILITY_API_ROUTES } from "../../../Types/DataObservability/DataObservabilityApiTypes";
import {
  DataLineageSide,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "../../../Types/DataObservability/DataTableLineage";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  MemoryGraph,
  columns,
  feeds,
  lateTable,
  memoryReader,
  newGraph,
  p,
  pipeline,
  runs,
  t,
  table,
  uuid,
  writes,
} from "../Utils/DataObservability/LineageMemoryGraph";

/*
 * THE LINEAGE ROUTES ANSWER ONLY ABOUT WHAT THE CALLER MAY READ (#9526).
 *
 * A table's Lineage tab, drawing more of it, a pipeline's Lineage, an
 * alert's Lineage card, the Lineage Map and the lineage told in words (Ask
 * AI, the MCP server) each answer a caller limited to what its members own,
 * or to some labels, about those tables and pipelines alone: what they may
 * not read is not named - not on a card, an arrow or a dashboard's read -
 * nor counted, and a drawing about one is not found. A caller whose grants
 * narrow nothing is answered exactly as before. The database's rows stand
 * in for a warehouse here, the scope for each caller's grants
 * (DataObservabilityReadScope, held on its own), as in
 * DataObservabilityOwnedScopeRoutes.test.ts.
 *
 *   hr.payroll_raw -> public.salaries -> public.orders <- staging.orders <- raw.orders
 *   public.orders -> marts.revenue, and -> hr.headcount
 *   payroll_sync (HR's pipeline) writes salaries, and moves raw -> staging
 *   orders_etl (theirs) moves raw -> staging and reads raw to write staging
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const MEMBER: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000001");

const ORDERS: string = t(0);
const STAGING: string = t(1);
const RAW: string = t(2);
const REVENUE: string = t(5);
const ORDERS_ETL: string = p(1);

const SALARIES: string = t(10);
const PAYROLL_RAW: string = t(11);
const HEADCOUNT: string = t(12);
const PAYROLL_SYNC: string = p(9);
const HR_DASHBOARD: string = uuid(3, 9);

const SECRETS: Array<string> = [
  SALARIES,
  PAYROLL_RAW,
  HEADCOUNT,
  PAYROLL_SYNC,
  HR_DASHBOARD,
  "public.salaries",
  "hr.payroll_raw",
  "hr.headcount",
  "payroll_sync",
  "HR Headcount",
];

const ALERT_ON_ORDERS: string = uuid(4, 1);
const ALERT_ON_SALARIES: string = uuid(4, 2);

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
            permission,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
  };
}

const READER: DatabaseCommonInteractionProps = person(Permission.ReadDataAsset);

/*
 * The callers' scopes, as the read-permission pipeline works them out: a
 * role limited to what its members own reads the tables and pipeline they
 * own; one limited to a label reads the tables carrying it, and no
 * pipeline, which carries no labels.
 */
interface Grant {
  name: string;
  scope: DataObservabilityScope;
  tables: Set<string>;
  pipelines: Set<string>;
}

const OWNED_TABLES: Set<string> = new Set([ORDERS, STAGING, RAW, REVENUE]);
const OWNED_CONDITION: ReturnType<typeof QueryHelper.any> = QueryHelper.any([
  ...OWNED_TABLES,
]);
const OWNED: Grant = {
  name: "a role limited to what its members own",
  tables: OWNED_TABLES,
  pipelines: new Set([ORDERS_ETL]),
  scope: {
    isWholeProject: false,
    assetQuery: { projectId: PROJECT, _id: OWNED_CONDITION },
    checkQuery: { projectId: PROJECT, dataAssetId: OWNED_CONDITION },
    pipelineQuery: {
      projectId: PROJECT,
      _id: QueryHelper.any([ORDERS_ETL]),
    },
  },
};

const LABEL_CONDITION: ReturnType<typeof QueryHelper.any> = QueryHelper.any([
  "label-finance",
]);
const LABELLED: Grant = {
  name: "a role limited to a label",
  tables: new Set([ORDERS, REVENUE]),
  pipelines: new Set(),
  scope: {
    isWholeProject: false,
    assetQuery: { projectId: PROJECT, labels: LABEL_CONDITION } as never,
    checkQuery: { projectId: PROJECT },
    pipelineQuery: { projectId: PROJECT, _id: QueryHelper.any([]) },
  },
};

const NARROWED_GRANTS: Array<[string, Grant]> = [
  [OWNED.name, OWNED],
  [LABELLED.name, LABELLED],
];

function warehouse(): MemoryGraph {
  const graph: MemoryGraph = newGraph();

  table(graph, ORDERS, { assetKey: "public.orders" });
  table(graph, STAGING, { assetKey: "staging.orders" });
  table(graph, RAW, { assetKey: "raw.orders" });
  table(graph, REVENUE, { assetKey: "marts.revenue" });
  lateTable(graph, SALARIES, { assetKey: "public.salaries" });
  lateTable(graph, PAYROLL_RAW, { assetKey: "hr.payroll_raw" });
  lateTable(graph, HEADCOUNT, { assetKey: "hr.headcount" });
  graph.openAlerts.set(SALARIES, 3);

  pipeline(graph, ORDERS_ETL, { jobName: "orders_etl" });
  pipeline(graph, PAYROLL_SYNC, { jobName: "payroll_sync" });

  feeds(graph, STAGING, ORDERS);
  feeds(graph, SALARIES, ORDERS);
  feeds(graph, PAYROLL_RAW, SALARIES);
  writes(graph, PAYROLL_SYNC, SALARIES);
  feeds(graph, RAW, STAGING, { dataPipelineId: PAYROLL_SYNC });
  runs(graph, ORDERS_ETL, { reads: [RAW, PAYROLL_RAW], writes: [STAGING] });
  feeds(graph, ORDERS, REVENUE);
  feeds(graph, ORDERS, HEADCOUNT);

  columns(graph, RAW, STAGING, [["order_id", "id"]]);
  columns(graph, SALARIES, ORDERS, [["employee_id", "sales_rep_id"]]);

  graph.dashboards.push(
    {
      dataDashboardId: uuid(3, 1),
      name: "Revenue",
      tool: DataBiTool.Tableau,
      url: null,
      dataAssetIds: [REVENUE],
    },
    {
      dataDashboardId: HR_DASHBOARD,
      name: "HR Headcount",
      tool: DataBiTool.Looker,
      url: null,
      dataAssetIds: [HEADCOUNT],
    },
  );

  return graph;
}

let graph: MemoryGraph;
let grant: Grant | null;

function readable(
  ids: Array<string>,
  allowed: Set<string> | null,
): Set<string> {
  return new Set(
    ids.filter((id: string): boolean => {
      return !allowed || allowed.has(id);
    }),
  );
}

function idsIn(value: unknown): Array<string> {
  if (value instanceof Includes) {
    return value.values.map((entry: unknown): string => {
      return String(entry);
    });
  }

  return value === undefined || value === null ? [] : [String(value)];
}

// The tables a database read narrowed by the caller's scope hands back.
function tablesFor(query: Record<string, unknown>): Array<string> {
  const all: Array<string> = Array.from(graph.tables.keys());

  if (query["labels"] === LABEL_CONDITION) {
    return all.filter((id: string): boolean => {
      return LABELLED.tables.has(id);
    });
  }

  if (query["_id"] === OWNED_CONDITION) {
    return all.filter((id: string): boolean => {
      return OWNED.tables.has(id);
    });
  }

  return all;
}

function lineageRow(row: DataLineageEdgeRow, index: number): DataAssetLineage {
  const model: DataAssetLineage = new DataAssetLineage();

  model._id = uuid(7, index);
  model.upstreamDataAssetId = row.upstreamDataAssetId
    ? new ObjectID(row.upstreamDataAssetId)
    : undefined!;
  model.downstreamDataAssetId = new ObjectID(row.downstreamDataAssetId);
  model.dataPipelineId = row.dataPipelineId
    ? new ObjectID(row.dataPipelineId)
    : undefined!;
  model.lastSeenAt = row.lastSeenAt || undefined!;

  return model;
}

function stubWarehouse(): void {
  graph = warehouse();
  grant = OWNED;

  jest
    .spyOn(DataTableLineageReader, "getDatabaseReader")
    .mockImplementation(() => {
      return memoryReader(graph);
    });
  jest
    .spyOn(DataObservabilityReadScope, "get")
    .mockImplementation((async () => {
      return grant
        ? grant.scope
        : DataObservabilityReadScope.wholeProject(PROJECT);
    }) as never);
  jest
    .spyOn(DataObservabilityReadScope, "getReadableIds")
    .mockImplementation((async (data: {
      query: Record<string, unknown>;
      ids: Array<string>;
    }) => {
      if (!grant) {
        return readable(data.ids, null);
      }

      return readable(
        data.ids,
        data.query === grant.scope.pipelineQuery
          ? grant.pipelines
          : grant.tables,
      );
    }) as never);

  // The map's own reads: the tables it starts from, their rows, the services on them.
  jest.spyOn(DataAssetService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
  }) => {
    return tablesFor(findBy.query).map((id: string): DataAsset => {
      const asset: DataAsset = new DataAsset();
      asset._id = id;
      return asset;
    });
  }) as never);
  jest
    .spyOn(DataAssetLineageService, "findBy")
    .mockImplementation((async (findBy: { query: Record<string, unknown> }) => {
      const downstream: Array<string> = idsIn(
        findBy.query["downstreamDataAssetId"],
      );
      const upstream: Array<string> = idsIn(
        findBy.query["upstreamDataAssetId"],
      );
      const pipelines: Array<string> = idsIn(findBy.query["dataPipelineId"]);

      return graph.edges
        .map((row: DataLineageEdgeRow, index: number) => {
          return { row, index };
        })
        .filter((entry: { row: DataLineageEdgeRow }): boolean => {
          return (
            (downstream.length === 0 ||
              downstream.includes(entry.row.downstreamDataAssetId)) &&
            (upstream.length === 0 ||
              upstream.includes(entry.row.upstreamDataAssetId || "")) &&
            (pipelines.length === 0 ||
              pipelines.includes(entry.row.dataPipelineId || ""))
          );
        })
        .map((entry: { row: DataLineageEdgeRow; index: number }) => {
          return lineageRow(entry.row, entry.index);
        });
    }) as never);
  jest.spyOn(DataAssetUsageService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(DataPipelineService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
  }) => {
    // A search names payroll_sync and orders_etl alike: the scope keeps the caller's.
    const allowed: Set<string> | null = grant ? grant.pipelines : null;

    return [ORDERS_ETL, PAYROLL_SYNC]
      .filter((id: string): boolean => {
        return !allowed || findBy.query["_id"] === undefined || allowed.has(id);
      })
      .map((id: string): DataPipeline => {
        const model: DataPipeline = new DataPipeline();
        model._id = id;
        return model;
      });
  }) as never);
  jest.spyOn(DataDashboardService, "findBy").mockResolvedValue([] as never);
  // No BI tool connected: the map draws no Power BI dataset behind a report (#9559).
  jest.spyOn(DataBiConnectionService, "findBy").mockResolvedValue([] as never);

  // The whole project's newest rows, for a whole map read by someone who may read it all.
  jest
    .spyOn(DataLineageMapReader, "getDatabaseFlowReader")
    .mockImplementation(() => {
      return {
        readLineage: async (limit: number) => {
          return graph.edges.slice(0, limit);
        },
        readUsages: async () => {
          return [];
        },
      };
    });

  // A table named as the MCP server and Ask AI name it: by its key, which HR's shares.
  jest.spyOn(DataTableAnswerer, "findTables").mockImplementation((async (
    _projectId: ObjectID,
    reference: string,
  ) => {
    return Array.from(graph.tables.values())
      .filter((row: { dataAssetId: string; assetKey: string }): boolean => {
        return (
          row.dataAssetId === reference || row.assetKey.endsWith(reference)
        );
      })
      .map((row: { dataAssetId: string; assetKey: string }): DataAsset => {
        const asset: DataAsset = new DataAsset();
        asset._id = row.dataAssetId;
        asset.assetKey = row.assetKey;
        return asset;
      });
  }) as never);

  // Two alerts the caller may see: one on their orders, one on HR's salaries.
  jest
    .spyOn(DataAlertLineageReader, "getDatabaseAlertReader")
    .mockImplementation((): DataAlertRowReader => {
      const rows: Array<DataAlertLineageRow> = [
        {
          alertId: ALERT_ON_ORDERS,
          dataAssetId: ORDERS,
          dataPipelineId: null,
          dataStoreId: null,
          causeAlertId: null,
        },
        {
          alertId: ALERT_ON_SALARIES,
          dataAssetId: SALARIES,
          dataPipelineId: null,
          dataStoreId: null,
          causeAlertId: null,
        },
      ];

      return {
        readAlert: async (alertId: string) => {
          return (
            rows.find((row: DataAlertLineageRow): boolean => {
              return row.alertId === alertId;
            }) || null
          );
        },
        readSubject: async () => {
          return null;
        },
        readConsequences: async () => {
          return { rows: [], total: 0 };
        },
        readCheckColumn: async () => {
          return null;
        },
      };
    });
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
  body?: JSONObject;
  id?: string;
}): Promise<RouteOutcome> {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(READER);

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

// Every name and id of what the caller may not read: none of it, anywhere in the answer.
function expectNoSecret(outcome: RouteOutcome, allowed: Set<string>): void {
  expect(outcome.error).toBeNull();
  expect(outcome.sent).not.toBeNull();

  const json: string = JSON.stringify(outcome.sent);

  for (const secret of SECRETS) {
    expect(json).not.toContain(secret);
  }

  // Nor any table of the project the caller's grant does not reach.
  for (const [id, row] of graph.tables) {
    if (!allowed.has(id)) {
      expect(json).not.toContain(id);
      expect(json).not.toContain(row.assetKey);
    }
  }
}

beforeEach(() => {
  jest.restoreAllMocks();
  stubWarehouse();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(NARROWED_GRANTS)("for %s", (_name: string, narrowed: Grant) => {
  beforeEach(() => {
    grant = narrowed;
  });

  test("a table's Lineage tab names and counts only the tables and pipelines they may read", async () => {
    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.tableLineage,
      body: { dataAssetId: ORDERS, depth: 3, withColumns: true },
    });

    expectNoSecret(outcome, narrowed.tables);
    // Their own tables next to orders are drawn.
    expect(JSON.stringify(outcome.sent)).toContain("marts.revenue");
  });

  test("a table's Lineage tab for a table they may not read: Table not found", async () => {
    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.tableLineage,
      body: { dataAssetId: SALARIES },
    });

    expect(outcome.sent).toBeNull();
    expect(outcome.error?.message).toBe("Table not found.");
  });

  test("drawing more draws only theirs, and a table of HR's named as drawn is never joined", async () => {
    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.lineageExpand,
      body: {
        focusNodeId: getLineageTableNodeId(ORDERS),
        nodeId: getLineageTableNodeId(ORDERS),
        side: DataLineageSide.Downstream,
        tables: [
          { dataAssetId: ORDERS, side: DataLineageSide.Focus, depth: 0 },
          {
            dataAssetId: HEADCOUNT,
            side: DataLineageSide.Downstream,
            depth: 1,
          },
        ],
        dataDashboardIds: [],
      },
    });

    expectNoSecret(outcome, narrowed.tables);
    expect(JSON.stringify(outcome.sent)).toContain("marts.revenue");
  });

  test("drawing more of a drawing about HR's table: Table not found", async () => {
    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.lineageExpand,
      body: {
        focusNodeId: getLineageTableNodeId(SALARIES),
        nodeId: getLineageTableNodeId(SALARIES),
        side: DataLineageSide.Upstream,
        tables: [
          { dataAssetId: SALARIES, side: DataLineageSide.Focus, depth: 0 },
        ],
        dataDashboardIds: [],
      },
    });

    expect(outcome.sent).toBeNull();
    expect(outcome.error?.message).toBe("Table not found.");
  });

  test("the lineage told in words answers for their table of a name HR's shares, and names nothing of HR's", async () => {
    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.tableLineageAnswer,
      // public.orders and nothing else ends in "orders" that they may read... but staging.orders and raw.orders do too.
      body: { table: "orders", depth: 3 },
    });

    expectNoSecret(outcome, narrowed.tables);

    const answered: Array<string> = (
      outcome.sent!["tables"] as Array<JSONObject>
    ).map((entry: JSONObject): string => {
      return String(entry["name"]);
    });

    for (const name of answered) {
      expect(name.endsWith("orders")).toBe(true);
    }

    // A name HR's salaries alone answers to: no table, and nothing said of it.
    const hr: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.tableLineageAnswer,
      body: { table: "salaries" },
    });

    expect(hr.error).toBeNull();
    expect(hr.sent!["tables"]).toEqual([]);
  });

  test("a pipeline's Lineage: theirs draws only their tables; HR's is not found", async () => {
    if (narrowed.pipelines.has(ORDERS_ETL)) {
      const outcome: RouteOutcome = await callRoute({
        path: DATA_OBSERVABILITY_API_ROUTES.pipelineLineage,
        body: { dataPipelineId: ORDERS_ETL, depth: 2, withColumns: true },
      });

      expectNoSecret(outcome, narrowed.tables);
      expect(JSON.stringify(outcome.sent)).toContain("orders_etl");
    }

    for (const pipelineId of [
      PAYROLL_SYNC,
      ...(narrowed.pipelines.has(ORDERS_ETL) ? [] : [ORDERS_ETL]),
    ]) {
      const outcome: RouteOutcome = await callRoute({
        path: DATA_OBSERVABILITY_API_ROUTES.pipelineLineage,
        body: { dataPipelineId: pipelineId },
      });

      expect(outcome.sent).toBeNull();
      expect(outcome.error?.message).toBe("Pipeline not found.");
    }
  });

  test("an alert's Lineage card: drawn around their table, nothing around HR's", async () => {
    const own: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.alertLineage(":id"),
      id: ALERT_ON_ORDERS,
    });

    expectNoSecret(own, narrowed.tables);
    expect(own.sent!["lineage"]).not.toBeNull();

    const hr: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.alertLineage(":id"),
      id: ALERT_ON_SALARIES,
    });

    expect(hr.error).toBeNull();
    expect(hr.sent!["lineage"]).toBeNull();
    expectNoSecret(hr, narrowed.tables);
  });

  test("the Lineage Map holds their flows alone", async () => {
    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.lineageMap,
    });

    expectNoSecret(outcome, narrowed.tables);
    expect(JSON.stringify(outcome.sent)).toContain("public.orders");
  });

  test("the Lineage Map searched for a word HR's pipeline answers to finds nothing of HR's", async () => {
    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.lineageMap,
      body: { search: "payroll" },
    });

    expectNoSecret(outcome, narrowed.tables);
  });

  test("the Lineage Map of one database holds only its tables they may read", async () => {
    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.lineageMap,
      body: { dataStoreId: uuid(5, 1) },
    });

    expectNoSecret(outcome, narrowed.tables);
  });
});

describe("for a caller whose grants narrow nothing", () => {
  beforeEach(() => {
    grant = null;
  });

  test("a table's Lineage tab draws HR's too, as it always did", async () => {
    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.tableLineage,
      body: { dataAssetId: ORDERS, depth: 3 },
    });
    const json: string = JSON.stringify(outcome.sent);

    expect(outcome.error).toBeNull();
    expect(json).toContain("public.salaries");
    expect(json).toContain("hr.headcount");
    // Nothing was asked of the scope beyond the caller's grants.
    expect(DataObservabilityReadScope.getReadableIds).not.toHaveBeenCalled();
  });

  test("the Lineage Map draws the project's newest flows, HR's among them", async () => {
    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.lineageMap,
    });

    expect(JSON.stringify(outcome.sent)).toContain("public.salaries");
    expect(DataLineageMapReader.getDatabaseFlowReader).toHaveBeenCalledTimes(1);
  });

  test("a pipeline's Lineage of HR's pipeline is drawn", async () => {
    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.pipelineLineage,
      body: { dataPipelineId: PAYROLL_SYNC },
    });

    expect(outcome.error).toBeNull();
    expect(JSON.stringify(outcome.sent)).toContain(
      getLineagePipelineNodeId(PAYROLL_SYNC),
    );
  });
});

describe("the Lineage Map's request", () => {
  test.each([
    [{ dataStoreId: "orders-db" }, "Name the database by its ID."],
    [
      { search: 42 },
      "Search for words: a table's name, or a pipeline's, a service's or a dashboard's.",
    ],
    [{ search: "x".repeat(101) }, "Search for at most 100 characters."],
  ])(
    "a request it cannot read is refused before anything is read: %p",
    async (body: JSONObject, message: string) => {
      const outcome: RouteOutcome = await callRoute({
        path: DATA_OBSERVABILITY_API_ROUTES.lineageMap,
        body,
      });

      expect(outcome.sent).toBeNull();
      expect(outcome.error?.message).toBe(message);
      expect(DataObservabilityReadScope.get).not.toHaveBeenCalled();
    },
  );
});

/*
 * OneUptime AI's data tools - Ask AI, an investigation's thread, Slack,
 * Microsoft Teams - read for the person who asked, so they tell of the
 * tables that person may read alone: "this table" never reaches one of
 * HR's, and a name HR's shares answers with theirs only.
 */
describe("OneUptime AI's data tools, for a role limited to what its members own", () => {
  beforeEach(() => {
    grant = OWNED;
    jest.spyOn(DataTableAnswerer, "answer").mockImplementation((async (
      _projectId: ObjectID,
      id: ObjectID,
    ) => {
      const row: { dataAssetId: string; assetKey: string } | undefined =
        graph.tables.get(id.toString());

      if (!row) {
        return null;
      }

      const answer: DataTableAnswer = {
        dataAssetId: row.dataAssetId,
        table: row.assetKey,
        database: "Warehouse",
        freshness: DataAssetFreshness.Fresh,
        lastChangedAt: null,
        usualIntervalInSeconds: null,
        lateBySeconds: 0,
        rowCount: null,
        isDropped: false,
        openAlerts: [],
        writerPipelines: [],
        dataProducts: [],
      };

      return answer;
    }) as never);
  });

  async function askTool(name: string, table: string): Promise<string> {
    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name,
      args: { table },
      ctx: { projectId: PROJECT, props: READER },
    });

    expect(outcome.success).toBe(true);

    return outcome.textForLlm;
  }

  test("get_data_table_lineage tells of their tables and pipelines alone", async () => {
    const text: string = await askTool("get_data_table_lineage", ORDERS);

    expect(text).toContain("public.orders");

    for (const secret of SECRETS) {
      expect(text).not.toContain(secret);
    }
  });

  test("get_data_table_lineage for HR's table, by its ID: no such table", async () => {
    const text: string = await askTool("get_data_table_lineage", SALARIES);

    expect(text).toContain("No table Data Observability watches is called");
    expect(text).not.toContain("public.salaries");
  });

  test("get_data_table_freshness answers for their tables of a name, never HR's", async () => {
    const text: string = await askTool("get_data_table_freshness", "salaries");

    expect(text).toContain("No table Data Observability watches is called");
    expect(text).not.toContain("public.salaries");
    expect(DataTableAnswerer.answer).not.toHaveBeenCalled();

    const own: string = await askTool("get_data_table_freshness", "orders");

    expect(own).toContain("public.orders");
    expect(own).not.toContain("public.salaries");
  });

  test("a caller whose grants narrow nothing is told of HR's too", async () => {
    grant = null;

    expect(await askTool("get_data_table_freshness", "salaries")).toContain(
      "public.salaries",
    );
  });
});

/*
 * A run of OneUptime's own - an investigation, read as root - writes its
 * report where everyone who may see its alert reads it, so its data tools
 * tell of what nobody in particular may read (#9562): none of HR's tables
 * or pipelines, which their owners and labels set apart - beside what the
 * alert it investigates names itself. Its own table is told whoever set it
 * apart; nothing else of HR's is.
 */
describe("OneUptime AI's data tools, in a run of OneUptime's own: nothing an owner or a label sets apart", () => {
  const SYSTEM_RUN: DatabaseCommonInteractionProps = {
    isRoot: true,
    tenantId: PROJECT,
  };
  const NOBODY_CONDITION: ReturnType<typeof QueryHelper.any> = QueryHelper.any([
    ORDERS,
    STAGING,
    RAW,
    REVENUE,
  ]);
  const NOBODY: Grant = {
    name: "nobody in particular",
    tables: new Set([ORDERS, STAGING, RAW, REVENUE]),
    pipelines: new Set([ORDERS_ETL]),
    scope: {
      isWholeProject: false,
      assetQuery: { projectId: PROJECT, _id: NOBODY_CONDITION },
      checkQuery: { projectId: PROJECT, dataAssetId: NOBODY_CONDITION },
      pipelineQuery: {
        projectId: PROJECT,
        _id: QueryHelper.any([ORDERS_ETL]),
      },
    },
  };

  let nobody: ReturnType<typeof jest.spyOn>;
  let alertRead: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    grant = NOBODY;
    nobody = jest
      .spyOn(DataObservabilityReadScope, "nobodyInParticular")
      .mockReturnValue(NOBODY.scope);
    // As the scope is worked out: OneUptime's own root reads are the whole project's.
    jest.spyOn(DataObservabilityReadScope, "get").mockImplementation((async (
      _projectId: ObjectID,
      props: DatabaseCommonInteractionProps,
    ) => {
      return props.isRoot
        ? DataObservabilityReadScope.wholeProject(PROJECT)
        : OWNED.scope;
    }) as never);
    // The alert an investigation is about: on HR's salaries.
    alertRead = jest
      .spyOn(DataAlertService, "findOneBy")
      .mockImplementation((async () => {
        const row: DataAlert = new DataAlert();
        row.alertId = new ObjectID(ALERT_ON_SALARIES);
        row.dataAssetId = new ObjectID(SALARIES);
        return row;
      }) as never);
    jest.spyOn(DataTableAnswerer, "answer").mockImplementation((async (
      _projectId: ObjectID,
      id: ObjectID,
    ) => {
      const row: { dataAssetId: string; assetKey: string } | undefined =
        graph.tables.get(id.toString());

      if (!row) {
        return null;
      }

      const answer: DataTableAnswer = {
        dataAssetId: row.dataAssetId,
        table: row.assetKey,
        database: "Warehouse",
        freshness: DataAssetFreshness.Fresh,
        lastChangedAt: null,
        usualIntervalInSeconds: null,
        lateBySeconds: 0,
        rowCount: null,
        isDropped: false,
        openAlerts: [],
        writerPipelines: [],
        dataProducts: [],
      };

      return answer;
    }) as never);
  });

  async function askTool(data: {
    name: string;
    table: string;
    props: DatabaseCommonInteractionProps;
    subjectAlertId?: string;
  }): Promise<string> {
    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: data.name,
      args: { table: data.table },
      ctx: {
        projectId: PROJECT,
        props: data.props,
        ...(data.subjectAlertId
          ? { subjectAlertId: new ObjectID(data.subjectAlertId) }
          : {}),
      },
    });

    expect(outcome.success).toBe(true);

    return outcome.textForLlm;
  }

  test("get_data_table_lineage tells an investigation of what nobody set apart alone", async () => {
    const text: string = await askTool({
      name: "get_data_table_lineage",
      table: ORDERS,
      props: SYSTEM_RUN,
    });

    expect(text).toContain("public.orders");
    expect(text).toContain("staging.orders");

    for (const secret of SECRETS) {
      expect(text).not.toContain(secret);
    }

    // Read as nobody in particular, never as the run's own root reads of the whole project.
    expect(nobody).toHaveBeenCalledWith(PROJECT);
    expect(DataObservabilityReadScope.get).not.toHaveBeenCalled();
  });

  test("get_data_table_freshness never answers an investigation for HR's table of a name", async () => {
    const text: string = await askTool({
      name: "get_data_table_freshness",
      table: "salaries",
      props: SYSTEM_RUN,
    });

    expect(text).toContain("No table Data Observability watches is called");
    expect(text).not.toContain("public.salaries");
    expect(DataTableAnswerer.answer).not.toHaveBeenCalled();
  });

  test("the table the investigated alert names is told, whoever set it apart, and nothing else of HR's", async () => {
    const freshness: string = await askTool({
      name: "get_data_table_freshness",
      table: "salaries",
      props: SYSTEM_RUN,
      subjectAlertId: ALERT_ON_SALARIES,
    });

    expect(freshness).toContain("public.salaries");

    const lineage: string = await askTool({
      name: "get_data_table_lineage",
      table: SALARIES,
      props: SYSTEM_RUN,
      subjectAlertId: ALERT_ON_SALARIES,
    });

    expect(lineage).toContain("public.salaries");
    // Built into their orders, which nobody set apart; built from HR's raw payroll, by HR's pipeline: never told.
    expect(lineage).toContain("public.orders");

    for (const secret of [
      PAYROLL_RAW,
      HEADCOUNT,
      PAYROLL_SYNC,
      HR_DASHBOARD,
      "hr.payroll_raw",
      "hr.headcount",
      "payroll_sync",
      "HR Headcount",
    ]) {
      expect(lineage).not.toContain(secret);
    }

    expect(alertRead).toHaveBeenCalled();
  });

  test("its writers and dashboards are asked of the same scope, the alert's own table read whatever sets it apart", async () => {
    const answer: ReturnType<typeof jest.spyOn> =
      DataTableAnswerer.answer as never;

    await askTool({
      name: "get_data_table_freshness",
      table: "salaries",
      props: SYSTEM_RUN,
      subjectAlertId: ALERT_ON_SALARIES,
    });

    expect(answer).toHaveBeenCalledTimes(1);

    const readable: {
      readableTableIds: (ids: Array<string>) => Promise<Set<string>>;
      readablePipelineIds: (ids: Array<string>) => Promise<Set<string>>;
    } = answer.mock.calls[0]![4] as never;

    expect(
      Array.from(
        await readable.readableTableIds([SALARIES, PAYROLL_RAW, ORDERS]),
      ).sort(),
    ).toEqual([ORDERS, SALARIES].sort());
    expect(
      Array.from(
        await readable.readablePipelineIds([PAYROLL_SYNC, ORDERS_ETL]),
      ),
    ).toEqual([ORDERS_ETL]);
  });

  test("a person reads as themselves: an alert never widens what they are told", async () => {
    grant = OWNED;

    const text: string = await askTool({
      name: "get_data_table_freshness",
      table: "salaries",
      props: READER,
      subjectAlertId: ALERT_ON_SALARIES,
    });

    expect(text).toContain("No table Data Observability watches is called");
    expect(text).not.toContain("public.salaries");
    expect(nobody).not.toHaveBeenCalled();
    expect(alertRead).not.toHaveBeenCalled();
  });
});

/*
 * The table-freshness route (what the MCP server asks) and the table's
 * dashboards name the table's writers and the tables built from it that a
 * dashboard reads: only those its caller may read (#9562), as every
 * lineage view tells them since #9526.
 */
describe("a table's freshness and dashboards, for a role limited to what its members own", () => {
  test("the table-freshness route reads its writers and dashboards with the caller's scope", async () => {
    grant = OWNED;

    const answer: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataTableAnswerer, "answer")
      .mockResolvedValue(null as never);
    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.tableFreshness,
      body: { table: "public.orders" },
    });

    expect(outcome.error).toBeNull();
    expect(
      answer.mock.calls.map((call: Array<unknown>): string => {
        return String(call[1]);
      }),
    ).toEqual([ORDERS]);

    const readable: {
      readableTableIds: (ids: Array<string>) => Promise<Set<string>>;
      readablePipelineIds: (ids: Array<string>) => Promise<Set<string>>;
    } = answer.mock.calls[0]![4] as never;

    expect(
      Array.from(
        await readable.readableTableIds([ORDERS, SALARIES, HEADCOUNT]),
      ),
    ).toEqual([ORDERS]);
    expect(
      Array.from(
        await readable.readablePipelineIds([ORDERS_ETL, PAYROLL_SYNC]),
      ),
    ).toEqual([ORDERS_ETL]);
  });

  test("a caller whose grants narrow nothing reads every writer and dashboard, as before", async () => {
    grant = null;

    const answer: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataTableAnswerer, "answer")
      .mockResolvedValue(null as never);

    await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.tableFreshness,
      body: { table: "salaries" },
    });

    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer.mock.calls[0]![4]).toBeNull();
  });

  test("the table's dashboards are reached only through the tables the caller may read", async () => {
    grant = OWNED;
    jest
      .spyOn(DataObservabilityAPI, "assertCanReadTable")
      .mockResolvedValue(undefined as never);

    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataTableDashboards, "find")
      .mockResolvedValue([] as never);
    const outcome: RouteOutcome = await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.tableDashboards,
      body: { dataAssetId: ORDERS },
    });

    expect(outcome.error).toBeNull();

    const readable: {
      readableTableIds: (ids: Array<string>) => Promise<Set<string>>;
    } = (find.mock.calls[0]![0] as { readable: never }).readable;

    expect(
      Array.from(await readable.readableTableIds([REVENUE, HEADCOUNT])),
    ).toEqual([REVENUE]);

    grant = null;
    find.mockClear();

    await callRoute({
      path: DATA_OBSERVABILITY_API_ROUTES.tableDashboards,
      body: { dataAssetId: ORDERS },
    });

    expect((find.mock.calls[0]![0] as { readable: unknown }).readable).toBe(
      null,
    );
  });
});
