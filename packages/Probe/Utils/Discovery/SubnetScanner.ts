import SnmpMonitor from "../Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpSystemInfo from "Common/Types/Monitor/SnmpMonitor/SnmpSystemInfo";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import ReverseDnsResolver, { ReverseDnsResolution } from "./ReverseDnsResolver";
import NetbiosNameResolver, {
  NetbiosNameResolution,
} from "./NetbiosNameResolver";
import { normalizeNetbiosName } from "Common/Utils/NetworkDiscovery/NetbiosNameUtil";
import {
  DiscoveredHostNetbiosStatus,
  DiscoveredHostReverseDnsStatus,
  readDiscoveredHostNetbiosStatus,
  readDiscoveredHostReverseDnsStatus,
} from "Common/Types/NetworkDevice/DiscoveredHostNamingStatus";
import logger from "Common/Server/Utils/Logger";
import DiscoveryPing from "./DiscoveryPing";

export interface DiscoveredHost {
  ipAddress: string;
  sysName?: string | undefined;
  sysDescr?: string | undefined;
  /*
   * The host's reverse-DNS (PTR) name, when it has one (OneUptime issue
   * #3529).
   *
   * Resolved after the sweep, for the discovered addresses only, and always
   * best-effort: absent means the address has no PTR record, the answer was
   * not usable as a name (ReverseDnsNameUtil decides), or this probe has no
   * working resolver. Absent on every result stored before this field existed
   * and by every older probe, which is why nothing downstream may require it.
   *
   * It NAMES the host; it does not address it. The device a discovered host
   * imports as still carries the IP in `hostname`, because that is the
   * registered-host dedup key and because a name that stops resolving must
   * not stop a device being polled.
   */
  dnsHostname?: string | undefined;
  /*
   * The host's NetBIOS name, lower-cased, when the scan asked for one and the
   * host answered (OneUptime issue #3677).
   *
   * Only ever looked up for hosts left with neither a sysName nor a
   * dnsHostname, only on scans that opted in, only for private addresses, and
   * never by a global probe — see attachNetbiosNames. SELF-REPORTED by the host
   * and already normalised by NetbiosNameUtil.normalizeNetbiosName, which every
   * reader applies again.
   *
   * The key is ABSENT, not undefined, whenever no name was found, so every
   * host literal written before this field existed still describes the same
   * object.
   */
  netbiosName?: string | undefined;
  /*
   * Why reverse DNS left this host unnamed (OneUptime issue #3916): no PTR
   * record, a lookup that failed (on its retry too, when the pass reached
   * it), a lookup the pass never reached. Stamped by attachReverseDnsHostnames ONLY on hosts it leaves with
   * neither a sysName nor a dnsHostname, and only with a code the resolver
   * reported. ABSENT, not undefined, everywhere else, for the reason
   * netbiosName is.
   */
  dnsHostnameStatus?: DiscoveredHostReverseDnsStatus | undefined;
  /*
   * Why NetBIOS left this host unnamed (issue #3916): no reply, no usable
   * name, or never queried and why. Stamped only on scans that asked for
   * NetBIOS names, only on hosts that lookup was responsible for and did not
   * name. ABSENT everywhere else.
   */
  netbiosNameStatus?: DiscoveredHostNetbiosStatus | undefined;
  /*
   * The rest of the SNMP system group. probeSystemInfo reads all six
   * scalars in the same single GET that fetches sysName/sysDescr, so
   * carrying them costs zero extra network traffic — and sysObjectId is
   * the vendor's registered enterprise OID, the canonical fingerprint
   * vendor-based auto-import conditions and OID-template suggestions key
   * on. All optional: ping-only hosts have none, and older scan rows
   * stored before these fields existed never carry them.
   */
  sysObjectId?: string | undefined;
  sysLocation?: string | undefined;
  sysContact?: string | undefined;
  sysUpTimeSeconds?: number | undefined;
  /*
   * True when the host answered SNMP (sysName/sysDescr then come from its
   * system group). False for hosts that answered the ICMP pre-sweep but not
   * SNMP — recorded rather than discarded so unmanaged gear (printers,
   * cameras, POS terminals) still surfaces in discovery results.
   */
  snmpReachable: boolean;
  /*
   * The id of the SNMP config that answered this host, when one did. Absent
   * for ping-only hosts and for every host of an ICMP-only sweep, which no
   * config found.
   *
   * A scan can carry several credential sets, so this is what lets the import
   * path build the device with the credentials that ACTUALLY work for it
   * rather than with the scan's first set — see
   * SnmpScanConfigUtil.resolveForHost. It travels to the server on the result
   * payload and is stored on the discovered-host record.
   */
  snmpConfigId?: string | undefined;
}

/*
 * One credential set the sweep tries, already parsed into the shape the SNMP
 * layer wants.
 *
 * Parsed by the CALLER (FetchScans.buildProbeSnmpConfigs) rather than here,
 * because a credential that cannot be parsed has to fail the whole scan with a
 * sentence the operator can read — not once per host inside the sweep's
 * per-host error handling, where it would report as a subnet that answered
 * nothing.
 */
export interface SubnetScanSnmpConfig {
  /*
   * Stamped onto every host this config finds, so the import path can look
   * the credentials back up. Opaque to the scanner.
   */
  id: string;
  /*
   * Short, NON-SECRET description used only in log lines and in the scan's
   * status message. Never contains a community string or a key — see
   * SnmpScanConfigUtil.getConfigLabel, which builds it.
   */
  label: string;
  snmpVersion: SnmpVersion;
  communityString: string;
  snmpV3Auth?: SnmpV3Auth | undefined;
  port: number;
}

/*
 * What the sweep has found SO FAR, handed to SubnetScanConfig.onProgress at
 * the end of every segment (OneUptime issues #3598 and #3599).
 *
 * A sweep used to be one atomic unit of work: nothing at all was known about
 * it until it finished, so a 15,360-address range reported "0 of 15360" for
 * however long it ran, an abandoned sweep threw away every host it had
 * already confirmed, and auto-import — which only looks at Completed scans —
 * could not touch a single one of the hundreds of devices sitting in the
 * probe's memory. This is the shape that makes those results leave the probe
 * while the sweep is still going.
 */
export interface SubnetScanProgress {
  /*
   * Addresses the sweep has finished with. Counts each address ONCE as its
   * first-pass checks finish; the ICMP-filtered fallback re-probes addresses
   * already counted here and so does not move this number, which is why it can sit at
   * `totalHostCount` while the sweep is still working.
   */
  sweptHostCount: number;
  /*
   * ICMP/SNMP counts describe the current segment; fallback counts cover
   * every skipped address. Optional for callers running an older probe.
   */
  phase?: "icmp" | "snmp" | "snmp-fallback" | undefined;
  phaseCompletedHostCount?: number | undefined;
  phaseTotalHostCount?: number | undefined;
  // Every address the target expands to. Constant for the whole sweep.
  totalHostCount: number;
  /*
   * Everything found so far, address-ascending — a COPY, so a consumer that
   * holds on to it (an upload in flight, say) cannot see the live array grow
   * underneath it or mutate what the sweep is still counting.
   *
   * Carries no `dnsHostname`: reverse DNS runs once, after the sweep has won
   * its deadline race (see attachReverseDnsHostnames), so partial results are
   * named by address and the final upload is what names them.
   */
  discoveredHosts: Array<DiscoveredHost>;
  // Hosts that answered SNMP so far. Always 0 on an ICMP-only sweep.
  snmpResponderCount: number;
  /*
   * Hosts that answered the ICMP pre-sweep so far, or undefined once the
   * pre-sweep has broken — the same rule as SubnetScanResult's field, for the
   * same reason: a partial count must never be reported as a real one.
   */
  respondedToPingCount?: number | undefined;
  // True when this sweep asks no host for SNMP. See SubnetScanResult.
  isIcmpOnlySweep: boolean;
}

export interface SubnetScanConfig {
  /*
   * The address space to sweep, in either notation ScanTargetUtil accepts:
   * CIDR ("192.168.1.0/24") or octet range ("10.16-22.0-255.51-66"). Named
   * `cidr` to match the NetworkDeviceDiscoveryScan column it is read from.
   */
  cidr: string;
  // Aborting a scan stops new work and closes its active network requests.
  signal?: AbortSignal | undefined;
  /*
   * Snapshots after every segment and each second during active work. The
   * callback must handle its own upload serialization. Neither slow callbacks
   * nor failures block the sweep.
   */
  onProgress?:
    | ((progress: SubnetScanProgress) => Promise<void> | void)
    | undefined;
  /*
   * Fixed worker count for both passes, overriding the size-derived value
   * getSweepConcurrency picks. Unset (or 0) means "work it out", which is
   * what every caller but a test and a deliberately-tuned probe should do.
   */
  maxConcurrency?: number | undefined;
  /*
   * Whether to ask each live host for its SNMP system group, or stop at the
   * ping that found it (OneUptime issue #3445). Read off the scan row through
   * ScanModeUtil, so an ABSENT column reads as "yes" — the sweep this probe ran
   * before the column existed.
   *
   * Undefined here means the same thing, for callers that build a config by
   * hand: only an explicit false turns SNMP off.
   */
  isSnmpEnabled?: boolean | undefined;
  /*
   * The credential sets to try against each host, in the operator's declared
   * order, stopping at the first that answers (OneUptime issue #3458).
   *
   * Never empty for an SNMP scan — SnmpScanConfigUtil.resolve() synthesizes one
   * from a legacy scan's flattened columns — and scan() refuses an empty list
   * rather than sweeping a subnet with nothing to ask it. An ICMP-ONLY scan is
   * the one case where empty is correct and expected: it asks no host for SNMP
   * at all, so it carries no credentials.
   */
  snmpConfigs?: Array<SubnetScanSnmpConfig> | undefined;
  /*
   * Whether to ask still-unnamed hosts for their NetBIOS name after the sweep
   * (OneUptime issue #3677). Read off the scan row as `=== true`, so an
   * ABSENT column — a server too old to select it — means off.
   *
   * NOT read by scan(). Like reverse DNS, the lookup runs in
   * FetchScans.scanWithDeadline after the sweep has won its deadline race, and
   * that is also where the global-probe guard lives. It rides on this config
   * only because this is the object runScan hands scanWithDeadline.
   */
  isNetbiosLookupEnabled?: boolean | undefined;
}

/*
 * What the reverse-DNS pass achieved, and — the reason this exists — whether
 * it was cut short.
 *
 * The pass asks addresses in ascending order and stops when its wall-clock
 * budget runs out or the resolver proves unusable, so on a large sweep behind
 * a slow resolver the TAIL of the range keeps IP-address names. Before this
 * was carried out of attachReverseDnsHostnames, the only trace of that was a
 * warning in the probe log: the scan's status message said nothing, and a
 * Review dialog full of bare addresses from 10.0.4.0 upwards looked exactly
 * like a network that publishes no PTR records.
 *
 * Address counts are over DISTINCT addresses — what the resolver actually
 * asks — while `resolvedCount` counts host ENTRIES stamped, which is what
 * SubnetScanResult.reverseDnsResolvedCount has always held. The two differ
 * only for a host list that repeats an address.
 */
export interface ReverseDnsNamingOutcome {
  // Host entries that got a dnsHostname.
  resolvedCount: number;
  // Distinct addresses handed to the pass.
  addressCount: number;
  // Distinct addresses that got a name.
  namedAddressCount: number;
  /*
   * Distinct addresses never looked up because the pass stopped first.
   * Undefined when the resolver did not say — a test double, say — which is
   * a different statement from zero.
   */
  notLookedUpAddressCount?: number | undefined;
  // The wall-clock budget ran out with addresses still unasked.
  isTimeBudgetExhausted: boolean;
  /*
   * False when not one lookup got an answer and the rest were skipped: this
   * probe cannot resolve at all. See ReverseDnsResolution.
   */
  isReverseDnsAvailable: boolean;
  // The budget the pass ran under, when the resolver reported it.
  totalBudgetInMs?: number | undefined;
  /*
   * The resolver's first infrastructure failure (ESERVFAIL, ECONNREFUSED, a
   * timeout), trimmed. Only meaningful beside isReverseDnsAvailable false:
   * that verdict means the first waves of lookups all failed, which a broken
   * probe resolver and a reverse zone delegated to a dead nameserver both
   * produce, and this reason is what tells the operator which one it is.
   */
  failureReason?: string | undefined;
  /*
   * Distinct addresses whose lookup FAILED — timed out, SERVFAIL, REFUSED,
   * no server listening — on the first try and on the retry, or on the first
   * try alone when the pass ran out of time before retrying it (OneUptime
   * issue #3916). Not "addresses without a name": an address with no PTR
   * record was ANSWERED, and is not counted here.
   *
   * This is the number the status message was missing. The customer's
   * twelve-host ICMP-only scan named four hosts and said nothing at all,
   * because the only failure the note reported was a resolver judged unusable
   * — which takes 64 failures in a row and zero answers, so a small scan whose
   * lookups partly timed out could never reach it. A pass that answered for
   * some hosts and not for others read exactly like a network with no PTR
   * records.
   *
   * Bounded by the addresses left unnamed, since a named address cannot also
   * have failed. Undefined when the resolver did not say — a test double, an
   * older resolver — which the note reads as "nothing to report", never as a
   * failure.
   */
  failedAddressCount?: number | undefined;
  /*
   * Set only when the pass itself threw — unreachable by design, since the
   * resolver never rejects — so every host was left unnamed for a reason
   * that is neither the budget nor the resolver.
   */
  error?: string | undefined;
}

/*
 * What the NetBIOS lookup achieved and whether it was cut short (OneUptime
 * issue #3677) — the same idea as ReverseDnsNamingOutcome, for the three ways
 * this lookup can stop early: the host cap, the wall-clock budget, and a
 * socket that failed.
 *
 * Address counts are over DISTINCT addresses among the hosts that were still
 * unnamed when the lookup ran; `resolvedCount` counts host entries, as
 * SubnetScanResult.netbiosResolvedCount always has.
 */
export interface NetbiosNamingOutcome {
  // Host entries that got a netbiosName.
  resolvedCount: number;
  // Distinct addresses still unnamed after SNMP and reverse DNS.
  unnamedAddressCount: number;
  // Distinct addresses that got a NetBIOS name.
  namedAddressCount: number;
  /*
   * Distinct unnamed addresses the address policy allowed (private IPv4),
   * before the host cap. Undefined when the resolver did not say.
   */
  eligibleAddressCount?: number | undefined;
  // Distinct addresses at least one query was sent to.
  queriedAddressCount?: number | undefined;
  // More eligible addresses than the cap allows; `maxHosts` says what it is.
  isHostCapReached: boolean;
  maxHosts?: number | undefined;
  // The wall-clock budget ended the lookup with hosts still to ask or hear.
  isTimeBudgetExhausted: boolean;
  totalBudgetInMs?: number | undefined;
  /*
   * Why the probe's UDP socket could not be used, when it could not. The
   * resolver's failureReason, already truncated.
   */
  failureReason?: string | undefined;
  // Set only when the lookup itself threw. See ReverseDnsNamingOutcome.error.
  error?: string | undefined;
}

export interface SubnetScanResult {
  /*
   * Every host the sweep found alive: SNMP responders (snmpReachable true)
   * and, when the ICMP pre-sweep ran, ping-only hosts (snmpReachable
   * false). Callers reporting "answered SNMP" counts must filter.
   */
  discoveredHosts: Array<DiscoveredHost>;
  scannedHostCount: number;
  /*
   * The distinct UDP ports the sweep probed, ascending, so the summary can
   * name them. Usually one; a list when the scan's credential sets disagree —
   * an estate with an agent on 1161 beside the default 161 is a real shape.
   *
   * EMPTY on an ICMP-only sweep, which dials no port at all — naming 161 there
   * would point the operator at a firewall rule for traffic that was never
   * sent. (This replaced a single optional `scannedPort`, whose undefined said
   * the same thing.)
   */
  scannedPorts: Array<number>;
  /*
   * How many hosts each credential set answered, keyed by config id.
   * Zero-valued entries are present for sets that answered nothing, because
   * "this credential found nobody" is exactly what the operator needs told —
   * it is either wrong or aimed at gear that is not on this range, and either
   * way it costs every silent address another timeout on every run.
   *
   * Empty on an ICMP-only sweep: no credential was tried, which is a different
   * statement from "every credential found nobody".
   */
  responderCountByConfigId: Record<string, number>;
  /*
   * Hosts that answered the ICMP pre-sweep. undefined when the pre-sweep
   * could not run (e.g. no ping binary / ICMP privileges) and every host was
   * SNMP-probed directly, so a partial count is never reported as a real one.
   */
  respondedToPingCount?: number | undefined;
  /*
   * Hosts that NO credential set could authenticate to, and whose failure was
   * something OTHER than a timeout — an authentication failure, an unknown v3
   * user, a refused port, no route.
   *
   * A timeout is the ordinary "nothing at this address" answer and is not
   * counted; everything else is evidence the operator can act on, and used
   * to be swallowed by a debug-level log inside a sweep that then reported
   * a clean zero.
   *
   * Counted per HOST, not per attempt: with several credential sets a single
   * mis-credentialed device produces one failure per set, and multiplying the
   * count by the length of the list would make a subnet look several times
   * worse than it is.
   */
  snmpErrorHostCount: number;
  /*
   * The most frequent of those errors, verbatim, so the scan can say
   * "0 answered SNMP ... most common error: Authentication failure" instead
   * of leaving the operator to guess between a wrong credential, a blocked
   * port and an empty subnet.
   */
  mostCommonSnmpError?: string | undefined;
  /*
   * How many ICMP-silent hosts were SNMP-probed anyway because the pre-sweep
   * produced no SNMP responders at all. Non-zero means the sweep hit the
   * ICMP-filtered-subnet path described in scan().
   */
  icmpFilteredFallbackHostCount: number;
  /*
   * True when this sweep asked no host for SNMP at all.
   *
   * Reported rather than re-derived by the caller from the config, because
   * every SNMP number above is zero in that mode for a completely different
   * reason than "the credentials were wrong", and the status message has to
   * tell those two zeroes apart.
   *
   * OPTIONAL, and absent means the SNMP sweep — the same rule the scan column
   * itself is read by (ScanModeUtil). A result built before this field existed,
   * in a test fixture or by an older code path, describes a sweep that did
   * probe SNMP, and must keep reading that way.
   */
  isIcmpOnlySweep?: boolean | undefined;
  /*
   * True when the ICMP pre-sweep broke partway through an ICMP-ONLY sweep, so
   * an unknown part of the range was never checked. The hosts reported are the
   * ones confirmed before it broke — worth keeping, but never worth presenting
   * as a complete answer.
   */
  isIcmpSweepIncomplete?: boolean | undefined;
  /*
   * How many discovered hosts came back with a usable reverse-DNS name
   * (OneUptime issue #3529).
   *
   * NOT set by scan(). The reverse-DNS pass deliberately runs OUTSIDE the
   * sweep — see attachReverseDnsHostnames and FetchScans.scanWithDeadline —
   * so this is stamped onto the result afterwards by whoever ran that pass.
   *
   * Absent therefore means "the enrichment has not run on this result", which
   * is a different statement from zero ("it ran and named nobody"). Nothing
   * branches on it; it is here so the probe log can report what the pass
   * achieved without re-walking the hosts.
   */
  reverseDnsResolvedCount?: number | undefined;
  /*
   * How many discovered hosts were named by NetBIOS (OneUptime issue #3677).
   *
   * Same rule as reverseDnsResolvedCount: NOT set by scan(), and absent means
   * the lookup did not run on this result at all — the scan did not ask for
   * it, the probe is a global probe, or the lookup threw — which is a
   * different statement from zero ("it ran and named nobody"). Only logged.
   */
  netbiosResolvedCount?: number | undefined;
  /*
   * The reverse-DNS pass's verdict: how far it got and whether it was cut
   * short. Same rule as reverseDnsResolvedCount — NOT set by scan(), absent
   * when the pass has not run on this result. FetchScans.buildScanStatusMessage
   * turns a cut-short pass into a clause on the scan's status message.
   */
  reverseDnsOutcome?: ReverseDnsNamingOutcome | undefined;
  /*
   * The NetBIOS lookup's verdict. Same rule as netbiosResolvedCount: absent
   * when the lookup did not run on this result.
   */
  netbiosOutcome?: NetbiosNamingOutcome | undefined;
  /*
   * True when the scan ASKED for NetBIOS names, the probe running it is a
   * global probe — which never sends NetBIOS queries, whatever the scan says
   * — and at least one host was left with no name at all because of it
   * (OneUptime issue #3916). Set by FetchScans.scanWithDeadline, never by
   * scan(), and absent in every other case.
   *
   * netbiosOutcome is absent on this path, exactly as for a scan that never
   * asked, because no lookup ran. Before this flag the two were therefore
   * indistinguishable: the operator ticked "NetBIOS name lookup", got bare
   * addresses back, and the only trace of why was a debug line in a probe log
   * that runs at ERROR by default. The bundled self-hosted probes register
   * with REGISTER_PROBE_KEY and so ARE global probes, which makes this the
   * default experience rather than an edge case.
   *
   * Only for a sweep that left somebody unnamed: when SNMP and reverse DNS
   * named every host, NetBIOS would not have been sent anyway, and a sentence
   * about skipping it would be noise.
   */
  isNetbiosLookupSkippedOnGlobalProbe?: boolean | undefined;
}

/*
 * Knobs for the post-sweep reverse-DNS pass. Only the budget, today: the
 * probe's PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS, read by FetchScans rather
 * than here so this file stays importable without the probe's Config.
 */
export interface ReverseDnsPassOptions {
  /*
   * A fixed wall-clock budget for the pass, in milliseconds. Undefined sizes
   * it to the number of hosts (getReverseDnsTotalBudgetInMs).
   */
  totalBudgetInMs?: number | undefined;
}

/*
 * Knobs for the post-sweep NetBIOS lookup - the probe's
 * PROBE_DISCOVERY_NETBIOS_MAX_HOSTS, read by FetchScans for the same reason
 * ReverseDnsPassOptions is.
 */
export interface NetbiosPassOptions {
  /*
   * How many unnamed hosts the lookup may ask. Undefined uses the resolver's
   * own DEFAULT_NETBIOS_MAX_HOSTS. The wall-clock budget is sized from this,
   * so raising it lengthens the lookup as well as widening it.
   */
  maxHosts?: number | undefined;
}

/*
 * Sweeping the whole subnet at once would exhaust sockets; probe in waves.
 *
 * The wave SIZE is derived from how much address space the scan actually has
 * to cover (getSweepConcurrency), not fixed. It used to be a flat 32 for every
 * sweep, and that number is the arithmetic behind OneUptime issue #3598: a
 * dead address costs ~1s in the ICMP pass and ~2s per credential set in the
 * SNMP one, so 32 workers put a hard floor of 8 minutes on the ICMP pass of a
 * 15,360-address range and another 16 minutes on the SNMP pass when the
 * ICMP-filtered fallback fires — before SNMP v3's extra engine-discovery round
 * trip, and before a second or third credential set multiplies the SNMP half
 * again. A /24 and a /17 were given the same 32 workers, so the cost of a
 * large scan grew strictly linearly with nothing to absorb it.
 *
 * The floor stays 32 so a small sweep behaves exactly as it always has.
 */
const MIN_SWEEP_CONCURRENCY: number = 32;

/*
 * The ICMP ceiling is lower than the SNMP one, and the asymmetry is about
 * what a worker actually holds.
 *
 * An ICMP probe FORKS the OS `ping` binary (isHostAliveByPing), so N workers
 * means N live child processes —
 * each with its own PID, file descriptors and ~1MB of RSS. An SNMP probe is a
 * UDP socket inside this process, which costs a file descriptor and a buffer.
 * A probe container is small, and 256 concurrent `ping` processes on one is a
 * different proposition from 256 sockets.
 */
const MAX_ICMP_SWEEP_CONCURRENCY: number = 128;
const MAX_SNMP_SWEEP_CONCURRENCY: number = 256;

/*
 * Hard ceiling on an operator-supplied override, so a typo in an environment
 * variable cannot fork ten thousand processes at once.
 */
const MAX_OVERRIDE_SWEEP_CONCURRENCY: number = 1024;

/*
 * Roughly how long ONE pass over the target should take, and the whole input
 * to the concurrency choice: workers = hosts x seconds-per-host / this.
 *
 * Two minutes is chosen against the two numbers on either side of it. Below
 * it sits the segment cadence — progress has to be reported often enough to
 * be worth reporting — and above it sit the probe's 90-minute sweep deadline
 * and the server's 2-hour abandoned-scan reaper, which every pass of every
 * legitimate sweep has to fit inside together.
 */
const TARGET_PASS_DURATION_IN_SECONDS: number = 120;

/*
 * A dead address costs about a second in the ICMP pass
 * and about two in the SNMP one (probeHostWithConfig's 2000ms, once per
 * credential set). The concurrency arithmetic uses the SNMP figure for both
 * passes: it is the expensive half, it is the half the ICMP-filtered fallback
 * runs over the WHOLE range, and sizing to the cheaper one would leave exactly
 * the pass that needs the workers short of them.
 */
const SECONDS_PER_DEAD_HOST: number = 2;

/*
 * How many waves of workers make up one segment.
 *
 * A segment is the unit of incremental progress: its ICMP pass, then its SNMP
 * pass, then one call to onProgress. Too small and the sweep pays a
 * synchronisation barrier (and an upload) for a handful of addresses; too
 * large and a long sweep goes quiet for minutes at a time. Eight waves is
 * ~16 seconds of ICMP at any concurrency, which is a good cadence for a
 * progress bar and negligible overhead for the sweep.
 */
const SEGMENT_WAVES: number = 8;

/*
 * Floor on the segment size, so a small sweep is ONE segment and behaves
 * exactly as it did before segmenting existed — the entire target pinged
 * before anything is SNMP-probed.
 */
const MIN_SEGMENT_SIZE: number = 512;
/*
 * How much of an SNMP error message is kept for the scan's status summary.
 * See describeSnmpError — the summary lands in a varchar(500) column, so the
 * quoted error has to leave room for the rest of the sentence.
 */
const SNMP_ERROR_EXCERPT_LENGTH: number = 120;

export default class SubnetScanner {
  public static async scan(
    config: SubnetScanConfig,
  ): Promise<SubnetScanResult> {
    /*
     * Validate syntax AND size BEFORE expanding. expandTarget() materializes
     * one string per host, so validating after expansion would let a /8
     * allocate ~16M strings (OOM) before the limit is ever checked.
     *
     * The server already rejects a bad target at write time using this same
     * validator (NetworkDeviceDiscoveryScanService), so reaching this throw
     * means the row predates that check or was written out of band. Either
     * way the message ends up on the scan as its failure reason.
     */
    const validationError: string | null = ScanTargetUtil.getValidationError(
      config.cidr,
    );

    if (validationError) {
      throw new Error(validationError);
    }

    config.signal?.throwIfAborted();

    const hosts: Array<string> = SubnetScanner.expandTarget(config.cidr);

    if (hosts.length === 0) {
      throw new Error("Scan target expands to no addresses: " + config.cidr);
    }

    /*
     * Only an EXPLICIT false turns SNMP off — see ScanModeUtil. A config
     * assembled without the field describes the sweep this probe ran before
     * ICMP-only scans existed, and that sweep did SNMP.
     */
    const isSnmpEnabled: boolean = config.isSnmpEnabled !== false;

    const snmpConfigs: Array<SubnetScanSnmpConfig> = config.snmpConfigs || [];

    /*
     * Refused rather than defaulted — but only for a scan that actually does
     * SNMP. Sweeping with an invented credential would report a subnet as empty
     * on the strength of a guess nobody made, and the caller (which resolves
     * the list from the scan row and always produces at least one entry for an
     * SNMP scan) reaching here means the row is broken in a way the operator
     * has to see.
     *
     * An ICMP-only scan carries no credentials BY DESIGN, so an empty list is
     * the correct input there and must not fail the sweep.
     */
    if (isSnmpEnabled && snmpConfigs.length === 0) {
      throw new Error(
        "This scan has no SNMP configuration to try. Open the scan and add at least one SNMP config, or turn Check SNMP off to run it as a ping sweep.",
      );
    }

    /*
     * How wide each pass runs, and how much address space one segment covers.
     *
     * Derived from the target's size rather than fixed, so a /24 keeps the
     * 32 workers it has always had while a 15,360-address range gets the
     * ~128 it needs to finish inside a coffee break rather than a working
     * day (OneUptime issue #3598). Both passes take their concurrency from
     * the same call so an operator's override means one thing.
     */
    const icmpConcurrency: number = SubnetScanner.getSweepConcurrency({
      hostCount: hosts.length,
      maxConcurrency: MAX_ICMP_SWEEP_CONCURRENCY,
      override: config.maxConcurrency,
    });

    const snmpConcurrency: number = SubnetScanner.getSweepConcurrency({
      hostCount: hosts.length,
      maxConcurrency: MAX_SNMP_SWEEP_CONCURRENCY,
      override: config.maxConcurrency,
    });

    const segmentSize: number = SubnetScanner.getSegmentSize(
      Math.max(icmpConcurrency, snmpConcurrency),
    );

    /*
     * ICMP pre-sweep state. Best-effort: the first infrastructure failure
     * (ping binary missing, ICMP socket privileges — an error, not a clean
     * "host down") flips the flag and every host is SNMP-probed directly,
     * exactly as before the pre-sweep existed.
     *
     * "Best-effort" holds only while SNMP is the real probe. An ICMP-only sweep
     * has nothing to fall back TO, so the flag is fatal there — see the guard
     * after the segment loop.
     */
    let isPingSweepAvailable: boolean = true;
    /*
     * Why the pre-sweep stopped, kept for the operator and truncated the way
     * SNMP errors are: isHostAliveByPing throws with the OS ping's untrimmed,
     * often multi-line stderr, and this ends up quoted inside a varchar(500).
     * Only the FIRST failure is kept — they are all the same failure.
     */
    let pingFailureReason: string = "";
    const pingAliveHosts: Set<string> = new Set<string>();

    const discoveredHosts: Array<DiscoveredHost> = [];
    const probedHosts: Set<string> = new Set<string>();
    const snmpErrorCounts: Map<string, number> = new Map<string, number>();
    /*
     * Successes per credential set, doubling as the adaptive ordering's input
     * (see orderConfigsBySuccess) and as the per-config responder counts the
     * status message reports. Seeded at zero for every set so a credential that
     * found nothing is still named.
     */
    const successCountByConfigId: Map<string, number> = new Map<
      string,
      number
    >();

    for (const snmpConfig of snmpConfigs) {
      successCountByConfigId.set(snmpConfig.id, 0);
    }

    let snmpResponderCount: number = 0;
    let snmpErrorHostCount: number = 0;
    /*
     * Addresses whose first-pass checks have finished. NOT bumped by the
     * fallback pass, which re-probes addresses this already counted — see
     * SubnetScanProgress.sweptHostCount.
     */
    let sweptHostCount: number = 0;
    const sweptHosts: Set<string> = new Set<string>();
    let phase: "icmp" | "snmp" | "snmp-fallback" = "icmp";
    let phaseCompletedHostCount: number = 0;
    let phaseTotalHostCount: number = 0;

    const markSwept: (host: string) => void = (host: string): void => {
      sweptHosts.add(host);
      sweptHostCount = sweptHosts.size;
    };

    const pingHost: (host: string) => Promise<void> = async (
      host: string,
    ): Promise<void> => {
      config.signal?.throwIfAborted();
      if (!isPingSweepAvailable) {
        return;
      }

      try {
        const alive: boolean = await SubnetScanner.isHostAliveByPing(
          host,
          config.signal,
        );
        config.signal?.throwIfAborted();
        if (alive) {
          pingAliveHosts.add(host);
          if (!isSnmpEnabled) {
            discoveredHosts.push({ ipAddress: host, snmpReachable: false });
            markSwept(host);
          }
        } else {
          markSwept(host);
        }
        phaseCompletedHostCount++;
      } catch (pingErr) {
        config.signal?.throwIfAborted();
        if (!isPingSweepAvailable) {
          return;
        }
        /*
         * A rejection means pinging itself failed (a dead host resolves
         * cleanly with alive=false). Disable the pre-sweep for the rest of
         * the scan; hosts already confirmed alive stay known-alive.
         */
        isPingSweepAvailable = false;
        pingFailureReason =
          pingFailureReason ||
          String(pingErr).substring(0, SNMP_ERROR_EXCERPT_LENGTH);
        logger.warn(
          "Discovery ICMP pre-sweep unavailable (" +
            pingErr +
            "). " +
            (isSnmpEnabled
              ? "Falling back to SNMP-probing every host."
              : "This scan checks ICMP only, so it has nothing to fall back to and will be reported as failed."),
        );
      }
    };

    const probeHost: (host: string) => Promise<void> = async (
      host: string,
    ): Promise<void> => {
      config.signal?.throwIfAborted();
      probedHosts.add(host);

      /*
       * Try the credential sets IN SERIES and stop at the first that answers.
       *
       * Serial, not parallel, on purpose. Firing every set at once would cut
       * the latency for a silent host but would also put a failed
       * authentication attempt on the wire against every real device for every
       * credential the scan carries — which is both rude to production gear
       * and, on kit configured to lock a v3 user out after N failures, actively
       * harmful. Stopping at the first success also means a host that answers
       * costs exactly what it cost before this list existed.
       *
       * The ORDER is adaptive: whichever sets have answered most so far in this
       * sweep are tried first. On a subnet that is mostly one credential — the
       * common case even when it is mixed — that collapses the cost of a
       * badly-ordered list from N timeouts per host back to roughly one.
       */
      const orderedConfigs: Array<SubnetScanSnmpConfig> =
        SubnetScanner.orderConfigsBySuccess(
          snmpConfigs,
          successCountByConfigId,
        );

      /*
       * Distinct non-timeout errors this host produced, across all sets. A Set
       * because a device that rejects three community strings reports
       * "Authentication failure" three times and is ONE mis-credentialed host,
       * not three.
       */
      const hostErrors: Set<string> = new Set<string>();

      for (const snmpConfig of orderedConfigs) {
        config.signal?.throwIfAborted();
        const attempt: {
          systemInfo: SnmpSystemInfo | null;
          error?: string | undefined;
        } = await SubnetScanner.probeHostWithConfig(
          host,
          snmpConfig,
          config.signal,
        );
        config.signal?.throwIfAborted();

        if (attempt.systemInfo) {
          snmpResponderCount++;
          successCountByConfigId.set(
            snmpConfig.id,
            (successCountByConfigId.get(snmpConfig.id) || 0) + 1,
          );

          discoveredHosts.push({
            ipAddress: host,
            sysName: attempt.systemInfo.sysName,
            sysDescr: attempt.systemInfo.sysDescr,
            sysObjectId: attempt.systemInfo.sysObjectId,
            sysLocation: attempt.systemInfo.sysLocation,
            sysContact: attempt.systemInfo.sysContact,
            sysUpTimeSeconds: attempt.systemInfo.sysUpTimeSeconds,
            snmpReachable: true,
            snmpConfigId: snmpConfig.id,
          });

          return;
        }

        if (attempt.error) {
          hostErrors.add(attempt.error);
        }
      }

      // No credential set answered.
      if (hostErrors.size > 0) {
        snmpErrorHostCount++;

        for (const message of hostErrors) {
          snmpErrorCounts.set(message, (snmpErrorCounts.get(message) || 0) + 1);
        }
      }

      if (pingAliveHosts.has(host)) {
        /*
         * Answered ICMP but not SNMP: a real host without (readable) SNMP.
         * Record it instead of discarding it — the scan's job is to surface
         * what is on the subnet, not only what is manageable. Hosts that never
         * answered ICMP are NOT recorded: without that evidence "no SNMP
         * answer" cannot be told apart from "no host", and every dead address
         * would become a phantom endpoint.
         */
        discoveredHosts.push({
          ipAddress: host,
          snmpReachable: false,
        });
      }
    };

    /*
     * One report of what the sweep holds right now.
     *
     * Reporting never blocks the workers. Consumers receive an independent
     * snapshot and own upload throttling; their failures cannot lose results.
     */
    const emitProgress: () => void = (): void => {
      if (!config.onProgress || config.signal?.aborted) {
        return;
      }

      try {
        const report: Promise<void> | void = config.onProgress({
          sweptHostCount: sweptHostCount,
          phase: phase,
          phaseCompletedHostCount: phaseCompletedHostCount,
          phaseTotalHostCount: phaseTotalHostCount,
          totalHostCount: hosts.length,
          discoveredHosts: SubnetScanner.sortByAddress(
            discoveredHosts.map((host: DiscoveredHost) => {
              return { ...host };
            }),
          ),
          snmpResponderCount: snmpResponderCount,
          respondedToPingCount: isPingSweepAvailable
            ? pingAliveHosts.size
            : undefined,
          isIcmpOnlySweep: !isSnmpEnabled,
        });
        // An uploader that stalls must never stall the network sweep itself.
        void Promise.resolve(report).catch((progressErr: unknown) => {
          logger.warn(
            `Discovery sweep of ${config.cidr} could not report progress: ${progressErr}`,
          );
        });
      } catch (progressErr) {
        logger.warn(
          `Discovery sweep of ${config.cidr} could not report progress (the sweep itself is unaffected): ${progressErr}`,
        );
      }
    };

    const trackedProbeHost: (host: string) => Promise<void> = async (
      host: string,
    ): Promise<void> => {
      await probeHost(host);
      config.signal?.throwIfAborted();
      markSwept(host);
      phaseCompletedHostCount++;
    };

    // A slow host cannot hide the work other workers have already completed.
    const progressTimer: ReturnType<typeof setInterval> | undefined =
      config.onProgress ? setInterval(emitProgress, 1000) : undefined;

    try {
      /*
       * The sweep, one segment at a time.
       *
       * The passes used to be global: every address in the target was pinged
       * before a single one was SNMP-probed, and nothing left the probe until
       * both passes were done. On a 15,360-address range that is eight minutes
       * of silence before the first host can possibly be known, and a sweep
       * abandoned at the deadline reported nothing at all despite having found
       * hundreds of devices (OneUptime issue #3598).
       *
       * Interleaving them per segment changes no result — the ICMP gate, the
       * credential ordering and the counters are all carried across segments —
       * but it means hosts start being known within seconds, and known hosts
       * can be uploaded while the rest of the range is still being swept, which
       * is what lets auto-import see them (OneUptime issue #3599).
       *
       * A sweep small enough to fit in one segment (MIN_SEGMENT_SIZE, 512
       * addresses) behaves exactly as it always did.
       */
      for (
        let segmentStart: number = 0;
        segmentStart < hosts.length;
        segmentStart += segmentSize
      ) {
        config.signal?.throwIfAborted();
        const segment: Array<string> = hosts.slice(
          segmentStart,
          segmentStart + segmentSize,
        );

        // Phase 1 — ICMP pre-sweep across this segment.
        phase = "icmp";
        phaseCompletedHostCount = 0;
        phaseTotalHostCount = segment.length;
        if (isPingSweepAvailable) {
          await SubnetScanner.runConcurrently(
            segment,
            icmpConcurrency,
            pingHost,
            config.signal,
          );
        }

        if (isSnmpEnabled) {
          /*
           * Phase 2 — SNMP probe. Gated on the pre-sweep when it is working; the
           * whole segment when it is not, which is the "SNMP-probe every host"
           * fallback the pre-sweep has always had. Addresses skipped by the gate
           * get their chance after the loop, if the sweep needs it.
           */
          const firstPassHosts: Array<string> = isPingSweepAvailable
            ? segment.filter((host: string) => {
                return pingAliveHosts.has(host);
              })
            : segment;

          phase = "snmp";
          phaseCompletedHostCount = 0;
          phaseTotalHostCount = firstPassHosts.length;
          await SubnetScanner.runConcurrently(
            firstPassHosts,
            snmpConcurrency,
            trackedProbeHost,
            config.signal,
          );
        }

        emitProgress();

        /*
         * An ICMP-only sweep whose ping broke has nothing left to do: there is
         * no second probe to fall back to, and every remaining segment would be
         * a no-op. Stop rather than spinning through the rest of the range.
         */
        if (!isSnmpEnabled && !isPingSweepAvailable) {
          break;
        }
      }

      if (!isSnmpEnabled) {
        /*
         * No fallback exists in this mode, so an unusable ping is a failed scan
         * rather than a clean zero. Reporting "0 of 254 answered" for a probe
         * that never sent a single echo is the exact false negative the ICMP
         * pre-sweep's own privilege detection was added to prevent — it would
         * read as "this subnet is empty", and the one fact that explains it (this
         * container cannot open an ICMP socket) would live only in a probe log.
         */
        if (!isPingSweepAvailable && pingAliveHosts.size === 0) {
          throw new Error(
            "This scan checks ICMP only, but this probe could not send ICMP echo requests at all, so it has no way to find anything. " +
              "The probe needs the ping binary and the NET_RAW capability - OneUptime's own compose file and Helm chart grant both, so this usually means a hardened runtime dropped the capability, or a custom probe image left iputils-ping out. " +
              "Create the scan with Check SNMP on if this probe cannot be given ICMP. " +
              "Ping reported: " +
              (pingFailureReason || "unknown error"),
          );
        }

        return {
          discoveredHosts: SubnetScanner.sortByAddress(discoveredHosts),
          scannedHostCount: hosts.length,
          // No port was dialled, and an empty list is the only honest answer.
          scannedPorts: [],
          /*
           * Not "every credential found nobody" — no credential was TRIED. An
           * entry per config here would invite the status message to name
           * credentials this sweep never used.
           */
          responderCountByConfigId: {},
          respondedToPingCount: pingAliveHosts.size,
          snmpErrorHostCount: 0,
          mostCommonSnmpError: undefined,
          icmpFilteredFallbackHostCount: 0,
          isIcmpOnlySweep: true,
          /*
           * The pre-sweep broke, but not before confirming hosts. Those are real
           * and worth reporting; the range they came from is not complete, and
           * the status message has to say so rather than let a partial tally
           * read as the whole subnet.
           */
          isIcmpSweepIncomplete: !isPingSweepAvailable,
        };
      }

      /*
       * Phase 3 — the ICMP gate must never be able to silence a subnet.
       *
       * Skipping SNMP for ICMP-silent hosts is only an optimisation, and it is
       * wrong exactly where it matters most: management VLANs behind a firewall
       * routinely drop echo while permitting UDP/161 from the NMS, and Windows
       * hosts block echo by default. On such a segment every host looks dead,
       * every SNMP probe is skipped, and the scan reports a confident "0 of 254"
       * that is indistinguishable from an empty subnet — while an adjacent VLAN
       * that happens to permit echo scans perfectly.
       *
       * So when the gated pass finds NO SNMP responder at all, re-probe the
       * hosts it skipped. The cost lands only on scans that would otherwise have
       * returned nothing, and it buys back the entire ICMP-filtered case.
       *
       * The OTHER way an address can reach here unprobed is a pre-sweep that
       * broke partway: segments before the break were gated, segments after it
       * were not, so the gated ones left ICMP-silent addresses behind. Those get
       * probed too — that is what "falling back to SNMP-probing every host" has
       * always meant — but they are NOT counted as an ICMP-filtered fallback,
       * which is a statement about a working pre-sweep finding nothing.
       */
      let icmpFilteredFallbackHostCount: number = 0;

      const skippedHosts: Array<string> = hosts.filter((host: string) => {
        return !probedHosts.has(host);
      });

      if (skippedHosts.length > 0) {
        phase = "snmp-fallback";
        phaseCompletedHostCount = 0;
        phaseTotalHostCount = skippedHosts.length;
        if (!isPingSweepAvailable) {
          logger.warn(
            `Discovery sweep of ${config.cidr}: the ICMP pre-sweep stopped working partway through, so ${skippedHosts.length} address(es) gated out before it broke are being SNMP-probed directly.`,
          );

          await SubnetScanner.probeInSegments(
            skippedHosts,
            segmentSize,
            snmpConcurrency,
            trackedProbeHost,
            emitProgress,
            config.signal,
          );
        } else if (snmpResponderCount === 0) {
          icmpFilteredFallbackHostCount = skippedHosts.length;
          logger.warn(
            `Discovery sweep of ${config.cidr} found no SNMP responder among the ${pingAliveHosts.size} host(s) that answered ICMP. Re-probing the ${skippedHosts.length} ICMP-silent host(s) over SNMP in case ICMP is filtered on this network.`,
          );

          await SubnetScanner.probeInSegments(
            skippedHosts,
            segmentSize,
            snmpConcurrency,
            trackedProbeHost,
            emitProgress,
            config.signal,
          );
        }
      }

      SubnetScanner.sortByAddress(discoveredHosts);

      return {
        discoveredHosts: discoveredHosts,
        // Full sweep size — hosts skipped by the ICMP gate still count as scanned.
        scannedHostCount: hosts.length,
        scannedPorts: SubnetScanner.getScannedPorts(snmpConfigs),
        responderCountByConfigId: Object.fromEntries(successCountByConfigId),
        /*
         * Only meaningful when the pre-sweep ran for the whole scan. If it was
         * disabled partway through, the count covers an unknown subset of the
         * subnet, so report nothing rather than a misleading number.
         */
        respondedToPingCount: isPingSweepAvailable
          ? pingAliveHosts.size
          : undefined,
        snmpErrorHostCount: snmpErrorHostCount,
        mostCommonSnmpError: SubnetScanner.getMostCommonError(snmpErrorCounts),
        icmpFilteredFallbackHostCount: icmpFilteredFallbackHostCount,
      };
    } finally {
      if (progressTimer) {
        clearInterval(progressTimer);
      }
    }
  }

  /*
   * How many workers one pass over `hostCount` addresses runs with.
   *
   * Public and pure so the sizing can be pinned directly: it is the single
   * lever between "a /17 finishes in minutes" and "a /17 runs for most of a
   * day" (OneUptime issue #3598), and it has to hold three properties at once
   * — a small sweep keeps the 32 workers it always had, a large one scales
   * with its size, and nothing ever exceeds the pass's ceiling.
   *
   * An explicit override wins outright, clamped only against a typo.
   */
  public static getSweepConcurrency(data: {
    hostCount: number;
    maxConcurrency: number;
    override?: number | undefined;
  }): number {
    if (data.override && Number.isFinite(data.override) && data.override > 0) {
      return Math.min(
        Math.max(1, Math.floor(data.override)),
        MAX_OVERRIDE_SWEEP_CONCURRENCY,
      );
    }

    const hostCount: number = Math.max(0, Math.floor(data.hostCount));

    /*
     * A sweep can never usefully run more workers than it has addresses, and
     * a target smaller than the floor should not spin up 32 workers for 6
     * hosts.
     */
    const sized: number = Math.ceil(
      (hostCount * SECONDS_PER_DEAD_HOST) / TARGET_PASS_DURATION_IN_SECONDS,
    );

    return Math.min(
      Math.max(sized, MIN_SWEEP_CONCURRENCY),
      data.maxConcurrency,
      Math.max(hostCount, 1),
    );
  }

  /*
   * How much address space one segment covers — the unit of incremental
   * progress. See SEGMENT_WAVES and MIN_SEGMENT_SIZE.
   */
  public static getSegmentSize(concurrency: number): number {
    return Math.max(MIN_SEGMENT_SIZE, concurrency * SEGMENT_WAVES);
  }

  /*
   * Runs `work` over `hosts` segment by segment, reporting progress after
   * each — the fallback pass's half of the incremental sweep.
   *
   * Progress is reported but `sweptHostCount` is NOT advanced here: every
   * address in this list was already counted by the segment loop that gated
   * it out. The reporting still matters, because this pass is where an
   * ICMP-filtered subnet's entire inventory is found, and it can be the
   * longest part of the sweep.
   */
  private static async probeInSegments(
    hosts: Array<string>,
    segmentSize: number,
    concurrency: number,
    work: (host: string) => Promise<void>,
    onSegmentComplete: () => Promise<void> | void,
    signal?: AbortSignal,
  ): Promise<void> {
    for (
      let segmentStart: number = 0;
      segmentStart < hosts.length;
      segmentStart += segmentSize
    ) {
      await SubnetScanner.runConcurrently(
        hosts.slice(segmentStart, segmentStart + segmentSize),
        concurrency,
        work,
        signal,
      );

      await onSegmentComplete();
    }
  }

  /*
   * Sorts discovered hosts by address, in place, and hands the same array
   * back. Shared by the sweep's own final ordering and by every progress
   * snapshot, so a partial result and the final result are ordered the same
   * way.
   */
  private static sortByAddress(
    hosts: Array<DiscoveredHost>,
  ): Array<DiscoveredHost> {
    const addressValues: Map<string, number> = new Map<string, number>();
    for (const host of hosts) {
      addressValues.set(host.ipAddress, SubnetScanner.ipToLong(host.ipAddress));
    }
    return hosts.sort((a: DiscoveredHost, b: DiscoveredHost) => {
      return addressValues.get(a.ipAddress)! - addressValues.get(b.ipAddress)!;
    });
  }

  /*
   * One host, one credential set. Returns the system group if the device
   * answered, or the reason it did not when that reason is worth reporting.
   *
   * Split out of probeHost so the per-config loop stays readable, and so the
   * "an error escaped as a throw rather than through the callback" case is
   * handled in exactly one place for every set.
   */
  private static async probeHostWithConfig(
    host: string,
    snmpConfig: SubnetScanSnmpConfig,
    signal?: AbortSignal,
  ): Promise<{
    systemInfo: SnmpSystemInfo | null;
    error?: string | undefined;
  }> {
    const monitorConfig: MonitorStepSnmpMonitor = {
      /*
       * Already parsed by the caller: the stored version is the dropdown key
       * ("V1"/"V2c"/"V3") while SnmpMonitor branches on the enum value
       * ("1"/"2c"/"3"). A bare cast leaves "V3" unequal to SnmpVersion.V3, so
       * the session would silently downgrade to v2c.
       */
      snmpVersion: snmpConfig.snmpVersion,
      hostname: host,
      port: snmpConfig.port,
      communityString: snmpConfig.communityString,
      snmpV3Auth: snmpConfig.snmpV3Auth,
      oids: [],
      timeout: 2000,
      retries: 0,
    };

    /*
     * Anything the SNMP layer failed with that is NOT a timeout. A timeout
     * is the ordinary answer for an empty address; an auth failure, an
     * unknown v3 user, a refused port or an unreachable network is a
     * diagnosis, and reporting nothing but "0 found" for a whole subnet of
     * them is what makes this class of misconfiguration unfindable.
     *
     * Held on an object rather than in a bare `let` so the assignment made
     * inside the callback below is not erased by control-flow narrowing.
     */
    const probeFailure: { message?: string | undefined } = {};

    try {
      const systemInfo: SnmpSystemInfo | null =
        await SnmpMonitor.probeSystemInfo(
          monitorConfig,
          (probeError: unknown) => {
            probeFailure.message = SubnetScanner.describeSnmpError(probeError);
          },
          signal,
        );

      if (systemInfo) {
        return { systemInfo: systemInfo };
      }
    } catch (err) {
      logger.debug(
        `Discovery probe error for ${host} with ${snmpConfig.label}: ${err}`,
      );
      probeFailure.message = SubnetScanner.describeSnmpError(err);
    }

    return { systemInfo: null, error: probeFailure.message };
  }

  /*
   * The order to try credential sets in for the NEXT host: the ones that have
   * already answered most often in this sweep first, ties broken by the
   * operator's declared order.
   *
   * Public (and unit-tested directly) because it is the one piece of the
   * multi-credential sweep whose behaviour is not obvious from the call site,
   * and because it must be a PURE function of the two inputs — the sweep calls
   * it once per host from 32 concurrent workers, and anything stateful in here
   * would make the sweep order depend on scheduling.
   *
   * It cannot change WHAT is found: every set is still tried until one answers,
   * so ordering only decides how many timeouts are paid on the way. That is why
   * a race on the success counters is harmless — a worker reading a slightly
   * stale count picks a slightly worse order, nothing more.
   */
  public static orderConfigsBySuccess(
    configs: Array<SubnetScanSnmpConfig>,
    successCountByConfigId: Map<string, number>,
  ): Array<SubnetScanSnmpConfig> {
    const declaredIndexById: Map<string, number> = new Map<string, number>();

    configs.forEach((config: SubnetScanSnmpConfig, index: number) => {
      declaredIndexById.set(config.id, index);
    });

    return [...configs].sort(
      (a: SubnetScanSnmpConfig, b: SubnetScanSnmpConfig) => {
        const successDifference: number =
          (successCountByConfigId.get(b.id) || 0) -
          (successCountByConfigId.get(a.id) || 0);

        if (successDifference !== 0) {
          return successDifference;
        }

        /*
         * Declared order, read from a map rather than relying on Array.sort
         * being stable for the ids: two sets can legitimately share a label,
         * and this keeps the tie-break defined by position.
         */
        return (
          (declaredIndexById.get(a.id) ?? 0) -
          (declaredIndexById.get(b.id) ?? 0)
        );
      },
    );
  }

  /*
   * The distinct ports the sweep touches, ascending. Distinct because the
   * common case is that every set uses 161 and the summary should say
   * "port 161", not "ports 161, 161, 161".
   */
  private static getScannedPorts(
    configs: Array<SubnetScanSnmpConfig>,
  ): Array<number> {
    const ports: Set<number> = new Set<number>();

    for (const config of configs) {
      ports.add(config.port || 161);
    }

    return [...ports].sort((a: number, b: number) => {
      return a - b;
    });
  }

  /*
   * Runs `work` over `items` with at most `concurrency` in flight. Sweeping a
   * whole subnet at once would exhaust sockets (and, for the ICMP pass, fork a
   * ping process per address), so probe in waves.
   *
   * The wave size is a parameter rather than a constant because the two passes
   * hold different resources — child processes vs UDP sockets — and because it
   * scales with the target's size; see getSweepConcurrency.
   */
  private static async runConcurrently(
    items: Array<string>,
    concurrency: number,
    work: (item: string) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    let cursor: number = 0;

    const worker: () => Promise<void> = async (): Promise<void> => {
      while (cursor < items.length) {
        signal?.throwIfAborted();
        await work(items[cursor++]!);
      }
    };

    const workers: Array<Promise<void>> = [];
    for (let i: number = 0; i < Math.min(concurrency, items.length); i++) {
      workers.push(worker());
    }

    let onAbort: (() => void) | undefined;
    const aborted: Promise<never> = new Promise<never>(
      (_resolve: (value: never) => void, reject: (error: unknown) => void) => {
        onAbort = (): void => {
          reject(signal?.reason || new Error("Discovery scan aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) {
          onAbort();
        }
      },
    );
    try {
      await Promise.race([Promise.all(workers), aborted]);
    } finally {
      if (onAbort) {
        signal?.removeEventListener("abort", onAbort);
      }
    }
  }

  /*
   * Turns an SNMP probe failure into a line worth showing the operator, or
   * undefined when it carries no information.
   *
   * Timeouts are dropped: in a subnet sweep most addresses are empty and
   * answer nothing, so counting those would drown the signal. What survives —
   * "Authentication failure", "Unknown user name", "Unsupported security
   * level", EHOSTUNREACH, ECONNREFUSED — each means the probe got somewhere
   * and was turned away, which is precisely what a scan reporting zero hosts
   * needs to say.
   */
  private static describeSnmpError(error: unknown): string | undefined {
    const message: string = (
      (error as Error | undefined)?.message || String(error ?? "")
    ).trim();

    if (!message) {
      return undefined;
    }

    const lowerCased: string = message.toLowerCase();
    if (lowerCased.includes("timeout") || lowerCased.includes("timed out")) {
      return undefined;
    }

    /*
     * Bounded: this is quoted into the scan's statusMessage, which is a
     * varchar(500). The interesting part of every SNMP error ("Authentication
     * failure", "Unknown user name", "connect ECONNREFUSED 10.0.0.1:161") is
     * at the front, so a head excerpt loses nothing that matters.
     */
    return message.length > SNMP_ERROR_EXCERPT_LENGTH
      ? message.substring(0, SNMP_ERROR_EXCERPT_LENGTH)
      : message;
  }

  private static getMostCommonError(
    errorCounts: Map<string, number>,
  ): string | undefined {
    let mostCommon: string | undefined = undefined;
    let highestCount: number = 0;

    for (const [message, count] of errorCounts) {
      if (count > highestCount) {
        mostCommon = message;
        highestCount = count;
      }
    }

    return mostCommon;
  }

  public static async isHostAliveByPing(
    host: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return await DiscoveryPing.probe(host, signal);
  }

  /*
   * Stamps `dnsHostname` onto every host that has a usable PTR record, in
   * place, and answers how many got one (OneUptime issue #3529).
   *
   * DELIBERATELY NOT CALLED BY scan(), and that is the whole point of it
   * being a separate public method.
   *
   * The sweep runs inside a deadline race (FetchScans.scanWithDeadline): if
   * scan() has not SETTLED by PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS, the race
   * rejects and runScan reports the scan Failed with no hosts at all. An
   * enrichment inside scan() spends that same budget, so a sweep that had
   * already found forty hosts could be thrown away entirely because looking
   * up their names took the run past the line — the enrichment destroying the
   * very result it was meant to improve. The pass's own budget - sized to the
   * hosts found, ten minutes at most, or the twenty an operator may fix it at
   * - bounds how much it can add; it cannot stop that addition being the
   * straw.
   *
   * So the lookups happen AFTER the race has settled, on a result that is
   * already final and already safe. Nothing this method does can be
   * cancelled, discarded or blamed on the sweep.
   *
   * Mutates rather than returning a new list because it is handed the exact
   * array the caller already holds, after ordering, filtering and every count
   * are decided — there is nothing left for it to disturb.
   *
   * NEVER throws. A sweep that found twelve hosts found twelve hosts whether
   * or not any of them can be named; the consequence of total failure is
   * hosts named by address, which is exactly the behaviour that predates
   * this.
   *
   * Answers the pass's VERDICT rather than a bare count: how many hosts were
   * named, and whether the pass was cut short by its time budget or by a
   * resolver that does not work from here. The caller puts that on the scan's
   * status message, because a cut-short pass is otherwise invisible to anyone
   * not reading the probe log (see ReverseDnsNamingOutcome).
   *
   * And stamps WHY on each host it leaves unnamed (OneUptime issue #3916):
   * `dnsHostnameStatus`, the resolver's per-address code — no PTR record, a
   * lookup that timed out or failed (on its retry too, when the pass reached
   * it), one the pass never reached. The Review dialog turns it into the tooltip beside a bare
   * address, which is the only place an operator can learn that eight of
   * twelve hosts were not "missing a record" but "the probe's DNS server did
   * not answer". Stamped only on hosts with neither a sysName nor a
   * dnsHostname — a host with a name needs no explanation, and a status on it
   * would be thousands of copies of nothing — and only with a code the
   * resolver actually reported: no default is ever invented, so a host the
   * resolver said nothing about keeps no key at all.
   */
  public static async attachReverseDnsHostnames(
    hosts: Array<DiscoveredHost>,
    options?: ReverseDnsPassOptions | undefined,
  ): Promise<ReverseDnsNamingOutcome> {
    const addresses: Set<string> = new Set<string>(
      (Array.isArray(hosts) ? hosts : []).map((host: DiscoveredHost) => {
        return host.ipAddress;
      }),
    );

    const outcome: ReverseDnsNamingOutcome = {
      resolvedCount: 0,
      addressCount: addresses.size,
      namedAddressCount: 0,
      notLookedUpAddressCount: 0,
      isTimeBudgetExhausted: false,
      isReverseDnsAvailable: true,
    };

    if (addresses.size === 0) {
      return outcome;
    }

    try {
      const resolution: ReverseDnsResolution =
        await SubnetScanner.resolveReverseDnsHostnames(
          hosts.map((host: DiscoveredHost) => {
            return host.ipAddress;
          }),
          options,
        );

      const namedAddresses: Set<string> = new Set<string>();

      for (const host of hosts) {
        const dnsHostname: string | undefined =
          resolution.hostnameByIpAddress.get(host.ipAddress);

        if (dnsHostname) {
          host.dnsHostname = dnsHostname;
          outcome.resolvedCount++;
          namedAddresses.add(host.ipAddress);
        }
      }

      outcome.namedAddressCount = namedAddresses.size;

      /*
       * Why the rest were left unnamed (issue #3916), AFTER every name is on,
       * so a host is judged unnamed on the pass's final word rather than
       * part-way through it.
       *
       * The map is read only when it IS a Map, and each value only through
       * the whitelist: the seam is public and spied on, and a double that
       * hands back an object literal, or a code this probe does not know,
       * must leave the host exactly as it was — with no key — rather than
       * upload something the dashboard would have to guess the meaning of.
       */
      const statusByIpAddress: Map<unknown, unknown> | undefined =
        SubnetScanner.readStatusMap(resolution.statusByIpAddress);

      if (statusByIpAddress) {
        for (const host of hosts) {
          if (
            SubnetScanner.hasText(host.sysName) ||
            SubnetScanner.hasText(host.dnsHostname)
          ) {
            continue;
          }

          const dnsHostnameStatus: DiscoveredHostReverseDnsStatus | undefined =
            readDiscoveredHostReverseDnsStatus(
              statusByIpAddress.get(host.ipAddress),
            );

          if (dnsHostnameStatus) {
            host.dnsHostnameStatus = dnsHostnameStatus;
          }
        }
      }

      /*
       * Read as flags only when they are exactly booleans. The seam is public
       * and spied on, and a double that leaves a field out must not read as a
       * pass that was cut short — or, worse, as a broken resolver.
       */
      outcome.isTimeBudgetExhausted = resolution.isTimeBudgetExhausted === true;
      outcome.isReverseDnsAvailable =
        resolution.isReverseDnsAvailable !== false;
      /*
       * Bounded by the addresses left unnamed: an address that was never
       * asked cannot have been named, so a figure above that is a double
       * describing some other list. Unknown — not zero — when a pass that
       * stopped early did not say how early.
       */
      const reportedNotLookedUpCount: number | undefined =
        SubnetScanner.readCount(resolution.notLookedUpCount);

      outcome.notLookedUpAddressCount =
        reportedNotLookedUpCount !== undefined
          ? Math.min(
              reportedNotLookedUpCount,
              addresses.size - namedAddresses.size,
            )
          : outcome.isTimeBudgetExhausted || !outcome.isReverseDnsAvailable
            ? undefined
            : 0;
      outcome.totalBudgetInMs = SubnetScanner.readCount(
        resolution.totalBudgetInMs,
      );
      outcome.failureReason = SubnetScanner.readReason(
        resolution.failureReason,
      );

      /*
       * Addresses whose lookup failed (issue #3916) — on its retry too,
       * unless the pass ran out of time first — for the status message. Bounded by the addresses left unnamed for the
       * reason notLookedUpAddressCount is: a double reporting more failures
       * than there are unnamed addresses is describing some other list.
       * Left ABSENT when the resolver did not say, rather than zeroed, so a
       * verdict from a resolver that never counted failures is the same
       * object it always was.
       */
      const reportedFailedCount: number | undefined = SubnetScanner.readCount(
        resolution.failedAddressCount,
      );

      if (reportedFailedCount !== undefined) {
        outcome.failedAddressCount = Math.min(
          reportedFailedCount,
          addresses.size - namedAddresses.size,
        );
      }

      logger.debug(
        `Discovery reverse DNS named ${outcome.resolvedCount} of ${hosts.length} discovered host(s)` +
          (outcome.isTimeBudgetExhausted
            ? `, stopping at its time budget with ${outcome.notLookedUpAddressCount ?? "some"} address(es) not looked up`
            : "") +
          (outcome.failedAddressCount
            ? `, with ${outcome.failedAddressCount} address(es) whose lookup failed`
            : "") +
          (outcome.isReverseDnsAvailable
            ? ""
            : ", and reverse DNS is not usable from this probe") +
          ".",
      );

      return outcome;
    } catch (err) {
      /*
       * Unreachable by design — resolveHostnames swallows every per-address
       * failure itself — and caught anyway, because the ONE thing this
       * enrichment must never do is lose a completed sweep's results on the
       * way out of it.
       *
       * Names already stamped before the throw stay stamped and are counted:
       * the outcome has to describe the hosts the caller is about to upload.
       */
      /*
       * Described FIRST, and interpolated as that string rather than as the
       * thrown value: `${err}` throws for a symbol and for a null-prototype
       * object, and a throw here - inside the catch that exists to keep a
       * finished sweep's hosts - would lose them.
       */
      const described: string = SubnetScanner.describeEnrichmentError(err);

      logger.warn(
        `Discovery reverse DNS enrichment failed; discovered hosts will be named by IP address. ${described}`,
      );

      return SubnetScanner.describeFailedReverseDnsPass(
        hosts,
        outcome,
        described,
      );
    }
  }

  /*
   * The outcome of a pass that threw, recounted from the hosts themselves so
   * it cannot disagree with what is uploaded.
   */
  private static describeFailedReverseDnsPass(
    hosts: Array<DiscoveredHost>,
    outcome: ReverseDnsNamingOutcome,
    describedError: string,
  ): ReverseDnsNamingOutcome {
    const namedAddresses: Set<string> = new Set<string>();
    let resolvedCount: number = 0;

    for (const host of hosts) {
      if (host && host.dnsHostname) {
        resolvedCount++;
        namedAddresses.add(host.ipAddress);
      }
    }

    const described: ReverseDnsNamingOutcome = {
      ...outcome,
      resolvedCount: resolvedCount,
      namedAddressCount: namedAddresses.size,
      notLookedUpAddressCount: undefined,
      error: describedError,
    };

    /*
     * A failure count read off the resolution before the throw is dropped,
     * key and all: the throw path's verdict is `error` alone, for the reason
     * it carries no failureReason. Any status a host was already stamped
     * with stays — it is what the resolver said about that address, and it
     * is uploaded either way.
     */
    delete described.failedAddressCount;

    return described;
  }

  /*
   * The lookup pass, as a seam.
   *
   * Public and static for the same reason isHostAliveByPing is: it is the
   * only part of the sweep that talks to the outside world on this path, and
   * every scanner test spies on it rather than standing up a resolver. The
   * resolver's own behaviour — timeouts, the failure budget, which answers
   * are usable — is tested directly against ReverseDnsResolver.
   */
  public static async resolveReverseDnsHostnames(
    ipAddresses: Array<string>,
    options?: ReverseDnsPassOptions | undefined,
  ): Promise<ReverseDnsResolution> {
    return await new ReverseDnsResolver({
      totalBudgetInMs: options?.totalBudgetInMs,
    }).resolveHostnames(ipAddresses);
  }

  /*
   * Stamps `netbiosName` onto the hosts that answer a NetBIOS node status
   * query, in place, and answers how many got one (OneUptime issue #3677).
   *
   * Asks ONLY hosts that are still unnamed: no non-empty sysName and no
   * non-empty dnsHostname. Those are the hosts the issue is about — the ones
   * the Review dialog can otherwise only show as an address — and a host that
   * already has a better name costs nothing here. On an estate with working
   * reverse DNS that means no datagram is sent at all, which is why this runs
   * AFTER attachReverseDnsHostnames rather than beside it.
   *
   * Like attachReverseDnsHostnames, deliberately NOT called by scan(): it runs
   * in FetchScans.scanWithDeadline after the sweep has won its deadline race,
   * and only when the scan opted in and the probe is not a global probe. The
   * gates live THERE rather than here so this method stays a plain, directly
   * testable enrichment; the address policy lives in NetbiosNameResolver, so
   * no caller can skip it.
   *
   * Every name is put through normalizeNetbiosName again on the way onto the
   * host, whatever the seam returned. The resolver already normalises, but the
   * seam is public and spied on, and the one thing that must hold for every
   * path to the upload is that `netbiosName` is never a raw self-reported
   * string.
   *
   * NEVER throws. A sweep that found twelve hosts found twelve hosts whether
   * or not any of them answer on UDP 137; total failure means a warning in the
   * probe log and hosts named by address, exactly as before this existed.
   *
   * Answers the lookup's VERDICT rather than a bare count, for the same
   * reason attachReverseDnsHostnames does: a lookup stopped by its host cap,
   * its time budget or a failed socket is otherwise visible only in the probe
   * log (see NetbiosNamingOutcome).
   *
   * And stamps `netbiosNameStatus` — no reply, no usable name, never asked and
   * why — on each host it was handed and did not name (OneUptime issue
   * #3916), for the Review dialog's tooltip. Only those hosts: a host SNMP or
   * reverse DNS already named was never this lookup's business, and "NetBIOS:
   * not asked" beside a host with a perfectly good name would be noise. Only
   * with a code the resolver reported, for the reason reverse DNS gives.
   */
  public static async attachNetbiosNames(
    hosts: Array<DiscoveredHost>,
    options?: NetbiosPassOptions | undefined,
  ): Promise<NetbiosNamingOutcome> {
    const outcome: NetbiosNamingOutcome = {
      resolvedCount: 0,
      unnamedAddressCount: 0,
      namedAddressCount: 0,
      isHostCapReached: false,
      isTimeBudgetExhausted: false,
    };

    /*
     * Held outside the try so the catch can recount what was stamped before
     * a throw, the same way attachReverseDnsHostnames does.
     */
    let unnamedHosts: Array<DiscoveredHost> = [];

    try {
      if (!Array.isArray(hosts) || hosts.length === 0) {
        return outcome;
      }

      unnamedHosts = hosts.filter((host: DiscoveredHost) => {
        return (
          Boolean(host) &&
          !SubnetScanner.hasText(host.sysName) &&
          !SubnetScanner.hasText(host.dnsHostname)
        );
      });

      if (unnamedHosts.length === 0) {
        return outcome;
      }

      const unnamedAddresses: Set<string> = new Set<string>(
        unnamedHosts.map((host: DiscoveredHost) => {
          return host.ipAddress;
        }),
      );

      outcome.unnamedAddressCount = unnamedAddresses.size;

      const resolution: NetbiosNameResolution =
        await SubnetScanner.resolveNetbiosNames(
          unnamedHosts.map((host: DiscoveredHost) => {
            return host.ipAddress;
          }),
          options,
        );

      const namedAddresses: Set<string> = new Set<string>();

      for (const host of unnamedHosts) {
        const netbiosName: string | undefined = normalizeNetbiosName(
          resolution.nameByIpAddress.get(host.ipAddress),
        );

        if (netbiosName) {
          host.netbiosName = netbiosName;
          outcome.resolvedCount++;
          namedAddresses.add(host.ipAddress);
        }
      }

      outcome.namedAddressCount = namedAddresses.size;

      /*
       * Why the rest got no NetBIOS name (issue #3916): read the way reverse
       * DNS reads its statuses — a real Map, whitelisted codes, no default —
       * and stamped only on the hosts this lookup was handed, after every name
       * is on.
       */
      const statusByIpAddress: Map<unknown, unknown> | undefined =
        SubnetScanner.readStatusMap(resolution.statusByIpAddress);

      if (statusByIpAddress) {
        for (const host of unnamedHosts) {
          if (SubnetScanner.hasText(host.netbiosName)) {
            continue;
          }

          const netbiosNameStatus: DiscoveredHostNetbiosStatus | undefined =
            readDiscoveredHostNetbiosStatus(
              statusByIpAddress.get(host.ipAddress),
            );

          if (netbiosNameStatus) {
            host.netbiosNameStatus = netbiosNameStatus;
          }
        }
      }

      // Exactly-boolean reads, for the reason given in attachReverseDnsHostnames.
      outcome.isHostCapReached = resolution.isHostCapReached === true;
      outcome.isTimeBudgetExhausted = resolution.isTimeBudgetExhausted === true;
      outcome.eligibleAddressCount = SubnetScanner.readCount(
        resolution.eligibleCount,
      );
      outcome.queriedAddressCount = SubnetScanner.readCount(
        resolution.queriedCount,
      );
      outcome.maxHosts = SubnetScanner.readCount(resolution.maxHosts);
      outcome.totalBudgetInMs = SubnetScanner.readCount(
        resolution.totalBudgetInMs,
      );
      outcome.failureReason = SubnetScanner.readReason(
        resolution.failureReason,
      );

      logger.debug(
        `Discovery NetBIOS named ${outcome.resolvedCount} of ${unnamedHosts.length} otherwise unnamed discovered host(s).`,
      );

      return outcome;
    } catch (err) {
      /*
       * Unreachable by design — NetbiosNameResolver never rejects — and caught
       * anyway, for the same reason attachReverseDnsHostnames catches: this
       * runs on the way to a completed sweep's upload.
       */
      // Described first, for the reason attachReverseDnsHostnames describes.
      const described: string = SubnetScanner.describeEnrichmentError(err);

      logger.warn(
        `Discovery NetBIOS enrichment failed; discovered hosts will be named by IP address. ${described}`,
      );

      const namedAddresses: Set<string> = new Set<string>();
      let resolvedCount: number = 0;

      for (const host of unnamedHosts) {
        if (host && SubnetScanner.hasText(host.netbiosName)) {
          resolvedCount++;
          namedAddresses.add(host.ipAddress);
        }
      }

      return {
        ...outcome,
        resolvedCount: resolvedCount,
        namedAddressCount: namedAddresses.size,
        error: described,
      };
    }
  }

  /*
   * The NetBIOS lookup, as a seam — the same shape and the same reason as
   * resolveReverseDnsHostnames: every scanner and job test spies on this
   * rather than opening a UDP socket, and the resolver's own behaviour is
   * tested directly against NetbiosNameResolver with a fake socket.
   */
  public static async resolveNetbiosNames(
    ipAddresses: Array<string>,
    options?: NetbiosPassOptions | undefined,
  ): Promise<NetbiosNameResolution> {
    return await new NetbiosNameResolver({
      maxHosts: options?.maxHosts,
    }).resolveNames(ipAddresses);
  }

  /*
   * Stamps `status` as the NetBIOS status of every host still without any
   * name — no sysName, no dnsHostname, no netbiosName — and answers how many
   * it stamped (OneUptime issue #3916).
   *
   * For the one way NetBIOS is skipped wholesale rather than host by host: a
   * scan that asked for it running on a global probe, which never sends it
   * (FetchScans.scanWithDeadline). No lookup ran, so no resolver reported a
   * code; the caller knows why every host went unasked and says so here, on
   * exactly the hosts attachNetbiosNames would have been handed.
   *
   * The code goes through the same whitelist as a resolver's, and nothing is
   * stamped for one it does not recognise. NEVER throws, like every other
   * naming step on the way to a finished sweep's upload.
   */
  public static stampNetbiosStatusOnUnnamedHosts(
    hosts: Array<DiscoveredHost>,
    status: DiscoveredHostNetbiosStatus,
  ): number {
    const netbiosNameStatus: DiscoveredHostNetbiosStatus | undefined =
      readDiscoveredHostNetbiosStatus(status);

    if (!netbiosNameStatus || !Array.isArray(hosts)) {
      return 0;
    }

    let stampedCount: number = 0;

    try {
      for (const host of hosts) {
        if (
          !host ||
          typeof host !== "object" ||
          SubnetScanner.hasText(host.sysName) ||
          SubnetScanner.hasText(host.dnsHostname) ||
          SubnetScanner.hasText(host.netbiosName)
        ) {
          continue;
        }

        host.netbiosNameStatus = netbiosNameStatus;
        stampedCount++;
      }
    } catch (err) {
      /*
       * Unreachable for a host list the sweep built — a frozen host, say, is
       * the only way to get here — and caught because a status is never worth
       * a sweep's results. The hosts stamped so far keep their status and are
       * counted.
       */
      logger.warn(
        `Discovery could not record why NetBIOS skipped some hosts. ${SubnetScanner.describeEnrichmentError(err)}`,
      );
    }

    return stampedCount;
  }

  // A string with something in it besides whitespace.
  private static hasText(value: unknown): boolean {
    return typeof value === "string" && value.trim().length > 0;
  }

  /*
   * A resolution's per-address status table, or undefined when it is not a
   * Map (OneUptime issue #3916). The naming seams are public and spied on,
   * and a double that hands back a plain object — or anything else with a
   * `get` — must read as "no statuses reported", never as a table to call
   * into. The values are still untrusted: every reader whitelists them.
   */
  private static readStatusMap(
    value: unknown,
  ): Map<unknown, unknown> | undefined {
    return value instanceof Map ? (value as Map<unknown, unknown>) : undefined;
  }

  /*
   * A count or duration read off a resolution, or undefined when it is not a
   * finite, non-negative number. The naming seams are public and spied on, so
   * a field can be missing or nonsense, and a status message that printed
   * "NaN hosts" would be worse than one that said less.
   */
  private static readCount(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : undefined;
  }

  // A non-blank reason string off a resolution, trimmed, or undefined.
  private static readReason(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  /*
   * A thrown enrichment error, bounded the way SNMP errors are, because it
   * can end up on the scan's status message.
   *
   * Every step here is about one of the shapes a rejection really takes on
   * this path, and about NEVER throwing while describing one - this runs
   * inside the catch that keeps a finished sweep's hosts:
   *
   *   - an Error's message is used even when it is EMPTY. Falling back to
   *     String(error) there printed the class name, so `new Error("")` put
   *     "(Error)" on the status message while `new Error(" ")` said "unknown
   *     error" about the same nothing;
   *   - a rejection that is not an Error but carries a string `message` (the
   *     shape most libraries and a structured-clone'd Error take) is described
   *     by it rather than as "[object Object]";
   *   - anything else is stringified defensively: String() throws for a
   *     null-prototype object, and a template literal throws for a symbol.
   */
  private static describeEnrichmentError(error: unknown): string {
    const message: unknown =
      error instanceof Error
        ? error.message
        : (error as { message?: unknown } | undefined)?.message;

    let described: string = typeof message === "string" ? message.trim() : "";

    if (!described && !(error instanceof Error)) {
      try {
        described = String(error ?? "").trim();
      } catch {
        described = "";
      }
    }

    if (!described) {
      described = "unknown error";
    }

    return described.length > SNMP_ERROR_EXCERPT_LENGTH
      ? described.substring(0, SNMP_ERROR_EXCERPT_LENGTH)
      : described;
  }

  /*
   * How many addresses a scan target expands to, computed arithmetically with
   * no allocation. Returns 0 for a malformed target. Accepts either notation:
   * CIDR ("192.168.1.0/24"), where /31 and /32 count every address and larger
   * blocks exclude the network and broadcast addresses; or an octet range
   * ("10.16-22.0-255.51-66"), where every enumerated address counts.
   */
  public static countHosts(target: string): number {
    return ScanTargetUtil.countHosts(target);
  }

  /*
   * Expands a scan target into the addresses to probe, in ascending order.
   * Empty for a malformed target. Callers must gate on countHosts() (or
   * ScanTargetUtil.getValidationError()) first — see scan() above.
   */
  public static expandTarget(target: string): Array<string> {
    return ScanTargetUtil.expand(target);
  }

  private static ipToLong(ip: string): number {
    const parts: Array<string> = ip.split(".");
    if (parts.length !== 4) {
      return NaN;
    }
    let long: number = 0;
    for (const part of parts) {
      const octet: number = parseInt(part, 10);
      if (isNaN(octet) || octet < 0 || octet > 255) {
        return NaN;
      }
      long = long * 256 + octet;
    }
    return long >>> 0;
  }
}
