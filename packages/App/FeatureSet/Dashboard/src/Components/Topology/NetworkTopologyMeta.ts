import {
  NetworkTopologyDeviceRole,
  NetworkTopologyEdge,
  NetworkTopologyEdgeEndpoint,
  NetworkTopologyLinkProtocol,
  NetworkTopologyMonitorNotChecked,
  NetworkTopologyNode,
  NetworkTopologyNodeDiagnostics,
  NetworkTopologyNodePlacementDiagnostics,
  NetworkTopologyNodeStatus,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { isMonitorNotCheckedReason } from "Common/Types/Monitor/MonitorNotCheckedReason";
import { getNetworkControllerProviderShortTitle } from "Common/Types/NetworkController/NetworkControllerProvider";
import { fillTemplate, translationKey } from "Common/Types/Translator";
import { DEVICE_ROLES_IN_LEGEND_ORDER } from "Common/Utils/Monitor/NetworkDeviceRoleUtil";
import {
  getMacSearchHex,
  macMatchesSearchHex,
} from "Common/Utils/NetworkDevice/DiscoveredDeviceIdentity";
import {
  TopologyNodeShape,
  isUnclassifiedNode,
  roleDisplayLabelForNode,
  roleKeyOfNode,
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
 * Name, sysName and vendor are the identity fields, and so are a node's
 * addresses (issue #5775): its IP, its MAC - in whichever of the four ways
 * a switch prints one ("AA-BB-CC", "aabb.cc", ...), compared without the
 * separators - and the name its controller or a person gave it. The ROLE
 * is matched too, so typing "firewall" lights up every firewall on the map
 * even though no device is called one. An unclassified node deliberately
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
  /*
   * The project's configured label, so searching for a role a project
   * renamed (or invented) finds it. An unclassified node still answers to
   * nothing role-shaped - see isUnclassifiedNode.
   */
  const roleText: string | undefined = isUnclassifiedNode(node)
    ? undefined
    : roleDisplayLabelForNode(node);
  const isTextMatch: boolean = [
    node.name,
    node.sysName,
    node.vendor,
    node.hostname,
    node.classification,
    node.ipAddress,
    node.macAddress,
    roleText,
  ].some((value: string | undefined) => {
    return Boolean(value && value.toLowerCase().includes(lower));
  });

  return (
    isTextMatch || macMatchesSearchHex(node.macAddress, getMacSearchHex(lower))
  );
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
/*
 * Why nothing placed a device that reports no neighbours, and what would.
 *
 * A register, a handset or a kiosk that only answers ping will never report
 * a neighbour, but what it plugs into can place it, and there are only so many
 * ways that goes wrong. So this names the one that went wrong here, on what
 * the map knows about the device and about its site, rather than listing them
 * all and leaving the operator to work out which it was (issue #5379). The
 * hand-drawn link stays as the fallback for a cable no table can see.
 */
function placementReasonForDiagnostics(
  diagnostics: NetworkTopologyNodeDiagnostics,
): string {
  const placement: NetworkTopologyNodePlacementDiagnostics | undefined =
    diagnostics.placement;

  // A payload from before the map said what it knows.
  if (!placement) {
    return "This device reported no LLDP or CDP neighbours on its last poll. Either it does not run a discovery protocol, or it runs one only on ports that are down. If it only answers ping, set its MAC address on the device — or let a router at its site that collects endpoints learn it — and make sure the switch it plugs into collects endpoints: the map then finds its port in the switch's forwarding table. Draw the link by hand under Device Links if you know what it connects to.";
  }

  const opening: string =
    "This device reported no LLDP or CDP neighbours on its last poll, so only what it plugs into can place it.";

  if (!placement.hasMacAddress && !placement.hasAddressKey) {
    return `${opening} Nothing can recognise it yet: it has no MAC address, and its hostname is a name rather than an IP address. Set its MAC address on the device, or draw the link by hand under Device Links.`;
  }

  if (placement.siteControllerDeviceCount > 0) {
    return `${opening} Meraki describes devices at this site, but lists no client with this device's ${
      placement.hasMacAddress ? "MAC address" : "IP address"
    } on any of them. Meraki's clients are read every two hours, so a new device takes that long to appear. If it stays here, check that the switch it plugs into is a network device here, in the same site as this device. Draw the link by hand under Device Links if Meraki cannot see it.`;
  }

  if (placement.siteEndpointCollectorCount === 0) {
    return `${opening} Nothing at this site reports what is plugged into it. Turn on Collect Connected Endpoints on the site's switches and router, or connect its Meraki organization on the Traffic page. Draw the link by hand under Device Links if you know what it connects to.`;
  }

  if (!placement.hasMacAddress) {
    return `${opening} Devices at this site report what is plugged into them, but nothing has said which MAC address is this device's. Turn on Collect Connected Endpoints on the site's router, so its ARP table can say, or set the MAC address on the device.`;
  }

  return `${opening} Its MAC address is known, but no device at this site that collects endpoints has learned it. Turn on Collect Connected Endpoints on the switch it plugs into, or draw the link by hand under Device Links if that switch cannot report it.`;
}

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
    return placementReasonForDiagnostics(diagnostics);
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
 * The monitor bound to a managed device node that nothing checks - turned
 * off or archived (issue #7346) - when the node is drawn "unknown" because
 * of it, or undefined. The map's drawer puts the device pages' "Monitoring
 * off" or "Monitor archived" pill beside the status for it, with the ways
 * out, and the node's tooltip says why.
 *
 * Only beside "unknown", as the device hero shows the qualifier only beside
 * Pending: a node that still has a status - stamped before its monitor was
 * turned off, and read before the server took the stamp off - shows that
 * status, with nothing beside it claiming it has none. And only for what
 * the payload says in full: a reason this Dashboard does not know (from a
 * newer server) or a missing monitor id says nothing, rather than a guess.
 */
export function monitorNotCheckedForNode(
  node: NetworkTopologyNode,
): NetworkTopologyMonitorNotChecked | undefined {
  const notChecked: NetworkTopologyMonitorNotChecked | undefined =
    node.monitorNotChecked;

  if (
    !notChecked ||
    !node.isManaged ||
    (node.kind !== undefined && node.kind !== "device") ||
    node.status !== "unknown"
  ) {
    return undefined;
  }

  if (
    typeof notChecked.monitorId !== "string" ||
    !notChecked.monitorId.trim() ||
    !isMonitorNotCheckedReason(notChecked.reason)
  ) {
    return undefined;
  }

  return {
    monitorId: notChecked.monitorId.trim(),
    reason: notChecked.reason,
  };
}

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
   * the "Type" group — the node silhouette the role is drawn with.
   */
  swatch: "dot" | "hollow-dot" | "square" | "line" | "dashed-line" | "shape";
  color: string;
  /** Set only on "shape" swatches: which silhouette to draw. */
  shape?: TopologyNodeShape | undefined;
  /*
   * A label with a value in it, as the sentence the map looks up in the
   * reader's language; `label` is the same sentence filled in English (the
   * PDF's words).
   */
  labelTemplate?: { template: string; values: Record<string, number> };
}

// The busy link's key: one sentence with the threshold in it.
const BUSY_LINK_LABEL: string = translationKey("Busy (over {{percent}}%)");

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
    label: fillTemplate(BUSY_LINK_LABEL, {
      percent: LINK_SATURATION_THRESHOLD_PERCENT,
    }),
    labelTemplate: {
      template: BUSY_LINK_LABEL,
      values: { percent: LINK_SATURATION_THRESHOLD_PERCENT },
    },
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
  /*
   * Keyed by role KEY, not by the built-in union, so a project's own role
   * gets its own entry instead of being folded into whatever the classifier
   * guessed underneath it. The first node seen for a key supplies the label
   * and the shape - every node of one key carries the same stamp, because the
   * stamp comes from one row.
   */
  const presentRoles: Map<string, NetworkTopologyNode> = new Map<
    string,
    NetworkTopologyNode
  >();
  for (const node of nodes || []) {
    if (!node || isUnclassifiedNode(node)) {
      continue;
    }
    const key: string = roleKeyOfNode(node);
    if (!presentRoles.has(key)) {
      presentRoles.set(key, node);
    }
  }

  const entryForNode: (node: NetworkTopologyNode) => TopologyLegendEntry = (
    node: NetworkTopologyNode,
  ): TopologyLegendEntry => {
    return {
      group: "Type",
      label: roleDisplayLabelForNode(node),
      swatch: "shape",
      color: LEGEND_SHAPE_COLOR,
      shape: shapeForNode(node),
    };
  };

  const typeEntries: Array<TopologyLegendEntry> = [];
  const emittedKeys: Set<string> = new Set<string>();

  /*
   * Built-in roles first and in the fixed legend order, so the familiar keys
   * never reshuffle themselves under a poll. Anything left over is a role the
   * project added; those follow, in the order they appear on the map, which is
   * itself stable for a given payload.
   */
  for (const role of DEVICE_ROLES_IN_LEGEND_ORDER) {
    const node: NetworkTopologyNode | undefined = presentRoles.get(role);
    if (!node) {
      continue;
    }
    typeEntries.push(entryForNode(node));
    emittedKeys.add(role);
  }

  for (const [key, node] of presentRoles) {
    if (emittedKeys.has(key)) {
      continue;
    }
    typeEntries.push(entryForNode(node));
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
    !isUnclassifiedNode(node) &&
    !(nodeRole === "host" && node.kind === "endpoint")
  ) {
    parts.push(roleDisplayLabelForNode(node).toLowerCase());
  }
  if (node.kind === "endpoint") {
    parts.push("endpoint");
    // Once: a device nothing named is called by its address already.
    if (node.ipAddress && node.ipAddress !== node.name) {
      parts.push(node.ipAddress);
    }
    if (typeof node.vlanId === "number") {
      parts.push(`VLAN ${node.vlanId}`);
    }
  } else {
    parts.push(node.isManaged ? "managed device" : "unmanaged peer");
    if (node.ipAddress && node.ipAddress !== node.name) {
      parts.push(node.ipAddress);
    }
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
  const reporter: string | undefined = getNetworkControllerProviderShortTitle(
    edge.reportedBy,
  );
  if (reporter) {
    parts.push(`read from ${reporter}`);
  }
  return parts.join(", ");
}

/**
 * The labels of what reported a link, for the chips on its drawer. An "fdb"
 * edge a controller reported came from its client list, not from a table
 * OneUptime walked, so it is labelled with the controller and not as FDB.
 */
export function linkSourceLabelsForEdge(
  edge: NetworkTopologyEdge,
): Array<string> {
  const reporter: string | undefined = getNetworkControllerProviderShortTitle(
    edge.reportedBy,
  );
  const labels: Array<string> = (edge.protocols || [])
    .filter((protocol: NetworkTopologyLinkProtocol): boolean => {
      return !reporter || protocol !== "fdb";
    })
    .map((protocol: NetworkTopologyLinkProtocol): string => {
      return protocol.toUpperCase();
    });

  if (reporter) {
    labels.push(reporter);
  }

  return labels;
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
