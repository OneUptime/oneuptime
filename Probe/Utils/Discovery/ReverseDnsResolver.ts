import { normalizeReverseDnsName } from "Common/Utils/NetworkDiscovery/ReverseDnsNameUtil";
import logger from "Common/Server/Utils/Logger";
import dns from "dns";

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
 */
export const DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS: number = 60 * 1000;

/*
 * Codes that mean "this address has no name", as opposed to "this probe
 * cannot resolve". This is the ORDINARY outcome — most addresses on most
 * networks have no reverse record — so it must never count against the
 * failure budget, or one normal subnet would disable the feature for the rest
 * of its own scan.
 *
 * ENOTFOUND (NXDOMAIN) and ENODATA (the name exists, no PTR record) are what
 * Node's Resolver#reverse actually rejects with for the two ordinary cases.
 *
 * EINVAL is here because reverse() rejects with it when the argument is not a
 * parseable IP address — " 1.2.3.4 ", an IPv6 form it will not take, anything
 * a future caller of the public attachReverseDnsHostnames might hand it. That
 * is a fact about that one address and carries no information about the
 * resolver, so counting it would let a handful of malformed inputs convict a
 * working probe of having no DNS and skip every remaining host.
 *
 * EBADNAME/EBADSTR/NOTFOUND/NODATA are kept for the same reason and cost
 * nothing: they are the spellings other c-ares entry points use, and this set
 * should not depend on which one a future change routes through.
 *
 * Everything NOT here — ESERVFAIL, EREFUSED, ECONNREFUSED, ETIMEOUT,
 * ENOTIMP, and the race guard's own bare timeout Error — is evidence the
 * probe could not get an answer at all, which is what the budget is for.
 */
const NO_RECORD_ERROR_CODES: Set<string> = new Set<string>([
  "ENOTFOUND",
  "ENODATA",
  "NOTFOUND",
  "NODATA",
  "EINVAL",
  "EBADNAME",
  "EBADSTR",
]);

export interface ReverseDnsResolution {
  /*
   * Resolved names, keyed by the address asked. Addresses with no usable name
   * are ABSENT rather than mapped to undefined, so a caller can write
   * `if (name)` without also having to know whether the key exists.
   */
  hostnameByIpAddress: Map<string, string>;
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
 * A PTR lookup through the system resolvers, bounded twice over.
 *
 * c-ares gets its own `timeout`/`tries` so it stops asking, AND the promise is
 * raced against the same budget so a resolver that accepts the query and then
 * never answers cannot pin a worker for the rest of the sweep. The second
 * guard is the one that matters in practice — it is the same belt-and-braces
 * DnsResolutionCache uses, for the same reason.
 */
/*
 * How a resolver is obtained, injectable ONLY so that the timeout arm below
 * can be tested.
 *
 * Without a seam here, three things in this function are unreachable from any
 * test: the race's timeout branch, the `resolver.cancel()` inside it, and the
 * `finally` that clears the timer. The cancel is load-bearing — on a
 * black-holing forwarder every timed-out address would otherwise leave an
 * outstanding query and a retry timer behind for a resolver object the sweep
 * no longer holds — and deleting it broke no test, which is exactly the state
 * a piece of cleanup code should never be in.
 */
export interface ReverseDnsResolverLike {
  reverse(ipAddress: string): Promise<Array<string>>;
  cancel(): void;
}

export type ReverseDnsResolverFactory = (
  timeoutInMs: number,
) => ReverseDnsResolverLike;

const defaultResolverFactory: ReverseDnsResolverFactory = (
  timeoutInMs: number,
): ReverseDnsResolverLike => {
  return new dns.promises.Resolver({
    timeout: timeoutInMs,
    tries: 1,
  });
};

export function buildDefaultLookup(
  timeoutInMs: number,
  createResolver: ReverseDnsResolverFactory = defaultResolverFactory,
): ReverseDnsLookupFunction {
  return async (ipAddress: string): Promise<Array<string>> => {
    const resolver: ReverseDnsResolverLike = createResolver(timeoutInMs);

    const lookup: Promise<Array<string>> = resolver.reverse(ipAddress);

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
          reject(new Error(`Reverse DNS lookup for ${ipAddress} timed out`));
        }, timeoutInMs);
        // Never keep the probe alive just for this timer.
        timer.unref?.();
      },
    );

    try {
      return await Promise.race([lookup, timeout]);
    } finally {
      /*
       * Clear it on the WINNING path too. Promise.race leaves the loser
       * pending, so an un-cleared two-second timer would otherwise outlive
       * every fast lookup — thousands of them on a large sweep — and each
       * would still call resolver.cancel() long after that resolver's answer
       * was already in the map.
       */
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
}

export type NowFunction = () => number;

export default class ReverseDnsResolver {
  private lookup: ReverseDnsLookupFunction;
  private concurrency: number;
  private failureBudget: number;
  private totalBudgetInMs: number;
  private now: NowFunction;

  public constructor(options?: {
    lookup?: ReverseDnsLookupFunction | undefined;
    timeoutInMs?: number | undefined;
    concurrency?: number | undefined;
    failureBudget?: number | undefined;
    totalBudgetInMs?: number | undefined;
    // Injectable so the wall-clock budget is testable without waiting on one.
    now?: NowFunction | undefined;
  }) {
    this.lookup =
      options?.lookup ??
      buildDefaultLookup(
        options?.timeoutInMs ?? DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
      );
    this.concurrency = Math.max(
      1,
      options?.concurrency ?? DEFAULT_REVERSE_DNS_CONCURRENCY,
    );
    this.failureBudget = Math.max(
      1,
      options?.failureBudget ?? DEFAULT_REVERSE_DNS_FAILURE_BUDGET,
    );
    this.totalBudgetInMs = Math.max(
      1,
      options?.totalBudgetInMs ?? DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
    );
    this.now = options?.now ?? Date.now;
  }

  /**
   * Names for as many of these addresses as have usable PTR records.
   *
   * Never rejects. Reverse DNS is an enrichment on top of a sweep that has
   * already succeeded, so every failure mode here — a missing record, a
   * refused query, no resolver configured in the probe container at all —
   * resolves to "no name for that address" and leaves the sweep's result
   * exactly as it would have been before this existed.
   */
  public async resolveHostnames(
    ipAddresses: Array<string>,
  ): Promise<ReverseDnsResolution> {
    const hostnameByIpAddress: Map<string, string> = new Map<string, string>();

    /*
     * De-duplicated, because a sweep can legitimately report the same address
     * twice (the SNMP path appends in completion order across two passes) and
     * paying for the same lookup twice is pure waste.
     */
    const uniqueAddresses: Array<string> = [...new Set<string>(ipAddresses)];

    if (uniqueAddresses.length === 0) {
      return {
        hostnameByIpAddress: hostnameByIpAddress,
        isReverseDnsAvailable: true,
        isTimeBudgetExhausted: false,
      };
    }

    const deadline: number = this.now() + this.totalBudgetInMs;

    /*
     * Held on an object rather than in bare `let`s: these are written from
     * `this.concurrency` concurrent workers, and control-flow narrowing on a
     * plain local would erase assignments made inside the closure.
     */
    const state: {
      resolvedCount: number;
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
       */
      successfulLookupCount: number;
      infrastructureFailureCount: number;
      failureReason?: string | undefined;
      isTimeBudgetExhausted: boolean;
    } = {
      resolvedCount: 0,
      successfulLookupCount: 0,
      infrastructureFailureCount: 0,
      isTimeBudgetExhausted: false,
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

        /*
         * Defended rather than assumed. `for...of` over a non-iterable throws,
         * and that throw would land in the catch below and be counted as an
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
            state.resolvedCount++;
            return;
          }
        }
      } catch (err) {
        if (NO_RECORD_ERROR_CODES.has(getErrorCode(err))) {
          /*
           * The ordinary "this address has no PTR record". Not a failure —
           * and, just as importantly, a SUCCESS for the budget's purposes.
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

        state.infrastructureFailureCount++;
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
          `Discovery reverse DNS lookups exceeded their ${this.totalBudgetInMs}ms budget after naming ${state.resolvedCount} host(s); the remaining discovered hosts will be named by IP address. The sweep itself is unaffected.`,
        );
        break;
      }

      if (isReverseDnsUnusable()) {
        logger.warn(
          `Discovery reverse DNS lookups are not usable from this probe: ${state.infrastructureFailureCount} address(es) of ${uniqueAddresses.length} failed to resolve and not one answered, so the rest were skipped and those hosts will be named by IP address. Reverse DNS is best-effort and this does not fail the scan. Resolver reported: ${state.failureReason || "unknown error"}`,
        );
        break;
      }

      await Promise.all(
        uniqueAddresses
          .slice(start, start + this.concurrency)
          .map((ipAddress: string) => {
            return lookupOne(ipAddress);
          }),
      );
    }

    return {
      hostnameByIpAddress: hostnameByIpAddress,
      isReverseDnsAvailable: !isReverseDnsUnusable(),
      isTimeBudgetExhausted: state.isTimeBudgetExhausted,
      failureReason: state.failureReason,
    };
  }
}
