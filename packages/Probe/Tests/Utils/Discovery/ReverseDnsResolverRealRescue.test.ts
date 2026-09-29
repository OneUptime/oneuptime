// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import ReverseDnsResolver, {
  buildDefaultLookup,
  buildDefaultRescueLookup,
  buildDefaultRetryLookup,
  DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
  DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
  MAX_REVERSE_DNS_RETRY_LOOKUP_IN_MS,
  ReverseDnsResolution,
  ReverseDnsResolverFactory,
  ReverseDnsResolverLike,
} from "../../../Utils/Discovery/ReverseDnsResolver";
import {
  DnsResponseCode,
  dropReply,
  FakeDnsQuery,
  FakeDnsReply,
  FakeDnsServer,
  ipv4AddressOfReverseName,
  ptrReply,
  rcodeReply,
  reserveClosedUdpPort,
  startFakeDnsServer,
} from "../../TestingUtils/FakeDnsServer";
import { DiscoveredHostReverseDnsStatus } from "Common/Types/NetworkDevice/DiscoveredHostNamingStatus";
import logger from "Common/Server/Utils/Logger";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import dns from "dns";

/*
 * OneUptime issue #3916, the review of the fix, against the REAL resolver.
 *
 * Three things the first version of the fix got wrong, each only visible
 * with real c-ares timing and real response codes, and each reproduced by
 * the reviewers with a DNS server on loopback:
 *
 *   1. A SERVFAIL counted as silence. Seventy live hosts in a zone the
 *      resolver SERVFAILs, then ten healthy ones: the breaker called the
 *      probe's DNS unusable after sixty-four fast SERVFAILs and skipped the
 *      ten. A server that responds is a server the probe can reach.
 *   2. A fallback nameserver's NXDOMAIN was final. The Helm chart gives the
 *      probe [CoreDNS, 8.8.8.8, 1.1.1.1]; a primary that SERVFAILed or timed
 *      out and a public resolver that answers NXDOMAIN for every private
 *      address filed every failed lookup as "no PTR record". And a
 *      secondary that named ONE address became the server whose NXDOMAIN
 *      was final for every later one the primary would have named.
 *   3. With a dead primary and a NXDOMAIN-only secondary, the breaker
 *      rescue took the public NXDOMAIN as proof DNS worked, then crawled
 *      through its whole budget at one dead-primary timeout per wave — 74
 *      seconds for 1,000 hosts where the probe used to stop in four — and
 *      advised raising the budget.
 *
 * And one the final review found in the fix of (2): the first attempt still
 * asked through a resolver with every server configured, and c-ares — which
 * waits out a SILENT server — moves on at once from one that REFUSES the
 * connection. A Helm pod whose cluster DNS had no ready endpoints got the
 * public fallback's NXDOMAIN on the first attempt, for every host, as a
 * final "no PTR record". The first attempt is now pinned to the primary.
 *
 * Every resolver here is pointed at loopback servers with setServers(), at
 * the SHIPPED timeouts, and no hosts file is read (the lookups are injected,
 * which leaves the pass none). The scenarios all run at once, so the file
 * costs about as long as its slowest one.
 */

jest.setTimeout(30000);

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

function loopbackResolverFactory(
  servers: Array<string>,
): ReverseDnsResolverFactory {
  return (timeoutInMs: number): ReverseDnsResolverLike => {
    const resolver: dns.promises.Resolver = new dns.promises.Resolver({
      timeout: timeoutInMs,
      tries: 1,
    });
    resolver.setServers(servers);
    return resolver;
  };
}

// Wired exactly as the probe wires its default resolver, on loopback.
function loopbackReverseDnsResolver(
  servers: Array<string>,
): ReverseDnsResolver {
  const factory: ReverseDnsResolverFactory = loopbackResolverFactory(servers);

  return new ReverseDnsResolver({
    lookup: buildDefaultLookup(DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS, factory),
    retryLookup: buildDefaultRetryLookup(
      DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
      factory,
    ),
    rescueLookup: buildDefaultRescueLookup(
      DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
      factory,
    ),
  });
}

interface TimedResolution {
  result: ReverseDnsResolution;
  durationInMs: number;
}

async function timed(
  pass: () => Promise<ReverseDnsResolution>,
): Promise<TimedResolution> {
  const startedAt: number = Date.now();
  const result: ReverseDnsResolution = await pass();

  return { result: result, durationInMs: Date.now() - startedAt };
}

function statusCounts(result: ReverseDnsResolution): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const status of result.statusByIpAddress!.values()) {
    counts[status] = (counts[status] ?? 0) + 1;
  }

  return counts;
}

function range(prefix: string, from: number, count: number): Array<string> {
  return Array.from(
    { length: count },
    (_unused: unknown, index: number): string => {
      return `${prefix}.${from + index}`;
    },
  );
}

/*
 * Every query answered with one response code, at once.
 *
 * The fallback servers that only ever say NXDOMAIN say it AT ONCE too, which is
 * what a public resolver really does and the worst case for a probe whose
 * primary has failed. They used to answer a second late: the first pass
 * asked through a resolver with every server configured, and on a loaded
 * machine the race's timer could run past the point where c-ares moved on
 * from a silent primary, so an instant NXDOMAIN from the fallback landed
 * inside the first attempt and became a final "no record". The first pass is
 * now pinned to the primary (#3916) and never asks a fallback at all, so
 * there is nothing left for a delay to hide — and a first pass that did ask
 * one would now fail these tests, as it should.
 */
function answeringEverything(
  responseCode: DnsResponseCode,
): () => FakeDnsReply {
  return (): FakeDnsReply => {
    return rcodeReply(responseCode);
  };
}

/*
 * 10.0.0.x is a zone the resolver answers `deadZoneCode` for; 10.0.1.x has
 * good PTR records.
 */
function deadZoneThenHealthyZone(
  deadZoneCode: DnsResponseCode,
): (query: FakeDnsQuery) => FakeDnsReply {
  return (query: FakeDnsQuery): FakeDnsReply => {
    const ipAddress: string | undefined = ipv4AddressOfReverseName(query.name);

    if (ipAddress?.startsWith("10.0.1.")) {
      return ptrReply([`host-${ipAddress.split(".").pop()}.example.com`]);
    }

    return rcodeReply(deadZoneCode);
  };
}

const DEAD_ZONE: Array<string> = range("10.0.0", 1, 70);
const HEALTHY_ZONE: Array<string> = range("10.0.1", 1, 10);
const THOUSAND_HOSTS: Array<string> = [
  ...range("10.16.40", 1, 250),
  ...range("10.16.41", 1, 250),
  ...range("10.16.42", 1, 250),
  ...range("10.16.43", 1, 250),
];
const KITCHEN: Array<string> = range("10.16.42", 51, 12);
// Big enough to trip the breaker; asked of the refused-CoreDNS pod.
const REFUSED_SWEEP: Array<string> = range("10.16.46", 1, 100);
const STEERED_SWEEP: Array<string> = [
  "198.51.100.7",
  ...range("10.0.0", 1, 39),
];

describe("the real resolver: the review's reproductions of #3916's fix", () => {
  const servers: Array<FakeDnsServer> = [];

  async function server(
    respond: (query: FakeDnsQuery) => FakeDnsReply,
  ): Promise<FakeDnsServer> {
    const started: FakeDnsServer = await startFakeDnsServer(respond);
    servers.push(started);
    return started;
  }

  let servfailZone: ReverseDnsResolution;
  let refusedZone: ReverseDnsResolution;
  let deadPrimaryPublicSecondary: TimedResolution;
  let deadPrimarySecondary: FakeDnsServer;
  let helmServfail: ReverseDnsResolution;
  let helmTimeout: ReverseDnsResolution;
  let helmPublics: Array<FakeDnsServer>;
  let helmRefused: ReverseDnsResolution;
  let helmRefusedSweep: ReverseDnsResolution;
  let refusedCoreDnsAddress: string;
  let refusedPublics: Array<FakeDnsServer>;
  let steered: ReverseDnsResolution;
  let steeredPrimary: FakeDnsServer;

  beforeAll(async () => {
    // (1) One server, a SERVFAIL (or REFUSED) zone, then a healthy one.
    const servfailServer: FakeDnsServer = await server(
      deadZoneThenHealthyZone(DnsResponseCode.ServerFailure),
    );
    const refusedServer: FakeDnsServer = await server(
      deadZoneThenHealthyZone(DnsResponseCode.Refused),
    );

    // (3) A black-holed primary, then a resolver with no private zones.
    const deadPrimary: FakeDnsServer = await server(dropReply);
    deadPrimarySecondary = await server(
      answeringEverything(DnsResponseCode.NameError),
    );

    // (2) The Helm chart's pod: CoreDNS, then two public resolvers.
    const servfailingCoreDns: FakeDnsServer = await server(
      answeringEverything(DnsResponseCode.ServerFailure),
    );
    const silentCoreDns: FakeDnsServer = await server(dropReply);
    helmPublics = [
      await server(answeringEverything(DnsResponseCode.NameError)),
      await server(answeringEverything(DnsResponseCode.NameError)),
    ];

    /*
     * (4) The Helm chart's pod with NO ready CoreDNS behind the service:
     * kube-proxy rejects the cluster IP, which c-ares reads as a connection
     * error — and on a connection error it moves to the next server AT ONCE,
     * inside the first attempt. Public resolvers of their own, so what they
     * were asked is this scenario's alone.
     */
    refusedPublics = [
      await server(answeringEverything(DnsResponseCode.NameError)),
      await server(answeringEverything(DnsResponseCode.NameError)),
    ];

    /*
     * (2) The steering case: a primary that loses the first datagram for
     * every name and answers the second, and never answers for the public
     * block in time; a secondary that names only the public block.
     */
    steeredPrimary = await server((query: FakeDnsQuery): FakeDnsReply => {
      const ipAddress: string | undefined = ipv4AddressOfReverseName(
        query.name,
      );

      if (!ipAddress || ipAddress.startsWith("198.51.100.")) {
        return dropReply();
      }

      return query.attempt === 1
        ? dropReply()
        : ptrReply([`pos-${ipAddress.split(".").pop()}.corp.example`]);
    });
    const steeringSecondary: FakeDnsServer = await server(
      (query: FakeDnsQuery): FakeDnsReply => {
        const ipAddress: string | undefined = ipv4AddressOfReverseName(
          query.name,
        );

        return ipAddress?.startsWith("198.51.100.")
          ? ptrReply([`static-${ipAddress.split(".").pop()}.isp.example`])
          : rcodeReply(DnsResponseCode.NameError);
      },
    );

    /*
     * Reserved LAST, so no server started above can have been handed the
     * port after it was closed.
     */
    refusedCoreDnsAddress = `127.0.0.1:${await reserveClosedUdpPort()}`;

    const refusedHelmServers: Array<string> = [
      refusedCoreDnsAddress,
      refusedPublics[0]!.address,
      refusedPublics[1]!.address,
    ];

    [
      servfailZone,
      refusedZone,
      deadPrimaryPublicSecondary,
      helmServfail,
      helmTimeout,
      helmRefused,
      helmRefusedSweep,
      steered,
    ] = await Promise.all([
      loopbackReverseDnsResolver([servfailServer.address]).resolveHostnames([
        ...DEAD_ZONE,
        ...HEALTHY_ZONE,
      ]),
      loopbackReverseDnsResolver([refusedServer.address]).resolveHostnames([
        ...DEAD_ZONE,
        ...HEALTHY_ZONE,
      ]),
      timed((): Promise<ReverseDnsResolution> => {
        return loopbackReverseDnsResolver([
          deadPrimary.address,
          deadPrimarySecondary.address,
        ]).resolveHostnames(THOUSAND_HOSTS);
      }),
      loopbackReverseDnsResolver([
        servfailingCoreDns.address,
        helmPublics[0]!.address,
        helmPublics[1]!.address,
      ]).resolveHostnames(KITCHEN),
      loopbackReverseDnsResolver([
        silentCoreDns.address,
        helmPublics[0]!.address,
        helmPublics[1]!.address,
      ]).resolveHostnames(KITCHEN),
      loopbackReverseDnsResolver(refusedHelmServers).resolveHostnames(KITCHEN),
      loopbackReverseDnsResolver(refusedHelmServers).resolveHostnames(
        REFUSED_SWEEP,
      ),
      loopbackReverseDnsResolver([
        steeredPrimary.address,
        steeringSecondary.address,
      ]).resolveHostnames(STEERED_SWEEP),
    ]);
  }, 30000);

  afterAll(async () => {
    for (const started of servers) {
      await started.close();
    }
  });

  it.each([
    [
      "SERVFAIL",
      (): ReverseDnsResolution => {
        return servfailZone;
      },
      DiscoveredHostReverseDnsStatus.ServerFailure,
    ],
    [
      "REFUSED",
      (): ReverseDnsResolution => {
        return refusedZone;
      },
      DiscoveredHostReverseDnsStatus.Refused,
    ],
  ])(
    "names the healthy zone behind seventy %s answers, and does not call the resolver unusable",
    (
      _label: string,
      pass: () => ReverseDnsResolution,
      status: DiscoveredHostReverseDnsStatus,
    ) => {
      const result: ReverseDnsResolution = pass();

      for (const ipAddress of HEALTHY_ZONE) {
        expect(result.hostnameByIpAddress.get(ipAddress)).toBe(
          `host-${ipAddress.split(".").pop()}.example.com`,
        );
      }

      expect(result.isReverseDnsAvailable).toBe(true);
      expect(result.notLookedUpCount).toBe(0);
      // Still seventy FAILED lookups — asked twice, and reported as such.
      expect(statusCounts(result)).toEqual({ [status]: 70 });
      expect(result.failedAddressCount).toBe(70);
    },
  );

  it("stops a dead primary + NXDOMAIN-only secondary pass in seconds, not after its whole budget", () => {
    /*
     * Two first-try waves on the dead primary, then ONE rescue walk: its
     * canaries wait out the primary's retry timeout side by side, the
     * public secondary's NXDOMAIN is not trusted, and the pass stops as it
     * did before the rescue existed — about nine seconds here, bounded by
     * two first-pass waves and the longest one retry walk can take, where
     * the first version of the fix took 74 seconds for this sweep, ran out
     * of its 70-second budget and advised the operator to raise it.
     */
    const result: ReverseDnsResolution = deadPrimaryPublicSecondary.result;

    expect(deadPrimaryPublicSecondary.durationInMs).toBeLessThan(
      2 * DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS +
        MAX_REVERSE_DNS_RETRY_LOOKUP_IN_MS,
    );
    expect(result.isReverseDnsAvailable).toBe(false);
    expect(result.isTimeBudgetExhausted).toBe(false);
    /*
     * Sixty-four first tries, and two of the canaries — the next address
     * and the last, asked out of turn — which were looked up and timed out
     * on the primary like the rest: they keep that, not "never asked".
     */
    expect(result.lookedUpCount).toBe(66);
    expect(result.notLookedUpCount).toBe(934);
    expect(statusCounts(result)).toEqual({
      [DiscoveredHostReverseDnsStatus.Timeout]: 66,
      [DiscoveredHostReverseDnsStatus.SkippedNoResolver]: 934,
    });
    expect(result.statusByIpAddress!.get("10.16.40.65")).toBe(
      DiscoveredHostReverseDnsStatus.Timeout,
    );
    expect(result.statusByIpAddress!.get("10.16.43.250")).toBe(
      DiscoveredHostReverseDnsStatus.Timeout,
    );
    // The canaries did reach the secondary, and its NXDOMAIN rescued nothing.
    expect(deadPrimarySecondary.queries.length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    [
      "SERVFAILs",
      (): ReverseDnsResolution => {
        return helmServfail;
      },
      DiscoveredHostReverseDnsStatus.ServerFailure,
    ],
    [
      "times out",
      (): ReverseDnsResolution => {
        return helmTimeout;
      },
      DiscoveredHostReverseDnsStatus.Timeout,
    ],
  ])(
    "reports a failed lookup, not 'no PTR record', when CoreDNS %s and the public fallbacks say NXDOMAIN",
    (
      _label: string,
      pass: () => ReverseDnsResolution,
      status: DiscoveredHostReverseDnsStatus,
    ) => {
      const result: ReverseDnsResolution = pass();

      expect(statusCounts(result)).toEqual({ [status]: 12 });
      expect(result.failedAddressCount).toBe(12);
      expect(result.hostnameByIpAddress.size).toBe(0);
    },
  );

  it("walked on past CoreDNS to the public fallbacks before reporting it", () => {
    for (const publicResolver of helmPublics) {
      expect(publicResolver.queries.length).toBeGreaterThan(0);
    }
  });

  it("reports every host unreachable, not 'no PTR record', when CoreDNS refuses and the public fallbacks say NXDOMAIN", () => {
    /*
     * The final review's reproduction (#3916). With every server configured
     * on the first attempt, c-ares met the refused cluster DNS and moved on
     * to 8.8.8.8 at once, inside the two seconds, and its NXDOMAIN was
     * filed as a final "no PTR record" — never retried, not a failure, the
     * status note empty and the dashboard sending the operator to add PTR
     * records. Pinned to the primary, each first attempt is the refusal it
     * really met; the retry walk asks the fallbacks too, and — the primary
     * having failed — does not take their word for a private address.
     */
    expect(statusCounts(helmRefused)).toEqual({
      [DiscoveredHostReverseDnsStatus.Unreachable]: KITCHEN.length,
    });
    expect(helmRefused.failedAddressCount).toBe(KITCHEN.length);
    expect(helmRefused.hostnameByIpAddress.size).toBe(0);
    expect(helmRefused.failureReason).toContain("ECONNREFUSED");

    /*
     * Each public resolver was asked about each host exactly ONCE — by the
     * retry walk. The first attempt never reached it.
     */
    for (const publicResolver of refusedPublics) {
      for (const ipAddress of KITCHEN) {
        expect(
          publicResolver.queriesFor(
            `${ipAddress.split(".").reverse().join(".")}.in-addr.arpa`,
          ),
        ).toHaveLength(1);
      }
    }
  });

  it("calls DNS unusable, not 'no PTR record', on a sweep big enough to trip the breaker behind the refused CoreDNS", () => {
    /*
     * Sixty-four refusals trip the breaker; the rescue's canaries get only
     * the fallbacks' NXDOMAIN, which it does not trust, and the primary's
     * refusal again, so the pass stops as a probe whose DNS does not answer
     * — which is the truth — with the two canaries asked out of turn
     * reporting what they met.
     */
    expect(statusCounts(helmRefusedSweep)).toEqual({
      [DiscoveredHostReverseDnsStatus.Unreachable]: 66,
      [DiscoveredHostReverseDnsStatus.SkippedNoResolver]: 34,
    });
    expect(helmRefusedSweep.isReverseDnsAvailable).toBe(false);
    expect(helmRefusedSweep.failedAddressCount).toBe(66);

    // Only the three canaries' walks ever reached a public resolver.
    for (const publicResolver of refusedPublics) {
      const sweepQueries: Array<FakeDnsQuery> = publicResolver.queries.filter(
        (query: FakeDnsQuery): boolean => {
          return (
            ipv4AddressOfReverseName(query.name)?.startsWith("10.16.46.") ===
            true
          );
        },
      );

      expect(
        sweepQueries
          .map((query: FakeDnsQuery): string | undefined => {
            return ipv4AddressOfReverseName(query.name);
          })
          .sort(),
      ).toEqual(["10.16.46.1", "10.16.46.100", "10.16.46.65"]);
    }
  });

  it("documents why: through a resolver it cannot pin, the refused primary's first attempt comes back as a public NXDOMAIN", async () => {
    /*
     * Not a test of the probe — a record, against the c-ares Node ships, of
     * the behaviour the pinning exists for: the same three servers, asked as
     * configured, answer a first attempt for a private address with the
     * fallback's NXDOMAIN, well inside the two-second race. If this ever
     * starts failing with ECONNREFUSED, c-ares has stopped failing over on a
     * connection error and the pin is belt and braces.
     */
    const configured: Array<string> = [
      refusedCoreDnsAddress,
      refusedPublics[0]!.address,
      refusedPublics[1]!.address,
    ];
    const pinnable: ReverseDnsResolverFactory =
      loopbackResolverFactory(configured);
    const unpinnable: ReverseDnsResolverFactory = (
      timeoutInMs: number,
    ): ReverseDnsResolverLike => {
      const resolver: ReverseDnsResolverLike = pinnable(timeoutInMs);

      return {
        resolvePtr: (hostname: string): Promise<Array<string>> => {
          return resolver.resolvePtr(hostname);
        },
        reverse: (ipAddress: string): Promise<Array<string>> => {
          return resolver.reverse(ipAddress);
        },
        getServers: (): Array<string> => {
          return resolver.getServers();
        },
        setServers: (): void => {
          throw new TypeError("this resolver will not be pinned");
        },
        cancel: (): void => {
          resolver.cancel();
        },
      };
    };

    await expect(
      buildDefaultLookup(
        DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
        unpinnable,
      )("10.16.47.1"),
    ).rejects.toMatchObject({ code: "ENOTFOUND" });

    await expect(
      buildDefaultLookup(
        DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
        pinnable,
      )("10.16.47.2"),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("names from the primary the hosts a steering secondary would have filed as 'no record'", () => {
    for (const ipAddress of range("10.0.0", 1, 39)) {
      expect(steered.hostnameByIpAddress.get(ipAddress)).toBe(
        `pos-${ipAddress.split(".").pop()}.corp.example`,
      );
    }

    expect(steered.hostnameByIpAddress.get("198.51.100.7")).toBe(
      "static-7.isp.example",
    );
    expect(steered.statusByIpAddress!.size).toBe(0);
    // The last wave's hosts were asked of the primary again, and named.
    expect(
      steeredPrimary.queriesFor("35.0.0.10.in-addr.arpa").length,
    ).toBeGreaterThanOrEqual(2);
  });
});
