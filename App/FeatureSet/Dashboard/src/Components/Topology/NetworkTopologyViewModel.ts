import {
  NetworkTopologyDeviceRole,
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  roleLabelForNode,
  roleOfNode,
} from "../NetworkDevice/TopologyNodeShape";
import {
  endpointTooltipForNode,
  isEndpointNode,
  isFdbEdge,
} from "../NetworkDevice/EndpointNodeUtil";
import {
  ENDPOINT_NODE_FILL,
  ENDPOINT_NODE_STROKE,
  LINK_STATE_COLORS,
  NODE_STATUS_COLORS,
  NetworkLinkState,
  accessibleLabelForEdge,
  accessibleLabelForNode,
  edgeKeyForEdge,
  edgeStrokeWidthForEdge,
  linkStateForEdge,
  nodeMatchesSearch,
} from "./NetworkTopologyMeta";
import {
  TopologyNodeFootprint,
  footprintForNode,
  labelLinesForNode,
} from "../NetworkDevice/TopologyFootprint";
import { TopologyPoint } from "../NetworkDevice/TopologyGraphUtil";

/*
 * Everything the graph needs to draw, computed without react.
 *
 * The .tsx used to decide colour, dash pattern, dimming, tooltip text and
 * label wrapping inline while rendering, which put all of it beyond the
 * reach of the test suite — App/Tests cannot render a component. Moving
 * those decisions here makes them assertions instead of hopes, and leaves
 * the component as a mapper from descriptors to SVG elements.
 */

export type TopologyNodeKind = "device" | "unmanaged" | "endpoint";

export interface TopologyNodeView {
  id: string;
  x: number;
  y: number;
  kind: TopologyNodeKind;
  /** What the node does on the network — this is what picks its shape. */
  role: NetworkTopologyDeviceRole;
  /** The role's display name, e.g. "Switch". */
  roleLabel: string;
  status: string;
  fill: string;
  stroke: string;
  strokeDashArray: string | undefined;
  /** Glyph geometry, shared with the layout so the two cannot drift. */
  footprint: TopologyNodeFootprint;
  labelLines: Array<string>;
  /** Interface counts badge, when the payload carries them. */
  badge: string | undefined;
  isDimmed: boolean;
  isSelected: boolean;
  isPinned: boolean;
  ariaLabel: string;
  tooltip: string;
  testId: string;
}

export interface TopologyEdgeView {
  key: string;
  fromNodeId: string;
  toNodeId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  state: NetworkLinkState;
  color: string;
  strokeWidth: number;
  strokeDashArray: string | undefined;
  isDimmed: boolean;
  isSelected: boolean;
  ariaLabel: string;
  testId: string;
}

export interface TopologyViewModelInput {
  nodes: Array<NetworkTopologyNode>;
  edges: Array<NetworkTopologyEdge>;
  positions: ReadonlyMap<string, TopologyPoint>;
  searchText: string;
  /** Node kinds the user has left switched on. */
  visibleKinds: ReadonlySet<TopologyNodeKind>;
  /** Nodes to keep at full strength; empty means "dim nothing". */
  focusNodeIds: ReadonlySet<string>;
  selectedNodeId: string | null;
  selectedEdgeKey: string | null;
  pinnedNodeIds: ReadonlySet<string>;
}

export interface TopologyViewModel {
  nodes: Array<TopologyNodeView>;
  edges: Array<TopologyEdgeView>;
  visibleNodeCount: number;
  totalNodeCount: number;
  /** True when the kind filters have hidden everything. */
  isFilteredEmpty: boolean;
  /*
   * How many drawn nodes matched the search. Zero with a non-empty search
   * means every node on screen is dimmed, which without a message of its
   * own looks exactly like a broken map. Distinct from isFilteredEmpty:
   * search DIMS and filters REMOVE, so the two states need different
   * words — telling somebody to "adjust the search text" when their kind
   * filter is what emptied the canvas sends them to the wrong control.
   */
  searchMatchCount: number;
}

export const kindOfNode: (node: NetworkTopologyNode) => TopologyNodeKind = (
  node: NetworkTopologyNode,
): TopologyNodeKind => {
  if (isEndpointNode(node)) {
    return "endpoint";
  }
  return node.isManaged ? "device" : "unmanaged";
};

export const ALL_NODE_KINDS: ReadonlySet<TopologyNodeKind> =
  new Set<TopologyNodeKind>(["device", "unmanaged", "endpoint"]);

const tooltipForNode: (node: NetworkTopologyNode) => string = (
  node: NetworkTopologyNode,
): string => {
  if (isEndpointNode(node)) {
    return endpointTooltipForNode(node);
  }
  const vendorSummary: string = [node.vendor, node.deviceModel]
    .filter(Boolean)
    .join(" ");
  const hasInterfaceCounts: boolean =
    node.interfacesUp !== undefined || node.interfacesDown !== undefined;
  const interfacesSummary: string = hasInterfaceCounts
    ? `${node.interfacesUp ?? 0} up / ${node.interfacesDown ?? 0} down`
    : "";
  /*
   * "core-1 (Switch, up)" — the role leads because the shape is what the
   * reader is trying to confirm when they hover. An unclassified node
   * simply omits it and reads exactly as it always did.
   */
  const role: NetworkTopologyDeviceRole = roleOfNode(node);
  const descriptor: string = [
    role === "unknown" ? undefined : roleLabelForNode(node),
    node.status,
    node.isManaged ? undefined : "unmanaged",
  ]
    .filter(Boolean)
    .join(", ");
  return `${node.name} (${descriptor})${
    vendorSummary ? ` — ${vendorSummary}` : ""
  }${interfacesSummary ? ` — ${interfacesSummary}` : ""}`;
};

/**
 * Build the render descriptors for one frame of the graph.
 *
 * Filtering removes nodes outright; search only dims them, because
 * hiding a device the moment its name stops matching would also remove
 * the links that explain where it sits. Edges are dimmed WITH their
 * nodes — searching used to dim nodes only, so a filtered map was a
 * legible handful of devices behind an unchanged hairball of lines.
 */
export const buildTopologyViewModel: (
  input: TopologyViewModelInput,
) => TopologyViewModel = (input: TopologyViewModelInput): TopologyViewModel => {
  const searchText: string = (input.searchText || "").trim();
  const hasFocus: boolean = input.focusNodeIds.size > 0;

  const visibleNodes: Array<NetworkTopologyNode> = [];
  const nodeById: Map<string, NetworkTopologyNode> = new Map<
    string,
    NetworkTopologyNode
  >();
  for (const node of input.nodes || []) {
    if (!node || typeof node.id !== "string") {
      continue;
    }
    nodeById.set(node.id, node);
    if (input.visibleKinds.has(kindOfNode(node))) {
      visibleNodes.push(node);
    }
  }

  const dimmedNodeIds: Set<string> = new Set<string>();
  const nodeViews: Array<TopologyNodeView> = [];
  let searchMatchCount: number = 0;

  for (const node of visibleNodes) {
    const point: TopologyPoint | undefined = input.positions.get(node.id);
    if (!point) {
      continue;
    }
    const kind: TopologyNodeKind = kindOfNode(node);
    const matchesSearch: boolean =
      !searchText || nodeMatchesSearch(node, searchText);
    if (matchesSearch) {
      searchMatchCount++;
    }
    const inFocus: boolean = !hasFocus || input.focusNodeIds.has(node.id);
    const isDimmed: boolean = !matchesSearch || !inFocus;
    if (isDimmed) {
      dimmedNodeIds.add(node.id);
    }

    const statusColor: string =
      NODE_STATUS_COLORS[node.status] || NODE_STATUS_COLORS.unknown;
    const hasInterfaceCounts: boolean =
      node.interfacesUp !== undefined || node.interfacesDown !== undefined;

    nodeViews.push({
      id: node.id,
      x: point.x,
      y: point.y,
      kind: kind,
      role: roleOfNode(node),
      roleLabel: roleLabelForNode(node),
      status: node.status,
      fill:
        kind === "endpoint"
          ? ENDPOINT_NODE_FILL
          : node.isManaged
            ? statusColor
            : "var(--ou-surface-primary, #ffffff)",
      stroke: kind === "endpoint" ? ENDPOINT_NODE_STROKE : statusColor,
      // A dashed outline is what says "we did not discover this one".
      strokeDashArray: kind === "unmanaged" ? "4 3" : undefined,
      footprint: footprintForNode(node),
      labelLines: labelLinesForNode(node),
      badge:
        kind !== "endpoint" && hasInterfaceCounts
          ? `${node.interfacesUp ?? 0}/${node.interfacesDown ?? 0}`
          : undefined,
      isDimmed: isDimmed,
      isSelected: input.selectedNodeId === node.id,
      isPinned: input.pinnedNodeIds.has(node.id),
      ariaLabel: accessibleLabelForNode(node),
      tooltip: tooltipForNode(node),
      testId: `network-topology-node-${node.id}`,
    });
  }

  const placedNodeIds: Set<string> = new Set<string>(
    nodeViews.map((view: TopologyNodeView): string => {
      return view.id;
    }),
  );

  const edgeViews: Array<TopologyEdgeView> = [];
  for (const edge of input.edges || []) {
    if (!edge) {
      continue;
    }
    if (
      !placedNodeIds.has(edge.fromNodeId) ||
      !placedNodeIds.has(edge.toNodeId)
    ) {
      continue;
    }
    const from: TopologyPoint = input.positions.get(edge.fromNodeId)!;
    const to: TopologyPoint = input.positions.get(edge.toNodeId)!;
    const state: NetworkLinkState = linkStateForEdge(edge);
    const key: string = edgeKeyForEdge(edge);

    edgeViews.push({
      key: key,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      state: state,
      color: LINK_STATE_COLORS[state],
      strokeWidth: edgeStrokeWidthForEdge(edge),
      /*
       * Dash precedence: an operationally-down link keeps its long
       * warning dash; otherwise an FDB attachment gets a short dash so it
       * reads as learned rather than cabled.
       */
      strokeDashArray:
        state === "down" ? "6 4" : isFdbEdge(edge) ? "3 3" : undefined,
      isDimmed:
        dimmedNodeIds.has(edge.fromNodeId) || dimmedNodeIds.has(edge.toNodeId),
      isSelected: input.selectedEdgeKey === key,
      ariaLabel: accessibleLabelForEdge(
        edge,
        nodeById.get(edge.fromNodeId)?.name,
        nodeById.get(edge.toNodeId)?.name,
      ),
      testId: `network-topology-edge-${key}`,
    });
  }

  const totalNodeCount: number = nodeById.size;
  return {
    nodes: nodeViews,
    edges: edgeViews,
    visibleNodeCount: nodeViews.length,
    totalNodeCount: totalNodeCount,
    isFilteredEmpty: totalNodeCount > 0 && nodeViews.length === 0,
    searchMatchCount: searchMatchCount,
  };
};

/**
 * A fingerprint of the graph's SHAPE — ids and links, nothing else.
 *
 * Used as the layout memo key so a poll that only changes an interface
 * counter or a status does not recompute (and therefore visibly reshuffle
 * nothing, but still burn the frame budget on) the whole layout.
 */
export const topologyStructuralSignature: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
) => string = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
): string => {
  const nodeIds: Array<string> = [];
  for (const node of nodes || []) {
    if (node && typeof node.id === "string") {
      nodeIds.push(node.id);
    }
  }
  const edgeKeys: Array<string> = [];
  for (const edge of edges || []) {
    if (edge && edge.fromNodeId && edge.toNodeId) {
      edgeKeys.push(edgeKeyForEdge(edge));
    }
  }
  // Sorted so a reordered response produces the same signature.
  nodeIds.sort();
  edgeKeys.sort();
  return `${nodeIds.join(",")}|${edgeKeys.join(",")}`;
};
