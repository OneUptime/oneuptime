import {
  NetworkTopologyEdge,
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
 * True when the edge came from the bridge forwarding database — an
 * endpoint attachment, not a discovery-protocol link between network
 * devices. Edges from older payloads carry no protocols and are always
 * LLDP/CDP links.
 */
export function isFdbEdge(edge: NetworkTopologyEdge): boolean {
  return Boolean(edge.protocols && edge.protocols.includes("fdb"));
}

/**
 * Tooltip line for an endpoint node: name plus whatever identity the
 * ARP/FDB join produced, e.g.
 * "pos-2 (endpoint) — aa:bb:cc:dd:ee:ff · 10.0.0.12 · Zebra · printer".
 * Every field is best-effort, so absent ones are simply skipped.
 */
export function endpointTooltipForNode(node: NetworkTopologyNode): string {
  const identity: string = [
    node.macAddress,
    node.ipAddress,
    node.vendor,
    node.classification,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${node.name} (endpoint)${identity ? ` — ${identity}` : ""}`;
}
