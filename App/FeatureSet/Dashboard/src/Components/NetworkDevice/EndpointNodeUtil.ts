import {
  NetworkTopologyEdge,
  NetworkTopologyEdgeEndpoint,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";

/*
 * Pure, react-free helpers for endpoint nodes and FDB edges on the network
 * topology graph. Kept out of the .tsx graph component so they can be
 * imported (and unit-tested) in a plain Node/TypeScript environment, same
 * as TopologyLayout.
 */

/**
 * True when the node is a discovered endpoint (POS terminal, camera,
 * printer, ...). Older payloads carry no kind — they can only be devices
 * or unmanaged peers, never endpoints, so a missing kind is never an
 * endpoint.
 */
export function isEndpointNode(node: NetworkTopologyNode): boolean {
  return node.kind === "endpoint";
}

/**
 * True when the edge came from the bridge forwarding database — a switch
 * learned the far end's MAC on one of its ports. The far end is usually an
 * anonymous endpoint node, but it can also be a MANAGED device: one whose
 * declared (or ARP-learned) MAC matched a forwarding-table row, so the
 * table, not a discovery protocol, is what put it on the map. Either way
 * the edge is an attachment, not an LLDP/CDP link between two network
 * devices. Edges from older payloads carry no protocols and are always
 * LLDP/CDP links.
 */
export function isFdbEdge(edge: NetworkTopologyEdge): boolean {
  return Boolean(edge.protocols && edge.protocols.includes("fdb"));
}

/**
 * The label for one end of an edge, in the same precedence every drawer
 * uses: the interface row's name, then the advertised port id, then
 * "if<index>" when only the index is known — and undefined when nothing
 * identifies the end, so each caller can pick its own placeholder.
 */
export function portLabelForEdgeEnd(
  endpoint: NetworkTopologyEdgeEndpoint | undefined,
  portLabel: string | undefined,
): string | undefined {
  return (
    endpoint?.interfaceName ||
    portLabel ||
    (endpoint?.interfaceIndex !== undefined
      ? `if${endpoint.interfaceIndex}`
      : undefined)
  );
}

/**
 * The two ends of a forwarding-table edge, told apart by WHICH ONE LEARNED.
 *
 * A fresh attachment is drawn switch → device, but an attachment merged
 * into a link that already joined the pair keeps that link's ends, which
 * may be stored the other way round. The builder stamps `learnedByNodeId`
 * for exactly this reason; a payload from before it did is read the old
 * way, learner = from end.
 */
export interface FdbEdgeEnds {
  learnerId: string;
  learnedId: string;
  learnerInterface: NetworkTopologyEdgeEndpoint | undefined;
  learnerPort: string | undefined;
  learnedInterface: NetworkTopologyEdgeEndpoint | undefined;
  learnedPort: string | undefined;
}

export function fdbEdgeEnds(edge: NetworkTopologyEdge): FdbEdgeEnds {
  const learnerIsTo: boolean =
    edge.learnedByNodeId !== undefined &&
    edge.learnedByNodeId === edge.toNodeId;
  if (learnerIsTo) {
    return {
      learnerId: edge.toNodeId,
      learnedId: edge.fromNodeId,
      learnerInterface: edge.toInterface,
      learnerPort: edge.toPort,
      learnedInterface: edge.fromInterface,
      learnedPort: edge.fromPort,
    };
  }
  return {
    learnerId: edge.fromNodeId,
    learnedId: edge.toNodeId,
    learnerInterface: edge.fromInterface,
    learnerPort: edge.fromPort,
    learnedInterface: edge.toInterface,
    learnedPort: edge.toPort,
  };
}

/**
 * Where a switch's forwarding table says a managed device is plugged in.
 * Built from the "fdb" edge that adopted the device, so a drawer can say
 * "switch-01 · Gi0/12 · VLAN 42" without re-deriving which end is which.
 */
export interface LearnedAttachment {
  switchNodeId: string;
  switchName: string;
  // The switch port the MAC was learned on; undefined when the row named none.
  port: string | undefined;
  // The VLAN the MAC was learned on, as stamped onto the device node.
  vlanId: number | undefined;
  // True when the switch's interface row reports that port operationally down.
  isSwitchPortDown: boolean;
}

/**
 * The learned attachment of a managed device, or undefined when the device
 * was not placed by a forwarding table.
 *
 * A forwarding-table edge is drawn switch → device: the switch is the end
 * that LEARNED, the device the end that was learned. So a device is
 * attached only when it is the to-end; a switch that is the from-end of
 * ten fdb edges has ten things hanging off it and is attached to none of
 * them. Endpoint and unmanaged nodes never qualify — an endpoint node is
 * the row that did NOT match a device, and a peer is placed by LLDP/CDP.
 *
 * A device seen in two switches' tables (a stale entry after a move, a
 * MAC bridged through a hub) picks the lowest switch id, so the drawer
 * does not flip between the two on every refresh.
 */
export function learnedAttachmentForNode(
  node: NetworkTopologyNode,
  edges: Array<NetworkTopologyEdge>,
  nodeById: Map<string, NetworkTopologyNode>,
): LearnedAttachment | undefined {
  /*
   * Older payloads carry no kind; the type asks readers to derive it from
   * isManaged, and a managed node from such a payload has no fdb edge to
   * find anyway.
   */
  const kind: string = node.kind || (node.isManaged ? "device" : "unmanaged");
  if (kind !== "device") {
    return undefined;
  }

  let chosen: FdbEdgeEnds | undefined = undefined;
  for (const edge of edges) {
    if (!isFdbEdge(edge)) {
      continue;
    }
    const ends: FdbEdgeEnds = fdbEdgeEnds(edge);
    if (ends.learnedId !== node.id || ends.learnerId === node.id) {
      continue;
    }
    if (!chosen || ends.learnerId < chosen.learnerId) {
      chosen = ends;
    }
  }

  if (!chosen) {
    return undefined;
  }

  const switchNode: NetworkTopologyNode | undefined = nodeById.get(
    chosen.learnerId,
  );

  return {
    switchNodeId: chosen.learnerId,
    switchName: switchNode?.name || chosen.learnerId,
    port: portLabelForEdgeEnd(chosen.learnerInterface, chosen.learnerPort),
    vlanId: node.vlanId,
    isSwitchPortDown: chosen.learnerInterface?.isOperationallyUp === false,
  };
}

/**
 * Tooltip line for an endpoint node: name plus whatever identity the
 * ARP/FDB join produced, e.g.
 * "pos-2 (endpoint) — aa:bb:cc:dd:ee:ff · 10.0.0.12 · Zebra · printer · VLAN 12".
 * Every field is best-effort, so absent ones are simply skipped.
 */
export function endpointTooltipForNode(node: NetworkTopologyNode): string {
  const identity: string = [
    node.macAddress,
    node.ipAddress,
    node.vendor,
    node.classification,
    typeof node.vlanId === "number" ? `VLAN ${node.vlanId}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${node.name} (endpoint)${identity ? ` — ${identity}` : ""}`;
}
