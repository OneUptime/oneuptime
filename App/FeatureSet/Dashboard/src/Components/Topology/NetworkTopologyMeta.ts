import {
  NetworkTopologyEdge,
  NetworkTopologyEdgeEndpoint,
  NetworkTopologyNode,
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
