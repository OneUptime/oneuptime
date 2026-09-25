/*
 * Why a discovered host was left without a name, as the probe saw it
 * (OneUptime issue #3916).
 *
 * The report behind this: an ICMP-only scan of twelve kitchen displays named
 * four of them by reverse DNS and listed the other eight by address, and
 * nothing anywhere said why. The status message was silent, the probe logged
 * at debug level, and the Review dialog showed a bare IP. "The device has no
 * PTR record", "the probe's DNS server timed out", "the server answered
 * SERVFAIL" and "NetBIOS was never asked" all looked exactly the same — so an
 * operator who KNEW the devices had names could only conclude the product was
 * broken, and nobody could tell them which of those it was.
 *
 * These codes are that missing sentence, one per naming source. The probe
 * stamps them on a host only when the source in question left that host
 * unnamed, the server stores them verbatim in the `discoveredDevices` jsonb,
 * and the Review dialog turns them into a tooltip beside the address
 * (DiscoveredHostNamingDiagnosis.ts).
 *
 * Short kebab-case strings rather than sentences or raw error text: a scan
 * can hold tens of thousands of hosts, and the copy belongs to the dashboard,
 * where it can change without a probe release.
 *
 * UNTRUSTED ON THE WAY OUT. Like every other field in that column the value
 * is whatever the probe's payload said, so every reader goes through the
 * read* functions below, which answer undefined for anything that is not one
 * of these exact strings. A value the dashboard does not recognise — a newer
 * probe's code, or junk — then reads as "no code", which every reader already
 * handles, rather than as a code it would have to guess the meaning of.
 */

/*
 * What the reverse-DNS (PTR) lookup for an address came back with, when it
 * did not come back with a usable name.
 */
export enum DiscoveredHostReverseDnsStatus {
  /*
   * The DNS server ANSWERED, and the answer was that this address has no PTR
   * record — NXDOMAIN, or the reverse name exists with no PTR data. The one
   * code here that is a fact about the address rather than about the lookup,
   * and the only one a retry cannot change.
   */
  NoRecord = "no-record",
  /*
   * A PTR record came back, but no answer in it was usable as a hostname
   * (ReverseDnsNameUtil refused every one — an in-addr.arpa echo, a name
   * with a space in it, a name that merely restates the address).
   */
  UnusableName = "unusable-name",
  /*
   * No answer in time. The probe retries a lookup that fails this way, but
   * only while the pass's time budget lasts, so a host can carry this code
   * after one try. The copy that explains it must not claim a retry.
   */
  Timeout = "timeout",
  // The DNS server answered SERVFAIL. Retried like Timeout, on the same terms.
  ServerFailure = "server-failure",
  // The DNS server answered REFUSED.
  Refused = "refused",
  // Nothing was listening where the probe's DNS server should be.
  Unreachable = "unreachable",
  // Any other failure of the lookup itself.
  Failed = "failed",
  /*
   * Never looked up: the naming pass ran out of its wall-clock budget
   * before reaching this address. The scan's status message says so too.
   */
  SkippedTimeBudget = "skipped-time-budget",
  /*
   * Never looked up: every lookup the probe had made so far failed without
   * a single answer, so it judged DNS unusable from where it sits and
   * stopped asking. The scan's status message says so too.
   */
  SkippedNoResolver = "skipped-no-resolver",
}

/*
 * What the NetBIOS node status (NBSTAT) lookup for an address came to, when
 * it did not produce a usable name. Only ever stamped on a scan that asked for
 * NetBIOS names: a scan that did not is described by its own
 * `isNetbiosLookupEnabled` column, and repeating that on every host would be
 * thousands of copies of one scan-wide fact.
 */
export enum DiscoveredHostNetbiosStatus {
  /*
   * Queried on UDP 137 (and retried, unless the lookup was cut short first),
   * and never answered.
   */
  NoReply = "no-reply",
  // Answered, but reported no name the naming rules accept.
  NoUsableName = "no-usable-name",
  // The query could not be sent from the probe.
  SendFailed = "send-failed",
  /*
   * Never queried: the lookup stopped first — its time budget ran out or its
   * socket failed. The scan's status message says which.
   */
  Skipped = "skipped",
  // Never queried: the lookup reached the probe's NetBIOS host limit first.
  SkippedHostCap = "skipped-host-cap",
  /*
   * Never queried: NetBIOS is only ever sent to private and CGNAT IPv4
   * addresses, whoever asks. The dashboard's copy of that rule,
   * isNetbiosQueryableIPv4Address (NetbiosNameUtil.ts), keeps the Review
   * dialog from suggesting NetBIOS for such an address, and gives an older
   * probe's row this code's sentence (#3916).
   */
  SkippedIneligibleAddress = "skipped-ineligible-address",
  /*
   * Never queried: the scan ran on a global probe, which never sends NetBIOS
   * queries whatever the scan asks for.
   */
  SkippedGlobalProbe = "skipped-global-probe",
}

const REVERSE_DNS_STATUSES: ReadonlySet<string> = new Set<string>(
  Object.values(DiscoveredHostReverseDnsStatus),
);

const NETBIOS_STATUSES: ReadonlySet<string> = new Set<string>(
  Object.values(DiscoveredHostNetbiosStatus),
);

/**
 * The reverse-DNS status a stored value stands for, or undefined when it is
 * not exactly one of the codes above. Accepts `unknown` because its input is
 * read out of jsonb, where the declared type is a hope rather than a fact.
 */
export function readDiscoveredHostReverseDnsStatus(
  value: unknown,
): DiscoveredHostReverseDnsStatus | undefined {
  return typeof value === "string" && REVERSE_DNS_STATUSES.has(value)
    ? (value as DiscoveredHostReverseDnsStatus)
    : undefined;
}

/**
 * The NetBIOS status a stored value stands for, or undefined when it is not
 * exactly one of the codes above. Same contract as the reverse-DNS reader.
 */
export function readDiscoveredHostNetbiosStatus(
  value: unknown,
): DiscoveredHostNetbiosStatus | undefined {
  return typeof value === "string" && NETBIOS_STATUSES.has(value)
    ? (value as DiscoveredHostNetbiosStatus)
    : undefined;
}
