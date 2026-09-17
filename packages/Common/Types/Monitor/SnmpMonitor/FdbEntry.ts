/*
 * One entry from a switch's forwarding database (BRIDGE-MIB dot1dTpFdbTable
 * or Q-BRIDGE-MIB dot1qTpFdbTable). Each row says "this MAC address was
 * learned on this bridge port" — the raw material for endpoint discovery.
 * The probe resolves bridgePort to an ifIndex via dot1dBasePortIfIndex when
 * the device implements it; the server turns MACs learned on leaf ports
 * into endpoint nodes on the topology graph.
 */
export default interface FdbEntry {
  macAddress: string;
  bridgePort: number;
  // ifIndex the bridge port maps to, when dot1dBasePortIfIndex resolved it.
  interfaceIndex?: number | undefined;
  // From Q-BRIDGE-MIB walks; undefined when only dot1d data was available.
  vlanId?: number | undefined;
  // dot1dTpFdbStatus, decoded: e.g. "learned", "self", "mgmt".
  status?: string | undefined;
}
