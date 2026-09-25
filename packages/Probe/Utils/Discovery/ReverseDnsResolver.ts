import { normalizeReverseDnsName } from "Common/Utils/NetworkDiscovery/ReverseDnsNameUtil";
import { DiscoveredHostReverseDnsStatus } from "Common/Types/NetworkDevice/DiscoveredHostNamingStatus";
import logger from "Common/Server/Utils/Logger";
import dns from "dns";
import net from "net";

/*
 * PTR lookups for the addresses a discovery sweep found alive (OneUptime
 * issue #3529).
 *
 * The lookup happens on the PROBE, not on the OneUptime server. A probe sits
 * inside the network it scans and resolves against that network's own
 * resolvers; the server generally cannot see an internal reverse zone at all,
 * and on a self-hosted install with remote probes it is not even on the same
 * continent. Asking the server would produce NXDOMAIN for every device that
 * has a perfectly good PTR record.
 *
 * Only the DISCOVERED addresses are looked up, never the swept range. A /24
 * that finds twelve hosts costs twelve lookups, not 254 — which is what keeps
 * this affordable enough to run unconditionally, with no column to turn it on.
 */

/*
 * The lookup itself, injectable so the tests never touch a real resolver.
 * Returns the PTR answers for an address; rejects the way c-ares does, with
 * an Error carrying a `code`.
 */
export type ReverseDnsLookupFunction = (
  ipAddress: string,
) => Promise<Array<string>>;

/*
 * Per-address budget. Deliberately short: a reverse zone that answers at all
 * answers fast, and the sweep this decorates has already paid for a ping and
 * up to N SNMP timeouts per host. A name is a nicety — it must never be the
 * reason a scan looks hung.
 */
export const DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS: number = 2000;

/*
 * Matches the sweep's own CONCURRENCY. These lookups run AFTER the sweep, not
 * beside it, so the two never contend; the number is shared because the
 * constraint is the same one (do not open a socket per address in a /16).
 */
export const DEFAULT_REVERSE_DNS_CONCURRENCY: number = 32;

/*
 * How many infrastructure failures are tolerated before the rest of the pass
 * is skipped — and only while NOT ONE lookup has come back, NXDOMAIN included.
 * See isReverseDnsUnusable in resolveHostnames.
 *
 * It is a FLOOR rather than a cap, because the decision is taken at a wave
 * boundary: at the shipped concurrency of 32 the pass gives up after the first
 * whole wave in which the budget is exceeded, so a probe with no resolver at
 * all costs two waves — about four seconds — instead of the sixty the
 * wall-clock budget would otherwise allow.
 *
 * Two waves rather than one on purpose. A single all-failing wave is not proof
 * of a broken probe: 32 consecutive addresses can share one reverse zone whose
 * nameserver is down while the rest of the estate resolves perfectly, and
 * giving up there would reproduce the exact symptom this feature exists to
 * fix. Sixty-four consecutive addresses answering nothing at all is a
 * different claim.
 */
export const DEFAULT_REVERSE_DNS_FAILURE_BUDGET: number = 64;

/*
 * Wall-clock ceiling on the WHOLE pass, independent of the per-address one.
 *
 * The failure budget only bites while nothing has resolved, which is the
 * right rule for "this probe has no resolver" but leaves the awkward middle
 * case unbounded: a resolver that answers for some addresses and times out on
 * many others never trips it, and a sweep that found four thousand hosts
 * would then spend 4000 / concurrency * 2s — minutes — on an enrichment.
 *
 * The sweep this decorates already runs under its own deadline
 * (FetchScans.scanWithDeadline), so an unbounded pass here would not hang the
 * probe; it would do something worse, which is push a sweep that had already
 * SUCCEEDED past its deadline and report it to the operator as failed. Names
 * are never worth that, so the pass stops and the hosts it did not reach keep
 * their addresses.
 *
 * This is the FLOOR of the budget, not the whole of it: see
 * getReverseDnsTotalBudgetInMs, which grows it with the number of hosts.
 */
export const DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS: number = 60 * 1000;

/*
 * The most the budget grows to on its own, however many hosts a sweep found.
 *
 * A flat sixty seconds covers only thirty waves — 960 addresses — when every
 * lookup in them runs to its two-second timeout, and since addresses are
 * asked in ascending order, a large sweep behind a slow resolver used to keep
 * IP-address names for everything past the first thousand or so, with nothing
 * but a probe log line to say so.
 *
 * Ten minutes covers 9,600 addresses in that worst case, and every address a
 * scan can hold (MAX_SCAN_HOSTS, 32,768) when the resolver answers in well
 * under a second. It stays well clear of the server's stale-scan reaper
 * (App/FeatureSet/Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans.ts),
 * which fails a scan that has been In Progress AND silent for two hours. The
 * probe uploads nothing while it names hosts, so this pass is silence on the
 * row; even an older server that reaps on startedAt alone is not reached,
 * because the default 90-minute sweep deadline plus this and the NetBIOS
 * ceiling still ends inside two hours. Tests/ConfigDiscoveryNamingBudget.test.ts
 * pins that arithmetic.
 */
export const MAX_AUTOMATIC_REVERSE_DNS_TOTAL_BUDGET_IN_MS: number =
  10 * 60 * 1000;

/*
 * The most an operator may FIX the budget at, through
 * PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS (Probe/Config.ts reads it against
 * this). Twice the automatic ceiling, and still inside the reaper arithmetic
 * above with the sweep's full 90-minute deadline spent ahead of it.
 *
 * Exported because the scan's status message needs it too: past this value
 * Config falls back to automatic sizing, so advising an operator whose pass
 * already ran this long to "raise" the variable would shrink their budget.
 */
export const MAX_REVERSE_DNS_TOTAL_BUDGET_OVERRIDE_IN_MS: number =
  20 * 60 * 1000;

/*
 * Slack on top of the worst-case estimate below. The deadline is checked
 * before each wave starts, and a wave takes its timeout plus however late the
 * event loop gets round to it; without headroom a few milliseconds of jitter
 * per wave on a large pass would leave the last wave or two unasked for want
 * of a budget sized to exactly zero spare.
 */
const REVERSE_DNS_BUDGET_HEADROOM: number = 1.1;

/**
 * The wall-clock budget for one pass over `addressCount` distinct addresses.
 *
 * Sized to the WORST case: every wave running to its per-address timeout.
 * That is the awkward middle case the budget exists for — a resolver that
 * answers some addresses and times out on others — and a pass whose resolver
 * answers promptly finishes long before the budget matters. Never below
 * DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS, so a small sweep keeps exactly the
 * budget it always had, and never above
 * MAX_AUTOMATIC_REVERSE_DNS_TOTAL_BUDGET_IN_MS.
 *
 * Pure and exported so the sizing is pinned directly. Nonsense inputs are
 * clamped rather than trusted: this runs on the way to a finished scan's
 * upload, and a NaN here would be a deadline that is never reached.
 */
export function getReverseDnsTotalBudgetInMs(data: {
  addressCount: number;
  concurrency?: number | undefined;
  timeoutInMs?: number | undefined;
}): number {
  const addressCount: number = Number.isFinite(data.addressCount)
    ? Math.max(0, Math.floor(data.addressCount))
    : 0;

  const concurrency: number =
    data.concurrency !== undefined && Number.isFinite(data.concurrency)
      ? Math.max(1, Math.floor(data.concurrency))
      : DEFAULT_REVERSE_DNS_CONCURRENCY;

  const timeoutInMs: number =
    data.timeoutInMs !== undefined && Number.isFinite(data.timeoutInMs)
      ? Math.max(1, data.timeoutInMs)
      : DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS;

  const worstCaseInMs: number = Math.ceil(
    Math.ceil(addressCount / concurrency) *
      timeoutInMs *
      REVERSE_DNS_BUDGET_HEADROOM,
  );

  return Math.min(
    Math.max(worstCaseInMs, DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS),
    MAX_AUTOMATIC_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
  );
}

/*
 * The retry pass's per-attempt budget (OneUptime issue #3916).
 *
 * Twice the first pass's. The slow answers the retry exists for come from
 * forwarders that are themselves waiting on something — a WAN link to the
 * domain controller, a cold cache, WINS-R behind a Windows DNS server — and
 * answers that took 2.3 seconds were measured losing to the first pass's two.
 * Caching layers in between (systemd-resolved, the Windows DNS server) often
 * finish the lookup the probe gave up on, so the retry is frequently
 * answered at once.
 *
 * It is a hard edge, not a soft one: c-ares 1.34 gives up on a four-second
 * query at four seconds (measured: an answer at 4.1s was lost, one at 3.8s
 * was not). That leaves one known case uncovered — Docker's embedded DNS on
 * a user-defined network waits four seconds on a silent first upstream
 * before trying the next, so its answer lands just past this. The bundled
 * probes use host networking and never meet it.
 *
 * Only the RETRY pays it, and only for addresses whose first lookup failed:
 * an address that answered — with a name or with NXDOMAIN — is never asked
 * again, so a healthy estate costs nothing extra.
 */
export const DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS: number = 4000;

/*
 * How much longer than c-ares' own timeout each retry attempt is raced for.
 *
 * The race is a backstop here, not the timeout. c-ares ends a silent query
 * itself, with ETIMEOUT, at its configured timeout; the race only has to
 * catch a resolver that never calls back at all. Racing at exactly the
 * timeout, as the first pass does, makes the two timers fire in the same
 * instant and cancel() an attempt c-ares was about to finish on its own —
 * the slack lets c-ares' own verdict end the attempt, so what is reported is
 * what c-ares saw.
 */
export const REVERSE_DNS_RETRY_RACE_SLACK_IN_MS: number = 1000;

/*
 * The most nameservers the retry asks, in the order the probe's resolver
 * configuration lists them. Three is the historical resolv.conf limit
 * (MAXNS), so this is "every server" on any ordinary configuration while
 * still bounding a pathological one.
 */
export const MAX_REVERSE_DNS_RETRY_SERVERS: number = 3;

/*
 * The longest one address can spend in the retry pass, with the shipped
 * defaults: every configured server asked in turn, each attempt raced to its
 * timeout plus the slack. The retry is started a wave at a time under the
 * pass's own deadline, exactly as the first pass is, so this — not the
 * first pass's two seconds — is now the most a pass can overrun its budget
 * by. Exported so the reaper arithmetic that adds "one wave in flight" can
 * quote the real figure.
 */
export const MAX_REVERSE_DNS_RETRY_LOOKUP_IN_MS: number =
  MAX_REVERSE_DNS_RETRY_SERVERS *
  (DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS +
    REVERSE_DNS_RETRY_RACE_SLACK_IN_MS);

/*
 * Codes that mean "this address has no name", as opposed to "this probe
 * cannot resolve". This is the ORDINARY outcome — most addresses on most
 * networks have no reverse record — so it must never count against the
 * failure budget, or one normal subnet would disable the feature for the rest
 * of its own scan.
 *
 * ENOTFOUND (NXDOMAIN) and ENODATA (the name exists, no PTR record) are what
 * Resolver#resolvePtr rejects with for the two ordinary cases.
 *
 * NOT what Resolver#reverse rejects with, which is why the default lookup no
 * longer calls it for an IPv4 address (OneUptime issue #3916). reverse() goes
 * through c-ares' ares_gethostbyaddr, whose callback turns EVERY status other
 * than success or cancellation into ENOTFOUND: NODATA, SERVFAIL, REFUSED, a
 * server that is not listening (ECONNREFUSED) and c-ares' own ETIMEOUT all
 * came back from it as "no PTR record". This set therefore used to swallow
 * every DNS failure the probe could have — a pass in which the probe's DNS
 * server answered SERVFAIL for eight kitchen displays out of twelve was
 * filed, reported and displayed as eight devices with no name, and was never
 * retried because nothing about it looked like a failure.
 *
 * NOTFOUND/NODATA are kept because they cost nothing: they are the spellings
 * other c-ares entry points use, and this set should not depend on which one
 * a future change routes through.
 */
const NO_RECORD_ERROR_CODES: Set<string> = new Set<string>([
  "ENOTFOUND",
  "ENODATA",
  "NOTFOUND",
  "NODATA",
]);

/*
 * Codes that mean the ADDRESS could not be asked about, not that the probe's
 * DNS failed.
 *
 * EINVAL is what reverse() rejects with when its argument is not a parseable
 * IP address — " 1.2.3.4 ", an IPv6 form it will not take, anything a future
 * caller of the public attachReverseDnsHostnames might hand it — and
 * EBADNAME/EBADSTR are the same complaint from the name-based entry points.
 * None of them says anything about the resolver, so they count as a lookup
 * that came BACK for the failure budget, exactly as they did when they sat in
 * the set above; counting them as failures would let a handful of malformed
 * inputs convict a working probe of having no DNS and skip every remaining
 * host.
 *
 * They are reported as a failed lookup rather than as "no PTR record",
 * because that is what they are, and they are never retried: the same
 * argument is malformed the second time too.
 */
const MALFORMED_INPUT_ERROR_CODES: Set<string> = new Set<string>([
  "EINVAL",
  "EBADNAME",
  "EBADSTR",
]);

/*
 * The per-address statuses that mean the lookup itself FAILED — the ones a
 * retry can change and the ones failedAddressCount counts. NoRecord and
 * UnusableName are answers; the Skipped* codes were never asked.
 */
const FAILED_LOOKUP_STATUSES: ReadonlySet<DiscoveredHostReverseDnsStatus> =
  new Set<DiscoveredHostReverseDnsStatus>([
    DiscoveredHostReverseDnsStatus.Timeout,
    DiscoveredHostReverseDnsStatus.ServerFailure,
    DiscoveredHostReverseDnsStatus.Refused,
    DiscoveredHostReverseDnsStatus.Unreachable,
    DiscoveredHostReverseDnsStatus.Failed,
  ]);

/*
 * How one rejected lookup is read.
 *
 * - "no-record": the DNS server answered that this address has no name.
 *   A SUCCESSFUL lookup for the failure budget, and final.
 * - "malformed-input": the address could not be asked about. Counted like a
 *   lookup that came back (see MALFORMED_INPUT_ERROR_CODES), never retried.
 * - "failure": no answer was obtained. An infrastructure failure for the
 *   budget, and what the retry pass re-asks.
 */
export type ReverseDnsLookupErrorKind =
  | "no-record"
  | "malformed-input"
  | "failure";

export interface ReverseDnsLookupErrorClassification {
  kind: ReverseDnsLookupErrorKind;
  status: DiscoveredHostReverseDnsStatus;
}

/**
 * Reads a rejected lookup's error into what it means for the address and for
 * the pass. Exported so the mapping from c-ares codes to the statuses the
 * dashboard explains is pinned directly, code by code.
 *
 * Keyed on `code` alone, never on the message: the message is c-ares' (or a
 * test's) prose, and a classifier that matched "timed out" in it would read
 * a SERVFAIL whose text happened to mention a timeout as a timeout.
 */
export function classifyReverseDnsLookupError(
  error: unknown,
): ReverseDnsLookupErrorClassification {
  const code: string = getErrorCode(error);

  if (NO_RECORD_ERROR_CODES.has(code)) {
    return {
      kind: "no-record",
      status: DiscoveredHostReverseDnsStatus.NoRecord,
    };
  }

  if (MALFORMED_INPUT_ERROR_CODES.has(code)) {
    return {
      kind: "malformed-input",
      status: DiscoveredHostReverseDnsStatus.Failed,
    };
  }

  switch (code) {
    /*
     * c-ares' own timeout, and the race guard's below, which carries the same
     * code on purpose: "no answer in time" is one fact whichever timer
     * noticed it first.
     */
    case "ETIMEOUT":
      return {
        kind: "failure",
        status: DiscoveredHostReverseDnsStatus.Timeout,
      };
    case "ESERVFAIL":
      return {
        kind: "failure",
        status: DiscoveredHostReverseDnsStatus.ServerFailure,
      };
    case "EREFUSED":
      return {
        kind: "failure",
        status: DiscoveredHostReverseDnsStatus.Refused,
      };
    /*
     * "Could not contact DNS servers": c-ares' reading of an ICMP port
     * unreachable, which is what a resolv.conf naming a host with nothing
     * listening on port 53 produces.
     */
    case "ECONNREFUSED":
      return {
        kind: "failure",
        status: DiscoveredHostReverseDnsStatus.Unreachable,
      };
    /*
     * Everything else — ENOTIMP, EFORMERR, EBADRESP, a code-less Error, a
     * thrown string — is still evidence the probe could not get an answer,
     * which is what the failure budget is for. The unrecognised case must
     * default to COUNTING, or the budget would be unreachable exactly when a
     * resolver fails in a way nobody anticipated.
     */
    default:
      return {
        kind: "failure",
        status: DiscoveredHostReverseDnsStatus.Failed,
      };
  }
}

export interface ReverseDnsResolution {
  /*
   * Resolved names, keyed by the address asked. Addresses with no usable name
   * are ABSENT rather than mapped to undefined, so a caller can write
   * `if (name)` without also having to know whether the key exists.
   */
  hostnameByIpAddress: Map<string, string>;
  /*
   * Why each distinct address passed in did NOT get a name (OneUptime issue
   * #3916): no PTR record, an unusable answer, a lookup that still failed
   * after its retry and how, or a lookup the pass never made and why. Every
   * distinct input address is in exactly one of hostnameByIpAddress and this
   * map.
   *
   * Optional so a resolution written by hand — every scanner and job test
   * stubs this seam — still describes a pass; a reader treats a missing map
   * or a missing key as "no code".
   */
  statusByIpAddress?: Map<string, DiscoveredHostReverseDnsStatus> | undefined;
  /*
   * Distinct addresses whose lookup FAILED — timed out, SERVFAIL, REFUSED,
   * no server listening, any other error — and was still failing when the
   * pass ended: on the first try and on the retry, or on the first try alone
   * when the retry never reached it (see resolveHostnames). Exactly the
   * addresses statusByIpAddress maps to Timeout, ServerFailure, Refused,
   * Unreachable or Failed. Not "addresses without a name": an address with
   * no PTR record was answered, and is not here; nor is one never asked.
   * Optional for the reason statusByIpAddress is.
   */
  failedAddressCount?: number | undefined;
  /*
   * False when the failure budget ran out and the remaining addresses were
   * skipped: not one lookup came back, NXDOMAIN included, so this probe cannot
   * resolve at all. No names will have been found, by construction.
   *
   * Distinct from `isTimeBudgetExhausted`: this one says the resolver does not
   * work from here, which is a probe-configuration fact, while that one says
   * the pass was simply too big to finish. They are independent, and a pass
   * can end with neither, either or both.
   */
  isReverseDnsAvailable: boolean;
  /*
   * True when the wall-clock budget ran out with addresses still unasked. The
   * names resolved before it did are real and are returned.
   */
  isTimeBudgetExhausted: boolean;
  /*
   * Distinct addresses a lookup was STARTED for, whatever it came back with.
   * lookedUpCount + notLookedUpCount is the number of distinct addresses
   * passed in.
   */
  lookedUpCount: number;
  /*
   * Distinct addresses never asked about, because the pass stopped first —
   * the wall-clock budget ran out, or the resolver was judged unusable. Zero
   * for a pass that got through every address.
   *
   * This, not "addresses without a name", is the number that says how much a
   * cut-short pass left on the table: most addresses on most networks have no
   * PTR record, and those were asked.
   */
  notLookedUpCount: number;
  /*
   * The wall-clock budget this pass ran under, in milliseconds — sized to the
   * address count unless the caller fixed it (getReverseDnsTotalBudgetInMs).
   * Reported so a caller telling the operator the pass ran out of time can
   * say how long it had.
   */
  totalBudgetInMs: number;
  /*
   * The FIRST infrastructure failure seen, verbatim-ish and truncated the way
   * SubnetScanner truncates SNMP errors.
   *
   * "Seen", not "fatal". A single stale delegation in an otherwise healthy
   * estate sets this on a pass that named every other host and returns
   * `isReverseDnsAvailable: true`, so a caller that logs it unconditionally
   * would report a resolver problem for a pass that worked. Read it together
   * with `isReverseDnsAvailable`, never on its own.
   */
  failureReason?: string | undefined;
}

// Long enough to name the failure, short enough for one log line.
const FAILURE_REASON_EXCERPT_LENGTH: number = 200;

function describeError(error: unknown): string | undefined {
  const message: string = (
    (error as Error | undefined)?.message || String(error ?? "")
  ).trim();

  /*
   * UNDEFINED, not "", when there is nothing to say. A thrown `undefined` or a
   * bare `new Error()` produces an empty message, and returning that left
   * `failureReason` typed `string | undefined` holding a present-but-empty
   * string — so a caller asking `failureReason !== undefined` was told there
   * was a reason and then shown nothing.
   */
  if (!message) {
    return undefined;
  }

  return message.length > FAILURE_REASON_EXCERPT_LENGTH
    ? message.substring(0, FAILURE_REASON_EXCERPT_LENGTH)
    : message;
}

function getErrorCode(error: unknown): string {
  return String((error as { code?: unknown } | undefined)?.code ?? "");
}

/*
 * How a resolver is obtained, injectable so that everything the default
 * lookups do with one can be tested without a query leaving the machine.
 *
 * Without a seam here, three things in the race below were unreachable from
 * any test: its timeout branch, the `resolver.cancel()` inside it, and the
 * `finally` that clears the timer. The cancel is load-bearing — on a
 * black-holing forwarder every timed-out address would otherwise leave an
 * outstanding query and a retry timer behind for a resolver object the sweep
 * no longer holds — and deleting it broke no test, which is exactly the state
 * a piece of cleanup code should never be in.
 *
 * The four methods are the four the lookups use, and each is a method of
 * dns.promises.Resolver with this signature, so the real class is its own
 * implementation: resolvePtr for an IPv4 address, reverse for anything else
 * and for the hosts-file fallback, getServers/setServers for the retry's
 * one-server-at-a-time walk (OneUptime issue #3916), and cancel for the race.
 */
export interface ReverseDnsResolverLike {
  resolvePtr(hostname: string): Promise<Array<string>>;
  reverse(ipAddress: string): Promise<Array<string>>;
  getServers(): Array<string>;
  setServers(servers: ReadonlyArray<string>): void;
  cancel(): void;
}

export type ReverseDnsResolverFactory = (
  timeoutInMs: number,
) => ReverseDnsResolverLike;

/*
 * ONE FRESH RESOLVER PER LOOKUP, never a shared one (OneUptime issue #3916).
 *
 * A shared channel learns: c-ares 1.34 sizes a query's timeout from the
 * latency it has already measured on that channel, so a channel that has
 * answered a run of fast NXDOMAINs can give the one slow forwarder behind
 * them far less than the configured timeout — in the investigation for
 * #3916 a shared channel dropped slow answers a fresh one waited for. And a
 * shared channel has one cancel(): the race below calls it on the address
 * that ran out of time, and on a shared channel that would abort every other
 * lookup in the wave along with it.
 *
 * `tries: 1` because the retry pass, not c-ares, decides when to ask again —
 * and asks each configured server explicitly when it does.
 */
const defaultResolverFactory: ReverseDnsResolverFactory = (
  timeoutInMs: number,
): ReverseDnsResolverLike => {
  return new dns.promises.Resolver({
    timeout: timeoutInMs,
    tries: 1,
  });
};

/**
 * The name a PTR query for `ipAddress` is asked under —
 * "51.166.18.10.in-addr.arpa" for "10.18.166.51" — or undefined when the
 * argument is not EXACTLY a dotted-quad IPv4 address.
 *
 * Undefined rather than a best effort, and the strictness is the point.
 * Only an address Node itself accepts as IPv4 — no whitespace, no leading
 * zeros, no CIDR suffix, no trailing newline — is turned into a query name;
 * everything else, IPv6 included, stays on reverse(), which rejects a
 * malformed argument with EINVAL inside c-ares before a packet is built.
 * Trimming " 10.18.166.51 " into a valid name here would turn a value the
 * sweep should never have produced into a real query — from a unit test,
 * among other places — and would hide the malformed input instead of
 * reporting it.
 */
export function toReverseLookupName(ipAddress: string): string | undefined {
  if (typeof ipAddress !== "string" || !net.isIPv4(ipAddress)) {
    return undefined;
  }

  return `${ipAddress.split(".").reverse().join(".")}.in-addr.arpa`;
}

/*
 * The race guard's rejection. It carries c-ares' own ETIMEOUT code on
 * purpose: "no answer in time" is one fact whichever timer noticed it
 * first, and the classifier reads codes, never messages. The message keeps
 * the wording the probe has always logged.
 */
function buildLookupTimeoutError(
  ipAddress: string,
  timeoutInMs: number,
): Error {
  const error: Error & { code?: string } = new Error(
    `Reverse DNS lookup for ${ipAddress} timed out after ${timeoutInMs}ms`,
  );
  error.code = "ETIMEOUT";
  return error;
}

/*
 * One lookup of one address on one resolver, bounded twice over — the unit
 * both the first pass and every attempt of the retry are made of.
 *
 * c-ares gets its own `timeout`/`tries` so it stops asking, AND the whole
 * attempt is raced against `raceTimeoutInMs` so a resolver that accepts the
 * query and then never answers cannot pin a worker for the rest of the
 * sweep. The second guard is the one that matters in practice — it is the
 * same belt-and-braces DnsResolutionCache uses, for the same reason.
 *
 * WHICH query (OneUptime issue #3916). An IPv4 address is asked with
 * resolvePtr on its in-addr.arpa name, because that rejects with the code
 * the DNS server actually returned; reverse() reports every failure as
 * ENOTFOUND (see NO_RECORD_ERROR_CODES). Anything else goes through
 * reverse() as before — IPv6, and the malformed values that must be
 * rejected without touching the network.
 *
 * THE HOSTS FILE. reverse() had one property resolvePtr lacks: c-ares reads
 * the hosts file for it BEFORE asking DNS, so a device an operator listed in
 * the probe host's /etc/hosts was named from there — and the bundled probes
 * run with host networking, where that file is the host's own. Dropping it
 * would silently un-name those devices. So when the DNS server answers that
 * there is no record (ENOTFOUND/ENODATA), the same resolver is asked once
 * more with reverse(), inside the SAME race, and its names are used if it
 * has any. If it has none the ORIGINAL rejection is what the caller sees:
 * reverse()'s own error is the collapsed ENOTFOUND this change exists to get
 * away from, and a no-record answer must stay exactly that.
 *
 * Its cost: reverse() asks DNS again after reading the file, so an address
 * with no record now costs two queries instead of one — both NXDOMAINs, the
 * fastest answer a server gives. Only "no record" pays it; a failure is not
 * followed by reverse(), which would only turn its real code back into
 * ENOTFOUND. (A device listed in the hosts file whose PTR lookup FAILS is
 * therefore no longer named from the file on that attempt.)
 */
async function lookupOnResolver(data: {
  resolver: ReverseDnsResolverLike;
  ipAddress: string;
  raceTimeoutInMs: number;
}): Promise<Array<string>> {
  const resolver: ReverseDnsResolverLike = data.resolver;
  const ipAddress: string = data.ipAddress;

  /*
   * Set by the race timer. Read before the hosts-file fallback is started,
   * because a no-record answer can land in the same instant the race is
   * lost: cancel() has already run by then, and a reverse() started after
   * it would be a query nobody waits for and nothing cancels.
   */
  const race: { isAbandoned: boolean } = { isAbandoned: false };

  const attempt: () => Promise<Array<string>> = async (): Promise<
    Array<string>
  > => {
    const reverseLookupName: string | undefined =
      toReverseLookupName(ipAddress);

    if (reverseLookupName === undefined) {
      return await resolver.reverse(ipAddress);
    }

    try {
      return await resolver.resolvePtr(reverseLookupName);
    } catch (err) {
      if (race.isAbandoned || !NO_RECORD_ERROR_CODES.has(getErrorCode(err))) {
        throw err;
      }

      let hostsFileNames: Array<string> | undefined = undefined;

      try {
        hostsFileNames = await resolver.reverse(ipAddress);
      } catch {
        // Nothing there either; the DNS server's answer stands.
        hostsFileNames = undefined;
      }

      if (Array.isArray(hostsFileNames) && hostsFileNames.length > 0) {
        return hostsFileNames;
      }

      throw err;
    }
  };

  const lookup: Promise<Array<string>> = attempt();

  let timer: ReturnType<typeof setTimeout> | undefined = undefined;

  const timeout: Promise<never> = new Promise<never>(
    (_resolve: (value: never) => void, reject: (reason: Error) => void) => {
      timer = setTimeout(() => {
        race.isAbandoned = true;
        /*
         * Tell c-ares to stop as well as stopping waiting for it. Without
         * this the abandoned query stays outstanding on a resolver object
         * the sweep no longer holds, and on a black-holing forwarder every
         * timed-out address leaves one behind — up to a whole sweep's worth
         * of sockets and retry timers the probe is still paying for while
         * the pass moves on. Losing the race is not the same as the query
         * being over.
         */
        resolver.cancel();
        reject(buildLookupTimeoutError(ipAddress, data.raceTimeoutInMs));
      }, data.raceTimeoutInMs);
      // Never keep the probe alive just for this timer.
      timer.unref?.();
    },
  );

  try {
    return await Promise.race([lookup, timeout]);
  } finally {
    /*
     * Clear it on the WINNING path too. Promise.race leaves the loser
     * pending, so an un-cleared timer would otherwise outlive every fast
     * lookup — thousands of them on a large sweep — and each would still
     * call resolver.cancel() long after that resolver's answer was already
     * in the map.
     */
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * The first pass's lookup: one query per address through the probe's
 * configured resolvers, raced at exactly `timeoutInMs`.
 *
 * Deliberately unchanged in its budget. The race still equals the c-ares
 * timeout, which means c-ares' own fail-over to a second nameserver (which
 * happens only once the first has had the whole timeout) never gets to run
 * here — that is the retry pass's job, done explicitly, rather than a reason
 * to make every healthy address's first attempt slower.
 */
export function buildDefaultLookup(
  timeoutInMs: number,
  createResolver: ReverseDnsResolverFactory = defaultResolverFactory,
): ReverseDnsLookupFunction {
  return async (ipAddress: string): Promise<Array<string>> => {
    return await lookupOnResolver({
      resolver: createResolver(timeoutInMs),
      ipAddress: ipAddress,
      raceTimeoutInMs: timeoutInMs,
    });
  };
}

/*
 * The servers a fresh resolver was configured with, in configured order, as
 * getServers() spells them ("10.0.0.2", "10.0.0.3:5353", "[fd00::53]:53") —
 * which is exactly the form setServers() takes back. Duplicates are asked
 * once. Never throws: a resolver that cannot say is treated as one with
 * nothing configured, and the retry then makes its one default attempt.
 */
function readConfiguredServers(
  resolver: ReverseDnsResolverLike,
): Array<string> {
  let servers: unknown = undefined;

  try {
    servers = resolver.getServers();
  } catch {
    return [];
  }

  if (!Array.isArray(servers)) {
    return [];
  }

  return [
    ...new Set<string>(
      servers.filter((server: unknown): server is string => {
        return typeof server === "string" && server.length > 0;
      }),
    ),
  ];
}

/**
 * The retry pass's lookup (OneUptime issue #3916): for an address whose
 * first lookup FAILED, ask each configured nameserver in turn, one at a
 * time, with a longer timeout.
 *
 * Each server explicitly, rather than one resolver with them all configured,
 * because c-ares will not move on by itself in the two cases that matter
 * most. Node runs c-ares with NOCHECKRESP, which takes a SERVFAIL or REFUSED
 * from the first server as the final answer — the second server is never
 * asked. And c-ares moves on after a TIMEOUT only once the first server has
 * had its whole timeout, which the first pass's race (equal to that timeout)
 * always ends first. A dead or misbehaving primary nameserver therefore left
 * every address it was asked about unnamed, however healthy the secondary.
 *
 * - In configured order, because the primary is the server the probe
 *   normally uses, and a longer timeout alone is what rescues a slow answer
 *   or one dropped datagram from it.
 * - At most MAX_REVERSE_DNS_RETRY_SERVERS of them.
 * - Stopping at the first DEFINITIVE answer: names, or NXDOMAIN/NODATA
 *   (after the hosts-file fallback). A server that says "no record" is not
 *   second-guessed against the next one — resolvers that disagree about
 *   whether a record exists are a zone problem, and hunting across them for
 *   a name would make naming depend on which server happened to be asked.
 *   A malformed-input rejection ends it too; no server can fix the argument.
 * - Rejecting with the FIRST server's error when every server fails: the
 *   primary's failure is the one that describes the probe's normal path.
 *
 * With no servers to read, one attempt on a default resolver. A value that is
 * not an IPv4 address gets one reverse() attempt with the retry's timeout
 * and no walk: reverse() has no per-server form worth the complexity, and the
 * sweep never produces one.
 */
export function buildDefaultRetryLookup(
  timeoutInMs: number = DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
  createResolver: ReverseDnsResolverFactory = defaultResolverFactory,
): ReverseDnsLookupFunction {
  const raceTimeoutInMs: number =
    timeoutInMs + REVERSE_DNS_RETRY_RACE_SLACK_IN_MS;

  return async (ipAddress: string): Promise<Array<string>> => {
    /*
     * Fresh, and used for the attempt itself whenever there is no server to
     * pin: reading the configuration costs no query.
     */
    const configuredResolver: ReverseDnsResolverLike =
      createResolver(timeoutInMs);

    const servers: Array<string> =
      toReverseLookupName(ipAddress) === undefined
        ? []
        : readConfiguredServers(configuredResolver).slice(
            0,
            MAX_REVERSE_DNS_RETRY_SERVERS,
          );

    if (servers.length === 0) {
      return await lookupOnResolver({
        resolver: configuredResolver,
        ipAddress: ipAddress,
        raceTimeoutInMs: raceTimeoutInMs,
      });
    }

    /*
     * Boxed, so that a thrown `undefined` still counts as "a failure was
     * seen". A lookup's failure is preferred over a server the resolver
     * refused to be pinned to: the first describes DNS, the second only a
     * spelling.
     */
    let firstLookupFailure: { error: unknown } | undefined = undefined;
    let firstPinningFailure: { error: unknown } | undefined = undefined;

    for (const server of servers) {
      const resolver: ReverseDnsResolverLike = createResolver(timeoutInMs);

      try {
        resolver.setServers([server]);
      } catch (err) {
        /*
         * A server spelling this resolver will not take back. Skipped rather
         * than asked through the full configuration, which would quietly
         * turn "this server" into "the primary again".
         */
        firstPinningFailure = firstPinningFailure || { error: err };
        continue;
      }

      try {
        return await lookupOnResolver({
          resolver: resolver,
          ipAddress: ipAddress,
          raceTimeoutInMs: raceTimeoutInMs,
        });
      } catch (err) {
        if (classifyReverseDnsLookupError(err).kind !== "failure") {
          throw err;
        }

        firstLookupFailure = firstLookupFailure || { error: err };
      }
    }

    // Every server was tried and none answered; `servers` was not empty.
    throw (firstLookupFailure || firstPinningFailure)?.error;
  };
}

export type NowFunction = () => number;

export default class ReverseDnsResolver {
  private lookup: ReverseDnsLookupFunction;
  /*
   * How an address whose first lookup failed is asked again, or undefined
   * for no retry pass. See the constructor for when each applies.
   */
  private retryLookup: ReverseDnsLookupFunction | undefined;
  private timeoutInMs: number;
  private concurrency: number;
  private failureBudget: number;
  /*
   * A budget the caller FIXED, or undefined to size one per pass from the
   * number of addresses (getReverseDnsTotalBudgetInMs). Per pass rather than
   * per instance because the address count is only known when a pass starts.
   */
  private fixedTotalBudgetInMs: number | undefined;
  private now: NowFunction;

  public constructor(options?: {
    lookup?: ReverseDnsLookupFunction | undefined;
    /*
     * The retry pass's lookup (OneUptime issue #3916). Omit BOTH lookups and
     * the probe's real resolvers are used for each: buildDefaultLookup for
     * the first pass and buildDefaultRetryLookup for the retry.
     *
     * Omit only this one — inject `lookup` alone — and there is NO retry
     * pass. Deliberately so, for two reasons. Defaulting to the real retry
     * lookup would send real queries from behind a seam the caller replaced
     * precisely so that none would be sent (ReverseDnsStubIntegrity.test.ts
     * treats an injected `lookup` as that guarantee). And re-running the
     * injected function is not a retry in the sense this pass means one — a
     * longer timeout, each server in turn — so a caller who wants the pass
     * says how it should ask by injecting this too.
     */
    retryLookup?: ReverseDnsLookupFunction | undefined;
    timeoutInMs?: number | undefined;
    concurrency?: number | undefined;
    failureBudget?: number | undefined;
    /*
     * Fixes the wall-clock budget for every pass. Omit it (or pass undefined)
     * to have each pass sized to its own address count — which is what the
     * probe does unless PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS is set.
     */
    totalBudgetInMs?: number | undefined;
    // Injectable so the wall-clock budget is testable without waiting on one.
    now?: NowFunction | undefined;
  }) {
    this.timeoutInMs =
      options?.timeoutInMs ?? DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS;
    this.lookup = options?.lookup ?? buildDefaultLookup(this.timeoutInMs);
    /*
     * Never a SHORTER wait than the first attempt had: a caller that set a
     * first-pass timeout above the retry's default would otherwise retry a
     * slow answer with less patience than it failed with.
     */
    this.retryLookup =
      options?.retryLookup ??
      (options?.lookup
        ? undefined
        : buildDefaultRetryLookup(
            Math.max(DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS, this.timeoutInMs),
          ));
    this.concurrency = Math.max(
      1,
      options?.concurrency ?? DEFAULT_REVERSE_DNS_CONCURRENCY,
    );
    this.failureBudget = Math.max(
      1,
      options?.failureBudget ?? DEFAULT_REVERSE_DNS_FAILURE_BUDGET,
    );
    /*
     * A budget that is not a finite number is no budget at all: NaN makes a
     * deadline no clock ever reaches, and Infinity is the same thing spelled
     * honestly. Either would let a pass that must stay bounded run for as long
     * as its addresses last, so both mean "size it automatically" instead.
     */
    this.fixedTotalBudgetInMs =
      options?.totalBudgetInMs === undefined ||
      !Number.isFinite(options.totalBudgetInMs)
        ? undefined
        : Math.max(1, options.totalBudgetInMs);
    this.now = options?.now ?? Date.now;
  }

  /*
   * The budget one pass over `addressCount` distinct addresses runs under.
   * Public so a caller can report the figure without re-deriving the rule.
   */
  public getTotalBudgetInMs(addressCount: number): number {
    if (this.fixedTotalBudgetInMs !== undefined) {
      return this.fixedTotalBudgetInMs;
    }

    return getReverseDnsTotalBudgetInMs({
      addressCount: addressCount,
      concurrency: this.concurrency,
      timeoutInMs: this.timeoutInMs,
    });
  }

  /**
   * Names for as many of these addresses as have usable PTR records — and,
   * for every address that did not get one, why not (OneUptime issue #3916).
   *
   * Never rejects. Reverse DNS is an enrichment on top of a sweep that has
   * already succeeded, so every failure mode here — a missing record, a
   * refused query, no resolver configured in the probe container at all —
   * resolves to "no name for that address" and leaves the sweep's result
   * exactly as it would have been before this existed.
   *
   * Two passes. The first asks every address once, in waves, under the
   * failure budget and the wall-clock budget. The second asks AGAIN only the
   * addresses whose first lookup failed — timed out, SERVFAIL, REFUSED, no
   * server listening — through the retry lookup, which waits longer and asks
   * each configured nameserver in turn. An address that answered, with a
   * name or with NXDOMAIN, is never asked twice.
   */
  public async resolveHostnames(
    ipAddresses: Array<string>,
  ): Promise<ReverseDnsResolution> {
    const hostnameByIpAddress: Map<string, string> = new Map<string, string>();

    /*
     * Why each address that has no name has none. Written on every path that
     * leaves an address unnamed and cleared the moment one names it, so this
     * and hostnameByIpAddress partition the addresses asked at every wave
     * boundary — not merely at the end — and a retry that names an address
     * cannot leave a stale failure code behind beside its name.
     */
    const statusByIpAddress: Map<string, DiscoveredHostReverseDnsStatus> =
      new Map<string, DiscoveredHostReverseDnsStatus>();

    /*
     * Addresses whose first lookup failed in a way a second could change.
     * Kept apart from the status map because a malformed-input rejection
     * also reads as Failed there, and must never be re-asked.
     */
    const retryableAddresses: Set<string> = new Set<string>();

    /*
     * De-duplicated, because a sweep can legitimately report the same address
     * twice (the SNMP path appends in completion order across two passes) and
     * paying for the same lookup twice is pure waste.
     */
    const uniqueAddresses: Array<string> = [...new Set<string>(ipAddresses)];

    const totalBudgetInMs: number = this.getTotalBudgetInMs(
      uniqueAddresses.length,
    );

    if (uniqueAddresses.length === 0) {
      return {
        hostnameByIpAddress: hostnameByIpAddress,
        statusByIpAddress: statusByIpAddress,
        failedAddressCount: 0,
        isReverseDnsAvailable: true,
        isTimeBudgetExhausted: false,
        lookedUpCount: 0,
        notLookedUpCount: 0,
        totalBudgetInMs: totalBudgetInMs,
      };
    }

    const deadline: number = this.now() + totalBudgetInMs;

    /*
     * Held on an object rather than in bare `let`s: these are written from
     * `this.concurrency` concurrent workers, and control-flow narrowing on a
     * plain local would erase assignments made inside the closure.
     */
    const state: {
      resolvedCount: number;
      /*
       * Distinct addresses whose lookup has been started. Advanced by whole
       * waves, before each wave is awaited, so a pass that stops at a wave
       * boundary has asked exactly this many.
       */
      lookedUpCount: number;
      /*
       * Lookups that came BACK, whether or not any answer survived
       * normalisation. This — not `resolvedCount` — is what disarms the
       * failure budget.
       *
       * The distinction is not academic. A resolver that answers every query
       * with a name that normalises away (a wildcard zone echoing
       * in-addr.arpa, a zone full of names with spaces in them) is a WORKING
       * resolver; counting only usable names would let a run of unusable
       * answers sit alongside a handful of unrelated timeouts and convict the
       * probe of having no resolver at all, skipping the addresses further
       * down the list that do have good names.
       *
       * The retry pass adds to this too: an answer on the second try proves
       * DNS works from here exactly as much as one on the first.
       */
      successfulLookupCount: number;
      /*
       * FIRST-PASS failures only, one per distinct address. The retry pass
       * never adds to it — see retryOne.
       */
      infrastructureFailureCount: number;
      failureReason?: string | undefined;
      isTimeBudgetExhausted: boolean;
      /*
       * True when the failure budget, rather than the end of the address
       * list, ended the first pass.
       */
      isStoppedAsUnusable: boolean;
      // Addresses the retry pass asked again, and how many of them answered.
      retriedCount: number;
      retryAnsweredCount: number;
    } = {
      resolvedCount: 0,
      lookedUpCount: 0,
      successfulLookupCount: 0,
      infrastructureFailureCount: 0,
      isTimeBudgetExhausted: false,
      isStoppedAsUnusable: false,
      retriedCount: 0,
      retryAnsweredCount: 0,
    };

    /*
     * The failure budget, asked only where the answer cannot be a lie: BETWEEN
     * waves, when every lookup started so far has settled.
     *
     * Two designs failed before this one, and both failures are worth keeping
     * written down because each looked correct.
     *
     * The first was a one-way latch set inside the failure branch. At the
     * shipped concurrency of 32, thirty-two lookups start together; if the
     * first ten to come back are infrastructure failures the latch flipped,
     * and it STAYED flipped as the other twenty-two returned perfectly good
     * names a moment later. A subnet whose first addresses sit in a reverse
     * zone delegated to a dead nameserver — the commonest way this happens —
     * was named entirely by IP.
     *
     * The second was this same predicate, asked fresh on every address so the
     * breaker could un-trip itself. That is worse, not better, and the reason
     * is scheduling rather than logic: when a worker pool sees the breaker
     * tripped, its workers return WITHOUT AWAITING ANYTHING, so the whole
     * remaining queue drains through the skip path in microtasks. A success
     * settling one macrotask later — that is to say, every real DNS answer —
     * always lost that race. Sixty-eight of a hundred addresses were skipped
     * and the pass then reported `isReverseDnsAvailable: true`, because by the
     * time anyone asked, the breaker had un-tripped. Silently skipping two
     * thirds of the work while reporting success is the worst of the three.
     *
     * So the decision is made where there is nothing in flight to race: at a
     * wave boundary, on fully-settled counters. Nothing un-trips because
     * nothing trips early.
     */
    const isReverseDnsUnusable: () => boolean = (): boolean => {
      return (
        state.successfulLookupCount === 0 &&
        state.infrastructureFailureCount >= this.failureBudget
      );
    };

    /*
     * A lookup that came BACK, on either pass: name the address after its
     * first usable answer, or record why it has none.
     */
    const recordAnswers: (ipAddress: string, answers: unknown) => void = (
      ipAddress: string,
      answers: unknown,
    ): void => {
      /*
       * Defended rather than assumed. `for...of` over a non-iterable throws,
       * and that throw would land in the caller's catch and be counted as an
       * INFRASTRUCTURE failure — so a lookup that returned null would not
       * merely fail to name one host, it would spend the budget. A lookup
       * that answers with something that is not a list of names has told us
       * there is no name here, and nothing more.
       */
      const usableAnswers: Array<unknown> = Array.isArray(answers)
        ? answers
        : [];

      /*
       * FIRST usable answer wins. An address with several PTR records is
       * unusual but legal, and the alternative — refusing to name a host
       * whose owner published two names for it — is worse than picking one
       * deterministically. Answers that normalise away (an in-addr.arpa
       * echo, a name with a space in it) are skipped rather than ending the
       * search, so a junk first record cannot hide a good second one.
       */
      for (const answer of usableAnswers) {
        const name: string | undefined = normalizeReverseDnsName(answer);

        if (name) {
          hostnameByIpAddress.set(ipAddress, name);
          statusByIpAddress.delete(ipAddress);
          state.resolvedCount++;
          return;
        }
      }

      /*
       * An empty list is the resolver saying "no record" by other means; a
       * list whose every entry was refused is a record the naming rules
       * would not use, which is a different thing to tell an operator who
       * can see the PTR record with dig.
       */
      statusByIpAddress.set(
        ipAddress,
        usableAnswers.length > 0
          ? DiscoveredHostReverseDnsStatus.UnusableName
          : DiscoveredHostReverseDnsStatus.NoRecord,
      );
    };

    /*
     * One address, start to finish. NEVER rejects: every outcome is recorded
     * on `state` and the caller awaits a wave of these with Promise.all, which
     * would abandon the whole wave on a single rejection.
     */
    const lookupOne: (ipAddress: string) => Promise<void> = async (
      ipAddress: string,
    ): Promise<void> => {
      try {
        const answers: unknown = await this.lookup(ipAddress);

        /*
         * The lookup RETURNED, so the resolver is alive. Counted before the
         * answers are inspected, because whether any of them survives
         * normalisation says nothing about whether DNS works here.
         */
        state.successfulLookupCount++;

        recordAnswers(ipAddress, answers);
      } catch (err) {
        const classification: ReverseDnsLookupErrorClassification =
          classifyReverseDnsLookupError(err);

        statusByIpAddress.set(ipAddress, classification.status);

        if (classification.kind !== "failure") {
          /*
           * The ordinary "this address has no PTR record" — or an address
           * that could not be asked about at all. Neither is a failure of
           * the resolver, and the first is, just as importantly, a SUCCESS
           * for the budget's purposes.
           *
           * NXDOMAIN is an answer. A resolver that returns it is reachable,
           * configured and working; the only thing it has told us is that this
           * particular address has no name. Counting it as neither would leave
           * a sparse subnet — five addresses with no record and a handful of
           * unrelated timeouts — looking exactly like a probe with no resolver
           * at all, and the budget would skip every remaining host on the
           * strength of it.
           */
          state.successfulLookupCount++;
          return;
        }

        retryableAddresses.add(ipAddress);
        state.infrastructureFailureCount++;
        state.failureReason = state.failureReason || describeError(err);
      }
    };

    /*
     * One address, asked again. NEVER rejects, for the reason lookupOne
     * does not.
     *
     * A retry that fails again is NOT counted against the failure budget.
     * The budget is a count of distinct addresses that got no answer, and
     * this address was already counted when its first lookup failed;
     * counting it twice would let forty hosts behind a flaky forwarder spend
     * a budget of sixty-four and convict a working probe of having no DNS.
     * Its status is updated from the retry — "timed out, then SERVFAIL" is
     * reported as SERVFAIL, the most recent thing the server said — while
     * failureReason keeps the first failure the pass saw.
     */
    const retryOne: (
      ipAddress: string,
      retryLookup: ReverseDnsLookupFunction,
    ) => Promise<void> = async (
      ipAddress: string,
      retryLookup: ReverseDnsLookupFunction,
    ): Promise<void> => {
      try {
        const answers: unknown = await retryLookup(ipAddress);

        state.successfulLookupCount++;
        state.retryAnsweredCount++;

        recordAnswers(ipAddress, answers);
      } catch (err) {
        const classification: ReverseDnsLookupErrorClassification =
          classifyReverseDnsLookupError(err);

        statusByIpAddress.set(ipAddress, classification.status);

        if (classification.kind !== "failure") {
          /*
           * An answer at last — most often NXDOMAIN from a server that timed
           * out the first time, which is now correctly "no record".
           */
          state.successfulLookupCount++;
          state.retryAnsweredCount++;
          return;
        }

        state.failureReason = state.failureReason || describeError(err);
      }
    };

    /*
     * WAVES, not a work-stealing pool.
     *
     * A pool would finish a mixed batch marginally sooner, and it is what this
     * used to be. It is given up because the breaker has to be evaluated
     * somewhere, and inside a pool there is no moment at which the counters
     * are complete — see the note on isReverseDnsUnusable above, where asking
     * mid-flight silently skipped two thirds of a sweep and reported success.
     *
     * At a wave boundary every lookup that has started has finished, so the
     * counters mean exactly what they say. The cost is that a wave takes as
     * long as its slowest address, which is bounded by the per-address budget
     * (2s) — and DNS is the one protocol where that variance is small, because
     * an address either answers in milliseconds or times out.
     */
    for (
      let start: number = 0;
      start < uniqueAddresses.length;
      start += this.concurrency
    ) {
      /*
       * Checked before STARTING a wave, never in the middle of one: lookups
       * already in flight are bounded by their own timeout, and abandoning
       * their results would waste queries already on the wire. The pass
       * therefore overruns its budget by at most one wave.
       */
      if (this.now() >= deadline) {
        state.isTimeBudgetExhausted = true;
        logger.warn(
          `Discovery reverse DNS lookups exceeded their ${totalBudgetInMs}ms budget after naming ${state.resolvedCount} host(s); ${uniqueAddresses.length - state.lookedUpCount} of ${uniqueAddresses.length} discovered address(es) were never looked up and will be named by IP address. The sweep itself is unaffected; set PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer.`,
        );
        break;
      }

      if (isReverseDnsUnusable()) {
        state.isStoppedAsUnusable = true;
        logger.warn(
          `Discovery reverse DNS lookups are not usable from this probe: ${state.infrastructureFailureCount} address(es) of ${uniqueAddresses.length} failed to resolve and not one answered, so the rest were skipped and those hosts will be named by IP address. Reverse DNS is best-effort and this does not fail the scan. Resolver reported: ${state.failureReason || "unknown error"}`,
        );
        break;
      }

      const wave: Array<string> = uniqueAddresses.slice(
        start,
        start + this.concurrency,
      );

      state.lookedUpCount += wave.length;

      await Promise.all(
        wave.map((ipAddress: string) => {
          return lookupOne(ipAddress);
        }),
      );
    }

    /*
     * The addresses the first pass never reached, and which of its two
     * limits stopped it. Exactly one of the two flags is set whenever any
     * address is left, because those two `break`s are the only way out of
     * the loop before the end of the list.
     */
    const skippedStatus: DiscoveredHostReverseDnsStatus =
      state.isTimeBudgetExhausted
        ? DiscoveredHostReverseDnsStatus.SkippedTimeBudget
        : DiscoveredHostReverseDnsStatus.SkippedNoResolver;

    for (const ipAddress of uniqueAddresses.slice(state.lookedUpCount)) {
      statusByIpAddress.set(ipAddress, skippedStatus);
    }

    /*
     * THE RETRY PASS (OneUptime issue #3916).
     *
     * Before it existed the probe asked each address exactly once, gave up
     * at two seconds and never asked again, so one dropped datagram, one
     * answer that took 2.1 seconds, or a primary nameserver that was down or
     * answering SERVFAIL left the host named by its address — and, because
     * reverse() reported all of those as "no record", nothing anywhere said
     * the lookup had failed at all. Real c-ares against a loopback server
     * reproduces the customer's "four of twelve" from any one of them.
     *
     * Its rules, each of which is pinned by a test:
     *
     * - Only addresses whose first lookup FAILED. NXDOMAIN and NODATA are
     *   answers, and a malformed address is malformed twice.
     * - Not at all when the failure budget STOPPED the first pass: every
     *   lookup the probe made failed and it skipped the rest, and asking the
     *   same dead resolver again — each server in turn, at twice the
     *   timeout — would spend up to a quarter of a minute per wave learning
     *   nothing. When the budget's verdict merely lands on the final wave,
     *   nothing was skipped and the retry DOES run: a small sweep behind a
     *   dead primary nameserver is exactly the case it exists for, and an
     *   answer on the retry disarms that verdict.
     * - Not when the WALL CLOCK stopped the first pass. The deadline has
     *   passed, and the pass has already said so.
     * - In waves of the same width, each started only while the SAME
     *   deadline has not passed. The budget is not raised for it (the reaper
     *   arithmetic in Tests/ConfigDiscoveryNamingBudget.test.ts depends on
     *   that), so a pass that spent its budget on the first attempts simply
     *   retries less. Addresses it does not reach keep their first-pass
     *   status; they WERE looked up, so notLookedUpCount and
     *   isTimeBudgetExhausted are untouched. A retry wave can run longer
     *   than a first-pass one — up to MAX_REVERSE_DNS_RETRY_LOOKUP_IN_MS —
     *   so that, not two seconds, is the most a pass now overruns by.
     */
    const retryLookup: ReverseDnsLookupFunction | undefined = this.retryLookup;

    if (
      retryLookup &&
      !state.isTimeBudgetExhausted &&
      !state.isStoppedAsUnusable
    ) {
      const retryAddresses: Array<string> = uniqueAddresses.filter(
        (ipAddress: string): boolean => {
          return retryableAddresses.has(ipAddress);
        },
      );

      for (
        let start: number = 0;
        start < retryAddresses.length;
        start += this.concurrency
      ) {
        if (this.now() >= deadline) {
          logger.warn(
            `Discovery reverse DNS ran out of its ${totalBudgetInMs}ms budget while retrying failed lookups: ${retryAddresses.length - state.retriedCount} of ${retryAddresses.length} address(es) whose first lookup failed were not asked again and keep that first result. The sweep itself is unaffected; set PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer.`,
          );
          break;
        }

        const wave: Array<string> = retryAddresses.slice(
          start,
          start + this.concurrency,
        );

        state.retriedCount += wave.length;

        await Promise.all(
          wave.map((ipAddress: string) => {
            return retryOne(ipAddress, retryLookup);
          }),
        );
      }
    }

    let failedAddressCount: number = 0;

    for (const status of statusByIpAddress.values()) {
      if (FAILED_LOOKUP_STATUSES.has(status)) {
        failedAddressCount++;
      }
    }

    if (state.retriedCount > 0) {
      logger.debug(
        `Discovery reverse DNS retried ${state.retriedCount} address(es) whose first lookup failed; ${state.retryAnsweredCount} answered on the retry and ${failedAddressCount} address(es) are still without an answer.`,
      );
    }

    return {
      hostnameByIpAddress: hostnameByIpAddress,
      statusByIpAddress: statusByIpAddress,
      failedAddressCount: failedAddressCount,
      isReverseDnsAvailable: !isReverseDnsUnusable(),
      isTimeBudgetExhausted: state.isTimeBudgetExhausted,
      lookedUpCount: state.lookedUpCount,
      notLookedUpCount: uniqueAddresses.length - state.lookedUpCount,
      totalBudgetInMs: totalBudgetInMs,
      failureReason: state.failureReason,
    };
  }
}
