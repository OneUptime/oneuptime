import { DataAssetFreshness } from "Common/Types/DataObservability/DataAssetFreshness";
import DataAssetLineageSource from "Common/Types/DataObservability/DataAssetLineageSource";
import {
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  DataTableLineagePipeline,
  isFailedLineageRunState,
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

export const LINEAGE_NEUTRAL_COLOR: string = "#94a3b8";
export const LINEAGE_READS_COLOR: string = "#cbd5e1";
export const LINEAGE_PROBLEM_COLOR: string = "#ef4444";
export const LINEAGE_HEALTHY_COLOR: string = "#22c55e";
export const LINEAGE_RUNNING_COLOR: string = "#eab308";

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

  if (edge.kind === DataLineageEdgeKind.Reads) {
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
 * reaches keeps the steps the lineage gave it.
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
    if (edge.kind !== DataLineageEdgeKind.Feeds) {
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
 * Where the diagram is looked at from on a canvas of a given size: the whole
 * drawing, fitted and centered, when it fits with its cards' names still
 * readable; otherwise the table itself in the middle, at the least zoom
 * that keeps names readable - the rest is a drag away, and the fit control
 * shows all of it. Null while the canvas has no size to go by.
 */
export function getLineageViewport(data: {
  layout: LineageLayout;
  focusNodeId: string;
  width: number;
  height: number;
}): LineageViewport | null {
  if (!(data.width > 0) || !(data.height > 0)) {
    return null;
  }

  const fitZoom: number = Math.min(
    1,
    data.width / (data.layout.width * (1 + LINEAGE_FIT_PADDING)),
    data.height / (data.layout.height * (1 + LINEAGE_FIT_PADDING)),
  );

  if (fitZoom >= LINEAGE_READABLE_ZOOM) {
    return {
      x: (data.width - data.layout.width * fitZoom) / 2,
      y: (data.height - data.layout.height * fitZoom) / 2,
      zoom: fitZoom,
    };
  }

  const focus: LineagePoint | undefined = data.layout.positions.get(
    data.focusNodeId,
  );
  const centerX: number = focus
    ? focus.x + LINEAGE_CARD_WIDTH / 2
    : data.layout.width / 2;
  const centerY: number = focus
    ? focus.y + LINEAGE_CARD_HEIGHT / 2
    : data.layout.height / 2;

  return {
    x: data.width / 2 - centerX * LINEAGE_READABLE_ZOOM,
    y: data.height / 2 - centerY * LINEAGE_READABLE_ZOOM,
    zoom: LINEAGE_READABLE_ZOOM,
  };
}
