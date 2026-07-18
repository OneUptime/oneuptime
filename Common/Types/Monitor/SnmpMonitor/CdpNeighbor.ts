/*
 * One neighbor entry from a Cisco device's CDP cache (CISCO-CDP-MIB
 * cdpCacheTable). Collected as a fallback/complement to LLDP — plenty of
 * Cisco estates run CDP only, and without it their topology is empty. The
 * server matches remoteDeviceId against known NetworkDevices the same way it
 * matches LLDP remoteSysName.
 */
export default interface CdpNeighbor {
  localInterfaceIndex?: number | undefined;
  remoteDeviceId?: string | undefined;
  remotePortId?: string | undefined;
  remotePlatform?: string | undefined;
}
