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

export interface TopologyLayoutModel {
  positions: Map<string, TopologyPoint>;
  componentBoxes: Array<TopologyComponentBox>;
  /** Tiered layout only; empty for every other mode. */
  groups: Array<TopologyGroupBox>;
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
