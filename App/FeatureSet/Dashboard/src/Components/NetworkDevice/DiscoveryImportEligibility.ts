import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";

/*
 * Pure, react-free import rule for discovery scan results.
 *
 * Every host the sweep found alive is importable; what differs is HOW. A host
 * that answered SNMP becomes a polled device with the scan's credentials. A
 * host that answered only ping becomes a monitor-backed device: no probe, no
 * credentials, health supplied later by a monitor the operator binds to it.
 *
 * Ping-only hosts used to be refused outright, on the reasoning that they
 * would turn up as ARP/FDB endpoints once their switch was monitored. That is
 * true only where a monitored switch sees them, and an endpoint is not a
 * device — it cannot belong to a site, carry labels, own an owner rule, or be
 * one end of a link. Issue #3023 is what that gap looks like from the outside:
 * "devices I monitor manually don't appear in the topology at all".
 *
 * Kept out of the Discovery page component so it can be imported (and
 * unit-tested) in a plain Node/TypeScript environment, same as
 * DeviceStatusUtil.
 */

/**
 * Which monitoring method a discovered host should be imported under.
 *
 * Only an EXPLICIT snmpReachable === false means ping-only: scans stored
 * before the field existed carry undefined, and every host on those scans
 * answered SNMP (ping-only sweeps did not exist yet), so legacy rows keep
 * importing as SNMP devices.
 */
export function monitoringMethodForDiscoveredHost(
  host: DiscoveredNetworkDevice,
): NetworkDeviceMonitoringMethod {
  return host.snmpReachable === false
    ? NetworkDeviceMonitoringMethod.Monitor
    : NetworkDeviceMonitoringMethod.Snmp;
}

/** True when the discovered host can be imported as a Network Device. */
export function isImportableDiscoveredHost(
  _host: DiscoveredNetworkDevice,
): boolean {
  /*
   * Every alive host now is. The predicate survives because the Discovery
   * page filters and counts through it, and because it is the seam where a
   * future "don't import X" rule belongs.
   */
  return true;
}
