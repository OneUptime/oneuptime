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
 * Both lookups are injected; NO TEST HERE SENDS A QUERY. The one test of
 * the constructor's DEFAULT wiring replaces the Resolver class itself.
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

  it("skips the retry entirely when the failure budget stopped the first pass", async () => {
    /*
     * A hundred addresses at the shipped width and budget, and not one
     * answer: the breaker stops the pass after two waves (64 failures) and
     * skips the other 36. Retrying the 64 — each server in turn, at twice
     * the timeout — would spend up to a quarter of a minute per wave asking a
     * resolver that has already failed sixty-four times running.
     */
    const retry: RecordingLookup = recordingLookup(
      answering("never.example.com"),
    );

    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ECONNREFUSED"),
      retry.lookup,
      { concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY },
    ).resolveHostnames(addressList(100));

    expect(retry.asked).toHaveLength(0);
    expect(result.isReverseDnsAvailable).toBe(false);
    expect(result.lookedUpCount).toBe(64);
    expect(result.failedAddressCount).toBe(64);
    expect(
      [...result.statusByIpAddress!.values()].filter(
        (status: DiscoveredHostReverseDnsStatus): boolean => {
          return status === DiscoveredHostReverseDnsStatus.SkippedNoResolver;
        },
      ),
    ).toHaveLength(36);
    // One warning: the breaker's. The retry says nothing, because it never ran.
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
    const result: ReverseDnsResolution = await resolverWith(
      failingWith("ESERVFAIL"),
      failingWith("ESERVFAIL"),
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
     * The one place the constructor's DEFAULT path is exercised, because it
     * is the path the probe runs: SubnetScanner builds this class with no
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
});
