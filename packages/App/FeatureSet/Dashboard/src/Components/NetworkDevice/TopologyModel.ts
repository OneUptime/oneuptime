import { TopologyPoint } from "./TopologyGraphUtil";

/*
 * The shape every topology layout returns.
 *
 * Declared in its own module so the force, radial and tiered layouts can
 * all speak it without importing each other, and so the graph component
 * can render any of them through one code path.
 */

/**
 * The block of endpoints hanging off one tier-1 node, in layout
 * coordinates. The graph component paints these behind the nodes so a
 * switch and "its" devices read as one unit.
 */
export interface TopologyGroupBox {
  /** Tier-1 node the endpoints attach to; null for the unattached group. */
  anchorNodeId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  endpointCount: number;
  /*
   * The endpoints inside the box. Carried so the renderer can re-derive
   * the hull from where those nodes are ACTUALLY drawn — a dragged switch
   * takes its endpoints with it, and a kind filter can remove them
   * entirely, either of which would otherwise leave an empty rectangle
   * sitting where the group used to be.
   */
  nodeIds: Array<string>;
}

/**
 * One connected component's packed extent, or the strip that collects
 * devices with no links at all. The graph paints a soft hull around each
 * so islands read as islands rather than as one tangle.
 */
export interface TopologyComponentBox {
  /** The component's root node id, or "unlinked" for the strip. */
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeCount: number;
  /** True for the "not linked to anything" strip, which gets a caption. */
  isUnlinked: boolean;
  /** Members, so the renderer can re-derive the hull from drawn positions. */
  nodeIds: Array<string>;
}

/**
 * The leaf children of one parent, packed into a compact grid instead of
 * one long row (parent-child layout only, issue #6606).
 *
 * A switch with sixty devices and nothing below them drew all sixty side
 * by side, so the map was sixty devices wide and too small to read once it
 * was fitted to the screen. The grid hangs from its parent by a comb: one
 * trunk down from the parent, a bus across the top of the grid, a spine
 * down the left of each column and a short stub to each device — every
 * line orthogonal, so none of them crosses a device or its name.
 *
 * Only the geometry the comb needs is kept here, in layout coordinates as
 * computed — before any device was dragged. The renderer re-derives the
 * comb from where the devices are actually drawn (LeafBlockConnectors).
 */
export interface TopologyLeafBlock {
  /** The node the block hangs from. */
  parentId: string;
  /** The leaves, in the order they fill the grid: column by column. */
  memberIds: Array<string>;
  /** Which column each member sits in. */
  columnByMemberId: Map<string, number>;
  /** Where the bus runs across the top of the grid. */
  busY: number;
  /** Each column's spine, left of the column, index-aligned by column. */
  spineXs: Array<number>;
}

/**
 * The parent/child hierarchy a layout drew from (parent-child layout
 * only). Every relation describes the WHOLE topology, collapsed branches
 * included, so the map can count what a collapsed branch holds and walk
 * from a device up to its root without laying anything out again.
 */
export interface TopologyHierarchy {
  /** Tree roots, in canonical id order. */
  rootIds: Array<string>;
  /** Every non-root node's parent. */
  parentById: Map<string, string>;
  /** Children per node, every node included, in canonical id order. */
  childrenById: Map<string, Array<string>>;
  /** Depth below the node's own root; a root is 0. */
  depthById: Map<string, number>;
  /*
   * The collapsed nodes the layout honoured: each one has children, and
   * none of its descendants was placed.
   */
  collapsedNodeIds: ReadonlySet<string>;
}

export interface TopologyLayoutModel {
  positions: Map<string, TopologyPoint>;
  componentBoxes: Array<TopologyComponentBox>;
  /** Tiered layout only; empty for every other mode. */
  groups: Array<TopologyGroupBox>;
  /** Parent-child layout only: the grids its leaf children were packed into. */
  leafBlocks?: Array<TopologyLeafBlock> | undefined;
  /** Parent-child layout only: the hierarchy it drew. */
  hierarchy?: TopologyHierarchy | undefined;
  /*
   * The extent the layout actually needs. MAY exceed the width and
   * height it was asked for: node glyphs and label text are a fixed size
   * in viewBox units, so shrinking a layout to fit a frame would put back
   * every collision the relaxation pass just removed. The viewport zooms
   * to fit instead — see TopologyViewport.fitViewToBounds.
   */
  contentWidth: number;
  contentHeight: number;
}

export const EMPTY_LAYOUT_MODEL: TopologyLayoutModel = {
  positions: new Map<string, TopologyPoint>(),
  componentBoxes: [],
  groups: [],
  contentWidth: 0,
  contentHeight: 0,
};
