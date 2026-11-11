import Alert from "../../../Models/DatabaseModels/Alert";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../Models/DatabaseModels/DataAssetLineage";
import DataDashboard from "../../../Models/DatabaseModels/DataDashboard";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  DataAssetFreshness,
  DataAssetFreshnessResult,
  getDataAssetFreshness,
} from "../../../Types/DataObservability/DataAssetFreshness";
import DataAssetKind, {
  isDataAssetKind,
} from "../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource, {
  isDataAssetLineageSource,
} from "../../../Types/DataObservability/DataAssetLineageSource";
import {
  DataColumnMapping,
  mergeColumnMappings,
} from "../../../Types/DataObservability/DataColumnLineage";
import {
  DataLineageExpandRequest,
  DataLineageExpansion,
  readLineageCardId,
} from "../../../Types/DataObservability/DataLineageExpansion";
import {
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  DataTableLineagePipeline,
  MAX_DATA_LINEAGE_COLUMN_MAPPINGS,
  MAX_DATA_LINEAGE_DASHBOARDS,
  MAX_DATA_LINEAGE_DEPTH,
  MAX_DATA_LINEAGE_ERROR_LENGTH,
  MAX_DATA_LINEAGE_NEIGHBORS,
  MAX_DATA_LINEAGE_PIPELINES_PER_TABLE,
  MAX_DATA_LINEAGE_TABLES_PER_SIDE,
  getLineageDashboardNodeId,
  getLineageEdgeId,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
  isFailedLineageRunState,
} from "../../../Types/DataObservability/DataTableLineage";
import ObjectID from "../../../Types/ObjectID";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import DataAlertService from "../../Services/DataAlertService";
import DataAssetLineageService from "../../Services/DataAssetLineageService";
import DataAssetService from "../../Services/DataAssetService";
import DataDashboardService from "../../Services/DataDashboardService";
import DataPipelineService from "../../Services/DataPipelineService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import { applyAlertSelfPrivacyFilter } from "../Alert/AlertPrivacyFilter";

/*
 * A TABLE'S LINEAGE GRAPH, SEVERAL STEPS EACH WAY (Types/DataObservability/
 * DataTableLineage says what it is for and what it holds).
 *
 * The walk goes one step at a time from the table, upstream first and then
 * downstream, reading the lineage edges of every table one step out in one
 * read (DataLineageReader.readEdges). At each step each table keeps its
 * nearest neighbours that way, at most MAX_DATA_LINEAGE_NEIGHBORS, problems
 * first: a table that is late, or an edge whose pipeline's latest run
 * failed, is what someone opening the drawing is looking for. The rest are
 * counted on the table, not drawn. One step past the steps asked for is
 * read too, only to count what lies beyond each table at the edge of the
 * drawing.
 *
 * A table reached on both sides - a cycle through the table, which query
 * history can show - keeps the side it was reached on first (upstream),
 * and the edges both ways are drawn.
 *
 * Every read is the project's own (projectId on every query), as OneUptime:
 * the route lets in only those who may read data assets, who may read every
 * table, pipeline and dashboard of the project. A table's open alerts are
 * counted with the privacy clause of the drawing's reader, as the table's
 * own answer counts them (DataTableAnswer): a private alert its reader may
 * not see is never counted.
 *
 * A pipeline's drawing (buildForPipeline) has the pipeline in the middle:
 * the tables it reads on the left, the tables it writes on the right - its
 * nearest, problems first, the rest counted on its card - and from each of
 * them the same walk, a step further out. A data alert's drawing
 * (DataAlertLineage) pins the tables along the ways to its cause and to the
 * alerts it caused, so they are drawn whatever else is.
 *
 * A card's count of tables not drawn can be pressed (expand): the walk then
 * takes one more step from that card alone, with every table already drawn
 * placed before it starts, so it chooses the next of its neighbours as it
 * chose the first - the nearest not drawn, problems first - counts what
 * lies beyond them, and draws every arrow between them and what is drawn.
 *
 * Asked for with its columns, each arrow between two tables carries the
 * columns it moves (columnMappings), read in a read of their own after the
 * walk, so a drawing not asked for them reads nothing more.
 */

// The most lineage edges read at one step on one side.
export const MAX_DATA_LINEAGE_EDGE_ROWS: number = 5000;

// The most ids one read names.
const READ_CHUNK: number = 500;

// The most data alerts read to count a drawing's open alerts.
const MAX_DATA_ALERT_ROWS: number = 5000;

// The most arrows whose columns one read asks for.
const COLUMN_READ_CHUNK: number = 100;

// How a table's card id starts (getLineageTableNodeId).
const TABLE_NODE_PREFIX: string = "table:";

export enum DataLineageDirection {
  Upstream = "Upstream",
  Downstream = "Downstream",
}

// One row of DataAssetLineage, as the walk reads it.
export interface DataLineageEdgeRow {
  // Null: a pipeline writes the downstream table, whatever it reads.
  upstreamDataAssetId: string | null;
  downstreamDataAssetId: string;
  dataPipelineId: string | null;
  // Null is a pipeline's run, as the column says.
  source: DataAssetLineageSource | null;
  lastSeenAt: Date | null;
}

export interface DataLineageTableRow {
  dataAssetId: string;
  assetKey: string;
  name: string | null;
  database: string | null;
  assetKind: DataAssetKind | null;
  lastChangedAt: Date | null;
  updateIntervalInSeconds: number | null;
  isDropped: boolean;
}

export interface DataLineagePipelineRow {
  dataPipelineId: string;
  jobName: string;
  jobNamespace: string | null;
  lastRunState: string | null;
  lastRunStartedAt: Date | null;
  lastErrorMessage: string | null;
}

export interface DataLineageDashboardRow {
  dataDashboardId: string;
  name: string;
  tool: string | null;
  url: string | null;
  // The tables it reads, of those it was asked about and those drawn already.
  dataAssetIds: Array<string>;
}

// An arrow between two tables, as its columns are asked for.
export interface DataLineageTablePair {
  upstreamDataAssetId: string;
  downstreamDataAssetId: string;
}

// How the columns of an arrow are looked up: "<upstream id>><downstream id>".
export function getLineageTablePairKey(pair: DataLineageTablePair): string {
  return `${pair.upstreamDataAssetId}>${pair.downstreamDataAssetId}`;
}

// Where the walk reads from: the database, or a test's tables in memory.
export interface DataLineageReader {
  // Upstream: the edges into these tables (writes rows too). Downstream: the edges out of them.
  readEdges(data: {
    direction: DataLineageDirection;
    dataAssetIds: Array<string>;
    limit: number;
  }): Promise<Array<DataLineageEdgeRow>>;
  readTables(dataAssetIds: Array<string>): Promise<Array<DataLineageTableRow>>;
  readPipelines(
    dataPipelineIds: Array<string>,
  ): Promise<Array<DataLineagePipelineRow>>;
  // By table, how many of its alerts are open, of those the drawing's reader may see.
  readOpenAlertCounts(
    dataAssetIds: Array<string>,
  ): Promise<Map<string, number>>;
  // The dashboards reading any of these tables, by name, and how many there are in all.
  readDashboards(data: {
    dataAssetIds: Array<string>;
    limit: number;
    // Tables drawn already: each dashboard also says which of them it reads, though it is not looked up by them.
    drawnDataAssetIds?: Array<string> | undefined;
  }): Promise<{ dashboards: Array<DataLineageDashboardRow>; total: number }>;
  /*
   * The columns each of these arrows carries, every row's together
   * (mergeColumnMappings), by getLineageTablePairKey: an arrow no source
   * named columns on is not in it.
   */
  readColumnMappings(
    pairs: Array<DataLineageTablePair>,
  ): Promise<Map<string, Array<DataColumnMapping>>>;
}

// What a pipeline's drawing reads besides: the rows that name the pipeline.
export interface DataPipelineLineageReader extends DataLineageReader {
  // Its rows, the newest first: each table it wrote, and what it read to write it.
  readPipelineEdges(data: {
    dataPipelineId: string;
    limit: number;
  }): Promise<Array<DataLineageEdgeRow>>;
}

/*
 * What a drawing draws whatever else it does: the ways to a data alert's
 * cause and to the alerts it caused (DataAlertLineage). A pinned table is
 * chosen first at its step, past the most per table; a pinned pipeline is
 * drawn writing its table from outside, past the most per table. A side
 * still holds no more than its most tables.
 */
export interface DataLineagePins {
  dataAssetIds: Set<string>;
  dataPipelineIds: Set<string>;
}

// The tables a pipeline reads and writes, with when each was last seen.
export interface DataPipelineTables {
  // What it reads and does not write: a table it reads and writes is drawn where it writes.
  read: Map<string, Date | null>;
  written: Map<string, Date | null>;
  // It had more rows than were read.
  isTruncated: boolean;
}

const NO_PINS: DataLineagePins = {
  dataAssetIds: new Set(),
  dataPipelineIds: new Set(),
};

// An edge between two tables, every row of it together.
interface FeedsEdge {
  upstreamDataAssetId: string;
  downstreamDataAssetId: string;
  seenIn: Set<DataAssetLineageSource>;
  pipelineIds: Set<string>;
  lastSeenAt: Date | null;
}

// Where a drawn table sits.
interface PlacedTable {
  side: DataLineageSide;
  // Steps from the table the drawing is about: negative upstream.
  depth: number;
}

// A pipeline that writes a table, from the table's writes rows.
interface Writer {
  dataPipelineId: string;
  lastSeenAt: Date | null;
}

// A table one step out, with what decides whether it is drawn first.
interface RankedNeighbour {
  id: string;
  hasProblem: boolean;
  isDropped: boolean;
  seen: number;
  key: string;
}

// A pipeline that writes a drawn table from outside what OneUptime watches.
interface OutsideWriter {
  pipeline: DataLineagePipelineRow;
  writer: Writer;
}

// What both walks build together.
interface WalkState {
  tables: Map<string, DataLineageTableRow>;
  pipelines: Map<string, DataLineagePipelineRow>;
  // Every drawn table, in the order it was placed: the table, upstream, downstream.
  placed: Map<string, PlacedTable>;
  edges: Map<string, FeedsEdge>;
  // By drawn table, its neighbours that way that are not drawn, with the edge to each.
  hiddenUpstream: Map<string, Map<string, FeedsEdge>>;
  hiddenDownstream: Map<string, Map<string, FeedsEdge>>;
  // By table: the pipelines whose writes rows name it.
  writers: Map<string, Map<string, Writer>>;
  // By table: the pipelines on an edge into it from a watched table.
  feedingPipelines: Map<string, Set<string>>;
  isTruncated: boolean;
}

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) {
    return b;
  }

  if (!b) {
    return a;
  }

  return a.getTime() >= b.getTime() ? a : b;
}

function chunked<T>(items: Array<T>, size: number): Array<Array<T>> {
  const chunks: Array<Array<T>> = [];

  for (let start: number = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }

  return chunks;
}

function addTo(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  const set: Set<string> = map.get(key) || new Set();
  set.add(value);
  map.set(key, set);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toTime(value: Date | null): number {
  return value ? value.getTime() : 0;
}

// Steps one way: a whole number from one to the most.
function clampDepth(depth: number): number {
  return Math.min(
    MAX_DATA_LINEAGE_DEPTH,
    Math.max(1, Math.floor(Number.isFinite(depth) ? depth : 1)),
  );
}

function newWalkState(): WalkState {
  return {
    tables: new Map(),
    pipelines: new Map(),
    placed: new Map(),
    edges: new Map(),
    hiddenUpstream: new Map(),
    hiddenDownstream: new Map(),
    writers: new Map(),
    feedingPipelines: new Map(),
    isTruncated: false,
  };
}

function toEdgeRow(edge: DataAssetLineage): DataLineageEdgeRow {
  return {
    upstreamDataAssetId: edge.upstreamDataAssetId?.toString() || null,
    downstreamDataAssetId: edge.downstreamDataAssetId!.toString(),
    dataPipelineId: edge.dataPipelineId?.toString() || null,
    source: isDataAssetLineageSource(edge.source) ? edge.source : null,
    lastSeenAt: readDate(edge.lastSeenAt),
  };
}

function readDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(String(value));

  return isNaN(date.getTime()) ? null : date;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function clip(value: string | null, length: number): string | null {
  if (!value) {
    return null;
  }

  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

export default class DataTableLineageReader {
  /*
   * The table's lineage, for its reader: the props of the person who asked,
   * whose privacy clause counts the open alerts. Null when the table is not
   * one of the project's.
   */
  public static async read(data: {
    projectId: ObjectID;
    dataAssetId: ObjectID;
    depth: number;
    now: Date;
    reader: DatabaseCommonInteractionProps | null;
    // Each arrow between two tables with the columns it carries.
    withColumns?: boolean | undefined;
  }): Promise<DataTableLineage | null> {
    return await this.build({
      focusDataAssetId: data.dataAssetId.toString(),
      depth: data.depth,
      now: data.now,
      reader: this.getDatabaseReader(data.projectId, data.reader),
      withColumns: data.withColumns,
    });
  }

  /*
   * The next tables a card does not draw, for its reader: whose privacy
   * clause counts their open alerts, as the drawing's own were counted.
   * Null when the card's table, or the drawing's pipeline, is not one of
   * the project's.
   */
  public static async expand(data: {
    projectId: ObjectID;
    request: DataLineageExpandRequest;
    now: Date;
    reader: DatabaseCommonInteractionProps | null;
  }): Promise<DataLineageExpansion | null> {
    return await this.buildExpansion({
      request: data.request,
      now: data.now,
      reader: this.getDatabaseReader(data.projectId, data.reader),
    });
  }

  /*
   * A pipeline's lineage, for its reader: the tables it reads and writes,
   * and the steps beyond them. Null when the pipeline is not one of the
   * project's.
   */
  public static async readPipeline(data: {
    projectId: ObjectID;
    dataPipelineId: ObjectID;
    depth: number;
    now: Date;
    reader: DatabaseCommonInteractionProps | null;
  }): Promise<DataTableLineage | null> {
    return await this.buildForPipeline({
      focusDataPipelineId: data.dataPipelineId.toString(),
      depth: data.depth,
      now: data.now,
      reader: this.getDatabaseReader(data.projectId, data.reader),
    });
  }

  // The graph, from any reader: the walk itself.
  public static async build(data: {
    focusDataAssetId: string;
    depth: number;
    now: Date;
    reader: DataLineageReader;
    // Steps up and down when they differ: an alert's drawing reaching its cause.
    upstreamDepth?: number | undefined;
    downstreamDepth?: number | undefined;
    pins?: DataLineagePins | undefined;
    withColumns?: boolean | undefined;
  }): Promise<DataTableLineage | null> {
    const depth: number = clampDepth(data.depth);
    const upstreamDepth: number = clampDepth(data.upstreamDepth ?? depth);
    const downstreamDepth: number = clampDepth(data.downstreamDepth ?? depth);
    const pins: DataLineagePins = data.pins || NO_PINS;
    const focusId: string = data.focusDataAssetId;
    const state: WalkState = newWalkState();

    await this.readMissingTables(data.reader, state, [focusId]);

    if (!state.tables.has(focusId)) {
      return null;
    }

    state.placed.set(focusId, { side: DataLineageSide.Focus, depth: 0 });

    await this.walk({
      direction: DataLineageDirection.Upstream,
      frontier: [focusId],
      firstStep: 1,
      depth: upstreamDepth,
      placedOnSide: 0,
      pins: pins.dataAssetIds,
      now: data.now,
      reader: data.reader,
      state,
    });
    await this.walk({
      direction: DataLineageDirection.Downstream,
      frontier: [focusId],
      firstStep: 1,
      depth: downstreamDepth,
      placedOnSide: 0,
      pins: pins.dataAssetIds,
      now: data.now,
      reader: data.reader,
      state,
    });

    const lineage: DataTableLineage = await this.finish({
      state,
      focusNodeId: getLineageTableNodeId(focusId),
      depth: Math.max(upstreamDepth, downstreamDepth),
      now: data.now,
      reader: data.reader,
      pins,
      focusNode: null,
      focusEdges: [],
      focusPipelineId: null,
    });

    if (data.withColumns) {
      const depths: Map<string, number> = new Map();

      for (const node of lineage.nodes) {
        depths.set(node.id, node.depth);
      }

      await this.addColumnMappings({
        reader: data.reader,
        edges: lineage.edges,
        depths,
      });
    }

    return lineage;
  }

  /*
   * A pipeline's graph: the pipeline in the middle, the tables it reads on
   * the left and the tables it writes on the right - its nearest each way,
   * problems first, the rest counted on its card - then from those tables
   * the walk goes on as it does from a table, the pipeline one step in.
   */
  public static async buildForPipeline(data: {
    focusDataPipelineId: string;
    depth: number;
    now: Date;
    reader: DataPipelineLineageReader;
    upstreamDepth?: number | undefined;
    downstreamDepth?: number | undefined;
    pins?: DataLineagePins | undefined;
    // The tables it reads and writes, when the caller has read them already (readPipelineTables).
    tables?: DataPipelineTables | undefined;
  }): Promise<DataTableLineage | null> {
    const depth: number = clampDepth(data.depth);
    const upstreamDepth: number = clampDepth(data.upstreamDepth ?? depth);
    const downstreamDepth: number = clampDepth(data.downstreamDepth ?? depth);
    const pins: DataLineagePins = data.pins || NO_PINS;
    const pipelineId: string = data.focusDataPipelineId;
    const state: WalkState = newWalkState();

    await this.readMissingPipelines(data.reader, state, [pipelineId]);

    const focus: DataLineagePipelineRow | undefined =
      state.pipelines.get(pipelineId);

    if (!focus) {
      return null;
    }

    const tables: DataPipelineTables =
      data.tables || (await this.readPipelineTables(data.reader, pipelineId));

    if (tables.isTruncated) {
      state.isTruncated = true;
    }

    await this.readMissingTables(data.reader, state, [
      ...tables.read.keys(),
      ...tables.written.keys(),
    ]);

    const reads: { chosen: Array<string>; hidden: number } =
      this.choosePipelineTables({
        state,
        seen: tables.read,
        pins: pins.dataAssetIds,
        now: data.now,
      });
    const writes: { chosen: Array<string>; hidden: number } =
      this.choosePipelineTables({
        state,
        seen: tables.written,
        pins: pins.dataAssetIds,
        now: data.now,
      });

    for (const id of reads.chosen) {
      state.placed.set(id, { side: DataLineageSide.Upstream, depth: -1 });
    }

    for (const id of writes.chosen) {
      state.placed.set(id, { side: DataLineageSide.Downstream, depth: 1 });
    }

    const focusNodeId: string = getLineagePipelineNodeId(pipelineId);
    const focusEdges: Array<DataTableLineageEdge> = [];

    for (const id of reads.chosen) {
      focusEdges.push(
        this.pipelineTableEdge({
          pipeline: focus,
          dataAssetId: id,
          isRead: true,
          lastSeenAt: tables.read.get(id) || null,
        }),
      );
    }

    for (const id of writes.chosen) {
      focusEdges.push(
        this.pipelineTableEdge({
          pipeline: focus,
          dataAssetId: id,
          isRead: false,
          lastSeenAt: tables.written.get(id) || null,
        }),
      );
    }

    await this.walk({
      direction: DataLineageDirection.Upstream,
      frontier: reads.chosen,
      firstStep: 2,
      depth: upstreamDepth,
      placedOnSide: reads.chosen.length,
      pins: pins.dataAssetIds,
      now: data.now,
      reader: data.reader,
      state,
    });
    await this.walk({
      direction: DataLineageDirection.Downstream,
      frontier: writes.chosen,
      firstStep: 2,
      depth: downstreamDepth,
      placedOnSide: writes.chosen.length,
      pins: pins.dataAssetIds,
      now: data.now,
      reader: data.reader,
      state,
    });

    return await this.finish({
      state,
      focusNodeId,
      depth: Math.max(upstreamDepth, downstreamDepth),
      now: data.now,
      reader: data.reader,
      pins,
      focusNode: {
        ...this.pipelineNode(focus, DataLineageSide.Focus, 0),
        hiddenUpstreamCount: reads.hidden,
        hiddenDownstreamCount: writes.hidden,
      },
      focusEdges,
      focusPipelineId: pipelineId,
    });
  }

  /*
   * The next tables a card does not draw (DataLineageExpansion), from any
   * reader. Every table the request names as drawn is placed before the
   * walk starts, so none is drawn twice and the arrows to them are drawn;
   * then the walk takes one step from the card alone - its nearest not
   * drawn, problems first, at most the most per card and what its side has
   * room for - and a step past them, to count what lies beyond each. A
   * pipeline's own card chooses from the tables it reads, or writes, as
   * its drawing chose its first. Null when the card's table, or the
   * drawing's pipeline, is not one of the project's.
   */
  public static async buildExpansion(data: {
    request: DataLineageExpandRequest;
    now: Date;
    reader: DataPipelineLineageReader;
  }): Promise<DataLineageExpansion | null> {
    const request: DataLineageExpandRequest = data.request;
    const focus: { kind: "table" | "pipeline"; id: string } | null =
      readLineageCardId(request.focusNodeId);
    const card: { kind: "table" | "pipeline"; id: string } | null =
      readLineageCardId(request.nodeId);

    if (!focus || !card) {
      return null;
    }

    const isUpstream: boolean = request.side === DataLineageSide.Upstream;
    const direction: DataLineageDirection = isUpstream
      ? DataLineageDirection.Upstream
      : DataLineageDirection.Downstream;
    const side: DataLineageSide = isUpstream
      ? DataLineageSide.Upstream
      : DataLineageSide.Downstream;
    const focusPipelineId: string | null =
      focus.kind === "pipeline" ? focus.id : null;
    const state: WalkState = newWalkState();

    // What is drawn already: never drawn again, and the arrows to it are.
    for (const table of request.tables) {
      state.placed.set(table.dataAssetId, {
        side: table.side,
        depth: table.depth,
      });
    }

    const drawnIds: Set<string> = new Set(state.placed.keys());
    const placedOnSide: number = request.tables.filter(
      (table: { side: DataLineageSide }): boolean => {
        return table.side === side;
      },
    ).length;
    const ownEdges: Array<DataTableLineageEdge> = [];
    let hiddenCount: number = 0;

    if (card.kind === "pipeline") {
      // The drawing's own pipeline: the next tables it reads, or writes.
      await this.readMissingPipelines(data.reader, state, [card.id]);

      const pipeline: DataLineagePipelineRow | undefined =
        state.pipelines.get(card.id);

      if (!pipeline) {
        return null;
      }

      const tables: DataPipelineTables = await this.readPipelineTables(
        data.reader,
        card.id,
      );

      if (tables.isTruncated) {
        state.isTruncated = true;
      }

      const seen: Map<string, Date | null> = isUpstream
        ? tables.read
        : tables.written;
      const notDrawn: Map<string, Date | null> = new Map();

      for (const [id, lastSeenAt] of seen) {
        if (!drawnIds.has(id)) {
          notDrawn.set(id, lastSeenAt);
        }
      }

      await this.readMissingTables(data.reader, state, [...notDrawn.keys()]);

      const choice: { chosen: Array<string>; hidden: number } =
        this.choosePipelineTables({
          state,
          seen: notDrawn,
          pins: new Set(),
          now: data.now,
          most: Math.max(0, MAX_DATA_LINEAGE_TABLES_PER_SIDE - placedOnSide),
        });

      // Its side had no room for as many as it would draw.
      if (
        choice.chosen.length <
        Math.min(
          MAX_DATA_LINEAGE_NEIGHBORS,
          choice.chosen.length + choice.hidden,
        )
      ) {
        state.isTruncated = true;
      }

      hiddenCount = choice.hidden;

      for (const id of choice.chosen) {
        state.placed.set(id, { side, depth: isUpstream ? -1 : 1 });
      }

      /*
       * Its arrows to the tables drawn now, and to those it reads (or
       * writes) that are drawn on that side already, reached through
       * another table: no longer counted on its card, so joined to it.
       */
      for (const [id, lastSeenAt] of seen) {
        if (state.placed.get(id)?.side === side) {
          ownEdges.push(
            this.pipelineTableEdge({
              pipeline,
              dataAssetId: id,
              isRead: isUpstream,
              lastSeenAt,
            }),
          );
        }
      }

      // What lies beyond the tables drawn now, counted.
      await this.walk({
        direction,
        frontier: choice.chosen,
        firstStep: 2,
        depth: 1,
        placedOnSide: placedOnSide + choice.chosen.length,
        pins: new Set(),
        now: data.now,
        reader: data.reader,
        state,
      });
    } else {
      await this.readMissingTables(data.reader, state, [card.id]);

      const placed: PlacedTable | undefined = state.placed.get(card.id);

      if (!state.tables.has(card.id) || !placed) {
        return null;
      }

      // One step out from the card, then one past it to count what lies beyond.
      const step: number = Math.abs(placed.depth) + 1;

      await this.walk({
        direction,
        frontier: [card.id],
        firstStep: step,
        depth: step,
        placedOnSide,
        pins: new Set(),
        now: data.now,
        reader: data.reader,
        state,
      });

      hiddenCount =
        (isUpstream ? state.hiddenUpstream : state.hiddenDownstream).get(
          card.id,
        )?.size || 0;
    }

    const newIds: Array<string> = Array.from(state.placed.keys()).filter(
      (id: string): boolean => {
        return !drawnIds.has(id);
      },
    );
    const isNew: Set<string> = new Set(newIds);

    // The arrows the walk does not read: the other way, between the tables drawn now and what is drawn.
    await this.keepEdgesBack({
      reader: data.reader,
      state,
      direction: isUpstream
        ? DataLineageDirection.Downstream
        : DataLineageDirection.Upstream,
      dataAssetIds: newIds,
    });

    // On a pipeline's drawing, a table drawn now that the pipeline reads, or writes, is joined to it.
    if (focusPipelineId && card.kind === "table" && newIds.length > 0) {
      await this.readMissingPipelines(data.reader, state, [focusPipelineId]);

      const pipeline: DataLineagePipelineRow | undefined =
        state.pipelines.get(focusPipelineId);

      if (pipeline) {
        const tables: DataPipelineTables = await this.readPipelineTables(
          data.reader,
          focusPipelineId,
        );

        for (const id of newIds) {
          const isRead: boolean =
            state.placed.get(id)!.side === DataLineageSide.Upstream;
          const seen: Map<string, Date | null> = isRead
            ? tables.read
            : tables.written;

          if (seen.has(id)) {
            ownEdges.push(
              this.pipelineTableEdge({
                pipeline,
                dataAssetId: id,
                isRead,
                lastSeenAt: seen.get(id) || null,
              }),
            );
          }
        }
      }
    }

    const openAlerts: Map<string, number> =
      newIds.length > 0
        ? await data.reader.readOpenAlertCounts(newIds)
        : new Map();
    const nodes: Array<DataTableLineageNode> = [];
    const edges: Array<DataTableLineageEdge> = [...ownEdges];

    for (const id of newIds) {
      nodes.push(
        this.tableNode({
          table: state.tables.get(id)!,
          placed: state.placed.get(id)!,
          now: data.now,
          openAlertCount: openAlerts.get(id) || 0,
          hiddenUpstreamCount: state.hiddenUpstream.get(id)?.size || 0,
          hiddenDownstreamCount: state.hiddenDownstream.get(id)?.size || 0,
        }),
      );
    }

    /*
     * The arrows with a table drawn now, and the card's own that way: a
     * table it counted that is drawn elsewhere - across a cycle, or
     * reached another way - is joined to it now. Other arrows between
     * tables drawn already are drawn; the diagram keeps one of each.
     */
    const cardTableId: string | null = card.kind === "table" ? card.id : null;

    for (const edge of state.edges.values()) {
      if (
        isNew.has(edge.upstreamDataAssetId) ||
        isNew.has(edge.downstreamDataAssetId) ||
        (cardTableId !== null &&
          (isUpstream
            ? edge.downstreamDataAssetId === cardTableId
            : edge.upstreamDataAssetId === cardTableId))
      ) {
        edges.push(this.feedsEdge(state, edge));
      }
    }

    this.addWriters({
      state,
      nodes,
      edges,
      pins: new Set(),
      focusPipelineId,
      tableIds: isNew,
    });

    const hiddenDashboardCount: number | null =
      await this.addExpansionDashboards({
        reader: data.reader,
        state,
        newIds,
        drawnDataDashboardIds: request.dataDashboardIds,
        nodes,
        edges,
      });

    if (request.withColumns) {
      const depths: Map<string, number> = new Map();

      for (const [id, placed] of state.placed) {
        depths.set(getLineageTableNodeId(id), placed.depth);
      }

      await this.addColumnMappings({ reader: data.reader, edges, depths });
    }

    edges.sort((a: DataTableLineageEdge, b: DataTableLineageEdge): number => {
      return compareText(a.id, b.id);
    });

    return {
      nodeId: request.nodeId,
      side,
      hiddenCount,
      nodes,
      edges,
      hiddenDashboardCount,
      isTruncated: state.isTruncated,
    };
  }

  /*
   * The arrows the walk does not read, from the tables drawn now: the
   * other way from them, to every table drawn - one drawn now upstream
   * that also feeds a table drawn already, or one drawn now downstream
   * that is built from another. Nothing is counted this way: a table
   * counts only its own way.
   */
  private static async keepEdgesBack(data: {
    reader: DataLineageReader;
    state: WalkState;
    // The way read from them.
    direction: DataLineageDirection;
    dataAssetIds: Array<string>;
  }): Promise<void> {
    if (data.dataAssetIds.length === 0) {
      return;
    }

    const isUpstream: boolean =
      data.direction === DataLineageDirection.Upstream;
    const ids: Set<string> = new Set(data.dataAssetIds);
    const rows: Array<DataLineageEdgeRow> = await data.reader.readEdges({
      direction: data.direction,
      dataAssetIds: data.dataAssetIds,
      limit: MAX_DATA_LINEAGE_EDGE_ROWS,
    });

    if (rows.length >= MAX_DATA_LINEAGE_EDGE_ROWS) {
      data.state.isTruncated = true;
    }

    const pipelineIds: Array<string> = [];

    for (const row of rows) {
      // A writes row: no table at its other end.
      if (!row.upstreamDataAssetId) {
        continue;
      }

      const own: string = isUpstream
        ? row.downstreamDataAssetId
        : row.upstreamDataAssetId;
      const other: string = isUpstream
        ? row.upstreamDataAssetId
        : row.downstreamDataAssetId;

      if (!ids.has(own) || other === own || !data.state.placed.has(other)) {
        continue;
      }

      if (row.dataPipelineId) {
        pipelineIds.push(row.dataPipelineId);
      }

      this.keepEdge(data.state, {
        upstreamDataAssetId: row.upstreamDataAssetId,
        downstreamDataAssetId: row.downstreamDataAssetId,
        seenIn: new Set([
          row.source && isDataAssetLineageSource(row.source)
            ? row.source
            : DataAssetLineageSource.Pipeline,
        ]),
        pipelineIds: new Set(row.dataPipelineId ? [row.dataPipelineId] : []),
        lastSeenAt: row.lastSeenAt,
      });
    }

    await this.readMissingPipelines(data.reader, data.state, pipelineIds);
  }

  /*
   * The dashboards built on the tables drawn now downstream: an arrow from
   * each such table to each dashboard drawn already that reads it, and the
   * dashboards not drawn yet, first by name while the drawing has room for
   * them, each with an arrow from every drawn table it reads. Returns how
   * many dashboards built on the drawn tables are then not drawn, all
   * told; null when no table was drawn downstream.
   */
  private static async addExpansionDashboards(data: {
    reader: DataLineageReader;
    state: WalkState;
    newIds: Array<string>;
    drawnDataDashboardIds: Array<string>;
    nodes: Array<DataTableLineageNode>;
    edges: Array<DataTableLineageEdge>;
  }): Promise<number | null> {
    const state: WalkState = data.state;
    // A dashboard is drawn after the table itself and the tables built from it, never upstream.
    const isRead: (id: string) => boolean = (id: string): boolean => {
      const placed: PlacedTable | undefined = state.placed.get(id);

      return Boolean(placed && placed.side !== DataLineageSide.Upstream);
    };
    const newReadIds: Array<string> = data.newIds.filter(isRead);

    if (newReadIds.length === 0) {
      return null;
    }

    const isNew: Set<string> = new Set(newReadIds);
    const drawnReadIds: Array<string> = Array.from(state.placed.keys()).filter(
      (id: string): boolean => {
        return isRead(id) && !isNew.has(id);
      },
    );
    const drawnDashboards: Set<string> = new Set(data.drawnDataDashboardIds);
    const found: { dashboards: Array<DataLineageDashboardRow>; total: number } =
      await data.reader.readDashboards({
        dataAssetIds: newReadIds,
        limit: MAX_DATA_LINEAGE_DASHBOARDS + drawnDashboards.size,
        drawnDataAssetIds: drawnReadIds,
      });
    let drawn: number = drawnDashboards.size;

    for (const dashboard of found.dashboards) {
      const tableIds: Array<string> = Array.from(
        new Set(dashboard.dataAssetIds),
      )
        .filter(isRead)
        .sort(compareText);
      const isDrawn: boolean = drawnDashboards.has(dashboard.dataDashboardId);

      if (
        !tableIds.some((id: string): boolean => {
          return isNew.has(id);
        })
      ) {
        continue;
      }

      const nodeId: string = getLineageDashboardNodeId(
        dashboard.dataDashboardId,
      );

      if (!isDrawn) {
        if (drawn >= MAX_DATA_LINEAGE_DASHBOARDS) {
          continue;
        }

        data.nodes.push({
          id: nodeId,
          kind: DataLineageNodeKind.Dashboard,
          side: DataLineageSide.Downstream,
          depth:
            Math.max(
              ...tableIds.map((id: string): number => {
                return state.placed.get(id)!.depth;
              }),
            ) + 1,
          name: dashboard.name,
          dataDashboardId: dashboard.dataDashboardId,
          tool: dashboard.tool,
          url: dashboard.url,
        });
        drawn++;
      }

      for (const tableId of tableIds) {
        // A dashboard drawn already has its arrows from the tables drawn before.
        if (isDrawn && !isNew.has(tableId)) {
          continue;
        }

        const source: string = getLineageTableNodeId(tableId);

        data.edges.push({
          id: getLineageEdgeId({
            kind: DataLineageEdgeKind.Reads,
            source,
            target: nodeId,
          }),
          source,
          target: nodeId,
          kind: DataLineageEdgeKind.Reads,
          seenIn: [],
          pipelines: [],
          lastSeenAt: null,
        });
      }
    }

    // All told: the dashboards on every drawn table, less those drawn.
    const all: { dashboards: Array<DataLineageDashboardRow>; total: number } =
      await data.reader.readDashboards({
        dataAssetIds: [...drawnReadIds, ...newReadIds],
        limit: 1,
      });

    return Math.max(0, all.total - drawn);
  }

  /*
   * The columns each arrow between two tables carries, the arrows nearest
   * the drawing's own card first, until one answer holds the most it
   * carries (MAX_DATA_LINEAGE_COLUMN_MAPPINGS): an arrow past them carries
   * none, as one no source named columns on.
   */
  private static async addColumnMappings(data: {
    reader: DataLineageReader;
    edges: Array<DataTableLineageEdge>;
    // Each card's steps from the drawing's own, by card id.
    depths: Map<string, number>;
  }): Promise<void> {
    const stepsOf: (edge: DataTableLineageEdge) => number = (
      edge: DataTableLineageEdge,
    ): number => {
      return Math.min(
        Math.abs(data.depths.get(edge.source) ?? Number.MAX_SAFE_INTEGER),
        Math.abs(data.depths.get(edge.target) ?? Number.MAX_SAFE_INTEGER),
      );
    };
    const arrows: Array<DataTableLineageEdge> = data.edges
      .filter((edge: DataTableLineageEdge): boolean => {
        return (
          edge.kind === DataLineageEdgeKind.Feeds &&
          edge.source.startsWith(TABLE_NODE_PREFIX) &&
          edge.target.startsWith(TABLE_NODE_PREFIX)
        );
      })
      .sort((a: DataTableLineageEdge, b: DataTableLineageEdge): number => {
        return stepsOf(a) - stepsOf(b) || compareText(a.id, b.id);
      });
    let carried: number = 0;

    for (const chunk of chunked(arrows, COLUMN_READ_CHUNK)) {
      const pairs: Array<DataLineageTablePair> = chunk.map(
        (edge: DataTableLineageEdge): DataLineageTablePair => {
          return {
            upstreamDataAssetId: edge.source.slice(TABLE_NODE_PREFIX.length),
            downstreamDataAssetId: edge.target.slice(TABLE_NODE_PREFIX.length),
          };
        },
      );
      const found: Map<string, Array<DataColumnMapping>> =
        await data.reader.readColumnMappings(pairs);

      for (let index: number = 0; index < chunk.length; index++) {
        const mappings: Array<DataColumnMapping> | undefined = found.get(
          getLineageTablePairKey(pairs[index]!),
        );

        if (!mappings || mappings.length === 0) {
          continue;
        }

        // The rest are further from the drawing's own card: none of them is carried.
        if (carried + mappings.length > MAX_DATA_LINEAGE_COLUMN_MAPPINGS) {
          return;
        }

        chunk[index]!.columnMappings = mappings;
        carried += mappings.length;
      }
    }
  }

  // A pipeline's own arrow: from a table it reads, or to a table it writes.
  private static pipelineTableEdge(data: {
    pipeline: DataLineagePipelineRow;
    dataAssetId: string;
    isRead: boolean;
    lastSeenAt: Date | null;
  }): DataTableLineageEdge {
    const pipelineNodeId: string = getLineagePipelineNodeId(
      data.pipeline.dataPipelineId,
    );
    const tableNodeId: string = getLineageTableNodeId(data.dataAssetId);

    // What it reads, into it: a read is no run of its own, so it carries no pipeline.
    if (data.isRead) {
      return {
        id: getLineageEdgeId({
          kind: DataLineageEdgeKind.Reads,
          source: tableNodeId,
          target: pipelineNodeId,
        }),
        source: tableNodeId,
        target: pipelineNodeId,
        kind: DataLineageEdgeKind.Reads,
        seenIn: [DataAssetLineageSource.Pipeline],
        pipelines: [],
        lastSeenAt: toIso(data.lastSeenAt),
      };
    }

    // What it writes, out of it: its run moves the data, so a failed run is told on the arrow.
    return {
      id: getLineageEdgeId({
        kind: DataLineageEdgeKind.Writes,
        source: pipelineNodeId,
        target: tableNodeId,
      }),
      source: pipelineNodeId,
      target: tableNodeId,
      kind: DataLineageEdgeKind.Writes,
      seenIn: [DataAssetLineageSource.Pipeline],
      pipelines: [
        {
          dataPipelineId: data.pipeline.dataPipelineId,
          name: data.pipeline.jobName,
          lastRunState: data.pipeline.lastRunState,
        },
      ],
      lastSeenAt: toIso(data.lastSeenAt),
    };
  }

  // An arrow between two tables, as a drawing draws it.
  private static feedsEdge(
    state: WalkState,
    edge: FeedsEdge,
  ): DataTableLineageEdge {
    const source: string = getLineageTableNodeId(edge.upstreamDataAssetId);
    const target: string = getLineageTableNodeId(edge.downstreamDataAssetId);

    return {
      id: getLineageEdgeId({
        kind: DataLineageEdgeKind.Feeds,
        source,
        target,
      }),
      source,
      target,
      kind: DataLineageEdgeKind.Feeds,
      seenIn: Array.from(edge.seenIn).sort(compareText),
      pipelines: this.edgePipelines(state, Array.from(edge.pipelineIds)),
      lastSeenAt: toIso(edge.lastSeenAt),
    };
  }

  /*
   * The tables a pipeline reads and writes, from its own rows: each row
   * names a table it wrote, and - when it read one to write it - that table.
   */
  public static async readPipelineTables(
    reader: DataPipelineLineageReader,
    dataPipelineId: string,
  ): Promise<DataPipelineTables> {
    const rows: Array<DataLineageEdgeRow> = await reader.readPipelineEdges({
      dataPipelineId,
      limit: MAX_DATA_LINEAGE_EDGE_ROWS,
    });
    const read: Map<string, Date | null> = new Map();
    const written: Map<string, Date | null> = new Map();

    for (const row of rows) {
      if (row.dataPipelineId !== dataPipelineId) {
        continue;
      }

      written.set(
        row.downstreamDataAssetId,
        laterOf(written.get(row.downstreamDataAssetId) || null, row.lastSeenAt),
      );

      if (
        row.upstreamDataAssetId &&
        row.upstreamDataAssetId !== row.downstreamDataAssetId
      ) {
        read.set(
          row.upstreamDataAssetId,
          laterOf(read.get(row.upstreamDataAssetId) || null, row.lastSeenAt),
        );
      }
    }

    for (const id of written.keys()) {
      read.delete(id);
    }

    return {
      read,
      written,
      isTruncated: rows.length >= MAX_DATA_LINEAGE_EDGE_ROWS,
    };
  }

  /*
   * The tables a pipeline reads, or writes, that its drawing draws: the
   * pinned first, then its nearest as a table's are chosen - a problem
   * first, then one still in its database, then the one seen last - at
   * most the most next to one card, or the room `most` leaves. The rest
   * are counted on its card.
   */
  private static choosePipelineTables(data: {
    state: WalkState;
    seen: Map<string, Date | null>;
    pins: Set<string>;
    now: Date;
    most?: number | undefined;
  }): { chosen: Array<string>; hidden: number } {
    const edges: Map<string, FeedsEdge> = new Map();

    for (const [id, lastSeenAt] of data.seen) {
      edges.set(id, {
        upstreamDataAssetId: id,
        downstreamDataAssetId: id,
        seenIn: new Set([DataAssetLineageSource.Pipeline]),
        pipelineIds: new Set(),
        lastSeenAt,
      });
    }

    // Only the tables the project still has.
    const ranked: Array<string> = this.rankNeighbours({
      state: data.state,
      edges,
      now: data.now,
    });
    const chosen: Array<string> = ranked.filter((id: string): boolean => {
      return data.pins.has(id);
    });
    const most: number = Math.min(
      MAX_DATA_LINEAGE_NEIGHBORS,
      data.most ?? MAX_DATA_LINEAGE_NEIGHBORS,
    );

    for (const id of ranked) {
      if (chosen.length >= most) {
        break;
      }

      if (!chosen.includes(id)) {
        chosen.push(id);
      }
    }

    return { chosen, hidden: ranked.length - chosen.length };
  }

  // Everything both kinds of drawing do once their walks are done.
  private static async finish(data: {
    state: WalkState;
    focusNodeId: string;
    depth: number;
    now: Date;
    reader: DataLineageReader;
    pins: DataLineagePins;
    // A pipeline's drawing: its own card and arrows, and its id, never drawn again as a writer.
    focusNode: DataTableLineageNode | null;
    focusEdges: Array<DataTableLineageEdge>;
    focusPipelineId: string | null;
  }): Promise<DataTableLineage> {
    const state: WalkState = data.state;

    /*
     * A table one table did not draw - past its most neighbours - can be
     * drawn all the same, reached through another: its edge to the first
     * is drawn then, and it is no longer counted there.
     */
    for (const hidden of [state.hiddenUpstream, state.hiddenDownstream]) {
      for (const ofTable of hidden.values()) {
        for (const [neighbour, edge] of ofTable) {
          if (state.placed.has(neighbour)) {
            this.keepEdge(state, edge);
            ofTable.delete(neighbour);
          }
        }
      }
    }

    const placedIds: Array<string> = Array.from(state.placed.keys());
    const openAlerts: Map<string, number> =
      await data.reader.readOpenAlertCounts(placedIds);

    const nodes: Array<DataTableLineageNode> = data.focusNode
      ? [data.focusNode]
      : [];
    const edges: Array<DataTableLineageEdge> = [...data.focusEdges];

    for (const [id, placed] of state.placed) {
      nodes.push(
        this.tableNode({
          table: state.tables.get(id)!,
          placed,
          now: data.now,
          openAlertCount: openAlerts.get(id) || 0,
          hiddenUpstreamCount: state.hiddenUpstream.get(id)?.size || 0,
          hiddenDownstreamCount: state.hiddenDownstream.get(id)?.size || 0,
        }),
      );
    }

    for (const edge of state.edges.values()) {
      edges.push(this.feedsEdge(state, edge));
    }

    this.addWriters({
      state,
      nodes,
      edges,
      pins: data.pins.dataPipelineIds,
      focusPipelineId: data.focusPipelineId,
    });

    const hiddenDashboardCount: number = await this.addDashboards({
      reader: data.reader,
      state,
      nodes,
      edges,
    });

    // One order whatever order the rows came in.
    edges.sort((a: DataTableLineageEdge, b: DataTableLineageEdge): number => {
      return compareText(a.id, b.id);
    });

    return {
      focusNodeId: data.focusNodeId,
      depth: data.depth,
      nodes,
      edges,
      hiddenDashboardCount,
      isTruncated: state.isTruncated,
    };
  }

  // One side of the drawing, a step at a time, from the tables a step in.
  private static async walk(data: {
    direction: DataLineageDirection;
    // The table itself, or the tables a pipeline reads (upstream) or writes (downstream).
    frontier: Array<string>;
    // How many steps from the drawing's own card the first tables found are.
    firstStep: number;
    depth: number;
    // The tables already drawn on this side: a pipeline's own.
    placedOnSide: number;
    pins: Set<string>;
    now: Date;
    reader: DataLineageReader;
    state: WalkState;
  }): Promise<void> {
    const state: WalkState = data.state;
    const isUpstream: boolean =
      data.direction === DataLineageDirection.Upstream;
    const side: DataLineageSide = isUpstream
      ? DataLineageSide.Upstream
      : DataLineageSide.Downstream;
    const hidden: Map<string, Map<string, FeedsEdge>> = isUpstream
      ? state.hiddenUpstream
      : state.hiddenDownstream;
    let placedOnSide: number = data.placedOnSide;
    let frontier: Array<string> = [...data.frontier];

    for (let step: number = data.firstStep; frontier.length > 0; step++) {
      const isBeyond: boolean = step > data.depth;
      const inFrontier: Set<string> = new Set(frontier);
      const rows: Array<DataLineageEdgeRow> = await data.reader.readEdges({
        direction: data.direction,
        dataAssetIds: frontier,
        limit: MAX_DATA_LINEAGE_EDGE_ROWS,
      });

      if (rows.length >= MAX_DATA_LINEAGE_EDGE_ROWS) {
        state.isTruncated = true;
      }

      // By table one step in, its neighbours one step out, every row of each edge together.
      const neighbours: Map<string, Map<string, FeedsEdge>> = new Map();

      for (const row of rows) {
        const parent: string | null = isUpstream
          ? row.downstreamDataAssetId
          : row.upstreamDataAssetId;

        if (!parent || !inFrontier.has(parent)) {
          continue;
        }

        if (isUpstream && !row.upstreamDataAssetId) {
          // A writes row: the pipeline writes this table, whatever it reads.
          if (row.dataPipelineId) {
            const writers: Map<string, Writer> =
              state.writers.get(parent) || new Map();
            const known: Writer | undefined = writers.get(row.dataPipelineId);

            writers.set(row.dataPipelineId, {
              dataPipelineId: row.dataPipelineId,
              lastSeenAt: laterOf(known?.lastSeenAt || null, row.lastSeenAt),
            });
            state.writers.set(parent, writers);
          }

          continue;
        }

        const neighbour: string | null = isUpstream
          ? row.upstreamDataAssetId
          : row.downstreamDataAssetId;

        if (!neighbour || neighbour === parent) {
          continue;
        }

        if (row.dataPipelineId) {
          addTo(
            state.feedingPipelines,
            row.downstreamDataAssetId,
            row.dataPipelineId,
          );
        }

        const ofParent: Map<string, FeedsEdge> =
          neighbours.get(parent) || new Map();
        const edge: FeedsEdge = ofParent.get(neighbour) || {
          upstreamDataAssetId: isUpstream ? neighbour : parent,
          downstreamDataAssetId: isUpstream ? parent : neighbour,
          seenIn: new Set(),
          pipelineIds: new Set(),
          lastSeenAt: null,
        };

        edge.seenIn.add(
          row.source && isDataAssetLineageSource(row.source)
            ? row.source
            : DataAssetLineageSource.Pipeline,
        );

        if (row.dataPipelineId) {
          edge.pipelineIds.add(row.dataPipelineId);
        }

        edge.lastSeenAt = laterOf(edge.lastSeenAt, row.lastSeenAt);
        ofParent.set(neighbour, edge);
        neighbours.set(parent, ofParent);
      }

      // The tables a step out that are not drawn yet, and the pipelines on their edges.
      const unplaced: Array<string> = [];
      const pipelineIds: Array<string> = [];

      for (const ofParent of neighbours.values()) {
        for (const [neighbour, edge] of ofParent) {
          if (!state.placed.has(neighbour)) {
            unplaced.push(neighbour);
          }

          pipelineIds.push(...edge.pipelineIds);
        }
      }

      await this.readMissingTables(data.reader, state, unplaced);
      await this.readMissingPipelines(data.reader, state, pipelineIds);

      const chosen: Set<string> = new Set();

      if (!isBeyond) {
        // The ways to an alert's cause and to the alerts it caused, first and past the most per table.
        for (const parent of frontier) {
          for (const neighbour of neighbours.get(parent)?.keys() || []) {
            if (
              !data.pins.has(neighbour) ||
              !state.tables.has(neighbour) ||
              state.placed.has(neighbour) ||
              chosen.has(neighbour)
            ) {
              continue;
            }

            if (
              placedOnSide + chosen.size >=
              MAX_DATA_LINEAGE_TABLES_PER_SIDE
            ) {
              state.isTruncated = true;
              break;
            }

            chosen.add(neighbour);
          }
        }

        for (const parent of frontier) {
          const ofParent: Map<string, FeedsEdge> | undefined =
            neighbours.get(parent);

          if (!ofParent) {
            continue;
          }

          // The ways' tables take their places first: the rest fill what is left.
          let drawn: number = 0;

          for (const neighbour of ofParent.keys()) {
            if (data.pins.has(neighbour) && chosen.has(neighbour)) {
              drawn++;
            }
          }

          for (const neighbour of this.rankNeighbours({
            state,
            edges: ofParent,
            now: data.now,
          })) {
            if (state.placed.has(neighbour)) {
              continue;
            }

            if (chosen.has(neighbour)) {
              if (!data.pins.has(neighbour)) {
                drawn++;
              }

              continue;
            }

            if (drawn >= MAX_DATA_LINEAGE_NEIGHBORS) {
              break;
            }

            if (
              placedOnSide + chosen.size >=
              MAX_DATA_LINEAGE_TABLES_PER_SIDE
            ) {
              state.isTruncated = true;
              break;
            }

            chosen.add(neighbour);
            drawn++;
          }
        }
      }

      // Every edge whose two tables are drawn is drawn; every other neighbour is counted.
      for (const [parent, ofParent] of neighbours) {
        for (const [neighbour, edge] of ofParent) {
          if (state.placed.has(neighbour) || chosen.has(neighbour)) {
            this.keepEdge(state, edge);
          } else if (state.tables.has(neighbour)) {
            const ofTable: Map<string, FeedsEdge> =
              hidden.get(parent) || new Map();
            ofTable.set(neighbour, edge);
            hidden.set(parent, ofTable);
          }
        }
      }

      for (const id of chosen) {
        state.placed.set(id, { side, depth: isUpstream ? -step : step });
      }

      placedOnSide += chosen.size;
      frontier = Array.from(chosen);
    }
  }

  /*
   * A table's neighbours one way, the ones to draw first: a problem first -
   * a late table, or an edge whose pipeline's latest run failed - then one
   * still in its database, then the edge seen last, then by name.
   */
  private static rankNeighbours(data: {
    state: WalkState;
    edges: Map<string, FeedsEdge>;
    now: Date;
  }): Array<string> {
    const ranked: Array<RankedNeighbour> = [];

    for (const [id, edge] of data.edges) {
      const table: DataLineageTableRow | undefined = data.state.tables.get(id);

      if (!table) {
        continue;
      }

      const isLate: boolean =
        getDataAssetFreshness({
          kind: table.assetKind,
          lastChangedAt: table.lastChangedAt,
          updateIntervalInSeconds: table.updateIntervalInSeconds,
          now: data.now,
        }).freshness === DataAssetFreshness.Late;
      const hasFailedPipeline: boolean = Array.from(edge.pipelineIds).some(
        (pipelineId: string): boolean => {
          return isFailedLineageRunState(
            data.state.pipelines.get(pipelineId)?.lastRunState,
          );
        },
      );

      ranked.push({
        id,
        hasProblem: (isLate && !table.isDropped) || hasFailedPipeline,
        isDropped: table.isDropped,
        seen: toTime(edge.lastSeenAt),
        key: table.assetKey || id,
      });
    }

    return ranked
      .sort((a: RankedNeighbour, b: RankedNeighbour): number => {
        if (a.hasProblem !== b.hasProblem) {
          return a.hasProblem ? -1 : 1;
        }

        if (a.isDropped !== b.isDropped) {
          return a.isDropped ? 1 : -1;
        }

        if (a.seen !== b.seen) {
          return b.seen - a.seen;
        }

        return compareText(a.key, b.key) || compareText(a.id, b.id);
      })
      .map((entry: RankedNeighbour): string => {
        return entry.id;
      });
  }

  private static keepEdge(state: WalkState, edge: FeedsEdge): void {
    const key: string = `${edge.upstreamDataAssetId}>${edge.downstreamDataAssetId}`;
    const kept: FeedsEdge | undefined = state.edges.get(key);

    if (!kept) {
      state.edges.set(key, {
        ...edge,
        seenIn: new Set(edge.seenIn),
        pipelineIds: new Set(edge.pipelineIds),
      });
      return;
    }

    for (const source of edge.seenIn) {
      kept.seenIn.add(source);
    }

    for (const pipelineId of edge.pipelineIds) {
      kept.pipelineIds.add(pipelineId);
    }

    kept.lastSeenAt = laterOf(kept.lastSeenAt, edge.lastSeenAt);
  }

  // The pipelines on an edge, as the drawing names them: a failed run first, then by name.
  private static edgePipelines(
    state: WalkState,
    pipelineIds: Array<string>,
  ): Array<DataTableLineagePipeline> {
    const pipelines: Array<DataTableLineagePipeline> = [];

    for (const pipelineId of pipelineIds) {
      const pipeline: DataLineagePipelineRow | undefined =
        state.pipelines.get(pipelineId);

      if (pipeline) {
        pipelines.push({
          dataPipelineId: pipelineId,
          name: pipeline.jobName,
          lastRunState: pipeline.lastRunState,
        });
      }
    }

    return pipelines.sort(
      (a: DataTableLineagePipeline, b: DataTableLineagePipeline): number => {
        const aFailed: boolean = isFailedLineageRunState(a.lastRunState);
        const bFailed: boolean = isFailedLineageRunState(b.lastRunState);

        if (aFailed !== bFailed) {
          return aFailed ? -1 : 1;
        }

        return (
          compareText(a.name, b.name) ||
          compareText(a.dataPipelineId, b.dataPipelineId)
        );
      },
    );
  }

  private static pipelineNode(
    pipeline: DataLineagePipelineRow,
    side: DataLineageSide,
    depth: number,
  ): DataTableLineageNode {
    return {
      id: getLineagePipelineNodeId(pipeline.dataPipelineId),
      kind: DataLineageNodeKind.Pipeline,
      side,
      depth,
      name: pipeline.jobName,
      dataPipelineId: pipeline.dataPipelineId,
      jobNamespace: pipeline.jobNamespace,
      lastRunState: pipeline.lastRunState,
      lastRunStartedAt: toIso(pipeline.lastRunStartedAt),
      lastErrorMessage: clip(
        pipeline.lastErrorMessage,
        MAX_DATA_LINEAGE_ERROR_LENGTH,
      ),
    };
  }

  /*
   * The pipelines that bring data into the upstream side from outside what
   * OneUptime watches: a pipeline whose writes rows name a drawn table (or
   * the table itself) and that is on no edge into it from a watched table.
   * One card per pipeline, a step before the first table it writes; a
   * pinned one first, and never the pipeline the drawing is about. Drawing
   * more of a drawing, only the tables drawn now (`tableIds`).
   */
  private static addWriters(data: {
    state: WalkState;
    nodes: Array<DataTableLineageNode>;
    edges: Array<DataTableLineageEdge>;
    pins: Set<string>;
    focusPipelineId: string | null;
    tableIds?: Set<string> | undefined;
  }): void {
    const state: WalkState = data.state;
    const cards: Map<string, DataTableLineageNode> = new Map();

    for (const [tableId, placed] of state.placed) {
      const writers: Map<string, Writer> | undefined =
        state.writers.get(tableId);

      if (
        placed.side === DataLineageSide.Downstream ||
        !writers ||
        (data.tableIds && !data.tableIds.has(tableId))
      ) {
        continue;
      }

      const feeding: Set<string> =
        state.feedingPipelines.get(tableId) || new Set();
      const outside: Array<OutsideWriter> = [];

      for (const writer of writers.values()) {
        const pipeline: DataLineagePipelineRow | undefined =
          state.pipelines.get(writer.dataPipelineId);

        if (
          pipeline &&
          !feeding.has(writer.dataPipelineId) &&
          writer.dataPipelineId !== data.focusPipelineId
        ) {
          outside.push({ pipeline, writer });
        }
      }

      outside.sort((a: OutsideWriter, b: OutsideWriter): number => {
        const aPinned: boolean = data.pins.has(a.pipeline.dataPipelineId);
        const bPinned: boolean = data.pins.has(b.pipeline.dataPipelineId);

        if (aPinned !== bPinned) {
          return aPinned ? -1 : 1;
        }

        const aFailed: boolean = isFailedLineageRunState(
          a.pipeline.lastRunState,
        );
        const bFailed: boolean = isFailedLineageRunState(
          b.pipeline.lastRunState,
        );

        if (aFailed !== bFailed) {
          return aFailed ? -1 : 1;
        }

        const seen: number =
          toTime(b.writer.lastSeenAt) - toTime(a.writer.lastSeenAt);

        return (
          seen ||
          compareText(a.pipeline.jobName, b.pipeline.jobName) ||
          compareText(a.pipeline.dataPipelineId, b.pipeline.dataPipelineId)
        );
      });

      for (const { pipeline, writer } of outside.slice(
        0,
        MAX_DATA_LINEAGE_PIPELINES_PER_TABLE,
      )) {
        const nodeId: string = getLineagePipelineNodeId(
          pipeline.dataPipelineId,
        );
        const card: DataTableLineageNode | undefined = cards.get(nodeId);

        if (card) {
          card.depth = Math.min(card.depth, placed.depth - 1);
        } else {
          const node: DataTableLineageNode = this.pipelineNode(
            pipeline,
            DataLineageSide.Upstream,
            placed.depth - 1,
          );

          cards.set(nodeId, node);
          data.nodes.push(node);
        }

        const target: string = getLineageTableNodeId(tableId);

        data.edges.push({
          id: getLineageEdgeId({
            kind: DataLineageEdgeKind.Writes,
            source: nodeId,
            target,
          }),
          source: nodeId,
          target,
          kind: DataLineageEdgeKind.Writes,
          seenIn: [DataAssetLineageSource.Pipeline],
          pipelines: [
            {
              dataPipelineId: pipeline.dataPipelineId,
              name: pipeline.jobName,
              lastRunState: pipeline.lastRunState,
            },
          ],
          lastSeenAt: toIso(writer.lastSeenAt),
        });
      }
    }
  }

  /*
   * The dashboards built on the table and on the drawn tables built from
   * it, a step after the last of them each reads. Returns how many more
   * there are than are drawn.
   */
  private static async addDashboards(data: {
    reader: DataLineageReader;
    state: WalkState;
    nodes: Array<DataTableLineageNode>;
    edges: Array<DataTableLineageEdge>;
  }): Promise<number> {
    const readIds: Array<string> = [];

    for (const [id, placed] of data.state.placed) {
      if (placed.side !== DataLineageSide.Upstream) {
        readIds.push(id);
      }
    }

    const found: { dashboards: Array<DataLineageDashboardRow>; total: number } =
      await data.reader.readDashboards({
        dataAssetIds: readIds,
        limit: MAX_DATA_LINEAGE_DASHBOARDS,
      });
    let drawn: number = 0;

    for (const dashboard of found.dashboards.slice(
      0,
      MAX_DATA_LINEAGE_DASHBOARDS,
    )) {
      const tableIds: Array<string> = Array.from(
        new Set(dashboard.dataAssetIds),
      ).filter((id: string): boolean => {
        const placed: PlacedTable | undefined = data.state.placed.get(id);

        return Boolean(placed && placed.side !== DataLineageSide.Upstream);
      });

      if (tableIds.length === 0) {
        continue;
      }

      const nodeId: string = getLineageDashboardNodeId(
        dashboard.dataDashboardId,
      );
      const depth: number = Math.max(
        ...tableIds.map((id: string): number => {
          return data.state.placed.get(id)!.depth;
        }),
      );

      data.nodes.push({
        id: nodeId,
        kind: DataLineageNodeKind.Dashboard,
        side: DataLineageSide.Downstream,
        depth: depth + 1,
        name: dashboard.name,
        dataDashboardId: dashboard.dataDashboardId,
        tool: dashboard.tool,
        url: dashboard.url,
      });
      drawn++;

      for (const tableId of tableIds.sort(compareText)) {
        const source: string = getLineageTableNodeId(tableId);

        data.edges.push({
          id: getLineageEdgeId({
            kind: DataLineageEdgeKind.Reads,
            source,
            target: nodeId,
          }),
          source,
          target: nodeId,
          kind: DataLineageEdgeKind.Reads,
          seenIn: [],
          pipelines: [],
          lastSeenAt: null,
        });
      }
    }

    return Math.max(0, found.total - drawn);
  }

  private static tableNode(data: {
    table: DataLineageTableRow;
    placed: PlacedTable;
    now: Date;
    openAlertCount: number;
    hiddenUpstreamCount: number;
    hiddenDownstreamCount: number;
  }): DataTableLineageNode {
    const freshness: DataAssetFreshnessResult = getDataAssetFreshness({
      kind: data.table.assetKind,
      lastChangedAt: data.table.lastChangedAt,
      updateIntervalInSeconds: data.table.updateIntervalInSeconds,
      now: data.now,
    });

    return {
      id: getLineageTableNodeId(data.table.dataAssetId),
      kind: DataLineageNodeKind.Table,
      side: data.placed.side,
      depth: data.placed.depth,
      name: data.table.assetKey || data.table.name || data.table.dataAssetId,
      dataAssetId: data.table.dataAssetId,
      database: data.table.database,
      assetKind: data.table.assetKind,
      freshness: freshness.freshness,
      lateBySeconds: freshness.overdueBySeconds,
      isDropped: data.table.isDropped,
      openAlertCount: data.openAlertCount,
      // Counted on the side it is drawn on, and both ways on the table itself.
      hiddenUpstreamCount:
        data.placed.side === DataLineageSide.Downstream
          ? 0
          : data.hiddenUpstreamCount,
      hiddenDownstreamCount:
        data.placed.side === DataLineageSide.Upstream
          ? 0
          : data.hiddenDownstreamCount,
    };
  }

  private static async readMissingTables(
    reader: DataLineageReader,
    state: WalkState,
    ids: Array<string>,
  ): Promise<void> {
    const missing: Array<string> = Array.from(new Set(ids)).filter(
      (id: string): boolean => {
        return !state.tables.has(id);
      },
    );

    if (missing.length === 0) {
      return;
    }

    for (const table of await reader.readTables(missing)) {
      state.tables.set(table.dataAssetId, table);
    }
  }

  private static async readMissingPipelines(
    reader: DataLineageReader,
    state: WalkState,
    ids: Array<string>,
  ): Promise<void> {
    // The writers of the tables a step in are read with the pipelines of their edges.
    const writerIds: Array<string> = [];

    for (const writers of state.writers.values()) {
      writerIds.push(...writers.keys());
    }

    const missing: Array<string> = Array.from(
      new Set([...ids, ...writerIds]),
    ).filter((id: string): boolean => {
      return !state.pipelines.has(id);
    });

    if (missing.length === 0) {
      return;
    }

    for (const pipeline of await reader.readPipelines(missing)) {
      state.pipelines.set(pipeline.dataPipelineId, pipeline);
    }
  }

  // The reader of the project's own rows, counting alerts as `reader` may see them.
  public static getDatabaseReader(
    projectId: ObjectID,
    reader: DatabaseCommonInteractionProps | null,
  ): DataPipelineLineageReader {
    return {
      readPipelineEdges: async (data: {
        dataPipelineId: string;
        limit: number;
      }): Promise<Array<DataLineageEdgeRow>> => {
        const found: Array<DataAssetLineage> =
          await DataAssetLineageService.findBy({
            query: {
              projectId,
              dataPipelineId: new ObjectID(data.dataPipelineId),
            },
            select: {
              upstreamDataAssetId: true,
              downstreamDataAssetId: true,
              dataPipelineId: true,
              source: true,
              lastSeenAt: true,
            },
            sort: { lastSeenAt: SortOrder.Descending },
            limit: Math.max(1, data.limit),
            skip: 0,
            props: { isRoot: true },
          });

        return found
          .filter((edge: DataAssetLineage): boolean => {
            return Boolean(edge.downstreamDataAssetId);
          })
          .map(toEdgeRow);
      },

      readEdges: async (data: {
        direction: DataLineageDirection;
        dataAssetIds: Array<string>;
        limit: number;
      }): Promise<Array<DataLineageEdgeRow>> => {
        const rows: Array<DataLineageEdgeRow> = [];

        for (const ids of chunked(data.dataAssetIds, READ_CHUNK)) {
          const within: Includes = new Includes(
            ids.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          );
          const found: Array<DataAssetLineage> =
            await DataAssetLineageService.findBy({
              query:
                data.direction === DataLineageDirection.Upstream
                  ? { projectId, downstreamDataAssetId: within }
                  : { projectId, upstreamDataAssetId: within },
              select: {
                upstreamDataAssetId: true,
                downstreamDataAssetId: true,
                dataPipelineId: true,
                source: true,
                lastSeenAt: true,
              },
              sort: { lastSeenAt: SortOrder.Descending },
              limit: Math.max(1, data.limit - rows.length),
              skip: 0,
              props: { isRoot: true },
            });

          for (const edge of found) {
            if (!edge.downstreamDataAssetId) {
              continue;
            }

            rows.push(toEdgeRow(edge));
          }

          if (rows.length >= data.limit) {
            break;
          }
        }

        return rows;
      },

      readTables: async (
        dataAssetIds: Array<string>,
      ): Promise<Array<DataLineageTableRow>> => {
        const tables: Array<DataLineageTableRow> = [];

        for (const ids of chunked(dataAssetIds, READ_CHUNK)) {
          const found: Array<DataAsset> = await DataAssetService.findBy({
            query: {
              projectId,
              _id: new Includes(
                ids.map((id: string): ObjectID => {
                  return new ObjectID(id);
                }),
              ),
            },
            select: {
              _id: true,
              assetKey: true,
              name: true,
              dataStoreName: true,
              assetKind: true,
              lastChangedAt: true,
              updateIntervalInSeconds: true,
              isDropped: true,
            },
            limit: ids.length,
            skip: 0,
            props: { isRoot: true },
          });

          for (const asset of found) {
            if (!asset.id) {
              continue;
            }

            tables.push({
              dataAssetId: asset.id.toString(),
              assetKey: asset.assetKey || "",
              name: asset.name || null,
              database: asset.dataStoreName || null,
              assetKind: isDataAssetKind(asset.assetKind)
                ? asset.assetKind
                : null,
              lastChangedAt: readDate(asset.lastChangedAt),
              updateIntervalInSeconds:
                typeof asset.updateIntervalInSeconds === "number"
                  ? asset.updateIntervalInSeconds
                  : null,
              isDropped: Boolean(asset.isDropped),
            });
          }
        }

        return tables;
      },

      readPipelines: async (
        dataPipelineIds: Array<string>,
      ): Promise<Array<DataLineagePipelineRow>> => {
        const pipelines: Array<DataLineagePipelineRow> = [];

        for (const ids of chunked(dataPipelineIds, READ_CHUNK)) {
          const found: Array<DataPipeline> = await DataPipelineService.findBy({
            query: {
              projectId,
              _id: new Includes(
                ids.map((id: string): ObjectID => {
                  return new ObjectID(id);
                }),
              ),
            },
            select: {
              _id: true,
              jobName: true,
              jobNamespace: true,
              lastRunState: true,
              lastRunStartedAt: true,
              lastErrorMessage: true,
            },
            limit: ids.length,
            skip: 0,
            props: { isRoot: true },
          });

          for (const pipeline of found) {
            if (!pipeline.id) {
              continue;
            }

            pipelines.push({
              dataPipelineId: pipeline.id.toString(),
              jobName: pipeline.jobName || "",
              jobNamespace: pipeline.jobNamespace || null,
              lastRunState: pipeline.lastRunState || null,
              lastRunStartedAt: readDate(pipeline.lastRunStartedAt),
              lastErrorMessage: pipeline.lastErrorMessage || null,
            });
          }
        }

        return pipelines;
      },

      readOpenAlertCounts: async (
        dataAssetIds: Array<string>,
      ): Promise<Map<string, number>> => {
        const counts: Map<string, number> = new Map();

        if (dataAssetIds.length === 0) {
          return counts;
        }

        // Which table each data alert is about, the newest first.
        const tableOfAlert: Map<string, string> = new Map();

        for (const ids of chunked(dataAssetIds, READ_CHUNK)) {
          const rows: Array<DataAlert> = await DataAlertService.findBy({
            query: {
              projectId,
              dataAssetId: new Includes(
                ids.map((id: string): ObjectID => {
                  return new ObjectID(id);
                }),
              ),
            },
            select: { alertId: true, dataAssetId: true },
            sort: { createdAt: SortOrder.Descending },
            limit: MAX_DATA_ALERT_ROWS,
            skip: 0,
            props: { isRoot: true },
          });

          for (const row of rows) {
            if (row.alertId && row.dataAssetId) {
              tableOfAlert.set(
                row.alertId.toString(),
                row.dataAssetId.toString(),
              );
            }
          }
        }

        if (tableOfAlert.size === 0) {
          return counts;
        }

        /*
         * Still open - in a state the project does not count as resolved -
         * and only the ones the reader may see: a person's own privacy
         * clause, or for nobody in particular (or a run read as root) the
         * clause of a reader who is no one: the alerts that are not private.
         */
        const privacyReader: DatabaseCommonInteractionProps =
          reader && !reader.isRoot ? reader : {};
        const unresolvedStateIds: Array<ObjectID> =
          await AlertStateService.getUnresolvedAlertStateIds(projectId);

        if (unresolvedStateIds.length === 0) {
          return counts;
        }

        for (const ids of chunked(
          Array.from(tableOfAlert.keys()),
          READ_CHUNK,
        )) {
          const open: Array<Alert> = await AlertService.findBy({
            query: applyAlertSelfPrivacyFilter(
              {
                projectId,
                _id: QueryHelper.any(ids),
                currentAlertStateId: QueryHelper.any(unresolvedStateIds),
              },
              privacyReader,
            ),
            select: { _id: true },
            limit: ids.length,
            skip: 0,
            props: { isRoot: true },
          });

          for (const alert of open) {
            const tableId: string | undefined = tableOfAlert.get(
              alert.id?.toString() || "",
            );

            if (tableId) {
              counts.set(tableId, (counts.get(tableId) || 0) + 1);
            }
          }
        }

        return counts;
      },

      readDashboards: async (data: {
        dataAssetIds: Array<string>;
        limit: number;
        drawnDataAssetIds?: Array<string> | undefined;
      }): Promise<{
        dashboards: Array<DataLineageDashboardRow>;
        total: number;
      }> => {
        if (data.dataAssetIds.length === 0) {
          return { dashboards: [], total: 0 };
        }

        const asked: Set<string> = new Set([
          ...data.dataAssetIds,
          ...(data.drawnDataAssetIds || []),
        ]);
        const query: Query<DataDashboard> = {
          projectId,
          _id: QueryHelper.anyOfEntitiesInManyToMany({
            values: data.dataAssetIds.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
            joinTableName: "DataDashboardDataAsset",
            ownerColumnName: "dataDashboardId",
            relationColumnName: "dataAssetId",
          }),
        };
        const [found, total] = await Promise.all([
          DataDashboardService.findBy({
            query,
            select: {
              _id: true,
              name: true,
              tool: true,
              url: true,
              dataAssets: { _id: true },
            },
            sort: { name: SortOrder.Ascending },
            limit: data.limit,
            skip: 0,
            props: { isRoot: true },
          }),
          DataDashboardService.countBy({
            query,
            props: { isRoot: true },
          }),
        ]);

        return {
          dashboards: (found as Array<DataDashboard>)
            .filter((dashboard: DataDashboard): boolean => {
              return Boolean(dashboard.id);
            })
            .map((dashboard: DataDashboard): DataLineageDashboardRow => {
              return {
                dataDashboardId: dashboard.id!.toString(),
                name: dashboard.name || "",
                tool: dashboard.tool || null,
                url: dashboard.url || null,
                dataAssetIds: (dashboard.dataAssets || [])
                  .map((asset: DataAsset): string => {
                    return asset._id?.toString() || "";
                  })
                  .filter((id: string): boolean => {
                    return asked.has(id);
                  }),
              };
            }),
          total: total.toNumber(),
        };
      },

      readColumnMappings: async (
        pairs: Array<DataLineageTablePair>,
      ): Promise<Map<string, Array<DataColumnMapping>>> => {
        const columns: Map<string, Array<DataColumnMapping>> = new Map();

        if (pairs.length === 0) {
          return columns;
        }

        const wanted: Set<string> = new Set(pairs.map(getLineageTablePairKey));
        const asIds: (ids: Array<string>) => Includes = (
          ids: Array<string>,
        ): Includes => {
          return new Includes(
            Array.from(new Set(ids)).map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          );
        };
        // Every row of the arrows asked about that names columns: rows of other arrows between these tables are left out.
        const found: Array<DataAssetLineage> =
          await DataAssetLineageService.findBy({
            query: {
              projectId,
              upstreamDataAssetId: asIds(
                pairs.map((pair: DataLineageTablePair): string => {
                  return pair.upstreamDataAssetId;
                }),
              ),
              downstreamDataAssetId: asIds(
                pairs.map((pair: DataLineageTablePair): string => {
                  return pair.downstreamDataAssetId;
                }),
              ),
              columnMappings: QueryHelper.notNull(),
            },
            select: {
              upstreamDataAssetId: true,
              downstreamDataAssetId: true,
              columnMappings: true,
            },
            sort: { lastSeenAt: SortOrder.Descending },
            limit: MAX_DATA_LINEAGE_EDGE_ROWS,
            skip: 0,
            props: { isRoot: true },
          });

        for (const row of found) {
          if (!row.upstreamDataAssetId || !row.downstreamDataAssetId) {
            continue;
          }

          const key: string = getLineageTablePairKey({
            upstreamDataAssetId: row.upstreamDataAssetId.toString(),
            downstreamDataAssetId: row.downstreamDataAssetId.toString(),
          });

          if (!wanted.has(key)) {
            continue;
          }

          const merged: Array<DataColumnMapping> = mergeColumnMappings(
            columns.get(key),
            row.columnMappings,
          );

          if (merged.length > 0) {
            columns.set(key, merged);
          }
        }

        return columns;
      },
    };
  }
}
