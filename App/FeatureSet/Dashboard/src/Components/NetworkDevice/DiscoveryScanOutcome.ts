import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { isPingOnlyDiscoveredHost } from "./DiscoveredHostFilter";

/*
 * Pure, react-free reading of "what did this discovery scan actually find".
 *
 * The Discovery page used to render one number, respondedHostCount, as
 * "N of M hosts". That number counts SNMP responders ONLY, so a sweep of a
 * live subnet where nothing answered SNMP rendered as "0 of 254 hosts" —
 * visually identical to a sweep of empty address space, and identical again
 * to a subnet the probe cannot route to. Operators had no way to tell the
 * three apart, and the probe's own explanation of the sweep (statusMessage)
 * was fetched by the page and then never rendered at all.
 *
 * The rules for turning a scan row into something an operator can act on live
 * here rather than inside the component so they can be imported (and
 * unit-tested) in a plain Node/TypeScript environment, same as
 * DiscoveryImportEligibility and DeviceStatusUtil.
 */

export interface DiscoveryScanOutcome {
  /*
   * "12 of 254 hosts", or null when the scan has not reported yet (Pending /
   * In Progress) and there is nothing honest to show.
   */
  respondedHostSummary: string | null;
  /*
   * True when the scan has reported host counts. The explanation below is
   * worth showing WITHOUT them — a scan that never ran has no counts and is
   * exactly the case that needs explaining — so the two have to be asked
   * about separately rather than the caller inferring one from the other.
   */
  hasReported: boolean;
  /*
   * Hosts the sweep found alive that did not answer SNMP. Shown alongside the
   * responder count so a zero is never mistaken for an empty network.
   */
  pingOnlyHostCount: number;
  /*
   * The probe's account of the sweep — which cases it hit (ICMP filtered,
   * credentials rejected, nothing reachable at all) and what to check. Null
   * when the probe sent none, e.g. rows written by an older probe.
   */
  explanation: string | null;
}

/*
 * The scan's discovered hosts, defensively. The column is jsonb written from
 * the probe's payload, so a row from a future/older probe (or a hand-edited
 * one) can hold anything; treat a non-array as no results rather than letting
 * the page throw while rendering a table cell.
 */
export function getDiscoveredHosts(
  scan: NetworkDeviceDiscoveryScan | null | undefined,
): Array<DiscoveredNetworkDevice> {
  const raw: unknown = scan?.discoveredDevices;

  if (!raw || !Array.isArray(raw)) {
    return [];
  }

  return raw as Array<DiscoveredNetworkDevice>;
}

/**
 * Hosts that answered ICMP but not SNMP.
 *
 * Only an EXPLICIT snmpReachable === false counts: scans stored before the
 * field existed carry undefined and every host on them answered SNMP, so
 * legacy rows must not be retroactively reported as ping-only.
 *
 * Asked through `isPingOnlyDiscoveredHost` rather than by reading
 * `snmpReachable` here as well, because this number and the dialog's
 * "No SNMP (N)" badge describe the same set of hosts on two screens the
 * operator moves between in one click — the scans table says "+N alive
 * without SNMP", they press Review Results, and the badge had better say N.
 * Two copies of the rule is how those two numbers come to disagree.
 *
 * It also stops a junk jsonb element taking the table down: the predicate is
 * nullish-safe, where the bare `host.snmpReachable` this replaced threw a
 * TypeError from inside a table cell.
 */
export function countPingOnlyHosts(
  scan: NetworkDeviceDiscoveryScan | null | undefined,
): number {
  return getDiscoveredHosts(scan).filter((host: DiscoveredNetworkDevice) => {
    return isPingOnlyDiscoveredHost(host);
  }).length;
}

/**
 * Everything the scans list needs to render one row's result cell.
 *
 * A scan that has not reported yet gets a null summary rather than "0 of ?
 * hosts": zero responders is a finding, and claiming it before the probe has
 * answered is the same false negative in a different place.
 */
export function summarizeDiscoveryScan(
  scan: NetworkDeviceDiscoveryScan | null | undefined,
): DiscoveryScanOutcome {
  const respondedHostCount: number | undefined | null =
    scan?.respondedHostCount;

  const hasReported: boolean =
    respondedHostCount !== undefined && respondedHostCount !== null;

  return {
    respondedHostSummary: hasReported
      ? `${respondedHostCount} of ${scan?.scannedHostCount ?? "?"} hosts`
      : null,
    hasReported: hasReported,
    pingOnlyHostCount: countPingOnlyHosts(scan),
    // Empty string is "no explanation", not an explanation.
    explanation: scan?.statusMessage || null,
  };
}
