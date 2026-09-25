// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import ReverseDnsResolver, {
  buildDefaultLookup,
  buildDefaultRetryLookup,
  DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
  DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
  REVERSE_DNS_RETRY_RACE_SLACK_IN_MS,
  ReverseDnsLookupFunction,
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
import fs from "fs";

/*
 * OneUptime issue #3916, against the REAL resolver.
 *
 * The report: an ICMP-only scan of twelve kitchen displays named four of
 * them and showed the other eight as bare addresses, and nothing said why.
 * Three things in the probe could each produce exactly that picture, and
 * every one of them lived in the part of the code no test could reach
 * without a DNS server — which is why they survived:
 *
 *   1. Node's Resolver#reverse turns SERVFAIL, REFUSED, NODATA, "nothing
 *      listening" and c-ares' own timeout into ENOTFOUND, so every DNS
 *      failure was filed as "this device has no PTR record".
 *   2. One query per address, raced at exactly its two-second timeout,
 *      never retried: one dropped datagram, one answer slower than two
 *      seconds, or a primary nameserver that is dead or answering SERVFAIL
 *      left the device unnamed. (c-ares never fails over on SERVFAIL or
 *      REFUSED, and fails over on a timeout only once the race has already
 *      ended the lookup.)
 *   3. Nothing reported it.
 *
 * These tests put the real dns.promises.Resolver — the one the probe ships
 * — in front of a DNS server running in this process on 127.0.0.1, answering
 * exactly as each scenario needs, and assert what the probe now makes of
 * it. Every resolver is built by a factory that calls setServers() with the
 * loopback server, so the machine's own resolver configuration is never
 * consulted and nothing leaves the loopback interface. (The one exception
 * is the hosts file, which c-ares reads for reverse() — that is a behaviour
 * under test, and the test that relies on it reads the file first.)
 *
 * They run at the SHIPPED timeouts — two seconds for the first attempt,
 * four for the retry — because the timing is the bug: "an answer after 2.5
 * seconds" is only a meaningful scenario against the real first-pass
 * budget. The scenarios that have to wait all run concurrently, in one pass
 * per server layout, so the file costs about as long as its slowest address
 * (roughly six seconds), not the sum of them.
 */

jest.setTimeout(30000);

beforeEach(() => {
  // The pass logs on some paths by design; the suite asserts on results.
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
 * The probe's own factory — a fresh Resolver per lookup with `tries: 1` —
 * plus the one thing a test must add: which servers it asks.
 */
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
 * A resolver wired exactly as the probe wires its default one, first pass
 * and retry alike, but pointed at the loopback servers.
 */
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
  });
}

/*
 * The kitchen: twelve displays on 10.16.42.51-62, one per way a PTR lookup
 * can go, served by one nameserver.
 */
const KITCHEN: Record<string, (query: FakeDnsQuery) => FakeDnsReply> = {
  // A healthy PTR record.
  "10.16.42.51": (): FakeDnsReply => {
    return ptrReply(["wb0024kds01.wbhq.example"]);
  },
  // NXDOMAIN: the ordinary "no record".
  "10.16.42.52": (): FakeDnsReply => {
    return rcodeReply(DnsResponseCode.NameError);
  },
  // NOERROR with no answer: NODATA, the other "no record".
  "10.16.42.53": (): FakeDnsReply => {
    return rcodeReply(DnsResponseCode.NoError);
  },
  // SERVFAIL, every time.
  "10.16.42.54": (): FakeDnsReply => {
    return rcodeReply(DnsResponseCode.ServerFailure);
  },
  // REFUSED, every time.
  "10.16.42.55": (): FakeDnsReply => {
    return rcodeReply(DnsResponseCode.Refused);
  },
  // The first datagram is lost; every later one is answered.
  "10.16.42.56": (query: FakeDnsQuery): FakeDnsReply => {
    return query.attempt === 1
      ? dropReply()
      : ptrReply(["wb0024kds06.wbhq.example"]);
  },
  // Every answer takes 2.5 seconds: a slow forwarder chain, or WINS-R.
  "10.16.42.57": (): FakeDnsReply => {
    return ptrReply(["wb0024kds07.wbhq.example"], { delayInMs: 2500 });
  },
  // RFC 2317 classless delegation: a CNAME, then the PTR it points at.
  "10.16.42.58": (): FakeDnsReply => {
    return ptrReply(["wb0024kds08.wbhq.example"], {
      cnameTarget: "58.48-63.42.16.10.in-addr.arpa",
    });
  },
  // A record exists, but it only echoes the query name back.
  "10.16.42.59": (): FakeDnsReply => {
    return ptrReply(["59.42.16.10.in-addr.arpa"]);
  },
  // SERVFAIL once — an upstream hiccup — then a good answer.
  "10.16.42.60": (query: FakeDnsQuery): FakeDnsReply => {
    return query.attempt === 1
      ? rcodeReply(DnsResponseCode.ServerFailure)
      : ptrReply(["wb0024kds10.wbhq.example"]);
  },
  // Black-holed: never answered at all.
  "10.16.42.61": (): FakeDnsReply => {
    return dropReply();
  },
  // A healthy PTR record in the other naming convention.
  "10.16.42.62": (): FakeDnsReply => {
    return ptrReply(["wb-0024-kds12.wbhq.example"]);
  },
};

function kitchenResponder(query: FakeDnsQuery): FakeDnsReply {
  const ipAddress: string | undefined = ipv4AddressOfReverseName(query.name);
  const scenario: ((query: FakeDnsQuery) => FakeDnsReply) | undefined =
    ipAddress ? KITCHEN[ipAddress] : undefined;

  return scenario ? scenario(query) : rcodeReply(DnsResponseCode.NameError);
}

/*
 * Two nameservers, as a resolv.conf with a primary and a secondary lists
 * them. The PRIMARY fails in a different way for each address; the
 * secondary answers everything.
 */
function primaryResponder(query: FakeDnsQuery): FakeDnsReply {
  switch (ipv4AddressOfReverseName(query.name)) {
    case "10.16.43.71":
      return rcodeReply(DnsResponseCode.ServerFailure);
    case "10.16.43.72":
      return dropReply();
    case "10.16.43.73":
      return rcodeReply(DnsResponseCode.Refused);
    case "10.16.43.75":
      return ptrReply(["primary-75.wbhq.example"]);
    default:
      return rcodeReply(DnsResponseCode.NameError);
  }
}

function secondaryResponder(query: FakeDnsQuery): FakeDnsReply {
  const ipAddress: string | undefined = ipv4AddressOfReverseName(query.name);

  if (!ipAddress) {
    return rcodeReply(DnsResponseCode.NameError);
  }

  return ptrReply([`secondary-${ipAddress.split(".").pop()}.wbhq.example`]);
}

/*
 * `options rotate` in the machine's resolv.conf (or RES_OPTIONS) makes c-ares
 * spread first attempts across the configured servers, even ones set with
 * setServers(). The two-server assertions about WHICH server was asked first
 * only hold without it; the names they assert hold either way.
 */
const DOTTED_QUAD_PATTERN: RegExp = /^\d{1,3}(\.\d{1,3}){3}$/;
const RESOLV_CONF_ROTATE_PATTERN: RegExp = /^\s*options\b.*\brotate\b/m;
const RES_OPTIONS_ROTATE_PATTERN: RegExp = /\brotate\b/;

function isResolverRotationConfigured(): boolean {
  let resolvConf: string = "";

  try {
    resolvConf = fs.readFileSync("/etc/resolv.conf", "utf8");
  } catch {
    resolvConf = "";
  }

  return (
    RESOLV_CONF_ROTATE_PATTERN.test(resolvConf) ||
    RES_OPTIONS_ROTATE_PATTERN.test(process.env["RES_OPTIONS"] || "")
  );
}

const itWithoutRotation: typeof it.skip = isResolverRotationConfigured()
  ? it.skip
  : it;

const TWO_SERVER_ADDRESSES: Array<string> = [
  "10.16.43.71",
  "10.16.43.72",
  "10.16.43.73",
  "10.16.43.75",
];

describe("the real resolver: twelve kitchen displays on one nameserver, first pass and retry", () => {
  let kitchenServer: FakeDnsServer;
  let primaryServer: FakeDnsServer;
  let secondaryServer: FakeDnsServer;
  let kitchen: ReverseDnsResolution;
  let twoServers: ReverseDnsResolution;
  let passDurationInMs: number = 0;

  beforeAll(async () => {
    kitchenServer = await startFakeDnsServer(kitchenResponder);
    primaryServer = await startFakeDnsServer(primaryResponder);
    secondaryServer = await startFakeDnsServer(secondaryResponder);

    const startedAt: number = Date.now();

    /*
     * Both layouts at once: every scenario that has to wait out a timeout
     * waits out the same one.
     */
    [kitchen, twoServers] = await Promise.all([
      loopbackReverseDnsResolver([kitchenServer.address]).resolveHostnames(
        Object.keys(KITCHEN),
      ),
      loopbackReverseDnsResolver([
        primaryServer.address,
        secondaryServer.address,
      ]).resolveHostnames(TWO_SERVER_ADDRESSES),
    ]);

    passDurationInMs = Date.now() - startedAt;
  }, 30000);

  afterAll(async () => {
    await kitchenServer?.close();
    await primaryServer?.close();
    await secondaryServer?.close();
  });

  it("names a device with a healthy PTR record, asking the in-addr.arpa name for a PTR", () => {
    expect(kitchen.hostnameByIpAddress.get("10.16.42.51")).toBe(
      "wb0024kds01.wbhq.example",
    );
    expect(kitchen.hostnameByIpAddress.get("10.16.42.62")).toBe(
      "wb-0024-kds12.wbhq.example",
    );

    const asked: Array<FakeDnsQuery> = kitchenServer.queriesFor(
      "51.42.16.10.in-addr.arpa",
    );

    // Once: an address that answered is never asked again.
    expect(asked).toHaveLength(1);
    expect(asked[0]!.type).toBe(12);
  });

  it("reports NXDOMAIN and NODATA as 'no record', and never retries them", () => {
    expect(kitchen.statusByIpAddress?.get("10.16.42.52")).toBe(
      DiscoveredHostReverseDnsStatus.NoRecord,
    );
    expect(kitchen.statusByIpAddress?.get("10.16.42.53")).toBe(
      DiscoveredHostReverseDnsStatus.NoRecord,
    );

    /*
     * Two queries each, not one — and not three. The second is the
     * hosts-file fallback: reverse() reads the hosts file and then asks DNS
     * once more, which is the price of keeping /etc/hosts names now that the
     * probe asks with resolvePtr. A third would be the retry pass re-asking
     * an address that ANSWERED, which it must never do.
     */
    expect(kitchenServer.queriesFor("52.42.16.10.in-addr.arpa")).toHaveLength(
      2,
    );
    expect(kitchenServer.queriesFor("53.42.16.10.in-addr.arpa")).toHaveLength(
      2,
    );
  });

  it("reports a persistent SERVFAIL as a server failure, NOT as 'no record'", () => {
    /*
     * THE regression test for issue #3916's first defect. Through reverse()
     * this address came back ENOTFOUND — indistinguishable from a device
     * with no PTR record, never retried, never reported. It is now a failed
     * lookup, asked twice, and counted.
     */
    expect(kitchen.hostnameByIpAddress.has("10.16.42.54")).toBe(false);
    expect(kitchen.statusByIpAddress?.get("10.16.42.54")).toBe(
      DiscoveredHostReverseDnsStatus.ServerFailure,
    );
    expect(kitchenServer.queriesFor("54.42.16.10.in-addr.arpa")).toHaveLength(
      2,
    );
    expect(kitchen.failureReason).toBeDefined();
  });

  it("reports a persistent REFUSED as refused", () => {
    expect(kitchen.statusByIpAddress?.get("10.16.42.55")).toBe(
      DiscoveredHostReverseDnsStatus.Refused,
    );
    expect(kitchenServer.queriesFor("55.42.16.10.in-addr.arpa")).toHaveLength(
      2,
    );
  });

  it("names a device whose first datagram was lost, on the retry", () => {
    expect(kitchen.hostnameByIpAddress.get("10.16.42.56")).toBe(
      "wb0024kds06.wbhq.example",
    );
    expect(kitchen.statusByIpAddress?.has("10.16.42.56")).toBe(false);
    expect(kitchenServer.queriesFor("56.42.16.10.in-addr.arpa")).toHaveLength(
      2,
    );
  });

  it("names a device whose answer takes longer than the first pass's two seconds, on the retry", () => {
    expect(kitchen.hostnameByIpAddress.get("10.16.42.57")).toBe(
      "wb0024kds07.wbhq.example",
    );
    expect(kitchen.statusByIpAddress?.has("10.16.42.57")).toBe(false);
  });

  it("names a device behind an RFC 2317 CNAME", () => {
    expect(kitchen.hostnameByIpAddress.get("10.16.42.58")).toBe(
      "wb0024kds08.wbhq.example",
    );
  });

  it("reports a record that only echoes the query name as an unusable name", () => {
    expect(kitchen.hostnameByIpAddress.has("10.16.42.59")).toBe(false);
    expect(kitchen.statusByIpAddress?.get("10.16.42.59")).toBe(
      DiscoveredHostReverseDnsStatus.UnusableName,
    );
    // It answered, so it is not retried.
    expect(kitchenServer.queriesFor("59.42.16.10.in-addr.arpa")).toHaveLength(
      1,
    );
  });

  it("names a device whose first answer was a one-off SERVFAIL, on the retry", () => {
    expect(kitchen.hostnameByIpAddress.get("10.16.42.60")).toBe(
      "wb0024kds10.wbhq.example",
    );
  });

  it("reports a black-holed device as a timeout, after asking it twice", () => {
    expect(kitchen.statusByIpAddress?.get("10.16.42.61")).toBe(
      DiscoveredHostReverseDnsStatus.Timeout,
    );
    expect(kitchenServer.queriesFor("61.42.16.10.in-addr.arpa")).toHaveLength(
      2,
    );
  });

  it("accounts for every display exactly once, and counts only the three that failed twice", () => {
    const named: Array<string> = [...kitchen.hostnameByIpAddress.keys()];
    const explained: Array<string> = [...kitchen.statusByIpAddress!.keys()];

    expect([...named, ...explained].sort()).toEqual(
      Object.keys(KITCHEN).sort(),
    );
    expect(new Set<string>([...named, ...explained]).size).toBe(12);

    /*
     * Six named where reverse() and no retry named three (.51, .58, .62):
     * the dropped datagram, the slow answer and the one-off SERVFAIL are
     * names the probe used to throw away.
     */
    expect(kitchen.hostnameByIpAddress.size).toBe(6);

    // SERVFAIL, REFUSED and the black hole — not the two "no record"s.
    expect(kitchen.failedAddressCount).toBe(3);
    expect(kitchen.isReverseDnsAvailable).toBe(true);
    expect(kitchen.isTimeBudgetExhausted).toBe(false);
    expect(kitchen.lookedUpCount).toBe(12);
    expect(kitchen.notLookedUpCount).toBe(0);
  });

  it("names every address a SERVFAILing, black-holing or REFUSING primary could not, from the secondary", () => {
    /*
     * The second defect's other half. c-ares takes a SERVFAIL or REFUSED
     * from the first server as final, and moves on from a silent one only
     * after the whole timeout — which the first pass's race always ends
     * first. So none of these three was ever asked of the secondary, and a
     * probe whose primary nameserver was unwell named nothing it served.
     * The retry asks each server explicitly.
     */
    expect(twoServers.hostnameByIpAddress.get("10.16.43.71")).toBe(
      "secondary-71.wbhq.example",
    );
    expect(twoServers.hostnameByIpAddress.get("10.16.43.72")).toBe(
      "secondary-72.wbhq.example",
    );
    expect(twoServers.hostnameByIpAddress.get("10.16.43.73")).toBe(
      "secondary-73.wbhq.example",
    );

    expect(twoServers.statusByIpAddress?.size).toBe(0);
    expect(twoServers.failedAddressCount).toBe(0);
  });

  itWithoutRotation(
    "asks the primary again before it asks the secondary",
    () => {
      /*
       * In configured order. The LAST query each server saw is compared, not
       * the first: when the primary black-holes, c-ares may fail over to the
       * secondary in the same instant the first pass's race gives up, so the
       * secondary can see an early query whose answer nobody waited for.
       */
      for (const octet of ["71", "72", "73"]) {
        const name: string = `${octet}.43.16.10.in-addr.arpa`;
        const primaryAsked: Array<FakeDnsQuery> =
          primaryServer.queriesFor(name);
        const secondaryAsked: Array<FakeDnsQuery> =
          secondaryServer.queriesFor(name);

        expect(primaryAsked.length).toBeGreaterThanOrEqual(1);
        expect(secondaryAsked.length).toBeGreaterThanOrEqual(1);
        expect(
          secondaryAsked[secondaryAsked.length - 1]!.receivedAt,
        ).toBeGreaterThanOrEqual(
          primaryAsked[primaryAsked.length - 1]!.receivedAt,
        );
      }
    },
  );

  itWithoutRotation(
    "takes a healthy primary's answer without asking the secondary",
    () => {
      expect(twoServers.hostnameByIpAddress.get("10.16.43.75")).toBe(
        "primary-75.wbhq.example",
      );
      expect(
        secondaryServer.queriesFor("75.43.16.10.in-addr.arpa"),
      ).toHaveLength(0);
    },
  );

  it("finishes both passes within one first-pass timeout plus one retry attempt, with room to spare", () => {
    /*
     * The retry is bounded. The slowest addresses here — the black hole, and
     * the address whose primary black-holes — cost the first pass's two
     * seconds plus one four-second retry attempt that c-ares itself ends
     * (the secondary then answers at once), and every other scenario waits
     * in parallel with them. About six seconds; the bound allows the race's
     * slack and two more seconds for a loaded machine; a retry that sat
     * through two silent four-second attempts for one address would not fit.
     */
    expect(passDurationInMs).toBeLessThan(
      DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS +
        DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS +
        REVERSE_DNS_RETRY_RACE_SLACK_IN_MS +
        2000,
    );
  });
});

describe("the real resolver: the codes the default lookup now sees", () => {
  let server: FakeDnsServer;
  let lookup: ReverseDnsLookupFunction;
  let factory: ReverseDnsResolverFactory;

  beforeAll(async () => {
    server = await startFakeDnsServer(kitchenResponder);
    factory = loopbackResolverFactory([server.address]);
    lookup = buildDefaultLookup(DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS, factory);
  });

  afterAll(async () => {
    await server?.close();
  });

  it.each([
    ["10.16.42.52", "ENOTFOUND"],
    ["10.16.42.53", "ENODATA"],
    ["10.16.42.54", "ESERVFAIL"],
    ["10.16.42.55", "EREFUSED"],
  ])(
    "rejects %s with the server's real code, %s",
    async (ipAddress: string, code: string) => {
      await expect(lookup(ipAddress)).rejects.toMatchObject({ code: code });
    },
  );

  it("resolves a PTR record through resolvePtr, not through the hosts file", async () => {
    const before: number = server.queriesFor("51.42.16.10.in-addr.arpa").length;

    await expect(lookup("10.16.42.51")).resolves.toEqual([
      "wb0024kds01.wbhq.example",
    ]);

    expect(server.queriesFor("51.42.16.10.in-addr.arpa")).toHaveLength(
      before + 1,
    );
  });

  it("documents the defect: reverse() reports the same SERVFAIL as ENOTFOUND", async () => {
    /*
     * Not a test of the probe — a record of WHY the probe no longer calls
     * reverse() for an IPv4 address, pinned against the c-ares Node ships.
     * If this ever fails, reverse() has started reporting real codes and the
     * resolvePtr detour could be reconsidered; until then, it is the whole
     * of issue #3916's first defect in one assertion.
     */
    const resolver: ReverseDnsResolverLike = factory(
      DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
    );

    await expect(resolver.reverse("10.16.42.54")).rejects.toMatchObject({
      code: "ENOTFOUND",
    });
    await expect(resolver.reverse("10.16.42.55")).rejects.toMatchObject({
      code: "ENOTFOUND",
    });
  });

  it("reports a nameserver with nothing listening as unreachable, and does not convict the probe", async () => {
    const closedPort: number = await reserveClosedUdpPort();
    const deadFactory: ReverseDnsResolverFactory = loopbackResolverFactory([
      `127.0.0.1:${closedPort}`,
    ]);

    await expect(
      buildDefaultLookup(
        DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
        deadFactory,
      )("10.16.42.51"),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });

    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: buildDefaultLookup(
        DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
        deadFactory,
      ),
      retryLookup: buildDefaultRetryLookup(
        DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
        deadFactory,
      ),
    }).resolveHostnames(["10.16.42.51", "10.16.42.62", "10.16.42.52"]);

    expect([...result.statusByIpAddress!.values()]).toEqual([
      DiscoveredHostReverseDnsStatus.Unreachable,
      DiscoveredHostReverseDnsStatus.Unreachable,
      DiscoveredHostReverseDnsStatus.Unreachable,
    ]);
    expect(result.failedAddressCount).toBe(3);
    // Three failures against a budget of sixty-four: not yet a verdict.
    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.failureReason).toContain("ECONNREFUSED");
  });

  /*
   * The hosts file. c-ares reads it for reverse() before asking DNS, and the
   * bundled probes run with host networking, so an operator who listed
   * devices in the probe host's /etc/hosts got those names — and switching
   * to resolvePtr, which never reads it, would have taken them away. The
   * fallback puts them back for any address DNS says has no record.
   *
   * c-ares reads the real /etc/hosts and offers no way to point it elsewhere
   * for this call, so this uses the first IPv4 entry the machine already has
   * (every Linux and Docker image has at least "127.0.0.1 localhost") and is
   * skipped where there is none. The loopback server answers NXDOMAIN for
   * it, so any name that comes back can only have come from the file.
   */
  const hostsFile: HostsFileContents = readHostsFile();

  (hostsFile.firstIpv4Address ? it : it.skip)(
    "names an address from the hosts file when DNS says it has no record",
    async () => {
      const ipAddress: string = hostsFile.firstIpv4Address!;
      const reverseName: string = `${ipAddress
        .split(".")
        .reverse()
        .join(".")}.in-addr.arpa`;
      const before: number = server.queriesFor(reverseName).length;

      const names: Array<string> = await lookup(ipAddress);

      /*
       * Names FROM the file, though not necessarily that line's first: c-ares
       * merges hosts-file lines that share a name, so 127.0.0.1 comes back
       * as the "::1 localhost ip6-localhost" line's "ip6-localhost" on a
       * stock Debian file.
       */
      expect(names.length).toBeGreaterThan(0);

      for (const name of names) {
        expect(hostsFile.names.has(name)).toBe(true);
      }

      // DNS was asked first, and said NXDOMAIN.
      expect(server.queriesFor(reverseName).length).toBeGreaterThan(before);
    },
  );
});

interface HostsFileContents {
  firstIpv4Address: string | undefined;
  // Every name on every line.
  names: Set<string>;
}

function readHostsFile(): HostsFileContents {
  const contents: HostsFileContents = {
    firstIpv4Address: undefined,
    names: new Set<string>(),
  };

  let text: string = "";

  try {
    text = fs.readFileSync("/etc/hosts", "utf8");
  } catch {
    return contents;
  }

  for (const line of text.split("\n")) {
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

    for (const name of fields.slice(1)) {
      contents.names.add(name);
    }

    if (
      contents.firstIpv4Address === undefined &&
      DOTTED_QUAD_PATTERN.test(fields[0]!)
    ) {
      contents.firstIpv4Address = fields[0];
    }
  }

  return contents;
}
