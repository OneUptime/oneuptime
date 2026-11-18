import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../Models/DatabaseModels/DataAssetLineage";
import DataAssetUsage from "../../../Models/DatabaseModels/DataAssetUsage";
import DataDashboard from "../../../Models/DatabaseModels/DataDashboard";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { isDataAssetLineageSource } from "../../../Types/DataObservability/DataAssetLineageSource";
import { DataAssetAccessKind } from "../../../Types/DataObservability/DataAssetUsage";
import {
  DataLineageMap,
  DataLineageMapChoice,
  DataLineageMapDashboardRow,
  DataLineageMapLineageRow,
  DataLineageMapPipelineRow,
  DataLineageMapRequest,
  DataLineageMapTableRow,
  DataLineageMapUsageRow,
  MAX_DATA_LINEAGE_MAP_FOCUS_TABLES,
  MAX_DATA_LINEAGE_MAP_LINEAGE_ROWS,
  MAX_DATA_LINEAGE_MAP_SEARCH_MATCHES,
  MAX_DATA_LINEAGE_MAP_USAGE_ROWS,
  assembleDataLineageMap,
  chooseDataLineageMapFlows,
  isFocusedDataLineageMapRequest,
} from "../../../Types/DataObservability/DataLineageMap";
import ObjectID from "../../../Types/ObjectID";
import DataAssetLineageService from "../../Services/DataAssetLineageService";
import DataAssetService from "../../Services/DataAssetService";
import DataAssetUsageService from "../../Services/DataAssetUsageService";
import DataDashboardService from "../../Services/DataDashboardService";
import DataPipelineService from "../../Services/DataPipelineService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import DataObservabilityReadScope, {
  DataObservabilityScope,
  withConditions,
} from "./DataObservabilityReadScope";
import DataTableLineageReader, {
  DataLineageDashboardRow,
  DataLineagePipelineRow,
  DataLineageReadable,
  DataLineageReadableCache,
  DataLineageReader,
  DataLineageTableRow,
  DataPipelineLineageReader,
  scopeDataLineageReader,
} from "./DataTableLineage";

/*
 * THE PROJECT'S LINEAGE MAP, READ (Types/DataObservability/DataLineageMap
 * says what it holds and why).
 *
 * Two bounded reads say what flows there are: lineage rows
 * (DataAssetLineage) and rows of services reading and writing tables
 * (DataAssetUsage), each at most a few thousand, newest first.
 * chooseDataLineageMapFlows keeps as many of them as one map draws; then
 * only the tables, pipelines and dashboards on it are read - with the
 * table lineage diagram's own reads (DataTableLineageReader), so a card
 * says how its table or pipeline is now the way it does there, and a
 * table's open alerts are counted as the map's reader may see them.
 *
 * Which rows: the project's newest, for a whole map read by someone who
 * may read the whole project. A map that starts somewhere (#6547) - one
 * database, or a search of the whole project - reads the rows of the
 * tables it starts from: those of the database, or those whose names hold
 * the words, with the tables of the pipelines, services and dashboards
 * the words name; and a reader limited to some of the project's tables
 * starts from the ones they may read. At most
 * MAX_DATA_LINEAGE_MAP_FOCUS_TABLES tables; past it the map says it was
 * cut short.
 *
 * Every read is the project's own (projectId on every query), and of what
 * its reader may read (#9526): a role limited to what its members own, or
 * to some labels, has every row naming a table or pipeline it may not read
 * left out, by the rule a table's drawing keeps its rows by
 * (DataLineageReadableCache), so it is never told of one - not by name,
 * and not in how many tables the map left out.
 */

// Where the map reads its flows from: the database, or a test's rows in memory.
export interface DataLineageMapFlowReader {
  readLineage(limit: number): Promise<Array<DataLineageMapLineageRow>>;
  readUsages(limit: number): Promise<Array<DataLineageMapUsageRow>>;
}

// What a map that starts somewhere reads the flows of.
export interface DataLineageMapFocus {
  // The tables: their rows each way, and the services reading and writing them.
  dataAssetIds: Array<string>;
  // The pipelines a search names: their own rows.
  dataPipelineIds: Array<string>;
  // More tables than one map reads the flows of.
  isTruncated: boolean;
}

// The most ids one read names.
const READ_CHUNK: number = 500;

const LINEAGE_SELECT: {
  _id: true;
  upstreamDataAssetId: true;
  downstreamDataAssetId: true;
  dataPipelineId: true;
  source: true;
  lastSeenAt: true;
} = {
  _id: true,
  upstreamDataAssetId: true,
  downstreamDataAssetId: true,
  dataPipelineId: true,
  source: true,
  lastSeenAt: true,
};

const USAGE_SELECT: {
  _id: true;
  dataAssetId: true;
  serviceId: true;
  serviceName: true;
  accessKind: true;
  operations: true;
  lastSeenAt: true;
} = {
  _id: true,
  dataAssetId: true,
  serviceId: true,
  serviceName: true,
  accessKind: true,
  operations: true,
  lastSeenAt: true,
};

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

function chunked<T>(items: Array<T>, size: number): Array<Array<T>> {
  const chunks: Array<Array<T>> = [];

  for (let start: number = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }

  return chunks;
}

function asIds(ids: Array<string>): Includes {
  return new Includes(
    ids.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );
}

function timeOf(value: Date | null): number {
  return value ? value.getTime() : 0;
}

function toLineageRow(edge: DataAssetLineage): DataLineageMapLineageRow | null {
  if (!edge.downstreamDataAssetId) {
    return null;
  }

  return {
    upstreamDataAssetId: edge.upstreamDataAssetId?.toString() || null,
    downstreamDataAssetId: edge.downstreamDataAssetId.toString(),
    dataPipelineId: edge.dataPipelineId?.toString() || null,
    source: isDataAssetLineageSource(edge.source) ? edge.source : null,
    lastSeenAt: readDate(edge.lastSeenAt),
  };
}

function toUsageRow(usage: DataAssetUsage): DataLineageMapUsageRow | null {
  if (
    !usage.dataAssetId ||
    (usage.accessKind !== DataAssetAccessKind.Read &&
      usage.accessKind !== DataAssetAccessKind.Write)
  ) {
    return null;
  }

  return {
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
  };
}

// Rows read in several reads, each once, the newest first, at most `limit`.
function newestOf<TRow extends { lastSeenAt: Date | null }>(
  rows: Map<string, TRow>,
  limit: number,
): Array<TRow> {
  return Array.from(rows.values())
    .sort((a: TRow, b: TRow): number => {
      return timeOf(b.lastSeenAt) - timeOf(a.lastSeenAt);
    })
    .slice(0, limit);
}

export default class DataLineageMapReader {
  public static async read(data: {
    projectId: ObjectID;
    now: Date;
    // Who asked: what they may read, and their open alerts only. Null reads as OneUptime, counting the alerts that are not private.
    reader: DatabaseCommonInteractionProps | null;
    // Where the map starts: the whole project when left out.
    request?: DataLineageMapRequest | undefined;
  }): Promise<DataLineageMap> {
    const request: DataLineageMapRequest = data.request || {};
    const scope: DataObservabilityScope = await DataObservabilityReadScope.get(
      data.projectId,
      data.reader,
    );
    const base: DataPipelineLineageReader =
      DataTableLineageReader.getDatabaseReader(data.projectId, data.reader);

    // The whole project, for someone who may read all of it: its newest flows, as ever.
    if (scope.isWholeProject && !isFocusedDataLineageMapRequest(request)) {
      return await DataLineageMapReader.build({
        flows: DataLineageMapReader.getDatabaseFlowReader(data.projectId),
        details: base,
        now: data.now,
      });
    }

    const readable: DataLineageReadable | null = scope.isWholeProject
      ? null
      : DataTableLineageReader.getReadable(scope);
    const focus: DataLineageMapFocus = await DataLineageMapReader.readFocus({
      projectId: data.projectId,
      scope,
      request,
    });

    return await DataLineageMapReader.build({
      flows: DataLineageMapReader.getFocusedFlowReader(data.projectId, focus),
      details: readable ? scopeDataLineageReader(base, readable) : base,
      readable: readable || undefined,
      isFocusTruncated: focus.isTruncated,
      now: data.now,
    });
  }

  public static async build(data: {
    flows: DataLineageMapFlowReader;
    details: DataLineageReader;
    now: Date;
    maxNodes?: number | undefined;
    // What its reader may read, when that is not the whole project: every other row is left out.
    readable?: DataLineageReadable | undefined;
    // The map started from more tables than it reads the flows of.
    isFocusTruncated?: boolean | undefined;
  }): Promise<DataLineageMap> {
    // One more than kept, to know there were more.
    const [lineageRead, usagesRead] = await Promise.all([
      data.flows.readLineage(MAX_DATA_LINEAGE_MAP_LINEAGE_ROWS + 1),
      data.flows.readUsages(MAX_DATA_LINEAGE_MAP_USAGE_ROWS + 1),
    ]);
    let lineage: Array<DataLineageMapLineageRow> = lineageRead.slice(
      0,
      MAX_DATA_LINEAGE_MAP_LINEAGE_ROWS,
    );
    let usages: Array<DataLineageMapUsageRow> = usagesRead.slice(
      0,
      MAX_DATA_LINEAGE_MAP_USAGE_ROWS,
    );

    if (data.readable) {
      const cache: DataLineageReadableCache = new DataLineageReadableCache(
        data.readable,
      );

      lineage = await cache.keepRows(lineage);

      const readableTables: Set<string> = new Set(
        await cache.tablesOf(
          usages.map((usage: DataLineageMapUsageRow): string => {
            return usage.dataAssetId;
          }),
        ),
      );

      usages = usages.filter((usage: DataLineageMapUsageRow): boolean => {
        return readableTables.has(usage.dataAssetId);
      });
    }

    const choice: DataLineageMapChoice = chooseDataLineageMapFlows({
      lineage,
      usages,
      maxNodes: data.maxNodes,
      hadMoreRows:
        lineageRead.length > MAX_DATA_LINEAGE_MAP_LINEAGE_ROWS ||
        usagesRead.length > MAX_DATA_LINEAGE_MAP_USAGE_ROWS ||
        Boolean(data.isFocusTruncated),
    });

    if (choice.dataAssetIds.length === 0) {
      return {
        nodes: [],
        edges: [],
        isTruncated: choice.isTruncated,
        hiddenTableCount: choice.hiddenTableCount,
        isHiddenTableCountAtLeast: choice.isHiddenTableCountAtLeast,
      };
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

  /*
   * The tables a map starts from, of those its reader may read: one
   * database's, those whose schema.table key holds the search - with the
   * tables the services and dashboards it names read and write - or, with
   * neither, every table they may read. And the pipelines a search names,
   * of those they may read. The most recently updated first, at most
   * MAX_DATA_LINEAGE_MAP_FOCUS_TABLES.
   */
  public static async readFocus(data: {
    projectId: ObjectID;
    scope: DataObservabilityScope;
    request: DataLineageMapRequest;
  }): Promise<DataLineageMapFocus> {
    const conditions: Query<DataAsset> = {};
    const search: string | undefined = data.request.search;

    if (data.request.dataStoreId) {
      conditions.dataStoreId = new ObjectID(data.request.dataStoreId);
    }

    if (search) {
      conditions.assetKey = QueryHelper.search(search);
    }

    const found: Array<DataAsset> = await DataAssetService.findBy({
      query: withConditions<DataAsset>(data.scope.assetQuery, conditions),
      select: { _id: true },
      sort: { updatedAt: SortOrder.Descending },
      // One more than read, to know there were more.
      limit: MAX_DATA_LINEAGE_MAP_FOCUS_TABLES + 1,
      skip: 0,
      props: { isRoot: true },
    });
    const dataAssetIds: Set<string> = new Set();

    for (const asset of found) {
      if (asset.id && dataAssetIds.size < MAX_DATA_LINEAGE_MAP_FOCUS_TABLES) {
        dataAssetIds.add(asset.id.toString());
      }
    }

    let isTruncated: boolean = found.length > MAX_DATA_LINEAGE_MAP_FOCUS_TABLES;
    const dataPipelineIds: Array<string> = [];

    if (search) {
      const named: {
        dataAssetIds: Array<string>;
        dataPipelineIds: Array<string>;
      } = await DataLineageMapReader.readNamedBySearch({
        projectId: data.projectId,
        scope: data.scope,
        search,
        dataStoreId: data.request.dataStoreId,
      });

      for (const id of named.dataAssetIds) {
        if (dataAssetIds.size >= MAX_DATA_LINEAGE_MAP_FOCUS_TABLES) {
          isTruncated = true;
          break;
        }

        dataAssetIds.add(id);
      }

      dataPipelineIds.push(...named.dataPipelineIds);
    }

    return {
      dataAssetIds: Array.from(dataAssetIds),
      dataPipelineIds,
      isTruncated,
    };
  }

  /*
   * What else a search of the map names, of what its reader may read: the
   * pipelines whose job name holds it, and the tables read and written by
   * the services - and read by the dashboards - whose names hold it. In
   * one database, only its tables.
   */
  private static async readNamedBySearch(data: {
    projectId: ObjectID;
    scope: DataObservabilityScope;
    search: string;
    dataStoreId?: string | undefined;
  }): Promise<{ dataAssetIds: Array<string>; dataPipelineIds: Array<string> }> {
    const [pipelines, usages, dashboards] = await Promise.all([
      DataPipelineService.findBy({
        query: withConditions<DataPipeline>(data.scope.pipelineQuery, {
          jobName: QueryHelper.search(data.search),
        }),
        select: { _id: true },
        sort: { lastRunStartedAt: SortOrder.Descending },
        limit: MAX_DATA_LINEAGE_MAP_SEARCH_MATCHES,
        skip: 0,
        props: { isRoot: true },
      }),
      DataAssetUsageService.findBy({
        query: {
          projectId: data.projectId,
          serviceName: QueryHelper.search(data.search),
        },
        select: { dataAssetId: true },
        sort: { lastSeenAt: SortOrder.Descending },
        limit: MAX_DATA_LINEAGE_MAP_SEARCH_MATCHES,
        skip: 0,
        props: { isRoot: true },
      }),
      DataDashboardService.findBy({
        query: {
          projectId: data.projectId,
          name: QueryHelper.search(data.search),
        },
        select: { _id: true, dataAssets: { _id: true } },
        sort: { name: SortOrder.Ascending },
        limit: MAX_DATA_LINEAGE_MAP_SEARCH_MATCHES,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);

    const tableIds: Set<string> = new Set();

    for (const usage of usages as Array<DataAssetUsage>) {
      if (usage.dataAssetId) {
        tableIds.add(usage.dataAssetId.toString());
      }
    }

    for (const dashboard of dashboards as Array<DataDashboard>) {
      for (const asset of dashboard.dataAssets || []) {
        const id: string = asset._id?.toString() || "";

        if (id) {
          tableIds.add(id);
        }
      }
    }

    // Of the tables they name, those its reader may read - in the database, when it starts from one.
    const readable: Set<string> = new Set();
    const query: Query<DataAsset> = data.dataStoreId
      ? withConditions<DataAsset>(data.scope.assetQuery, {
          dataStoreId: new ObjectID(data.dataStoreId),
        })
      : data.scope.assetQuery;

    for (const ids of chunked(Array.from(tableIds), READ_CHUNK)) {
      for (const id of await DataObservabilityReadScope.getReadableIds({
        service: DataAssetService,
        query,
        ids,
      })) {
        readable.add(id);
      }
    }

    return {
      dataAssetIds: Array.from(tableIds).filter((id: string): boolean => {
        return readable.has(id);
      }),
      dataPipelineIds: (pipelines as Array<DataPipeline>)
        .map((pipeline: DataPipeline): string => {
          return pipeline.id?.toString() || "";
        })
        .filter(Boolean),
    };
  }

  // The project's newest rows: a whole map.
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
            select: LINEAGE_SELECT,
            sort: { lastSeenAt: SortOrder.Descending },
            limit,
            skip: 0,
            props: { isRoot: true },
          });

        return found
          .map(toLineageRow)
          .filter((row: DataLineageMapLineageRow | null): boolean => {
            return row !== null;
          }) as Array<DataLineageMapLineageRow>;
      },

      readUsages: async (
        limit: number,
      ): Promise<Array<DataLineageMapUsageRow>> => {
        const found: Array<DataAssetUsage> = await DataAssetUsageService.findBy(
          {
            query: { projectId },
            select: USAGE_SELECT,
            sort: { lastSeenAt: SortOrder.Descending },
            limit,
            skip: 0,
            props: { isRoot: true },
          },
        );

        return found
          .map(toUsageRow)
          .filter((row: DataLineageMapUsageRow | null): boolean => {
            return row !== null;
          }) as Array<DataLineageMapUsageRow>;
      },
    };
  }

  /*
   * The rows of the tables and pipelines a map starts from: each table's
   * rows both ways, each pipeline's own, and the services reading and
   * writing each table - a few hundred ids a read, every row once, the
   * newest first, at most `limit` (and one more when there were more).
   */
  public static getFocusedFlowReader(
    projectId: ObjectID,
    focus: DataLineageMapFocus,
  ): DataLineageMapFlowReader {
    return {
      readLineage: async (
        limit: number,
      ): Promise<Array<DataLineageMapLineageRow>> => {
        const rows: Map<string, DataLineageMapLineageRow> = new Map();
        const keep: (found: Array<DataAssetLineage>) => void = (
          found: Array<DataAssetLineage>,
        ): void => {
          for (const edge of found) {
            const row: DataLineageMapLineageRow | null = toLineageRow(edge);
            const key: string = edge.id?.toString() || "";

            if (row && key) {
              rows.set(key, row);
            }
          }
        };

        for (const ids of chunked(focus.dataAssetIds, READ_CHUNK)) {
          // What builds each table, then what each table builds.
          for (const query of [
            { projectId, downstreamDataAssetId: asIds(ids) },
            { projectId, upstreamDataAssetId: asIds(ids) },
          ] as Array<Query<DataAssetLineage>>) {
            keep(
              await DataAssetLineageService.findBy({
                query,
                select: LINEAGE_SELECT,
                sort: { lastSeenAt: SortOrder.Descending },
                limit,
                skip: 0,
                props: { isRoot: true },
              }),
            );
          }
        }

        for (const ids of chunked(focus.dataPipelineIds, READ_CHUNK)) {
          keep(
            await DataAssetLineageService.findBy({
              query: { projectId, dataPipelineId: asIds(ids) },
              select: LINEAGE_SELECT,
              sort: { lastSeenAt: SortOrder.Descending },
              limit,
              skip: 0,
              props: { isRoot: true },
            }),
          );
        }

        return newestOf(rows, limit);
      },

      readUsages: async (
        limit: number,
      ): Promise<Array<DataLineageMapUsageRow>> => {
        const rows: Map<string, DataLineageMapUsageRow> = new Map();

        for (const ids of chunked(focus.dataAssetIds, READ_CHUNK)) {
          const found: Array<DataAssetUsage> =
            await DataAssetUsageService.findBy({
              query: { projectId, dataAssetId: asIds(ids) },
              select: USAGE_SELECT,
              sort: { lastSeenAt: SortOrder.Descending },
              limit,
              skip: 0,
              props: { isRoot: true },
            });

          for (const usage of found) {
            const row: DataLineageMapUsageRow | null = toUsageRow(usage);
            const key: string = usage.id?.toString() || "";

            if (row && key) {
              rows.set(key, row);
            }
          }
        }

        return newestOf(rows, limit);
      },
    };
  }
}
