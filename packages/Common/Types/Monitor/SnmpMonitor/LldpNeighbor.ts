/*
 * One neighbor entry from a device's LLDP remote table (LLDP-MIB
 * lldpRemTable). Captured by the probe alongside the interface walk; the
 * server matches remoteSysName / remoteChassisId against known
 * NetworkDevices to build the topology graph.
 */
export default interface LldpNeighbor {
  localInterfaceIndex?: number | undefined;
  remoteChassisId?: string | undefined;
  remotePortId?: string | undefined;
  remoteSysName?: string | undefined;
  /*
   * The neighbor's management address, joined in from lldpRemManAddrTable
   * (a separate table whose index carries the address). Optional: plenty of
   * agents do not implement it, an IPv6-only entry is skipped, and older
   * payloads predate the column.
   *
   * See CdpNeighbor.remoteIpAddress for why it is worth the extra walk — it
   * matches devices we manage by address, and it is what turns an unmanaged
   * peer on the map into something that can actually be monitored.
   */
  remoteIpAddress?: string | undefined;
}
