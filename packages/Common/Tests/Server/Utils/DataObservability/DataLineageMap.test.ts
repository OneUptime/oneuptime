import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import CommonAPI from "../../../../Server/API/CommonAPI";
import DataObservabilityAPI from "../../../../Server/API/DataObservabilityAPI";
import DataAssetLineageService from "../../../../Server/Services/DataAssetLineageService";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataAssetUsageService from "../../../../Server/Services/DataAssetUsageService";
import DataDashboardService from "../../../../Server/Services/DataDashboardService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import DataLineageMapReader, {
  DataLineageMapFlowReader,
  DataLineageMapFocus,
} from "../../../../Server/Utils/DataObservability/DataLineageMap";
import DataObservabilityReadScope, {
  DataObservabilityScope,
} from "../../../../Server/Utils/DataObservability/DataObservabilityReadScope";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../../Models/DatabaseModels/DataAssetLineage";
import DataAssetUsage from "../../../../Models/DatabaseModels/DataAssetUsage";
import DataDashboard from "../../../../Models/DatabaseModels/DataDashboard";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import Includes from "../../../../Types/BaseDatabase/Includes";
import {
  DataLineageDashboardRow,
  DataLineagePipelineRow,
  DataLineageReadable,
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
  MAX_DATA_LINEAGE_MAP_DASHBOARDS,
  MAX_DATA_LINEAGE_MAP_SEARCH_MATCHES,
  MAX_DATA_LINEAGE_MAP_FOCUS_TABLES,
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
    ).toEqual({
      nodes: [],
      edges: [],
      isTruncated: false,
      hiddenTableCount: 0,
      isHiddenTableCountAtLeast: false,
    });
    expect(r.asked.tables).toEqual([]);
  });

  /*
   * A reader limited to some tables (#9526) is drawn the BI dashboards
   * their tables lead to (#9553) - before, none at all - each with only
   * those tables, and never a dashboard on no table they may read, nor one
   * on no watched table: its datasets and sources are no table of theirs.
   */
  test("a reader limited to some tables is drawn the dashboards their tables lead to, with only those tables", async () => {
    const r: Readers = readers({
      lineage: [],
      usages: [],
      tables: [tableRow("orders"), tableRow("salaries")],
    });
    const bi: { flows: DataLineageMapFlowReader; limits: Array<number> } =
      withBi(r, [
        {
          dataDashboardId: "facilities",
          name: "Facilities",
          tool: "Power BI",
          url: null,
          dataAssetIds: ["orders"],
          upstream: null,
        },
        {
          dataDashboardId: "mixed",
          name: "Orders and Salaries",
          tool: "Power BI",
          url: null,
          dataAssetIds: ["orders", "salaries"],
          upstream: null,
        },
        {
          dataDashboardId: "payroll",
          name: "Payroll",
          tool: "Power BI",
          url: null,
          dataAssetIds: ["salaries"],
          upstream: null,
        },
        {
          dataDashboardId: "checklist",
          name: "Checklist",
          tool: "Power BI",
          url: null,
          dataAssetIds: [],
          upstream: {
            datasets: [
              {
                id: "ds-checklist",
                name: "Checklist",
                workspace: "Ops",
                sources: [SHAREPOINT],
              },
            ],
            sources: [SHAREPOINT],
          },
        },
      ]);
    const onlyOrders: DataLineageReadable = {
      readableTableIds: async (ids: Array<string>): Promise<Set<string>> => {
        return new Set(
          ids.filter((id: string): boolean => {
            return id === "orders";
          }),
        );
      },
      readablePipelineIds: async (): Promise<Set<string>> => {
        return new Set();
      },
    };

    const whole: DataLineageMap = await DataLineageMapReader.build({
      flows: bi.flows,
      details: r.details,
      now: NOW,
    });

    expect(
      whole.nodes.map((node: DataLineageMapNode): string => {
        return node.id;
      }),
    ).toEqual([
      "dashboard:checklist",
      "dashboard:facilities",
      "dashboard:mixed",
      "dashboard:payroll",
      "dataset:ds-checklist",
      getLineageMapSourceNodeId(SHAREPOINT),
      "table:orders",
      "table:salaries",
    ]);

    r.asked.tables.length = 0;

    const limited: DataLineageMap = await DataLineageMapReader.build({
      flows: bi.flows,
      details: r.details,
      now: NOW,
      readable: onlyOrders,
    });

    expect(
      limited.nodes.map((node: DataLineageMapNode): string => {
        return node.id;
      }),
    ).toEqual(["dashboard:facilities", "dashboard:mixed", "table:orders"]);
    expect(
      limited.edges.map((edge: { id: string }): string => {
        return edge.id;
      }),
    ).toEqual([
      "Reads:table:orders>dashboard:facilities",
      "Reads:table:orders>dashboard:mixed",
    ]);
    // A table they may not read is never read for them.
    expect(r.asked.tables).toEqual([["orders"]]);
  });
});

/*
 * A map that starts somewhere finds BI dashboards no flow draws (#9553):
 * a search draws first the dashboards it names - by their names, or their
 * datasets' or data sources' - and a database the dashboards on its
 * tables, the usual case for a project whose only lineage is its BI
 * tool's. Before, a search for a Power BI report on no watched table found
 * nothing, and one among hundreds on the same dataset could be left off.
 */
describe("DataLineageMapReader.build, starting from a database or a search", () => {
  const SHAREPOINT: DataBiSource = {
    type: "SharePoint",
    engine: null,
    server: null,
    database: null,
    location: "https://acme.sharepoint.com/sites/facilities",
  };

  function dashboardRow(
    id: string,
    fields: Partial<DataLineageMapDashboardRow> = {},
  ): DataLineageMapDashboardRow {
    return {
      dataDashboardId: id,
      name: id,
      tool: "Power BI",
      url: null,
      dataAssetIds: [],
      upstream: null,
      ...fields,
    };
  }

  function focused(
    r: Readers,
    data: {
      named?: Array<DataLineageMapDashboardRow>;
      onTables?: Array<DataLineageMapDashboardRow>;
    },
  ): DataLineageMapFlowReader {
    return {
      ...r.flows,
      readNamedDashboards: async (limit: number) => {
        return (data.named || []).slice(0, limit);
      },
      readBiDashboards: async (limit: number) => {
        return (data.onTables || []).slice(0, limit);
      },
    };
  }

  test("a search draws the report it names first, though hundreds of others are built on the same table", async () => {
    const onOrders: Array<DataLineageDashboardRow> = Array.from(
      { length: 300 },
      (_: unknown, index: number): DataLineageDashboardRow => {
        return {
          dataDashboardId: `d${String(index).padStart(3, "0")}`,
          name: `Dashboard ${String(index).padStart(3, "0")}`,
          tool: "Power BI",
          url: null,
          dataAssetIds: ["orders"],
        };
      },
    );
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
      dashboards: onOrders,
    });
    const map: DataLineageMap = await DataLineageMapReader.build({
      flows: focused(r, {
        // The 250th by name: past the most a map draws, read by name.
        named: [
          dashboardRow("d250", {
            name: "Dashboard 250",
            dataAssetIds: ["orders"],
          }),
        ],
      }),
      details: r.details,
      now: NOW,
    });
    const dashboards: Array<string> = map.nodes
      .filter((node: DataLineageMapNode): boolean => {
        return node.id.startsWith("dashboard:");
      })
      .map((node: DataLineageMapNode): string => {
        return node.id;
      });

    expect(dashboards).toContain("dashboard:d250");
    expect(dashboards).toHaveLength(MAX_DATA_LINEAGE_MAP_DASHBOARDS);
    expect(map.isTruncated).toBe(true);
    // The flows' dashboards fill the room it leaves.
    expect(r.asked.dashboards[0]!.limit).toBe(
      MAX_DATA_LINEAGE_MAP_DASHBOARDS - 1 + 1 + 1,
    );
  });

  test("named dashboards that fill the room still let the map say the flows' own were left off", async () => {
    const named: Array<DataLineageMapDashboardRow> = Array.from(
      { length: MAX_DATA_LINEAGE_MAP_DASHBOARDS },
      (_: unknown, index: number): DataLineageMapDashboardRow => {
        return dashboardRow(`named${String(index).padStart(3, "0")}`, {
          dataAssetIds: ["orders"],
        });
      },
    );
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
      // One the search named, and one it did not.
      dashboards: [
        {
          dataDashboardId: "named000",
          name: "named000",
          tool: "Power BI",
          url: null,
          dataAssetIds: ["orders"],
        },
        {
          dataDashboardId: "other",
          name: "Other",
          tool: "Power BI",
          url: null,
          dataAssetIds: ["orders"],
        },
      ],
    });
    const map: DataLineageMap = await DataLineageMapReader.build({
      flows: focused(r, { named }),
      details: r.details,
      now: NOW,
    });
    const dashboards: Array<string> = map.nodes
      .filter((node: DataLineageMapNode): boolean => {
        return node.id.startsWith("dashboard:");
      })
      .map((node: DataLineageMapNode): string => {
        return node.id;
      });

    expect(dashboards).toHaveLength(MAX_DATA_LINEAGE_MAP_DASHBOARDS);
    expect(dashboards).not.toContain("dashboard:other");
    // Read though no room was left: enough to pass those drawn and know one was not.
    expect(r.asked.dashboards[0]!.limit).toBe(
      MAX_DATA_LINEAGE_MAP_DASHBOARDS + 1,
    );
    expect(map.isTruncated).toBe(true);
  });

  test("in a project whose only lineage is Power BI's, a search draws the report it names with its dataset and sources", async () => {
    const r: Readers = readers({ lineage: [], usages: [], tables: [] });
    const map: DataLineageMap = await DataLineageMapReader.build({
      flows: focused(r, {
        named: [
          dashboardRow("checklist", {
            name: "15 29 EMG NUO Master Checklist- GANTT View.xlsx",
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
          }),
        ],
      }),
      details: r.details,
      now: NOW,
    });

    expect(
      map.nodes.map((node: DataLineageMapNode): string => {
        return node.id;
      }),
    ).toEqual([
      "dashboard:checklist",
      "dataset:ds-checklist",
      getLineageMapSourceNodeId(SHAREPOINT),
    ]);
    // No table to read.
    expect(r.asked.tables).toEqual([]);
  });

  test("a database draws the dashboards on its tables though no flow touches them", async () => {
    const r: Readers = readers({
      lineage: [],
      usages: [],
      tables: [tableRow("orders"), tableRow("customers")],
    });
    const map: DataLineageMap = await DataLineageMapReader.build({
      flows: focused(r, {
        onTables: [
          dashboardRow("revenue", { dataAssetIds: ["orders", "customers"] }),
          dashboardRow("churn", { dataAssetIds: ["customers"] }),
        ],
      }),
      details: r.details,
      now: NOW,
    });

    expect(
      map.nodes.map((node: DataLineageMapNode): string => {
        return node.id;
      }),
    ).toEqual([
      "dashboard:churn",
      "dashboard:revenue",
      "table:customers",
      "table:orders",
    ]);
    expect(r.asked.tables).toEqual([["customers", "orders"]]);
  });

  test("a dashboard a search names is drawn once, however else it is found", async () => {
    const r: Readers = readers({
      lineage: [],
      usages: [],
      tables: [tableRow("orders")],
    });
    const revenue: DataLineageMapDashboardRow = dashboardRow("revenue", {
      dataAssetIds: ["orders"],
    });
    const map: DataLineageMap = await DataLineageMapReader.build({
      flows: focused(r, { named: [revenue], onTables: [revenue] }),
      details: r.details,
      now: NOW,
    });

    expect(
      map.nodes.filter((node: DataLineageMapNode): boolean => {
        return node.id === "dashboard:revenue";
      }),
    ).toHaveLength(1);
  });

  test("a reader limited to some tables is never drawn a dashboard a search names on tables they may not read", async () => {
    const r: Readers = readers({
      lineage: [],
      usages: [],
      tables: [tableRow("orders"), tableRow("salaries")],
    });
    const map: DataLineageMap = await DataLineageMapReader.build({
      flows: focused(r, {
        named: [
          dashboardRow("payroll", { dataAssetIds: ["salaries"] }),
          dashboardRow("checklist", {
            upstream: { datasets: [], sources: [SHAREPOINT] },
          }),
          dashboardRow("revenue", { dataAssetIds: ["orders", "salaries"] }),
        ],
      }),
      details: r.details,
      now: NOW,
      readable: {
        readableTableIds: async (ids: Array<string>): Promise<Set<string>> => {
          return new Set(
            ids.filter((id: string): boolean => {
              return id === "orders";
            }),
          );
        },
        readablePipelineIds: async (): Promise<Set<string>> => {
          return new Set();
        },
      },
    });

    expect(
      map.nodes.map((node: DataLineageMapNode): string => {
        return node.id;
      }),
    ).toEqual(["dashboard:revenue", "table:orders"]);
    expect(map.isTruncated).toBe(false);
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

/*
 * A MAP THAT STARTS SOMEWHERE (#6547), READ FROM THE DATABASE.
 *
 * One database, or a search of the whole project, reads the rows of the
 * tables it starts from - their rows each way, the services on them, and
 * the rows of the pipelines a search names - a few hundred ids a read, each
 * row once, the newest first. A reader limited to some tables starts from
 * the ones they may read (#9526). A whole map, read by someone who may read
 * the whole project, reads the project's newest rows as it always did.
 */
type FindCall = {
  query: Record<string, unknown>;
  select?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  limit?: number;
  props: DatabaseCommonInteractionProps;
};

function callsOf(spy: ReturnType<typeof jest.spyOn>): Array<FindCall> {
  return spy.mock.calls.map((call: Array<unknown>): FindCall => {
    return call[0] as FindCall;
  });
}

function uuidOf(index: number): string {
  return `00000009-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function idsIn(value: unknown): Array<string> {
  expect(value).toBeInstanceOf(Includes);

  return (value as Includes).values.map((entry: unknown): string => {
    return String(entry);
  });
}

function lineageModel(fields: {
  id: number;
  upstream: string | null;
  downstream: string;
  pipeline?: string | null;
  hoursAgo: number;
}): DataAssetLineage {
  const row: DataAssetLineage = new DataAssetLineage();

  row._id = uuidOf(1000 + fields.id);
  row.upstreamDataAssetId = fields.upstream
    ? new ObjectID(fields.upstream)
    : undefined!;
  row.downstreamDataAssetId = new ObjectID(fields.downstream);
  row.dataPipelineId = fields.pipeline
    ? new ObjectID(fields.pipeline)
    : undefined!;
  row.lastSeenAt = new Date(NOW.getTime() - fields.hoursAgo * 60 * 60 * 1000);

  return row;
}

describe("the rows of the tables a map starts from (getFocusedFlowReader)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("each table's rows both ways and each pipeline's own, every row once, the newest first, the project's own", async () => {
    const A: string = uuidOf(1);
    const B: string = uuidOf(2);
    const PIPE: string = uuidOf(50);
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAssetLineageService, "findBy")
      .mockImplementation((async (findBy: FindCall) => {
        if (findBy.query["downstreamDataAssetId"]) {
          return [
            lineageModel({ id: 1, upstream: B, downstream: A, hoursAgo: 5 }),
          ];
        }

        if (findBy.query["upstreamDataAssetId"]) {
          // The same row again, read from its other end: kept once.
          return [
            lineageModel({ id: 1, upstream: B, downstream: A, hoursAgo: 5 }),
            lineageModel({ id: 2, upstream: A, downstream: B, hoursAgo: 1 }),
          ];
        }

        return [
          lineageModel({
            id: 3,
            upstream: null,
            downstream: B,
            pipeline: PIPE,
            hoursAgo: 3,
          }),
        ];
      }) as never);
    const focus: DataLineageMapFocus = {
      dataAssetIds: [A, B],
      dataPipelineIds: [PIPE],
      dataDashboardIds: [],
      isTruncated: false,
    };

    const rows: Array<DataLineageMapLineageRow> =
      await DataLineageMapReader.getFocusedFlowReader(
        PROJECT_ID,
        focus,
      ).readLineage(10);

    expect(
      rows.map((row: DataLineageMapLineageRow): string => {
        return `${row.upstreamDataAssetId || row.dataPipelineId}>${row.downstreamDataAssetId}`;
      }),
    ).toEqual([`${A}>${B}`, `${PIPE}>${B}`, `${B}>${A}`]);

    const calls: Array<FindCall> = callsOf(read);

    expect(calls).toHaveLength(3);

    for (const call of calls) {
      expect(call.query["projectId"]).toBe(PROJECT_ID);
      expect(call.props).toEqual({ isRoot: true });
      expect(call.limit).toBe(10);
    }

    expect(idsIn(calls[0]!.query["downstreamDataAssetId"])).toEqual([A, B]);
    expect(idsIn(calls[1]!.query["upstreamDataAssetId"])).toEqual([A, B]);
    expect(idsIn(calls[2]!.query["dataPipelineId"])).toEqual([PIPE]);
  });

  test("many tables are read a few hundred ids at a time, at most as many rows as asked", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAssetLineageService, "findBy")
      .mockResolvedValue([] as never);
    const tables: Array<string> = [];

    for (let index: number = 0; index < 1001; index++) {
      tables.push(uuidOf(index));
    }

    await DataLineageMapReader.getFocusedFlowReader(PROJECT_ID, {
      dataAssetIds: tables,
      dataPipelineIds: [],
      dataDashboardIds: [],
      isTruncated: false,
    }).readLineage(5);

    // Three chunks, each read both ways.
    expect(
      callsOf(read).map((call: FindCall): number => {
        return idsIn(
          call.query["downstreamDataAssetId"] ||
            call.query["upstreamDataAssetId"],
        ).length;
      }),
    ).toEqual([500, 500, 500, 500, 1, 1]);
  });

  test("the services reading and writing each table, each row once, the newest first", async () => {
    const A: string = uuidOf(1);
    const usageModel: (id: number, hoursAgo: number) => DataAssetUsage = (
      id: number,
      hoursAgo: number,
    ): DataAssetUsage => {
      const row: DataAssetUsage = new DataAssetUsage();
      row._id = uuidOf(2000 + id);
      row.dataAssetId = new ObjectID(A);
      row.serviceName = `svc-${id}`;
      row.accessKind = DataAssetAccessKind.Read;
      row.lastSeenAt = new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000);
      return row;
    };
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAssetUsageService, "findBy")
      .mockResolvedValue([usageModel(1, 4), usageModel(2, 1)] as never);

    const rows: Array<DataLineageMapUsageRow> =
      await DataLineageMapReader.getFocusedFlowReader(PROJECT_ID, {
        dataAssetIds: [A],
        dataPipelineIds: [],
        dataDashboardIds: [],
        isTruncated: false,
      }).readUsages(10);

    expect(
      rows.map((row: DataLineageMapUsageRow): string => {
        return row.serviceName;
      }),
    ).toEqual(["svc-2", "svc-1"]);
    expect(idsIn(callsOf(read)[0]!.query["dataAssetId"])).toEqual([A]);
  });

  function dashboardModel(fields: {
    id: number;
    name: string;
    tableCount?: number;
    viewCount?: number;
    tables?: Array<string>;
  }): DataDashboard {
    const dashboard: DataDashboard = new DataDashboard();

    dashboard._id = uuidOf(3000 + fields.id);
    dashboard.name = fields.name;
    dashboard.tool = DataBiTool.PowerBI;
    dashboard.tableCount = fields.tableCount || 0;
    dashboard.viewCount = fields.viewCount || 0;
    dashboard.dataAssets = (fields.tables || []).map(
      (table: string): DataAsset => {
        const asset: DataAsset = new DataAsset();
        asset._id = table;
        return asset;
      },
    );

    return dashboard;
  }

  test("the BI dashboards on its tables (#9553): a few hundred tables a read, each once, on the most tables first, then the most viewed", async () => {
    const A: string = uuidOf(1);
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataDashboardService, "findBy")
      .mockImplementation((async (findBy: FindCall) => {
        // The first chunk's read, then the second's: the same dashboard in both.
        return callsOf(read).length === 1
          ? [
              dashboardModel({ id: 1, name: "Revenue", tableCount: 2 }),
              dashboardModel({
                id: 2,
                name: "Orders",
                tableCount: 1,
                viewCount: 900,
              }),
            ]
          : [
              dashboardModel({ id: 1, name: "Revenue", tableCount: 2 }),
              dashboardModel({
                id: 3,
                name: "Churn",
                tableCount: 1,
                viewCount: 40,
                tables: [A],
              }),
              findBy && dashboardModel({ id: 4, name: "Board", tableCount: 0 }),
            ];
      }) as never);
    const tables: Array<string> = Array.from(
      { length: 501 },
      (_: unknown, index: number): string => {
        return uuidOf(index);
      },
    );
    const rows: Array<DataLineageMapDashboardRow> =
      await DataLineageMapReader.getFocusedFlowReader(PROJECT_ID, {
        dataAssetIds: tables,
        dataPipelineIds: [],
        dataDashboardIds: [],
        isTruncated: false,
      }).readBiDashboards!(3);

    expect(
      rows.map((row: DataLineageMapDashboardRow): string => {
        return row.name;
      }),
    ).toEqual(["Revenue", "Orders", "Churn"]);
    expect(rows[2]!.dataAssetIds).toEqual([A]);

    const calls: Array<FindCall> = callsOf(read);

    expect(calls).toHaveLength(2);

    for (const call of calls) {
      expect(call.query["projectId"]).toBe(PROJECT_ID);
      expect(call.query["_id"]).toBeDefined();
      expect(call.select).toMatchObject({
        upstream: true,
        tableCount: true,
        viewCount: true,
        dataAssets: { _id: true },
      });
      expect(call.sort).toEqual({
        tableCount: "DESC",
        viewCount: "DESC",
        name: "ASC",
      });
      expect(call.limit).toBe(3);
      expect(call.props).toEqual({ isRoot: true });
    }
  });

  test("no tables to start from: no dashboard read", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataDashboardService,
      "findBy",
    );

    expect(
      await DataLineageMapReader.getFocusedFlowReader(PROJECT_ID, {
        dataAssetIds: [],
        dataPipelineIds: [],
        dataDashboardIds: [],
        isTruncated: false,
      }).readBiDashboards!(10),
    ).toEqual([]);
    expect(
      await DataLineageMapReader.getFocusedFlowReader(PROJECT_ID, {
        dataAssetIds: [],
        dataPipelineIds: [],
        dataDashboardIds: [],
        isTruncated: false,
      }).readNamedDashboards!(10),
    ).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  test("the dashboards a search names, in the order it named them, the project's own", async () => {
    const named: Array<string> = [uuidOf(3002), uuidOf(3001)];
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataDashboardService, "findBy")
      .mockResolvedValue([
        dashboardModel({ id: 1, name: "Revenue by Site" }),
        dashboardModel({ id: 2, name: "Revenue" }),
      ] as never);

    const rows: Array<DataLineageMapDashboardRow> =
      await DataLineageMapReader.getFocusedFlowReader(PROJECT_ID, {
        dataAssetIds: [],
        dataPipelineIds: [],
        dataDashboardIds: named,
        isTruncated: false,
      }).readNamedDashboards!(10);

    expect(
      rows.map((row: DataLineageMapDashboardRow): string => {
        return row.name;
      }),
    ).toEqual(["Revenue", "Revenue by Site"]);
    expect(callsOf(read)[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(idsIn(callsOf(read)[0]!.query["_id"]).sort()).toEqual(
      [...named].sort(),
    );
  });
});

/*
 * The BI dashboards a search names (#9553): by their own names first, then
 * by their datasets' or data sources' names - narrowed from what they are
 * built on as text, which also holds a source's type and keys, so a word
 * that only matches those names nothing.
 */
describe("the dashboards a search names (readDashboardsNamedBy)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function dashboard(
    id: number,
    name: string,
    upstream: JSONObject | null = null,
  ): DataDashboard {
    const model: DataDashboard = new DataDashboard();

    model._id = uuidOf(4000 + id);
    model.name = name;
    model.dataAssets = [];

    if (upstream) {
      model.upstream = upstream;
    }

    return model;
  }

  const BUILT_ON_FINANCE: JSONObject = {
    datasets: [
      {
        id: "ds1",
        name: "Finance Model",
        workspace: "Finance",
        sources: [
          {
            type: "SQL Server",
            engine: "sqlserver",
            server: "sql01.corp.acme.com",
            database: "Ledger",
            location: null,
          },
        ],
      },
    ],
    sources: [
      {
        type: "SQL Server",
        engine: "sqlserver",
        server: "sql01.corp.acme.com",
        database: "Ledger",
        location: null,
      },
    ],
  };

  function stub(data: {
    byName: Array<DataDashboard>;
    byUpstream: Array<DataDashboard>;
  }): ReturnType<typeof jest.spyOn> {
    return jest
      .spyOn(DataDashboardService, "findBy")
      .mockImplementation((async (findBy: FindCall) => {
        return findBy.query["name"] ? data.byName : data.byUpstream;
      }) as never);
  }

  test("its own name first, then a dataset's or a data source's, each dashboard once", async () => {
    const read: ReturnType<typeof jest.spyOn> = stub({
      byName: [dashboard(1, "Finance Board")],
      byUpstream: [
        dashboard(1, "Finance Board", BUILT_ON_FINANCE),
        dashboard(2, "Quarterly Close", BUILT_ON_FINANCE),
      ],
    });

    const found: Array<DataDashboard> =
      await DataLineageMapReader.readDashboardsNamedBy({
        projectId: PROJECT_ID,
        search: "finance",
      });

    expect(
      found.map((each: DataDashboard): string => {
        return each.name!;
      }),
    ).toEqual(["Finance Board", "Quarterly Close"]);

    const calls: Array<FindCall> = callsOf(read);

    expect(calls[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(calls[0]!.query["name"]).toBeDefined();
    expect(calls[1]!.query["upstream"]).toBeDefined();
    expect(calls[0]!.limit).toBe(MAX_DATA_LINEAGE_MAP_SEARCH_MATCHES);
    expect(calls[0]!.sort).toEqual({ viewCount: "DESC", name: "ASC" });
  });

  test("a data source's server and database name it; a word only its type or keys hold does not", async () => {
    stub({
      byName: [],
      byUpstream: [dashboard(3, "Quarterly Close", BUILT_ON_FINANCE)],
    });

    expect(
      await DataLineageMapReader.readDashboardsNamedBy({
        projectId: PROJECT_ID,
        search: "LEDGER",
      }),
    ).toHaveLength(1);
    expect(
      await DataLineageMapReader.readDashboardsNamedBy({
        projectId: PROJECT_ID,
        search: "sqlserver",
      }),
    ).toHaveLength(0);
    expect(
      await DataLineageMapReader.readDashboardsNamedBy({
        projectId: PROJECT_ID,
        search: "workspace",
      }),
    ).toHaveLength(0);
  });
});

describe("the tables a map starts from (readFocus)", () => {
  const WHOLE: DataObservabilityScope =
    DataObservabilityReadScope.wholeProject(PROJECT_ID);
  const STORE: string = uuidOf(900);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubTables(ids: Array<string>): ReturnType<typeof jest.spyOn> {
    return jest.spyOn(DataAssetService, "findBy").mockResolvedValue(
      ids.map((id: string): DataAsset => {
        const asset: DataAsset = new DataAsset();
        asset._id = id;
        return asset;
      }) as never,
    );
  }

  test("one database: its tables, the most recently updated first, the project's own", async () => {
    const read: ReturnType<typeof jest.spyOn> = stubTables([
      uuidOf(1),
      uuidOf(2),
    ]);

    const focus: DataLineageMapFocus = await DataLineageMapReader.readFocus({
      projectId: PROJECT_ID,
      scope: WHOLE,
      request: { dataStoreId: STORE },
    });

    expect(focus).toEqual({
      dataAssetIds: [uuidOf(1), uuidOf(2)],
      dataPipelineIds: [],
      dataDashboardIds: [],
      isTruncated: false,
    });

    const call: FindCall = callsOf(read)[0]!;

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(String(call.query["dataStoreId"])).toBe(STORE);
    expect(call.query["assetKey"]).toBeUndefined();
    expect(call.sort).toEqual({ updatedAt: "DESC" });
    expect(call.limit).toBe(MAX_DATA_LINEAGE_MAP_FOCUS_TABLES + 1);
    expect(call.props).toEqual({ isRoot: true });
  });

  test("more tables than one map reads the flows of: the most it reads, and it says it was cut short", async () => {
    const ids: Array<string> = [];

    for (
      let index: number = 0;
      index <= MAX_DATA_LINEAGE_MAP_FOCUS_TABLES;
      index++
    ) {
      ids.push(uuidOf(index));
    }

    stubTables(ids);

    const focus: DataLineageMapFocus = await DataLineageMapReader.readFocus({
      projectId: PROJECT_ID,
      scope: WHOLE,
      request: { dataStoreId: STORE },
    });

    expect(focus.dataAssetIds).toHaveLength(MAX_DATA_LINEAGE_MAP_FOCUS_TABLES);
    expect(focus.isTruncated).toBe(true);
  });

  test("a search: the tables whose key holds it, the pipelines whose name does, and the tables of the services and dashboards it names - of what the reader may read", async () => {
    const OWNED: ReturnType<typeof QueryHelper.any> = QueryHelper.any([
      uuidOf(1),
      uuidOf(7),
    ]);
    const scope: DataObservabilityScope = {
      isWholeProject: false,
      assetQuery: { projectId: PROJECT_ID, _id: OWNED },
      checkQuery: { projectId: PROJECT_ID },
      pipelineQuery: {
        projectId: PROJECT_ID,
        _id: QueryHelper.any([uuidOf(50)]),
      },
    };
    const tableRead: ReturnType<typeof jest.spyOn> = stubTables([uuidOf(1)]);
    const pipelineRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataPipelineService, "findBy")
      .mockImplementation((async () => {
        const pipeline: DataPipeline = new DataPipeline();
        pipeline._id = uuidOf(50);
        return [pipeline];
      }) as never);
    const usageRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAssetUsageService, "findBy")
      .mockImplementation((async () => {
        const usage: DataAssetUsage = new DataAssetUsage();
        usage.dataAssetId = new ObjectID(uuidOf(7));
        const theirsNot: DataAssetUsage = new DataAssetUsage();
        theirsNot.dataAssetId = new ObjectID(uuidOf(8));
        return [usage, theirsNot];
      }) as never);
    const dashboardRead: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataDashboardService, "findBy")
      .mockImplementation((async () => {
        const dashboard: DataDashboard = new DataDashboard();
        const theirsNot: DataAsset = new DataAsset();
        dashboard._id = uuidOf(300);
        dashboard.name = "Orders by Region";
        theirsNot._id = uuidOf(9);
        dashboard.dataAssets = [theirsNot];
        return [dashboard];
      }) as never);
    const readable: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataObservabilityReadScope, "getReadableIds")
      .mockImplementation((async (data: { ids: Array<string> }) => {
        return new Set(
          data.ids.filter((id: string): boolean => {
            return id === uuidOf(7);
          }),
        );
      }) as never);

    const focus: DataLineageMapFocus = await DataLineageMapReader.readFocus({
      projectId: PROJECT_ID,
      scope,
      request: { search: "orders" },
    });

    expect(focus).toEqual({
      dataAssetIds: [uuidOf(1), uuidOf(7)],
      dataPipelineIds: [uuidOf(50)],
      // Named by the search, though on no table the reader may read: the map draws it as they may see it.
      dataDashboardIds: [uuidOf(300)],
      isTruncated: false,
    });
    // The tables read with the reader's scope, the search beside it.
    expect(callsOf(tableRead)[0]!.query["_id"]).toBe(OWNED);
    expect(callsOf(tableRead)[0]!.query["assetKey"]).toBeDefined();
    // The pipelines with theirs.
    expect(callsOf(pipelineRead)[0]!.query["_id"]).toBe(
      scope.pipelineQuery["_id" as keyof typeof scope.pipelineQuery],
    );
    expect(callsOf(pipelineRead)[0]!.query["jobName"]).toBeDefined();
    expect(callsOf(usageRead)[0]!.query["serviceName"]).toBeDefined();
    expect(callsOf(dashboardRead)[0]!.query["name"]).toBeDefined();
    // The tables the services and dashboards name, asked of the reader's scope.
    expect(
      (readable.mock.calls[0]![0] as { ids: Array<string> }).ids.sort(),
    ).toEqual([uuidOf(7), uuidOf(8), uuidOf(9)].sort());
  });
});

describe("which rows a map reads (DataLineageMapReader.read)", () => {
  const MEMBER_PROPS: DatabaseCommonInteractionProps = {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
  };

  beforeEach(() => {
    // No BI tool is on no watched table (the BI tools the map tells of).
    jest
      .spyOn(DataLineageMapReader, "readBiToolsOffTables")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a whole map for someone who may read the whole project: the project's newest rows, as ever", async () => {
    jest
      .spyOn(DataObservabilityReadScope, "get")
      .mockResolvedValue(
        DataObservabilityReadScope.wholeProject(PROJECT_ID) as never,
      );

    const newest: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataLineageMapReader, "getDatabaseFlowReader")
      .mockReturnValue({
        readLineage: async () => {
          return [];
        },
        readUsages: async () => {
          return [];
        },
      });
    const focused: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataLineageMapReader,
      "readFocus",
    );

    await DataLineageMapReader.read({
      projectId: PROJECT_ID,
      now: NOW,
      reader: MEMBER_PROPS,
    });

    expect(newest).toHaveBeenCalledWith(PROJECT_ID);
    expect(focused).not.toHaveBeenCalled();
  });

  test.each([[{ dataStoreId: uuidOf(900) }], [{ search: "orders" }]])(
    "a map that starts somewhere (%p) reads the rows of the tables it starts from",
    async (request: { dataStoreId?: string; search?: string }) => {
      jest
        .spyOn(DataObservabilityReadScope, "get")
        .mockResolvedValue(
          DataObservabilityReadScope.wholeProject(PROJECT_ID) as never,
        );

      const newest: ReturnType<typeof jest.spyOn> = jest.spyOn(
        DataLineageMapReader,
        "getDatabaseFlowReader",
      );
      const focused: ReturnType<typeof jest.spyOn> = jest
        .spyOn(DataLineageMapReader, "readFocus")
        .mockResolvedValue({
          dataAssetIds: [],
          dataPipelineIds: [],
          dataDashboardIds: [],
          isTruncated: true,
        } as never);

      const map: DataLineageMap = await DataLineageMapReader.read({
        projectId: PROJECT_ID,
        now: NOW,
        reader: MEMBER_PROPS,
        request,
      });

      expect(newest).not.toHaveBeenCalled();
      expect(focused.mock.calls[0]![0]).toMatchObject({
        projectId: PROJECT_ID,
        request,
      });
      // It started from more tables than it reads: it says it was cut short.
      expect(map.isTruncated).toBe(true);
      expect(map.isHiddenTableCountAtLeast).toBe(true);
    },
  );

  test("a reader limited to some tables starts a whole map from the ones they may read", async () => {
    const scope: DataObservabilityScope = {
      isWholeProject: false,
      assetQuery: { projectId: PROJECT_ID, _id: QueryHelper.any([uuidOf(1)]) },
      checkQuery: { projectId: PROJECT_ID },
      pipelineQuery: { projectId: PROJECT_ID, _id: QueryHelper.any([]) },
    };

    jest
      .spyOn(DataObservabilityReadScope, "get")
      .mockResolvedValue(scope as never);

    const newest: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataLineageMapReader,
      "getDatabaseFlowReader",
    );
    const focused: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataLineageMapReader, "readFocus")
      .mockResolvedValue({
        dataAssetIds: [],
        dataPipelineIds: [],
        dataDashboardIds: [],
        isTruncated: false,
      } as never);

    await DataLineageMapReader.read({
      projectId: PROJECT_ID,
      now: NOW,
      reader: MEMBER_PROPS,
    });

    expect(newest).not.toHaveBeenCalled();
    expect(focused.mock.calls[0]![0]).toMatchObject({
      scope,
      request: {},
    });
  });
});
