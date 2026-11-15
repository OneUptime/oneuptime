import { NetworkTopologyEdge } from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { TopologyPoint } from "../NetworkDevice/TopologyGraphUtil";
import { TopologyLeafBlock } from "../NetworkDevice/TopologyModel";
import { edgeKeyForEdge } from "./NetworkTopologyMeta";

/*
 * The combs a leaf block hangs from its parent by (issue #6606), as drawn.
 *
 * The parent-child layout packs a node's many leaf children into a grid
 * (TopologyLeafBlock). A straight line from the parent to each of them
 * would cut through every row above the one it is heading for - sixty
 * lines fanned across sixty devices and their names. So a block is wired
 * like an org chart instead: a trunk down from the parent, a bus across
 * the top of the grid, a spine down the left of each column, and a short
 * stub across to each device. Every segment is horizontal or vertical and
 * runs in the gaps the layout left for it.
 *
 * The trunk, bus and spines are SHARED by every leaf of the block, so they
 * are drawn once, in a quiet neutral, and say nothing about any one link.
 * Each link is drawn as its own stub, in its own colour and dash: a link
 * that is down is a red stub beside the device it serves, not a red trunk
 * that reads as the uplink having failed.
 *
 * Derived from where the nodes are DRAWN, not from where the layout put
 * them, because the reader can move them:
 *
 *   - a parent dragged with its block (the block travels with it) moves
 *     the whole comb along with it;
 *   - a leaf dragged out of the grid on its own leaves the comb, and its
 *     link is drawn as a plain line again - a stub reaching across the map
 *     to wherever it was dropped would be a line to nowhere;
 *   - a parent dragged away from its block takes every leaf off the comb,
 *     for the same reason.
 *
 * "Still on the comb" is a question of geometry: a leaf is, when it sits
 * where the layout put it relative to its parent. That needs no record of
 * who was dragged when, and it survives a reload - an arrangement is saved
 * rounded to two decimals, hence the tolerance.
 *
 * Pure and react-free: the canvas and the PDF export draw from this alike.
 */

export interface TopologyConnectorSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** One block's shared wiring: trunk, bus and spines. */
export interface LeafBlockComb {
  key: string;
  parentId: string;
  /** The links whose stubs hang from this comb, by edge key. */
  edgeKeys: Array<string>;
  segments: Array<TopologyConnectorSegment>;
}

export interface LeafBlockConnectors {
  combs: Array<LeafBlockComb>;
  /** The stub each comb link is drawn as, by edge key. */
  stubByEdgeKey: Map<string, TopologyConnectorSegment>;
}

export const EMPTY_LEAF_BLOCK_CONNECTORS: LeafBlockConnectors = {
  combs: [],
  stubByEdgeKey: new Map<string, TopologyConnectorSegment>(),
};

/*
 * How far, in layout units, a leaf may sit from its place in the grid and
 * still hang from the comb. An arrangement is saved rounded to two
 * decimals, so a block dragged with its parent comes back from a reload a
 * hundredth off; a leaf the reader actually moved is many units away.
 */
export const COMB_POSITION_TOLERANCE: number = 0.5;

export interface LeafBlockConnectorsInput {
  leafBlocks: ReadonlyArray<TopologyLeafBlock> | undefined;
  // Where the layout put every node, before anything was dragged.
  basePositions: ReadonlyMap<string, TopologyPoint>;
  // Where each DRAWN node is now. A node missing here is not drawn.
  drawnPositions: ReadonlyMap<string, TopologyPoint>;
  // The links that are drawn, by edge key: a comb only serves real links.
  drawnEdgeKeys: ReadonlySet<string>;
}

const isFinitePoint: (point: TopologyPoint | undefined) => boolean = (
  point: TopologyPoint | undefined,
): boolean => {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
};

/** The undirected key of the link between two nodes, as the map keys it. */
export const edgeKeyBetween: (a: string, b: string) => string = (
  a: string,
  b: string,
): string => {
  return edgeKeyForEdge({ fromNodeId: a, toNodeId: b } as NetworkTopologyEdge);
};

export const buildLeafBlockConnectors: (
  input: LeafBlockConnectorsInput,
) => LeafBlockConnectors = (
  input: LeafBlockConnectorsInput,
): LeafBlockConnectors => {
  const blocks: ReadonlyArray<TopologyLeafBlock> = input.leafBlocks || [];
  if (blocks.length === 0) {
    return EMPTY_LEAF_BLOCK_CONNECTORS;
  }

  const combs: Array<LeafBlockComb> = [];
  const stubByEdgeKey: Map<string, TopologyConnectorSegment> = new Map<
    string,
    TopologyConnectorSegment
  >();

  for (const block of blocks) {
    if (!block || !Array.isArray(block.memberIds)) {
      continue;
    }
    const parentBase: TopologyPoint | undefined = input.basePositions.get(
      block.parentId,
    );
    const parentNow: TopologyPoint | undefined = input.drawnPositions.get(
      block.parentId,
    );
    if (
      !isFinitePoint(parentBase) ||
      !isFinitePoint(parentNow) ||
      !Number.isFinite(block.busY)
    ) {
      continue;
    }

    // How far the parent - and a block that travelled with it - has moved.
    const dx: number = parentNow!.x - parentBase!.x;
    const dy: number = parentNow!.y - parentBase!.y;
    const busY: number = block.busY + dy;

    // Column -> the drawn leaves still on the comb in it.
    const onCombByColumn: Map<
      number,
      Array<{ edgeKey: string; point: TopologyPoint }>
    > = new Map<number, Array<{ edgeKey: string; point: TopologyPoint }>>();

    for (const memberId of block.memberIds) {
      const base: TopologyPoint | undefined = input.basePositions.get(memberId);
      const now: TopologyPoint | undefined = input.drawnPositions.get(memberId);
      const column: number | undefined = block.columnByMemberId.get(memberId);
      if (
        !isFinitePoint(base) ||
        !isFinitePoint(now) ||
        column === undefined ||
        !Number.isFinite(block.spineXs[column])
      ) {
        continue;
      }
      const isInPlace: boolean =
        Math.abs(now!.x - (base!.x + dx)) <= COMB_POSITION_TOLERANCE &&
        Math.abs(now!.y - (base!.y + dy)) <= COMB_POSITION_TOLERANCE;
      if (!isInPlace) {
        continue;
      }
      const edgeKey: string = edgeKeyBetween(block.parentId, memberId);
      if (!input.drawnEdgeKeys.has(edgeKey)) {
        continue;
      }
      const entries: Array<{ edgeKey: string; point: TopologyPoint }> =
        onCombByColumn.get(column) || [];
      entries.push({ edgeKey: edgeKey, point: now! });
      onCombByColumn.set(column, entries);
    }

    if (onCombByColumn.size === 0) {
      continue;
    }

    const columns: Array<number> = [...onCombByColumn.keys()].sort(
      (a: number, b: number): number => {
        return a - b;
      },
    );
    const spineXOf: (column: number) => number = (column: number): number => {
      return block.spineXs[column]! + dx;
    };

    const segments: Array<TopologyConnectorSegment> = [];
    const edgeKeys: Array<string> = [];

    // The trunk: from the parent's centre (under its glyph) down to the bus.
    segments.push({
      x1: parentNow!.x,
      y1: parentNow!.y,
      x2: parentNow!.x,
      y2: busY,
    });

    // The bus: across every spine in use, and across the trunk.
    const busStart: number = Math.min(parentNow!.x, spineXOf(columns[0]!));
    const busEnd: number = Math.max(
      parentNow!.x,
      spineXOf(columns[columns.length - 1]!),
    );
    if (busEnd - busStart > 0) {
      segments.push({ x1: busStart, y1: busY, x2: busEnd, y2: busY });
    }

    for (const column of columns) {
      const entries: Array<{ edgeKey: string; point: TopologyPoint }> =
        onCombByColumn.get(column)!;
      const spineX: number = spineXOf(column);
      let bottom: number = busY;
      for (const entry of entries) {
        bottom = Math.max(bottom, entry.point.y);
        stubByEdgeKey.set(entry.edgeKey, {
          x1: spineX,
          y1: entry.point.y,
          x2: entry.point.x,
          y2: entry.point.y,
        });
        edgeKeys.push(entry.edgeKey);
      }
      // The spine: down the column, as far as its lowest leaf on the comb.
      segments.push({ x1: spineX, y1: busY, x2: spineX, y2: bottom });
    }

    combs.push({
      key: `comb-${block.parentId}`,
      parentId: block.parentId,
      edgeKeys: edgeKeys,
      segments: segments,
    });
  }

  if (combs.length === 0) {
    return EMPTY_LEAF_BLOCK_CONNECTORS;
  }
  return { combs: combs, stubByEdgeKey: stubByEdgeKey };
};
