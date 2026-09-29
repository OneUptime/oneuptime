import { DiscoveredNetworkDevice } from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceMonitoringMethod from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";

/*
 * Pure, react-free import rule for discovery scan results.
 *
 * Every host the sweep found alive is importable, and every one of them
 * imports as a probe-polled device: the scan's probe pings it on its schedule,
 * and walks it over SNMP as well when it has credentials. What differs between
 * a host that answered SNMP and one that only answered ping is therefore not
 * HOW it is monitored but WHAT rides along — the SNMP host carries the scan's
 * credential set that answered it, the ping-only host carries none and is
 * simply pinged until somebody adds credentials.
 *
 * That is a change from the SNMP-first era, when a ping-only host had to
 * import as a monitor-backed device with no probe and polling off, and read
 * "Pending" until an operator hand-bound a Ping monitor to it (issue #3447).
 * Reachability is a built-in capability of every probe-polled device now, so
 * the ping-only host gets a status from its first poll like any other.
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
 * device a rule imports it as are the same decision.
 */

/**
 * True when the host answered ping but not SNMP — the "No SNMP" group in the
 * Review dialog, and the host that imports with no credentials.
 *
 * Only an EXPLICIT snmpReachable === false is ping-only: scans stored before
 * the field existed carry undefined, and every host on those scans answered
 * SNMP (ping-only sweeps did not exist yet), so legacy rows keep importing
 * with the scan's credentials.
 *
 * Nullish hosts read as NOT ping-only rather than throwing. `discoveredDevices`
 * is jsonb written verbatim from the probe's payload and the only guard on it
 * (DiscoveryScanOutcome.getDiscoveredHosts) checks that the VALUE is an array
 * — never that its elements are objects. A single null element used to take
 * the whole page down from inside a table cell or a modal body, where a thrown
 * TypeError has nowhere useful to go. Every other kind of junk element (a
 * number, a string, {}) already read as an SNMP host; null is simply
 * consistent with them.
 */
export function isPingOnlyDiscoveredHost(
  host: DiscoveredNetworkDevice | null | undefined,
): boolean {
  return host?.snmpReachable === false;
}

/**
 * Which monitoring method a discovered host should be imported under.
 *
 * Probe, for every host. Under ping-first polling there is no discovered host
 * a probe cannot monitor: the scan's probe just proved the host answers ping,
 * and that is all a probe-polled device needs to have a status. SNMP is an
 * enrichment layered on top when the host answered it, and
 * `buildNetworkDeviceFromDiscoveredHost` decides that by
 * `isPingOnlyDiscoveredHost`, not by this function.
 *
 * `Monitor` — a bound monitor's status IS the device's status — is an override
 * an operator chooses on a device's Settings page for gear a probe cannot
 * reach at all. Discovery never has grounds to choose it: every host it offers
 * was reached by the probe that found it.
 *
 * Kept as a function, with the host as its argument, because it is the one
 * seam through which the dialog and the rule engine ask the question, and a
 * future rule that DID need to look at the host would land here.
 */
export function monitoringMethodForDiscoveredHost(
  _host: DiscoveredNetworkDevice | null | undefined,
): NetworkDeviceMonitoringMethod {
  return NetworkDeviceMonitoringMethod.Probe;
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
