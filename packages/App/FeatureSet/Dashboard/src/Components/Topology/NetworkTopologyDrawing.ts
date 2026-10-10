import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  TopologyComponentBox,
  TopologyGroupBox,
  TopologyLayoutModel,
  computeTieredTopologyLayoutModel,
} from "../NetworkDevice/TopologyLayout";
import { computeForceTopologyModel } from "../NetworkDevice/ForceTopologyLayout";
import { computeRadialTopologyModel } from "../NetworkDevice/RadialTopologyLayout";
import { computeStarTopologyModel } from "../NetworkDevice/StarTopologyLayout";
import { computeParentChildTopologyModel } from "../NetworkDevice/ParentChildTopologyLayout";
import { TopologyNodeFootprint } from "../NetworkDevice/TopologyFootprint";
import { TopologyNodeView } from "./NetworkTopologyViewModel";
import { TopologyLayoutMode } from "./TopologyPositionOverrides";

/*
 * What the network topology map draws, whatever it is drawn ON.
 *
 * The map is drawn in two places: the live SVG canvas (NetworkDeviceGraph)
 * and the PDF export (Topology/Export). Both have to place every device in
 * exactly the same spot and outline exactly the same islands, or the PDF is
 * a different map with the same title — so the two decisions they share
 * live here, once, and neither medium has a copy of its own:
 *
 *   - which layout a mode means, and the frame it is computed for;
 *   - the soft hulls drawn behind the nodes: one per island, one per
 *     endpoint group, and the "Not linked to anything" strip.
 *
 * Pure and react-free, like the layouts it dispatches to, so App/Tests can
 * hold both media to it.
 */

/*
 * The frame every layout is computed for. The graph's viewBox is this size
 * too, and the view zooms to fit whatever the layout produced — see
 * NetworkDeviceGraph.
 */
export const TOPOLOGY_VIEW_WIDTH: number = 1000;
export const TOPOLOGY_VIEW_HEIGHT: number = 700;

// Clearance between a hull and the ink of the nodes it encloses.
export const TOPOLOGY_HULL_PADDING: number = 22;

// The caption over the strip that collects devices with no links at all.
export const UNLINKED_HULL_CAPTION: string = "Not linked to anything";

/**
 * The layout one mode draws, for one graph.
 *
 * "force" (the default) is the organic project-wide map, "tiered" lays
 * routers over switches over endpoints, "radial" rings the core, "star"
 * ranks by hops from a hub, and "parentChild" draws a top-down tree.
 */
export const computeTopologyLayoutModel: (
  layoutMode: TopologyLayoutMode,
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
) => TopologyLayoutModel = (
  layoutMode: TopologyLayoutMode,
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
): TopologyLayoutModel => {
  if (layoutMode === "tiered") {
    return computeTieredTopologyLayoutModel(
      nodes,
      edges,
      TOPOLOGY_VIEW_WIDTH,
      TOPOLOGY_VIEW_HEIGHT,
    );
  }
  if (layoutMode === "radial") {
    return computeRadialTopologyModel(
      nodes,
      edges,
      TOPOLOGY_VIEW_WIDTH,
      TOPOLOGY_VIEW_HEIGHT,
    );
  }
  if (layoutMode === "star") {
    return computeStarTopologyModel(
      nodes,
      edges,
      TOPOLOGY_VIEW_WIDTH,
      TOPOLOGY_VIEW_HEIGHT,
    );
  }
  if (layoutMode === "parentChild") {
    return computeParentChildTopologyModel(
      nodes,
      edges,
      TOPOLOGY_VIEW_WIDTH,
      TOPOLOGY_VIEW_HEIGHT,
    );
  }
  return computeForceTopologyModel(
    nodes,
    edges,
    TOPOLOGY_VIEW_WIDTH,
    TOPOLOGY_VIEW_HEIGHT,
  );
};

/** One soft hull behind the graph, in world (layout) coordinates. */
export interface TopologyHullView {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** "Not linked to anything (3)" on the unlinked strip; null elsewhere. */
  caption: string | null;
  /** How many drawn nodes the hull encloses. */
  memberCount: number;
  /** Dashed: the unlinked strip and the group of unattached endpoints. */
  isDashed: boolean;
  /** True for the strip that collects devices with no links at all. */
  isUnlinked: boolean;
}

interface HullSource {
  key: string;
  nodeIds: Array<string>;
  caption: string | null;
  isDashed: boolean;
  isUnlinked: boolean;
}

/**
 * The hulls to draw behind one frame of the graph.
 *
 * Re-derived from where the member nodes are ACTUALLY drawn rather than
 * taken from the layout as-is. The layout's boxes are computed once per
 * graph shape, so they know nothing about a device the user has since
 * dragged out of its island, or about a node kind the user has switched
 * off — either of which would otherwise leave a labelled rectangle
 * outlining empty canvas. A hull with no drawn member is dropped: it is
 * not a hull, it is a ghost.
 */
export const buildTopologyHulls: (
  model: TopologyLayoutModel,
  drawnNodes: ReadonlyArray<TopologyNodeView>,
) => Array<TopologyHullView> = (
  model: TopologyLayoutModel,
  drawnNodes: ReadonlyArray<TopologyNodeView>,
): Array<TopologyHullView> => {
  const drawn: Map<string, TopologyNodeView> = new Map<
    string,
    TopologyNodeView
  >();
  for (const nodeView of drawnNodes) {
    drawn.set(nodeView.id, nodeView);
  }

  const sources: Array<HullSource> = [
    ...model.groups.map((box: TopologyGroupBox): HullSource => {
      return {
        key: `group-${box.anchorNodeId || "unattached"}`,
        nodeIds: box.nodeIds,
        caption: null,
        isDashed: box.anchorNodeId === null,
        isUnlinked: false,
      };
    }),
    ...model.componentBoxes.map((box: TopologyComponentBox): HullSource => {
      return {
        key: `component-${box.key}`,
        nodeIds: box.nodeIds,
        caption: box.isUnlinked ? UNLINKED_HULL_CAPTION : null,
        isDashed: box.isUnlinked,
        isUnlinked: box.isUnlinked,
      };
    }),
  ];

  const hulls: Array<TopologyHullView> = [];
  for (const source of sources) {
    let minX: number = Infinity;
    let minY: number = Infinity;
    let maxX: number = -Infinity;
    let maxY: number = -Infinity;
    let members: number = 0;
    for (const nodeId of source.nodeIds) {
      const nodeView: TopologyNodeView | undefined = drawn.get(nodeId);
      if (!nodeView) {
        continue;
      }
      const footprint: TopologyNodeFootprint = nodeView.footprint;
      minX = Math.min(minX, nodeView.x - footprint.inkHalfWidth);
      maxX = Math.max(maxX, nodeView.x + footprint.inkHalfWidth);
      minY = Math.min(minY, nodeView.y - footprint.halfHeight);
      maxY = Math.max(maxY, nodeView.y + footprint.labelBottom);
      members++;
    }
    if (members === 0) {
      continue;
    }
    hulls.push({
      key: source.key,
      x: minX - TOPOLOGY_HULL_PADDING,
      y: minY - TOPOLOGY_HULL_PADDING,
      width: maxX - minX + 2 * TOPOLOGY_HULL_PADDING,
      height: maxY - minY + 2 * TOPOLOGY_HULL_PADDING,
      caption: source.caption ? `${source.caption} (${members})` : null,
      memberCount: members,
      isDashed: source.isDashed,
      isUnlinked: source.isUnlinked,
    });
  }
  return hulls;
};
