// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import ReverseDnsResolver, {
  DEFAULT_REVERSE_DNS_CONCURRENCY,
  FAILED_LOOKUP_STATUSES,
  HostsFileLookup,
  ReverseDnsLookupFunction,
  ReverseDnsResolution,
} from "../../../Utils/Discovery/ReverseDnsResolver";
import { fakeDnsError } from "../../TestingUtils/FakeReverseDnsResolver";
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

/*
 * OneUptime issue #3916, the final review — WHICH addresses the breaker
 * rescue asks, and what becomes of them.
 *
 * The rescue runs when the first pass has met a budget's worth of silence
 * (sixty-four lookups, not one answer) and is about to stop: it asks three
 * CANARIES the thorough way, and if any comes back the rest of the pass is
 * made that way. The canaries used to be the first, middle and last FAILED
 * address — all three inside the sixty-four the breaker had just watched
 * fail. So one nameserver silent on the zone at the bottom of a sweep
 * (10.16.40.0/24, seventy hosts) spoke for every zone above it, and a
 * hundred healthy hosts on 10.16.41.0/24 were never asked: real c-ares
 * named none of them in six runs of six.
 *
 * Now the canaries are the first address that failed, the NEXT address the
 * pass has not asked yet and the LAST address of the sweep. The two not yet
 * asked are asked OUT OF TURN, and four things follow from that, each
 * pinned here because each was a place for the counters to go wrong:
 *
 * - they count as looked up the moment they are asked;
 * - their own wave skips them, so nothing is asked twice in the first pass;
 * - one that does not come back is left for the retry pass, like any first
 *   attempt that failed;
 * - if the pass stops anyway, they keep what they came back with, rather
 *   than being reported as never asked.
 *
 * And one rule the review changed alongside: an address whose first attempt
 * was made through the RESCUE lookup (the rest of a rescued pass) is
 * retried when it fails, like any other. It used to be counted as having
 * had "the thorough attempt"; on a probe with one nameserver that attempt
 * is one longer query to the same server, and a lost datagram past the
 * sixty-fourth host was the end of that host.
 *
 * Every lookup is injected; NO TEST HERE SENDS A QUERY. The same scenarios
 * against real c-ares are ReverseDnsResolverRealBreakerRescue.test.ts.
 */

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation((): never => {
    return undefined as never;
  });
  jest.spyOn(logger, "debug").mockImplementation((): never => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * A lookup scripted per address, recording every address it was asked, in
 * order.
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

function nameFor(ipAddress: string): string {
  return `host-${ipAddress.replace(/\./g, "-")}.wbhq.example`;
}

function answeringEach(ipAddress: string): Promise<Array<string>> {
  return Promise.resolve([nameFor(ipAddress)]);
}

function range(prefix: string, from: number, count: number): Array<string> {
  return Array.from(
    { length: count },
    (_unused: unknown, index: number): string => {
      return `${prefix}.${from + index}`;
    },
  );
}

function timesAsked(lookup: RecordingLookup, ipAddress: string): number {
  return lookup.asked.filter((asked: string): boolean => {
    return asked === ipAddress;
  }).length;
}

/*
 * The three lookups kept apart, so every test can say WHICH one asked what:
 * the fast first try, the ordinary retry (which asks the primary first), and
 * the rescue's (which asks it last).
 */
function resolverWith(data: {
  lookup: RecordingLookup;
  retryLookup: RecordingLookup;
  rescueLookup: RecordingLookup;
  hostsFileLookup?: HostsFileLookup | undefined;
  totalBudgetInMs?: number | undefined;
  now?: (() => number) | undefined;
}): ReverseDnsResolver {
  return new ReverseDnsResolver({
    lookup: data.lookup.lookup,
    retryLookup: data.retryLookup.lookup,
    rescueLookup: data.rescueLookup.lookup,
    hostsFileLookup: data.hostsFileLookup,
    concurrency: DEFAULT_REVERSE_DNS_CONCURRENCY,
    totalBudgetInMs: data.totalBudgetInMs,
    now: data.now,
  });
}

function statusTally(result: ReverseDnsResolution): Record<string, number> {
  const tally: Record<string, number> = {};

  for (const status of result.statusByIpAddress!.values()) {
    tally[status] = (tally[status] ?? 0) + 1;
  }

  return tally;
}

/*
 * What every pass owes its caller, whatever it did: every distinct input in
 * exactly one of the two maps, the looked-up and never-looked-up counts
 * adding up to the distinct inputs, and the failed count being exactly the
 * failure statuses. An out-of-turn canary is the easiest thing in the pass
 * to count twice, or not at all.
 */
function expectPartition(
  result: ReverseDnsResolution,
  input: Array<string>,
): void {
  const distinct: Array<string> = [...new Set<string>(input)];
  const named: Array<string> = [...result.hostnameByIpAddress.keys()];
  const explained: Array<string> = [...result.statusByIpAddress!.keys()];

  expect([...named, ...explained].sort()).toEqual([...distinct].sort());
  expect(result.lookedUpCount + result.notLookedUpCount).toBe(distinct.length);
  expect(result.failedAddressCount).toBe(
    [...result.statusByIpAddress!.values()].filter(
      (status: DiscoveredHostReverseDnsStatus): boolean => {
        return FAILED_LOOKUP_STATUSES.has(status);
      },
    ).length,
  );
  expect(result.notLookedUpCount).toBe(
    [...result.statusByIpAddress!.values()].filter(
      (status: DiscoveredHostReverseDnsStatus): boolean => {
        return (
          status === DiscoveredHostReverseDnsStatus.SkippedNoResolver ||
          status === DiscoveredHostReverseDnsStatus.SkippedTimeBudget
        );
      },
    ).length,
  );
}

const HUNDRED: Array<string> = range("10.16.44", 1, 100);

describe("ReverseDnsResolver breaker rescue — canaries from beyond the silent range", () => {
  // Seventy hosts in a zone the nameserver never answers, then a hundred it does.
  const SILENT_ZONE: Array<string> = range("10.16.40", 1, 70);
  const HEALTHY_ZONE: Array<string> = range("10.16.41", 1, 100);
  const SWEEP: Array<string> = [...SILENT_ZONE, ...HEALTHY_ZONE];

  function silentZoneThenHealthyZone(
    ipAddress: string,
  ): Promise<Array<string>> {
    return ipAddress.startsWith("10.16.40.")
      ? Promise.reject(fakeDnsError("ETIMEOUT"))
      : answeringEach(ipAddress);
  }

  it("names the hundred healthy hosts behind a silent zone of seventy at the bottom of the sweep", async () => {
    const first: RecordingLookup = recordingLookup(silentZoneThenHealthyZone);
    const retry: RecordingLookup = recordingLookup(silentZoneThenHealthyZone);
    const rescue: RecordingLookup = recordingLookup(silentZoneThenHealthyZone);

    const result: ReverseDnsResolution = await resolverWith({
      lookup: first,
      retryLookup: retry,
      rescueLookup: rescue,
    }).resolveHostnames(SWEEP);

    // The breaker saw sixty-four silent lookups, every one in the zone.
    expect(first.asked).toEqual(SILENT_ZONE.slice(0, 64));

    /*
     * The first failed address and the next unasked are in the silent zone
     * too; the LAST address of the sweep is not, and is named — which is
     * all the rescue needs.
     */
    expect(rescue.asked.slice(0, 3)).toEqual([
      SILENT_ZONE[0],
      SILENT_ZONE[64],
      HEALTHY_ZONE[99],
    ]);

    for (const ipAddress of HEALTHY_ZONE) {
      expect(result.hostnameByIpAddress.get(ipAddress)).toBe(
        nameFor(ipAddress),
      );
    }

    expect(statusTally(result)).toEqual({
      [DiscoveredHostReverseDnsStatus.Timeout]: 70,
    });
    expect(result.failedAddressCount).toBe(70);
    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.isTimeBudgetExhausted).toBe(false);
    expect(result.lookedUpCount).toBe(170);
    expect(result.notLookedUpCount).toBe(0);
    expectPartition(result, SWEEP);
  });

  it("leaves a silent out-of-turn canary for the retry pass, and never asks a named one again", async () => {
    const first: RecordingLookup = recordingLookup(silentZoneThenHealthyZone);
    const retry: RecordingLookup = recordingLookup(silentZoneThenHealthyZone);
    const rescue: RecordingLookup = recordingLookup(silentZoneThenHealthyZone);

    await resolverWith({
      lookup: first,
      retryLookup: retry,
      rescueLookup: rescue,
    }).resolveHostnames(SWEEP);

    // Silent: asked as a canary, then once more by the retry pass.
    expect(timesAsked(rescue, SILENT_ZONE[64]!)).toBe(2);
    // Named as a canary: asked once, in all.
    expect(timesAsked(rescue, HEALTHY_ZONE[99]!)).toBe(1);
    // Neither was ever asked by the fast lookup, nor by its own wave.
    expect(timesAsked(first, SILENT_ZONE[64]!)).toBe(0);
    expect(timesAsked(first, HEALTHY_ZONE[99]!)).toBe(0);

    /*
     * A rescued pass retries through the RESCUE lookup: the ordinary retry
     * asks the primary first, and on a rescued pass the primary is the
     * server that has just been silent sixty-four times.
     */
    expect(retry.asked).toEqual([]);
  });
});

describe("ReverseDnsResolver breaker rescue — an out-of-turn canary is asked once and counted once", () => {
  it("skips an out-of-turn canary in its own wave, and counts it as looked up exactly once", async () => {
    const first: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));
    const retry: RecordingLookup = recordingLookup(answeringEach);
    const rescue: RecordingLookup = recordingLookup(answeringEach);

    const result: ReverseDnsResolution = await resolverWith({
      lookup: first,
      retryLookup: retry,
      rescueLookup: rescue,
    }).resolveHostnames(HUNDRED);

    expect(rescue.asked.slice(0, 3)).toEqual([
      HUNDRED[0],
      HUNDRED[64],
      HUNDRED[99],
    ]);

    // Every address asked thoroughly exactly once: no canary twice.
    expect(rescue.asked).toHaveLength(100);
    expect(new Set<string>(rescue.asked).size).toBe(100);
    expect(first.asked).toEqual(HUNDRED.slice(0, 64));

    // Counted once each: a wave that also counted them would make this 102.
    expect(result.lookedUpCount).toBe(100);
    expect(result.notLookedUpCount).toBe(0);
    expect(result.hostnameByIpAddress.size).toBe(100);
    expectPartition(result, HUNDRED);
  });

  it.each([
    ["ETIMEOUT", DiscoveredHostReverseDnsStatus.Timeout],
    ["ECONNREFUSED", DiscoveredHostReverseDnsStatus.Unreachable],
    ["ESERVFAIL", DiscoveredHostReverseDnsStatus.ServerFailure],
    ["EREFUSED", DiscoveredHostReverseDnsStatus.Refused],
  ])(
    "keeps an out-of-turn canary's own %s when the rescue fails, instead of calling it never asked",
    async (code: string, status: DiscoveredHostReverseDnsStatus) => {
      /*
       * The rescue fails, so the pass stops as it always did on a probe with
       * no DNS. But the next and the last address WERE asked, and what they
       * came back with is what the dashboard should explain — "the probe's
       * DNS server did not answer", not "the pass never got to this host".
       */
      const first: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));
      const retry: RecordingLookup = recordingLookup(answeringEach);
      const rescue: RecordingLookup = recordingLookup(failingWith(code));

      const result: ReverseDnsResolution = await resolverWith({
        lookup: first,
        retryLookup: retry,
        rescueLookup: rescue,
      }).resolveHostnames(HUNDRED);

      expect(rescue.asked).toEqual([HUNDRED[0], HUNDRED[64], HUNDRED[99]]);
      expect(retry.asked).toEqual([]);

      expect(result.statusByIpAddress!.get(HUNDRED[64]!)).toBe(status);
      expect(result.statusByIpAddress!.get(HUNDRED[99]!)).toBe(status);
      // The first canary had failed already; its retry's answer is its status.
      expect(result.statusByIpAddress!.get(HUNDRED[0]!)).toBe(status);

      for (const ipAddress of HUNDRED.slice(65, 99)) {
        expect(result.statusByIpAddress!.get(ipAddress)).toBe(
          DiscoveredHostReverseDnsStatus.SkippedNoResolver,
        );
      }

      expect(result.isReverseDnsAvailable).toBe(false);
      expect(result.lookedUpCount).toBe(66);
      expect(result.notLookedUpCount).toBe(34);
      expect(result.failedAddressCount).toBe(66);
      expect(result.hostnameByIpAddress.size).toBe(0);
      expectPartition(result, HUNDRED);
    },
  );

  it("keeps an out-of-turn canary's NAME when the wall clock stops the pass right behind the rescue", async () => {
    // The clock jumps past the deadline while the canaries are being asked.
    const clock: { now: number } = { now: 0 };
    const first: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));
    const retry: RecordingLookup = recordingLookup(answeringEach);
    const rescue: RecordingLookup = recordingLookup(
      (ipAddress: string): Promise<Array<string>> => {
        clock.now += 5000;
        return answeringEach(ipAddress);
      },
    );

    const result: ReverseDnsResolution = await resolverWith({
      lookup: first,
      retryLookup: retry,
      rescueLookup: rescue,
      totalBudgetInMs: 1000,
      now: (): number => {
        return clock.now;
      },
    }).resolveHostnames(HUNDRED);

    expect(result.isTimeBudgetExhausted).toBe(true);
    expect(result.hostnameByIpAddress.get(HUNDRED[64]!)).toBe(
      nameFor(HUNDRED[64]!),
    );
    expect(result.hostnameByIpAddress.get(HUNDRED[99]!)).toBe(
      nameFor(HUNDRED[99]!),
    );
    expect(statusTally(result)).toEqual({
      // The sixty-three first-wave failures the retry pass had no time for.
      [DiscoveredHostReverseDnsStatus.Timeout]: 63,
      [DiscoveredHostReverseDnsStatus.SkippedTimeBudget]: 34,
    });
    expect(result.lookedUpCount).toBe(66);
    expectPartition(result, HUNDRED);
  });
});

describe("ReverseDnsResolver breaker rescue — canaries are drawn from what DNS would ask", () => {
  /*
   * The hosts file names some addresses before any query (#3916); those are
   * never asked of DNS, so they are never canaries either — and the
   * addresses the pass skips are counted from where its WAVES stopped, not
   * from how many addresses it has counted as looked up, which the hosts
   * file and the out-of-turn canaries both add to.
   */
  const LISTED: Record<string, Array<string>> = {
    [HUNDRED[64]!]: ["kds64.wbhq.example"],
    [HUNDRED[99]!]: ["kds99.wbhq.example"],
  };

  const hostsFile: HostsFileLookup = (
    ipAddress: string,
  ): Array<string> | undefined => {
    return LISTED[ipAddress];
  };

  // Duplicates are one address; the counts are of distinct addresses.
  const INPUT: Array<string> = [
    ...HUNDRED,
    HUNDRED[0]!,
    HUNDRED[64]!,
    HUNDRED[65]!,
  ];

  it("skips the addresses the hosts file named when it picks the next and last canary", async () => {
    const first: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));
    const retry: RecordingLookup = recordingLookup(answeringEach);
    const rescue: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));

    const result: ReverseDnsResolution = await resolverWith({
      lookup: first,
      retryLookup: retry,
      rescueLookup: rescue,
      hostsFileLookup: hostsFile,
    }).resolveHostnames(INPUT);

    // .64 and .99 are named from the file: .65 and .98 are the canaries.
    expect(rescue.asked).toEqual([HUNDRED[0], HUNDRED[65], HUNDRED[98]]);
    expect(first.asked).toEqual(HUNDRED.slice(0, 64));

    expect(result.hostnameByIpAddress.get(HUNDRED[64]!)).toBe(
      "kds64.wbhq.example",
    );
    expect(result.hostnameByIpAddress.get(HUNDRED[99]!)).toBe(
      "kds99.wbhq.example",
    );
    expect(result.statusByIpAddress!.get(HUNDRED[65]!)).toBe(
      DiscoveredHostReverseDnsStatus.Timeout,
    );
    expect(result.statusByIpAddress!.get(HUNDRED[98]!)).toBe(
      DiscoveredHostReverseDnsStatus.Timeout,
    );

    for (const ipAddress of HUNDRED.slice(66, 98)) {
      expect(result.statusByIpAddress!.get(ipAddress)).toBe(
        DiscoveredHostReverseDnsStatus.SkippedNoResolver,
      );
    }

    // Two from the file, sixty-four first tries, two canaries out of turn.
    expect(result.lookedUpCount).toBe(68);
    expect(result.notLookedUpCount).toBe(32);
    expect(result.failedAddressCount).toBe(66);
    expectPartition(result, INPUT);
  });

  it("asks everything else once when the rescue succeeds, the listed addresses never", async () => {
    const first: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));
    const retry: RecordingLookup = recordingLookup(answeringEach);
    const rescue: RecordingLookup = recordingLookup(answeringEach);

    const result: ReverseDnsResolution = await resolverWith({
      lookup: first,
      retryLookup: retry,
      rescueLookup: rescue,
      hostsFileLookup: hostsFile,
    }).resolveHostnames(INPUT);

    expect(rescue.asked).toHaveLength(98);
    expect(new Set<string>(rescue.asked).size).toBe(98);
    expect(rescue.asked).not.toContain(HUNDRED[64]);
    expect(rescue.asked).not.toContain(HUNDRED[99]);
    expect(result.hostnameByIpAddress.size).toBe(100);
    expect(result.lookedUpCount).toBe(100);
    expectPartition(result, INPUT);
  });
});

describe("ReverseDnsResolver breaker rescue — a rescued pass's failures are retried like any other", () => {
  /*
   * One nameserver that drops the first datagram of every query and answers
   * the second — the "one lost datagram" the retry pass exists for — on a
   * sweep big enough to trip the breaker. Every first attempt, whichever
   * lookup made it, is lost; every second one is answered.
   */
  function losingEveryFirstAttempt(): (
    ipAddress: string,
  ) => Promise<Array<string>> {
    const attemptsByAddress: Map<string, number> = new Map<string, number>();

    return (ipAddress: string): Promise<Array<string>> => {
      const attempt: number = (attemptsByAddress.get(ipAddress) ?? 0) + 1;
      attemptsByAddress.set(ipAddress, attempt);

      return attempt === 1
        ? Promise.reject(fakeDnsError("ETIMEOUT"))
        : answeringEach(ipAddress);
    };
  }

  it("names all hundred hosts where every first attempt was lost, each asked exactly twice", async () => {
    const server: (ipAddress: string) => Promise<Array<string>> =
      losingEveryFirstAttempt();
    const first: RecordingLookup = recordingLookup(server);
    const retry: RecordingLookup = recordingLookup(server);
    const rescue: RecordingLookup = recordingLookup(server);

    const result: ReverseDnsResolution = await resolverWith({
      lookup: first,
      retryLookup: retry,
      rescueLookup: rescue,
    }).resolveHostnames(HUNDRED);

    /*
     * The first canary had had its lost attempt and is named, so the pass
     * is rescued; the thirty-four the rescued waves then asked lose their
     * first attempt too — and are named on their retry, where they used to
     * keep "timed out" as "thoroughly asked".
     */
    expect(result.hostnameByIpAddress.size).toBe(100);
    expect(result.statusByIpAddress!.size).toBe(0);
    expect(result.failedAddressCount).toBe(0);
    expect(result.isReverseDnsAvailable).toBe(true);

    for (const ipAddress of HUNDRED) {
      expect(timesAsked(first, ipAddress) + timesAsked(rescue, ipAddress)).toBe(
        2,
      );
    }

    // Asked again through the rescue lookup, not the primary-first retry.
    expect(retry.asked).toEqual([]);
    expectPartition(result, HUNDRED);
  });

  it("asks a rescued wave's failure again in the retry pass, once, even when it fails again", async () => {
    const first: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));
    const retry: RecordingLookup = recordingLookup(answeringEach);
    const rescue: RecordingLookup = recordingLookup(
      (ipAddress: string): Promise<Array<string>> => {
        // Only the first canary ever answers the thorough way.
        return ipAddress === HUNDRED[0]
          ? answeringEach(ipAddress)
          : Promise.reject(fakeDnsError("ESERVFAIL"));
      },
    );

    const result: ReverseDnsResolution = await resolverWith({
      lookup: first,
      retryLookup: retry,
      rescueLookup: rescue,
    }).resolveHostnames(HUNDRED);

    // Asked by its rescued wave, then by the retry pass — and no more.
    for (const ipAddress of HUNDRED.slice(65, 99)) {
      expect(timesAsked(rescue, ipAddress)).toBe(2);
      expect(result.statusByIpAddress!.get(ipAddress)).toBe(
        DiscoveredHostReverseDnsStatus.ServerFailure,
      );
    }

    // The first canary came back, and is not asked again.
    expect(timesAsked(rescue, HUNDRED[0]!)).toBe(1);
    expect(result.failedAddressCount).toBe(99);
    expectPartition(result, HUNDRED);
  });
});
