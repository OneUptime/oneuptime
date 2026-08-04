import {
  NetworkTopologyEdge,
  NetworkTopologyEdgeEndpoint,
  NetworkTopologyNode,
  NetworkTopologyNodeStatus,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";

/*
 * Pure, react-free presentation logic for the network topology graph:
 * link-state classification, stroke scaling and label formatting. Kept out
 * of the .tsx components so it can be imported (and unit-tested) in a plain
 * Node/TypeScript environment, same as TopologyLayout.
 */

export type NetworkLinkState = "down" | "saturated" | "healthy" | "unknown";

// A link running at or above this utilization is flagged as saturated.
export const LINK_SATURATION_THRESHOLD_PERCENT: number = 80;

function edgeEndpoints(
  edge: NetworkTopologyEdge,
): Array<NetworkTopologyEdgeEndpoint> {
  const endpoints: Array<NetworkTopologyEdgeEndpoint> = [];
  if (edge.fromInterface) {
    endpoints.push(edge.fromInterface);
  }
  if (edge.toInterface) {
    endpoints.push(edge.toInterface);
  }
  return endpoints;
}

/** Highest utilization reported by either end, if any end reports one. */
export function maxUtilizationForEdge(
  edge: NetworkTopologyEdge,
): number | undefined {
  let max: number | undefined = undefined;
  for (const endpoint of edgeEndpoints(edge)) {
    if (endpoint.utilizationPercent === undefined) {
      continue;
    }
    if (max === undefined || endpoint.utilizationPercent > max) {
      max = endpoint.utilizationPercent;
    }
  }
  return max;
}

/*
 * Link state precedence: down (either end operationally down) beats
 * saturated (utilization at/over threshold) beats healthy. Links with no
 * operational data at all stay "unknown" so they render neutrally.
 */
export function linkStateForEdge(edge: NetworkTopologyEdge): NetworkLinkState {
  const endpoints: Array<NetworkTopologyEdgeEndpoint> = edgeEndpoints(edge);
  if (
    endpoints.some((endpoint: NetworkTopologyEdgeEndpoint) => {
      return endpoint.isOperationallyUp === false;
    })
  ) {
    return "down";
  }
  const utilization: number | undefined = maxUtilizationForEdge(edge);
  if (
    utilization !== undefined &&
    utilization >= LINK_SATURATION_THRESHOLD_PERCENT
  ) {
    return "saturated";
  }
  const hasOperationalData: boolean = endpoints.some(
    (endpoint: NetworkTopologyEdgeEndpoint) => {
      return (
        endpoint.isOperationallyUp !== undefined ||
        endpoint.utilizationPercent !== undefined ||
        endpoint.inRateMbps !== undefined ||
        endpoint.outRateMbps !== undefined
      );
    },
  );
  return hasOperationalData ? "healthy" : "unknown";
}

/*
 * Stroke width scales linearly with the busier end's utilization:
 * 1.5px at 0% up to 5px at 100%. Links with no utilization data keep the
 * base width.
 */
export function edgeStrokeWidthForEdge(edge: NetworkTopologyEdge): number {
  const utilization: number | undefined = maxUtilizationForEdge(edge);
  if (utilization === undefined) {
    return 1.5;
  }
  const clamped: number = Math.min(100, Math.max(0, utilization));
  return 1.5 + (clamped / 100) * 3.5;
}

/*
 * Semantic state colors follow the ServiceMapGraph convention: red/amber are
 * meaningful hex constants, while neutral strokes use the theme's CSS
 * variables (with light-mode fallbacks) so dark mode stays readable.
 */
export const LINK_STATE_COLORS: Record<NetworkLinkState, string> = {
  down: "#dc2626",
  saturated: "#f59e0b",
  healthy: "var(--ou-chart-series-neutral, #64748b)",
  unknown: "var(--ou-border-strong, #cbd5e1)",
};

/** Stable identity for an edge across refreshes (undirected pair). */
export function edgeKeyForEdge(edge: NetworkTopologyEdge): string {
  return [edge.fromNodeId, edge.toNodeId].sort().join("::");
}

/** True when the node matches the search text on name, sysName or vendor. */
export function nodeMatchesSearch(
  node: NetworkTopologyNode,
  searchText: string,
): boolean {
  const lower: string = searchText.trim().toLowerCase();
  if (!lower) {
    return true;
  }
  return [node.name, node.sysName, node.vendor].some(
    (value: string | undefined) => {
      return Boolean(value && value.toLowerCase().includes(lower));
    },
  );
}

export function formatMbps(value: number | undefined): string {
  if (value === undefined) {
    return "—";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} Gbps`;
  }
  if (value >= 10) {
    return `${Math.round(value)} Mbps`;
  }
  return `${value.toFixed(1)} Mbps`;
}

export function formatUtilization(value: number | undefined): string {
  if (value === undefined) {
    return "—";
  }
  return `${Math.round(value)}%`;
}

/*
 * Node status colours, alongside the link colours above and following the
 * same rule: red and green carry meaning that must not change between
 * light and dark, so they stay literal hex. "Unknown" carries no meaning
 * beyond "no data", so it uses the theme's neutral variable — the old
 * literal #9ca3af is not one of the greys Theme.css remaps for SVG, so an
 * unknown device was very nearly invisible against a dark canvas.
 */
export const NODE_STATUS_COLORS: Record<NetworkTopologyNodeStatus, string> = {
  up: "#16a34a",
  down: "#dc2626",
  unknown: "var(--ou-chart-series-neutral, #64748b)",
};

export type NetworkTopologyNodeKind = "device" | "unmanaged" | "endpoint";

/**
 * What each node shape means. Endpoints are violet on purpose —
 * deliberately outside the up/down/unknown range, so a discovered
 * printer can never be misread as a device that is down, and legible on
 * both a white and a near-black canvas.
 */
export const ENDPOINT_NODE_FILL: string = "#a78bfa";
export const ENDPOINT_NODE_STROKE: string = "#7c3aed";

/** The key to reading the graph, as data rather than as prose. */
export interface TopologyLegendEntry {
  group: "Status" | "Kind" | "Link";
  label: string;
  /** How the swatch is drawn: a filled dot, an outline, or a line. */
  swatch: "dot" | "hollow-dot" | "square" | "line" | "dashed-line";
  color: string;
}

export const TOPOLOGY_LEGEND: Array<TopologyLegendEntry> = [
  { group: "Status", label: "Up", swatch: "dot", color: NODE_STATUS_COLORS.up },
  {
    group: "Status",
    label: "Down",
    swatch: "dot",
    color: NODE_STATUS_COLORS.down,
  },
  {
    group: "Status",
    label: "Unknown",
    swatch: "dot",
    color: NODE_STATUS_COLORS.unknown,
  },
  {
    group: "Kind",
    label: "Managed device",
    swatch: "dot",
    color: "var(--ou-text-muted, #6b7280)",
  },
  {
    group: "Kind",
    label: "Unmanaged peer",
    swatch: "hollow-dot",
    color: "var(--ou-text-muted, #6b7280)",
  },
  {
    group: "Kind",
    label: "Discovered endpoint",
    swatch: "square",
    color: ENDPOINT_NODE_FILL,
  },
  {
    group: "Link",
    label: "Healthy",
    swatch: "line",
    color: LINK_STATE_COLORS.healthy,
  },
  {
    group: "Link",
    label: `Busy (over ${LINK_SATURATION_THRESHOLD_PERCENT}%)`,
    swatch: "line",
    color: LINK_STATE_COLORS.saturated,
  },
  {
    group: "Link",
    label: "An end is down",
    swatch: "dashed-line",
    color: LINK_STATE_COLORS.down,
  },
  {
    group: "Link",
    label: "Learned from FDB",
    swatch: "dashed-line",
    color: LINK_STATE_COLORS.unknown,
  },
];

/**
 * What a screen reader hears for a node.
 *
 * The graph used to be a single `role="img"` with one label, which hid
 * every clickable device behind an opaque picture. Each node is now a
 * button, and this is what it announces.
 */
export function accessibleLabelForNode(node: NetworkTopologyNode): string {
  const parts: Array<string> = [node.name || node.id];
  if (node.kind === "endpoint") {
    parts.push("endpoint");
    if (node.ipAddress) {
      parts.push(node.ipAddress);
    }
    if (typeof node.vlanId === "number") {
      parts.push(`VLAN ${node.vlanId}`);
    }
  } else {
    parts.push(node.isManaged ? "managed device" : "unmanaged peer");
    parts.push(`status ${node.status}`);
    if (node.vendor) {
      parts.push(node.vendor);
    }
    if (node.interfacesUp !== undefined || node.interfacesDown !== undefined) {
      parts.push(
        `${node.interfacesUp ?? 0} interfaces up, ${
          node.interfacesDown ?? 0
        } down`,
      );
    }
  }
  return parts.join(", ");
}

/** What a screen reader hears for a link. Never truncated. */
export function accessibleLabelForEdge(
  edge: NetworkTopologyEdge,
  fromName: string | undefined,
  toName: string | undefined,
): string {
  const state: NetworkLinkState = linkStateForEdge(edge);
  const stateText: Record<NetworkLinkState, string> = {
    down: "an end is down",
    saturated: "running hot",
    healthy: "healthy",
    unknown: "no operational data",
  };
  const utilization: number | undefined = maxUtilizationForEdge(edge);
  const parts: Array<string> = [
    `Link from ${fromName || edge.fromNodeId} to ${toName || edge.toNodeId}`,
    stateText[state],
  ];
  if (utilization !== undefined) {
    parts.push(`${formatUtilization(utilization)} utilization`);
  }
  if (edge.protocols && edge.protocols.length > 0) {
    parts.push(`reported by ${edge.protocols.join(" and ").toUpperCase()}`);
  }
  return parts.join(", ");
}

/** One-line summary of an edge end for tooltips: "Gi0/1 · 84% · ↓12 ↑3 Mbps". */
export function describeEndpoint(
  endpoint: NetworkTopologyEdgeEndpoint | undefined,
  portLabel: string | undefined,
): string {
  const name: string =
    endpoint?.interfaceName ||
    portLabel ||
    (endpoint?.interfaceIndex !== undefined
      ? `if${endpoint.interfaceIndex}`
      : "?");
  const parts: Array<string> = [name];
  if (endpoint?.isOperationallyUp === false) {
    parts.push("down");
  }
  if (endpoint?.utilizationPercent !== undefined) {
    parts.push(formatUtilization(endpoint.utilizationPercent));
  }
  if (
    endpoint?.inRateMbps !== undefined ||
    endpoint?.outRateMbps !== undefined
  ) {
    parts.push(
      `↓${formatMbps(endpoint.inRateMbps)} ↑${formatMbps(endpoint.outRateMbps)}`,
    );
  }
  return parts.join(" · ");
}
