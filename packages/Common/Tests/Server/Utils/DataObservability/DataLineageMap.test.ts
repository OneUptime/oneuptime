import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import CommonAPI from "../../../../Server/API/CommonAPI";
import DataObservabilityAPI from "../../../../Server/API/DataObservabilityAPI";
import DataLineageMapReader, {
  DataLineageMapFlowReader,
} from "../../../../Server/Utils/DataObservability/DataLineageMap";
import {
  DataLineageDashboardRow,
  DataLineagePipelineRow,
  DataLineageReader,
  DataLineageTableRow,
} from "../../../../Server/Utils/DataObservability/DataTableLineage";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../../Server/Utils/Express";
import Response from "../../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../../Types/DataObservability/DataAssetLineageSource";
import { DataAssetAccessKind } from "../../../../Types/DataObservability/DataAssetUsage";
import {
  DataBiLineageProblem,
  DataBiSource,
  readDataBiLineageSummary,
} from "../../../../Types/DataObservability/DataBiLineage";
import DataBiTool from "../../../../Types/DataObservability/DataBiTool";
import { JSONObject } from "../../../../Types/JSON";
import DataBiConnection from "../../../../Models/DatabaseModels/DataBiConnection";
import DataBiConnectionService from "../../../../Server/Services/DataBiConnectionService";
import {
  DataLineageMap,
  DataLineageMapBiTool,
  DataLineageMapDashboardRow,
  DataLineageMapLineageRow,
  DataLineageMapNode,
  DataLineageMapUsageRow,
  MAX_DATA_LINEAGE_MAP_BI_DASHBOARD_ROWS,
  MAX_DATA_LINEAGE_MAP_BI_TOOLS,
  MAX_DATA_LINEAGE_MAP_LINEAGE_ROWS,
  MAX_DATA_LINEAGE_MAP_USAGE_ROWS,
  getLineageMapSourceNodeId,
} from "../../../../Types/DataObservability/DataLineageMap";
import { DATA_OBSERVABILITY_API_ROUTES } from "../../../../Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";

/*
 * THE PROJECT'S LINEAGE MAP, READ AND SERVED (#9114).
 *
 * The map reads a bounded number of the newest lineage and service-usage
 * rows - one more than it keeps, to know there were more - and then only
 * the tables, pipelines, open alerts and dashboards of the flows it keeps.
 * The route serves it to anyone who may read data assets, and their API
 * keys, read for the person who asked; anyone else is refused before
 * anything is read.
 */

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000001");

function tableRow(id: string): DataLineageTableRow {
  return {
    dataAssetId: id,
    assetKey: `public.${id}`,
    name: id,
    database: "orders-db",
    assetKind: DataAssetKind.Table,
    lastChangedAt: NOW,
    updateIntervalInSeconds: 3600,
    isDropped: false,
  };
}

interface Readers {
  flows: DataLineageMapFlowReader;
  details: DataLineageReader;
  asked: {
    lineageLimit: number | null;
    usageLimit: number | null;
    tables: Array<Array<string>>;
    pipelines: Array<Array<string>>;
    alerts: Array<Array<string>>;
    dashboards: Array<{ dataAssetIds: Array<string>; limit: number }>;
  };
}

function readers(data: {
  lineage: Array<DataLineageMapLineageRow>;
  usages: Array<DataLineageMapUsageRow>;
  tables: Array<DataLineageTableRow>;
  pipelines?: Array<DataLineagePipelineRow>;
  dashboards?: Array<DataLineageDashboardRow>;
  openAlerts?: Map<string, number>;
}): Readers {
  const asked: Readers["asked"] = {
    lineageLimit: null,
    usageLimit: null,
    tables: [],
    pipelines: [],
    alerts: [],
    dashboards: [],
  };

  return {
    asked,
    flows: {
      readLineage: async (limit: number) => {
        asked.lineageLimit = limit;
        return data.lineage.slice(0, limit);
      },
      readUsages: async (limit: number) => {
        asked.usageLimit = limit;
        return data.usages.slice(0, limit);
      },
    },
    details: {
      readEdges: async () => {
        throw new Error("the map reads no edges one table at a time");
      },
      readColumnMappings: async () => {
        throw new Error("the map reads no columns");
      },
      readTables: async (ids: Array<string>) => {
        asked.tables.push(ids);
        return data.tables.filter((table: DataLineageTableRow): boolean => {
          return ids.includes(table.dataAssetId);
        });
      },
      readPipelines: async (ids: Array<string>) => {
        asked.pipelines.push(ids);
        return (data.pipelines || []).filter(
          (pipeline: DataLineagePipelineRow): boolean => {
            return ids.includes(pipeline.dataPipelineId);
          },
        );
      },
      readOpenAlertCounts: async (ids: Array<string>) => {
        asked.alerts.push(ids);
        return data.openAlerts || new Map();
      },
      readDashboards: async (request: {
        dataAssetIds: Array<string>;
        limit: number;
      }) => {
        asked.dashboards.push({
          dataAssetIds: request.dataAssetIds,
          limit: request.limit,
        });
        const found: Array<DataLineageDashboardRow> = data.dashboards || [];
        return {
          dashboards: found.slice(0, request.limit),
          total: found.length,
        };
      },
    },
  };
}

describe("DataLineageMapReader.build", () => {
  test("reads one row more than it keeps, then only what is on the map", async () => {
    const r: Readers = readers({
      lineage: [
        {
          upstreamDataAssetId: "raw",
          downstreamDataAssetId: "orders",
          dataPipelineId: "p1",
          source: DataAssetLineageSource.Pipeline,
          lastSeenAt: NOW,
        },
      ],
      usages: [
        {
          dataAssetId: "orders",
          serviceId: "svc-1",
          serviceName: "checkout",
          accessKind: DataAssetAccessKind.Write,
          operations: ["INSERT"],
          lastSeenAt: NOW,
        },
      ],
      tables: [tableRow("raw"), tableRow("orders"), tableRow("unrelated")],
      pipelines: [
        {
          dataPipelineId: "p1",
          jobName: "orders_etl",
          jobNamespace: "airflow",
          lastRunState: "COMPLETE",
          lastRunStartedAt: NOW,
          lastErrorMessage: null,
        },
      ],
      dashboards: [
        {
          dataDashboardId: "d1",
          name: "Revenue",
          tool: "Metabase",
          url: null,
          dataAssetIds: ["orders"],
        },
      ],
      openAlerts: new Map([["orders", 1]]),
    });

    const map: DataLineageMap = await DataLineageMapReader.build({
      flows: r.flows,
      details: r.details,
      now: NOW,
    });

    expect(r.asked.lineageLimit).toBe(MAX_DATA_LINEAGE_MAP_LINEAGE_ROWS + 1);
    expect(r.asked.usageLimit).toBe(MAX_DATA_LINEAGE_MAP_USAGE_ROWS + 1);
    expect(r.asked.tables).toEqual([["orders", "raw"]]);
    expect(r.asked.pipelines).toEqual([["p1"]]);
    expect(r.asked.alerts).toEqual([["orders", "raw"]]);
    expect(r.asked.dashboards[0]!.dataAssetIds).toEqual(["orders", "raw"]);

    expect(
      map.nodes.map((node: DataLineageMapNode): string => {
        return node.id;
      }),
    ).toEqual(["dashboard:d1", "service:svc-1", "table:orders", "table:raw"]);
    expect(
      map.edges.map((edge: { id: string }): string => {
        return edge.id;
      }),
    ).toEqual([
      "Feeds:table:raw>table:orders",
      "Reads:table:orders>dashboard:d1",
      "Writes:service:svc-1>table:orders",
    ]);
    expect(map.edges[0]!.pipelines[0]!.name).toBe("orders_etl");
    expect(map.isTruncated).toBe(false);
  });

  test("a project with no flows reads nothing more and draws nothing", async () => {
    const r: Readers = readers({ lineage: [], usages: [], tables: [] });

    const map: DataLineageMap = await DataLineageMapReader.build({
      flows: r.flows,
      details: r.details,
      now: NOW,
    });

    expect(map).toEqual({ nodes: [], edges: [], isTruncated: false });
    expect(r.asked.tables).toEqual([]);
    expect(r.asked.dashboards).toEqual([]);
  });

  test("more rows than a map reads make it truncated, with what it read still drawn", async () => {
    const usages: Array<DataLineageMapUsageRow> = [];

    for (let i: number = 0; i <= MAX_DATA_LINEAGE_MAP_USAGE_ROWS; i++) {
      usages.push({
        dataAssetId: "orders",
        serviceId: "svc-1",
        serviceName: "checkout",
        accessKind: DataAssetAccessKind.Read,
        operations: ["SELECT"],
        lastSeenAt: NOW,
      });
    }

    const r: Readers = readers({
      lineage: [],
      usages,
      tables: [tableRow("orders")],
    });

    const map: DataLineageMap = await DataLineageMapReader.build({
      flows: r.flows,
      details: r.details,
      now: NOW,
    });

    expect(map.isTruncated).toBe(true);
    expect(map.edges).toHaveLength(1);
  });
});

/*
 * A project whose only lineage is its BI tool's still has a map (#9507):
 * it said "No lineage yet" while hundreds of Power BI reports were read,
 * because a dashboard was drawn only on tables another flow drew.
 */
describe("DataLineageMapReader.build, with BI dashboards no flow draws", () => {
  const SHAREPOINT: DataBiSource = {
    type: "SharePoint",
    engine: null,
    server: null,
    database: null,
    location: "https://acme.sharepoint.com/sites/facilities",
  };

  function withBi(
    r: Readers,
    rows: Array<DataLineageMapDashboardRow>,
  ): { flows: DataLineageMapFlowReader; limits: Array<number> } {
    const limits: Array<number> = [];

    return {
      limits,
      flows: {
        ...r.flows,
        readBiDashboards: async (limit: number) => {
          limits.push(limit);
          return rows.slice(0, limit);
        },
      },
    };
  }

  test("a project with only a BI tool: its dashboards with their watched tables, and Power BI's own lineage", async () => {
    const r: Readers = readers({
      lineage: [],
      usages: [],
      tables: [tableRow("orders")],
    });
    const bi: { flows: DataLineageMapFlowReader; limits: Array<number> } =
      withBi(r, [
        {
          dataDashboardId: "revenue",
          name: "Revenue",
          tool: "Power BI",
          url: null,
          dataAssetIds: ["orders"],
          upstream: null,
        },
        {
          dataDashboardId: "checklist",
          name: "15 29 EMG NUO Master Checklist- GANTT View.xlsx",
          tool: "Power BI",
          url: null,
          dataAssetIds: [],
          upstream: {
            datasets: [
              {
                id: "ds-checklist",
                name: "Master Checklist",
                workspace: "New Unit Readiness",
                sources: [SHAREPOINT],
              },
            ],
            sources: [SHAREPOINT],
          },
        },
      ]);

    const map: DataLineageMap = await DataLineageMapReader.build({
      flows: bi.flows,
      details: r.details,
      now: NOW,
    });

    expect(bi.limits).toEqual([MAX_DATA_LINEAGE_MAP_BI_DASHBOARD_ROWS + 1]);
    // Only the tables on the map are read, with their open alerts.
    expect(r.asked.tables).toEqual([["orders"]]);
    expect(r.asked.alerts).toEqual([["orders"]]);
    expect(
      map.nodes.map((node: DataLineageMapNode): string => {
        return node.id;
      }),
    ).toEqual([
      "dashboard:checklist",
      "dashboard:revenue",
      "dataset:ds-checklist",
      getLineageMapSourceNodeId(SHAREPOINT),
      "table:orders",
    ]);
    expect(
      map.edges.map((edge: { id: string }): string => {
        return edge.id;
      }),
    ).toEqual([
      `Feeds:${getLineageMapSourceNodeId(SHAREPOINT)}>dataset:ds-checklist`,
      "Reads:dataset:ds-checklist>dashboard:checklist",
      "Reads:table:orders>dashboard:revenue",
    ]);
    expect(map.isTruncated).toBe(false);
  });

  test("dashboards the flows draw already are not drawn twice", async () => {
    const r: Readers = readers({
      lineage: [
        {
          upstreamDataAssetId: "raw",
          downstreamDataAssetId: "orders",
          dataPipelineId: null,
          source: DataAssetLineageSource.QueryHistory,
          lastSeenAt: NOW,
        },
      ],
      usages: [],
      tables: [tableRow("raw"), tableRow("orders")],
      dashboards: [
        {
          dataDashboardId: "d1",
          name: "Revenue",
          tool: "Power BI",
          url: null,
          dataAssetIds: ["orders"],
        },
      ],
    });
    const bi: { flows: DataLineageMapFlowReader; limits: Array<number> } =
      withBi(r, [
        {
          dataDashboardId: "d1",
          name: "Revenue",
          tool: "Power BI",
          url: null,
          dataAssetIds: ["orders"],
        },
      ]);

    const map: DataLineageMap = await DataLineageMapReader.build({
      flows: bi.flows,
      details: r.details,
      now: NOW,
    });

    expect(
      map.nodes.filter((node: DataLineageMapNode): boolean => {
        return node.id === "dashboard:d1";
      }),
    ).toHaveLength(1);
    expect(r.asked.tables).toEqual([["orders", "raw"]]);
  });

  test("a full map reads no BI dashboards", async () => {
    const r: Readers = readers({
      lineage: [
        {
          upstreamDataAssetId: "raw",
          downstreamDataAssetId: "orders",
          dataPipelineId: null,
          source: DataAssetLineageSource.QueryHistory,
          lastSeenAt: NOW,
        },
      ],
      usages: [],
      tables: [tableRow("raw"), tableRow("orders")],
    });
    const bi: { flows: DataLineageMapFlowReader; limits: Array<number> } =
      withBi(r, []);

    await DataLineageMapReader.build({
      flows: bi.flows,
      details: r.details,
      now: NOW,
      maxNodes: 2,
    });

    expect(bi.limits).toEqual([]);
  });

  test("BI dashboards on nothing - no table, no dataset - draw nothing, and read nothing more", async () => {
    const r: Readers = readers({ lineage: [], usages: [], tables: [] });
    const bi: { flows: DataLineageMapFlowReader; limits: Array<number> } =
      withBi(r, [
        {
          dataDashboardId: "empty",
          name: "Empty",
          tool: "Power BI",
          url: null,
          dataAssetIds: [],
          upstream: { datasets: [], sources: [] },
        },
      ]);

    expect(
      await DataLineageMapReader.build({
        flows: bi.flows,
        details: r.details,
        now: NOW,
      }),
    ).toEqual({ nodes: [], edges: [], isTruncated: false });
    expect(r.asked.tables).toEqual([]);
  });
});

/*
 * The BI tools the map tells of (#9507): each whose dashboards were read
 * but are on no watched table, with why; the map carries them, so the page
 * says why it cannot draw them on tables without asking twice.
 */
describe("the BI tools the map tells of", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function connection(fields: Partial<DataBiConnection>): DataBiConnection {
    const model: DataBiConnection = new DataBiConnection();

    model._id = ObjectID.generate().toString();
    Object.assign(model, fields);

    return model;
  }

  const SUMMARY: JSONObject = {
    dashboardCount: 783,
    tableCount: 0,
    matchedTableCount: 0,
    datasets: { count: 59, withTables: 0, withQueries: 0 },
    sources: [],
    problems: [DataBiLineageProblem.NoTablesFromTool],
  };

  test("a tool whose dashboards were read but matched no table, with why; no other", async () => {
    const off: DataBiConnection = connection({
      name: "Oneuptime PBI Data Observability",
      tool: DataBiTool.PowerBI,
      dashboardCount: 783,
      matchedTableCount: 0,
      lineageSummary: SUMMARY,
    });
    const find: jest.SpyInstance = jest
      .spyOn(DataBiConnectionService, "findBy")
      .mockResolvedValue([
        off,
        // On watched tables already.
        connection({
          name: "Metabase",
          dashboardCount: 12,
          matchedTableCount: 3,
          lineageSummary: SUMMARY,
        }),
        // Never read, or read before a summary was kept, or with nothing in the way.
        connection({ name: "New", dashboardCount: 0, matchedTableCount: 0 }),
        connection({ name: "Old", dashboardCount: 5, matchedTableCount: 0 }),
        connection({
          name: "Fine",
          dashboardCount: 5,
          matchedTableCount: 0,
          lineageSummary: { ...SUMMARY, problems: [] },
        }),
      ] as never) as unknown as jest.SpyInstance;

    const tools: Array<DataLineageMapBiTool> =
      await DataLineageMapReader.readBiToolsOffTables(PROJECT_ID);

    expect(tools).toEqual([
      {
        dataBiConnectionId: off.id!.toString(),
        name: "Oneuptime PBI Data Observability",
        tool: DataBiTool.PowerBI,
        dashboardCount: 783,
        summary: expect.objectContaining({
          dashboardCount: 783,
          problems: [DataBiLineageProblem.NoTablesFromTool],
        }),
      },
    ]);
    expect(find.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID },
      limit: MAX_DATA_LINEAGE_MAP_BI_TOOLS,
    });
  });

  test("the map carries them, and leaves them out when there are none", async () => {
    const drawn: DataLineageMap = { nodes: [], edges: [], isTruncated: false };
    const tool: DataLineageMapBiTool = {
      dataBiConnectionId: "77777777-7777-4777-8777-000000000001",
      name: "Power BI",
      tool: DataBiTool.PowerBI,
      dashboardCount: 783,
      summary: readDataBiLineageSummary(SUMMARY)!,
    };

    jest.spyOn(DataLineageMapReader, "build").mockResolvedValue(drawn);
    const readTools: jest.SpyInstance = jest
      .spyOn(DataLineageMapReader, "readBiToolsOffTables")
      .mockResolvedValueOnce([tool])
      .mockResolvedValueOnce([]) as unknown as jest.SpyInstance;

    expect(
      await DataLineageMapReader.read({
        projectId: PROJECT_ID,
        now: NOW,
        reader: null,
      }),
    ).toEqual({ ...drawn, biToolsOffTables: [tool] });
    expect(
      await DataLineageMapReader.read({
        projectId: PROJECT_ID,
        now: NOW,
        reader: null,
      }),
    ).toEqual(drawn);
    expect(readTools).toHaveBeenCalledWith(PROJECT_ID);
  });
});

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

function withPermission(
  permission: Permission,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
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

function handlerOf(path: string): RouteHandler {
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

async function askMap(props: DatabaseCommonInteractionProps): Promise<{
  sent: Mock<(...args: Array<unknown>) => unknown>;
  next: Mock<(...args: Array<unknown>) => unknown>;
  read: ReturnType<typeof jest.spyOn>;
}> {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);

  const sent: Mock<(...args: Array<unknown>) => unknown> = jest.fn();
  const next: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

  jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation(sent as never);

  const read: ReturnType<typeof jest.spyOn> = jest
    .spyOn(DataLineageMapReader, "read")
    .mockResolvedValue({ nodes: [], edges: [], isTruncated: false } as never);

  await handlerOf(DATA_OBSERVABILITY_API_ROUTES.lineageMap)(
    { body: {}, params: {} } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return { sent, next, read };
}

describe("the lineage map route", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("anyone who may read data assets gets the project's map, read for them", async () => {
    const props: DatabaseCommonInteractionProps = withPermission(
      Permission.ReadDataAsset,
    );
    const asked: Awaited<ReturnType<typeof askMap>> = await askMap(props);

    expect(asked.next).not.toHaveBeenCalled();
    expect(asked.read).toHaveBeenCalledTimes(1);

    const call: {
      projectId: ObjectID;
      reader: DatabaseCommonInteractionProps;
    } = asked.read.mock.calls[0]![0] as {
      projectId: ObjectID;
      reader: DatabaseCommonInteractionProps;
    };

    expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(call.reader).toBe(props);
    expect(asked.sent).toHaveBeenCalledTimes(1);
    expect(asked.sent.mock.calls[0]![2]).toEqual({
      nodes: [],
      edges: [],
      isTruncated: false,
    });
  });

  test("someone who may not read data assets is refused before anything is read", async () => {
    const asked: Awaited<ReturnType<typeof askMap>> = await askMap(
      withPermission(Permission.CreateProjectIncident),
    );

    expect(asked.read).not.toHaveBeenCalled();
    expect(asked.sent).not.toHaveBeenCalled();
    expect(asked.next).toHaveBeenCalledTimes(1);
  });
});
