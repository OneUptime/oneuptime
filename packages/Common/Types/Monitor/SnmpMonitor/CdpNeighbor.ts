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
  /*
   * The address the neighbor advertises for itself (cdpCacheAddress, kept
   * only when cdpCacheAddressType says it is an IP). Optional because the
   * column is frequently empty and older payloads predate it entirely.
   *
   * Two things depend on it. It is a match key: a device we already manage
   * BY ADDRESS — imported from a subnet sweep, so its hostname is an IP and
   * its name is something else entirely — used to be drawn as a stranger
   * because nothing the neighbor advertised looked like its name. And it is
   * the one field that makes an unmanaged peer actionable: monitoring
   * anything needs an address, and without this the map knows a device's
   * make and model but not where it lives.
   */
  remoteIpAddress?: string | undefined;
}
