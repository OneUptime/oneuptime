import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../Models/DatabaseModels/DataAssetLineage";
import DataAssetUsage from "../../../Models/DatabaseModels/DataAssetUsage";
import DataBiConnection from "../../../Models/DatabaseModels/DataBiConnection";
import DataDashboard from "../../../Models/DatabaseModels/DataDashboard";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { isDataAssetLineageSource } from "../../../Types/DataObservability/DataAssetLineageSource";
import { DataAssetAccessKind } from "../../../Types/DataObservability/DataAssetUsage";
import {
  DataBiLineageSummary,
  DataBiSource,
  DataDashboardDataset,
  DataDashboardUpstream,
  getDataBiSourceName,
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
  DataLineageMapRequest,
  DataLineageMapTableRow,
  DataLineageMapUsageRow,
  MAX_DATA_LINEAGE_MAP_BI_DASHBOARD_ROWS,
  MAX_DATA_LINEAGE_MAP_BI_TOOLS,
  MAX_DATA_LINEAGE_MAP_FOCUS_TABLES,
  MAX_DATA_LINEAGE_MAP_LINEAGE_ROWS,
  MAX_DATA_LINEAGE_MAP_NODES,
  MAX_DATA_LINEAGE_MAP_SEARCH_MATCHES,
  MAX_DATA_LINEAGE_MAP_USAGE_ROWS,
  assembleDataLineageMap,
  chooseDataLineageMapBiDashboards,
  chooseDataLineageMapFlows,
  combineDataLineageMapBiChoices,
  getDataLineageMapBiDashboardIds,
  isFocusedDataLineageMapRequest,
} from "../../../Types/DataObservability/DataLineageMap";
import ObjectID from "../../../Types/ObjectID";
import DataAssetLineageService from "../../Services/DataAssetLineageService";
import DataAssetService from "../../Services/DataAssetService";
import DataAssetUsageService from "../../Services/DataAssetUsageService";
import DataBiConnectionService from "../../Services/DataBiConnectionService";
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
 * Then, in the room left, the BI dashboards that no flow draws
 * (readBiDashboards, #9507): those on watched tables nothing else touches,
 * with their tables, and those on no watched table, with the datasets and
 * data sources their tool says they are built on - a project whose only
 * lineage is its BI tool's still has a map. A whole map's are the
 * project's; a map that starts somewhere's are those on the tables it
 * starts from (#9553), and a search's first of all the dashboards it names
 * - by name, or by a dataset's or data source's name - so the report
 * searched for is drawn even when nothing else touches it, or when
 * hundreds of others are built on the same tables. With either, the BI
 * tools whose dashboards are on no watched table are told of, with why
 * (readBiToolsOffTables).
 *
 * Every read is the project's own (projectId on every query), and of what
 * its reader may read (#9526): a role limited to what its members own, or
 * to some labels, has every row naming a table or pipeline it may not read
 * left out, by the rule a table's drawing keeps its rows by
 * (DataLineageReadableCache), so it is never told of one - not by name,
 * and not in how many tables the map left out. Such a reader is drawn the
 * BI dashboards their tables lead to, each with only those tables, and no
 * dashboard on no table they may read.
 */

// Where the map reads its flows from: the database, or a test's rows in memory.
export interface DataLineageMapFlowReader {
  readLineage(limit: number): Promise<Array<DataLineageMapLineageRow>>;
  readUsages(limit: number): Promise<Array<DataLineageMapUsageRow>>;
  /*
   * The BI dashboards to draw in the room the flows leave, those on the
   * most watched tables first, then the most viewed: each with all its
   * watched tables and what its tool says it is built on. A whole map's
   * are the project's; a map that starts somewhere's, those on the tables
   * it starts from. Left out, no dashboard is drawn but those on the flows'
   * tables.
   */
  readBiDashboards?(limit: number): Promise<Array<DataLineageMapDashboardRow>>;
  /*
   * The dashboards a search names - by their own names, or by their
   * datasets' or data sources' - the closest first: drawn before any
   * other, so the one searched for is never left off. Left out, none.
   */
  readNamedDashboards?(
    limit: number,
  ): Promise<Array<DataLineageMapDashboardRow>>;
}

// What a map that starts somewhere reads the flows of.
export interface DataLineageMapFocus {
  // The tables: their rows each way, and the services reading and writing them.
  dataAssetIds: Array<string>;
  // The pipelines a search names: their own rows.
  dataPipelineIds: Array<string>;
  // The BI dashboards a search names, the closest first (#9553).
  dataDashboardIds: Array<string>;
  // More tables than one map reads the flows of.
  isTruncated: boolean;
}

// The most ids one read names.
const READ_CHUNK: number = 500;

/*
 * The most dashboards whose built-on text holds a search, read to find
 * those whose datasets or data sources it names: the text holds more than
 * names (a source's type, its keys), so more are read than are kept.
 */
const MAX_DASHBOARDS_SEARCHED_BY_UPSTREAM: number = 500;

// Whether a dashboard's datasets or data sources are named by the words, in any case.
function isUpstreamNamedBy(
  upstream: DataDashboardUpstream | null,
  words: string,
): boolean {
  if (!upstream || !words) {
    return false;
  }

  const holds: (text: string | null) => boolean = (
    text: string | null,
  ): boolean => {
    return Boolean(text && text.toLowerCase().includes(words));
  };
  const isSourceNamed: (source: DataBiSource) => boolean = (
    source: DataBiSource,
  ): boolean => {
    return holds(getDataBiSourceName(source));
  };

  return (
    upstream.datasets.some((dataset: DataDashboardDataset): boolean => {
      return holds(dataset.name) || dataset.sources.some(isSourceNamed);
    }) || upstream.sources.some(isSourceNamed)
  );
}

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

// What a BI dashboard is drawn with: its watched tables, what its tool says it is built on, and what orders it.
const BI_DASHBOARD_SELECT: {
  _id: true;
  name: true;
  tool: true;
  url: true;
  upstream: true;
  tableCount: true;
  viewCount: true;
  dataAssets: { _id: true };
} = {
  _id: true,
  name: true,
  tool: true,
  url: true,
  upstream: true,
  tableCount: true,
  viewCount: true,
  dataAssets: { _id: true },
};

// Those on the most watched tables first, then the most viewed, then by name.
const BI_DASHBOARD_SORT: {
  tableCount: SortOrder;
  viewCount: SortOrder;
  name: SortOrder;
} = {
  tableCount: SortOrder.Descending,
  viewCount: SortOrder.Descending,
  name: SortOrder.Ascending,
};

function compareBiDashboards(a: DataDashboard, b: DataDashboard): number {
  return (
    (b.tableCount || 0) - (a.tableCount || 0) ||
    (b.viewCount || 0) - (a.viewCount || 0) ||
    (a.name || "").localeCompare(b.name || "")
  );
}

function toBiDashboardRow(
  dashboard: DataDashboard,
): DataLineageMapDashboardRow {
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
    const [map, biToolsOffTables] = await Promise.all([
      DataLineageMapReader.readMap(data),
      DataLineageMapReader.readBiToolsOffTables(data.projectId),
    ]);

    return biToolsOffTables.length > 0 ? { ...map, biToolsOffTables } : map;
  }

  private static async readMap(data: {
    projectId: ObjectID;
    now: Date;
    reader: DatabaseCommonInteractionProps | null;
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
    const cache: DataLineageReadableCache | null = data.readable
      ? new DataLineageReadableCache(data.readable)
      : null;

    if (cache) {
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

    const maxNodes: number = data.maxNodes ?? MAX_DATA_LINEAGE_MAP_NODES;
    /*
     * A BI dashboard as its reader may see it: a reader limited to some
     * tables (#9526) is drawn a dashboard their tables lead to, with only
     * those tables, and none on no table they may read.
     */
    const readableRows: (
      rows: Array<DataLineageMapDashboardRow>,
    ) => Promise<Array<DataLineageMapDashboardRow>> = async (
      rows: Array<DataLineageMapDashboardRow>,
    ): Promise<Array<DataLineageMapDashboardRow>> => {
      if (!cache) {
        return rows;
      }

      await cache.knowTables(
        rows.flatMap((row: DataLineageMapDashboardRow): Array<string> => {
          return row.dataAssetIds;
        }),
      );

      return rows
        .map((row: DataLineageMapDashboardRow): DataLineageMapDashboardRow => {
          return {
            ...row,
            dataAssetIds: row.dataAssetIds.filter((id: string): boolean => {
              return cache.isTable(id);
            }),
          };
        })
        .filter((row: DataLineageMapDashboardRow): boolean => {
          return row.dataAssetIds.length > 0;
        });
    };

    // First the dashboards a search names (#9553), so the one searched for is never left off.
    const named: DataLineageMapBiChoice = chooseDataLineageMapBiDashboards({
      rows:
        choice.dashboardRoom > 0 && data.flows.readNamedDashboards
          ? await readableRows(
              await data.flows.readNamedDashboards(
                MAX_DATA_LINEAGE_MAP_SEARCH_MATCHES,
              ),
            )
          : [],
      drawnDataAssetIds: new Set(choice.dataAssetIds),
      drawnDashboardIds: new Set(),
      nodeRoom: maxNodes - choice.nodeCount,
      dashboardRoom: choice.dashboardRoom,
    });
    const namedIds: Set<string> = new Set(
      getDataLineageMapBiDashboardIds(named),
    );
    const flowDashboardRoom: number = choice.dashboardRoom - namedIds.size;

    /*
     * Then the dashboards on the flows' tables, in the room the named ones
     * leave - read even when they leave none, to know one was left off.
     */
    const dashboards: {
      dashboards: Array<DataLineageDashboardRow>;
      total: number;
    } =
      choice.dataAssetIds.length > 0 && choice.dashboardRoom > 0
        ? await data.details.readDashboards({
            dataAssetIds: choice.dataAssetIds,
            // One more than there is room for, to know there were more, and those drawn already.
            limit: flowDashboardRoom + namedIds.size + 1,
          })
        : { dashboards: [], total: 0 };
    const flowDashboards: Array<DataLineageDashboardRow> =
      dashboards.dashboards.filter(
        (dashboard: DataLineageDashboardRow): boolean => {
          return !namedIds.has(dashboard.dataDashboardId);
        },
      );

    // Then the BI dashboards no flow draws, in the room left.
    const onFlows: number = Math.min(flowDashboardRoom, flowDashboards.length);
    const nodeRoom: number =
      maxNodes - choice.nodeCount - (named.nodeCount || 0) - onFlows;
    const dashboardRoom: number = flowDashboardRoom - onFlows;
    const biRows: Array<DataLineageMapDashboardRow> =
      nodeRoom > 0 && dashboardRoom > 0 && data.flows.readBiDashboards
        ? await data.flows.readBiDashboards(
            MAX_DATA_LINEAGE_MAP_BI_DASHBOARD_ROWS + 1,
          )
        : [];
    const bi: DataLineageMapBiChoice = combineDataLineageMapBiChoices(
      named,
      chooseDataLineageMapBiDashboards({
        rows: await readableRows(
          biRows.slice(0, MAX_DATA_LINEAGE_MAP_BI_DASHBOARD_ROWS),
        ),
        hadMoreRows: biRows.length > MAX_DATA_LINEAGE_MAP_BI_DASHBOARD_ROWS,
        drawnDataAssetIds: new Set([
          ...choice.dataAssetIds,
          ...named.dataAssetIds,
        ]),
        drawnDashboardIds: new Set([
          ...namedIds,
          ...flowDashboards.map(
            (dashboard: DataLineageDashboardRow): string => {
              return dashboard.dataDashboardId;
            },
          ),
        ]),
        nodeRoom,
        dashboardRoom,
      }),
    );
    const dataAssetIds: Array<string> = Array.from(
      new Set([...choice.dataAssetIds, ...bi.dataAssetIds]),
    ).sort();

    if (dataAssetIds.length === 0 && bi.upstreamDashboards.length === 0) {
      return {
        nodes: [],
        edges: [],
        isTruncated: choice.isTruncated || bi.isTruncated,
        hiddenTableCount: choice.hiddenTableCount,
        isHiddenTableCountAtLeast: choice.isHiddenTableCountAtLeast,
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
      // The flows' dashboards are drawn in the room the named ones leave.
      choice: { ...choice, dashboardRoom: flowDashboardRoom },
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
      dashboards: flowDashboards.map(
        (dashboard: DataLineageDashboardRow): DataLineageMapDashboardRow => {
          return { ...dashboard };
        },
      ),
      bi,
      openAlertCounts,
      now: data.now,
    });
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
    const dataDashboardIds: Array<string> = [];

    if (search) {
      const named: {
        dataAssetIds: Array<string>;
        dataPipelineIds: Array<string>;
        dataDashboardIds: Array<string>;
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
      dataDashboardIds.push(...named.dataDashboardIds);
    }

    return {
      dataAssetIds: Array.from(dataAssetIds),
      dataPipelineIds,
      dataDashboardIds,
      isTruncated,
    };
  }

  /*
   * The BI dashboards a search names, the closest first: those whose own
   * name holds it, then those whose datasets' or data sources' names do
   * (#9553) - a report found by the semantic model it charts, or by the
   * SharePoint list or database it loads from. Each with its watched
   * tables; at most MAX_DATA_LINEAGE_MAP_SEARCH_MATCHES.
   */
  public static async readDashboardsNamedBy(data: {
    projectId: ObjectID;
    search: string;
  }): Promise<Array<DataDashboard>> {
    const words: string = data.search.trim().toLowerCase();
    const select: {
      _id: true;
      name: true;
      upstream: true;
      dataAssets: { _id: true };
    } = { _id: true, name: true, upstream: true, dataAssets: { _id: true } };
    const [byName, byUpstream] = await Promise.all([
      DataDashboardService.findBy({
        query: { projectId: data.projectId, name: QueryHelper.search(words) },
        select,
        sort: { viewCount: SortOrder.Descending, name: SortOrder.Ascending },
        limit: MAX_DATA_LINEAGE_MAP_SEARCH_MATCHES,
        skip: 0,
        props: { isRoot: true },
      }),
      // What a dashboard is built on, as text: narrowed to its datasets' and sources' names below.
      DataDashboardService.findBy({
        query: {
          projectId: data.projectId,
          upstream: QueryHelper.search(words),
        },
        select,
        sort: { viewCount: SortOrder.Descending, name: SortOrder.Ascending },
        limit: MAX_DASHBOARDS_SEARCHED_BY_UPSTREAM,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);
    const found: Map<string, DataDashboard> = new Map();

    for (const dashboard of byName as Array<DataDashboard>) {
      if (dashboard.id) {
        found.set(dashboard.id.toString(), dashboard);
      }
    }

    for (const dashboard of byUpstream as Array<DataDashboard>) {
      if (
        dashboard.id &&
        !found.has(dashboard.id.toString()) &&
        isUpstreamNamedBy(readDataDashboardUpstream(dashboard.upstream), words)
      ) {
        found.set(dashboard.id.toString(), dashboard);
      }
    }

    return Array.from(found.values()).slice(
      0,
      MAX_DATA_LINEAGE_MAP_SEARCH_MATCHES,
    );
  }

  /*
   * What else a search of the map names, of what its reader may read: the
   * pipelines whose job name holds it, the tables read and written by the
   * services whose names hold it, and the BI dashboards it names - by
   * their names, or their datasets' or data sources' - with their tables.
   * In one database, only its tables, and only the dashboards on them.
   */
  private static async readNamedBySearch(data: {
    projectId: ObjectID;
    scope: DataObservabilityScope;
    search: string;
    dataStoreId?: string | undefined;
  }): Promise<{
    dataAssetIds: Array<string>;
    dataPipelineIds: Array<string>;
    dataDashboardIds: Array<string>;
  }> {
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
      DataLineageMapReader.readDashboardsNamedBy({
        projectId: data.projectId,
        search: data.search,
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
      /*
       * Every dashboard named, the map drawing each as its reader may see
       * it (build); in one database, those on its tables a reader may read.
       */
      dataDashboardIds: dashboards
        .filter((dashboard: DataDashboard): boolean => {
          return (
            !data.dataStoreId ||
            (dashboard.dataAssets || []).some((asset: DataAsset): boolean => {
              return readable.has(asset._id?.toString() || "");
            })
          );
        })
        .map((dashboard: DataDashboard): string => {
          return dashboard.id!.toString();
        }),
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

      readBiDashboards: async (
        limit: number,
      ): Promise<Array<DataLineageMapDashboardRow>> => {
        const found: Array<DataDashboard> = await DataDashboardService.findBy({
          query: { projectId },
          select: BI_DASHBOARD_SELECT,
          sort: BI_DASHBOARD_SORT,
          limit,
          skip: 0,
          props: { isRoot: true },
        });

        return found
          .filter((dashboard: DataDashboard): boolean => {
            return Boolean(dashboard.id);
          })
          .map(toBiDashboardRow);
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

      /*
       * The BI dashboards on the tables the map starts from - one
       * database's, or a search's - those on the most watched tables first,
       * then the most viewed (#9553): drawn when nothing else touches their
       * tables, the usual case for a project whose only lineage is its BI
       * tool's.
       */
      readBiDashboards: async (
        limit: number,
      ): Promise<Array<DataLineageMapDashboardRow>> => {
        const found: Map<string, DataDashboard> = new Map();

        for (const ids of chunked(focus.dataAssetIds, READ_CHUNK)) {
          for (const dashboard of (await DataDashboardService.findBy({
            query: {
              projectId,
              _id: QueryHelper.anyOfEntitiesInManyToMany({
                values: ids.map((id: string): ObjectID => {
                  return new ObjectID(id);
                }),
                joinTableName: "DataDashboardDataAsset",
                ownerColumnName: "dataDashboardId",
                relationColumnName: "dataAssetId",
              }),
            },
            select: BI_DASHBOARD_SELECT,
            sort: BI_DASHBOARD_SORT,
            limit,
            skip: 0,
            props: { isRoot: true },
          })) as Array<DataDashboard>) {
            if (dashboard.id) {
              found.set(dashboard.id.toString(), dashboard);
            }
          }
        }

        return Array.from(found.values())
          .sort(compareBiDashboards)
          .slice(0, limit)
          .map(toBiDashboardRow);
      },

      // The dashboards a search names, in the order it named them.
      readNamedDashboards: async (
        limit: number,
      ): Promise<Array<DataLineageMapDashboardRow>> => {
        const wanted: Array<string> = focus.dataDashboardIds.slice(0, limit);

        if (wanted.length === 0) {
          return [];
        }

        const found: Map<string, DataDashboard> = new Map(
          (
            (await DataDashboardService.findBy({
              query: { projectId, _id: asIds(wanted) },
              select: BI_DASHBOARD_SELECT,
              limit: wanted.length,
              skip: 0,
              props: { isRoot: true },
            })) as Array<DataDashboard>
          ).map((dashboard: DataDashboard): [string, DataDashboard] => {
            return [dashboard.id?.toString() || "", dashboard];
          }),
        );

        return wanted
          .map((id: string): DataDashboard | undefined => {
            return found.get(id);
          })
          .filter((dashboard: DataDashboard | undefined): boolean => {
            return Boolean(dashboard?.id);
          })
          .map((dashboard: DataDashboard | undefined) => {
            return toBiDashboardRow(dashboard!);
          });
      },
    };
  }
}
