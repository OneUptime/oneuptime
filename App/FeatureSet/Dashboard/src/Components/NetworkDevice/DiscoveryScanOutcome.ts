import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { isPingOnlyDiscoveredHost } from "./DiscoveredHostFilter";
import ScanModeUtil from "Common/Utils/NetworkDiscovery/ScanModeUtil";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import { isDiscoveryScanInProgress } from "Common/Utils/NetworkDiscovery/DiscoveryScanStatus";

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
   * "12 of 254 hosts", or null when the scan has reported nothing at all and
   * there is nothing honest to show.
   */
  respondedHostSummary: string | null;
  /*
   * "Scanning - 1,024 of 15,360 addresses swept so far", for a scan that is
   * still running and has already reported some of its range.
   *
   * Null for every other scan, and this is the line that stops the summary
   * above being read as a verdict. A running sweep uploads what it has found
   * every 30 seconds, so `scannedHostCount` on an In Progress row is
   * "addresses covered so far" rather than the size of the target — without
   * saying so, a 15,360-address scan renders as "4 of 1024 hosts" and looks
   * like a finished sweep of a subnet that is not the one being scanned
   * (OneUptime issue #3598).
   *
   * The denominator is derived from the scan's own target rather than stored,
   * so it needs no column and cannot disagree with what the probe is
   * sweeping. Null when the target cannot be parsed — there is no total to
   * quote then, and a made-up one would be worse than none.
   */
  progressSummary: string | null;
  /*
   * True while the scan is mid-sweep. Callers use it to decide whether the
   * numbers beside it are a running total (the Review dialog says so, and the
   * dialog itself is reachable during a sweep precisely because the hosts are
   * real).
   */
  isInProgress: boolean;
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
  /*
   * True when this scan sent no SNMP at all (issue #3445). Its responders are
   * ping answers, so "alive without SNMP" is not a caveat about them — it is
   * the same set again, counted a second time.
   */
  isIcmpOnly: boolean;
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

/*
 * The "still scanning" line, or null when there is nothing useful to say.
 *
 * Needs three things at once, which is why it is a function rather than a
 * ternary at the call site: the scan has to be running, it has to have
 * reported at least once (a claimed scan that has not sent a thing yet gets
 * the unclaimed/claimed explanation instead), and its target has to be
 * parseable into a total worth quoting.
 */
function buildProgressSummary(
  scan: NetworkDeviceDiscoveryScan | null | undefined,
  hasReported: boolean,
  isInProgress: boolean,
): string | null {
  if (!isInProgress || !hasReported) {
    return null;
  }

  const sweptHostCount: number | undefined | null = scan?.scannedHostCount;

  if (typeof sweptHostCount !== "number") {
    return null;
  }

  const totalHostCount: number = ScanTargetUtil.countHosts(scan?.cidr || "");

  /*
   * A malformed (or unselected) target counts 0. Quoting "of 0" would be
   * nonsense, and so would quoting a total smaller than what has already been
   * swept — which is what a row written by a probe too old to send progress
   * looks like, since its scannedHostCount is the whole range.
   */
  if (totalHostCount <= 0 || totalHostCount <= sweptHostCount) {
    return null;
  }

  return (
    `Scanning - ${sweptHostCount.toLocaleString("en-US")} of ` +
    `${totalHostCount.toLocaleString("en-US")} addresses swept so far`
  );
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

  const isInProgress: boolean = isDiscoveryScanInProgress(scan);

  /*
   * Asked through ScanModeUtil so this page, the probe and the ingest endpoint
   * cannot disagree about what a scan was: a row with no method column — every
   * scan created before the column existed — is an SNMP scan, which it was.
   */
  const isIcmpOnly: boolean = ScanModeUtil.isIcmpOnly(scan);

  return {
    /*
     * "12 of 254 hosts answered ping" rather than "12 of 254 hosts" for an
     * ICMP-only sweep. The bare phrasing is read against the SNMP column title
     * it sits under, and on a scan that asked nothing about SNMP that invites
     * exactly the wrong conclusion about what the number means.
     */
    respondedHostSummary: hasReported
      ? isIcmpOnly
        ? `${respondedHostCount} of ${scan?.scannedHostCount ?? "?"} hosts answered ping`
        : `${respondedHostCount} of ${scan?.scannedHostCount ?? "?"} hosts`
      : null,
    progressSummary: buildProgressSummary(scan, hasReported, isInProgress),
    isInProgress: isInProgress,
    hasReported: hasReported,
    /*
     * Every host an ICMP-only sweep found is ping-only by construction, and
     * respondedHostCount already counts exactly those hosts — so the
     * "+N alive without SNMP" line beneath would repeat the headline back as
     * though it were a shortfall.
     */
    pingOnlyHostCount: isIcmpOnly ? 0 : countPingOnlyHosts(scan),
    // Empty string is "no explanation", not an explanation.
    explanation: scan?.statusMessage || null,
    isIcmpOnly: isIcmpOnly,
  };
}
