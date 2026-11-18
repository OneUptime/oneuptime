import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../Models/DatabaseModels/DataAssetLineage";
import DataAssetUsage from "../../../Models/DatabaseModels/DataAssetUsage";
import DataBiConnection from "../../../Models/DatabaseModels/DataBiConnection";
import DataDashboard from "../../../Models/DatabaseModels/DataDashboard";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { isDataAssetLineageSource } from "../../../Types/DataObservability/DataAssetLineageSource";
import { DataAssetAccessKind } from "../../../Types/DataObservability/DataAssetUsage";
import {
  DataBiLineageSummary,
  isDataBiToolOffTables,
  readDataBiLineageSummary,
  readDataDashboardUpstream,
} from "../../../Types/DataObservability/DataBiLineage";
import {
  DataLineageMap,
  DataLineageMapBiChoice,
  DataLineageMapBiTool,
  DataLineageMapChoice,
  DataLineageMapDashboardRow,
  DataLineageMapLineageRow,
  DataLineageMapPipelineRow,
  DataLineageMapTableRow,
  DataLineageMapUsageRow,
  MAX_DATA_LINEAGE_MAP_BI_DASHBOARD_ROWS,
  MAX_DATA_LINEAGE_MAP_BI_TOOLS,
  MAX_DATA_LINEAGE_MAP_LINEAGE_ROWS,
  MAX_DATA_LINEAGE_MAP_NODES,
  MAX_DATA_LINEAGE_MAP_USAGE_ROWS,
  assembleDataLineageMap,
  chooseDataLineageMapBiDashboards,
  chooseDataLineageMapFlows,
} from "../../../Types/DataObservability/DataLineageMap";
import ObjectID from "../../../Types/ObjectID";
import DataAssetLineageService from "../../Services/DataAssetLineageService";
import DataAssetUsageService from "../../Services/DataAssetUsageService";
import DataBiConnectionService from "../../Services/DataBiConnectionService";
import DataDashboardService from "../../Services/DataDashboardService";
import DataTableLineageReader, {
  DataLineageDashboardRow,
  DataLineagePipelineRow,
  DataLineageReader,
  DataLineageTableRow,
} from "./DataTableLineage";

/*
 * THE PROJECT'S LINEAGE MAP, READ (Types/DataObservability/DataLineageMap
 * says what it holds and why).
 *
 * Two bounded reads say what flows there are: the newest lineage rows
 * (DataAssetLineage) and the newest rows of services reading and writing
 * tables (DataAssetUsage), each at most a few thousand, newest first.
 * chooseDataLineageMapFlows keeps as many of them as one map draws; then
 * only the tables, pipelines and dashboards on it are read - with the
 * table lineage diagram's own reads (DataTableLineageReader), so a card
 * says how its table or pipeline is now the way it does there, and a
 * table's open alerts are counted as the map's reader may see them.
 *
 * Then, in the room left, the project's BI dashboards that no flow draws
 * (readBiDashboards): those on watched tables nothing else touches, with
 * their tables, and those on no watched table, with the datasets and data
 * sources their tool says they are built on - a project whose only lineage
 * is its BI tool's still has a map.
 *
 * Every read is the project's own (projectId on every query): the route
 * lets in only those who may read data assets, who may read every table,
 * pipeline, dashboard and service usage of the project.
 */

// Where the map reads its flows from: the database, or a test's rows in memory.
export interface DataLineageMapFlowReader {
  readLineage(limit: number): Promise<Array<DataLineageMapLineageRow>>;
  readUsages(limit: number): Promise<Array<DataLineageMapUsageRow>>;
  /*
   * The project's BI dashboards, those on the most watched tables first,
   * then the most viewed: each with all its watched tables and what its
   * tool says it is built on.
   */
  readBiDashboards?(limit: number): Promise<Array<DataLineageMapDashboardRow>>;
}

function readDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" && value) {
    const date: Date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export default class DataLineageMapReader {
  public static async read(data: {
    projectId: ObjectID;
    now: Date;
    // Who asked: their open alerts only. Null counts the alerts that are not private.
    reader: DatabaseCommonInteractionProps | null;
  }): Promise<DataLineageMap> {
    const [map, biToolsOffTables] = await Promise.all([
      DataLineageMapReader.build({
        flows: DataLineageMapReader.getDatabaseFlowReader(data.projectId),
        details: DataTableLineageReader.getDatabaseReader(
          data.projectId,
          data.reader,
        ),
        now: data.now,
      }),
      DataLineageMapReader.readBiToolsOffTables(data.projectId),
    ]);

    return biToolsOffTables.length > 0 ? { ...map, biToolsOffTables } : map;
  }

  /*
   * The project's BI tools whose dashboards were read but are on no
   * watched table, each with why: the map says what it cannot draw on
   * tables, and how to fix it.
   */
  public static async readBiToolsOffTables(
    projectId: ObjectID,
  ): Promise<Array<DataLineageMapBiTool>> {
    const found: Array<DataBiConnection> = await DataBiConnectionService.findBy(
      {
        query: { projectId },
        select: {
          _id: true,
          name: true,
          tool: true,
          dashboardCount: true,
          matchedTableCount: true,
          lineageSummary: true,
        },
        sort: { name: SortOrder.Ascending },
        limit: MAX_DATA_LINEAGE_MAP_BI_TOOLS,
        skip: 0,
        props: { isRoot: true },
      },
    );
    const tools: Array<DataLineageMapBiTool> = [];

    for (const connection of found) {
      const summary: DataBiLineageSummary | null = readDataBiLineageSummary(
        connection.lineageSummary,
      );

      if (
        connection.id &&
        summary &&
        isDataBiToolOffTables({
          dashboardCount: connection.dashboardCount,
          matchedTableCount: connection.matchedTableCount,
          summary,
        })
      ) {
        tools.push({
          dataBiConnectionId: connection.id.toString(),
          name: connection.name || "",
          tool: connection.tool || null,
          dashboardCount: connection.dashboardCount || 0,
          summary,
        });
      }
    }

    return tools;
  }

  public static async build(data: {
    flows: DataLineageMapFlowReader;
    details: DataLineageReader;
    now: Date;
    maxNodes?: number | undefined;
  }): Promise<DataLineageMap> {
    // One more than kept, to know there were more.
    const [lineage, usages] = await Promise.all([
      data.flows.readLineage(MAX_DATA_LINEAGE_MAP_LINEAGE_ROWS + 1),
      data.flows.readUsages(MAX_DATA_LINEAGE_MAP_USAGE_ROWS + 1),
    ]);

    const choice: DataLineageMapChoice = chooseDataLineageMapFlows({
      lineage: lineage.slice(0, MAX_DATA_LINEAGE_MAP_LINEAGE_ROWS),
      usages: usages.slice(0, MAX_DATA_LINEAGE_MAP_USAGE_ROWS),
      maxNodes: data.maxNodes,
      hadMoreRows:
        lineage.length > MAX_DATA_LINEAGE_MAP_LINEAGE_ROWS ||
        usages.length > MAX_DATA_LINEAGE_MAP_USAGE_ROWS,
    });

    // The dashboards on the flows' tables.
    const dashboards: {
      dashboards: Array<DataLineageDashboardRow>;
      total: number;
    } =
      choice.dataAssetIds.length > 0 && choice.dashboardRoom > 0
        ? await data.details.readDashboards({
            dataAssetIds: choice.dataAssetIds,
            // One more than there is room for, to know there were more.
            limit: choice.dashboardRoom + 1,
          })
        : { dashboards: [], total: 0 };

    // Then the BI dashboards no flow draws, in the room left.
    const onFlows: number = Math.min(
      choice.dashboardRoom,
      dashboards.dashboards.length,
    );
    const nodeRoom: number =
      (data.maxNodes ?? MAX_DATA_LINEAGE_MAP_NODES) -
      choice.nodeCount -
      onFlows;
    const dashboardRoom: number = choice.dashboardRoom - onFlows;
    const biRows: Array<DataLineageMapDashboardRow> =
      nodeRoom > 0 && dashboardRoom > 0 && data.flows.readBiDashboards
        ? await data.flows.readBiDashboards(
            MAX_DATA_LINEAGE_MAP_BI_DASHBOARD_ROWS + 1,
          )
        : [];
    const bi: DataLineageMapBiChoice = chooseDataLineageMapBiDashboards({
      rows: biRows.slice(0, MAX_DATA_LINEAGE_MAP_BI_DASHBOARD_ROWS),
      hadMoreRows: biRows.length > MAX_DATA_LINEAGE_MAP_BI_DASHBOARD_ROWS,
      drawnDataAssetIds: new Set(choice.dataAssetIds),
      drawnDashboardIds: new Set(
        dashboards.dashboards.map(
          (dashboard: DataLineageDashboardRow): string => {
            return dashboard.dataDashboardId;
          },
        ),
      ),
      nodeRoom,
      dashboardRoom,
    });
    const dataAssetIds: Array<string> = Array.from(
      new Set([...choice.dataAssetIds, ...bi.dataAssetIds]),
    ).sort();

    if (dataAssetIds.length === 0 && bi.upstreamDashboards.length === 0) {
      return {
        nodes: [],
        edges: [],
        isTruncated: choice.isTruncated || bi.isTruncated,
      };
    }

    const [tables, pipelines, openAlertCounts] = await Promise.all([
      dataAssetIds.length > 0
        ? data.details.readTables(dataAssetIds)
        : Promise.resolve([] as Array<DataLineageTableRow>),
      choice.dataPipelineIds.length > 0
        ? data.details.readPipelines(choice.dataPipelineIds)
        : Promise.resolve([] as Array<DataLineagePipelineRow>),
      dataAssetIds.length > 0
        ? data.details.readOpenAlertCounts(dataAssetIds)
        : Promise.resolve(new Map<string, number>()),
    ]);

    return assembleDataLineageMap({
      choice,
      tables: tables.map(
        (table: DataLineageTableRow): DataLineageMapTableRow => {
          return { ...table };
        },
      ),
      pipelines: pipelines.map(
        (pipeline: DataLineagePipelineRow): DataLineageMapPipelineRow => {
          return {
            dataPipelineId: pipeline.dataPipelineId,
            jobName: pipeline.jobName,
            jobNamespace: pipeline.jobNamespace,
            lastRunState: pipeline.lastRunState,
          };
        },
      ),
      dashboards: dashboards.dashboards.map(
        (dashboard: DataLineageDashboardRow): DataLineageMapDashboardRow => {
          return { ...dashboard };
        },
      ),
      bi,
      openAlertCounts,
      now: data.now,
    });
  }

  public static getDatabaseFlowReader(
    projectId: ObjectID,
  ): DataLineageMapFlowReader {
    return {
      readLineage: async (
        limit: number,
      ): Promise<Array<DataLineageMapLineageRow>> => {
        const found: Array<DataAssetLineage> =
          await DataAssetLineageService.findBy({
            query: { projectId },
            select: {
              upstreamDataAssetId: true,
              downstreamDataAssetId: true,
              dataPipelineId: true,
              source: true,
              lastSeenAt: true,
            },
            sort: { lastSeenAt: SortOrder.Descending },
            limit,
            skip: 0,
            props: { isRoot: true },
          });

        const rows: Array<DataLineageMapLineageRow> = [];

        for (const edge of found) {
          if (!edge.downstreamDataAssetId) {
            continue;
          }

          rows.push({
            upstreamDataAssetId: edge.upstreamDataAssetId?.toString() || null,
            downstreamDataAssetId: edge.downstreamDataAssetId.toString(),
            dataPipelineId: edge.dataPipelineId?.toString() || null,
            source: isDataAssetLineageSource(edge.source) ? edge.source : null,
            lastSeenAt: readDate(edge.lastSeenAt),
          });
        }

        return rows;
      },

      readUsages: async (
        limit: number,
      ): Promise<Array<DataLineageMapUsageRow>> => {
        const found: Array<DataAssetUsage> = await DataAssetUsageService.findBy(
          {
            query: { projectId },
            select: {
              dataAssetId: true,
              serviceId: true,
              serviceName: true,
              accessKind: true,
              operations: true,
              lastSeenAt: true,
            },
            sort: { lastSeenAt: SortOrder.Descending },
            limit,
            skip: 0,
            props: { isRoot: true },
          },
        );

        const rows: Array<DataLineageMapUsageRow> = [];

        for (const usage of found) {
          if (
            !usage.dataAssetId ||
            (usage.accessKind !== DataAssetAccessKind.Read &&
              usage.accessKind !== DataAssetAccessKind.Write)
          ) {
            continue;
          }

          rows.push({
            dataAssetId: usage.dataAssetId.toString(),
            serviceId: usage.serviceId?.toString() || null,
            serviceName: usage.serviceName || "",
            accessKind: usage.accessKind,
            operations: Array.isArray(usage.operations)
              ? usage.operations.filter((operation: unknown): boolean => {
                  return typeof operation === "string" && operation !== "";
                })
              : [],
            lastSeenAt: readDate(usage.lastSeenAt),
          });
        }

        return rows;
      },

      readBiDashboards: async (
        limit: number,
      ): Promise<Array<DataLineageMapDashboardRow>> => {
        const found: Array<DataDashboard> = await DataDashboardService.findBy({
          query: { projectId },
          select: {
            _id: true,
            name: true,
            tool: true,
            url: true,
            upstream: true,
            dataAssets: { _id: true },
          },
          sort: {
            tableCount: SortOrder.Descending,
            viewCount: SortOrder.Descending,
            name: SortOrder.Ascending,
          },
          limit,
          skip: 0,
          props: { isRoot: true },
        });

        return found
          .filter((dashboard: DataDashboard): boolean => {
            return Boolean(dashboard.id);
          })
          .map((dashboard: DataDashboard): DataLineageMapDashboardRow => {
            return {
              dataDashboardId: dashboard.id!.toString(),
              name: dashboard.name || "",
              tool: dashboard.tool || null,
              url: dashboard.url || null,
              dataAssetIds: (dashboard.dataAssets || [])
                .map((asset: DataAsset): string => {
                  return asset._id?.toString() || "";
                })
                .filter(Boolean),
              upstream: readDataDashboardUpstream(dashboard.upstream),
            };
          });
      },
    };
  }
}
