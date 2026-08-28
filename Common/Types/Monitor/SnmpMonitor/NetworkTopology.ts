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
 * Which source(s) reported a link — a discovery protocol, the bridge
 * forwarding database (endpoint attachment), or a person.
 *
 * "manual" is a NetworkDeviceLink an operator drew: a cable neither protocol
 * can see, because one end has discovery disabled, does not speak LLDP or
 * CDP, or is monitored by ping alone. It is a protocol like the others so a
 * hand-drawn link and a later-discovered one MERGE into a single edge
 * carrying both, rather than doubling the line on the map.
 */
export type NetworkTopologyLinkProtocol = "lldp" | "cdp" | "fdb" | "manual";

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

/*
 * Why a device is drawn with no links.
 *
 * "The router is not linked to any device" is a report we could previously
 * only answer with a shrug — the map showed an isolated box and nothing about
 * which of the several possible causes was the real one. These fields turn
 * that into a sentence: discovery never ran, or it ran and the device
 * reported nothing, or it reported neighbours that matched nothing we manage
 * (and here is what they called themselves).
 *
 * Present on managed device nodes only; absent on older payloads.
 */
export interface NetworkTopologyNodeDiagnostics {
  /*
   * False when the device's interface walk is off. LLDP and CDP ride along
   * with that walk, so a device with it disabled can never report a
   * neighbour, however well it speaks either protocol.
   */
  isNeighborDiscoveryEnabled?: boolean | undefined;
  // How many neighbour entries the device's last poll reported.
  reportedNeighborCount: number;
  /*
   * What the unresolved neighbours called themselves. This is the actionable
   * half: an operator reading "advertised OLD-CORE-SW1" knows immediately
   * that a device was renamed, which no amount of "no links found" conveys.
   */
  unmatchedNeighborIdentifiers: Array<string>;
}

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
   * Endpoint identity, all best-effort: MAC from the FDB, IP from the ARP
   * join, classification from OUI/heuristics (e.g. "pos-terminal",
   * "camera", "printer"), VLAN from the FDB entry that learned the MAC.
   * Optional so older payloads stay valid.
   *
   * `ipAddress` is the exception to "endpoint nodes only": an UNMANAGED
   * peer carries it too, from the management address its neighbours
   * advertise for it (CDP cdpCacheAddress / LLDP lldpRemManAddrTable). It
   * is the field that makes such a peer actionable rather than merely
   * visible — nothing can be monitored without an address — so a reader
   * must not assume a node with an ipAddress is an endpoint.
   */
  macAddress?: string | undefined;
  ipAddress?: string | undefined;
  classification?: string | undefined;
  vlanId?: number | undefined;
  // Why this device has no links. Managed device nodes only.
  diagnostics?: NetworkTopologyNodeDiagnostics | undefined;
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
  /*
   * Health for a link that has no interface counters of its own — a manual
   * link with a Monitor bound to it. Readers prefer real interface data and
   * fall back to this, so a discovered link never loses its measured state
   * to a monitor's summary of it.
   */
  monitorState?: "up" | "down" | undefined;
  // Operator-supplied label, set only on manual links.
  name?: string | undefined;
  /*
   * Which end of this edge is the parent, when somebody has SAID so —
   * either on the link itself or through a link rule, which is stated in
   * child/parent labels and so knows the answer by construction.
   *
   * Always one of `fromNodeId`/`toNodeId`. Absent on every discovered
   * edge: LLDP and CDP report a cable, not a hierarchy, and the direction
   * a neighbour entry happens to be read from says nothing about which
   * box is upstream. Layouts that draw a tree must therefore treat this as
   * a constraint where it is present and keep inferring where it is not —
   * absent is "not stated", never "these are peers".
   */
  parentNodeId?: string | undefined;
}

export default interface NetworkTopology {
  nodes: Array<NetworkTopologyNode>;
  edges: Array<NetworkTopologyEdge>;
  // True when the device query hit its per-project cap — graph may be partial.
  isTruncated?: boolean | undefined;
}
