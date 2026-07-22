/*
 * One entry from a device's ARP / IP-to-media table (IP-MIB
 * ipNetToMediaTable). Captured by the probe alongside the interface walk
 * when endpoint collection is enabled; the server joins these against FDB
 * entries by MAC address to give discovered endpoints an IP address on the
 * topology graph.
 */
export default interface ArpEntry {
  ipAddress: string;
  macAddress: string;
  interfaceIndex: number;
  // ipNetToMediaType, decoded: e.g. "dynamic", "static", "invalid".
  entryType?: string | undefined;
}
