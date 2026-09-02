import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  isEndpointNode,
  isInferredEdge,
} from "../NetworkDevice/EndpointNodeUtil";
import {
  LINK_STATE_COLORS,
  NODE_STATUS_COLORS,
  linkStateForEdge,
} from "./NetworkTopologyMeta";

/*
 * Pure, react-free health classification and filtering for the network
 * topology graph.
 *
 * Issue #3261: the map already coloured every node red or green, which
 * answers "is this one down" for a node you have already found. It does
 * not answer the question an operator actually opens the map with —
 * "WHICH of my four hundred devices needs me" — because that one is
 * answered by scanning, and scanning does not scale past a screenful.
 *
 * So health becomes a FILTER rather than only a colour. Kept out of the
 * .tsx for the same reason NetworkTopologyViewModel is: App/Tests runs in
 * a plain Node environment and cannot render a component, so anything
 * decided while rendering is beyond the reach of the suite.
 */

/**
 * What we know about one node's health.
 *
 * "degraded" is the state the old red/green pair could not express, and
 * it is the interesting one: a switch that answers polls perfectly well
 * while three of its ports are dark is not down, but it is exactly what
 * somebody wants to be pointed at.
 */
export type TopologyHealthState = "down" | "degraded" | "healthy" | "unknown";

/**
 * What the health control is currently narrowed to. "attention" is the
 * union of down and degraded — the default answer to "show me what needs
 * me" — and the two component states are offered separately for when the
 * answer is "yes, but I only care about hard-down right now".
 */
export type TopologyHealthFilterMode =
  | "all"
  | "attention"
  | "down"
  | "degraded";

export const ALL_HEALTH_FILTER_MODES: ReadonlyArray<TopologyHealthFilterMode> =
  ["all", "attention", "down", "degraded"];

/** True when the mode hides anything at all. */
export function isHealthFilterActive(mode: TopologyHealthFilterMode): boolean {
  return mode !== "all";
}

/** Does one node's health satisfy the requested filter? */
export function healthStateMatchesMode(
  state: TopologyHealthState,
  mode: TopologyHealthFilterMode,
): boolean {
  switch (mode) {
    case "all":
      return true;
    case "attention":
      return state === "down" || state === "degraded";
    case "down":
      return state === "down";
    case "degraded":
      return state === "degraded";
    default:
      return true;
  }
}

/**
 * Everything about a node's surroundings that its health depends on.
 * Passed in rather than looked up so the classifier stays a pure function
 * of its arguments and can be tested one node at a time.
 */
export interface TopologyHealthContext {
  /** True when at least one link touching this node is operationally down. */
  hasDownLink?: boolean | undefined;
}

/**
 * The health of one node.
 *
 * Reachability leads: a device that does not answer is down whatever its
 * last interface counts said, because those counts are by definition
 * stale. Only once a node is known to be UP does the second question —
 * "is everything under it healthy" — get asked, and there a dark port or
 * a dead link is what makes it degraded.
 *
 * A node whose status is "unknown" stays unknown even when a link at its
 * end is down. Unknown means we have no verdict, and inventing "degraded"
 * for a never-polled device would fill an operator's attention list with
 * onboarding rather than with outages — the device at the OTHER end of
 * that dead link is polled, and reports the same problem honestly.
 */
export function healthStateForNode(
  node: NetworkTopologyNode,
  context?: TopologyHealthContext | undefined,
): TopologyHealthState {
  if (!node) {
    return "unknown";
  }

  if (node.status === "down") {
    return "down";
  }

  if (node.status !== "up") {
    return "unknown";
  }

  /*
   * Endpoints are hosts we learned about from a switch's forwarding
   * table, not things we poll. They carry no interface counts of their
   * own, so the only thing that could degrade one is the link that
   * discovered it — and that link's health belongs to the switch.
   */
  if (isEndpointNode(node)) {
    return "healthy";
  }

  if ((node.interfacesDown ?? 0) > 0) {
    return "degraded";
  }

  if (context?.hasDownLink) {
    return "degraded";
  }

  return "healthy";
}

/** Node ids with at least one operationally-down link attached. */
export function nodeIdsWithDownLinks(
  edges: Array<NetworkTopologyEdge> | undefined,
): Set<string> {
  const ids: Set<string> = new Set<string>();
  for (const edge of edges || []) {
    if (!edge || !edge.fromNodeId || !edge.toNodeId) {
      continue;
    }
    if (linkStateForEdge(edge) !== "down") {
      continue;
    }
    ids.add(edge.fromNodeId);
    ids.add(edge.toNodeId);
  }
  return ids;
}

/** Health for every node in one topology, keyed by node id. */
export function healthStateByNodeId(
  nodes: Array<NetworkTopologyNode> | undefined,
  edges: Array<NetworkTopologyEdge> | undefined,
): Map<string, TopologyHealthState> {
  const downLinkNodeIds: Set<string> = nodeIdsWithDownLinks(edges);
  const byId: Map<string, TopologyHealthState> = new Map<
    string,
    TopologyHealthState
  >();
  for (const node of nodes || []) {
    if (!node || typeof node.id !== "string") {
      continue;
    }
    byId.set(
      node.id,
      healthStateForNode(node, {
        hasDownLink: downLinkNodeIds.has(node.id),
      }),
    );
  }
  return byId;
}

export interface TopologyHealthSummary {
  total: number;
  down: number;
  degraded: number;
  healthy: number;
  unknown: number;
  /** down + degraded — what the "Needs attention" chip counts. */
  attention: number;
}

/**
 * The counts behind the health chips.
 *
 * Deliberately computed over the nodes the caller hands in, so a view
 * that has already hidden endpoints or a VLAN reports the health of what
 * is ON SCREEN. A chip that says "3 down" over a map showing none of them
 * is worse than no chip.
 */
export function summarizeTopologyHealth(
  nodes: Array<NetworkTopologyNode> | undefined,
  edges: Array<NetworkTopologyEdge> | undefined,
): TopologyHealthSummary {
  const summary: TopologyHealthSummary = {
    total: 0,
    down: 0,
    degraded: 0,
    healthy: 0,
    unknown: 0,
    attention: 0,
  };

  const stateById: Map<string, TopologyHealthState> = healthStateByNodeId(
    nodes,
    edges,
  );

  for (const state of stateById.values()) {
    summary.total++;
    summary[state]++;
  }
  summary.attention = summary.down + summary.degraded;

  return summary;
}

/**
 * How many nodes each mode would leave on the map. Used for the counts on
 * the filter chips, so a mode that would empty the canvas can say so
 * before it is pressed.
 */
export function healthCountForMode(
  summary: TopologyHealthSummary,
  mode: TopologyHealthFilterMode,
): number {
  switch (mode) {
    case "all":
      return summary.total;
    case "attention":
      return summary.attention;
    case "down":
      return summary.down;
    case "degraded":
      return summary.degraded;
    default:
      return summary.total;
  }
}

export interface TopologyHealthVisibilityInput {
  nodes: Array<NetworkTopologyNode>;
  edges: Array<NetworkTopologyEdge>;
  mode: TopologyHealthFilterMode;
  /**
   * Nodes the caller has already removed for other reasons (a kind
   * filter, a VLAN). They can neither match nor be pulled back in as
   * context — a health filter must not resurrect a node type the user
   * switched off.
   */
  eligibleNodeIds?: ReadonlySet<string> | undefined;
}

export interface TopologyHealthVisibility {
  /** Nodes in the requested health state — drawn at full strength. */
  matchedNodeIds: ReadonlySet<string>;
  /** Neighbours kept only to explain where the matches sit — drawn dimmed. */
  contextNodeIds: ReadonlySet<string>;
  /** matched ∪ context: everything the graph should still draw. */
  visibleNodeIds: ReadonlySet<string>;
  stateByNodeId: ReadonlyMap<string, TopologyHealthState>;
}

/**
 * Which nodes survive a health filter, and which of those are only there
 * for context.
 *
 * A filtered map that shows the three dead switches and nothing else
 * answers "what is broken" and immediately raises "broken WHERE" — the
 * links vanish along with the nodes they connected to, so the survivors
 * land as unconnected dots. Directly-linked NETWORK NEIGHBOURS are
 * therefore kept, dimmed, so each match keeps the piece of fabric that
 * places it.
 *
 * Endpoints are never pulled in as context, however: a single down access
 * switch can have two hundred learned hosts hanging off it, and dragging
 * that fan back onto a map whose entire purpose was to be short would
 * undo the filter at the first switch it matched.
 *
 * A device placed by endpoint inference (issue #3489) is drawn as the
 * DEVICE it is, not as an endpoint, so that rule no longer catches it — and
 * forty tills is the same fan by another name. The distinction that saves it
 * is one the edge already carries: an inferred edge names the switch as the
 * parent. Matched till pulls in its switch, which is the single most useful
 * thing this feature adds here; matched switch does not pull in its forty
 * tills.
 */
export function resolveHealthVisibility(
  input: TopologyHealthVisibilityInput,
): TopologyHealthVisibility {
  const stateByNodeId: Map<string, TopologyHealthState> = healthStateByNodeId(
    input.nodes,
    input.edges,
  );

  const isEligible: (nodeId: string) => boolean = (nodeId: string): boolean => {
    return !input.eligibleNodeIds || input.eligibleNodeIds.has(nodeId);
  };

  const matchedNodeIds: Set<string> = new Set<string>();
  const nodeById: Map<string, NetworkTopologyNode> = new Map<
    string,
    NetworkTopologyNode
  >();
  for (const node of input.nodes || []) {
    if (!node || typeof node.id !== "string") {
      continue;
    }
    nodeById.set(node.id, node);
    if (!isEligible(node.id)) {
      continue;
    }
    const state: TopologyHealthState = stateByNodeId.get(node.id) || "unknown";
    if (healthStateMatchesMode(state, input.mode)) {
      matchedNodeIds.add(node.id);
    }
  }

  if (!isHealthFilterActive(input.mode)) {
    return {
      matchedNodeIds: matchedNodeIds,
      contextNodeIds: new Set<string>(),
      visibleNodeIds: matchedNodeIds,
      stateByNodeId: stateByNodeId,
    };
  }

  const contextNodeIds: Set<string> = new Set<string>();
  for (const edge of input.edges || []) {
    if (!edge || !edge.fromNodeId || !edge.toNodeId) {
      continue;
    }
    const ends: Array<[string, string]> = [
      [edge.fromNodeId, edge.toNodeId],
      [edge.toNodeId, edge.fromNodeId],
    ];
    for (const [matchedEnd, otherEnd] of ends) {
      if (!matchedNodeIds.has(matchedEnd)) {
        continue;
      }
      if (matchedNodeIds.has(otherEnd) || !isEligible(otherEnd)) {
        continue;
      }
      const neighbor: NetworkTopologyNode | undefined = nodeById.get(otherEnd);
      if (!neighbor || isEndpointNode(neighbor)) {
        continue;
      }
      /*
       * The matched end is the switch of an inferred uplink, so the other
       * end is a leaf that was only placed BY that switch. Same fan, same
       * reason to leave it out — and asymmetric, so the reverse direction
       * (a matched leaf keeping the switch that places it) still works.
       */
      if (isInferredEdge(edge) && edge.parentNodeId === matchedEnd) {
        continue;
      }
      contextNodeIds.add(otherEnd);
    }
  }

  const visibleNodeIds: Set<string> = new Set<string>(matchedNodeIds);
  for (const nodeId of contextNodeIds) {
    visibleNodeIds.add(nodeId);
  }

  return {
    matchedNodeIds: matchedNodeIds,
    contextNodeIds: contextNodeIds,
    visibleNodeIds: visibleNodeIds,
    stateByNodeId: stateByNodeId,
  };
}

/*
 * Chip presentation. Colours reuse the map's own palette so the chip that
 * says "3 down" is unmistakably the same red as the three dots it points
 * at — a health legend in a second colour scheme would be one more thing
 * to reconcile rather than a shortcut.
 */
export const HEALTH_STATE_COLORS: Record<TopologyHealthState, string> = {
  down: NODE_STATUS_COLORS.down,
  degraded: LINK_STATE_COLORS.saturated,
  healthy: NODE_STATUS_COLORS.up,
  unknown: NODE_STATUS_COLORS.unknown,
};

/*
 * Shaped to satisfy Components/Filters/StatusChipGroup's option contract
 * — hence `value` rather than `mode` — so the map's health control and
 * the site map's are literally the same component.
 */
export interface TopologyHealthFilterOption {
  value: TopologyHealthFilterMode;
  label: string;
  /** Long-form help, shown as the chip's title attribute. */
  description: string;
  /** The dot colour, or undefined for "All" which stands for no state. */
  color: string | undefined;
  count: number;
  testId: string;
}

/**
 * The chips to draw, in a fixed order, with their live counts.
 *
 * "All" is always offered — it is how a filter is cleared. A state chip
 * is offered even at zero: "Down 0" is a genuinely useful thing for a map
 * to say, and a chip row that reshuffles as devices fail is a row nobody
 * can build muscle memory for.
 */
export function buildHealthFilterOptions(
  summary: TopologyHealthSummary,
): Array<TopologyHealthFilterOption> {
  const labels: Record<
    TopologyHealthFilterMode,
    { label: string; description: string; color: string | undefined }
  > = {
    all: {
      label: "All",
      description: "Show every device on the map.",
      color: undefined,
    },
    attention: {
      label: "Needs attention",
      description:
        "Devices that are down, plus reachable devices with a dead interface or link.",
      color: HEALTH_STATE_COLORS.down,
    },
    down: {
      label: "Down",
      description: "Devices that did not answer their last poll.",
      color: HEALTH_STATE_COLORS.down,
    },
    degraded: {
      label: "Degraded",
      description:
        "Reachable devices carrying at least one down interface or link.",
      color: HEALTH_STATE_COLORS.degraded,
    },
  };

  return ALL_HEALTH_FILTER_MODES.map(
    (mode: TopologyHealthFilterMode): TopologyHealthFilterOption => {
      return {
        value: mode,
        label: labels[mode].label,
        description: labels[mode].description,
        color: labels[mode].color,
        count: healthCountForMode(summary, mode),
        testId: `network-topology-health-filter-${mode}`,
      };
    },
  );
}
