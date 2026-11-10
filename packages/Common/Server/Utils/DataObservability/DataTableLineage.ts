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
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  DataTableLineagePipeline,
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
 */

// The most lineage edges read at one step on one side.
export const MAX_DATA_LINEAGE_EDGE_ROWS: number = 5000;

// The most ids one read names.
const READ_CHUNK: number = 500;

// The most data alerts read to count a drawing's open alerts.
const MAX_DATA_ALERT_ROWS: number = 5000;

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
  // The tables it reads, of those it was asked about.
  dataAssetIds: Array<string>;
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
  }): Promise<{ dashboards: Array<DataLineageDashboardRow>; total: number }>;
}

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
  }): Promise<DataTableLineage | null> {
    return await this.build({
      focusDataAssetId: data.dataAssetId.toString(),
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
  }): Promise<DataTableLineage | null> {
    const depth: number = Math.min(
      MAX_DATA_LINEAGE_DEPTH,
      Math.max(1, Math.floor(data.depth)),
    );
    const focusId: string = data.focusDataAssetId;
    const state: WalkState = {
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

    await this.readMissingTables(data.reader, state, [focusId]);

    if (!state.tables.has(focusId)) {
      return null;
    }

    state.placed.set(focusId, { side: DataLineageSide.Focus, depth: 0 });

    await this.walk({
      direction: DataLineageDirection.Upstream,
      focusId,
      depth,
      now: data.now,
      reader: data.reader,
      state,
    });
    await this.walk({
      direction: DataLineageDirection.Downstream,
      focusId,
      depth,
      now: data.now,
      reader: data.reader,
      state,
    });

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

    const nodes: Array<DataTableLineageNode> = [];
    const edges: Array<DataTableLineageEdge> = [];

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
      const source: string = getLineageTableNodeId(edge.upstreamDataAssetId);
      const target: string = getLineageTableNodeId(edge.downstreamDataAssetId);

      edges.push({
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
      });
    }

    this.addWriters({ state, nodes, edges });

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
      focusNodeId: getLineageTableNodeId(focusId),
      depth,
      nodes,
      edges,
      hiddenDashboardCount,
      isTruncated: state.isTruncated,
    };
  }

  // One side of the table, a step at a time.
  private static async walk(data: {
    direction: DataLineageDirection;
    focusId: string;
    depth: number;
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
    let placedOnSide: number = 0;
    let frontier: Array<string> = [data.focusId];

    for (let step: number = 1; frontier.length > 0; step++) {
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
        for (const parent of frontier) {
          const ofParent: Map<string, FeedsEdge> | undefined =
            neighbours.get(parent);

          if (!ofParent) {
            continue;
          }

          let drawn: number = 0;

          for (const neighbour of this.rankNeighbours({
            state,
            edges: ofParent,
            now: data.now,
          })) {
            if (state.placed.has(neighbour)) {
              continue;
            }

            if (chosen.has(neighbour)) {
              drawn++;
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

  /*
   * The pipelines that bring data into the upstream side from outside what
   * OneUptime watches: a pipeline whose writes rows name a drawn table (or
   * the table itself) and that is on no edge into it from a watched table.
   * One card per pipeline, a step before the first table it writes.
   */
  private static addWriters(data: {
    state: WalkState;
    nodes: Array<DataTableLineageNode>;
    edges: Array<DataTableLineageEdge>;
  }): void {
    const state: WalkState = data.state;
    const cards: Map<string, DataTableLineageNode> = new Map();

    for (const [tableId, placed] of state.placed) {
      const writers: Map<string, Writer> | undefined =
        state.writers.get(tableId);

      if (placed.side === DataLineageSide.Downstream || !writers) {
        continue;
      }

      const feeding: Set<string> =
        state.feedingPipelines.get(tableId) || new Set();
      const outside: Array<OutsideWriter> = [];

      for (const writer of writers.values()) {
        const pipeline: DataLineagePipelineRow | undefined =
          state.pipelines.get(writer.dataPipelineId);

        if (pipeline && !feeding.has(writer.dataPipelineId)) {
          outside.push({ pipeline, writer });
        }
      }

      outside.sort((a: OutsideWriter, b: OutsideWriter): number => {
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
          const node: DataTableLineageNode = {
            id: nodeId,
            kind: DataLineageNodeKind.Pipeline,
            side: DataLineageSide.Upstream,
            depth: placed.depth - 1,
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
  ): DataLineageReader {
    return {
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

            rows.push({
              upstreamDataAssetId: edge.upstreamDataAssetId?.toString() || null,
              downstreamDataAssetId: edge.downstreamDataAssetId.toString(),
              dataPipelineId: edge.dataPipelineId?.toString() || null,
              source: isDataAssetLineageSource(edge.source)
                ? edge.source
                : null,
              lastSeenAt: readDate(edge.lastSeenAt),
            });
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
      }): Promise<{
        dashboards: Array<DataLineageDashboardRow>;
        total: number;
      }> => {
        if (data.dataAssetIds.length === 0) {
          return { dashboards: [], total: 0 };
        }

        const asked: Set<string> = new Set(data.dataAssetIds);
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
    };
  }
}
