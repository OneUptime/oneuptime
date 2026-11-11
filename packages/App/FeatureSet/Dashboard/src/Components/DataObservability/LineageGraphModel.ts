import { DataAssetFreshness } from "Common/Types/DataObservability/DataAssetFreshness";
import DataAssetLineageSource from "Common/Types/DataObservability/DataAssetLineageSource";
import { DataColumnMapping } from "Common/Types/DataObservability/DataColumnLineage";
import {
  DataLineageDrawnTable,
  DataLineageExpandRequest,
  DataLineageExpansion,
} from "Common/Types/DataObservability/DataLineageExpansion";
import {
  DataLineageEdgeKind,
  DataLineageHighlight,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  DataTableLineagePipeline,
  MAX_DATA_LINEAGE_TABLES_PER_SIDE,
  getLineagePipelineNodeId,
  isFailedLineageRunState,
  isLineagePipelineNodeId,
  isRunningLineageRunState,
} from "Common/Types/DataObservability/DataTableLineage";

/*
 * WHERE EACH CARD OF A TABLE'S LINEAGE DIAGRAM SITS, AND HOW IT LOOKS.
 *
 * The diagram reads left to right, as data flows: what the table is built
 * from on the left, the table in the middle, what is built from it on the
 * right. Each card's column is how many steps it is from the table along
 * the longest way there, not the shortest, so every arrow points right: a
 * table that feeds both the table and one of its sources sits left of that
 * source. Pipelines that bring data in from outside sit a column before
 * the first table they write, dashboards a column after the last table
 * they read.
 *
 * A pipeline's drawing reads the same way with the pipeline in the middle:
 * the tables it reads on the left, the tables it writes on the right.
 *
 * Within a column, cards line up with the cards they are joined to: the
 * columns are arranged from the table outwards, then back, then outwards
 * again, each card wanting the height of its neighbours on the side already
 * arranged, as close as the cards' spacing allows (an isotonic fit, so
 * cards never overlap and keep their order). The table itself never moves.
 *
 * Pure and deterministic: the same lineage always draws the same way.
 */

export const LINEAGE_CARD_WIDTH: number = 216;
// The room a card is given in its column; a card is never taller.
export const LINEAGE_CARD_HEIGHT: number = 84;
// Room between columns for a failed pipeline's name on its arrow.
export const LINEAGE_COLUMN_GAP: number = 96;
export const LINEAGE_EDGE_LABEL_MAX_WIDTH: number = LINEAGE_COLUMN_GAP - 12;
export const LINEAGE_ROW_GAP: number = 16;

// The room around the drawing when it is fitted, as React Flow counts it.
export const LINEAGE_FIT_PADDING: number = 0.12;

// The least zoom the diagram opens at: below it a card's name is too small to read.
export const LINEAGE_READABLE_ZOOM: number = 0.75;

const ROW: number = LINEAGE_CARD_HEIGHT + LINEAGE_ROW_GAP;
const COLUMN: number = LINEAGE_CARD_WIDTH + LINEAGE_COLUMN_GAP;

export interface LineagePoint {
  x: number;
  y: number;
}

export interface LineageViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface LineageLayout {
  // Each card's top left corner.
  positions: Map<string, LineagePoint>;
  // Each card's column: 0 for the table, negative upstream.
  columns: Map<string, number>;
  width: number;
  height: number;
}

// How a card looks, the worst it can say first.
export enum LineageTone {
  Problem = "Problem",
  Running = "Running",
  Healthy = "Healthy",
  Dropped = "Dropped",
  Neutral = "Neutral",
}

export interface LineageEdgeStyle {
  color: string;
  width: number;
  // An SVG dash pattern, or null for a solid line.
  dash: string | null;
  // The pipeline whose failed run the arrow carries, to name on it.
  failedPipeline: DataTableLineagePipeline | null;
}

export interface LineageSummary {
  upstreamTables: number;
  downstreamTables: number;
  dashboards: number;
  // Tables and pipelines with a problem on each side, the table itself not counted.
  upstreamProblems: number;
  downstreamProblems: number;
}

// Which page a drawing is on: what its own card says, whether it opens, what its counts tell.
export enum LineagePlace {
  // A table's Lineage tab: the table is the page.
  Table = "Table",
  // A pipeline's page: the pipeline is the page.
  Pipeline = "Pipeline",
  // A data alert's page: its table or pipeline opens its own page.
  Alert = "Alert",
}

// A card at the end of a way an alert's drawing picks out.
export enum LineageCardRole {
  // Where the alert's cause is.
  Cause = "Cause",
  // Where an alert it caused is.
  Consequence = "Consequence",
}

// A pipeline named on an arrow.
export interface LineageEdgeLabel {
  pipeline: DataTableLineagePipeline;
  // Its latest run failed (red); otherwise it is on an alert's way (indigo).
  isFailed: boolean;
}

// How an arrow is drawn, all told.
export interface LineageArrowLook {
  color: string;
  width: number;
  dash: string | null;
  label: LineageEdgeLabel | null;
  // On an alert's way: drawn over a halo.
  isHighlighted: boolean;
  // Off the ways a drawing picks out: drawn faint.
  isDimmed: boolean;
}

// The ways a drawing picks out, to look things up in.
export interface LineageHighlightSets {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  causeNodeIds: Set<string>;
  consequenceNodeIds: Set<string>;
  dataPipelineIds: Set<string>;
}

export const LINEAGE_NEUTRAL_COLOR: string = "#94a3b8";
export const LINEAGE_READS_COLOR: string = "#cbd5e1";
export const LINEAGE_PROBLEM_COLOR: string = "#ef4444";
export const LINEAGE_HEALTHY_COLOR: string = "#22c55e";
export const LINEAGE_RUNNING_COLOR: string = "#eab308";
// The ways an alert's drawing picks out: indigo, as the drawing's own card is ringed.
export const LINEAGE_HIGHLIGHT_COLOR: string = "#6366f1";
export const LINEAGE_HIGHLIGHT_WIDTH: number = 2.5;
// How faint what is off the ways is drawn.
export const LINEAGE_DIMMED_OPACITY: number = 0.4;

// A query seen moving the data: dashed. A view's definition: dotted. A pipeline's run: solid.
export const LINEAGE_QUERY_HISTORY_DASH: string = "6 4";
export const LINEAGE_VIEW_DEFINITION_DASH: string = "2 4";

export function getLineageNodeTone(node: DataTableLineageNode): LineageTone {
  if (node.kind === DataLineageNodeKind.Table) {
    if (node.isDropped) {
      return LineageTone.Dropped;
    }

    if ((node.openAlertCount || 0) > 0) {
      return LineageTone.Problem;
    }

    if (node.freshness === DataAssetFreshness.Late) {
      return LineageTone.Problem;
    }

    if (node.freshness === DataAssetFreshness.Fresh) {
      return LineageTone.Healthy;
    }

    return LineageTone.Neutral;
  }

  if (node.kind === DataLineageNodeKind.Pipeline) {
    if (isFailedLineageRunState(node.lastRunState)) {
      return LineageTone.Problem;
    }

    if (isRunningLineageRunState(node.lastRunState)) {
      return LineageTone.Running;
    }

    if (node.lastRunState === "COMPLETE") {
      return LineageTone.Healthy;
    }
  }

  return LineageTone.Neutral;
}

export function getLineageToneColor(tone: LineageTone): string {
  switch (tone) {
    case LineageTone.Problem:
      return LINEAGE_PROBLEM_COLOR;
    case LineageTone.Running:
      return LINEAGE_RUNNING_COLOR;
    case LineageTone.Healthy:
      return LINEAGE_HEALTHY_COLOR;
    default:
      return LINEAGE_NEUTRAL_COLOR;
  }
}

export function getLineageEdgeStyle(
  edge: DataTableLineageEdge,
): LineageEdgeStyle {
  const failedPipeline: DataTableLineagePipeline | null =
    edge.pipelines.find((pipeline: DataTableLineagePipeline): boolean => {
      return isFailedLineageRunState(pipeline.lastRunState);
    }) || null;

  // A dashboard's read: light. A pipeline's read of a table is drawn as any other arrow into it.
  if (
    edge.kind === DataLineageEdgeKind.Reads &&
    !isLineagePipelineNodeId(edge.target)
  ) {
    return {
      color: LINEAGE_READS_COLOR,
      width: 1.25,
      dash: null,
      failedPipeline: null,
    };
  }

  let dash: string | null = null;

  if (
    edge.kind === DataLineageEdgeKind.Feeds &&
    !edge.seenIn.includes(DataAssetLineageSource.Pipeline)
  ) {
    if (edge.seenIn.includes(DataAssetLineageSource.QueryHistory)) {
      dash = LINEAGE_QUERY_HISTORY_DASH;
    } else if (edge.seenIn.includes(DataAssetLineageSource.ViewDefinition)) {
      dash = LINEAGE_VIEW_DEFINITION_DASH;
    }
  }

  return {
    color: failedPipeline ? LINEAGE_PROBLEM_COLOR : LINEAGE_NEUTRAL_COLOR,
    width: failedPipeline ? 2.25 : 1.5,
    dash,
    failedPipeline,
  };
}

// The ways a drawing picks out, as sets; null when it picks none.
export function getLineageHighlightSets(
  lineage: DataTableLineage,
): LineageHighlightSets | null {
  const highlight: DataLineageHighlight | undefined = lineage.highlight;

  if (!highlight || highlight.nodeIds.length === 0) {
    return null;
  }

  return {
    nodeIds: new Set(highlight.nodeIds),
    edgeIds: new Set(highlight.edgeIds),
    causeNodeIds: new Set(highlight.causeNodeIds),
    consequenceNodeIds: new Set(highlight.consequenceNodeIds),
    dataPipelineIds: new Set(highlight.dataPipelineIds),
  };
}

// Where a card is on an alert's ways: its cause, an alert it caused, or neither.
export function getLineageCardRole(
  sets: LineageHighlightSets | null,
  nodeId: string,
): LineageCardRole | null {
  if (sets?.causeNodeIds.has(nodeId)) {
    return LineageCardRole.Cause;
  }

  if (sets?.consequenceNodeIds.has(nodeId)) {
    return LineageCardRole.Consequence;
  }

  return null;
}

// Whether a card is drawn faint: off every way a drawing picks out.
export function isLineageCardDimmed(
  sets: LineageHighlightSets | null,
  nodeId: string,
): boolean {
  return Boolean(sets && !sets.nodeIds.has(nodeId));
}

/*
 * The pipeline an arrow names: one whose latest run failed, or - on an
 * alert's way - the pipeline that is its cause or an alert it caused. Never
 * a pipeline that has its own card at the arrow's start, or that the
 * drawing is about: its card already says how it is.
 */
export function getLineageEdgeLabel(
  edge: DataTableLineageEdge,
  focusNodeId: string,
  sets: LineageHighlightSets | null,
): LineageEdgeLabel | null {
  const hasOwnCard: (pipeline: DataTableLineagePipeline) => boolean = (
    pipeline: DataTableLineagePipeline,
  ): boolean => {
    const card: string = getLineagePipelineNodeId(pipeline.dataPipelineId);

    return edge.source === card || focusNodeId === card;
  };

  const failed: DataTableLineagePipeline | undefined = edge.pipelines.find(
    (pipeline: DataTableLineagePipeline): boolean => {
      return (
        isFailedLineageRunState(pipeline.lastRunState) && !hasOwnCard(pipeline)
      );
    },
  );

  if (failed) {
    return { pipeline: failed, isFailed: true };
  }

  if (sets?.edgeIds.has(edge.id)) {
    const named: DataTableLineagePipeline | undefined = edge.pipelines.find(
      (pipeline: DataTableLineagePipeline): boolean => {
        return (
          sets.dataPipelineIds.has(pipeline.dataPipelineId) &&
          !hasOwnCard(pipeline)
        );
      },
    );

    if (named) {
      return { pipeline: named, isFailed: false };
    }
  }

  return null;
}

/*
 * How an arrow is drawn: by where it was seen and whether its pipeline
 * failed (getLineageEdgeStyle), and on an alert's drawing, picked out in
 * indigo - red still red - when it is on a way, faint when it is not.
 */
export function getLineageArrowLook(
  edge: DataTableLineageEdge,
  focusNodeId: string,
  sets: LineageHighlightSets | null,
): LineageArrowLook {
  const style: LineageEdgeStyle = getLineageEdgeStyle(edge);
  const isHighlighted: boolean = Boolean(sets?.edgeIds.has(edge.id));

  return {
    color:
      isHighlighted && !style.failedPipeline
        ? LINEAGE_HIGHLIGHT_COLOR
        : style.color,
    width: isHighlighted
      ? Math.max(style.width, LINEAGE_HIGHLIGHT_WIDTH)
      : style.width,
    dash: style.dash,
    label: getLineageEdgeLabel(edge, focusNodeId, sets),
    isHighlighted,
    isDimmed: Boolean(sets) && !isHighlighted,
  };
}

/*
 * A pipeline's drawing: how many tables it reads and writes, those not
 * drawn included - the arrows into and out of its card, and the counts on
 * its card.
 */
export function countPipelineTables(lineage: DataTableLineage): {
  reads: number;
  writes: number;
} {
  const focus: DataTableLineageNode | undefined = lineage.nodes.find(
    (node: DataTableLineageNode): boolean => {
      return node.id === lineage.focusNodeId;
    },
  );
  let reads: number = focus?.hiddenUpstreamCount || 0;
  let writes: number = focus?.hiddenDownstreamCount || 0;

  for (const edge of lineage.edges) {
    if (
      edge.kind === DataLineageEdgeKind.Reads &&
      edge.target === lineage.focusNodeId
    ) {
      reads++;
    }

    if (
      edge.kind === DataLineageEdgeKind.Writes &&
      edge.source === lineage.focusNodeId
    ) {
      writes++;
    }
  }

  return { reads, writes };
}

// Only the table itself: nothing has been seen feeding it or built from it.
export function isLineageEmpty(lineage: DataTableLineage): boolean {
  return lineage.nodes.every((node: DataTableLineageNode): boolean => {
    return node.id === lineage.focusNodeId;
  });
}

export function summarizeLineage(lineage: DataTableLineage): LineageSummary {
  const summary: LineageSummary = {
    upstreamTables: 0,
    downstreamTables: 0,
    dashboards: 0,
    upstreamProblems: 0,
    downstreamProblems: 0,
  };

  for (const node of lineage.nodes) {
    const hasProblem: boolean =
      getLineageNodeTone(node) === LineageTone.Problem;

    if (node.kind === DataLineageNodeKind.Dashboard) {
      summary.dashboards++;
      continue;
    }

    if (node.side === DataLineageSide.Upstream) {
      if (node.kind === DataLineageNodeKind.Table) {
        summary.upstreamTables++;
      }

      if (hasProblem) {
        summary.upstreamProblems++;
      }
    } else if (node.side === DataLineageSide.Downstream) {
      summary.downstreamTables++;

      if (hasProblem) {
        summary.downstreamProblems++;
      }
    }
  }

  return summary;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/*
 * Each card's column. Upstream, the longest way to the table along the
 * arrows between upstream tables (a cycle among them is cut where the walk
 * meets it); downstream, the longest way from it. A card no such way
 * reaches keeps the steps the lineage gave it. On a pipeline's drawing the
 * arrows into and out of the pipeline are the first steps of those ways.
 */
export function getLineageColumns(
  lineage: DataTableLineage,
): Map<string, number> {
  const columns: Map<string, number> = new Map();
  const byId: Map<string, DataTableLineageNode> = new Map();

  for (const node of lineage.nodes) {
    byId.set(node.id, node);
  }

  const focus: string = lineage.focusNodeId;
  const isSide: (id: string, side: DataLineageSide) => boolean = (
    id: string,
    side: DataLineageSide,
  ): boolean => {
    const node: DataTableLineageNode | undefined = byId.get(id);

    return Boolean(
      node && node.kind === DataLineageNodeKind.Table && node.side === side,
    );
  };

  // Upstream: from each upstream table, its arrows to upstream tables or the table.
  const toward: Map<string, Array<string>> = new Map();
  // Downstream: into each downstream table, its arrows from downstream tables or the table.
  const from: Map<string, Array<string>> = new Map();

  for (const edge of lineage.edges) {
    // A pipeline's own arrows: what it reads into it, what it writes out of it.
    const isFocusRead: boolean =
      edge.kind === DataLineageEdgeKind.Reads && edge.target === focus;
    const isFocusWrite: boolean =
      edge.kind === DataLineageEdgeKind.Writes && edge.source === focus;

    if (
      edge.kind !== DataLineageEdgeKind.Feeds &&
      !isFocusRead &&
      !isFocusWrite
    ) {
      continue;
    }

    if (
      isSide(edge.source, DataLineageSide.Upstream) &&
      (edge.target === focus || isSide(edge.target, DataLineageSide.Upstream))
    ) {
      toward.set(edge.source, [
        ...(toward.get(edge.source) || []),
        edge.target,
      ]);
    }

    if (
      isSide(edge.target, DataLineageSide.Downstream) &&
      (edge.source === focus || isSide(edge.source, DataLineageSide.Downstream))
    ) {
      from.set(edge.target, [...(from.get(edge.target) || []), edge.source]);
    }
  }

  const longest: (
    adjacency: Map<string, Array<string>>,
  ) => (id: string) => number | null = (
    adjacency: Map<string, Array<string>>,
  ) => {
    const memo: Map<string, number | null> = new Map();
    const onWay: Set<string> = new Set();

    const walk: (id: string) => number | null = (id: string): number | null => {
      if (id === focus) {
        return 0;
      }

      if (memo.has(id)) {
        return memo.get(id)!;
      }

      if (onWay.has(id)) {
        return null;
      }

      onWay.add(id);

      let best: number | null = null;

      for (const next of [...(adjacency.get(id) || [])].sort(compareText)) {
        const steps: number | null = walk(next);

        if (steps !== null && (best === null || steps + 1 > best)) {
          best = steps + 1;
        }
      }

      onWay.delete(id);
      memo.set(id, best);

      return best;
    };

    return walk;
  };

  const upstreamSteps: (id: string) => number | null = longest(toward);
  const downstreamSteps: (id: string) => number | null = longest(from);

  columns.set(focus, 0);

  for (const node of lineage.nodes) {
    if (node.kind !== DataLineageNodeKind.Table || node.id === focus) {
      continue;
    }

    if (node.side === DataLineageSide.Upstream) {
      const steps: number | null = upstreamSteps(node.id);

      columns.set(node.id, -Math.max(1, steps ?? Math.abs(node.depth)));
    } else {
      const steps: number | null = downstreamSteps(node.id);

      columns.set(node.id, Math.max(1, steps ?? Math.abs(node.depth)));
    }
  }

  // A pipeline a column before the first table it writes, a dashboard a column after the last it reads.
  for (const edge of lineage.edges) {
    // The pipeline a drawing is about stays in the middle.
    if (
      (edge.kind === DataLineageEdgeKind.Writes && edge.source === focus) ||
      (edge.kind === DataLineageEdgeKind.Reads && edge.target === focus)
    ) {
      continue;
    }

    const tableColumn: number | undefined = columns.get(
      edge.kind === DataLineageEdgeKind.Writes ? edge.target : edge.source,
    );

    if (tableColumn === undefined) {
      continue;
    }

    if (edge.kind === DataLineageEdgeKind.Writes) {
      const column: number = Math.min(-1, tableColumn - 1);
      const kept: number | undefined = columns.get(edge.source);

      columns.set(
        edge.source,
        kept === undefined ? column : Math.min(kept, column),
      );
    }

    if (edge.kind === DataLineageEdgeKind.Reads) {
      const column: number = Math.max(1, tableColumn + 1);
      const kept: number | undefined = columns.get(edge.target);

      columns.set(
        edge.target,
        kept === undefined ? column : Math.max(kept, column),
      );
    }
  }

  for (const node of lineage.nodes) {
    if (!columns.has(node.id)) {
      columns.set(
        node.id,
        node.side === DataLineageSide.Upstream
          ? Math.min(-1, node.depth)
          : Math.max(1, node.depth),
      );
    }
  }

  return columns;
}

/*
 * The heights closest to the ones wanted, in the order given, at least a
 * row apart: pool adjacent violators on the wanted heights less each card's
 * row, which keeps order and spacing and moves the cards as little as can
 * be (least squares).
 */
export function fitHeights(wanted: Array<number>, row: number): Array<number> {
  const blocks: Array<{ sum: number; count: number }> = [];

  wanted.forEach((height: number, index: number): void => {
    blocks.push({ sum: height - index * row, count: 1 });

    while (blocks.length > 1) {
      const last: { sum: number; count: number } = blocks[blocks.length - 1]!;
      const before: { sum: number; count: number } = blocks[blocks.length - 2]!;

      if (before.sum / before.count <= last.sum / last.count) {
        break;
      }

      blocks.pop();
      before.sum += last.sum;
      before.count += last.count;
    }
  });

  const heights: Array<number> = [];

  for (const block of blocks) {
    const value: number = block.sum / block.count;

    for (let index: number = 0; index < block.count; index++) {
      heights.push(value + heights.length * row);
    }
  }

  return heights;
}

// A card in its column, and where it was before the column was arranged.
interface PlacedCard {
  id: string;
  index: number;
}

export function layoutLineage(lineage: DataTableLineage): LineageLayout {
  const columns: Map<string, number> = getLineageColumns(lineage);
  const order: Map<number, Array<string>> = new Map();

  // First in each column as the lineage lists them: nearest and worst first.
  for (const node of lineage.nodes) {
    const column: number = columns.get(node.id)!;
    order.set(column, [...(order.get(column) || []), node.id]);
  }

  const neighbours: Map<string, Array<string>> = new Map();

  for (const edge of lineage.edges) {
    if (!columns.has(edge.source) || !columns.has(edge.target)) {
      continue;
    }

    neighbours.set(edge.source, [
      ...(neighbours.get(edge.source) || []),
      edge.target,
    ]);
    neighbours.set(edge.target, [
      ...(neighbours.get(edge.target) || []),
      edge.source,
    ]);
  }

  const heights: Map<string, number> = new Map();

  // Each column stacked around the table's height to begin with.
  for (const ids of order.values()) {
    ids.forEach((id: string, index: number): void => {
      heights.set(id, (index - (ids.length - 1) / 2) * ROW);
    });
  }

  const keys: Array<number> = Array.from(order.keys());
  const minColumn: number = Math.min(0, ...keys);
  const maxColumn: number = Math.max(0, ...keys);

  // Arrange one column by its neighbours in the columns `isArranged` says are done.
  const arrange: (
    column: number,
    isArranged: (other: number) => boolean,
  ) => void = (
    column: number,
    isArranged: (other: number) => boolean,
  ): void => {
    const ids: Array<string> | undefined = order.get(column);

    if (!ids || ids.length === 0) {
      return;
    }

    const wanted: Map<string, number> = new Map();

    for (const id of ids) {
      const anchors: Array<number> = (neighbours.get(id) || [])
        .filter((other: string): boolean => {
          return isArranged(columns.get(other)!);
        })
        .map((other: string): number => {
          return heights.get(other)!;
        });

      wanted.set(
        id,
        anchors.length > 0
          ? anchors.reduce((sum: number, value: number): number => {
              return sum + value;
            }, 0) / anchors.length
          : heights.get(id)!,
      );
    }

    const sorted: Array<string> = ids
      .map((id: string, index: number): PlacedCard => {
        return { id, index };
      })
      .sort((a: PlacedCard, b: PlacedCard): number => {
        return wanted.get(a.id)! - wanted.get(b.id)! || a.index - b.index;
      })
      .map((entry: PlacedCard): string => {
        return entry.id;
      });

    const fitted: Array<number> = fitHeights(
      sorted.map((id: string): number => {
        return wanted.get(id)!;
      }),
      ROW,
    );

    sorted.forEach((id: string, index: number): void => {
      heights.set(id, fitted[index]!);
    });
    order.set(column, sorted);
  };

  const outwards: () => void = (): void => {
    for (let column: number = -1; column >= minColumn; column--) {
      arrange(column, (other: number): boolean => {
        return other > column;
      });
    }

    for (let column: number = 1; column <= maxColumn; column++) {
      arrange(column, (other: number): boolean => {
        return other < column;
      });
    }
  };

  const inwards: () => void = (): void => {
    for (let column: number = minColumn + 1; column <= -1; column++) {
      arrange(column, (other: number): boolean => {
        return other < column;
      });
    }

    for (let column: number = maxColumn - 1; column >= 1; column--) {
      arrange(column, (other: number): boolean => {
        return other > column;
      });
    }
  };

  outwards();
  inwards();
  outwards();

  let top: number = 0;
  let bottom: number = 0;

  for (const height of heights.values()) {
    top = Math.min(top, height);
    bottom = Math.max(bottom, height);
  }

  const positions: Map<string, LineagePoint> = new Map();

  for (const [id, column] of columns) {
    positions.set(id, {
      x: (column - minColumn) * COLUMN,
      y: heights.get(id)! - top,
    });
  }

  return {
    positions,
    columns,
    width: (maxColumn - minColumn) * COLUMN + LINEAGE_CARD_WIDTH,
    height: bottom - top + LINEAGE_CARD_HEIGHT,
  };
}

/*
 * The cards a drawing too wide to read whole keeps in view when it opens,
 * the most wanted first. On a data alert's drawing that is where its
 * problem started - the cause's card - then the alert's own card, then the
 * alerts it caused and the other cards on its ways, nearest first: the
 * person paged sees the cause before anything else, wherever in the chain
 * it is. On any other drawing, only the card it is about.
 */
export function getLineageCardsInView(
  lineage: DataTableLineage,
  layout: LineageLayout,
  sets: LineageHighlightSets | null,
): Array<string> {
  const focus: string = lineage.focusNodeId;

  if (!sets) {
    return [focus];
  }

  const focusColumn: number = layout.columns.get(focus) || 0;
  const stepsAway: (id: string) => number = (id: string): number => {
    return Math.abs((layout.columns.get(id) ?? focusColumn) - focusColumn);
  };
  const nearestFirst: (ids: Iterable<string>) => Array<string> = (
    ids: Iterable<string>,
  ): Array<string> => {
    return Array.from(new Set(ids))
      .filter((id: string): boolean => {
        return id !== focus && layout.positions.has(id);
      })
      .sort((a: string, b: string): number => {
        return stepsAway(a) - stepsAway(b) || compareText(a, b);
      });
  };

  const causes: Array<string> = nearestFirst(sets.causeNodeIds);
  const consequences: Array<string> = nearestFirst(
    sets.consequenceNodeIds,
  ).filter((id: string): boolean => {
    return !causes.includes(id);
  });
  const rest: Array<string> = nearestFirst(sets.nodeIds).filter(
    (id: string): boolean => {
      return !causes.includes(id) && !consequences.includes(id);
    },
  );

  return [...causes, focus, ...consequences, ...rest];
}

// A box in the drawing's own units.
interface LineageBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function getCardBox(point: LineagePoint): LineageBox {
  return {
    left: point.x,
    top: point.y,
    right: point.x + LINEAGE_CARD_WIDTH,
    bottom: point.y + LINEAGE_CARD_HEIGHT,
  };
}

/*
 * Where a box's middle may go, one way, with the box still inside the room:
 * as close to `toward` as that allows, or the box's own middle.
 */
function getLeaningMiddle(data: {
  low: number;
  high: number;
  room: number;
  toward: number | null;
}): number {
  const middle: number = (data.low + data.high) / 2;
  const slack: number = Math.max(0, (data.room - (data.high - data.low)) / 2);

  if (data.toward === null) {
    return middle;
  }

  return Math.min(middle + slack, Math.max(middle - slack, data.toward));
}

// The zoom that holds the whole drawing on a canvas of a given size, never past life size.
function getLineageFitZoom(
  layout: LineageLayout,
  width: number,
  height: number,
): number {
  return Math.min(
    1,
    width / (layout.width * (1 + LINEAGE_FIT_PADDING)),
    height / (layout.height * (1 + LINEAGE_FIT_PADDING)),
  );
}

/*
 * Where the diagram is looked at from on a canvas of a given size: the whole
 * drawing, fitted and centered, when it fits with its cards' names still
 * readable. Otherwise, at the least zoom that keeps names readable, the
 * cards it is asked to keep in view (getLineageCardsInView: the table
 * itself, unless an alert's ways say more), as many as fit, the most wanted
 * first; the view leans toward the first card that did not fit, so the way
 * to it starts on screen. The rest is a drag away, and the fit control shows
 * all of it. Null while the canvas has no size to go by.
 */
export function getLineageViewport(data: {
  layout: LineageLayout;
  focusNodeId: string;
  width: number;
  height: number;
  // The cards to keep in view, the most wanted first; the drawing's own card when none are named.
  inView?: ReadonlyArray<string> | undefined;
}): LineageViewport | null {
  if (!(data.width > 0) || !(data.height > 0)) {
    return null;
  }

  const fitZoom: number = getLineageFitZoom(
    data.layout,
    data.width,
    data.height,
  );

  if (fitZoom >= LINEAGE_READABLE_ZOOM) {
    return {
      x: (data.width - data.layout.width * fitZoom) / 2,
      y: (data.height - data.layout.height * fitZoom) / 2,
      zoom: fitZoom,
    };
  }

  const zoom: number = LINEAGE_READABLE_ZOOM;
  // The room the canvas holds at that zoom, kept clear of its edges as a fitted drawing is.
  const roomWidth: number = data.width / (zoom * (1 + LINEAGE_FIT_PADDING));
  const roomHeight: number = data.height / (zoom * (1 + LINEAGE_FIT_PADDING));
  const wanted: ReadonlyArray<string> =
    data.inView && data.inView.length > 0 ? data.inView : [data.focusNodeId];

  let shown: LineageBox | null = null;
  // The first card wanted that did not fit: the view leans toward it.
  let leftOut: LineageBox | null = null;

  for (const id of wanted) {
    const point: LineagePoint | undefined = data.layout.positions.get(id);

    if (!point) {
      continue;
    }

    const card: LineageBox = getCardBox(point);
    const joined: LineageBox = shown
      ? {
          left: Math.min(shown.left, card.left),
          top: Math.min(shown.top, card.top),
          right: Math.max(shown.right, card.right),
          bottom: Math.max(shown.bottom, card.bottom),
        }
      : card;
    const fits: boolean =
      joined.right - joined.left <= roomWidth &&
      joined.bottom - joined.top <= roomHeight;

    if (fits || !shown) {
      // A card that cannot fit even alone is still the one shown.
      shown = joined;
    } else if (!leftOut) {
      leftOut = card;
    }
  }

  // Not one card to keep in view: the drawing's middle.
  const centerX: number = shown
    ? getLeaningMiddle({
        low: shown.left,
        high: shown.right,
        room: roomWidth,
        toward: leftOut ? (leftOut.left + leftOut.right) / 2 : null,
      })
    : data.layout.width / 2;
  const centerY: number = shown
    ? getLeaningMiddle({
        low: shown.top,
        high: shown.bottom,
        room: roomHeight,
        toward: leftOut ? (leftOut.top + leftOut.bottom) / 2 : null,
      })
    : data.layout.height / 2;

  return {
    x: data.width / 2 - centerX * zoom,
    y: data.height / 2 - centerY * zoom,
    zoom,
  };
}

/*
 * DRAWING MORE OF A DRAWING WHERE IT IS (Common/Types/DataObservability/
 * DataLineageExpansion).
 *
 * A card's count of tables not drawn ("+14") draws the next of them in
 * place: the drawing asks for them naming every table and dashboard it has,
 * adds what comes back - nothing it already has - and keeps every count
 * true: the card pressed takes the count the answer gives, and each card
 * already drawn that counted a table drawn now as one it did not draw counts
 * one fewer, as a drawing read whole would have it.
 */

// The tables drawn on one side: a side holds at most MAX_DATA_LINEAGE_TABLES_PER_SIDE.
export function countLineageTables(
  lineage: DataTableLineage,
  side: DataLineageSide,
): number {
  return lineage.nodes.filter((node: DataTableLineageNode): boolean => {
    return node.kind === DataLineageNodeKind.Table && node.side === side;
  }).length;
}

/*
 * Whether a card's count of tables not drawn one way can be pressed to draw
 * them here: a table counts only its own way (the drawing's own table both),
 * a pipeline only on its own drawing, and a side already holding its most
 * tables draws no more - its count stays words, and opening the table
 * centers the diagram on it.
 */
export function canExpandLineageCard(
  lineage: DataTableLineage,
  node: DataTableLineageNode,
  side: DataLineageSide,
): boolean {
  const count: number =
    side === DataLineageSide.Upstream
      ? node.hiddenUpstreamCount || 0
      : side === DataLineageSide.Downstream
        ? node.hiddenDownstreamCount || 0
        : 0;

  if (count <= 0) {
    return false;
  }

  if (node.kind === DataLineageNodeKind.Pipeline) {
    if (node.id !== lineage.focusNodeId) {
      return false;
    }
  } else if (node.kind === DataLineageNodeKind.Table) {
    if (node.side !== DataLineageSide.Focus && node.side !== side) {
      return false;
    }
  } else {
    return false;
  }

  return countLineageTables(lineage, side) < MAX_DATA_LINEAGE_TABLES_PER_SIDE;
}

// What pressing a card's count asks: the next of its tables, naming every table and dashboard drawn.
export function getLineageExpandRequest(data: {
  lineage: DataTableLineage;
  nodeId: string;
  side: DataLineageSide;
  // The drawing was read with the columns of its arrows: the new arrows come with theirs.
  withColumns: boolean;
}): DataLineageExpandRequest {
  const tables: Array<DataLineageDrawnTable> = [];
  const dataDashboardIds: Array<string> = [];

  for (const node of data.lineage.nodes) {
    if (node.kind === DataLineageNodeKind.Table && node.dataAssetId) {
      tables.push({
        dataAssetId: node.dataAssetId,
        side: node.side,
        depth: node.depth,
      });
    }

    if (node.kind === DataLineageNodeKind.Dashboard && node.dataDashboardId) {
      dataDashboardIds.push(node.dataDashboardId);
    }
  }

  return {
    focusNodeId: data.lineage.focusNodeId,
    nodeId: data.nodeId,
    side: data.side,
    tables,
    dataDashboardIds,
    ...(data.withColumns ? { withColumns: true } : {}),
  };
}

/*
 * A drawing with the next tables of one card drawn in it. What the drawing
 * has stays as it is, where it is in the lists - the cards and arrows of
 * the answer it has already are left out, and an arrow to a card it does
 * not have is never drawn - and what is new follows. The card pressed
 * counts what the answer says it still does not draw; a card drawn before
 * that counted a table drawn now - an arrow between them its own way - and
 * the pipeline a drawing is about, for each table drawn now it reads or
 * writes, count one fewer each. A count never goes below none.
 */
export function mergeLineageExpansion(
  lineage: DataTableLineage,
  expansion: DataLineageExpansion,
): DataTableLineage {
  const nodes: Array<DataTableLineageNode> = lineage.nodes.map(
    (node: DataTableLineageNode): DataTableLineageNode => {
      return { ...node };
    },
  );
  const byId: Map<string, DataTableLineageNode> = new Map();

  for (const node of nodes) {
    byId.set(node.id, node);
  }

  const added: Set<string> = new Set();

  for (const node of expansion.nodes) {
    if (!byId.has(node.id)) {
      const copy: DataTableLineageNode = { ...node };

      nodes.push(copy);
      byId.set(copy.id, copy);
      added.add(copy.id);
    }
  }

  const edgeIds: Set<string> = new Set(
    lineage.edges.map((edge: DataTableLineageEdge): string => {
      return edge.id;
    }),
  );
  const newEdges: Array<DataTableLineageEdge> = [];

  for (const edge of expansion.edges) {
    if (
      edgeIds.has(edge.id) ||
      !byId.has(edge.source) ||
      !byId.has(edge.target)
    ) {
      continue;
    }

    edgeIds.add(edge.id);
    newEdges.push(edge);
  }

  const isUpstream: boolean = expansion.side === DataLineageSide.Upstream;
  const countsOneFewer: (
    node: DataTableLineageNode | undefined,
    way: DataLineageSide,
  ) => void = (
    node: DataTableLineageNode | undefined,
    way: DataLineageSide,
  ): void => {
    // The card pressed takes the answer's own count that way.
    if (!node || (node.id === expansion.nodeId && way === expansion.side)) {
      return;
    }

    if (way === DataLineageSide.Upstream) {
      node.hiddenUpstreamCount = Math.max(
        0,
        (node.hiddenUpstreamCount || 0) - 1,
      );
    } else {
      node.hiddenDownstreamCount = Math.max(
        0,
        (node.hiddenDownstreamCount || 0) - 1,
      );
    }
  };

  for (const edge of newEdges) {
    const isSourceNew: boolean = added.has(edge.source);
    const isTargetNew: boolean = added.has(edge.target);

    if (edge.kind === DataLineageEdgeKind.Feeds) {
      // Between a table drawn now and one drawn before: the one before counted it, its own way.
      if (isSourceNew === isTargetNew) {
        continue;
      }

      const before: DataTableLineageNode | undefined = byId.get(
        isSourceNew ? edge.target : edge.source,
      );

      if (!before || before.kind !== DataLineageNodeKind.Table) {
        continue;
      }

      if (
        isSourceNew &&
        (before.side === DataLineageSide.Upstream ||
          before.side === DataLineageSide.Focus)
      ) {
        countsOneFewer(before, DataLineageSide.Upstream);
      }

      if (
        isTargetNew &&
        (before.side === DataLineageSide.Downstream ||
          before.side === DataLineageSide.Focus)
      ) {
        countsOneFewer(before, DataLineageSide.Downstream);
      }

      continue;
    }

    // The pipeline the drawing is about, reading or writing a table drawn now.
    if (
      edge.kind === DataLineageEdgeKind.Reads &&
      edge.target === lineage.focusNodeId &&
      isSourceNew
    ) {
      countsOneFewer(byId.get(edge.target), DataLineageSide.Upstream);
    }

    if (
      edge.kind === DataLineageEdgeKind.Writes &&
      edge.source === lineage.focusNodeId &&
      isTargetNew &&
      isLineagePipelineNodeId(edge.source)
    ) {
      countsOneFewer(byId.get(edge.source), DataLineageSide.Downstream);
    }
  }

  const pressed: DataTableLineageNode | undefined = byId.get(expansion.nodeId);

  if (pressed) {
    if (isUpstream) {
      pressed.hiddenUpstreamCount = Math.max(0, expansion.hiddenCount);
    } else {
      pressed.hiddenDownstreamCount = Math.max(0, expansion.hiddenCount);
    }
  }

  return {
    ...lineage,
    nodes,
    edges: [...lineage.edges, ...newEdges].sort(
      (a: DataTableLineageEdge, b: DataTableLineageEdge): number => {
        return compareText(a.id, b.id);
      },
    ),
    hiddenDashboardCount:
      typeof expansion.hiddenDashboardCount === "number"
        ? Math.max(0, expansion.hiddenDashboardCount)
        : lineage.hiddenDashboardCount,
    isTruncated: lineage.isTruncated || expansion.isTruncated,
  };
}

/*
 * Where the diagram is looked at from once a card's tables are drawn in
 * it. A reader who has not moved the view sees the whole drawing fitted
 * again while it is still readable whole (isFitted). Otherwise the zoom
 * stays and the card pressed stays where it was on the screen - every card
 * may move as the drawing is laid out again around what is new, so the
 * view follows the card the reader is at - and then the view slides as
 * little as it can to bring the cards drawn now into view, the nearest to
 * the card pressed first, as many as fit beside it. Null while the canvas
 * has no size to go by.
 */
export function getLineageViewportAfterExpanding(data: {
  before: LineageLayout;
  after: LineageLayout;
  // Where the drawing was looked at from when the card was pressed.
  viewport: LineageViewport;
  nodeId: string;
  newNodeIds: ReadonlyArray<string>;
  focusNodeId: string;
  width: number;
  height: number;
  hasReaderMoved: boolean;
}): { viewport: LineageViewport; isFitted: boolean } | null {
  if (!(data.width > 0) || !(data.height > 0)) {
    return null;
  }

  if (
    !data.hasReaderMoved &&
    getLineageFitZoom(data.after, data.width, data.height) >=
      LINEAGE_READABLE_ZOOM
  ) {
    const fitted: LineageViewport | null = getLineageViewport({
      layout: data.after,
      focusNodeId: data.focusNodeId,
      width: data.width,
      height: data.height,
    });

    if (fitted) {
      return { viewport: fitted, isFitted: true };
    }
  }

  const zoom: number = data.viewport.zoom > 0 ? data.viewport.zoom : 1;
  const was: LineagePoint | undefined = data.before.positions.get(data.nodeId);
  const now: LineagePoint | undefined = data.after.positions.get(data.nodeId);
  let x: number = data.viewport.x;
  let y: number = data.viewport.y;

  if (!was || !now) {
    return { viewport: { x, y, zoom }, isFitted: false };
  }

  // The card pressed where it was on the screen.
  x += (was.x - now.x) * zoom;
  y += (was.y - now.y) * zoom;

  // The room in view, kept clear of the canvas's edges as a fitted drawing is.
  const roomWidth: number = data.width / (zoom * (1 + LINEAGE_FIT_PADDING));
  const roomHeight: number = data.height / (zoom * (1 + LINEAGE_FIT_PADDING));
  const anchor: LineageBox = getCardBox(now);
  const middleOf: (box: LineageBox) => LineagePoint = (
    box: LineageBox,
  ): LineagePoint => {
    return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
  };
  const from: LineagePoint = middleOf(anchor);
  const distanceOf: (id: string) => number = (id: string): number => {
    const middle: LineagePoint = middleOf(
      getCardBox(data.after.positions.get(id)!),
    );

    return Math.hypot(middle.x - from.x, middle.y - from.y);
  };
  let shown: LineageBox = anchor;

  for (const id of [...data.newNodeIds]
    .filter((id: string): boolean => {
      return data.after.positions.has(id);
    })
    .sort((a: string, b: string): number => {
      return distanceOf(a) - distanceOf(b) || compareText(a, b);
    })) {
    const card: LineageBox = getCardBox(data.after.positions.get(id)!);
    const joined: LineageBox = {
      left: Math.min(shown.left, card.left),
      top: Math.min(shown.top, card.top),
      right: Math.max(shown.right, card.right),
      bottom: Math.max(shown.bottom, card.bottom),
    };

    if (
      joined.right - joined.left <= roomWidth &&
      joined.bottom - joined.top <= roomHeight
    ) {
      shown = joined;
    }
  }

  // What is in view now, in the drawing's own units, and its room.
  const viewLeft: number = -x / zoom;
  const viewTop: number = -y / zoom;
  const marginX: number = (data.width / zoom - roomWidth) / 2;
  const marginY: number = (data.height / zoom - roomHeight) / 2;
  const roomLeft: number = viewLeft + marginX;
  const roomTop: number = viewTop + marginY;

  // Slide as little as brings it all into the room: one edge or the other, never both.
  if (shown.left < roomLeft) {
    x += (roomLeft - shown.left) * zoom;
  } else if (shown.right > roomLeft + roomWidth) {
    x -= (shown.right - (roomLeft + roomWidth)) * zoom;
  }

  if (shown.top < roomTop) {
    y += (roomTop - shown.top) * zoom;
  } else if (shown.bottom > roomTop + roomHeight) {
    y -= (shown.bottom - (roomTop + roomHeight)) * zoom;
  }

  return { viewport: { x, y, zoom }, isFitted: false };
}

/*
 * FOLLOWING ONE COLUMN UP AND DOWN THE DRAWING.
 *
 * A table's drawing read with its columns (withColumns) says on each arrow
 * between two tables which columns of one feed which of the other, where
 * its sources name them. Picking one of the table's columns follows it:
 * up the arrows into the table to the columns it is built from, and down
 * the arrows out of it to the columns built from it, as far as the drawing
 * goes. Its way is picked out as an alert's ways are (LineageHighlightSets)
 * and each card on it names the column there - renamed on the way, or
 * several, where it is built from or feeds several.
 */

export interface LineageColumnTrail {
  // The column followed, as the table names it.
  column: string;
  // By card on its way: the columns there that it is, as the arrows name them.
  columns: Map<string, Array<string>>;
  // The arrows it goes along.
  edgeIds: Set<string>;
  /*
   * An arrow into or out of a card on its way says nothing of its columns:
   * the column may go on along it, further than is picked out.
   */
  mayGoFurther: boolean;
}

/*
 * Columns are matched whatever their case: two sources may write one
 * column's name differently (Snowflake keeps unquoted names in capitals;
 * a Spark or dbt job may name them as its code does).
 */
function getColumnKey(name: string): string {
  return name.trim().toLowerCase();
}

/*
 * The columns of the drawing's own table that can be followed: those an
 * arrow into or out of it names, in the table's own order (`columnOrder`,
 * as its last collection read them) and then by name, each named as the
 * table names it. Empty when no arrow next to it names a column: nothing
 * to pick.
 */
export function getLineageColumnChoices(
  lineage: DataTableLineage,
  columnOrder: ReadonlyArray<string> = [],
): Array<string> {
  const focus: string = lineage.focusNodeId;
  const named: Map<string, string> = new Map();
  const name: (column: string) => void = (column: string): void => {
    const key: string = getColumnKey(column);

    if (key && !named.has(key)) {
      named.set(key, column.trim());
    }
  };

  for (const edge of lineage.edges) {
    if (edge.kind !== DataLineageEdgeKind.Feeds || !edge.columnMappings) {
      continue;
    }

    for (const mapping of edge.columnMappings) {
      if (edge.target === focus) {
        name(mapping.downstreamColumn);
      }

      if (edge.source === focus) {
        name(mapping.upstreamColumn);
      }
    }
  }

  const order: Map<string, number> = new Map();

  columnOrder.forEach((column: string, index: number): void => {
    const key: string = getColumnKey(column);

    if (!order.has(key)) {
      order.set(key, index);

      // As the table names it.
      if (named.has(key)) {
        named.set(key, column);
      }
    }
  });

  const placeOf: (key: string) => number = (key: string): number => {
    return order.get(key) ?? Number.MAX_SAFE_INTEGER;
  };

  return Array.from(named.keys())
    .sort((a: string, b: string): number => {
      return placeOf(a) - placeOf(b) || compareText(a, b);
    })
    .map((key: string): string => {
      return named.get(key)!;
    });
}

/*
 * Where one column of the drawing's own table comes from and where it
 * goes. Up: along each arrow into a card on its way whose columns name
 * the column there, to the columns of the table before it that feed it -
 * another name when it was renamed on the way, several when it is built
 * from several. Down: along each arrow out, to the columns it feeds. Each
 * way is followed on its own - a column that feeds the table is not
 * followed down into the other tables it feeds - and each table's column
 * once, so a cycle ends.
 */
export function followLineageColumn(
  lineage: DataTableLineage,
  column: string,
): LineageColumnTrail {
  const focus: string = lineage.focusNodeId;
  const into: Map<string, Array<DataTableLineageEdge>> = new Map();
  const out: Map<string, Array<DataTableLineageEdge>> = new Map();

  for (const edge of lineage.edges) {
    if (edge.kind !== DataLineageEdgeKind.Feeds) {
      continue;
    }

    into.set(edge.target, [...(into.get(edge.target) || []), edge]);
    out.set(edge.source, [...(out.get(edge.source) || []), edge]);
  }

  const trail: LineageColumnTrail = {
    column,
    columns: new Map(),
    edgeIds: new Set(),
    mayGoFurther: false,
  };
  const addColumn: (nodeId: string, name: string) => void = (
    nodeId: string,
    name: string,
  ): void => {
    const names: Array<string> = trail.columns.get(nodeId) || [];

    if (
      !names.some((known: string): boolean => {
        return getColumnKey(known) === getColumnKey(name);
      })
    ) {
      names.push(name);
    }

    trail.columns.set(nodeId, names);
  };

  if (!getColumnKey(column)) {
    return trail;
  }

  addColumn(focus, column);

  for (const isUpstream of [true, false]) {
    const visited: Set<string> = new Set([
      `${focus}\u0000${getColumnKey(column)}`,
    ]);
    const queue: Array<{ nodeId: string; name: string }> = [
      { nodeId: focus, name: column },
    ];

    for (let index: number = 0; index < queue.length; index++) {
      const here: { nodeId: string; name: string } = queue[index]!;
      const arrows: Array<DataTableLineageEdge> =
        (isUpstream ? into : out).get(here.nodeId) || [];

      for (const edge of arrows) {
        const mappings: Array<DataColumnMapping> = edge.columnMappings || [];

        // Its sources named no columns: it may carry this one.
        if (mappings.length === 0) {
          trail.mayGoFurther = true;
          continue;
        }

        for (const mapping of mappings) {
          const own: string = isUpstream
            ? mapping.downstreamColumn
            : mapping.upstreamColumn;

          if (getColumnKey(own) !== getColumnKey(here.name)) {
            continue;
          }

          const next: { nodeId: string; name: string } = {
            nodeId: isUpstream ? edge.source : edge.target,
            name: isUpstream
              ? mapping.upstreamColumn
              : mapping.downstreamColumn,
          };
          const key: string = `${next.nodeId}\u0000${getColumnKey(next.name)}`;

          trail.edgeIds.add(edge.id);
          addColumn(next.nodeId, next.name);

          if (!visited.has(key)) {
            visited.add(key);
            queue.push(next);
          }
        }
      }
    }
  }

  return trail;
}

// A column's way, picked out as an alert's ways are: no card named its cause or a consequence.
export function getLineageColumnHighlightSets(
  trail: LineageColumnTrail,
): LineageHighlightSets {
  return {
    nodeIds: new Set(trail.columns.keys()),
    edgeIds: new Set(trail.edgeIds),
    causeNodeIds: new Set(),
    consequenceNodeIds: new Set(),
    dataPipelineIds: new Set(),
  };
}
