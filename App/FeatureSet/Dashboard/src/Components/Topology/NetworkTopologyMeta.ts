import {
  NetworkTopologyDeviceRole,
  NetworkTopologyEdge,
  NetworkTopologyEdgeEndpoint,
  NetworkTopologyNode,
  NetworkTopologyNodeDiagnostics,
  NetworkTopologyNodeStatus,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  DEVICE_ROLES_IN_LEGEND_ORDER,
  labelForDeviceRole,
} from "Common/Utils/Monitor/NetworkDeviceRoleUtil";
import {
  TopologyNodeShape,
  roleOfNode,
  shapeForNode,
} from "../NetworkDevice/TopologyNodeShape";

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
  if (hasOperationalData) {
    return "healthy";
  }
  /*
   * Last resort: a manual link has no counters of its own, so a Monitor
   * bound to it is the only thing that knows anything. Deliberately after
   * the interface checks — measured state beats a monitor's summary of it,
   * and a monitor that watches the pair end-to-end can read "up" while one
   * specific port between them is down.
   */
  if (edge.monitorState) {
    return edge.monitorState === "down" ? "down" : "healthy";
  }
  return "unknown";
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

/**
 * True when the node matches the search text.
 *
 * Name, sysName, vendor, MAC and IP address are the identity fields; the
 * ROLE is matched too, so typing "firewall" lights up every firewall on the
 * map even though no device is called one. An unclassified node deliberately
 * does not answer to "unknown type" — that would make a search for a role
 * highlight everything we failed to classify.
 */
export function nodeMatchesSearch(
  node: NetworkTopologyNode,
  searchText: string,
): boolean {
  const lower: string = searchText.trim().toLowerCase();
  if (!lower) {
    return true;
  }
  const role: NetworkTopologyDeviceRole = roleOfNode(node);
  const roleText: string | undefined =
    role === "unknown" ? undefined : labelForDeviceRole(role);
  /*
   * The MAC and the address are searched too. They used to be reachable
   * because an unclassified endpoint leaf was NAMED after its address; a
   * device placed by endpoint inference (issue #3489) replaces that leaf
   * with the device's own name, and the address an operator is holding on
   * a ticket would otherwise stop finding anything at all.
   */
  return [
    node.name,
    node.sysName,
    node.vendor,
    node.macAddress,
    node.ipAddress,
    roleText,
  ].some((value: string | undefined) => {
    return Boolean(value && value.toLowerCase().includes(lower));
  });
}

/**
 * Why this device is drawn with no links, in words an operator can act on.
 *
 * Returns undefined when there is nothing to explain — the node has links, or
 * the payload predates diagnostics. The order is causal, not alphabetical:
 * discovery being off explains everything downstream of it, so it is checked
 * before "reported nothing", which in turn explains more than "matched
 * nothing".
 */
export function isolationReasonForNode(
  node: NetworkTopologyNode,
  hasEdges: boolean,
): string | undefined {
  if (hasEdges || node.kind !== "device" || !node.diagnostics) {
    return undefined;
  }

  const diagnostics: NetworkTopologyNodeDiagnostics = node.diagnostics;

  if (diagnostics.isNeighborDiscoveryEnabled === false) {
    return "Neighbour discovery never ran on this device. LLDP and CDP are walked as part of interface monitoring, which is switched off here — turn it on in the device's polling settings and its links will appear after the next poll.";
  }

  if (diagnostics.reportedNeighborCount === 0) {
    return "This device reported no LLDP or CDP neighbours on its last poll. Either it does not run a discovery protocol, or it runs one only on ports that are down. Draw the link by hand under Device Links if you know what it connects to.";
  }

  if (diagnostics.unmatchedNeighborIdentifiers.length > 0) {
    /*
     * The actionable case, and the reason this function exists. Naming the
     * identifiers turns "no links found" into "you renamed this switch" or
     * "this neighbour was never added as a device".
     */
    const shown: Array<string> = diagnostics.unmatchedNeighborIdentifiers.slice(
      0,
      5,
    );
    const remainder: number =
      diagnostics.unmatchedNeighborIdentifiers.length - shown.length;
    const list: string = shown.join(", ");
    return `This device reported ${
      diagnostics.reportedNeighborCount
    } neighbour${
      diagnostics.reportedNeighborCount === 1 ? "" : "s"
    }, but none of them matched a device in this project: ${list}${
      remainder > 0 ? ` and ${remainder} more` : ""
    }. Add those as devices, or check whether one was renamed since it was last polled.`;
  }

  return undefined;
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
  group: "Status" | "Kind" | "Type" | "Link";
  label: string;
  /**
   * How the swatch is drawn: a filled dot, an outline, a line, or — for
   * the "Type" group — the node silhouette the role is drawn with. The
   * line swatches mirror the strokes the graph actually draws: solid,
   * dashed for a learned attachment, dotted for an inferred uplink.
   */
  swatch:
    | "dot"
    | "hollow-dot"
    | "square"
    | "line"
    | "dashed-line"
    | "dotted-line"
    | "shape";
  color: string;
  /** Set only on "shape" swatches: which silhouette to draw. */
  shape?: TopologyNodeShape | undefined;
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
  /*
   * Its own entry rather than sharing "Learned from FDB": both come from the
   * forwarding database, but one runs to an anonymous MAC on a port and the
   * other is a cable between two devices the project manages, worked out by
   * recognising one of them in that table. An operator deciding whether to
   * trust a line needs to know which they are looking at.
   */
  {
    group: "Link",
    label: "Inferred uplink",
    swatch: "dotted-line",
    color: LINK_STATE_COLORS.unknown,
  },
];

/** The neutral ink every shape swatch is drawn in. */
export const LEGEND_SHAPE_COLOR: string = "var(--ou-text-muted, #6b7280)";

/**
 * The legend for one topology, silhouettes included.
 *
 * The type entries are built from the nodes actually on the map rather
 * than from the full list of roles: a key that explains a storage
 * cylinder to somebody whose network contains none is nine words of
 * clutter, and this legend already has to survive being read on a phone.
 * Roles that came back "unknown" get no entry either — the circle they
 * fall back to is the same one a router uses, and claiming otherwise
 * would be a lie about what the reader is looking at.
 *
 * Order is the fixed role order, never encounter order, so the key does
 * not reshuffle itself under a poll.
 */
export function buildTopologyLegend(
  nodes: Array<NetworkTopologyNode> | undefined,
): Array<TopologyLegendEntry> {
  const presentRoles: Set<NetworkTopologyDeviceRole> =
    new Set<NetworkTopologyDeviceRole>();
  for (const node of nodes || []) {
    if (!node) {
      continue;
    }
    const role: NetworkTopologyDeviceRole = roleOfNode(node);
    if (role !== "unknown") {
      presentRoles.add(role);
    }
  }

  const typeEntries: Array<TopologyLegendEntry> = [];
  for (const role of DEVICE_ROLES_IN_LEGEND_ORDER) {
    if (!presentRoles.has(role)) {
      continue;
    }
    typeEntries.push({
      group: "Type",
      label: labelForDeviceRole(role),
      swatch: "shape",
      color: LEGEND_SHAPE_COLOR,
      shape: shapeForNode({
        id: "legend",
        name: "legend",
        isManaged: true,
        status: "unknown",
        kind: "device",
        role: role,
      }),
    });
  }

  return [...TOPOLOGY_LEGEND, ...typeEntries];
}

/**
 * What a screen reader hears for a node.
 *
 * The graph used to be a single `role="img"` with one label, which hid
 * every clickable device behind an opaque picture. Each node is now a
 * button, and this is what it announces.
 */
export function accessibleLabelForNode(node: NetworkTopologyNode): string {
  const parts: Array<string> = [node.name || node.id];
  /*
   * The role goes first because it is what the SHAPE encodes, and the
   * shape is exactly the information a screen reader cannot see. Skipped
   * when unknown ("unknown type" tells nobody anything) and skipped for a
   * plain endpoint host, which the word "endpoint" below already says.
   */
  const nodeRole: NetworkTopologyDeviceRole = roleOfNode(node);
  if (
    nodeRole !== "unknown" &&
    !(nodeRole === "host" && node.kind === "endpoint")
  ) {
    parts.push(labelForDeviceRole(nodeRole).toLowerCase());
  }
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
  /*
   * "Reported by" is the one verb that must not be used about an inferred
   * link: nothing reported it, and a keyboard user gets this string and
   * nothing else. Its evidence protocol ("fdb") is folded into the same
   * clause rather than listed beside it, which would otherwise read as
   * "reported by FDB AND INFERRED".
   */
  const inferred: boolean = Boolean(
    edge.protocols && edge.protocols.includes("inferred"),
  );
  const reported: Array<string> = (edge.protocols || []).filter(
    (protocol: string) => {
      return !inferred || (protocol !== "inferred" && protocol !== "fdb");
    },
  );
  if (reported.length > 0) {
    parts.push(`reported by ${reported.join(" and ").toUpperCase()}`);
  }
  if (inferred) {
    parts.push("inferred from the forwarding database");
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
