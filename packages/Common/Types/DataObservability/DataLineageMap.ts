import {
  DataAssetFreshness,
  DataAssetFreshnessResult,
  getDataAssetFreshness,
} from "./DataAssetFreshness";
import DataAssetKind from "./DataAssetKind";
import DataAssetLineageSource from "./DataAssetLineageSource";
import { DataAssetAccessKind } from "./DataAssetUsage";
import {
  DataBiLineageSummary,
  DataBiSource,
  DataDashboardDataset,
  DataDashboardUpstream,
  getDataBiSourceName,
  isDataBiDatabaseSource,
} from "./DataBiLineage";

/*
 * THE PROJECT'S LINEAGE MAP: WHO WRITES AND READS WHICH DATA, AND WHERE IT
 * FLOWS, ACROSS THE WHOLE PROJECT (#9114).
 *
 * A table's Lineage tab draws a few steps around one table. The map draws
 * every flow the project has seen at once, so a person can see what
 * depends on what without knowing which table to start from. Every arrow
 * on it is a fact OneUptime recorded, never a guess:
 *
 *  - Feeds: one table is built from another (DataAssetLineage with both
 *    tables): a pipeline's run (OpenLineage, dbt, Fivetran, Airbyte, a job
 *    in traces), the database's query history, or a view's definition.
 *  - Writes: a pipeline loads a table from data OneUptime does not watch
 *    (DataAssetLineage with no upstream table), or a service's database
 *    spans change the table's rows (DataAssetUsage, Write).
 *  - Reads: a service's database spans read the table (DataAssetUsage,
 *    Read), or a BI dashboard or reverse ETL sync is built on it
 *    (DataDashboard's tables).
 *
 * A dashboard needs no other flow to be drawn: one built on watched tables
 * that nothing else touches is drawn with them, in the room the flows
 * leave. And a dashboard built on no watched table is drawn with what its
 * tool says it is built on (DataDashboard.upstream, Power BI): its
 * datasets, and the data sources they are loaded from - a database
 * OneUptime does not watch, a file, a web page - so a project whose BI
 * tool reads data OneUptime does not watch still sees where it comes
 * from.
 *
 * A project can have tens of thousands of tables, and a drawing past a few
 * hundred cards is read by nobody, so the map holds the flows seen most
 * recently first, at most MAX_DATA_LINEAGE_MAP_NODES cards, and says when
 * there were more (isTruncated) and how many tables it left out
 * (hiddenTableCount). What it draws is still true.
 *
 * A map can start somewhere (#6547): from one database - the flows of its
 * tables, and the cards they join - or from a search of the whole project -
 * the flows of the tables, pipelines, services and dashboards whose names
 * hold the words (DataLineageMapRequest) - so a table whose flows are older
 * than the newest a whole map holds is found all the same.
 *
 * It holds only what its reader may read (#9526): a role limited to what
 * its members own, or to some labels, sees the flows of those tables and
 * pipelines, and is never told of another - not by name, not in a count.
 *
 * The rows are read by Server/Utils/DataObservability/DataLineageMap; the
 * choosing and the drawing's facts are worked out here, free of the
 * database, so they can be pinned in plain tests.
 */

export enum DataLineageMapNodeKind {
  Service = "Service",
  Table = "Table",
  Pipeline = "Pipeline",
  Dashboard = "Dashboard",
  // A BI tool's model a dashboard charts: a Power BI dataset.
  Dataset = "Dataset",
  // Where a dataset's data comes from, as its BI tool says, when OneUptime watches none of its tables.
  Source = "Source",
}

export enum DataLineageMapEdgeKind {
  // One table is built from another.
  Feeds = "Feeds",
  // A pipeline or a service writes a table.
  Writes = "Writes",
  // A service or a dashboard reads a table.
  Reads = "Reads",
}

// Where an arrow was seen: a lineage source, a service's spans, or a BI tool.
export enum DataLineageMapEvidence {
  Pipeline = "Pipeline",
  QueryHistory = "Query History",
  ViewDefinition = "View Definition",
  Traces = "Traces",
  BiTool = "BI Tool",
}

// The order an arrow names where it was seen in.
export const EVIDENCE_ORDER: ReadonlyArray<DataLineageMapEvidence> = [
  DataLineageMapEvidence.Pipeline,
  DataLineageMapEvidence.QueryHistory,
  DataLineageMapEvidence.ViewDefinition,
  DataLineageMapEvidence.Traces,
  DataLineageMapEvidence.BiTool,
];

// The most lineage rows read, the newest first.
export const MAX_DATA_LINEAGE_MAP_LINEAGE_ROWS: number = 5000;

// The most rows of services reading and writing tables read, the newest first.
export const MAX_DATA_LINEAGE_MAP_USAGE_ROWS: number = 5000;

// The most cards one map draws: services, tables, pipelines and dashboards together.
export const MAX_DATA_LINEAGE_MAP_NODES: number = 400;

// The most dashboards one map draws, of the cards above.
export const MAX_DATA_LINEAGE_MAP_DASHBOARDS: number = 100;

// The most operations an arrow from a service names.
export const MAX_DATA_LINEAGE_MAP_OPERATIONS: number = 6;

/*
 * The most tables a map that starts somewhere reads the flows of: one
 * database's, a search's, or - for a reader limited to some of the
 * project's tables - the ones they may read. Past it, the map says it was
 * cut short.
 */
export const MAX_DATA_LINEAGE_MAP_FOCUS_TABLES: number = 1000;

// The most pipelines, services and dashboards one search of the map matches.
export const MAX_DATA_LINEAGE_MAP_SEARCH_MATCHES: number = 100;

// The longest search the map takes: a table's schema.table key, or a few words of it.
export const MAX_DATA_LINEAGE_MAP_SEARCH_LENGTH: number = 100;

/*
 * Where a map starts (#6547): the whole project, one database, or a
 * search of the whole project. Both narrow it together.
 */
export interface DataLineageMapRequest {
  // The flows of this database's tables, and the cards they join.
  dataStoreId?: string | undefined;
  // The flows of the tables, pipelines, services and dashboards whose names hold these words.
  search?: string | undefined;
}

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * A map's request as sent: the database by its ID, the search trimmed and
 * at most MAX_DATA_LINEAGE_MAP_SEARCH_LENGTH long, each left out when empty.
 * A string says why it was refused.
 */
export function readDataLineageMapRequest(
  body: unknown,
): DataLineageMapRequest | string {
  if (body === null || body === undefined) {
    return {};
  }

  if (typeof body !== "object" || Array.isArray(body)) {
    return "Send the map's request as an object.";
  }

  const fields: Record<string, unknown> = body as Record<string, unknown>;
  const request: DataLineageMapRequest = {};
  const dataStoreId: unknown = fields["dataStoreId"];
  const search: unknown = fields["search"];

  if (dataStoreId !== undefined && dataStoreId !== null && dataStoreId !== "") {
    if (typeof dataStoreId !== "string" || !UUID_PATTERN.test(dataStoreId)) {
      return "Name the database by its ID.";
    }

    request.dataStoreId = dataStoreId.toLowerCase();
  }

  if (search !== undefined && search !== null) {
    if (typeof search !== "string") {
      return "Search for words: a table's name, or a pipeline's, a service's or a dashboard's.";
    }

    const words: string = search.trim();

    if (words.length > MAX_DATA_LINEAGE_MAP_SEARCH_LENGTH) {
      return `Search for at most ${MAX_DATA_LINEAGE_MAP_SEARCH_LENGTH} characters.`;
    }

    if (words) {
      request.search = words;
    }
  }

  return request;
}

// Whether a request starts the map somewhere: one database, or a search.
export function isFocusedDataLineageMapRequest(
  request: DataLineageMapRequest,
): boolean {
  return Boolean(request.dataStoreId || request.search);
}

// The most BI tools the map tells of whose dashboards are on no watched table.
export const MAX_DATA_LINEAGE_MAP_BI_TOOLS: number = 20;

// The most BI dashboards read to fill the room the flows leave: more than are drawn, to pass those drawn already.
export const MAX_DATA_LINEAGE_MAP_BI_DASHBOARD_ROWS: number = 300;

// The most tables drawn for a dashboard no flow draws, and datasets and sources for one on no watched table.
export const MAX_DATA_LINEAGE_MAP_TABLES_PER_DASHBOARD: number = 10;
export const MAX_DATA_LINEAGE_MAP_DATASETS_PER_DASHBOARD: number = 5;
export const MAX_DATA_LINEAGE_MAP_SOURCES_PER_DATASET: number = 5;

export interface DataLineageMapPipeline {
  dataPipelineId: string;
  name: string;
  lastRunState: string | null;
}

export interface DataLineageMapNode {
  // "service:<id or name>", "table:<id>", "pipeline:<id>" or "dashboard:<id>".
  id: string;
  kind: DataLineageMapNodeKind;
  // A table's schema.table key, a service's name, a pipeline's job name, a dashboard's name.
  name: string;

  // A table's.
  dataAssetId?: string | undefined;
  database?: string | null | undefined;
  assetKind?: DataAssetKind | null | undefined;
  freshness?: DataAssetFreshness | undefined;
  lateBySeconds?: number | undefined;
  isDropped?: boolean | undefined;
  // Its open alerts that the map's reader may see.
  openAlertCount?: number | undefined;

  // A service's: null when only its name is known.
  serviceId?: string | null | undefined;

  // A pipeline's.
  dataPipelineId?: string | undefined;
  jobNamespace?: string | null | undefined;
  lastRunState?: string | null | undefined;

  // A dashboard's.
  dataDashboardId?: string | undefined;
  tool?: string | null | undefined;
  url?: string | null | undefined;

  // A dataset's: its workspace.
  workspace?: string | null | undefined;

  // A data source's: what it is (SQL Server, SharePoint, Excel file...), and whether it is a database.
  sourceType?: string | null | undefined;
  isDatabaseSource?: boolean | undefined;
}

export interface DataLineageMapEdge {
  // "<kind>:<source>><target>": one arrow each.
  id: string;
  source: string;
  target: string;
  kind: DataLineageMapEdgeKind;
  // Every place it was seen.
  seenIn: Array<DataLineageMapEvidence>;
  // The pipelines that move data along a Feeds arrow, a failed run first.
  pipelines: Array<DataLineageMapPipeline>;
  // The statements a service ran on the table (SELECT, INSERT...), as its spans name them.
  operations: Array<string>;
  // ISO time it was last seen; null when its source keeps none (a dashboard's read).
  lastSeenAt: string | null;
}

export interface DataLineageMap {
  nodes: Array<DataLineageMapNode>;
  edges: Array<DataLineageMapEdge>;
  // More flows than one map holds: the newest are drawn.
  isTruncated: boolean;
  /*
   * The tables the flows read need that the map does not draw, past its
   * most cards: how many more there are, each counted once - at least this
   * many when there were more flows than were read
   * (isHiddenTableCountAtLeast). Only tables its reader may read are
   * counted. Left out by a server from before it was counted.
   */
  hiddenTableCount?: number | undefined;
  isHiddenTableCountAtLeast?: boolean | undefined;
  /*
   * The BI tools whose dashboards were read but are on no watched table,
   * each with why (DataBiLineageSummary): what the map says it cannot
   * draw on tables. Left out when there are none.
   */
  biToolsOffTables?: Array<DataLineageMapBiTool> | undefined;
}

export interface DataLineageMapBiTool {
  dataBiConnectionId: string;
  name: string;
  tool: string | null;
  dashboardCount: number;
  summary: DataBiLineageSummary;
}

// One DataAssetLineage row, as the map reads it.
export interface DataLineageMapLineageRow {
  // Null: a pipeline writes the table from data OneUptime does not watch.
  upstreamDataAssetId: string | null;
  downstreamDataAssetId: string;
  dataPipelineId: string | null;
  // Null is a pipeline's run, as the column says.
  source: DataAssetLineageSource | null;
  lastSeenAt: Date | null;
}

// One DataAssetUsage row: a service seen reading or writing a table in its spans.
export interface DataLineageMapUsageRow {
  dataAssetId: string;
  serviceId: string | null;
  serviceName: string;
  accessKind: DataAssetAccessKind;
  operations: Array<string>;
  lastSeenAt: Date | null;
}

export interface DataLineageMapTableRow {
  dataAssetId: string;
  assetKey: string;
  name: string | null;
  database: string | null;
  assetKind: DataAssetKind | null;
  lastChangedAt: Date | null;
  updateIntervalInSeconds: number | null;
  isDropped: boolean;
}

export interface DataLineageMapPipelineRow {
  dataPipelineId: string;
  jobName: string;
  jobNamespace: string | null;
  lastRunState: string | null;
}

export interface DataLineageMapDashboardRow {
  dataDashboardId: string;
  name: string;
  tool: string | null;
  url: string | null;
  // The tables it is built on, of those asked about.
  dataAssetIds: Array<string>;
  // What its tool says it is built on (Power BI): its datasets and their data sources.
  upstream?: DataDashboardUpstream | null | undefined;
}

// What was chosen to draw, before the tables, pipelines and dashboards are read.
export interface DataLineageMapChoice {
  lineage: Array<DataLineageMapLineageRow>;
  usages: Array<DataLineageMapUsageRow>;
  dataAssetIds: Array<string>;
  dataPipelineIds: Array<string>;
  // Cards left for dashboards.
  dashboardRoom: number;
  // Cards the flows draw.
  nodeCount: number;
  isTruncated: boolean;
  // The tables the flows read need that are not drawn, each once.
  hiddenTableCount: number;
  // More rows than were read: there are at least that many.
  isHiddenTableCountAtLeast: boolean;
}

/*
 * The dashboards drawn in the room the flows leave: those on watched
 * tables no flow draws, and those on no watched table, with what their
 * tool says they are built on.
 */
export interface DataLineageMapBiChoice {
  // Each with the tables drawn for it: at most MAX_DATA_LINEAGE_MAP_TABLES_PER_DASHBOARD.
  tableDashboards: Array<DataLineageMapDashboardRow>;
  upstreamDashboards: Array<DataLineageMapDashboardRow>;
  // The tables they need drawn that no flow draws.
  dataAssetIds: Array<string>;
  isTruncated: boolean;
}

// How a table's card id starts (getLineageMapTableNodeId).
const TABLE_NODE_PREFIX: string = "table:";

export function getLineageMapTableNodeId(dataAssetId: string): string {
  return `${TABLE_NODE_PREFIX}${dataAssetId}`;
}

export function getLineageMapPipelineNodeId(dataPipelineId: string): string {
  return `pipeline:${dataPipelineId}`;
}

export function getLineageMapDashboardNodeId(dataDashboardId: string): string {
  return `dashboard:${dataDashboardId}`;
}

// A dataset by its id in its tool; one with none by its name and workspace.
export function getLineageMapDatasetNodeId(
  dataset: Pick<DataDashboardDataset, "id" | "name" | "workspace">,
): string {
  return dataset.id
    ? `dataset:${dataset.id.toLowerCase()}`
    : `dataset-name:${[dataset.workspace, dataset.name]
        .map((part: string | null): string => {
          return (part || "").trim().toLowerCase();
        })
        .join("|")}`;
}

// A data source by what it is and where.
export function getLineageMapSourceNodeId(source: DataBiSource): string {
  return `source:${[
    source.type,
    source.server,
    source.database,
    source.location,
  ]
    .map((part: string | null): string => {
      return (part || "").trim().toLowerCase();
    })
    .join("|")}`;
}

// The cards a dashboard on no watched table is drawn with: its datasets, each with its sources.
export interface DataLineageMapUpstreamCards {
  datasets: Array<{
    nodeId: string;
    dataset: DataDashboardDataset;
    sources: Array<{ nodeId: string; source: DataBiSource }>;
  }>;
  // Sources a tool names with no dataset between: drawn reading straight into the dashboard.
  sources: Array<{ nodeId: string; source: DataBiSource }>;
}

export function getLineageMapUpstreamCards(
  upstream: DataDashboardUpstream | null | undefined,
): DataLineageMapUpstreamCards {
  const sourceCard: (source: DataBiSource) => {
    nodeId: string;
    source: DataBiSource;
  } = (source: DataBiSource) => {
    return { nodeId: getLineageMapSourceNodeId(source), source };
  };

  if (!upstream) {
    return { datasets: [], sources: [] };
  }

  const datasets: DataLineageMapUpstreamCards["datasets"] = upstream.datasets
    .slice(0, MAX_DATA_LINEAGE_MAP_DATASETS_PER_DASHBOARD)
    .map((dataset: DataDashboardDataset) => {
      return {
        nodeId: getLineageMapDatasetNodeId(dataset),
        dataset,
        sources: dataset.sources
          .slice(0, MAX_DATA_LINEAGE_MAP_SOURCES_PER_DATASET)
          .map(sourceCard),
      };
    });

  return {
    datasets,
    sources:
      datasets.length > 0
        ? []
        : upstream.sources
            .slice(0, MAX_DATA_LINEAGE_MAP_SOURCES_PER_DATASET)
            .map(sourceCard),
  };
}

function getUpstreamNodeIds(cards: DataLineageMapUpstreamCards): Array<string> {
  return Array.from(
    new Set([
      ...cards.datasets.flatMap(
        (entry: DataLineageMapUpstreamCards["datasets"][number]) => {
          return [
            entry.nodeId,
            ...entry.sources.map((source: { nodeId: string }): string => {
              return source.nodeId;
            }),
          ];
        },
      ),
      ...cards.sources.map((source: { nodeId: string }): string => {
        return source.nodeId;
      }),
    ]),
  );
}

// A service by its id; one known only by name, by its name.
export function getLineageMapServiceNodeId(data: {
  serviceId: string | null;
  serviceName: string;
}): string {
  return data.serviceId
    ? `service:${data.serviceId}`
    : `service-name:${data.serviceName.trim().toLowerCase()}`;
}

export function getLineageMapEdgeId(data: {
  kind: DataLineageMapEdgeKind;
  source: string;
  target: string;
}): string {
  return `${data.kind}:${data.source}>${data.target}`;
}

function timeOf(value: Date | null): number {
  return value ? value.getTime() : 0;
}

// The cards a flow needs, as node ids.
function lineageRowNodes(row: DataLineageMapLineageRow): Array<string> | null {
  const downstream: string = getLineageMapTableNodeId(
    row.downstreamDataAssetId,
  );

  if (row.upstreamDataAssetId) {
    if (row.upstreamDataAssetId === row.downstreamDataAssetId) {
      // A table built from itself (an append, a merge): no flow to draw.
      return null;
    }

    return [getLineageMapTableNodeId(row.upstreamDataAssetId), downstream];
  }

  if (row.dataPipelineId) {
    return [getLineageMapPipelineNodeId(row.dataPipelineId), downstream];
  }

  return null;
}

function usageRowNodes(row: DataLineageMapUsageRow): Array<string> | null {
  if (!row.serviceName.trim() && !row.serviceId) {
    return null;
  }

  return [
    getLineageMapServiceNodeId(row),
    getLineageMapTableNodeId(row.dataAssetId),
  ];
}

/*
 * Which flows the map draws: every flow, newest first, as long as the cards
 * it needs fit in the most a map draws; a flow whose cards are drawn
 * already always fits. The room left goes to dashboards, at most
 * MAX_DATA_LINEAGE_MAP_DASHBOARDS. A flow left out, or rows past those
 * read, make the map truncated.
 */
export function chooseDataLineageMapFlows(data: {
  lineage: Array<DataLineageMapLineageRow>;
  usages: Array<DataLineageMapUsageRow>;
  maxNodes?: number | undefined;
  // More rows than were read.
  hadMoreRows?: boolean | undefined;
}): DataLineageMapChoice {
  const maxNodes: number = data.maxNodes ?? MAX_DATA_LINEAGE_MAP_NODES;

  interface Flow {
    nodes: Array<string>;
    lastSeenAt: number;
    lineage?: DataLineageMapLineageRow;
    usage?: DataLineageMapUsageRow;
  }

  const flows: Array<Flow> = [];

  for (const row of data.lineage) {
    const nodes: Array<string> | null = lineageRowNodes(row);

    if (nodes) {
      flows.push({ nodes, lastSeenAt: timeOf(row.lastSeenAt), lineage: row });
    }
  }

  for (const row of data.usages) {
    const nodes: Array<string> | null = usageRowNodes(row);

    if (nodes) {
      flows.push({ nodes, lastSeenAt: timeOf(row.lastSeenAt), usage: row });
    }
  }

  // Newest first; ties in the order read, so a choice is the same each time.
  const ordered: Array<Flow> = flows
    .map((flow: Flow, index: number): { flow: Flow; index: number } => {
      return { flow, index };
    })
    .sort(
      (
        a: { flow: Flow; index: number },
        b: { flow: Flow; index: number },
      ): number => {
        return b.flow.lastSeenAt - a.flow.lastSeenAt || a.index - b.index;
      },
    )
    .map((entry: { flow: Flow; index: number }): Flow => {
      return entry.flow;
    });

  const drawn: Set<string> = new Set();
  const lineage: Array<DataLineageMapLineageRow> = [];
  const usages: Array<DataLineageMapUsageRow> = [];
  let isTruncated: boolean = Boolean(data.hadMoreRows);

  for (const flow of ordered) {
    const needed: number = flow.nodes.filter((id: string): boolean => {
      return !drawn.has(id);
    }).length;

    if (drawn.size + needed > maxNodes) {
      isTruncated = true;
      continue;
    }

    for (const id of flow.nodes) {
      drawn.add(id);
    }

    if (flow.lineage) {
      lineage.push(flow.lineage);
    }

    if (flow.usage) {
      usages.push(flow.usage);
    }
  }

  const dataAssetIds: Set<string> = new Set();
  const dataPipelineIds: Set<string> = new Set();

  for (const row of lineage) {
    dataAssetIds.add(row.downstreamDataAssetId);

    if (row.upstreamDataAssetId) {
      dataAssetIds.add(row.upstreamDataAssetId);
    }

    if (row.dataPipelineId) {
      dataPipelineIds.add(row.dataPipelineId);
    }
  }

  for (const row of usages) {
    dataAssetIds.add(row.dataAssetId);
  }

  // Every table a flow read needs that no drawn flow does: left out, each once.
  const hiddenTables: Set<string> = new Set();

  for (const flow of ordered) {
    for (const id of flow.nodes) {
      if (id.startsWith(TABLE_NODE_PREFIX) && !drawn.has(id)) {
        hiddenTables.add(id);
      }
    }
  }

  return {
    lineage,
    usages,
    dataAssetIds: Array.from(dataAssetIds).sort(),
    dataPipelineIds: Array.from(dataPipelineIds).sort(),
    dashboardRoom: Math.max(
      0,
      Math.min(MAX_DATA_LINEAGE_MAP_DASHBOARDS, maxNodes - drawn.size),
    ),
    nodeCount: drawn.size,
    isTruncated,
    hiddenTableCount: hiddenTables.size,
    isHiddenTableCountAtLeast: Boolean(data.hadMoreRows),
  };
}

/*
 * Which more dashboards fit in the room the flows and the dashboards on
 * their tables leave: first those on watched tables nothing else draws -
 * each with its tables, as many as fit - then those on no watched table,
 * with their datasets and data sources. Each in the order read; one too
 * big for the room left is passed over, and the map says there were more.
 */
export function chooseDataLineageMapBiDashboards(data: {
  // The project's dashboards, the most to draw first.
  rows: Array<DataLineageMapDashboardRow>;
  drawnDataAssetIds: ReadonlySet<string>;
  drawnDashboardIds: ReadonlySet<string>;
  nodeRoom: number;
  dashboardRoom: number;
  // More dashboards than were read.
  hadMoreRows?: boolean | undefined;
}): DataLineageMapBiChoice {
  const drawn: Set<string> = new Set(data.drawnDataAssetIds);
  const drawnUpstream: Set<string> = new Set();
  const dataAssetIds: Set<string> = new Set();
  const tableDashboards: Array<DataLineageMapDashboardRow> = [];
  const upstreamDashboards: Array<DataLineageMapDashboardRow> = [];
  let nodeRoom: number = data.nodeRoom;
  let dashboardRoom: number = data.dashboardRoom;
  let isTruncated: boolean = Boolean(data.hadMoreRows);
  const candidates: Array<DataLineageMapDashboardRow> = data.rows.filter(
    (row: DataLineageMapDashboardRow): boolean => {
      return !data.drawnDashboardIds.has(row.dataDashboardId);
    },
  );

  for (const row of candidates) {
    const tables: Array<string> = Array.from(new Set(row.dataAssetIds)).slice(
      0,
      MAX_DATA_LINEAGE_MAP_TABLES_PER_DASHBOARD,
    );

    if (tables.length === 0) {
      continue;
    }

    const needed: Array<string> = tables.filter((id: string): boolean => {
      return !drawn.has(id);
    });

    if (dashboardRoom <= 0 || needed.length + 1 > nodeRoom) {
      isTruncated = true;
      continue;
    }

    for (const id of needed) {
      drawn.add(id);
      dataAssetIds.add(id);
    }

    nodeRoom -= needed.length + 1;
    dashboardRoom--;
    tableDashboards.push({ ...row, dataAssetIds: tables });
  }

  for (const row of candidates) {
    if (row.dataAssetIds.length > 0) {
      continue;
    }

    const ids: Array<string> = getUpstreamNodeIds(
      getLineageMapUpstreamCards(row.upstream),
    );

    if (ids.length === 0) {
      continue;
    }

    const needed: Array<string> = ids.filter((id: string): boolean => {
      return !drawnUpstream.has(id);
    });

    if (dashboardRoom <= 0 || needed.length + 1 > nodeRoom) {
      isTruncated = true;
      continue;
    }

    for (const id of needed) {
      drawnUpstream.add(id);
    }

    nodeRoom -= needed.length + 1;
    dashboardRoom--;
    upstreamDashboards.push(row);
  }

  return {
    tableDashboards,
    upstreamDashboards,
    dataAssetIds: Array.from(dataAssetIds).sort(),
    isTruncated,
  };
}

function lineageEvidence(
  source: DataAssetLineageSource | null,
): DataLineageMapEvidence {
  if (source === DataAssetLineageSource.QueryHistory) {
    return DataLineageMapEvidence.QueryHistory;
  }

  if (source === DataAssetLineageSource.ViewDefinition) {
    return DataLineageMapEvidence.ViewDefinition;
  }

  return DataLineageMapEvidence.Pipeline;
}

function isFailedRunState(state: string | null | undefined): boolean {
  return state === "FAIL" || state === "ABORT";
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/*
 * The map from what was chosen and read: one card per service, table,
 * pipeline and dashboard, one arrow per pair and kind, every place it was
 * seen together. A flow whose table or pipeline is gone - removed since its
 * row was written - is left out: an arrow to nothing says nothing true.
 */
export function assembleDataLineageMap(data: {
  choice: DataLineageMapChoice;
  tables: Array<DataLineageMapTableRow>;
  pipelines: Array<DataLineageMapPipelineRow>;
  dashboards: Array<DataLineageMapDashboardRow>;
  // The dashboards drawn in the room left (chooseDataLineageMapBiDashboards).
  bi?: DataLineageMapBiChoice | undefined;
  openAlertCounts: Map<string, number>;
  now: Date;
}): DataLineageMap {
  const tables: Map<string, DataLineageMapTableRow> = new Map(
    data.tables.map(
      (table: DataLineageMapTableRow): [string, DataLineageMapTableRow] => {
        return [table.dataAssetId, table];
      },
    ),
  );
  const pipelines: Map<string, DataLineageMapPipelineRow> = new Map(
    data.pipelines.map(
      (
        pipeline: DataLineageMapPipelineRow,
      ): [string, DataLineageMapPipelineRow] => {
        return [pipeline.dataPipelineId, pipeline];
      },
    ),
  );
  const nodes: Map<string, DataLineageMapNode> = new Map();
  const edges: Map<
    string,
    DataLineageMapEdge & { lastSeenTime: number; evidence: Set<string> }
  > = new Map();

  const addTable: (dataAssetId: string) => string | null = (
    dataAssetId: string,
  ): string | null => {
    const table: DataLineageMapTableRow | undefined = tables.get(dataAssetId);

    if (!table) {
      return null;
    }

    const id: string = getLineageMapTableNodeId(dataAssetId);

    if (!nodes.has(id)) {
      const freshness: DataAssetFreshnessResult = getDataAssetFreshness({
        kind: table.assetKind,
        lastChangedAt: table.lastChangedAt,
        updateIntervalInSeconds: table.updateIntervalInSeconds,
        now: data.now,
      });

      nodes.set(id, {
        id,
        kind: DataLineageMapNodeKind.Table,
        name: table.assetKey || table.name || dataAssetId,
        dataAssetId,
        database: table.database,
        assetKind: table.assetKind,
        freshness: freshness.freshness,
        lateBySeconds: freshness.overdueBySeconds,
        isDropped: table.isDropped,
        openAlertCount: data.openAlertCounts.get(dataAssetId) || 0,
      });
    }

    return id;
  };

  const addEdge: (edge: {
    kind: DataLineageMapEdgeKind;
    source: string;
    target: string;
    evidence: DataLineageMapEvidence;
    lastSeenAt: Date | null;
    pipeline?: DataLineageMapPipelineRow | undefined;
    operations?: Array<string> | undefined;
  }) => void = (edge: {
    kind: DataLineageMapEdgeKind;
    source: string;
    target: string;
    evidence: DataLineageMapEvidence;
    lastSeenAt: Date | null;
    pipeline?: DataLineageMapPipelineRow | undefined;
    operations?: Array<string> | undefined;
  }): void => {
    const id: string = getLineageMapEdgeId(edge);
    let kept:
      | (DataLineageMapEdge & { lastSeenTime: number; evidence: Set<string> })
      | undefined = edges.get(id);

    if (!kept) {
      kept = {
        id,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        seenIn: [],
        pipelines: [],
        operations: [],
        lastSeenAt: null,
        lastSeenTime: -1,
        evidence: new Set(),
      };
      edges.set(id, kept);
    }

    if (!kept.evidence.has(edge.evidence)) {
      kept.evidence.add(edge.evidence);
      kept.seenIn.push(edge.evidence);
    }

    if (
      edge.pipeline &&
      !kept.pipelines.some((pipeline: DataLineageMapPipeline): boolean => {
        return pipeline.dataPipelineId === edge.pipeline!.dataPipelineId;
      })
    ) {
      kept.pipelines.push({
        dataPipelineId: edge.pipeline.dataPipelineId,
        name: edge.pipeline.jobName,
        lastRunState: edge.pipeline.lastRunState,
      });
    }

    for (const operation of edge.operations || []) {
      if (
        kept.operations.length < MAX_DATA_LINEAGE_MAP_OPERATIONS &&
        !kept.operations.includes(operation)
      ) {
        kept.operations.push(operation);
      }
    }

    if (edge.lastSeenAt && edge.lastSeenAt.getTime() > kept.lastSeenTime) {
      kept.lastSeenTime = edge.lastSeenAt.getTime();
      kept.lastSeenAt = edge.lastSeenAt.toISOString();
    }
  };

  for (const row of data.choice.lineage) {
    const downstream: string | null = addTable(row.downstreamDataAssetId);

    if (!downstream) {
      continue;
    }

    const pipeline: DataLineageMapPipelineRow | undefined = row.dataPipelineId
      ? pipelines.get(row.dataPipelineId)
      : undefined;

    if (row.upstreamDataAssetId) {
      const upstream: string | null = addTable(row.upstreamDataAssetId);

      if (!upstream || upstream === downstream) {
        continue;
      }

      addEdge({
        kind: DataLineageMapEdgeKind.Feeds,
        source: upstream,
        target: downstream,
        evidence: lineageEvidence(row.source),
        lastSeenAt: row.lastSeenAt,
        pipeline,
      });
      continue;
    }

    if (!pipeline) {
      continue;
    }

    const pipelineNodeId: string = getLineageMapPipelineNodeId(
      pipeline.dataPipelineId,
    );

    if (!nodes.has(pipelineNodeId)) {
      nodes.set(pipelineNodeId, {
        id: pipelineNodeId,
        kind: DataLineageMapNodeKind.Pipeline,
        name: pipeline.jobName || pipeline.dataPipelineId,
        dataPipelineId: pipeline.dataPipelineId,
        jobNamespace: pipeline.jobNamespace,
        lastRunState: pipeline.lastRunState,
      });
    }

    addEdge({
      kind: DataLineageMapEdgeKind.Writes,
      source: pipelineNodeId,
      target: downstream,
      evidence: DataLineageMapEvidence.Pipeline,
      lastSeenAt: row.lastSeenAt,
    });
  }

  for (const row of data.choice.usages) {
    const table: string | null = addTable(row.dataAssetId);

    if (!table) {
      continue;
    }

    const serviceNodeId: string = getLineageMapServiceNodeId(row);

    if (!nodes.has(serviceNodeId)) {
      nodes.set(serviceNodeId, {
        id: serviceNodeId,
        kind: DataLineageMapNodeKind.Service,
        name: row.serviceName.trim() || row.serviceId || "",
        serviceId: row.serviceId,
      });
    }

    const isWrite: boolean = row.accessKind === DataAssetAccessKind.Write;

    addEdge({
      kind: isWrite
        ? DataLineageMapEdgeKind.Writes
        : DataLineageMapEdgeKind.Reads,
      source: isWrite ? serviceNodeId : table,
      target: isWrite ? table : serviceNodeId,
      evidence: DataLineageMapEvidence.Traces,
      lastSeenAt: row.lastSeenAt,
      operations: row.operations,
    });
  }

  let dashboardsDrawn: number = 0;
  let isTruncated: boolean = data.choice.isTruncated;

  for (const dashboard of [...data.dashboards].sort(
    (a: DataLineageMapDashboardRow, b: DataLineageMapDashboardRow): number => {
      return compareText(a.name, b.name);
    },
  )) {
    const tableIds: Array<string> = Array.from(new Set(dashboard.dataAssetIds))
      .filter((id: string): boolean => {
        return nodes.has(getLineageMapTableNodeId(id));
      })
      .sort(compareText);

    if (tableIds.length === 0) {
      continue;
    }

    if (dashboardsDrawn >= data.choice.dashboardRoom) {
      isTruncated = true;
      break;
    }

    const dashboardNodeId: string = getLineageMapDashboardNodeId(
      dashboard.dataDashboardId,
    );

    nodes.set(dashboardNodeId, {
      id: dashboardNodeId,
      kind: DataLineageMapNodeKind.Dashboard,
      name: dashboard.name || dashboard.dataDashboardId,
      dataDashboardId: dashboard.dataDashboardId,
      tool: dashboard.tool,
      url: dashboard.url,
    });
    dashboardsDrawn++;

    for (const tableId of tableIds) {
      addEdge({
        kind: DataLineageMapEdgeKind.Reads,
        source: getLineageMapTableNodeId(tableId),
        target: dashboardNodeId,
        evidence: DataLineageMapEvidence.BiTool,
        lastSeenAt: null,
      });
    }
  }

  const addDashboard: (dashboard: DataLineageMapDashboardRow) => string = (
    dashboard: DataLineageMapDashboardRow,
  ): string => {
    const id: string = getLineageMapDashboardNodeId(dashboard.dataDashboardId);

    nodes.set(id, {
      id,
      kind: DataLineageMapNodeKind.Dashboard,
      name: dashboard.name || dashboard.dataDashboardId,
      dataDashboardId: dashboard.dataDashboardId,
      tool: dashboard.tool,
      url: dashboard.url,
    });

    return id;
  };

  const addSource: (card: {
    nodeId: string;
    source: DataBiSource;
  }) => void = (card: { nodeId: string; source: DataBiSource }): void => {
    if (!nodes.has(card.nodeId)) {
      nodes.set(card.nodeId, {
        id: card.nodeId,
        kind: DataLineageMapNodeKind.Source,
        name: getDataBiSourceName(card.source),
        sourceType: card.source.type,
        isDatabaseSource: isDataBiDatabaseSource(card.source),
      });
    }
  };

  // On watched tables no flow draws: drawn with them.
  for (const dashboard of data.bi?.tableDashboards || []) {
    const tableIds: Array<string> = dashboard.dataAssetIds.filter(
      (id: string): boolean => {
        return addTable(id) !== null;
      },
    );

    if (tableIds.length === 0) {
      continue;
    }

    const dashboardNodeId: string = addDashboard(dashboard);

    for (const tableId of tableIds) {
      addEdge({
        kind: DataLineageMapEdgeKind.Reads,
        source: getLineageMapTableNodeId(tableId),
        target: dashboardNodeId,
        evidence: DataLineageMapEvidence.BiTool,
        lastSeenAt: null,
      });
    }
  }

  // On no watched table: drawn with what its tool says it is built on.
  for (const dashboard of data.bi?.upstreamDashboards || []) {
    const cards: DataLineageMapUpstreamCards = getLineageMapUpstreamCards(
      dashboard.upstream,
    );

    if (cards.datasets.length === 0 && cards.sources.length === 0) {
      continue;
    }

    const dashboardNodeId: string = addDashboard(dashboard);

    for (const entry of cards.datasets) {
      if (!nodes.has(entry.nodeId)) {
        nodes.set(entry.nodeId, {
          id: entry.nodeId,
          kind: DataLineageMapNodeKind.Dataset,
          name: entry.dataset.name,
          tool: dashboard.tool,
          workspace: entry.dataset.workspace,
        });
      }

      addEdge({
        kind: DataLineageMapEdgeKind.Reads,
        source: entry.nodeId,
        target: dashboardNodeId,
        evidence: DataLineageMapEvidence.BiTool,
        lastSeenAt: null,
      });

      for (const source of entry.sources) {
        addSource(source);
        addEdge({
          kind: DataLineageMapEdgeKind.Feeds,
          source: source.nodeId,
          target: entry.nodeId,
          evidence: DataLineageMapEvidence.BiTool,
          lastSeenAt: null,
        });
      }
    }

    for (const source of cards.sources) {
      addSource(source);
      addEdge({
        kind: DataLineageMapEdgeKind.Reads,
        source: source.nodeId,
        target: dashboardNodeId,
        evidence: DataLineageMapEvidence.BiTool,
        lastSeenAt: null,
      });
    }
  }

  if (data.bi?.isTruncated) {
    isTruncated = true;
  }

  // A failed run first on each arrow, as a table's diagram orders them.
  const finished: Array<DataLineageMapEdge> = Array.from(edges.values()).map(
    (
      edge: DataLineageMapEdge & {
        lastSeenTime: number;
        evidence: Set<string>;
      },
    ): DataLineageMapEdge => {
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        seenIn: [...edge.seenIn].sort(
          (a: DataLineageMapEvidence, b: DataLineageMapEvidence): number => {
            return EVIDENCE_ORDER.indexOf(a) - EVIDENCE_ORDER.indexOf(b);
          },
        ),
        pipelines: [...edge.pipelines].sort(
          (a: DataLineageMapPipeline, b: DataLineageMapPipeline): number => {
            return (
              Number(isFailedRunState(b.lastRunState)) -
                Number(isFailedRunState(a.lastRunState)) ||
              compareText(a.name, b.name)
            );
          },
        ),
        operations: edge.operations,
        lastSeenAt: edge.lastSeenAt,
      };
    },
  );

  return {
    nodes: Array.from(nodes.values()).sort(
      (a: DataLineageMapNode, b: DataLineageMapNode): number => {
        return compareText(a.id, b.id);
      },
    ),
    edges: finished.sort(
      (a: DataLineageMapEdge, b: DataLineageMapEdge): number => {
        return compareText(a.id, b.id);
      },
    ),
    isTruncated,
    hiddenTableCount: data.choice.hiddenTableCount,
    isHiddenTableCountAtLeast: data.choice.isHiddenTableCountAtLeast,
  };
}

/*
 * Everything upstream and downstream of a card: the cards its data comes
 * from and the cards it reaches, however many steps away, and the arrows
 * between them. The card itself is in neither side.
 */
export interface DataLineageMapTrace {
  upstream: Set<string>;
  downstream: Set<string>;
  edgeIds: Set<string>;
}

export function traceDataLineageMap(
  map: Pick<DataLineageMap, "edges">,
  nodeId: string,
): DataLineageMapTrace {
  const into: Map<string, Array<DataLineageMapEdge>> = new Map();
  const outOf: Map<string, Array<DataLineageMapEdge>> = new Map();

  for (const edge of map.edges) {
    into.set(edge.target, [...(into.get(edge.target) || []), edge]);
    outOf.set(edge.source, [...(outOf.get(edge.source) || []), edge]);
  }

  const edgeIds: Set<string> = new Set();

  const walk: (
    adjacency: Map<string, Array<DataLineageMapEdge>>,
    next: (edge: DataLineageMapEdge) => string,
  ) => Set<string> = (
    adjacency: Map<string, Array<DataLineageMapEdge>>,
    next: (edge: DataLineageMapEdge) => string,
  ): Set<string> => {
    const seen: Set<string> = new Set([nodeId]);
    const queue: Array<string> = [nodeId];

    while (queue.length > 0) {
      const current: string = queue.shift()!;

      for (const edge of adjacency.get(current) || []) {
        edgeIds.add(edge.id);
        const other: string = next(edge);

        if (!seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }

    seen.delete(nodeId);
    return seen;
  };

  const upstream: Set<string> = walk(into, (edge: DataLineageMapEdge) => {
    return edge.source;
  });
  const downstream: Set<string> = walk(outOf, (edge: DataLineageMapEdge) => {
    return edge.target;
  });

  return { upstream, downstream, edgeIds };
}

// Whether an arrow's data moved by a pipeline whose latest run failed.
export function hasFailedLineageMapPipeline(edge: DataLineageMapEdge): boolean {
  return edge.pipelines.some((pipeline: DataLineageMapPipeline): boolean => {
    return isFailedRunState(pipeline.lastRunState);
  });
}

// Whether a card is in trouble: a table late or with an open alert, a pipeline whose latest run failed.
export function isLineageMapNodeInTrouble(node: DataLineageMapNode): boolean {
  if (node.kind === DataLineageMapNodeKind.Table) {
    return (
      !node.isDropped &&
      ((node.openAlertCount || 0) > 0 ||
        node.freshness === DataAssetFreshness.Late)
    );
  }

  if (node.kind === DataLineageMapNodeKind.Pipeline) {
    return isFailedRunState(node.lastRunState);
  }

  return false;
}
