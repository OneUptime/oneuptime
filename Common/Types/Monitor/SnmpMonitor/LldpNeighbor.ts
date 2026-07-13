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
}
