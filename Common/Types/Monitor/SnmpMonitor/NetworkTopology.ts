/*
 * A derived view of the network topology for one project, built server-side
 * from the LLDP and CDP neighbor data each device reports. Nodes are devices;
 * unmanaged neighbors (discovery-protocol peers with no matching
 * NetworkDevice) appear as lightweight nodes so the graph doesn't dead-end.
 * Edges are physical links — one per device pair even when both ends (or
 * both protocols) report it — annotated with the operational state of the
 * interface at each end when the neighbor entry identifies it.
 */
export type NetworkTopologyNodeStatus = "up" | "down" | "unknown";

// Which discovery protocol(s) reported a link.
export type NetworkTopologyLinkProtocol = "lldp" | "cdp";

export interface NetworkTopologyNode {
  // Device id for managed nodes; a synthetic "unmanaged:<key>" id otherwise.
  id: string;
  name: string;
  isManaged: boolean;
  status: NetworkTopologyNodeStatus;
  interfacesUp?: number | undefined;
  interfacesDown?: number | undefined;
  // Extra device identity for search and the detail panel (managed nodes).
  sysName?: string | undefined;
  vendor?: string | undefined;
  // For unmanaged CDP peers this carries the reported platform string.
  deviceModel?: string | undefined;
}

/*
 * Operational state of one end of a link, resolved from the NetworkInterface
 * row for that (device, interfaceIndex) pair when the neighbor entry carries
 * enough to identify it. All fields optional — enrichment is best-effort.
 */
export interface NetworkTopologyEdgeEndpoint {
  interfaceIndex?: number | undefined;
  interfaceName?: string | undefined;
  isOperationallyUp?: boolean | undefined;
  isAdministrativelyUp?: boolean | undefined;
  utilizationPercent?: number | undefined;
  inRateMbps?: number | undefined;
  outRateMbps?: number | undefined;
  errorsPerSecond?: number | undefined;
}

export interface NetworkTopologyEdge {
  fromNodeId: string;
  toNodeId: string;
  fromPort?: string | undefined;
  toPort?: string | undefined;
  // Discovery protocols that reported this link (deduped union).
  protocols?: Array<NetworkTopologyLinkProtocol> | undefined;
  // Operational data at each end, when the endpoint interface is known.
  fromInterface?: NetworkTopologyEdgeEndpoint | undefined;
  toInterface?: NetworkTopologyEdgeEndpoint | undefined;
}

export default interface NetworkTopology {
  nodes: Array<NetworkTopologyNode>;
  edges: Array<NetworkTopologyEdge>;
  // True when the device query hit its per-project cap — graph may be partial.
  isTruncated?: boolean | undefined;
}
