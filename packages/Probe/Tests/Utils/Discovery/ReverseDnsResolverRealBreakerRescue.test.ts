// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import ReverseDnsResolver, {
  buildDefaultLookup,
  buildDefaultRescueLookup,
  buildDefaultRetryLookup,
  DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
  DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
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
 * OneUptime issue #3916, the final review of the breaker rescue, against the
 * REAL resolver.
 *
 * The rescue runs when a sweep's first sixty-four lookups have all met
 * silence: before the pass gives up on DNS, three canaries are asked the
 * thorough way, and if one comes back the rest of the pass is made that way.
 * The review measured three ways it still went wrong, each with real c-ares
 * against servers on loopback, and each is reproduced here:
 *
 *   1. It TRUSTED a public resolver that had named a PUBLIC address. With a
 *      dead primary and 8.8.8.8 behind it, a sweep whose public block sorts
 *      first handed the rescue a canary 8.8.8.8 could name; from then on its
 *      NXDOMAIN was final for every private host, and each was filed "no
 *      PTR record" where the probe's own DNS server had simply not answered.
 *   2. Its canaries were the first, middle and last FAILED address — all in
 *      the sixty-four the breaker had just seen fail. One nameserver silent
 *      on the zone at the bottom of the sweep therefore spoke for every zone
 *      above it: seventy silent hosts on 10.16.40.0/24, a hundred healthy
 *      ones on 10.16.41.0/24, and not one of the hundred named.
 *   3. An address asked through the rescue lookup was never retried. On a
 *      probe with ONE nameserver that is a single longer query to the same
 *      server, so where the first datagram of every query was lost, 64 of a
 *      hundred hosts were named, and 3 of a thousand.
 *
 * Every resolver is pointed at loopback servers with setServers(), and no
 * hosts file is read (the lookups are injected, which leaves the pass none).
 * (2) and (3) run at the SHIPPED timeouts, as the review measured them; (1)
 * at a quarter of them, for the reason given at PUBLIC_FIRST_TIMEOUT_DIVISOR.
 * The three run at once, so the file costs about as long as its slowest —
 * the silent zone, whose seventy hosts each wait out a first attempt and a
 * retry: about twenty-five seconds.
 */

jest.setTimeout(60000);

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

/*
 * Wired exactly as the probe wires its default resolver, on loopback — at
 * the shipped timeouts unless `timeoutDivisor` shrinks both of them.
 */
function loopbackReverseDnsResolver(
  servers: Array<string>,
  timeoutDivisor: number = 1,
): ReverseDnsResolver {
  const factory: ReverseDnsResolverFactory = loopbackResolverFactory(servers);
  const firstTimeoutInMs: number =
    DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS / timeoutDivisor;
  const walkTimeoutInMs: number =
    DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS / timeoutDivisor;

  return new ReverseDnsResolver({
    lookup: buildDefaultLookup(firstTimeoutInMs, factory),
    retryLookup: buildDefaultRetryLookup(walkTimeoutInMs, factory),
    rescueLookup: buildDefaultRescueLookup(walkTimeoutInMs, factory),
    timeoutInMs: firstTimeoutInMs,
  });
}

/*
 * The public-first scenario runs at a QUARTER of the shipped timeouts. What
 * it is about is whose word the rescue takes, not how long anyone takes to
 * give it: every server there answers at once or never. At the shipped ones
 * each private host would wait out the dead primary in five separate waves
 * — half a minute on its own — to prove nothing more.
 */
const PUBLIC_FIRST_TIMEOUT_DIVISOR: number = 4;

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

function reverseNameOf(ipAddress: string): string {
  return `${ipAddress.split(".").reverse().join(".")}.in-addr.arpa`;
}

function lastOctetOf(ipAddress: string): string {
  return ipAddress.split(".").pop()!;
}

// (1) A public block that sorts first, then the private hosts.
const PUBLIC_BLOCK: Array<string> = range("198.51.100", 1, 64);
const PRIVATE_BLOCK: Array<string> = range("10.16.50", 1, 36);

// (2) A zone the nameserver never answers, then a healthy one.
const SILENT_ZONE: Array<string> = range("10.16.40", 1, 70);
const HEALTHY_ZONE: Array<string> = range("10.16.41", 1, 100);

// (3) A hundred hosts behind a nameserver that loses every first datagram.
const LOSSY_SWEEP: Array<string> = range("10.16.45", 1, 100);

describe("the real resolver: the final review's reproductions of the breaker rescue", () => {
  const servers: Array<FakeDnsServer> = [];

  async function server(
    respond: (query: FakeDnsQuery) => FakeDnsReply,
  ): Promise<FakeDnsServer> {
    const started: FakeDnsServer = await startFakeDnsServer(respond);
    servers.push(started);
    return started;
  }

  let publicFirst: ReverseDnsResolution;
  let deadPrimary: FakeDnsServer;
  let publicResolver: FakeDnsServer;
  let silentZone: ReverseDnsResolution;
  let silentZoneServer: FakeDnsServer;
  let lossy: ReverseDnsResolution;
  let lossyServer: FakeDnsServer;

  beforeAll(async () => {
    /*
     * (1) A black-holed primary, and a public resolver behind it that names
     * the public block — at once — and answers NXDOMAIN, at once, for every
     * private address (RFC 6303).
     */
    deadPrimary = await server(dropReply);
    publicResolver = await server((query: FakeDnsQuery): FakeDnsReply => {
      const ipAddress: string | undefined = ipv4AddressOfReverseName(
        query.name,
      );

      return ipAddress?.startsWith("198.51.100.")
        ? ptrReply([`static-${lastOctetOf(ipAddress)}.isp.example`])
        : rcodeReply(DnsResponseCode.NameError);
    });

    // (2) ONE nameserver, silent on 10.16.40.0/24 and healthy on 10.16.41.0/24.
    silentZoneServer = await server((query: FakeDnsQuery): FakeDnsReply => {
      const ipAddress: string | undefined = ipv4AddressOfReverseName(
        query.name,
      );

      if (ipAddress?.startsWith("10.16.40.")) {
        return dropReply();
      }

      if (ipAddress?.startsWith("10.16.41.")) {
        return ptrReply([`host-${lastOctetOf(ipAddress)}.zone41.example`]);
      }

      return rcodeReply(DnsResponseCode.NameError);
    });

    // (3) ONE nameserver that loses the first datagram for every name.
    lossyServer = await server((query: FakeDnsQuery): FakeDnsReply => {
      const ipAddress: string | undefined = ipv4AddressOfReverseName(
        query.name,
      );

      if (!ipAddress || query.attempt === 1) {
        return dropReply();
      }

      return ptrReply([`kds-${lastOctetOf(ipAddress)}.wbhq.example`]);
    });

    [publicFirst, silentZone, lossy] = await Promise.all([
      loopbackReverseDnsResolver(
        [deadPrimary.address, publicResolver.address],
        PUBLIC_FIRST_TIMEOUT_DIVISOR,
      ).resolveHostnames([...PUBLIC_BLOCK, ...PRIVATE_BLOCK]),
      loopbackReverseDnsResolver([silentZoneServer.address]).resolveHostnames([
        ...SILENT_ZONE,
        ...HEALTHY_ZONE,
      ]),
      loopbackReverseDnsResolver([lossyServer.address]).resolveHostnames(
        LOSSY_SWEEP,
      ),
    ]);
  }, 60000);

  afterAll(async () => {
    for (const started of servers) {
      await started.close();
    }
  });

  it("names the public hosts from the public resolver, and does not take its NXDOMAIN for the private ones", () => {
    /*
     * The breaker trips on the sixty-four public hosts the dead primary
     * never answered; the first canary is 198.51.100.1, the public resolver
     * names it, and the pass is rescued — rightly: DNS does answer from
     * here. But that name is for a PUBLIC address, and earns the resolver
     * no say over 10.16.50.0/24: every private host keeps the primary's
     * timeout, which is the truth about the probe's own DNS server.
     */
    for (const ipAddress of PUBLIC_BLOCK) {
      expect(publicFirst.hostnameByIpAddress.get(ipAddress)).toBe(
        `static-${lastOctetOf(ipAddress)}.isp.example`,
      );
    }

    expect(statusCounts(publicFirst)).toEqual({
      [DiscoveredHostReverseDnsStatus.Timeout]: PRIVATE_BLOCK.length,
    });
    expect(publicFirst.failedAddressCount).toBe(PRIVATE_BLOCK.length);
    expect(publicFirst.isReverseDnsAvailable).toBe(true);
    expect(publicFirst.notLookedUpCount).toBe(0);
  });

  it("walked on past the public resolver's NXDOMAIN to the primary, for every private host, both times", () => {
    /*
     * Each private host was asked twice — once by the rescued pass (or as a
     * canary), once by its retry — and each time the public resolver's
     * NXDOMAIN did not end the walk: the primary was asked after it. A
     * trusted public resolver would have ended both walks on its first word.
     */
    for (const ipAddress of PRIVATE_BLOCK) {
      expect(publicResolver.queriesFor(reverseNameOf(ipAddress))).toHaveLength(
        2,
      );
      expect(
        deadPrimary.queriesFor(reverseNameOf(ipAddress)).length,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("names the hundred healthy hosts behind a single nameserver's silent zone of seventy", () => {
    for (const ipAddress of HEALTHY_ZONE) {
      expect(silentZone.hostnameByIpAddress.get(ipAddress)).toBe(
        `host-${lastOctetOf(ipAddress)}.zone41.example`,
      );
    }

    // The silent zone is reported as what it is: seventy timeouts.
    expect(statusCounts(silentZone)).toEqual({
      [DiscoveredHostReverseDnsStatus.Timeout]: SILENT_ZONE.length,
    });
    expect(silentZone.failedAddressCount).toBe(SILENT_ZONE.length);
    expect(silentZone.isReverseDnsAvailable).toBe(true);
    expect(silentZone.isTimeBudgetExhausted).toBe(false);
    expect(silentZone.lookedUpCount).toBe(170);
    expect(silentZone.notLookedUpCount).toBe(0);
  });

  it("found the healthy zone through the LAST address of the sweep, asked out of turn and never again", () => {
    // The canary that rescued the pass: named once, not asked by its wave.
    expect(
      silentZoneServer.queriesFor(reverseNameOf(HEALTHY_ZONE[99]!)),
    ).toHaveLength(1);
    // The next unasked address, silent: asked as a canary, then retried.
    expect(
      silentZoneServer.queriesFor(reverseNameOf(SILENT_ZONE[64]!)),
    ).toHaveLength(2);
  });

  it("names every host of a hundred where the first datagram of every query was lost", () => {
    /*
     * The breaker trips on the first sixty-four; the first canary's second
     * datagram is answered, so the pass is rescued; the thirty-six it asks
     * after that each lose their first datagram too — and are named on
     * their retry, where they used to be left as "timed out".
     */
    for (const ipAddress of LOSSY_SWEEP) {
      expect(lossy.hostnameByIpAddress.get(ipAddress)).toBe(
        `kds-${lastOctetOf(ipAddress)}.wbhq.example`,
      );
    }

    expect(lossy.statusByIpAddress!.size).toBe(0);
    expect(lossy.failedAddressCount).toBe(0);
    expect(lossy.isReverseDnsAvailable).toBe(true);
    expect(lossy.isTimeBudgetExhausted).toBe(false);
  });

  it("asked every one of them exactly twice: one datagram lost, one answered", () => {
    for (const ipAddress of LOSSY_SWEEP) {
      expect(lossyServer.queriesFor(reverseNameOf(ipAddress))).toHaveLength(2);
    }
  });
});
