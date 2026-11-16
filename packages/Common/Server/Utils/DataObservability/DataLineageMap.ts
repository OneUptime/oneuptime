import DataAssetLineage from "../../../Models/DatabaseModels/DataAssetLineage";
import DataAssetUsage from "../../../Models/DatabaseModels/DataAssetUsage";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { isDataAssetLineageSource } from "../../../Types/DataObservability/DataAssetLineageSource";
import { DataAssetAccessKind } from "../../../Types/DataObservability/DataAssetUsage";
import {
  DataLineageMap,
  DataLineageMapChoice,
  DataLineageMapDashboardRow,
  DataLineageMapLineageRow,
  DataLineageMapPipelineRow,
  DataLineageMapTableRow,
  DataLineageMapUsageRow,
  MAX_DATA_LINEAGE_MAP_LINEAGE_ROWS,
  MAX_DATA_LINEAGE_MAP_USAGE_ROWS,
  assembleDataLineageMap,
  chooseDataLineageMapFlows,
} from "../../../Types/DataObservability/DataLineageMap";
import ObjectID from "../../../Types/ObjectID";
import DataAssetLineageService from "../../Services/DataAssetLineageService";
import DataAssetUsageService from "../../Services/DataAssetUsageService";
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
 * Every read is the project's own (projectId on every query): the route
 * lets in only those who may read data assets, who may read every table,
 * pipeline, dashboard and service usage of the project.
 */

// Where the map reads its flows from: the database, or a test's rows in memory.
export interface DataLineageMapFlowReader {
  readLineage(limit: number): Promise<Array<DataLineageMapLineageRow>>;
  readUsages(limit: number): Promise<Array<DataLineageMapUsageRow>>;
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
    return await DataLineageMapReader.build({
      flows: DataLineageMapReader.getDatabaseFlowReader(data.projectId),
      details: DataTableLineageReader.getDatabaseReader(
        data.projectId,
        data.reader,
      ),
      now: data.now,
    });
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

    if (choice.dataAssetIds.length === 0) {
      return { nodes: [], edges: [], isTruncated: choice.isTruncated };
    }

    const [tables, pipelines, openAlertCounts, dashboards] = await Promise.all([
      data.details.readTables(choice.dataAssetIds),
      choice.dataPipelineIds.length > 0
        ? data.details.readPipelines(choice.dataPipelineIds)
        : Promise.resolve([] as Array<DataLineagePipelineRow>),
      data.details.readOpenAlertCounts(choice.dataAssetIds),
      choice.dashboardRoom > 0
        ? data.details.readDashboards({
            dataAssetIds: choice.dataAssetIds,
            // One more than there is room for, to know there were more.
            limit: choice.dashboardRoom + 1,
          })
        : Promise.resolve({
            dashboards: [] as Array<DataLineageDashboardRow>,
            total: 0,
          }),
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
    };
  }
}
