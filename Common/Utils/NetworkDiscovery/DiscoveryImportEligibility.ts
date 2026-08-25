import { DiscoveredNetworkDevice } from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceMonitoringMethod from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";

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
 * Lives in Common (it started life next to the Discovery page component)
 * because the dashboard's Review dialog and the server-side auto-import rule
 * engine both decide "how does this host import" through it, and the two must
 * never disagree: the group a host is shown under in the dialog and the
 * monitoring method a rule imports it with are the same decision.
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
  host: DiscoveredNetworkDevice | null | undefined,
): NetworkDeviceMonitoringMethod {
  /*
   * Nullish hosts read as SNMP rather than throwing. `discoveredDevices` is
   * jsonb written verbatim from the probe's payload and the only guard on it
   * (DiscoveryScanOutcome.getDiscoveredHosts) checks that the VALUE is an
   * array — never that its elements are objects. A single null element used
   * to take the whole page down from inside a table cell or a modal body,
   * where a thrown TypeError has nowhere useful to go. Every other kind of
   * junk element (a number, a string, {}) already read as SNMP; null is now
   * simply consistent with them.
   */
  return host?.snmpReachable === false
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
   * future "don't import X" rule for MANUAL review would belong. (The
   * automatic path already has one: an auto-import exclusion rule vetoes
   * hosts for the rule engine — deliberately without reaching into this
   * dialog, where a human is looking at the list and unticking a host is
   * the veto.)
   */
  return true;
}
