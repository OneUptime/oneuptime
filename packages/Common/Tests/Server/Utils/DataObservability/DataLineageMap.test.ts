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
  DataLineageMap,
  DataLineageMapLineageRow,
  DataLineageMapNode,
  DataLineageMapUsageRow,
  MAX_DATA_LINEAGE_MAP_LINEAGE_ROWS,
  MAX_DATA_LINEAGE_MAP_USAGE_ROWS,
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

    expect(map).toEqual({
      nodes: [],
      edges: [],
      isTruncated: false,
      hiddenTableCount: 0,
      isHiddenTableCountAtLeast: false,
    });
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
