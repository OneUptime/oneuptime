import { normalizeReverseDnsName } from "Common/Utils/NetworkDiscovery/ReverseDnsNameUtil";
import { isNetbiosQueryableIPv4Address } from "Common/Utils/NetworkDiscovery/NetbiosNameUtil";
import { DiscoveredHostReverseDnsStatus } from "Common/Types/NetworkDevice/DiscoveredHostNamingStatus";
import logger from "Common/Server/Utils/Logger";
import dns from "dns";
import fs from "fs";
import net from "net";
import path from "path";

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
 * is skipped — and only while NOT ONE lookup has come back and no DNS server
 * has responded at all: NXDOMAIN, SERVFAIL and REFUSED each disarm it (#3916).
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
 *
 * "Nothing at all" is meant literally (#3916). A recursive resolver in front
 * of a dead or DNSSEC-bogus zone usually says so, quickly, with SERVFAIL —
 * and a SERVFAIL, like a REFUSED, is the probe's DNS server RESPONDING. Those
 * are still failed lookups, retried and reported, but they prove the probe
 * can reach its resolver, so they disarm this budget exactly as NXDOMAIN
 * does; only silence (timeouts, nothing listening, errors nobody recognises)
 * can spend it. Counting them once let the first sixty-four hosts of a sweep,
 * all in one SERVFAILing zone, skip every healthy zone behind them.
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
 * by. The breaker rescue's canaries (see rescueFromBreaker) are asked
 * CONCURRENTLY, so they too cost one retry lookup, not three, and the
 * deadline is read again before anything starts after them. The hosts file
 * is read once per pass and sends nothing. Exported so the reaper
 * arithmetic that adds "one wave in flight" can quote the real figure.
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
 * UnusableName are answers; the Skipped* codes were never asked. Exported so
 * SubnetScanner narrows the status message's failure count by these SAME
 * five codes rather than by a hand-kept copy that could drift (OneUptime
 * issue #3916).
 */
export const FAILED_LOOKUP_STATUSES: ReadonlySet<DiscoveredHostReverseDnsStatus> =
  new Set<DiscoveredHostReverseDnsStatus>([
    DiscoveredHostReverseDnsStatus.Timeout,
    DiscoveredHostReverseDnsStatus.ServerFailure,
    DiscoveredHostReverseDnsStatus.Refused,
    DiscoveredHostReverseDnsStatus.Unreachable,
    DiscoveredHostReverseDnsStatus.Failed,
  ]);

/*
 * How one rejected lookup is read, on two independent axes.
 *
 * `kind` — what it means for the ADDRESS:
 *
 * - "no-record": the DNS server answered that this address has no name.
 *   Final for the first pass; see buildDefaultRetryLookup and
 *   buildDefaultRescueLookup for when a walk's "no record" is.
 * - "malformed-input": the address could not be asked about. Counted like a
 *   lookup that came back (see MALFORMED_INPUT_ERROR_CODES), never retried.
 * - "failure": no answer about the address was obtained. What the retry pass
 *   re-asks, and what failedAddressCount counts.
 *
 * `isServerResponse` — whether a DNS server RESPONDED at all (#3916), which
 * is the only thing the failure budget needs to know about the probe's DNS.
 * The table, code by code:
 *
 *   code                          kind             status         response
 *   ENOTFOUND ENODATA (+ bare)    no-record        NoRecord       yes
 *   ESERVFAIL                     failure          ServerFailure  yes
 *   EREFUSED                      failure          Refused        yes
 *   ENOTIMP EFORMERR              failure          Failed         yes
 *   ETIMEOUT (c-ares or the race) failure          Timeout        no
 *   ECONNREFUSED                  failure          Unreachable    no
 *   EINVAL EBADNAME EBADSTR       malformed-input  Failed         no
 *   anything else, or no code     failure          Failed         no
 *
 * A responded failure is still a failure — reported, retried and counted —
 * but it disarms the failure budget exactly as NXDOMAIN does: a server that
 * says SERVFAIL is a server the probe can reach. Silence alone convicts.
 */
export type ReverseDnsLookupErrorKind =
  | "no-record"
  | "malformed-input"
  | "failure";

export interface ReverseDnsLookupErrorClassification {
  kind: ReverseDnsLookupErrorKind;
  status: DiscoveredHostReverseDnsStatus;
  // A DNS server sent a response, whatever its code. See the table above.
  isServerResponse: boolean;
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
      isServerResponse: true,
    };
  }

  if (MALFORMED_INPUT_ERROR_CODES.has(code)) {
    /*
     * Not a response: c-ares refused the argument before a packet was
     * built. It still counts as a lookup that came back, through its kind.
     */
    return {
      kind: "malformed-input",
      status: DiscoveredHostReverseDnsStatus.Failed,
      isServerResponse: false,
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
        isServerResponse: false,
      };
    case "ESERVFAIL":
      return {
        kind: "failure",
        status: DiscoveredHostReverseDnsStatus.ServerFailure,
        isServerResponse: true,
      };
    case "EREFUSED":
      return {
        kind: "failure",
        status: DiscoveredHostReverseDnsStatus.Refused,
        isServerResponse: true,
      };
    /*
     * The server's own NOTIMP and FORMERR response codes. Rare, and nothing
     * the dashboard explains specifically, so the generic status — but a
     * server sent them, and that is what the budget reads.
     */
    case "ENOTIMP":
    case "EFORMERR":
      return {
        kind: "failure",
        status: DiscoveredHostReverseDnsStatus.Failed,
        isServerResponse: true,
      };
    /*
     * "Could not contact DNS servers": c-ares' reading of an ICMP port
     * unreachable, which is what a resolv.conf naming a host with nothing
     * listening on port 53 produces. Nothing answered.
     */
    case "ECONNREFUSED":
      return {
        kind: "failure",
        status: DiscoveredHostReverseDnsStatus.Unreachable,
        isServerResponse: false,
      };
    /*
     * Everything else — EBADRESP, ECANCELLED, a code-less Error, a thrown
     * string — is still evidence the probe could not get an answer, which is
     * what the failure budget is for. The unrecognised case must default to
     * COUNTING, as silence, or the budget would be unreachable exactly when
     * a resolver fails in a way nobody anticipated.
     */
    default:
      return {
        kind: "failure",
        status: DiscoveredHostReverseDnsStatus.Failed,
        isServerResponse: false,
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
   * skipped: not one lookup came back and no DNS server responded at all —
   * not with NXDOMAIN, not even with SERVFAIL or REFUSED — so this probe
   * cannot resolve at all. No names will have been found from DNS, by
   * construction (the hosts file may still have named some).
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
 * The five methods are the five the lookups use, and each is a method of
 * dns.promises.Resolver with this signature, so the real class is its own
 * implementation: resolvePtr for an IPv4 address, reverse for anything else,
 * getServers/setServers for the retry's one-server-at-a-time walk (OneUptime
 * issue #3916), and cancel for the race. None of them is used for the hosts
 * file, which is read directly (buildSystemHostsFileLookup).
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
 * ONE query, and only DNS. The hosts file that reverse() used to read first
 * is read by the pass itself, before any lookup is made (see
 * buildSystemHostsFileLookup). It used to be read here, by a second
 * reverse() after an NXDOMAIN — and reverse() asks DNS again after the file,
 * so on a server slow enough to answer the first query at 1.1 seconds, the
 * second one lost the two-second race and a "no record" that had ARRIVED in
 * time was reported as a timeout; and a device listed in the file whose PTR
 * lookup failed outright was never named from it at all.
 */
async function lookupOnResolver(data: {
  resolver: ReverseDnsResolverLike;
  ipAddress: string;
  raceTimeoutInMs: number;
}): Promise<Array<string>> {
  const resolver: ReverseDnsResolverLike = data.resolver;
  const ipAddress: string = data.ipAddress;

  /*
   * Async, so a resolver method that throws synchronously rejects the
   * attempt like any other failure instead of escaping the race.
   */
  const attempt: () => Promise<Array<string>> = async (): Promise<
    Array<string>
  > => {
    const reverseLookupName: string | undefined =
      toReverseLookupName(ipAddress);

    if (reverseLookupName === undefined) {
      return await resolver.reverse(ipAddress);
    }

    return await resolver.resolvePtr(reverseLookupName);
  };

  const lookup: Promise<Array<string>> = attempt();

  let timer: ReturnType<typeof setTimeout> | undefined = undefined;

  const timeout: Promise<never> = new Promise<never>(
    (_resolve: (value: never) => void, reject: (reason: Error) => void) => {
      timer = setTimeout(() => {
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
 * The first pass's lookup: one query per address to the probe's PRIMARY
 * nameserver, raced at exactly `timeoutInMs`.
 *
 * Deliberately unchanged in its budget. The race still equals the c-ares
 * timeout, so the first attempt of a healthy address is exactly as fast as
 * it always was; anything the primary cannot answer in that time is the
 * retry pass's job, done explicitly.
 *
 * The primary ONLY (#3916), pinned when more than one server is configured.
 * c-ares waits out a silent server before moving on — which the race always
 * ends first — but on a CONNECTION error it moves to the next server at
 * once. The Helm chart's pod DNS is [cluster DNS, 8.8.8.8, 1.1.1.1], and a
 * cluster DNS service with no ready endpoints is refused outright: every
 * first-pass lookup then fell through to a public resolver, whose NXDOMAIN
 * for a private address came back as a final "no PTR record" for every host.
 * Pinned, a first-pass "no record" is always the primary's own word, and a
 * primary that refuses is reported as unreachable and goes to the retry
 * walk, where another server may still name the address but only the
 * primary may say it has none. A resolver that will not be pinned is asked
 * as it is configured.
 */
export function buildDefaultLookup(
  timeoutInMs: number,
  createResolver: ReverseDnsResolverFactory = defaultResolverFactory,
): ReverseDnsLookupFunction {
  return async (ipAddress: string): Promise<Array<string>> => {
    const resolver: ReverseDnsResolverLike = createResolver(timeoutInMs);

    if (toReverseLookupName(ipAddress) !== undefined) {
      const servers: Array<string> = readConfiguredServers(resolver);

      if (servers.length > 1) {
        try {
          resolver.setServers([servers[0]!]);
        } catch {
          // Not a spelling it takes back; ask as configured.
        }
      }
    }

    return await lookupOnResolver({
      resolver: resolver,
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

/*
 * How one walk over the configured nameservers is ordered and when it may
 * stop, for the two lookups below that walk them (OneUptime issue #3916).
 */
interface ReverseDnsServerWalkPolicy {
  /*
   * The order to ask the configured servers in. `primary` is the first
   * configured server the resolver can be pinned to.
   */
  orderServers: (
    configuredServers: Array<string>,
    primary: string | undefined,
  ) => Array<string>;
  // Whether a "no record" (NXDOMAIN/NODATA) from `server` ends the walk.
  isNoRecordFinal: (server: string, primary: string | undefined) => boolean;
  // Told when `server` answered `ipAddress` with PTR records.
  onNamed?: ((server: string, ipAddress: string) => void) | undefined;
}

/*
 * Each configured nameserver explicitly, one at a time, with a longer
 * timeout — the shared walk behind buildDefaultRetryLookup and
 * buildDefaultRescueLookup.
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
 * What every walk does, whatever its policy:
 *
 * - At most MAX_REVERSE_DNS_RETRY_SERVERS servers, each asked once.
 * - Stopping at the first NAME, from whichever server gives one.
 * - Stopping at a "no record" only when the policy trusts that server's word
 *   on it; anyone else's is noted and the walk goes on.
 * - Stopping at a malformed-input rejection; no server can fix the argument.
 * - When the walk ends with no name and no trusted "no record", rejecting
 *   with the error of the first server in CONFIGURED order that failed,
 *   whichever was asked first: the primary's failure is the one that
 *   describes the probe's normal path, and a public resolver's NXDOMAIN
 *   says nothing about the address.
 *
 * With no servers to read, one attempt on a default resolver. A value that is
 * not an IPv4 address gets one reverse() attempt with the walk's timeout and
 * no walk: reverse() has no per-server form worth the complexity, and the
 * sweep never produces one.
 */
function buildServerWalkLookup(data: {
  timeoutInMs: number;
  createResolver: ReverseDnsResolverFactory;
  policy: ReverseDnsServerWalkPolicy;
}): ReverseDnsLookupFunction {
  const timeoutInMs: number = data.timeoutInMs;
  const createResolver: ReverseDnsResolverFactory = data.createResolver;
  const policy: ReverseDnsServerWalkPolicy = data.policy;
  const raceTimeoutInMs: number =
    timeoutInMs + REVERSE_DNS_RETRY_RACE_SLACK_IN_MS;

  /*
   * Servers the resolver refused to be pinned to. A refused spelling is
   * refused every time, so such a server is never the primary: the next
   * configured one is, or its "no record" could never be final.
   */
  const unpinnableServers: Set<string> = new Set<string>();

  return async (ipAddress: string): Promise<Array<string>> => {
    /*
     * Fresh, and used for the attempt itself whenever there is no server to
     * pin: reading the configuration costs no query.
     */
    const configuredResolver: ReverseDnsResolverLike =
      createResolver(timeoutInMs);

    const configuredServers: Array<string> =
      toReverseLookupName(ipAddress) === undefined
        ? []
        : readConfiguredServers(configuredResolver).slice(
            0,
            MAX_REVERSE_DNS_RETRY_SERVERS,
          );

    if (configuredServers.length === 0) {
      return await lookupOnResolver({
        resolver: configuredResolver,
        ipAddress: ipAddress,
        raceTimeoutInMs: raceTimeoutInMs,
      });
    }

    const primaryOf: () => string | undefined = (): string | undefined => {
      return configuredServers.find((configured: string): boolean => {
        return !unpinnableServers.has(configured);
      });
    };

    // The ORDER is fixed when the walk starts; see the policies.
    const servers: Array<string> = policy.orderServers(
      configuredServers,
      primaryOf(),
    );

    /*
     * Boxed, so that a thrown `undefined` still counts as "a failure was
     * seen". A lookup's failure is preferred over a server the resolver
     * refused to be pinned to: the first describes DNS, the second only a
     * spelling. Kept per server, because a walk may ask the primary last
     * while the error reported is still the PRIMARY's.
     */
    const lookupFailureByServer: Map<string, { error: unknown }> = new Map<
      string,
      { error: unknown }
    >();
    let firstPinningFailure: { error: unknown } | undefined = undefined;
    // An untrusted "no record": what is left if nothing else was seen.
    let firstNoRecord: ReverseDnsWalkNoRecord | undefined = undefined;

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
        unpinnableServers.add(server);
        firstPinningFailure = firstPinningFailure || { error: err };
        continue;
      }

      let answers: Array<string>;

      try {
        answers = await lookupOnResolver({
          resolver: resolver,
          ipAddress: ipAddress,
          raceTimeoutInMs: raceTimeoutInMs,
        });
      } catch (err) {
        const classification: ReverseDnsLookupErrorClassification =
          classifyReverseDnsLookupError(err);

        if (classification.kind === "malformed-input") {
          throw err;
        }

        if (classification.kind === "no-record") {
          if (policy.isNoRecordFinal(server, primaryOf())) {
            throw err;
          }

          firstNoRecord = firstNoRecord || { isRejection: true, error: err };
          continue;
        }

        lookupFailureByServer.set(server, { error: err });
        continue;
      }

      if (Array.isArray(answers) && answers.length > 0) {
        policy.onNamed?.(server, ipAddress);
        return answers;
      }

      /*
       * An empty list is "no record" said without rejecting — resolvePtr
       * never does it, a scripted resolver can — and is trusted exactly as
       * NXDOMAIN is.
       */
      if (policy.isNoRecordFinal(server, primaryOf())) {
        return answers;
      }

      firstNoRecord = firstNoRecord || {
        isRejection: false,
        answers: answers,
      };
    }

    // No name, and no "no record" from a server trusted to say so.
    const firstLookupFailure: { error: unknown } | undefined = configuredServers
      .map((server: string): { error: unknown } | undefined => {
        return lookupFailureByServer.get(server);
      })
      .find((failure: { error: unknown } | undefined): boolean => {
        return failure !== undefined;
      });

    const failure: { error: unknown } | undefined =
      firstLookupFailure || firstPinningFailure;

    /*
     * Only a walk that saw no failure at all ends on an untrusted "no
     * record" — in practice unreachable, since the primary is always asked
     * and its own "no record" is trusted — and then that is what it says.
     */
    if (failure || !firstNoRecord) {
      throw failure?.error;
    }

    if (firstNoRecord.isRejection) {
      throw firstNoRecord.error;
    }

    return firstNoRecord.answers;
  };
}

/**
 * The retry pass's lookup (OneUptime issue #3916): for an address whose
 * first lookup FAILED, ask each configured nameserver in turn, in CONFIGURED
 * order, with a longer timeout — see buildServerWalkLookup for the walk.
 *
 * Configured order because the primary is the server the probe normally
 * uses, and a longer timeout alone is what rescues a slow answer or one
 * dropped datagram from it.
 *
 * A "no record" ends the walk only from the PRIMARY. Nobody else's is
 * trusted, because the defaults make that wrong: the Helm chart gives the
 * probe pod [CoreDNS, 8.8.8.8, 1.1.1.1], and a public resolver answers
 * NXDOMAIN for every private address (RFC 6303). Taking that as final after
 * the primary SERVFAILed or timed out filed a failed lookup as "no PTR
 * record" and told the operator nothing had failed — the exact symptom this
 * issue is about. So after a failing primary, a later server can still NAME
 * the address, but if none does the address keeps the primary's failure,
 * which is the truth: the probe's own DNS server did not answer for it.
 *
 * STATELESS: every walk is independent of every other, so what an address is
 * called never depends on which address happened to be asked before it. The
 * one situation that warrants learning across walks — a primary that has
 * answered nothing at all — is handled only by the breaker rescue, with its
 * own lookup (buildDefaultRescueLookup).
 */
export function buildDefaultRetryLookup(
  timeoutInMs: number = DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
  createResolver: ReverseDnsResolverFactory = defaultResolverFactory,
): ReverseDnsLookupFunction {
  return buildServerWalkLookup({
    timeoutInMs: timeoutInMs,
    createResolver: createResolver,
    policy: {
      orderServers: (configuredServers: Array<string>): Array<string> => {
        return configuredServers;
      },
      isNoRecordFinal: (
        server: string,
        primary: string | undefined,
      ): boolean => {
        return server === primary;
      },
    },
  });
}

/**
 * The breaker rescue's lookup (OneUptime issue #3916), used only once the
 * first pass has met sixty-four or more lookups with SILENCE and not one
 * response — the evidence that the primary nameserver is down, not merely
 * slow or unhappy about one zone. See rescueFromBreaker.
 *
 * It walks the servers like the retry does (buildServerWalkLookup), with two
 * differences that only that evidence justifies:
 *
 * - The primary goes LAST unless it has named something this pass: asking a
 *   server that has just been silent sixty-four times first, for every
 *   address, would charge each walk its whole timeout before anyone who
 *   answers is asked. Servers that HAVE named something this pass go first.
 * - A "no record" is trusted from the primary, as always, and from a server
 *   that has NAMED something this pass. A name for a private address is what
 *   a public resolver never gives, so it is what shows a server holds the
 *   reverse zones and can speak for the addresses it has no record of.
 *
 * The record of which servers have named something is kept per lookup
 * function; the resolver builds one per pass, so nothing carries over.
 */
export function buildDefaultRescueLookup(
  timeoutInMs: number = DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
  createResolver: ReverseDnsResolverFactory = defaultResolverFactory,
): ReverseDnsLookupFunction {
  const namingServers: Set<string> = new Set<string>();

  return buildServerWalkLookup({
    timeoutInMs: timeoutInMs,
    createResolver: createResolver,
    policy: {
      orderServers: (
        configuredServers: Array<string>,
        primary: string | undefined,
      ): Array<string> => {
        const isNaming: (server: string) => boolean = (
          server: string,
        ): boolean => {
          return namingServers.has(server);
        };

        return [
          ...configuredServers.filter(isNaming),
          ...configuredServers.filter((server: string): boolean => {
            return !isNaming(server) && server !== primary;
          }),
          ...configuredServers.filter((server: string): boolean => {
            return !isNaming(server) && server === primary;
          }),
        ];
      },
      isNoRecordFinal: (
        server: string,
        primary: string | undefined,
      ): boolean => {
        return server === primary || namingServers.has(server);
      },
      onNamed: (server: string, ipAddress: string): void => {
        /*
         * Only a name for a PRIVATE address earns the trust: those are the
         * reverse zones a public resolver answers locally with NXDOMAIN (RFC
         * 6303), so naming one shows the server holds the probe's internal
         * zones. A public resolver naming a public address in the same sweep
         * shows nothing of the kind, and trusting it would file every private
         * host behind a dead primary as "no PTR record".
         */
        if (!isNetbiosQueryableIPv4Address(ipAddress)) {
          return;
        }

        namingServers.add(server);
      },
    },
  });
}

type ReverseDnsWalkNoRecord =
  | { isRejection: true; error: unknown }
  | { isRejection: false; answers: Array<string> };

/*
 * THE HOSTS FILE (OneUptime issue #3916).
 *
 * Before #3916 the probe asked every address with Resolver#reverse, and
 * c-ares reads the hosts file for that call BEFORE it asks DNS — so a device
 * an operator listed in the probe host's /etc/hosts was named from there,
 * whatever DNS did. The bundled probes run with host networking, where that
 * file is the host's own, and an air-gapped probe may have nothing else.
 * resolvePtr, which the probe now asks instead, never reads it.
 *
 * So the pass reads it itself, FIRST, for every address, and an address the
 * file names is never asked of DNS at all. That restores the old precedence
 * exactly, keeps those names when DNS is down, refusing or slow (they used to
 * be lost whenever the PTR lookup failed), costs no query, and names a line
 * with ONE name — "10.16.42.55 kds05" — which reverse() never did: Node's
 * reverse() returns only a line's aliases.
 *
 * The answer: an address's names, canonical name first, or undefined for an
 * address the file does not list. Injectable so tests never read the
 * machine's file.
 */
export type HostsFileLookup = (ipAddress: string) => Array<string> | undefined;

// Reads a whole file as text; throws when it cannot. Injectable for tests.
export type HostsFileReader = (filePath: string) => string;

/*
 * Where the operating system keeps it. c-ares reads the same file: the
 * Windows path is what it reads there, and a probe run natively on Windows
 * should not lose names reverse() used to find.
 */
export const SYSTEM_HOSTS_FILE_PATH: string =
  process.platform === "win32"
    ? path.join(
        process.env["SystemRoot"] || "C:\\Windows",
        "System32",
        "drivers",
        "etc",
        "hosts",
      )
    : "/etc/hosts";

/**
 * The IPv4 entries of a hosts file, keyed by address: each address's names
 * in the order the line lists them — the canonical name, then its aliases.
 *
 * Deliberately narrow, and pure so every rule is pinned directly:
 *
 * - A `#` starts a comment, anywhere on a line.
 * - Fields are separated by any whitespace.
 * - The first field must be exactly a dotted-quad IPv4 address (net.isIPv4:
 *   no leading zeros, no CIDR, no port). IPv6 lines are skipped — the sweep
 *   only finds IPv4 hosts — and so is anything that merely looks like an
 *   address; nothing is repaired.
 * - A line with an address and no name says nothing, and is skipped.
 * - The FIRST line for an address wins, as it does for the system resolver;
 *   a later line for the same address adds nothing.
 *
 * The names are returned as written; the pass normalises them exactly as it
 * normalises a PTR answer, and falls through to DNS when none survives.
 */
export function parseHostsFile(contents: string): Map<string, Array<string>> {
  const namesByAddress: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();

  if (typeof contents !== "string") {
    return namesByAddress;
  }

  for (const line of contents.split("\n")) {
    const fields: Array<string> = line
      .replace(/#.*/, "")
      .trim()
      .split(/\s+/)
      .filter((field: string): boolean => {
        return field.length > 0;
      });

    if (fields.length < 2) {
      continue;
    }

    const ipAddress: string = fields[0]!;

    if (!net.isIPv4(ipAddress) || namesByAddress.has(ipAddress)) {
      continue;
    }

    namesByAddress.set(ipAddress, fields.slice(1));
  }

  return namesByAddress;
}

const readFileAsText: HostsFileReader = (filePath: string): string => {
  return fs.readFileSync(filePath, "utf8");
};

/**
 * A HostsFileLookup over the probe host's hosts file.
 *
 * LAZY, and read ONCE. Nothing is read until the first address is looked
 * up, so building a resolver — which every caller of the pass does, some
 * only to read its budget — touches no file; and the parsed file is then
 * kept for every later address. The resolver builds one of these per
 * instance and SubnetScanner builds one instance per pass, so it is read at
 * most once a pass, and an edit to the file is seen by the next scan.
 *
 * NEVER throws. A file that is missing, unreadable or not text is a file
 * with no entries: the hosts file is a nicety on top of DNS, and a pass must
 * not fail over it.
 */
export function buildSystemHostsFileLookup(
  filePath: string = SYSTEM_HOSTS_FILE_PATH,
  readFile: HostsFileReader = readFileAsText,
): HostsFileLookup {
  const cache: { namesByAddress: Map<string, Array<string>> | undefined } = {
    namesByAddress: undefined,
  };

  return (ipAddress: string): Array<string> | undefined => {
    if (cache.namesByAddress === undefined) {
      let contents: unknown = "";

      try {
        contents = readFile(filePath);
      } catch {
        contents = "";
      }

      cache.namesByAddress = parseHostsFile(
        typeof contents === "string" ? contents : "",
      );
    }

    return cache.namesByAddress.get(ipAddress);
  };
}

/*
 * The first name a hosts-file lookup gives for an address that survives the
 * same normalisation a PTR answer does, or undefined. Never throws: an
 * injected lookup that fails is a file with no entry for this address.
 */
function readHostsFileName(
  hostsFileLookup: HostsFileLookup,
  ipAddress: string,
): string | undefined {
  let names: unknown = undefined;

  try {
    names = hostsFileLookup(ipAddress);
  } catch {
    return undefined;
  }

  if (!Array.isArray(names)) {
    return undefined;
  }

  for (const name of names) {
    const normalized: string | undefined = normalizeReverseDnsName(name);

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

export type NowFunction = () => number;

export default class ReverseDnsResolver {
  private lookup: ReverseDnsLookupFunction;
  /*
   * How an address whose first lookup failed is asked again, or undefined
   * for no retry pass. See the constructor for when each applies.
   */
  private buildRetryLookup: (() => ReverseDnsLookupFunction) | undefined;
  /*
   * How the breaker rescue asks its canaries, and how the rest of a rescued
   * pass is asked; undefined for no rescue. See the constructor.
   */
  private buildRescueLookup: (() => ReverseDnsLookupFunction) | undefined;
  // Consulted before DNS for every address, or undefined for none.
  private buildHostsFileLookup: (() => HostsFileLookup) | undefined;
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
    /*
     * The breaker rescue's lookup (OneUptime issue #3916). Omit every lookup
     * and it is buildDefaultRescueLookup. Inject `lookup` without this and
     * the rescue asks through `retryLookup` — and there is no rescue when
     * that is absent too — for the reason an injected `lookup` alone means
     * no retry pass.
     */
    rescueLookup?: ReverseDnsLookupFunction | undefined;
    /*
     * The hosts file, read before DNS for every address (OneUptime issue
     * #3916; see buildSystemHostsFileLookup). Omit it and the probe host's
     * own file is read — unless `lookup` is injected, in which case there is
     * none, for the reason an injected `lookup` means no retry pass: a caller
     * who replaced the lookup so that nothing of this machine's leaks into
     * the result must not get names from its /etc/hosts. Inject this too to
     * have one.
     */
    hostsFileLookup?: HostsFileLookup | undefined;
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
    const retryTimeoutInMs: number = Math.max(
      DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
      this.timeoutInMs,
    );
    /*
     * BUILT PER PASS, not once per instance: the rescue lookup remembers
     * which servers have named something, and the walks remember servers the
     * resolver would not pin. That is knowledge about one pass's network, and
     * an instance reused for a second pass must start without it. An injected
     * lookup is the caller's to scope.
     */
    const injectedRetryLookup: ReverseDnsLookupFunction | undefined =
      options?.retryLookup;
    const injectedRescueLookup: ReverseDnsLookupFunction | undefined =
      options?.rescueLookup ??
      (options?.lookup ? injectedRetryLookup : undefined);

    this.buildRetryLookup = injectedRetryLookup
      ? (): ReverseDnsLookupFunction => {
          return injectedRetryLookup;
        }
      : options?.lookup
        ? undefined
        : (): ReverseDnsLookupFunction => {
            return buildDefaultRetryLookup(retryTimeoutInMs);
          };
    this.buildRescueLookup = injectedRescueLookup
      ? (): ReverseDnsLookupFunction => {
          return injectedRescueLookup;
        }
      : options?.lookup
        ? undefined
        : (): ReverseDnsLookupFunction => {
            return buildDefaultRescueLookup(retryTimeoutInMs);
          };
    /*
     * Per pass too, for the reason the lookups are: the system file is read
     * once and cached by the lookup, and a pass must see the file as it is
     * when the pass starts, not as it was when the instance was made.
     */
    const injectedHostsFileLookup: HostsFileLookup | undefined =
      options?.hostsFileLookup;

    this.buildHostsFileLookup = injectedHostsFileLookup
      ? (): HostsFileLookup => {
          return injectedHostsFileLookup;
        }
      : options?.lookup
        ? undefined
        : (): HostsFileLookup => {
            return buildSystemHostsFileLookup();
          };
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
   * The hosts file first: an address it names (see
   * buildSystemHostsFileLookup) is named from there and never asked of DNS.
   *
   * Then two passes. The first asks every other address once, in waves,
   * under the failure budget and the wall-clock budget. The second asks
   * AGAIN only the addresses whose first lookup failed — timed out,
   * SERVFAIL, REFUSED, no server listening — through the retry lookup, which
   * waits longer and asks each configured nameserver in turn. An address
   * that answered, with a name or with NXDOMAIN, is never asked twice.
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
       * Distinct addresses whose lookup has been started: every address the
       * hosts file named, and then the DNS lookups, advanced by whole waves
       * before each wave is awaited, so a pass that stops at a wave boundary
       * has asked exactly this many.
       */
      lookedUpCount: number;
      /*
       * DNS lookups that came BACK, whether or not any answer survived
       * normalisation — and, since #3916, lookups a DNS server answered with
       * a FAILURE code (SERVFAIL, REFUSED, NOTIMP, FORMERR; see
       * classifyReverseDnsLookupError). This — not `resolvedCount` — is what
       * disarms the failure budget. The hosts file never adds to it: a name
       * from the file says nothing about DNS.
       *
       * The distinction is not academic. A resolver that answers every query
       * with a name that normalises away (a wildcard zone echoing
       * in-addr.arpa, a zone full of names with spaces in them) is a WORKING
       * resolver; counting only usable names would let a run of unusable
       * answers sit alongside a handful of unrelated timeouts and convict the
       * probe of having no resolver at all, skipping the addresses further
       * down the list that do have good names. A resolver that answers
       * SERVFAIL for one dead zone is a working resolver for the same reason.
       *
       * The retry pass adds to this too: an answer on the second try proves
       * DNS works from here exactly as much as one on the first.
       */
      successfulLookupCount: number;
      /*
       * FIRST-PASS failures only, one per distinct address. The retry pass
       * never adds to it — see retryOne. A responded failure is counted here
       * too, because it IS a failed lookup and the log reports these; it is
       * also counted as having come back, above, which is what keeps it from
       * convicting the probe.
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
      // See rescueFromBreaker.
      hasTriedBreakerRescue: boolean;
      isRescued: boolean;
    } = {
      resolvedCount: 0,
      lookedUpCount: 0,
      successfulLookupCount: 0,
      infrastructureFailureCount: 0,
      isTimeBudgetExhausted: false,
      isStoppedAsUnusable: false,
      retriedCount: 0,
      retryAnsweredCount: 0,
      hasTriedBreakerRescue: false,
      isRescued: false,
    };

    /*
     * THE HOSTS FILE, before any query (#3916; see
     * buildSystemHostsFileLookup). Every address, up front, rather than as
     * each wave reaches it: it costs no query and no time, so neither of the
     * pass's limits has any reason to stop it, and a device the operator
     * listed must keep its name even when the failure budget or the clock
     * ends the DNS lookups before its turn. What the file names never enters
     * a DNS wave, and touches none of the DNS counters — the file says
     * nothing about whether DNS works from here.
     */
    const hostsFileLookup: HostsFileLookup | undefined =
      this.buildHostsFileLookup?.();
    const dnsAddresses: Array<string> = [];

    for (const ipAddress of uniqueAddresses) {
      const hostsFileName: string | undefined = hostsFileLookup
        ? readHostsFileName(hostsFileLookup, ipAddress)
        : undefined;

      if (hostsFileName) {
        hostnameByIpAddress.set(ipAddress, hostsFileName);
        state.resolvedCount++;
        state.lookedUpCount++;
        continue;
      }

      dnsAddresses.push(ipAddress);
    }

    /*
     * The failure budget, asked only where the answer cannot be a lie: BETWEEN
     * waves, when every lookup started so far has settled.
     *
     * What it asks (#3916): has the probe's DNS been SILENT for a budget's
     * worth of addresses, with not one lookup coming back and not one server
     * responding? A name, an NXDOMAIN, a SERVFAIL or a REFUSED each count as
     * having come back (successfulLookupCount), so only timeouts, "nothing
     * listening" and errors nobody recognises can convict the probe of
     * having no usable resolver.
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
     *
     * `lookup` is the first-pass lookup, or — once the breaker rescue below
     * has switched the rest of the pass over — the rescue lookup. Either way
     * this is the address's FIRST attempt, and a failure is queued for the
     * retry pass like any other: on a probe with one nameserver the rescue
     * lookup is a single longer query to that same server, and one lost
     * datagram must not be the end of it there any more than here.
     */
    const lookupOne: (
      ipAddress: string,
      lookup: ReverseDnsLookupFunction,
    ) => Promise<void> = async (
      ipAddress: string,
      lookup: ReverseDnsLookupFunction,
    ): Promise<void> => {
      try {
        const answers: unknown = await lookup(ipAddress);

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

        if (classification.isServerResponse) {
          /*
           * SERVFAIL, REFUSED, NOTIMP, FORMERR: a failed lookup — the status
           * above says so, it is retried, it is counted — but the probe's DNS
           * server RESPONDED, which is all the budget asks. Without this, the
           * first sixty-four addresses of a sweep sitting in one zone a
           * recursive resolver SERVFAILs (a dead delegation, a DNSSEC-bogus
           * zone) convicted a working resolver and skipped every healthy
           * zone behind them.
           */
          state.successfulLookupCount++;
        }
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
     *
     * Answers whether the lookup CAME BACK — names, "no record", or a
     * failure a DNS server responded with — as opposed to silence. The
     * breaker rescue reads it.
     */
    const retryOne: (
      ipAddress: string,
      retryLookup: ReverseDnsLookupFunction,
    ) => Promise<boolean> = async (
      ipAddress: string,
      retryLookup: ReverseDnsLookupFunction,
    ): Promise<boolean> => {
      try {
        const answers: unknown = await retryLookup(ipAddress);

        state.successfulLookupCount++;
        state.retryAnsweredCount++;

        recordAnswers(ipAddress, answers);
        return true;
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
          return true;
        }

        state.failureReason = state.failureReason || describeError(err);

        if (classification.isServerResponse) {
          // Still failed; but a server responded, exactly as in lookupOne.
          state.successfulLookupCount++;
          return true;
        }

        return false;
      }
    };

    /*
     * The lookup the first pass is making. The fast first-try lookup, unless
     * the breaker rescue switches it.
     */
    let firstPassLookup: ReverseDnsLookupFunction = this.lookup;

    // This pass's own retry and rescue lookups; see the constructor.
    const retryLookupForPass: ReverseDnsLookupFunction | undefined =
      this.buildRetryLookup?.();
    const rescueLookupForPass: ReverseDnsLookupFunction | undefined =
      this.buildRescueLookup?.();

    // Rescue canaries asked before their wave; see rescueFromBreaker.
    const askedOutOfTurn: Set<string> = new Set<string>();

    /*
     * One breaker-rescue canary, asked through the rescue lookup. NEVER
     * rejects. Answers whether it came back with a NAME or with a "no record"
     * the rescue lookup trusts — the two outcomes that show DNS working from
     * here — as opposed to a failure or silence.
     *
     * Unlike retryOne, a failure a server RESPONDED with (SERVFAIL, REFUSED)
     * is recorded but does not count as having come back. The breaker is
     * about to conclude the probe has no DNS; a primary that has been silent
     * sixty-four times and then SERVFAILs after three seconds does not
     * contradict that in any way an operator could use, and letting it
     * disarm the breaker would send the rest of the pass through a lookup
     * that waits on that server for every address, until the time budget
     * runs out, and then advise raising it.
     */
    const askCanary: (
      ipAddress: string,
      rescueLookup: ReverseDnsLookupFunction,
      isOutOfTurn: boolean,
    ) => Promise<boolean> = async (
      ipAddress: string,
      rescueLookup: ReverseDnsLookupFunction,
      isOutOfTurn: boolean,
    ): Promise<boolean> => {
      /*
       * A canary asked out of turn is on its FIRST attempt, not a retry, so
       * it is counted the way the first pass counts: not in the retry
       * tallies, and a failure among the failures.
       */
      try {
        const answers: unknown = await rescueLookup(ipAddress);

        state.successfulLookupCount++;

        if (!isOutOfTurn) {
          state.retryAnsweredCount++;
        }

        recordAnswers(ipAddress, answers);
        return true;
      } catch (err) {
        const classification: ReverseDnsLookupErrorClassification =
          classifyReverseDnsLookupError(err);

        statusByIpAddress.set(ipAddress, classification.status);

        if (classification.kind === "no-record") {
          // Trusted by the rescue lookup, or it would not have ended on it.
          state.successfulLookupCount++;

          if (!isOutOfTurn) {
            state.retryAnsweredCount++;
          }

          return true;
        }

        if (isOutOfTurn && classification.kind === "failure") {
          state.infrastructureFailureCount++;
        }

        state.failureReason = state.failureReason || describeError(err);
        return false;
      }
    };

    /*
     * THE BREAKER RESCUE (OneUptime issue #3916), asked at most once per pass
     * and only when the breaker is about to stop it: a budget's worth of
     * lookups has met silence, and not one server has responded.
     *
     * That verdict is drawn from the FIRST-TRY lookup, and there is one
     * common setup it gets wrong: a probe host whose first nameserver is down
     * (or reachable only over a VPN that is not up) while the second works.
     * The first try gives each address two seconds on the first server;
     * c-ares only moves on to the second after that server's whole timeout,
     * which the first try's race always ends first. So every lookup fails,
     * the breaker concludes the probe has no DNS, and a sweep of more than
     * sixty-four hosts is listed entirely by address — while a resolver that
     * does move on, on the same host, names every one of them.
     *
     * So before stopping, up to THREE CANARIES are asked, concurrently,
     * through the rescue lookup (buildDefaultRescueLookup), which asks the
     * other servers before the silent primary: the first address that
     * failed, and — so that one silent zone at the bottom of the range cannot
     * speak for all of it — the next address the pass has not asked yet and
     * the last address of the sweep. (The rescue only ever runs before a
     * wave, so there is always an address left unasked.) The rescue succeeds
     * only on evidence that DNS works from here: a canary NAMED, or told "no
     * record" by a server the rescue lookup trusts (the primary, or one that
     * has named a private address). Then the rest of the pass — the first
     * pass's remaining waves AND its retry pass — is asked through the rescue
     * lookup, which by then asks a server that answers first. Anything less
     * leaves the verdict standing, and the pass stops exactly as it always
     * did. In particular a dead primary behind a PUBLIC resolver, which
     * answers NXDOMAIN for every private address and names none, does not
     * rescue: nothing it says shows it holds the zones.
     *
     * A canary the pass had not reached yet is asked OUT OF TURN: it counts
     * as looked up from then on, its wave skips it, a failure is left for the
     * retry pass, and if the pass stops it keeps what it came back with
     * rather than being reported as never asked.
     *
     * Only with a rescue lookup to ask (none when a test injects the lookup
     * alone), only while the deadline has not passed, and never twice: a
     * probe that really has no DNS pays for one extra walk, not one per wave
     * — the canaries run side by side, so three cost no longer than one.
     */
    const rescueFromBreaker: (
      nextUnaskedIndex: number,
    ) => Promise<boolean> = async (
      nextUnaskedIndex: number,
    ): Promise<boolean> => {
      const rescueLookup: ReverseDnsLookupFunction | undefined =
        rescueLookupForPass;

      if (
        !rescueLookup ||
        state.hasTriedBreakerRescue ||
        this.now() >= deadline
      ) {
        return false;
      }

      state.hasTriedBreakerRescue = true;

      const failedAddresses: Array<string> = uniqueAddresses.filter(
        (ipAddress: string): boolean => {
          return retryableAddresses.has(ipAddress);
        },
      );

      if (failedAddresses.length === 0) {
        return false;
      }

      const unaskedAddresses: Array<string> = dnsAddresses
        .slice(nextUnaskedIndex)
        .filter((ipAddress: string): boolean => {
          return !askedOutOfTurn.has(ipAddress);
        });

      // Distinct: with few addresses, fewer canaries.
      const canaryAddresses: Array<string> = [
        ...new Set<string>(
          [
            failedAddresses[0],
            unaskedAddresses[0],
            unaskedAddresses[unaskedAddresses.length - 1],
          ].filter((ipAddress: string | undefined): ipAddress is string => {
            return ipAddress !== undefined;
          }),
        ),
      ];

      const unaskedCanaries: Set<string> = new Set<string>(
        canaryAddresses.filter((ipAddress: string): boolean => {
          return unaskedAddresses.includes(ipAddress);
        }),
      );

      for (const ipAddress of unaskedCanaries) {
        askedOutOfTurn.add(ipAddress);
        state.lookedUpCount++;
      }

      state.retriedCount += canaryAddresses.length - unaskedCanaries.size;

      const hasCanaryComeBack: Array<boolean> = await Promise.all(
        canaryAddresses.map((ipAddress: string): Promise<boolean> => {
          return askCanary(
            ipAddress,
            rescueLookup,
            unaskedCanaries.has(ipAddress),
          );
        }),
      );

      if (
        !hasCanaryComeBack.some((hasComeBack: boolean): boolean => {
          return hasComeBack;
        })
      ) {
        return false;
      }

      /*
       * A canary that came back has had its thorough attempt and is not
       * left for the retry pass; one that did not is, and is asked again
       * through the rescue lookup once it knows which server answers.
       */
      canaryAddresses.forEach((ipAddress: string, index: number): void => {
        if (hasCanaryComeBack[index]) {
          retryableAddresses.delete(ipAddress);
        } else {
          retryableAddresses.add(ipAddress);
        }
      });

      firstPassLookup = rescueLookup;
      state.isRescued = true;

      logger.warn(
        `Discovery reverse DNS: the first ${state.infrastructureFailureCount} lookup(s) got no answer within the first attempt's time limit, but asking again - each nameserver in turn, with a longer timeout - got one, so the rest of this pass asks that way. The probe's first nameserver may be down, unreachable or slow. It reported: ${state.failureReason || "unknown error"}`,
      );

      return true;
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
     *
     * Over the addresses the hosts file did not name, in the same order.
     */
    /*
     * Where the first pass stopped: the index in dnsAddresses of the first
     * wave it did not start, which is where the skipped addresses begin.
     */
    let nextWaveStart: number = 0;

    for (
      let start: number = 0;
      start < dnsAddresses.length;
      start += this.concurrency
    ) {
      nextWaveStart = start;

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

      if (isReverseDnsUnusable() && (await rescueFromBreaker(start))) {
        /*
         * The rescue itself took time — up to one whole retry lookup, its
         * canaries being asked side by side — so the deadline is asked again
         * before the next wave is launched, or a pass could overrun by the
         * rescue AND a wave.
         */
        if (this.now() >= deadline) {
          state.isTimeBudgetExhausted = true;
          logger.warn(
            `Discovery reverse DNS lookups exceeded their ${totalBudgetInMs}ms budget after naming ${state.resolvedCount} host(s); ${uniqueAddresses.length - state.lookedUpCount} of ${uniqueAddresses.length} discovered address(es) were never looked up and will be named by IP address. The sweep itself is unaffected; set PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer.`,
          );
          break;
        }
      }

      if (isReverseDnsUnusable()) {
        state.isStoppedAsUnusable = true;
        logger.warn(
          `Discovery reverse DNS lookups are not usable from this probe: ${state.infrastructureFailureCount} address(es) of ${uniqueAddresses.length} failed to resolve and not one answered, so the rest were skipped and those hosts will be named by IP address. Reverse DNS is best-effort and this does not fail the scan. Resolver reported: ${state.failureReason || "unknown error"}`,
        );
        break;
      }

      // A rescue canary asked out of turn is not asked again here.
      const wave: Array<string> = dnsAddresses
        .slice(start, start + this.concurrency)
        .filter((ipAddress: string): boolean => {
          return !askedOutOfTurn.has(ipAddress);
        });

      state.lookedUpCount += wave.length;

      // Read once per wave: the rescue only ever switches between waves.
      const waveLookup: ReverseDnsLookupFunction = firstPassLookup;

      await Promise.all(
        wave.map((ipAddress: string) => {
          return lookupOne(ipAddress, waveLookup);
        }),
      );

      nextWaveStart = start + this.concurrency;
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

    for (const ipAddress of dnsAddresses.slice(nextWaveStart)) {
      // A canary asked out of turn keeps what it came back with.
      if (!askedOutOfTurn.has(ipAddress)) {
        statusByIpAddress.set(ipAddress, skippedStatus);
      }
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
     * - Only addresses whose first lookup FAILED — SERVFAIL and REFUSED
     *   included, though they disarm the failure budget. NXDOMAIN and NODATA
     *   are answers, and a malformed address is malformed twice.
     * - Not at all when the failure budget STOPPED the first pass: every
     *   lookup the probe made was met with silence — including the breaker
     *   rescue's canaries — and it skipped the rest, and asking the same
     *   dead resolver again, each server in turn at twice the timeout, would
     *   spend up to a quarter of a minute per wave learning nothing.
     * - Not for a rescue canary that came back: that WAS its second attempt.
     *   Every other address gets one retry, including those a rescued pass
     *   asked through the rescue lookup — on a probe with one nameserver that
     *   is a single longer query to the same server, and one lost datagram
     *   must not be the end of it. When the budget's verdict merely lands on
     *   the final wave, nothing was skipped and the retry DOES run: a small
     *   sweep behind a dead primary nameserver is exactly the case it exists
     *   for, and an answer on the retry disarms that verdict.
     * - Through the rescue lookup on a rescued pass (below).
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
    /*
     * A rescued pass retries through the rescue lookup, for the reason the
     * rest of its first pass was made through it: the retry lookup asks the
     * primary first, and on a rescued pass the primary is the server that
     * has been silent for a budget's worth of addresses.
     */
    const retryLookup: ReverseDnsLookupFunction | undefined = state.isRescued
      ? rescueLookupForPass
      : retryLookupForPass;

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
            `Discovery reverse DNS ran out of its ${totalBudgetInMs}ms budget while retrying failed lookups: ${retryAddresses.length - start} of ${retryAddresses.length} address(es) whose first lookup failed were not asked again and keep that first result. The sweep itself is unaffected; set PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer.`,
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
