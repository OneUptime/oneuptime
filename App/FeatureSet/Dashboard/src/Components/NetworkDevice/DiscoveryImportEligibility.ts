import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";

/*
 * Pure, react-free import-eligibility rule for discovery scan results.
 *
 * Importing a discovered host creates an SNMP-credentialed NetworkDevice,
 * which is meaningless for hosts that answered ping but not SNMP — those
 * appear as endpoints via ARP/FDB discovery once their switch is monitored.
 * Kept out of the Discovery page component so it can be imported (and
 * unit-tested) in a plain Node/TypeScript environment, same as
 * DeviceStatusUtil.
 */

/**
 * True when the discovered host can be imported as a Network Device.
 *
 * Only an EXPLICIT snmpReachable === false blocks import: scans stored
 * before the field existed carry undefined, and every host on those scans
 * answered SNMP (ping-only sweeps did not exist yet), so legacy rows stay
 * importable.
 */
export function isImportableDiscoveredHost(
  host: DiscoveredNetworkDevice,
): boolean {
  return host.snmpReachable !== false;
}
