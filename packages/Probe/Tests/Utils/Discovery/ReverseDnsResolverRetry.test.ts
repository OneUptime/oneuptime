// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import ReverseDnsResolver, {
  DEFAULT_REVERSE_DNS_CONCURRENCY,
  DEFAULT_REVERSE_DNS_FAILURE_BUDGET,
  DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
  ReverseDnsLookupFunction,
  ReverseDnsResolution,
} from "../../../Utils/Discovery/ReverseDnsResolver";
import {
  FakeReverseDnsResolver,
  fakeDnsError,
  fakeReverseDnsResolver,
} from "../../TestingUtils/FakeReverseDnsResolver";
import { DiscoveredHostReverseDnsStatus } from "Common/Types/NetworkDevice/DiscoveredHostNamingStatus";
import logger from "Common/Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import dns from "dns";

/*
 * OneUptime issue #3916 — the retry pass.
 *
 * The probe used to ask each address exactly once, give up at two seconds and
 * never ask again. One dropped datagram, one answer that took 2.1 seconds, a
 * primary nameserver that was down or answering SERVFAIL: each of those left
 * a kitchen display named by its address, and real c-ares against a loopback
 * server reproduces the customer's "four of twelve" from any one of them.
 *
 * The retry pass asks AGAIN only the addresses whose first lookup failed,
 * through a separate lookup that waits longer and asks each configured
 * nameserver in turn (buildDefaultRetryLookup; its own suite is
 * ReverseDnsResolverDefaultLookup.test.ts). This suite pins the PASS: which
 * addresses are retried, what their status becomes, and — the part that is
 * easiest to get subtly wrong — how the retry interacts with the two budgets.
 * The failure budget must not count an address twice, and the wall-clock
 * budget must bound the retry exactly as it bounds the first attempt,
 * without being raised to make room for it.
 *
 * Both lookups are injected; NO TEST HERE SENDS A QUERY. The tests of the
 * constructor's DEFAULT wiring — the retry it builds, the first attempt it
 * pins, and the lookups it builds afresh for every pass — replace the
 * Resolver class itself.
 */

let warnedMessages: Array<string> = [];

beforeEach(() => {
  warnedMessages = [];

  jest.spyOn(logger, "warn").mockImplementation((message: unknown): never => {
    warnedMessages.push(String(message));
    return undefined as never;
  });
  jest.spyOn(logger, "debug").mockImplementation((): never => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function resolverWith(
  lookup: ReverseDnsLookupFunction,
  retryLookup: ReverseDnsLookupFunction | undefined,
  options?: {
    failureBudget?: number | undefined;
    concurrency?: number | undefined;
    totalBudgetInMs?: number | undefined;
    now?: (() => number) | undefined;
  },
): ReverseDnsResolver {
  return new ReverseDnsResolver({
    lookup: lookup,
    retryLookup: retryLookup,
    concurrency: options?.concurrency ?? 1,
    failureBudget: options?.failureBudget,
    totalBudgetInMs: options?.totalBudgetInMs,
    now: options?.now,
  });
}

function addressList(count: number): Array<string> {
  return Array.from(
    { length: count },
    (_unused: unknown, index: number): string => {
      return `10.0.${Math.floor(index / 254)}.${(index % 254) + 1}`;
    },
  );
}

function steppingClock(stepInMs: number): () => number {
  let current: number = 0;

  return (): number => {
    const value: number = current;
    current += stepInMs;
    return value;
  };
}

/*
 * A lookup scripted per address, recording every address it was asked, in
 * order. The script is a function of the address so one lookup can play a
 * whole subnet.
 */
interface RecordingLookup {
  lookup: ReverseDnsLookupFunction;
  asked: Array<string>;
}

function recordingLookup(
  script: (ipAddress: string) => Promise<Array<string>>,
): RecordingLookup {
  const asked: Array<string> = [];

  return {
    asked: asked,
    lookup: (ipAddress: string): Promise<Array<string>> => {
      asked.push(ipAddress);
      return script(ipAddress);
    },
  };
}

function failingWith(code: string): () => Promise<Array<string>> {
  return (): Promise<Array<string>> => {
    return Promise.reject(fakeDnsError(code));
  };
}

function answering(name: string): () => Promise<Array<string>> {
  return (): Promise<Array<string>> => {
    return Promise.resolve([name]);
  };
}

describe("ReverseDnsResolver retry — an address that failed, then answered", () => {
  it.each([
    ["timed out", "ETIMEOUT"],
    ["got SERVFAIL", "ESERVFAIL"],
    ["was REFUSED", "EREFUSED"],
    ["found nothing listening", "ECONNREFUSED"],
    ["failed some other way", "ENOTIMP"],
  ])(
    "names a host whose first lookup %s and whose retry answered",
    async (_label: string, code: string) => {
      const first: RecordingLookup = recordingLookup(failingWith(code));
      const retry: RecordingLookup = recordingLookup(
        answering("kds-06.wbhq.example"),
      );

      const result: ReverseDnsResolution = await resolverWith(
        first.lookup,
        retry.lookup,
      ).resolveHostnames(["10.16.42.56"]);

      expect(first.asked).toEqual(["10.16.42.56"]);
      expect(retry.asked).toEqual(["10.16.42.56"]);
      expect(result.hostnameByIpAddress.get("10.16.42.56")).toBe(
        "kds-06.wbhq.example",
      );
      // Named, so no status — not the first attempt's failure left behind.
      expect(result.statusByIpAddress!.has("10.16.42.56")).toBe(false);
      expect(result.failedAddressCount).toBe(0);
      expect(result.isReverseDnsAvailable).toBe(true);
      /*
       * The first attempt's failure was still SEEN, and failureReason is
       * "the first failure seen" — read beside isReverseDnsAvailable, as
       * ever.
       */
      expect(result.failureReason).toContain(code);
    },
  );

  it("reports 'no record' for a host whose first lookup was REFUSED and whose retry got NXDOMAIN", async () => {
    /*
     * The retry's answer is the truth about the address: NXDOMAIN is an
     * answer, so it is final, and the host is NOT a failed lookup any more —
     * it simply has no PTR record.
     */
    const result: ReverseDnsResolution = await resolverWith(
      failingWith("EREFUSED"),
      failingWith("ENOTFOUND"),
    ).resolveHostnames(["10.16.42.55"]);

    expect(result.statusByIpAddress!.get("10.16.42.55")).toBe(
      DiscoveredHostReverseDnsStatus.NoRecord,
    );
    expect(result.failedAddressCount).toBe(0);
  });

  it("reports an unusable name for a host whose retry answered with only junk", async () => {
    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      answering("59.42.16.10.in-addr.arpa"),
    ).resolveHostnames(["10.16.42.59"]);

    expect(result.statusByIpAddress!.get("10.16.42.59")).toBe(
      DiscoveredHostReverseDnsStatus.UnusableName,
    );
    expect(result.failedAddressCount).toBe(0);
  });

  it("reports 'no record' for a host whose retry answered with an empty list", async () => {
    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      async (): Promise<Array<string>> => {
        return [];
      },
    ).resolveHostnames(["10.16.42.52"]);

    expect(result.statusByIpAddress!.get("10.16.42.52")).toBe(
      DiscoveredHostReverseDnsStatus.NoRecord,
    );
  });
});

describe("ReverseDnsResolver retry — an address that failed twice", () => {
  it("keeps it unnamed, reports the retry's failure, and counts it once", async () => {
    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      failingWith("ETIMEOUT"),
    ).resolveHostnames(["10.16.42.61"]);

    expect(result.hostnameByIpAddress.size).toBe(0);
    expect(result.statusByIpAddress!.get("10.16.42.61")).toBe(
      DiscoveredHostReverseDnsStatus.Timeout,
    );
    expect(result.failedAddressCount).toBe(1);
  });

  it("reports what the server said LAST: a timeout followed by SERVFAIL is a server failure", async () => {
    /*
     * The first attempt's timeout may have been the network; the retry's
     * SERVFAIL is the server itself speaking, and it is the better
     * description of why the host has no name.
     */
    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      failingWith("ESERVFAIL"),
    ).resolveHostnames(["10.16.42.54"]);

    expect(result.statusByIpAddress!.get("10.16.42.54")).toBe(
      DiscoveredHostReverseDnsStatus.ServerFailure,
    );
  });

  it("keeps the FIRST failure seen as the failure reason", async () => {
    const result: ReverseDnsResolution = await resolverWith(
      (): Promise<Array<string>> => {
        return Promise.reject(fakeDnsError("ETIMEOUT", "first attempt"));
      },
      (): Promise<Array<string>> => {
        return Promise.reject(fakeDnsError("ESERVFAIL", "retry"));
      },
    ).resolveHostnames(["10.16.42.54"]);

    expect(result.failureReason).toBe("first attempt");
  });

  it("takes the retry's reason when the first failure had nothing to say", async () => {
    /*
     * The rule is "the first failure that can be described", exactly as in
     * the first pass: a bare `throw undefined` leaves nothing to report, and
     * an operator is better served by the retry's words than by none.
     */
    const result: ReverseDnsResolution = await resolverWith(
      (): Promise<Array<string>> => {
        return Promise.reject(undefined);
      },
      (): Promise<Array<string>> => {
        return Promise.reject(fakeDnsError("ESERVFAIL", "retry said this"));
      },
    ).resolveHostnames(["10.16.42.54"]);

    expect(result.failureReason).toBe("retry said this");
  });

  it("never rejects, whatever the retry lookup throws", async () => {
    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      (): Promise<Array<string>> => {
        throw new TypeError("a retry lookup that throws synchronously");
      },
    ).resolveHostnames(["10.16.42.61", "10.16.42.62"]);

    expect(result.statusByIpAddress!.get("10.16.42.61")).toBe(
      DiscoveredHostReverseDnsStatus.Failed,
    );
    expect(result.failedAddressCount).toBe(2);
  });
});

describe("ReverseDnsResolver retry — what is never retried", () => {
  it("asks again only the addresses whose first lookup FAILED, once each, in order", async () => {
    const outcomes: Record<string, () => Promise<Array<string>>> = {
      "10.0.0.1": answering("named.example.com"),
      "10.0.0.2": failingWith("ENOTFOUND"),
      "10.0.0.3": failingWith("ETIMEOUT"),
      "10.0.0.4": failingWith("ENODATA"),
      "10.0.0.5": answering("5.0.0.10.in-addr.arpa"),
      "10.0.0.6": failingWith("ESERVFAIL"),
      " 10.0.0.7 ": failingWith("EINVAL"),
      "10.0.0.8": failingWith("EBADNAME"),
      "10.0.0.9": failingWith("EREFUSED"),
      "10.0.0.10": async (): Promise<Array<string>> => {
        return [];
      },
      "10.0.0.11": failingWith("ECONNREFUSED"),
    };

    const retry: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));

    await resolverWith(
      (ipAddress: string): Promise<Array<string>> => {
        return outcomes[ipAddress]!();
      },
      retry.lookup,
      { concurrency: 4 },
    ).resolveHostnames([
      ...Object.keys(outcomes),
      // Duplicates are one address, and one retry.
      "10.0.0.3",
      "10.0.0.6",
    ]);

    /*
     * Not the named host, not NXDOMAIN or NODATA (answers — a retry cannot
     * change them), not the unusable answer or the empty list (also
     * answers), and not the malformed inputs (the same argument is malformed
     * the second time).
     */
    expect(retry.asked).toEqual([
      "10.0.0.3",
      "10.0.0.6",
      "10.0.0.9",
      "10.0.0.11",
    ]);
  });

  it("does not retry at all when only the first-pass lookup is injected", async () => {
    /*
     * The documented rule, pinned because the older suites depend on it: an
     * injected `lookup` with no `retryLookup` is a first pass alone. Falling
     * back to the REAL retry lookup here would send queries from behind a
     * seam a test replaced to prevent exactly that.
     */
    const first: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));

    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: first.lookup,
      concurrency: 1,
    }).resolveHostnames(["10.0.0.1", "10.0.0.2"]);

    expect(first.asked).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(result.statusByIpAddress!.get("10.0.0.1")).toBe(
      DiscoveredHostReverseDnsStatus.Timeout,
    );
  });

  it("skips the retry pass when the failure budget stopped the first pass, after ONE thorough walk of three canaries", async () => {
    /*
     * A hundred addresses at the shipped width and budget, and not one
     * answer from either lookup: the breaker is about to stop the pass after
     * two waves (64 failures), asks three canaries the thorough way, side by
     * side (the breaker rescue, #3916) — the first failed address, the next
     * address not yet asked and the last one — gets nothing there either,
     * and skips the rest. Retrying the 64 — each server in turn, at twice
     * the timeout — would spend up to a quarter of a minute per wave asking
     * a resolver that has already failed sixty-seven times running; a probe
     * with no DNS pays for one extra walk, not a wave of them.
     *
     * The two canaries the pass had not reached were asked OUT OF TURN, and
     * they were asked: they count as looked up and keep the failure they got
     * — 66 looked up and failed, 34 skipped — rather than being reported as
     * never asked.
     */
    const retry: RecordingLookup = recordingLookup(failingWith("ECONNREFUSED"));
    const addresses: Array<string> = addressList(100);

    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ECONNREFUSED"),
      retry.lookup,
      { concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY },
    ).resolveHostnames(addresses);

    // The canaries — first failed, next unasked, last — and no more.
    expect(retry.asked).toEqual([addresses[0], addresses[64], addresses[99]]);
    expect(result.isReverseDnsAvailable).toBe(false);
    expect(result.lookedUpCount).toBe(66);
    expect(result.notLookedUpCount).toBe(34);
    expect(result.failedAddressCount).toBe(66);
    expect(result.statusByIpAddress!.get(addresses[64]!)).toBe(
      DiscoveredHostReverseDnsStatus.Unreachable,
    );
    expect(result.statusByIpAddress!.get(addresses[99]!)).toBe(
      DiscoveredHostReverseDnsStatus.Unreachable,
    );
    expect(
      [...result.statusByIpAddress!.values()].filter(
        (status: DiscoveredHostReverseDnsStatus): boolean => {
          return status === DiscoveredHostReverseDnsStatus.SkippedNoResolver;
        },
      ),
    ).toHaveLength(34);
    // One warning: the breaker's. The rescue failed, so it says nothing.
    expect(warnedMessages).toHaveLength(1);
    expect(warnedMessages[0]).toContain("not usable from this probe");
  });

  it("skips the retry entirely when the wall clock stopped the first pass", async () => {
    // Deadline 150; readings at 100 (wave one) and 200 (stop).
    const retry: RecordingLookup = recordingLookup(
      answering("never.example.com"),
    );

    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      retry.lookup,
      { concurrency: 2, totalBudgetInMs: 150, now: steppingClock(100) },
    ).resolveHostnames(addressList(6));

    expect(retry.asked).toHaveLength(0);
    expect(result.isTimeBudgetExhausted).toBe(true);
    expect(result.statusByIpAddress!.get("10.0.0.1")).toBe(
      DiscoveredHostReverseDnsStatus.Timeout,
    );
    // The time-budget warning, once — not a second one for the retry.
    expect(warnedMessages).toHaveLength(1);
    expect(warnedMessages[0]).toContain("were never looked up");
  });
});

describe("ReverseDnsResolver retry — the failure budget counts an address once", () => {
  it("does not let retry failures convict a probe the first pass had not", async () => {
    /*
     * The mutation this kills: counting a retry failure against the budget.
     * A budget of three, two addresses that fail on both attempts: the first
     * pass counts two — under budget — and the retry's two more would make
     * four and turn "two hosts behind a flaky forwarder" into "this probe
     * cannot resolve".
     */
    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      failingWith("ETIMEOUT"),
      { failureBudget: 3 },
    ).resolveHostnames(["10.0.0.1", "10.0.0.2"]);

    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.failedAddressCount).toBe(2);
    expect(warnedMessages).toHaveLength(0);
  });

  it("keeps forty hosts that fail twice below the shipped budget of sixty-four", async () => {
    // The customer's scale, or a little above it, at the shipped defaults.
    const retry: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));

    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      retry.lookup,
      { concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY },
    ).resolveHostnames(addressList(40));

    expect(DEFAULT_REVERSE_DNS_FAILURE_BUDGET).toBe(64);
    expect(retry.asked).toHaveLength(40);
    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.failedAddressCount).toBe(40);
    expect(result.lookedUpCount).toBe(40);
    expect(result.notLookedUpCount).toBe(0);
  });

  it("keeps sixty-three hosts that fail twice below the budget — one short of it", async () => {
    // Silence: a SERVFAIL never spends the budget at all (#3916).
    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      failingWith("ETIMEOUT"),
      { concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY },
    ).resolveHostnames(addressList(DEFAULT_REVERSE_DNS_FAILURE_BUDGET - 1));

    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.failedAddressCount).toBe(63);
  });
});

describe("ReverseDnsResolver retry — an answer on the retry disarms the verdict", () => {
  /*
   * When the breaker's verdict lands on the FINAL wave, nothing was skipped
   * and the retry runs. That is the small sweep behind a dead primary
   * nameserver: every first attempt timed out (the race ends each lookup
   * before c-ares can fail over), and only the retry — asking the secondary
   * explicitly — can find out the probe's DNS works. When it does, the pass
   * must not go on reporting "reverse DNS is not usable from this probe".
   */

  it("reports DNS available once a retry answers, where the first pass alone would not", async () => {
    // Eight addresses, four at a time, budget five: met on the last wave.
    const input: Array<string> = addressList(8);

    const withoutRetry: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      undefined,
      { concurrency: 4, failureBudget: 5 },
    ).resolveHostnames(input);

    expect(withoutRetry.isReverseDnsAvailable).toBe(false);

    const retry: RecordingLookup = recordingLookup(
      (ipAddress: string): Promise<Array<string>> => {
        return Promise.resolve([`kds-${ipAddress.split(".").pop()}.example`]);
      },
    );

    const withRetry: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      retry.lookup,
      { concurrency: 4, failureBudget: 5 },
    ).resolveHostnames(input);

    expect(retry.asked).toEqual(input);
    expect(withRetry.isReverseDnsAvailable).toBe(true);
    expect(withRetry.hostnameByIpAddress.size).toBe(8);
    expect(withRetry.statusByIpAddress!.size).toBe(0);
    expect(withRetry.failedAddressCount).toBe(0);
  });

  it("is disarmed by an NXDOMAIN on the retry too: an answer is an answer", async () => {
    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      failingWith("ENOTFOUND"),
      { concurrency: 3, failureBudget: 2 },
    ).resolveHostnames(addressList(3));

    expect(result.isReverseDnsAvailable).toBe(true);
    expect([...result.statusByIpAddress!.values()]).toEqual([
      DiscoveredHostReverseDnsStatus.NoRecord,
      DiscoveredHostReverseDnsStatus.NoRecord,
      DiscoveredHostReverseDnsStatus.NoRecord,
    ]);
  });

  it.each(["ESERVFAIL", "EREFUSED"])(
    "is disarmed by a %s on the retry too: a server responded, though the lookup failed",
    async (code: string) => {
      /*
       * #3916: silence alone convicts. The retry still failed — the status
       * and the count say so — but a DNS server answered it, so this probe
       * does have a resolver it can reach.
       */
      const result: ReverseDnsResolution = await resolverWith(
        failingWith("ETIMEOUT"),
        failingWith(code),
        { concurrency: 4, failureBudget: 5 },
      ).resolveHostnames(addressList(8));

      expect(result.isReverseDnsAvailable).toBe(true);
      expect(result.failedAddressCount).toBe(8);
    },
  );

  it("leaves the verdict standing when the retry fails too", async () => {
    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      failingWith("ETIMEOUT"),
      { concurrency: 4, failureBudget: 5 },
    ).resolveHostnames(addressList(8));

    expect(result.isReverseDnsAvailable).toBe(false);
    expect(result.notLookedUpCount).toBe(0);
    expect(result.failedAddressCount).toBe(8);
  });
});

describe("ReverseDnsResolver retry — the wall-clock budget", () => {
  it("checks the SAME deadline before every retry wave, and stops without marking anything unasked", async () => {
    /*
     * Deadline 450. The first pass reads the clock at 100, 200 and 300 and
     * asks all six addresses two at a time. The retry reads 400 — still
     * short — and re-asks one wave of two; its next reading, 500, is past
     * the deadline, so the other four are not retried.
     *
     * Those four WERE looked up, so they keep their first-pass status and
     * the pass is not "time budget exhausted": nothing was left unasked. The
     * budget is not stretched to fit the retry — the reaper arithmetic
     * depends on it — so a pass that spent it on first attempts retries less.
     */
    const retry: RecordingLookup = recordingLookup(
      answering("recovered.example.com"),
    );
    const input: Array<string> = addressList(6);

    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      retry.lookup,
      { concurrency: 2, totalBudgetInMs: 450, now: steppingClock(100) },
    ).resolveHostnames(input);

    expect(retry.asked).toEqual(input.slice(0, 2));
    expect(result.hostnameByIpAddress.size).toBe(2);

    for (const ipAddress of input.slice(2)) {
      expect(result.statusByIpAddress!.get(ipAddress)).toBe(
        DiscoveredHostReverseDnsStatus.Timeout,
      );
    }

    expect(result.failedAddressCount).toBe(4);
    expect(result.isTimeBudgetExhausted).toBe(false);
    expect(result.lookedUpCount).toBe(6);
    expect(result.notLookedUpCount).toBe(0);
    expect(result.totalBudgetInMs).toBe(450);

    expect(warnedMessages).toHaveLength(1);
    expect(warnedMessages[0]).toContain("450ms budget");
    expect(warnedMessages[0]).toContain(
      "4 of 6 address(es) whose first lookup failed were not asked again",
    );
    expect(warnedMessages[0]).toContain(
      "PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS",
    );
  });

  it("does not start a retry wave on the reading that lands exactly ON the deadline", async () => {
    // Deadline 300: first pass at 100 and 200, the retry's first reading is 300.
    const retry: RecordingLookup = recordingLookup(
      answering("never.example.com"),
    );

    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      retry.lookup,
      { concurrency: 1, totalBudgetInMs: 300, now: steppingClock(100) },
    ).resolveHostnames(addressList(2));

    expect(retry.asked).toHaveLength(0);
    expect(result.isTimeBudgetExhausted).toBe(false);
    expect(warnedMessages).toHaveLength(1);
  });

  it("finishes the retry without a warning when the budget allows it", async () => {
    const retry: RecordingLookup = recordingLookup(
      answering("recovered.example.com"),
    );

    await resolverWith(failingWith("ETIMEOUT"), retry.lookup, {
      concurrency: 2,
      totalBudgetInMs: 1000,
      now: steppingClock(100),
    }).resolveHostnames(addressList(6));

    expect(retry.asked).toHaveLength(6);
    expect(warnedMessages).toHaveLength(0);
  });
});

describe("ReverseDnsResolver retry — waves", () => {
  it.each([1, 4])(
    "re-asks at most %i addresses at once, and refills",
    async (concurrency: number) => {
      let inFlight: number = 0;
      let peak: number = 0;

      const retry: RecordingLookup = recordingLookup(
        async (): Promise<Array<string>> => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 1);
          });
          inFlight--;
          return ["recovered.example.com"];
        },
      );

      const result: ReverseDnsResolution = await resolverWith(
        failingWith("ESERVFAIL"),
        retry.lookup,
        { concurrency: concurrency },
      ).resolveHostnames(addressList(10));

      expect(peak).toBe(concurrency);
      expect(retry.asked).toHaveLength(10);
      expect(inFlight).toBe(0);
      expect(result.hostnameByIpAddress.size).toBe(10);
    },
  );

  it("starts the retry only once the whole first pass has settled", async () => {
    /*
     * A retry that overlapped the first pass would re-ask an address while
     * its neighbours' first attempts were still deciding the breaker — the
     * counters must be complete when the retry's decision is taken.
     */
    const events: Array<string> = [];

    await resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        events.push(`first ${ipAddress}`);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
        throw fakeDnsError("ETIMEOUT");
      },
      async (ipAddress: string): Promise<Array<string>> => {
        events.push(`retry ${ipAddress}`);
        return ["recovered.example.com"];
      },
      { concurrency: 2 },
    ).resolveHostnames(addressList(4));

    expect(events).toEqual([
      "first 10.0.0.1",
      "first 10.0.0.2",
      "first 10.0.0.3",
      "first 10.0.0.4",
      "retry 10.0.0.1",
      "retry 10.0.0.2",
      "retry 10.0.0.3",
      "retry 10.0.0.4",
    ]);
  });
});

describe("ReverseDnsResolver retry — the default wiring", () => {
  it("retries through the real retry lookup when neither lookup is injected", async () => {
    /*
     * The constructor's DEFAULT path, exercised because it is the path the
     * probe runs: SubnetScanner builds this class with no
     * lookup at all. A default that forgot the retry would leave every test
     * above green and ship a probe that never retries.
     *
     * The Resolver CLASS is replaced, so no query can leave the machine: every
     * "new dns.promises.Resolver" the defaults make returns a fake that
     * times out on the first attempt and answers on the second. `lookup` is
     * passed explicitly as undefined — the same thing as omitting it — so
     * the construction is visibly the default one.
     */
    const created: Array<FakeReverseDnsResolver> = [];
    const attemptsByName: Map<string, number> = new Map<string, number>();

    jest.spyOn(dns.promises, "Resolver").mockImplementation(((options?: {
      timeout?: number;
    }): FakeReverseDnsResolver => {
      const resolver: FakeReverseDnsResolver = fakeReverseDnsResolver(
        {
          servers: ["192.0.2.53"],
          resolvePtr: (hostname: string): Promise<Array<string>> => {
            const attempt: number = (attemptsByName.get(hostname) ?? 0) + 1;
            attemptsByName.set(hostname, attempt);

            return attempt === 1
              ? Promise.reject(fakeDnsError("ETIMEOUT"))
              : Promise.resolve(["kds-01.wbhq.example"]);
          },
        },
        options?.timeout ?? 0,
      );
      created.push(resolver);
      return resolver;
    }) as never);

    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: undefined,
    }).resolveHostnames(["10.16.42.51"]);

    expect(result.hostnameByIpAddress.get("10.16.42.51")).toBe(
      "kds-01.wbhq.example",
    );

    /*
     * The first pass: one resolver at two seconds. The retry: one at four
     * to read the configuration, and one per configured server, pinned to it.
     */
    expect(
      created.map((resolver: FakeReverseDnsResolver): number => {
        return resolver.timeoutInMs;
      }),
    ).toEqual([
      2000,
      DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
      DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
    ]);
    expect(created[2]!.servers).toEqual(["192.0.2.53"]);
    expect(created[2]!.calls).toEqual([
      { method: "setServers", argument: ["192.0.2.53"] },
      { method: "resolvePtr", argument: "51.42.16.10.in-addr.arpa" },
    ]);
  });

  it("never retries with less patience than the first attempt had: a six-second first pass retries at six seconds", async () => {
    /*
     * The constructor's Math.max. With the shipped two-second first pass it
     * and the four-second retry default agree, so only a first-pass timeout
     * ABOVE the retry's default shows which one wins: the retry's resolvers
     * must be built with the longer of the two, or a slow answer would be
     * asked again with less patience than it failed with.
     *
     * The hosts file is injected empty so nothing of this machine's
     * /etc/hosts can name the address; the DNS wiring stays the default.
     */
    const created: Array<FakeReverseDnsResolver> = [];
    const attemptsByName: Map<string, number> = new Map<string, number>();

    jest.spyOn(dns.promises, "Resolver").mockImplementation(((options?: {
      timeout?: number;
    }): FakeReverseDnsResolver => {
      const resolver: FakeReverseDnsResolver = fakeReverseDnsResolver(
        {
          servers: ["192.0.2.53"],
          resolvePtr: (hostname: string): Promise<Array<string>> => {
            const attempt: number = (attemptsByName.get(hostname) ?? 0) + 1;
            attemptsByName.set(hostname, attempt);

            return attempt === 1
              ? Promise.reject(fakeDnsError("ETIMEOUT"))
              : Promise.resolve(["kds-01.wbhq.example"]);
          },
        },
        options?.timeout ?? 0,
      );
      created.push(resolver);
      return resolver;
    }) as never);

    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: undefined,
      hostsFileLookup: (): undefined => {
        return undefined;
      },
      timeoutInMs: 6000,
    }).resolveHostnames(["10.16.42.51"]);

    expect(result.hostnameByIpAddress.get("10.16.42.51")).toBe(
      "kds-01.wbhq.example",
    );
    expect(6000).toBeGreaterThan(DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS);
    // First pass, then the retry's configuration read and its pinned attempt.
    expect(
      created.map((resolver: FakeReverseDnsResolver): number => {
        return resolver.timeoutInMs;
      }),
    ).toEqual([6000, 6000, 6000]);
  });

  it("pins the default first attempt to the primary when the probe has several nameservers", async () => {
    /*
     * #3916: the Helm chart's pod DNS, with the cluster DNS refusing. The
     * first attempt is asked of the primary ALONE — so its failure is the
     * primary's, and is retried — and only the retry walk goes on to the
     * others, where the secondary may still name the host.
     */
    const created: Array<FakeReverseDnsResolver> = [];

    jest.spyOn(dns.promises, "Resolver").mockImplementation(((options?: {
      timeout?: number;
    }): FakeReverseDnsResolver => {
      const resolver: FakeReverseDnsResolver = fakeReverseDnsResolver(
        {
          servers: ["192.0.2.53", "192.0.2.54"],
          resolvePtr: (
            _hostname: string,
            asking: FakeReverseDnsResolver,
          ): Promise<Array<string>> => {
            return asking.servers.join(",") === "192.0.2.54"
              ? Promise.resolve(["kds-01.wbhq.example"])
              : Promise.reject(fakeDnsError("ECONNREFUSED"));
          },
        },
        options?.timeout ?? 0,
      );
      created.push(resolver);
      return resolver;
    }) as never);

    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: undefined,
      hostsFileLookup: (): undefined => {
        return undefined;
      },
    }).resolveHostnames(["10.16.42.51"]);

    expect(created[0]!.timeoutInMs).toBe(2000);
    expect(created[0]!.calls).toEqual([
      { method: "getServers" },
      { method: "setServers", argument: ["192.0.2.53"] },
      { method: "resolvePtr", argument: "51.42.16.10.in-addr.arpa" },
    ]);
    expect(result.hostnameByIpAddress.get("10.16.42.51")).toBe(
      "kds-01.wbhq.example",
    );
  });
});

/*
 * ONE INSTANCE, TWO PASSES (#3916, the final review).
 *
 * The rescue lookup remembers which servers have named a private address,
 * asks them first and believes their "no record"; the walks remember which
 * servers the resolver would not pin. Both are facts about ONE pass's
 * network. Built once per instance, they outlived the pass: an instance
 * reused for a second sweep went on trusting a server for what it had done
 * in the first, and with a dead primary filed every host of the second sweep
 * as "no PTR record" on that server's word alone. The constructor now keeps
 * BUILDERS and each pass builds its own lookups. SubnetScanner builds an
 * instance per pass, so this was latent there — but the class is public,
 * and its comments promised it.
 */
describe("ReverseDnsResolver — one instance, two passes: each pass learns its own network", () => {
  const PRIMARY: string = "192.0.2.53";
  const SECONDARY: string = "192.0.2.54";
  const TERTIARY: string = "192.0.2.55";

  interface SentQuery {
    pass: number;
    server: string;
    name: string;
    timeoutInMs: number;
  }

  /*
   * The Resolver class, replaced: three nameservers, the primary dead
   * (every query times out), the secondary knowing nothing (NXDOMAIN), and
   * the tertiary holding the private zones only while `network` says so.
   */
  function mockThreeServerNetwork(
    network: { pass: number; isTertiaryNaming: boolean },
    sent: Array<SentQuery>,
  ): void {
    jest.spyOn(dns.promises, "Resolver").mockImplementation(((options?: {
      timeout?: number;
    }): FakeReverseDnsResolver => {
      return fakeReverseDnsResolver(
        {
          servers: [PRIMARY, SECONDARY, TERTIARY],
          resolvePtr: (
            hostname: string,
            resolver: FakeReverseDnsResolver,
          ): Promise<Array<string>> => {
            const server: string = resolver.servers.join(",");

            sent.push({
              pass: network.pass,
              server: server,
              name: hostname,
              timeoutInMs: resolver.timeoutInMs,
            });

            if (server === PRIMARY) {
              return Promise.reject(fakeDnsError("ETIMEOUT"));
            }

            if (server === TERTIARY && network.isTertiaryNaming) {
              return Promise.resolve([`kds-${hostname.split(".")[0]}.example`]);
            }

            if (server === SECONDARY || server === TERTIARY) {
              return Promise.reject(fakeDnsError("ENOTFOUND"));
            }

            return Promise.reject(new Error(`unpinned query to ${server}`));
          },
        },
        options?.timeout ?? 0,
      );
    }) as never);
  }

  function defaultWiredResolver(): ReverseDnsResolver {
    return new ReverseDnsResolver({
      lookup: undefined,
      hostsFileLookup: (): undefined => {
        return undefined;
      },
    });
  }

  function sweep(thirdOctet: number): Array<string> {
    return Array.from(
      { length: 100 },
      (_unused: unknown, index: number): string => {
        return `10.16.${thirdOctet}.${index + 1}`;
      },
    );
  }

  function statusTally(result: ReverseDnsResolution): Record<string, number> {
    const tally: Record<string, number> = {};

    for (const status of result.statusByIpAddress!.values()) {
      tally[status] = (tally[status] ?? 0) + 1;
    }

    return tally;
  }

  it("does not carry a server's trust from one pass into the next: its walk order or its 'no record'", async () => {
    const network: { pass: number; isTertiaryNaming: boolean } = {
      pass: 1,
      isTertiaryNaming: true,
    };
    const sent: Array<SentQuery> = [];

    mockThreeServerNetwork(network, sent);

    const resolver: ReverseDnsResolver = defaultWiredResolver();

    /*
     * Pass one: the breaker trips on the dead primary, the rescue asks the
     * canaries of the secondary (nothing), then the tertiary — which names
     * them, a private address each, and so earns the rest of THIS pass.
     */
    const first: ReverseDnsResolution = await resolver.resolveHostnames(
      sweep(40),
    );

    expect(first.hostnameByIpAddress.size).toBe(100);

    /*
     * Pass two, same instance: the tertiary has lost the zones. It has
     * named nothing THIS pass, so it is neither asked first nor believed.
     */
    network.pass = 2;
    network.isTertiaryNaming = false;

    const second: ReverseDnsResolution = await resolver.resolveHostnames(
      sweep(41),
    );

    // The first canary's rescue walk: configured order, primary last.
    expect(
      sent
        .filter((query: SentQuery): boolean => {
          return (
            query.pass === 2 &&
            query.name === "1.41.16.10.in-addr.arpa" &&
            query.timeoutInMs === DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS
          );
        })
        .map((query: SentQuery): string => {
          return query.server;
        }),
    ).toEqual([SECONDARY, TERTIARY, PRIMARY]);

    /*
     * So nothing rescues pass two: no host is "no PTR record" on the
     * tertiary's word, and the pass stops as a probe whose DNS gave no
     * answer — 64 first-pass timeouts and the two canaries asked out of
     * turn, the rest skipped.
     */
    expect(statusTally(second)).toEqual({
      [DiscoveredHostReverseDnsStatus.Timeout]: 66,
      [DiscoveredHostReverseDnsStatus.SkippedNoResolver]: 34,
    });
    expect(second.isReverseDnsAvailable).toBe(false);

    // Exactly what a FRESH instance makes of the same network.
    network.pass = 3;

    const fresh: ReverseDnsResolution =
      await defaultWiredResolver().resolveHostnames(sweep(41));

    expect(statusTally(fresh)).toEqual(statusTally(second));
    expect(fresh.isReverseDnsAvailable).toBe(second.isReverseDnsAvailable);
  });

  it("builds the rescue lookup again for every pass: pass two must earn the trust pass one had", async () => {
    /*
     * The same network both times. Pass one ends asking the tertiary FIRST
     * (it has named something); pass two starts, as pass one did, with the
     * secondary — the order of a lookup that has learned nothing yet.
     */
    const network: { pass: number; isTertiaryNaming: boolean } = {
      pass: 1,
      isTertiaryNaming: true,
    };
    const sent: Array<SentQuery> = [];

    mockThreeServerNetwork(network, sent);

    const resolver: ReverseDnsResolver = defaultWiredResolver();

    await resolver.resolveHostnames(sweep(40));

    network.pass = 2;

    const second: ReverseDnsResolution = await resolver.resolveHostnames(
      sweep(41),
    );

    expect(second.hostnameByIpAddress.size).toBe(100);

    // The servers the pass's thorough (rescue and retry) queries went to.
    const thoroughServers: (pass: number) => Array<string> = (
      pass: number,
    ): Array<string> => {
      return sent
        .filter((query: SentQuery): boolean => {
          return (
            query.pass === pass &&
            query.timeoutInMs === DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS
          );
        })
        .map((query: SentQuery): string => {
          return query.server;
        });
    };

    for (const pass of [1, 2]) {
      const servers: Array<string> = thoroughServers(pass);

      // Each pass's first thorough query goes to the secondary...
      expect(servers[0]).toBe(SECONDARY);
      // ...and its last to the tertiary, which by then it has come to trust.
      expect(servers[servers.length - 1]).toBe(TERTIARY);
    }
  });
});

/*
 * THE BREAKER RESCUE (#3916): a probe host whose FIRST nameserver is down
 * while the second works. The first-try lookup gives every address two
 * seconds on the first server and c-ares only moves on after that server's
 * whole timeout, so every first-try lookup fails and — past sixty-four of
 * them — the breaker used to conclude the probe had no DNS at all and list a
 * whole sweep by address. Before it stops now, it asks three CANARIES the
 * thorough way, side by side, and if ANY of them comes back the rest of the
 * pass — its remaining waves and its retry pass — is made that way.
 *
 * The canaries are the first address that failed, the NEXT address the pass
 * has not asked yet and the LAST address of the sweep. Not the first, middle
 * and last FAILED ones, as they were: those all sit in the sixty-four the
 * breaker has just seen fail, so one silent zone at the bottom of the range
 * spoke for all of it, and a single nameserver silent on 10.16.40.0/24 hid
 * every healthy host behind it. The two not yet asked are asked OUT OF TURN:
 * counted as looked up at once, skipped by their own wave, and left for the
 * retry pass if they do not come back. Their own suite is
 * ReverseDnsResolverCanaries.test.ts.
 */
describe("ReverseDnsResolver breaker rescue — a dead first nameserver behind a working second", () => {
  function nameFor(ipAddress: string): string {
    return `host-${ipAddress.replace(/\./g, "-")}.wbhq.example`;
  }

  function answeringEach(): (ipAddress: string) => Promise<Array<string>> {
    return (ipAddress: string): Promise<Array<string>> => {
      return Promise.resolve([nameFor(ipAddress)]);
    };
  }

  it("names every host of a hundred-host sweep whose first tries all failed", async () => {
    const addresses: Array<string> = addressList(100);
    const first: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));
    const retry: RecordingLookup = recordingLookup(answeringEach());

    const result: ReverseDnsResolution = await resolverWith(
      first.lookup,
      retry.lookup,
      { concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY },
    ).resolveHostnames(addresses);

    for (const ipAddress of addresses) {
      expect(result.hostnameByIpAddress.get(ipAddress)).toBe(
        nameFor(ipAddress),
      );
    }

    expect(result.statusByIpAddress!.size).toBe(0);
    expect(result.failedAddressCount).toBe(0);
    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.isTimeBudgetExhausted).toBe(false);
    expect(result.lookedUpCount).toBe(100);
    expect(result.notLookedUpCount).toBe(0);
  });

  it("asks the first-try lookup only until the rescue, and every address thoroughly exactly once", async () => {
    const addresses: Array<string> = addressList(100);
    const first: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));
    const retry: RecordingLookup = recordingLookup(answeringEach());

    await resolverWith(first.lookup, retry.lookup, {
      concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY,
    }).resolveHostnames(addresses);

    /*
     * Two waves on the fast path — the sixty-four that tripped the breaker
     * — and never again once the pass switched.
     */
    expect(first.asked).toEqual(addresses.slice(0, 64));

    /*
     * The three canaries; then the thirty-four the switched first pass asked
     * — its waves skip the two canaries it had not reached, which were asked
     * out of turn; then the sixty-three other first-wave failures, asked
     * again by the retry pass. No address twice: a canary that came back is
     * not left for the retry pass, one asked out of turn is not asked again
     * by its wave, and an address the switched pass named is not retried.
     */
    expect(retry.asked.slice(0, 3)).toEqual([
      addresses[0],
      addresses[64],
      addresses[99],
    ]);
    expect(retry.asked.slice(3, 37)).toEqual(addresses.slice(65, 99));
    expect(retry.asked.slice(37)).toEqual(addresses.slice(1, 64));
    expect(new Set<string>(retry.asked).size).toBe(retry.asked.length);
    expect(retry.asked).toHaveLength(100);
  });

  it("says once, at warn, what the rescue did and that the first nameserver may be down or slow", async () => {
    /*
     * Worded for everything that rescues a pass (#3916), not only a dead
     * primary behind a working secondary: a single nameserver that answers
     * the thorough attempt after two seconds rescues it too, and a log line
     * saying "another nameserver answered" would send the operator looking
     * for a second server that does not exist.
     */
    await resolverWith(failingWith("ETIMEOUT"), answering("x.example"), {
      concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY,
    }).resolveHostnames(addressList(100));

    expect(warnedMessages).toHaveLength(1);
    expect(warnedMessages[0]).toContain(
      "the first 64 lookup(s) got no answer within the first attempt's time limit",
    );
    expect(warnedMessages[0]).toContain(
      "asking again - each nameserver in turn, with a longer timeout - got one",
    );
    expect(warnedMessages[0]).toContain(
      "The probe's first nameserver may be down, unreachable or slow.",
    );
    expect(warnedMessages[0]).not.toContain("another nameserver answered");
    expect(warnedMessages[0]).not.toContain("not usable from this probe");
  });

  it("switches on NXDOMAIN too: any answer the rescue lookup stands by proves DNS works from here", async () => {
    /*
     * The rescue lookup only rejects with "no record" when a server it
     * TRUSTS said so (buildDefaultRescueLookup: the primary, or a server
     * that has named a private address): a public fallback's NXDOMAIN after
     * a dead primary comes back as the primary's timeout instead, and
     * rescues nothing — ReverseDnsResolverRealRescue.test.ts.
     */
    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      failingWith("ENOTFOUND"),
      { concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY },
    ).resolveHostnames(addressList(100));

    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.failedAddressCount).toBe(0);
    expect(result.lookedUpCount).toBe(100);
    expect(
      [...result.statusByIpAddress!.values()].every(
        (status: DiscoveredHostReverseDnsStatus): boolean => {
          return status === DiscoveredHostReverseDnsStatus.NoRecord;
        },
      ),
    ).toBe(true);
    expect(result.statusByIpAddress!.size).toBe(100);
  });

  it("asks again, in the retry pass, every address the switched pass failed: that was its FIRST attempt", async () => {
    /*
     * #3916, the final review. This used to be the opposite rule — an
     * address the switched pass had asked "had had the thorough attempt"
     * and was never retried. On a probe with ONE nameserver the rescue
     * lookup is simply one longer query to that same server, so a single
     * lost datagram past the sixty-fourth host was the end of that host:
     * 64 of 100 named where one datagram per host was dropped, 3 of 1,000.
     * Every address now gets a first attempt and a retry, whichever lookup
     * made the first.
     */
    const addresses: Array<string> = addressList(100);
    const first: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));
    const retry: RecordingLookup = recordingLookup(
      (ipAddress: string): Promise<Array<string>> => {
        /*
         * The first sixty-four — the first canary among them — answer;
         * every address the pass reaches after the rescue (index 64 on,
         * the two out-of-turn canaries included) times out even the
         * thorough way, both times it is asked.
         */
        if (addresses.indexOf(ipAddress) < 64) {
          return Promise.resolve([
            `ok-${addresses.indexOf(ipAddress)}.example`,
          ]);
        }

        return Promise.reject(fakeDnsError("ETIMEOUT"));
      },
    );

    const result: ReverseDnsResolution = await resolverWith(
      first.lookup,
      retry.lookup,
      { concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY },
    ).resolveHostnames(addresses);

    // The fast lookup only ever saw the two waves before the rescue.
    expect(first.asked).toEqual(addresses.slice(0, 64));

    for (const ipAddress of addresses.slice(64)) {
      // Once by the switched pass (or as a canary), once by the retry pass.
      expect(
        retry.asked.filter((asked: string): boolean => {
          return asked === ipAddress;
        }),
      ).toHaveLength(2);
      expect(result.statusByIpAddress!.get(ipAddress)).toBe(
        DiscoveredHostReverseDnsStatus.Timeout,
      );
    }

    expect(result.hostnameByIpAddress.size).toBe(64);
    expect(result.failedAddressCount).toBe(36);
    expect(result.isReverseDnsAvailable).toBe(true);
  });

  it("asks the deadline again after the rescue, so a slow rescue cannot also start a wave past it", async () => {
    /*
     * The rescue can take a whole retry lookup — up to fifteen seconds on a
     * resolver with three silent servers. A pass that re-launched a wave
     * after it without looking at the clock could overrun by the rescue AND
     * a wave. Here the clock jumps past the deadline while the canaries are
     * being asked.
     */
    const clock: { now: number } = { now: 0 };
    const addresses: Array<string> = addressList(100);

    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      (ipAddress: string): Promise<Array<string>> => {
        clock.now += 5000;
        return Promise.resolve([`canary-${ipAddress}.example`]);
      },
      {
        concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY,
        totalBudgetInMs: 1000,
        now: (): number => {
          return clock.now;
        },
      },
    ).resolveHostnames(addresses);

    const canaries: Array<string> = [
      addresses[0]!,
      addresses[64]!,
      addresses[99]!,
    ];

    for (const canary of canaries) {
      expect(result.hostnameByIpAddress.get(canary)).toBe(
        `canary-${canary}.example`,
      );
    }

    /*
     * The two canaries asked out of turn were looked up, and keep their
     * names: the pass stopping behind them does not turn them back into
     * "never asked".
     */
    expect(result.isTimeBudgetExhausted).toBe(true);
    expect(result.lookedUpCount).toBe(66);
    expect(result.notLookedUpCount).toBe(34);
    // The canary's answer disarmed the "no resolver" verdict.
    expect(result.isReverseDnsAvailable).toBe(true);

    for (const ipAddress of addresses.slice(65, 99)) {
      expect(result.statusByIpAddress!.get(ipAddress)).toBe(
        DiscoveredHostReverseDnsStatus.SkippedTimeBudget,
      );
    }

    // The other 61 first-wave failures were never retried: time was up.
    for (const ipAddress of addresses.slice(0, 64)) {
      if (canaries.includes(ipAddress)) {
        continue;
      }

      expect(result.statusByIpAddress!.get(ipAddress)).toBe(
        DiscoveredHostReverseDnsStatus.Timeout,
      );
    }
  });

  it("asks three canaries — the first failed address, the next unasked one and the last — side by side", async () => {
    /*
     * Two of them from BEYOND the failed range, so one dead zone at the
     * bottom of the sweep cannot speak for the rest; the first and middle
     * failed address used to be two of the three, and a silent zone of
     * sixty-four held every one of them. Concurrent so three cost one walk:
     * the rescue's time is part of the most a pass can overrun its budget
     * by.
     */
    const addresses: Array<string> = addressList(100);
    const settledBeforeStart: Array<number> = [];
    const progress: { settled: number } = { settled: 0 };

    const retry: RecordingLookup = recordingLookup(
      async (ipAddress: string): Promise<Array<string>> => {
        settledBeforeStart.push(progress.settled);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 1);
        });
        progress.settled++;
        return [nameFor(ipAddress)];
      },
    );

    await resolverWith(failingWith("ETIMEOUT"), retry.lookup, {
      concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY,
    }).resolveHostnames(addresses);

    expect(retry.asked.slice(0, 3)).toEqual([
      addresses[0],
      addresses[64],
      addresses[99],
    ]);
    // All three were started before any of them came back.
    expect(settledBeforeStart.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("rescues the pass when only ONE canary comes back, and leaves a silent one for the retry pass", async () => {
    /*
     * The first two canaries — the first failed address, and the next one
     * the pass had not asked, asked out of turn — sit in a zone that never
     * answers; the last one is named. One is enough: DNS works from here.
     * The silent two have not been answered, so the retry pass asks them
     * again — by then the retry knows which servers are dead — while the
     * one that came back is not asked twice. The out-of-turn one is left for
     * the retry pass exactly as the one that had already failed is: its own
     * wave skipped it.
     */
    const addresses: Array<string> = addressList(100);
    const silent: Array<string> = [addresses[0]!, addresses[64]!];

    const retry: RecordingLookup = recordingLookup(
      (ipAddress: string): Promise<Array<string>> => {
        return silent.includes(ipAddress)
          ? Promise.reject(fakeDnsError("ETIMEOUT"))
          : Promise.resolve([nameFor(ipAddress)]);
      },
    );

    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      retry.lookup,
      { concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY },
    ).resolveHostnames(addresses);

    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.lookedUpCount).toBe(100);
    expect(result.hostnameByIpAddress.size).toBe(98);

    const timesAsked: (ipAddress: string) => number = (
      ipAddress: string,
    ): number => {
      return retry.asked.filter((asked: string): boolean => {
        return asked === ipAddress;
      }).length;
    };

    expect(timesAsked(addresses[0]!)).toBe(2);
    expect(timesAsked(addresses[64]!)).toBe(2);
    expect(timesAsked(addresses[99]!)).toBe(1);
    expect(result.statusByIpAddress!.get(addresses[0]!)).toBe(
      DiscoveredHostReverseDnsStatus.Timeout,
    );
    expect(result.statusByIpAddress!.get(addresses[64]!)).toBe(
      DiscoveredHostReverseDnsStatus.Timeout,
    );
    expect(result.failedAddressCount).toBe(2);
  });

  it.each(["ESERVFAIL", "EREFUSED"])(
    "does NOT rescue the pass when the canaries only come back %s",
    async (code: string) => {
      /*
       * #3916. A server responding is enough to keep the breaker from firing
       * during the first pass — but at the rescue the question is different:
       * does DNS WORK from here? A SERVFAIL or REFUSED does not say so, and
       * treating it as if it did sent the rest of the pass through a lookup
       * that waited on the failing server for every address until the time
       * budget ran out, then advised raising it. Only a name, or a "no
       * record" the rescue lookup trusts, rescues. The canaries' failures are
       * still recorded as what they were — the two asked out of turn
       * included, which were looked up and are not "never asked".
       */
      const addresses: Array<string> = addressList(100);
      const canaries: Array<string> = [
        addresses[0]!,
        addresses[64]!,
        addresses[99]!,
      ];

      const retry: RecordingLookup = recordingLookup(
        (ipAddress: string): Promise<Array<string>> => {
          return canaries.includes(ipAddress)
            ? Promise.reject(fakeDnsError(code))
            : Promise.resolve([nameFor(ipAddress)]);
        },
      );

      const result: ReverseDnsResolution = await resolverWith(
        failingWith("ETIMEOUT"),
        retry.lookup,
        { concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY },
      ).resolveHostnames(addresses);

      expect(retry.asked).toEqual(canaries);
      expect(result.isReverseDnsAvailable).toBe(false);
      expect(result.lookedUpCount).toBe(66);
      expect(result.notLookedUpCount).toBe(34);
      expect(result.hostnameByIpAddress.size).toBe(0);

      for (const canary of canaries) {
        expect(result.statusByIpAddress!.get(canary)).toBe(
          code === "ESERVFAIL"
            ? DiscoveredHostReverseDnsStatus.ServerFailure
            : DiscoveredHostReverseDnsStatus.Refused,
        );
      }

      expect(warnedMessages).toHaveLength(1);
      expect(warnedMessages[0]).toContain("not usable from this probe");
    },
  );

  it.each([
    // The next address not yet asked is also the last: one canary fewer.
    [1, 2, [0, 1]],
    [1, 10, [0, 1, 9]],
    [2, 10, [0, 2, 9]],
    [3, 10, [0, 3, 9]],
  ])(
    "asks each canary once when %i failed before the breaker of a %i-address sweep (width = budget)",
    async (
      failedCount: number,
      sweepSize: number,
      canaryIndexes: Array<number>,
    ) => {
      /*
       * Distinct, and never an address twice: the canaries are a set, so a
       * sweep with only one address left asks it once, as the "next" and as
       * the "last". Every canary the pass had not reached counts as looked
       * up from the moment it is asked.
       */
      const addresses: Array<string> = addressList(sweepSize);
      const retry: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));

      const result: ReverseDnsResolution = await resolverWith(
        failingWith("ETIMEOUT"),
        retry.lookup,
        { concurrency: failedCount, failureBudget: failedCount },
      ).resolveHostnames(addresses);

      expect(retry.asked).toEqual(
        canaryIndexes.map((index: number): string => {
          return addresses[index]!;
        }),
      );
      expect(result.lookedUpCount).toBe(failedCount + canaryIndexes.length - 1);
      expect(result.lookedUpCount + result.notLookedUpCount).toBe(sweepSize);
      expect(result.isReverseDnsAvailable).toBe(false);
    },
  );

  it("counts as retried only the canaries that had already failed: the ones asked out of turn were a first attempt", async () => {
    /*
     * The debug line reads "retried N address(es) whose first lookup
     * failed". The first canary had failed; the next and last had never
     * been asked, so asking them is their first attempt, not a retry.
     */
    const debugged: Array<string> = [];

    jest
      .spyOn(logger, "debug")
      .mockImplementation((message: unknown): never => {
        debugged.push(String(message));
        return undefined as never;
      });

    await resolverWith(failingWith("ETIMEOUT"), failingWith("ETIMEOUT"), {
      concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY,
    }).resolveHostnames(addressList(100));

    expect(debugged).toHaveLength(1);
    expect(debugged[0]).toContain("retried 1 address(es)");
    // Sixty-four first-pass failures and the two out-of-turn canaries.
    expect(debugged[0]).toContain("66 address(es) are still without an answer");
  });

  it("does not rescue when there is no retry lookup to ask", async () => {
    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ETIMEOUT"),
      undefined,
      { concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY },
    ).resolveHostnames(addressList(100));

    expect(result.isReverseDnsAvailable).toBe(false);
    expect(result.lookedUpCount).toBe(64);
    expect(warnedMessages).toHaveLength(1);
    expect(warnedMessages[0]).toContain("not usable from this probe");
  });

  it("never runs on a pass the breaker does not stop", async () => {
    /*
     * One answer anywhere in the first sixty-four and the breaker never
     * arms, so neither does the rescue: the ordinary retry pass handles the
     * failures after the first pass, in order.
     */
    const addresses: Array<string> = addressList(100);
    const retry: RecordingLookup = recordingLookup(answering("x.example"));

    await resolverWith(
      (ipAddress: string): Promise<Array<string>> => {
        return ipAddress === addresses[5]
          ? Promise.resolve(["only-one.example"])
          : Promise.reject(fakeDnsError("ETIMEOUT"));
      },
      retry.lookup,
      { concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY },
    ).resolveHostnames(addresses);

    expect(retry.asked).toEqual(
      addresses.filter((ipAddress: string): boolean => {
        return ipAddress !== addresses[5];
      }),
    );
    expect(
      warnedMessages.some((message: string): boolean => {
        return message.includes("first nameserver may be down");
      }),
    ).toBe(false);
  });
});
