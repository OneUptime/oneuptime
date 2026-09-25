import { DiscoveredNetworkDevice } from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveredHostNetbiosStatus,
  DiscoveredHostReverseDnsStatus,
  readDiscoveredHostNetbiosStatus,
  readDiscoveredHostReverseDnsStatus,
} from "../../Types/NetworkDevice/DiscoveredHostNamingStatus";
import { DiscoveryScanStatus } from "./DiscoveryScanStatus";
import { normalizeNetbiosName } from "./NetbiosNameUtil";
import { normalizeReverseDnsName } from "./ReverseDnsNameUtil";
import { ScanModeUtil } from "./ScanModeUtil";

/*
 * Why a discovered host is listed by its address instead of a name — the
 * sentence the Review dialog shows beside it (OneUptime issue #3916).
 *
 * A host is named by the first of three sources that has something to say:
 * its SNMP sysName, its reverse-DNS (PTR) name, its NetBIOS name. When none
 * does, the row used to read as a bare IP with no hint of which source was
 * even asked. That is what the issue reported: eight of twelve kitchen
 * displays listed by address, an operator certain they had names, and no way
 * for anyone to tell "no PTR record" from "the probe's DNS server timed out"
 * from "SNMP and NetBIOS were never asked".
 *
 * So this walks the same three sources in the same order and says, for each,
 * what happened — from the per-host code the probe stamped when it has one
 * (DiscoveredHostNamingStatus.ts), and from what the scan itself was set to
 * do when it does not. A row from an older probe carries no codes, and for
 * those the reverse-DNS line says only that no name was recorded, which is
 * the most that row can honestly support.
 *
 * Pure and in Common, like UnclaimedScanDiagnosis, so every sentence is
 * unit-tested without rendering a dialog. The dialog calls it once per row.
 *
 * NOTHING THE SCANNED NETWORK CHOSE IS EVER PUT IN THE TEXT: no name, no
 * sysDescr, not even the address. Every sentence is fixed copy picked by a
 * code that went through a whitelist, so a hostile subnet cannot write into
 * the tooltip.
 */

/*
 * The part of a scan this reads. Structural, so the dialog can pass the row
 * it selected and a test can pass a literal.
 */
export interface DiscoveredHostNamingScan {
  // DiscoveryScanStatus. Decides whether names were looked up at all yet.
  status?: string | null | undefined;
  // Absent reads as SNMP on, exactly as ScanModeUtil says.
  isSnmpEnabled?: boolean | null | undefined;
  // On only when exactly true, matching the probe's own read of the column.
  isNetbiosLookupEnabled?: boolean | null | undefined;
}

export interface DiscoveredHostNamingExplanation {
  /*
   * A few words for beside the address — enough to say there is something
   * to read, never the explanation itself.
   */
  label: string;
  // The explanation: short sentences, one per naming source, then a tip.
  text: string;
}

export const UNNAMED_HOST_LABEL: string = "No name found";
export const NOT_YET_NAMED_HOST_LABEL: string = "Not named yet";

/*
 * Said for a scan still sweeping. Names are looked up only after the sweep
 * finishes (Probe/Jobs/Discovery/FetchScans.ts, scanWithDeadline), so every
 * host a running scan has reported so far is unnamed by construction — the
 * interesting question has not been asked yet.
 */
export const IN_PROGRESS_EXPLANATION: string =
  "Names are looked up after the sweep finishes, so hosts found so far are listed by address. Open Review Results again when the scan completes.";

/*
 * Said for a scan that failed. A sweep that misses its deadline or throws is
 * reported without ever reaching the naming passes, so its hosts are the ones
 * it had uploaded along the way — which carry no names by design.
 */
export const FAILED_SCAN_EXPLANATION: string =
  "This scan stopped before it looked up names, so its hosts are listed by address. Run it again to name them.";

/*
 * One sentence per code. None of them says how many times the probe asked:
 * a retry has to fit in the naming pass's time budget, so "even on a retry"
 * could be false for exactly the hosts a slow DNS server pushed past the
 * deadline. The tip that follows these codes says to rescan, which is the
 * part the operator can act on.
 */
const REVERSE_DNS_SENTENCES: Record<DiscoveredHostReverseDnsStatus, string> = {
  [DiscoveredHostReverseDnsStatus.NoRecord]:
    "Reverse DNS: the probe's DNS server has no PTR record for this address.",
  [DiscoveredHostReverseDnsStatus.UnusableName]:
    "Reverse DNS: a PTR record came back, but it is not a valid hostname, so it was not used.",
  [DiscoveredHostReverseDnsStatus.Timeout]:
    "Reverse DNS: the probe's DNS server did not answer in time.",
  [DiscoveredHostReverseDnsStatus.ServerFailure]:
    "Reverse DNS: the probe's DNS server answered with a server failure (SERVFAIL).",
  [DiscoveredHostReverseDnsStatus.Refused]:
    "Reverse DNS: the probe's DNS server refused the query.",
  [DiscoveredHostReverseDnsStatus.Unreachable]:
    "Reverse DNS: the probe could not reach its DNS server.",
  [DiscoveredHostReverseDnsStatus.Failed]:
    "Reverse DNS: the lookup failed on the probe.",
  [DiscoveredHostReverseDnsStatus.SkippedTimeBudget]:
    "Reverse DNS: not looked up. The scan ran out of time for name lookups before reaching this address.",
  [DiscoveredHostReverseDnsStatus.SkippedNoResolver]:
    "Reverse DNS: not looked up. No lookup from this probe was getting an answer, so it stopped asking.",
};

/*
 * A row with no reverse-DNS code: stored by a probe older than the codes, or
 * by one whose pass failed outright. Nothing on the row says which, or why,
 * so this claims neither.
 */
export const REVERSE_DNS_NOT_RECORDED_SENTENCE: string =
  "Reverse DNS: no name was recorded for this address.";

const NETBIOS_SENTENCES: Record<DiscoveredHostNetbiosStatus, string> = {
  [DiscoveredHostNetbiosStatus.NoReply]:
    "NetBIOS: no reply on UDP 137, which is usual for devices that are not Windows, or when a firewall blocks it.",
  [DiscoveredHostNetbiosStatus.NoUsableName]:
    "NetBIOS: the device replied, but reported no usable name.",
  [DiscoveredHostNetbiosStatus.SendFailed]:
    "NetBIOS: the query could not be sent from the probe.",
  [DiscoveredHostNetbiosStatus.Skipped]:
    "NetBIOS: not asked. The lookup stopped before reaching this address.",
  [DiscoveredHostNetbiosStatus.SkippedHostCap]:
    "NetBIOS: not asked. The scan reached the probe's NetBIOS host limit.",
  [DiscoveredHostNetbiosStatus.SkippedIneligibleAddress]:
    "NetBIOS: not asked. Only private addresses are asked.",
  [DiscoveredHostNetbiosStatus.SkippedGlobalProbe]:
    "NetBIOS: not asked. This scan ran on a global probe, and global probes never send NetBIOS queries.",
};

export const NETBIOS_OFF_SENTENCE: string = "NetBIOS: off for this scan.";

// NetBIOS was on, and yet the row carries no code: an older probe's row.
export const NETBIOS_NOT_RECORDED_SENTENCE: string =
  "NetBIOS: no name was recorded.";

export const SNMP_NOT_CHECKED_SENTENCE: string =
  "SNMP: not checked by this scan.";
export const SNMP_NO_ANSWER_SENTENCE: string =
  "SNMP: no answer with this scan's credentials.";
export const SNMP_NO_SYSNAME_SENTENCE: string =
  "SNMP: the device answered, but reported no name (sysName).";

/*
 * The one piece of advice that fits the reverse-DNS code best, when any
 * does. "No record" gets the one that matters most for the issue this came
 * from: the probe resolves through ITS OWN DNS server, which need not be the
 * one the operator checked with, so the comparison worth making is from the
 * probe's host.
 */
export const NO_RECORD_TIP: string =
  "The probe uses its own DNS server, which may not be the one you checked with. Run nslookup on this address from the probe's host to compare.";
export const TRANSIENT_FAILURE_TIP: string =
  "Rescan to try again. If it keeps happening, check the DNS servers the probe's host uses.";

/*
 * Offered when the scan left one or both of the ways of asking the DEVICE for
 * its name switched off. Those are exactly the names the issue asked to see
 * first — the one configured on the device — so saying where they come from
 * is the useful answer to "but it has a hostname". Only the sources that were
 * actually off, and would run if turned on, are named.
 */
export const ASK_THE_DEVICE_TIP: string =
  "Checking SNMP, or NetBIOS lookup for Windows hosts, asks the device for its own name.";
export const ASK_THE_DEVICE_SNMP_TIP: string =
  "Checking SNMP asks the device for its own name.";
export const ASK_THE_DEVICE_NETBIOS_TIP: string =
  "NetBIOS lookup asks Windows hosts for their own name.";

/*
 * The codes that get TRANSIENT_FAILURE_TIP: the lookup failed rather than
 * answered, so a rescan may name the host, and the DNS servers the probe's
 * host uses are where to look when it does not.
 *
 * SkippedNoResolver is one of them although its address was never looked up
 * (#3916). The probe stopped asking only because every lookup before it had
 * failed in these same ways, so the advice is the same. Without it, the hosts
 * a pass gave up on were the only failed lookups with nothing to check.
 */
const TRANSIENT_REVERSE_DNS_STATUSES: ReadonlySet<DiscoveredHostReverseDnsStatus> =
  new Set<DiscoveredHostReverseDnsStatus>([
    DiscoveredHostReverseDnsStatus.Timeout,
    DiscoveredHostReverseDnsStatus.ServerFailure,
    DiscoveredHostReverseDnsStatus.Refused,
    DiscoveredHostReverseDnsStatus.Unreachable,
    DiscoveredHostReverseDnsStatus.Failed,
    DiscoveredHostReverseDnsStatus.SkippedNoResolver,
  ]);

// A string with something in it besides whitespace.
function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * True when the row would be named by something other than its address: a
 * sysName, a usable PTR name or a usable NetBIOS name. Mirrors
 * getDiscoveredHostFullName's order and its re-normalisation, so the hint is
 * shown on exactly the rows whose name line is the address.
 */
export function isDiscoveredHostNamed(host: DiscoveredNetworkDevice): boolean {
  return (
    hasText(host.sysName) ||
    Boolean(normalizeReverseDnsName(host.dnsHostname)) ||
    Boolean(normalizeNetbiosName(host.netbiosName))
  );
}

function describeSnmp(data: {
  host: DiscoveredNetworkDevice;
  scan: DiscoveredHostNamingScan | null | undefined;
}): string | undefined {
  if (data.scan && !ScanModeUtil.isSnmpEnabled(data.scan)) {
    return SNMP_NOT_CHECKED_SENTENCE;
  }

  if (data.host.snmpReachable === false) {
    return SNMP_NO_ANSWER_SENTENCE;
  }

  /*
   * Answered SNMP — or a row from before `snmpReachable` existed, when every
   * host listed had answered it. Either way the host is unnamed, so whatever
   * it said had no sysName in it.
   */
  if (data.scan || data.host.snmpReachable === true) {
    return SNMP_NO_SYSNAME_SENTENCE;
  }

  return undefined;
}

function describeNetbios(data: {
  status: DiscoveredHostNetbiosStatus | undefined;
  scan: DiscoveredHostNamingScan | null | undefined;
  isGlobalProbe: boolean;
}): string | undefined {
  if (data.status) {
    return NETBIOS_SENTENCES[data.status];
  }

  // Without the scan there is no telling whether NetBIOS was ever on.
  if (!data.scan) {
    return undefined;
  }

  if (data.scan.isNetbiosLookupEnabled !== true) {
    return NETBIOS_OFF_SENTENCE;
  }

  /*
   * On, but no code: a row from a probe older than the codes. If the scan's
   * probe is a global one, the lookup was skipped whatever that probe's
   * version — the global-probe refusal predates the codes.
   */
  if (data.isGlobalProbe) {
    return NETBIOS_SENTENCES[DiscoveredHostNetbiosStatus.SkippedGlobalProbe];
  }

  return NETBIOS_NOT_RECORDED_SENTENCE;
}

/**
 * Why this discovered host has no name, or undefined when it has one (or has
 * no address, which its row already explains).
 *
 * `isGlobalProbe` is whether the scan's probe is a global one, when the
 * caller knows. It matters only for rows that carry no NetBIOS code, and for
 * whether a scan with NetBIOS off is advised to turn it on.
 */
export function explainUnnamedDiscoveredHost(data: {
  host: DiscoveredNetworkDevice | null | undefined;
  scan?: DiscoveredHostNamingScan | null | undefined;
  isGlobalProbe?: boolean | undefined;
}): DiscoveredHostNamingExplanation | undefined {
  const host: DiscoveredNetworkDevice | null | undefined = data.host;

  if (!host || typeof host !== "object") {
    return undefined;
  }

  /*
   * A row with no address cannot be imported, and says so on its checkbox.
   * Nullish is checked before stringifying: String(null) is "null", which
   * would read as an address.
   */
  if (
    host.ipAddress === undefined ||
    host.ipAddress === null ||
    !hasText(String(host.ipAddress))
  ) {
    return undefined;
  }

  if (isDiscoveredHostNamed(host)) {
    return undefined;
  }

  const dnsHostnameStatus: DiscoveredHostReverseDnsStatus | undefined =
    readDiscoveredHostReverseDnsStatus(host.dnsHostnameStatus);
  const netbiosNameStatus: DiscoveredHostNetbiosStatus | undefined =
    readDiscoveredHostNetbiosStatus(host.netbiosNameStatus);

  /*
   * A per-host code means the naming passes ran for this row, whatever the
   * scan is doing now — a recurring scan keeps its previous run's results
   * while the next run starts. Only a row with no code at all is explained by
   * the scan's state.
   */
  if (!dnsHostnameStatus && !netbiosNameStatus) {
    if (data.scan?.status === DiscoveryScanStatus.InProgress) {
      return {
        label: NOT_YET_NAMED_HOST_LABEL,
        text: IN_PROGRESS_EXPLANATION,
      };
    }

    if (data.scan?.status === DiscoveryScanStatus.Failed) {
      return { label: UNNAMED_HOST_LABEL, text: FAILED_SCAN_EXPLANATION };
    }
  }

  const netbiosSentence: string | undefined = describeNetbios({
    status: netbiosNameStatus,
    scan: data.scan,
    isGlobalProbe: data.isGlobalProbe === true,
  });

  const sentences: Array<string> = [];

  // The naming order, so the sentences read in the order the sources win.
  const snmpSentence: string | undefined = describeSnmp({
    host: host,
    scan: data.scan,
  });

  if (snmpSentence) {
    sentences.push(snmpSentence);
  }

  sentences.push(
    dnsHostnameStatus
      ? REVERSE_DNS_SENTENCES[dnsHostnameStatus]
      : REVERSE_DNS_NOT_RECORDED_SENTENCE,
  );

  if (netbiosSentence) {
    sentences.push(netbiosSentence);
  }

  if (dnsHostnameStatus === DiscoveredHostReverseDnsStatus.NoRecord) {
    sentences.push(NO_RECORD_TIP);
  } else if (
    dnsHostnameStatus &&
    TRANSIENT_REVERSE_DNS_STATUSES.has(dnsHostnameStatus)
  ) {
    sentences.push(TRANSIENT_FAILURE_TIP);
  }

  const isSnmpOff: boolean = snmpSentence === SNMP_NOT_CHECKED_SENTENCE;

  /*
   * NetBIOS is suggested only where turning it on could work. A global probe
   * never sends NetBIOS queries whatever the scan asks for, so on one this
   * advice would send the operator to a setting whose only effect is the
   * "not asked" line on the next scan (#3916). The bundled self-hosted probes
   * are global, so that is not a rare case.
   */
  const shouldSuggestNetbios: boolean =
    netbiosSentence === NETBIOS_OFF_SENTENCE && data.isGlobalProbe !== true;

  if (isSnmpOff && shouldSuggestNetbios) {
    sentences.push(ASK_THE_DEVICE_TIP);
  } else if (isSnmpOff) {
    sentences.push(ASK_THE_DEVICE_SNMP_TIP);
  } else if (shouldSuggestNetbios) {
    sentences.push(ASK_THE_DEVICE_NETBIOS_TIP);
  }

  return { label: UNNAMED_HOST_LABEL, text: sentences.join(" ") };
}

export default explainUnnamedDiscoveredHost;
