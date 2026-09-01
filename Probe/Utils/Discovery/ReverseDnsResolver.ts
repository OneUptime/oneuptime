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
 * How many infrastructure failures are tolerated before the rest of the sweep
 * is skipped. See `isReverseDnsAvailable` below for why this counts only
 * while nothing has resolved.
 */
export const DEFAULT_REVERSE_DNS_FAILURE_BUDGET: number = 10;

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
 * c-ares codes that mean "asked, answered, no PTR here". This is the ORDINARY
 * outcome — most addresses on most networks have no reverse record — so it
 * must never count against the failure budget, or one normal subnet would
 * disable the feature for the rest of its own scan.
 *
 * EBADNAME/EBADSTR are lumped in with them: they mean the address could not
 * be turned into a query, which is a fact about that one address and not
 * evidence about the resolver.
 */
const NO_RECORD_ERROR_CODES: Set<string> = new Set<string>([
  "ENOTFOUND",
  "ENODATA",
  "NOTFOUND",
  "NODATA",
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
   * skipped. The names already resolved (there are none, by construction —
   * see the budget rule) are still returned.
   *
   * Distinct from `isTimeBudgetExhausted`: this one says the resolver does
   * not work from here, which is a probe-configuration fact, while that one
   * says the pass was simply too big to finish.
   */
  isReverseDnsAvailable: boolean;
  /*
   * True when the wall-clock budget ran out with addresses still unasked. The
   * names resolved before it did are real and are returned.
   */
  isTimeBudgetExhausted: boolean;
  /*
   * The first infrastructure failure, verbatim-ish, for the log line that
   * explains why a scan came back with addresses instead of names. Truncated
   * the way SubnetScanner truncates SNMP errors — resolver errors can carry a
   * whole server list.
   */
  failureReason?: string | undefined;
}

// Long enough to name the failure, short enough for one log line.
const FAILURE_REASON_EXCERPT_LENGTH: number = 200;

function describeError(error: unknown): string {
  const message: string = (
    (error as Error | undefined)?.message || String(error ?? "")
  ).trim();

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
function buildDefaultLookup(timeoutInMs: number): ReverseDnsLookupFunction {
  return async (ipAddress: string): Promise<Array<string>> => {
    const resolver: dns.promises.Resolver = new dns.promises.Resolver({
      timeout: timeoutInMs,
      tries: 1,
    });

    const lookup: Promise<Array<string>> = resolver.reverse(ipAddress);

    const timeout: Promise<never> = new Promise<never>(
      (_resolve: (value: never) => void, reject: (reason: Error) => void) => {
        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
          reject(new Error(`Reverse DNS lookup for ${ipAddress} timed out`));
        }, timeoutInMs);
        // Never keep the probe alive just for this timer.
        timer.unref?.();
      },
    );

    return await Promise.race([lookup, timeout]);
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
      infrastructureFailureCount: number;
      failureReason?: string | undefined;
      isAvailable: boolean;
      isTimeBudgetExhausted: boolean;
    } = {
      resolvedCount: 0,
      infrastructureFailureCount: 0,
      isAvailable: true,
      isTimeBudgetExhausted: false,
    };

    await this.runConcurrently(
      uniqueAddresses,
      async (ipAddress: string): Promise<void> => {
        if (!state.isAvailable) {
          return;
        }

        /*
         * Checked before STARTING a lookup, never in the middle of one: a
         * lookup already in flight is bounded by its own timeout, and
         * abandoning its result would waste a query that has already been
         * sent. The pass therefore overruns the budget by at most one
         * per-address timeout.
         */
        if (this.now() >= deadline) {
          if (!state.isTimeBudgetExhausted) {
            state.isTimeBudgetExhausted = true;
            logger.warn(
              `Discovery reverse DNS lookups exceeded their ${this.totalBudgetInMs}ms budget after naming ${state.resolvedCount} host(s); the remaining discovered hosts will be named by IP address. The sweep itself is unaffected.`,
            );
          }

          return;
        }

        try {
          const answers: Array<string> = await this.lookup(ipAddress);

          /*
           * FIRST usable answer wins. An address with several PTR records is
           * unusual but legal, and the alternative — refusing to name a host
           * whose owner published two names for it — is worse than picking
           * one deterministically. Answers that normalise away (an
           * in-addr.arpa echo, a name with a space in it) are skipped rather
           * than ending the search, so a junk first record cannot hide a good
           * second one.
           */
          for (const answer of answers) {
            const name: string | undefined = normalizeReverseDnsName(answer);

            if (name) {
              hostnameByIpAddress.set(ipAddress, name);
              state.resolvedCount++;
              break;
            }
          }
        } catch (err) {
          if (NO_RECORD_ERROR_CODES.has(getErrorCode(err))) {
            // The ordinary "this address has no PTR record". Not a failure.
            return;
          }

          state.infrastructureFailureCount++;
          state.failureReason = state.failureReason || describeError(err);

          /*
           * The budget only bites while NOTHING has resolved.
           *
           * A resolver that has already answered for some address is present
           * and working, so a later timeout is about that address (a stale
           * delegation, a reverse zone whose nameserver is down) and skipping
           * the rest of the sweep over it would throw away names that would
           * have resolved fine. It is the probe container with no resolver at
           * all, or one that refuses every query, that this exists for — and
           * there, by definition, nothing ever resolves.
           */
          if (
            state.resolvedCount === 0 &&
            state.infrastructureFailureCount >= this.failureBudget
          ) {
            state.isAvailable = false;
            logger.warn(
              `Discovery reverse DNS lookups are not usable from this probe: ${state.infrastructureFailureCount} of the first ${uniqueAddresses.length} discovered address(es) failed to resolve and none succeeded, so the rest were skipped and those hosts will be named by IP address. Reverse DNS is best-effort and this does not fail the scan. Resolver reported: ${state.failureReason || "unknown error"}`,
            );
          }
        }
      },
    );

    return {
      hostnameByIpAddress: hostnameByIpAddress,
      isReverseDnsAvailable: state.isAvailable,
      isTimeBudgetExhausted: state.isTimeBudgetExhausted,
      failureReason: state.failureReason,
    };
  }

  /*
   * At most `concurrency` lookups in flight. Same worker-pool shape as
   * SubnetScanner.runConcurrently — duplicated rather than shared so this
   * class stays testable on its own, which is the whole reason it is a class
   * and not three functions inside the scanner.
   */
  private async runConcurrently(
    items: Array<string>,
    work: (item: string) => Promise<void>,
  ): Promise<void> {
    let cursor: number = 0;

    const worker: () => Promise<void> = async (): Promise<void> => {
      while (cursor < items.length) {
        await work(items[cursor++]!);
      }
    };

    const workers: Array<Promise<void>> = [];

    for (let i: number = 0; i < Math.min(this.concurrency, items.length); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
  }
}
