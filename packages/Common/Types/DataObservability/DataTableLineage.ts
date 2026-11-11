import { DataAssetFreshness } from "./DataAssetFreshness";
import DataAssetKind from "./DataAssetKind";
import DataAssetLineageSource from "./DataAssetLineageSource";
import { DataColumnMapping } from "./DataColumnLineage";

/*
 * A TABLE'S LINEAGE AS ONE DRAWING: WHERE ITS DATA COMES FROM AND WHERE IT
 * GOES, SEVERAL STEPS EACH WAY.
 *
 * A table's Lineage tab lists the tables next to it, one step each way. The
 * questions people bring are longer than one step: a late table is most
 * often late because of a table or a pipeline three steps up, and a change
 * to a source table reaches the tables and dashboards three steps down. So
 * the lineage graph (Server/Utils/DataObservability/DataTableLineage) walks
 * the lineage edges (DataAssetLineage) from the table both ways, up to a
 * number of steps, and hands back what the diagram draws:
 *
 *  - the table itself, the tables it is built from (upstream) and the
 *    tables built from it (downstream), each with how it is now: its
 *    freshness, the open alerts its reader may see, whether it was dropped;
 *  - the pipelines that write a table from data OneUptime does not watch
 *    (a Fivetran sync, an export from an API), drawn where that data comes
 *    in; a pipeline that moves data from one watched table to another is
 *    told on that edge instead;
 *  - the BI dashboards (and reverse ETL syncs) built on the table and on the
 *    tables built from it: who sees bad data first.
 *
 * A drawing past a few dozen cards is read by nobody, so each table shows
 * its nearest neighbours each way, problems first, and says how many more
 * there are (hiddenUpstreamCount, hiddenDownstreamCount): pressing that
 * count draws the next of them where they are (DataLineageExpansion), and
 * opening that table centers the drawing on it.
 *
 * Asked for with its columns (withColumns), each arrow between two tables
 * also says which columns of one feed which of the other, where its sources
 * name them, so the diagram can follow one column up and down.
 */

export enum DataLineageNodeKind {
  Table = "Table",
  Pipeline = "Pipeline",
  Dashboard = "Dashboard",
}

// Where a card sits from the table the drawing is about.
export enum DataLineageSide {
  Upstream = "Upstream",
  Focus = "Focus",
  Downstream = "Downstream",
}

export enum DataLineageEdgeKind {
  // One table is built from another.
  Feeds = "Feeds",
  // A pipeline writes a table from data OneUptime does not watch.
  Writes = "Writes",
  // A dashboard or a reverse ETL sync reads a table.
  Reads = "Reads",
}

// The steps each way a drawing shows unless asked for another number.
export const DEFAULT_DATA_LINEAGE_DEPTH: number = 3;

// A pipeline's drawing: the tables it reads and the tables it writes, unless asked for more.
export const DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH: number = 1;

// The most steps each way one drawing walks: the depth a data alert's cause is looked for at.
export const MAX_DATA_LINEAGE_DEPTH: number = 5;

// The choices the Lineage tab offers.
export const DATA_LINEAGE_DEPTH_CHOICES: ReadonlyArray<number> = [1, 2, 3, 5];

// The most tables drawn next to one table, each way; the rest are counted.
export const MAX_DATA_LINEAGE_NEIGHBORS: number = 10;

// The most tables drawn on each side of the table.
export const MAX_DATA_LINEAGE_TABLES_PER_SIDE: number = 120;

// The most pipelines drawn writing one table from outside.
export const MAX_DATA_LINEAGE_PIPELINES_PER_TABLE: number = 5;

// The most dashboards drawn; the rest are counted (hiddenDashboardCount).
export const MAX_DATA_LINEAGE_DASHBOARDS: number = 25;

// The longest pipeline error a card carries: the pipeline's page has all of it.
export const MAX_DATA_LINEAGE_ERROR_LENGTH: number = 500;

/*
 * The most column pairs one answer carries, the arrows nearest the drawing's
 * own card first; an arrow past them carries none, as one whose sources name
 * no columns. Each arrow carries at most MAX_COLUMN_MAPPINGS_PER_EDGE, as
 * kept.
 */
export const MAX_DATA_LINEAGE_COLUMN_MAPPINGS: number = 10000;

export interface DataTableLineagePipeline {
  dataPipelineId: string;
  name: string;
  // OpenLineage's: COMPLETE, FAIL, ABORT, START, RUNNING, RESCHEDULED; null before any run.
  lastRunState: string | null;
}

export interface DataTableLineageNode {
  // "table:<id>", "pipeline:<id>" or "dashboard:<id>": one card each.
  id: string;
  kind: DataLineageNodeKind;
  side: DataLineageSide;
  /*
   * How many steps from the table the drawing is about: negative upstream,
   * 0 for the table itself, positive downstream - the fewest steps it was
   * reached by. A pipeline is one step before the first table it writes, a
   * dashboard one step after the last table it reads.
   */
  depth: number;
  // A table's schema.table key, a pipeline's job name, a dashboard's name.
  name: string;

  // A table's.
  dataAssetId?: string | undefined;
  database?: string | null | undefined;
  assetKind?: DataAssetKind | null | undefined;
  freshness?: DataAssetFreshness | undefined;
  // How long it has been late; 0 when it is not.
  lateBySeconds?: number | undefined;
  isDropped?: boolean | undefined;
  // Its open alerts that the drawing's reader may see.
  openAlertCount?: number | undefined;
  // Tables next to it that are not drawn: further than the steps asked for, or past the most drawn per table.
  hiddenUpstreamCount?: number | undefined;
  hiddenDownstreamCount?: number | undefined;

  // A pipeline's.
  dataPipelineId?: string | undefined;
  jobNamespace?: string | null | undefined;
  lastRunState?: string | null | undefined;
  lastRunStartedAt?: string | null | undefined;
  lastErrorMessage?: string | null | undefined;

  // A dashboard's.
  dataDashboardId?: string | undefined;
  tool?: string | null | undefined;
  url?: string | null | undefined;
}

export interface DataTableLineageEdge {
  // "<kind>:<source node id>><target node id>": one arrow each.
  id: string;
  source: string;
  target: string;
  kind: DataLineageEdgeKind;
  // Every source that saw a Feeds edge: a pipeline's run, query history, a view's definition.
  seenIn: Array<DataAssetLineageSource>;
  // The pipelines that move data along it, a failed run first.
  pipelines: Array<DataTableLineagePipeline>;
  // ISO time it was last seen; null for a dashboard's read.
  lastSeenAt: string | null;
  /*
   * Which columns of the upstream table feed which columns of the
   * downstream one, every source's together: only on an arrow between two
   * tables of a drawing asked for with its columns (withColumns), and only
   * when a source named them (Snowflake's access history, OpenLineage's
   * column lineage). An arrow without them says nothing of its columns.
   */
  columnMappings?: Array<DataColumnMapping> | undefined;
}

/*
 * What a drawing picks out on a data alert's page: the way from the alert's
 * table or pipeline up to the alert it is a consequence of, and down to
 * each alert it caused (Server/Utils/DataObservability/DataAlertLineage).
 * Only alerts its reader may see are on it, and none is named.
 */
export interface DataLineageHighlight {
  // Every card along the ways, the drawing's own among them.
  nodeIds: Array<string>;
  // Every arrow along them.
  edgeIds: Array<string>;
  // Where the way up ends: the card of the cause's table, or of its pipeline.
  causeNodeIds: Array<string>;
  // Where the ways down end: the cards of the tables of the alerts it caused.
  consequenceNodeIds: Array<string>;
  // A cause or consequence that is a pipeline drawn only on arrows: named on its arrows along the way.
  dataPipelineIds: Array<string>;
}

export interface DataTableLineage {
  /*
   * The card the drawing is about: a table ("table:<id>"), or a pipeline
   * ("pipeline:<id>"), whose tables read are upstream and tables written
   * downstream.
   */
  focusNodeId: string;
  // The steps each way this drawing walked: the more of the two, when an alert's ways reach further one way.
  depth: number;
  nodes: Array<DataTableLineageNode>;
  edges: Array<DataTableLineageEdge>;
  // Dashboards built on the drawn tables that are not drawn.
  hiddenDashboardCount: number;
  /*
   * More lineage than one drawing holds: a side reached its most tables, or
   * a table had more edges than were read. What is drawn is still true; the
   * counts of tables not drawn are then at least what they say.
   */
  isTruncated: boolean;
  // On a data alert's page: the ways to its cause and to the alerts it caused.
  highlight?: DataLineageHighlight | undefined;
}

export interface DataTableLineageRequest {
  dataAssetId: string;
  depth?: number | undefined;
  // Each arrow between two tables with the columns it carries (columnMappings): off unless asked for, so the answer stays small.
  withColumns?: boolean | undefined;
}

export interface DataPipelineLineageRequest {
  dataPipelineId: string;
  depth?: number | undefined;
}

/*
 * A data alert's lineage: what its table or pipeline is built from and what
 * is built from it, with the way to the alert that caused it and to each
 * alert it caused highlighted. Every alert counted here is one its reader
 * may see: a reader who may not see an alert's cause is not shown the
 * alert's data at all.
 */
export interface DataAlertLineageAnswer {
  // Null for an alert about a whole database: there is no table or pipeline to draw.
  lineage: DataTableLineage | null;
  // A consequence of an alert upstream.
  hasCause: boolean;
  // Whether the way to that alert is drawn: not when it is about a whole database, or further up than a drawing walks.
  isCauseDrawn: boolean;
  // The alerts it caused, and how many of them the drawing reaches.
  consequenceCount: number;
  drawnConsequenceCount: number;
}

export function getLineageTableNodeId(dataAssetId: string): string {
  return `table:${dataAssetId}`;
}

export function getLineagePipelineNodeId(dataPipelineId: string): string {
  return `pipeline:${dataPipelineId}`;
}

export function getLineageDashboardNodeId(dataDashboardId: string): string {
  return `dashboard:${dataDashboardId}`;
}

// Whether a card is a pipeline's: on a pipeline's own drawing, the card it is about.
export function isLineagePipelineNodeId(nodeId: string): boolean {
  return nodeId.startsWith("pipeline:");
}

export function getLineageEdgeId(data: {
  kind: DataLineageEdgeKind;
  source: string;
  target: string;
}): string {
  return `${data.kind}:${data.source}>${data.target}`;
}

/*
 * The steps each way a request asks for: a whole number from 1 to the most,
 * the default when it names none or one that cannot be read (a table's
 * three, unless another is given: a pipeline's one). A number past the most
 * is the most, so a request for "all of it" draws what can be.
 */
export function readDataLineageDepth(
  value: unknown,
  fallback: number = DEFAULT_DATA_LINEAGE_DEPTH,
): number {
  const number: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(MAX_DATA_LINEAGE_DEPTH, Math.max(1, Math.floor(number)));
}

// Whether a pipeline's latest run went wrong: it failed, or it was aborted.
export function isFailedLineageRunState(
  state: string | null | undefined,
): boolean {
  return state === "FAIL" || state === "ABORT";
}

// Whether a pipeline is running now.
export function isRunningLineageRunState(
  state: string | null | undefined,
): boolean {
  return state === "START" || state === "RUNNING";
}
