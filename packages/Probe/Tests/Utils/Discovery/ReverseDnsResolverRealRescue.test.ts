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
 * How long the servers that only ever say NXDOMAIN take to say it.
 *
 * Every scenario here starts from first attempts that FAILED on the primary,
 * and the first pass asks through a resolver with every server configured.
 * c-ares moves on to the next server only once the first has had its whole
 * two-second timeout, which the first pass's race ends first — but on a
 * loaded machine the race's timer can run late, and an instant NXDOMAIN from
 * the fallback would then land inside it and turn the precondition into a
 * final "no record". A second's delay keeps that answer out of the first
 * pass without changing what the retry walk makes of it.
 */
const FALLBACK_ANSWER_DELAY_IN_MS: number = 1000;

// Every query answered with one response code, after an optional delay.
function answeringEverything(
  responseCode: DnsResponseCode,
  delayInMs?: number | undefined,
): () => FakeDnsReply {
  return (): FakeDnsReply => {
    return rcodeReply(responseCode, { delayInMs: delayInMs });
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
      answeringEverything(
        DnsResponseCode.NameError,
        FALLBACK_ANSWER_DELAY_IN_MS,
      ),
    );

    // (2) The Helm chart's pod: CoreDNS, then two public resolvers.
    const servfailingCoreDns: FakeDnsServer = await server(
      answeringEverything(DnsResponseCode.ServerFailure),
    );
    const silentCoreDns: FakeDnsServer = await server(dropReply);
    helmPublics = [
      await server(
        answeringEverything(
          DnsResponseCode.NameError,
          FALLBACK_ANSWER_DELAY_IN_MS,
        ),
      ),
      await server(
        answeringEverything(
          DnsResponseCode.NameError,
          FALLBACK_ANSWER_DELAY_IN_MS,
        ),
      ),
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
          : rcodeReply(DnsResponseCode.NameError, {
              delayInMs: FALLBACK_ANSWER_DELAY_IN_MS,
            });
      },
    );

    [
      servfailZone,
      refusedZone,
      deadPrimaryPublicSecondary,
      helmServfail,
      helmTimeout,
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
    expect(result.lookedUpCount).toBe(64);
    expect(result.notLookedUpCount).toBe(936);
    expect(statusCounts(result)).toEqual({
      [DiscoveredHostReverseDnsStatus.Timeout]: 64,
      [DiscoveredHostReverseDnsStatus.SkippedNoResolver]: 936,
    });
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
