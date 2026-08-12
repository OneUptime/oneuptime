/*
 * A derived view of the network topology for one project, built server-side
 * from the LLDP and CDP neighbor data each device reports (and, when
 * endpoint collection is enabled, the ARP/FDB endpoint data). Nodes are
 * devices; unmanaged neighbors (discovery-protocol peers with no matching
 * NetworkDevice) appear as lightweight nodes so the graph doesn't dead-end,
 * and discovered endpoints appear as "endpoint" nodes attached via "fdb"
 * links.
 * Edges are physical links — one per device pair even when both ends (or
 * both protocols) report it — annotated with the operational state of the
 * interface at each end when the neighbor entry identifies it.
 */
export type NetworkTopologyNodeStatus = "up" | "down" | "unknown";

/*
 * Which source(s) reported a link — a discovery protocol, or the bridge
 * forwarding database (endpoint attachment).
 */
export type NetworkTopologyLinkProtocol = "lldp" | "cdp" | "fdb";

/*
 * What a node represents. Older payloads carry no kind — readers should
 * derive it from isManaged ("device" when true, "unmanaged" otherwise).
 * "endpoint" nodes are non-network hosts (POS terminals, cameras, kiosks)
 * discovered from ARP/FDB data.
 */
export type NetworkTopologyNodeKind = "device" | "unmanaged" | "endpoint";

/*
 * What the node DOES on the network, as opposed to what we know about it
 * (`kind`). Derived server-side from the identity SNMP and the discovery
 * protocols already report — sysObjectId, sysDescr, model/platform, and
 * finally the hostname — because a map on which a router, a switch and a
 * camera are the same circle cannot be read at a glance.
 *
 * "unknown" is a real answer, not a failure: guessing a role from thin
 * evidence is worse than drawing a neutral node, so the classifier only
 * commits when the evidence names a product family or says the word.
 */
export type NetworkTopologyDeviceRole =
  | "router"
  | "switch"
  | "firewall"
  | "wirelessAccessPoint"
  | "loadBalancer"
  | "server"
  | "storage"
  | "printer"
  | "camera"
  | "phone"
  | "host"
  | "unknown";

export interface NetworkTopologyNode {
  // Device id for managed nodes; a synthetic "unmanaged:<key>" id otherwise.
  id: string;
  name: string;
  isManaged: boolean;
  status: NetworkTopologyNodeStatus;
  // Missing on older payloads — derive from isManaged.
  kind?: NetworkTopologyNodeKind | undefined;
  /*
   * What the node does on the network (router, switch, firewall, ...).
   * Missing on older payloads, and "unknown" when the evidence did not
   * name one — readers must treat both the same way.
   */
  role?: NetworkTopologyDeviceRole | undefined;
  interfacesUp?: number | undefined;
  interfacesDown?: number | undefined;
  // Extra device identity for search and the detail panel (managed nodes).
  sysName?: string | undefined;
  vendor?: string | undefined;
  // For unmanaged CDP peers this carries the reported platform string.
  deviceModel?: string | undefined;
  /*
   * Endpoint identity (endpoint nodes only), all best-effort: MAC from the
   * FDB, IP from the ARP join, classification from OUI/heuristics (e.g.
   * "pos-terminal", "camera", "printer"), VLAN from the FDB entry that
   * learned the MAC. Optional so older payloads stay valid.
   */
  macAddress?: string | undefined;
  ipAddress?: string | undefined;
  classification?: string | undefined;
  vlanId?: number | undefined;
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
