import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  ClientAddressReading,
  ClientAddressTrust,
  MAX_FORWARDED_BY,
  NO_TRUSTED_PROXIES,
  TrustedProxies,
  UnvouchedForwarding,
  isTrustedProxy,
  isUntrustedProxyAddress,
  isVouchedProxy,
  markClientAddressTrust,
  readUnvouchedForwarding,
  resolveClientAddress,
} from "../../../Utils/SecurityEvent/ClientAddressTrust";
import { GOOGLE_FRONT_END_RANGES } from "../../../Utils/SecurityEvent/OwnLoadBalancers";
import {
  NO_TRUSTED_PROXY_SOURCES,
  TrustedProxySource,
  TrustedProxySources,
  UNREAD_TRUSTED_PROXY_SOURCES,
  findTrustedProxySource,
  trustedProxiesOf,
} from "../../../Utils/SecurityEvent/TrustedProxySources";

/*
 * #11389: A PROXY THAT WORKS AT THE TCP LEVEL PASSES ON WHAT A CLIENT WROTE.
 *
 * It adds nothing to X-Forwarded-For: the app sees the connection come from
 * the proxy, with the header as the client sent it. Every project trusted
 * every private address as a proxy, so behind a TCP proxy at one - an AWS
 * Network Load Balancer without client IP preservation, a Google Cloud
 * proxy Network Load Balancer's proxy-only subnet, HAProxy in mode tcp,
 * nginx's stream module, a Kubernetes Service with externalTrafficPolicy:
 * Cluster - the walk took the last address the client wrote for the
 * verified client. A client chose who an attack was blamed on, and whose
 * address a block was offered for, or made automatically.
 *
 * Three answers, held here on the trust model itself:
 *
 *   - where a load balancer the project's clouds list as one of those
 *     connects from is never trusted, whatever else lists it
 *     (untrustedBlocks);
 *   - a project can stop trusting private addresses (trustsPrivateAddresses,
 *     Project.securityTrustPrivateAddresses): off for a new project;
 *   - an address that came through a private proxy nothing vouches for is
 *     never acted on automatically (readUnvouchedForwarding).
 */

const VICTIM: string = "198.51.100.7";
const ATTACKER: string = "203.0.113.66";

function blocks(...ranges: Array<string>): Array<NetworkAddressBlock> {
  return ranges.map((range: string): NetworkAddressBlock => {
    return NetworkAddressBlockUtil.parse(range)!;
  });
}

function proxies(data: Partial<TrustedProxies> = {}): TrustedProxies {
  return { blocks: [], ...data };
}

// The request as the app recorded it: from the proxy, carrying what the client wrote.
function through(
  peer: string,
  forwardedFor: string,
  trust: TrustedProxies,
): ClientAddressReading {
  return resolveClientAddress({ peer, forwardedFor }, trust);
}

describe("the gap, as every project trusted every private address", () => {
  test("behind a TCP proxy at a private address, the client named whom an attack is blamed on", () => {
    // The attacker connects through the proxy, writing the victim's address.
    const reading: ClientAddressReading = through(
      "10.0.1.57",
      VICTIM,
      NO_TRUSTED_PROXIES,
    );

    expect(reading.address).toBe(VICTIM);
    expect(reading.trust).toBe(ClientAddressTrust.TrustedProxy);
    expect(reading.forwardedBy).toEqual(["10.0.1.57"]);
  });

  test("a project that says nothing still trusts private addresses, as before: nothing breaks overnight", () => {
    expect(isTrustedProxy("10.0.1.57", NO_TRUSTED_PROXIES)).toBe(true);
    expect(isTrustedProxy("10.0.1.57", proxies())).toBe(true);
    expect(
      isTrustedProxy("10.0.1.57", proxies({ trustsPrivateAddresses: true })),
    ).toBe(true);
  });

  test("but the automatic response never acts on what that proxy forwarded: nothing vouches for it", () => {
    const attributes: JSONObject = {};

    markClientAddressTrust(
      attributes,
      through("10.0.1.57", VICTIM, NO_TRUSTED_PROXIES),
    );

    expect(
      readUnvouchedForwarding({ attributes }, NO_TRUSTED_PROXIES),
    ).toEqual({ hop: "10.0.1.57" });
  });
});

/*
 * Each kind of TCP proxy, by where it connects from. The ones the
 * project's clouds list are untrusted wherever they connect from; the
 * ones OneUptime cannot see are closed by turning private addresses off.
 */
interface TcpProxyCase {
  what: string;
  // Where the proxy connects to the app from.
  peer: string;
  // What is never trusted for it, when its cloud lists it.
  untrusted: Array<string>;
  // What else trusts it: listed, or brought by another load balancer.
  listed: Array<string>;
}

const LISTED_BY_CLOUDS: Array<TcpProxyCase> = [
  {
    what: "an AWS Network Load Balancer without client IP preservation, from its subnet",
    peer: "10.0.1.57",
    untrusted: ["10.0.1.0/24", "10.0.2.0/24"],
    listed: [],
  },
  {
    what: "an AWS Network Load Balancer whose subnet a project listed as its proxy",
    peer: "10.0.2.31",
    untrusted: ["10.0.1.0/24", "10.0.2.0/24"],
    listed: ["10.0.0.0/16"],
  },
  {
    what: "a dualstack AWS Network Load Balancer handing an IPv6 client to IPv4 targets",
    peer: "10.0.2.9",
    untrusted: ["10.0.2.0/24", "2a05:d018:1:a00::/64"],
    listed: [],
  },
  {
    what: "an AWS Classic Load Balancer with a TCP listener",
    peer: "10.0.5.4",
    untrusted: ["10.0.5.0/24"],
    listed: [],
  },
  {
    what: "a Google Cloud regional proxy Network Load Balancer, from its proxy-only subnet",
    peer: "10.129.0.12",
    untrusted: ["10.129.0.0/23"],
    listed: [],
  },
  {
    what: "a Google Cloud proxy-only subnet an Application Load Balancer shares, listed as its own",
    peer: "10.129.1.3",
    untrusted: ["10.129.0.0/23"],
    listed: ["10.129.0.0/23"],
  },
  {
    what: "a Google Cloud global TCP proxy, from Google's front ends the old docs said to list",
    peer: "35.191.4.8",
    untrusted: [...GOOGLE_FRONT_END_RANGES],
    listed: ["35.191.0.0/16", "130.211.0.0/22"],
  },
  {
    what: "a Google Cloud classic SSL proxy, over IPv6",
    peer: "2600:2d00:1:1::17",
    untrusted: [...GOOGLE_FRONT_END_RANGES],
    listed: [],
  },
];

describe("a TCP proxy the project's clouds list", () => {
  test.each(LISTED_BY_CLOUDS)(
    "$what: the proxy is blamed, and what the client wrote only claimed",
    (proxy: TcpProxyCase) => {
      const trust: TrustedProxies = proxies({
        blocks: blocks(...proxy.listed),
        untrustedBlocks: blocks(...proxy.untrusted),
      });
      const reading: ClientAddressReading = through(
        proxy.peer,
        VICTIM,
        trust,
      );

      expect(isUntrustedProxyAddress(proxy.peer, trust)).toBe(true);
      expect(isTrustedProxy(proxy.peer, trust)).toBe(false);
      expect(isVouchedProxy(proxy.peer, trust)).toBe(false);
      expect(reading.address).toBe(proxy.peer);
      expect(reading.trust).toBe(ClientAddressTrust.Peer);
      expect(reading.claimed?.address).toBe(VICTIM);
      expect(reading.forwardedBy).toBeUndefined();
    },
  );

  test.each(LISTED_BY_CLOUDS)(
    "$what: the same, whether or not private addresses are trusted",
    (proxy: TcpProxyCase) => {
      for (const trustsPrivateAddresses of [true, false, undefined]) {
        expect(
          isTrustedProxy(
            proxy.peer,
            proxies({
              blocks: blocks(...proxy.listed),
              untrustedBlocks: blocks(...proxy.untrusted),
              trustsPrivateAddresses,
            }),
          ),
        ).toBe(false);
      }
    },
  );

  test("a hop of such a proxy further in, right of the client, ends the walk there: the header left of it was the client's", () => {
    const trust: TrustedProxies = proxies({
      blocks: blocks("10.0.0.0/8"),
      untrustedBlocks: blocks("10.129.0.0/23"),
    });

    // The client wrote the victim; the proxy-only subnet passed it on; an HTTP proxy listed appended the hop it saw.
    const reading: ClientAddressReading = through(
      "10.0.9.4",
      `${VICTIM}, 10.129.0.12`,
      trust,
    );

    expect(reading.address).toBe("10.129.0.12");
    expect(reading.trust).toBe(ClientAddressTrust.TrustedProxy);
    expect(reading.claimed?.address).toBe(VICTIM);
  });

  test("the rest of a range listed around it is still trusted", () => {
    const trust: TrustedProxies = proxies({
      blocks: blocks("10.0.0.0/16"),
      untrustedBlocks: blocks("10.0.1.0/24"),
      trustsPrivateAddresses: false,
    });

    expect(isTrustedProxy("10.0.3.8", trust)).toBe(true);
    expect(isVouchedProxy("10.0.3.8", trust)).toBe(true);
    expect(through("10.0.3.8", ATTACKER, trust).address).toBe(ATTACKER);
  });
});

/*
 * What OneUptime cannot see: HAProxy in mode tcp, nginx's stream module, a
 * Kubernetes Service with externalTrafficPolicy: Cluster that hands the
 * ingress each connection from a node's address.
 */
const UNSEEN: Array<{ what: string; peer: string }> = [
  { what: "HAProxy in mode tcp", peer: "10.10.0.5" },
  { what: "nginx's stream module, on the same host", peer: "127.0.0.1" },
  {
    what: "a Kubernetes Service with externalTrafficPolicy: Cluster, from a node",
    peer: "192.168.14.3",
  },
  { what: "a TCP proxy on an IPv6 unique local address", peer: "fd12:3456::9" },
  { what: "one on a carrier-grade NAT address", peer: "100.64.2.9" },
];

describe("a TCP proxy OneUptime cannot see", () => {
  test.each(UNSEEN)(
    "$what: with Private Addresses off, the proxy is blamed and the client's words only claimed",
    ({ peer }: { peer: string }) => {
      const trust: TrustedProxies = proxies({ trustsPrivateAddresses: false });
      const reading: ClientAddressReading = through(peer, VICTIM, trust);

      expect(isTrustedProxy(peer, trust)).toBe(false);
      expect(reading.address).toBe(peer);
      expect(reading.trust).toBe(ClientAddressTrust.Peer);
      expect(reading.claimed?.address).toBe(VICTIM);
    },
  );

  test.each(UNSEEN)(
    "$what: with it on, the walk takes the client's words, and the event says through which proxy - never acted on automatically",
    ({ peer }: { peer: string }) => {
      const trust: TrustedProxies = proxies({ trustsPrivateAddresses: true });
      const reading: ClientAddressReading = through(peer, VICTIM, trust);
      const attributes: JSONObject = {};

      markClientAddressTrust(attributes, reading);

      expect(reading.address).toBe(VICTIM);
      expect(readUnvouchedForwarding({ attributes }, trust)).toEqual({
        hop: peer,
      });
    },
  );

  test("an HTTP proxy the project lists is trusted with Private Addresses off, and vouched for", () => {
    const trust: TrustedProxies = proxies({
      blocks: blocks("10.10.0.0/24"),
      trustsPrivateAddresses: false,
    });
    const reading: ClientAddressReading = through("10.10.0.5", ATTACKER, trust);
    const attributes: JSONObject = {};

    markClientAddressTrust(attributes, reading);

    expect(reading.address).toBe(ATTACKER);
    expect(reading.trust).toBe(ClientAddressTrust.TrustedProxy);
    expect(readUnvouchedForwarding({ attributes }, trust)).toBeNull();
  });
});

describe("which proxies the project vouches for", () => {
  const TRUST: TrustedProxies = proxies({
    blocks: blocks("203.0.113.0/24", "10.20.0.0/16", "52.1.2.3"),
    untrustedBlocks: blocks("10.20.9.0/24"),
    trustsPrivateAddresses: true,
  });

  test("one it lists, or one of an edge or a load balancer of its own, whatever its scope", () => {
    for (const address of ["203.0.113.10", "10.20.1.1", "52.1.2.3"]) {
      expect(isVouchedProxy(address, TRUST)).toBe(true);
      expect(isTrustedProxy(address, TRUST)).toBe(true);
    }
  });

  test("never a private address only its scope trusts: it may be a TCP proxy", () => {
    for (const address of ["10.99.0.4", "127.0.0.1", "192.168.0.10", "fe80::1"]) {
      expect(isTrustedProxy(address, TRUST)).toBe(true);
      expect(isVouchedProxy(address, TRUST)).toBe(false);
    }
  });

  test("never where a load balancer that passes on connects from, even listed", () => {
    expect(isVouchedProxy("10.20.9.4", TRUST)).toBe(false);
    expect(isTrustedProxy("10.20.9.4", TRUST)).toBe(false);
  });

  test("never a public address nothing lists, nor what is no address", () => {
    for (const address of ["198.51.100.20", "not an address", "", "10.0.0.256"]) {
      expect(isVouchedProxy(address, TRUST)).toBe(false);
    }

    expect(isVouchedProxy("10.20.1.1", undefined)).toBe(false);
  });
});

// An event's attributes, as a scan writes them from its reading.
function eventOf(reading: ClientAddressReading): { attributes: JSONObject } {
  const attributes: JSONObject = {};

  markClientAddressTrust(attributes, reading);

  return { attributes };
}

describe("whether an event's address came through a proxy nothing vouches for", () => {
  test("its own connection's address did not come through any: nothing to say", () => {
    expect(
      readUnvouchedForwarding(
        eventOf(through(ATTACKER, VICTIM, NO_TRUSTED_PROXIES)),
        NO_TRUSTED_PROXIES,
      ),
    ).toBeNull();
  });

  test("an address only claimed is no event's address to act on: nothing to say", () => {
    const claimed: ClientAddressReading = resolveClientAddress(
      { forwardedClient: VICTIM, forwardedClientFrom: "client.address" },
      NO_TRUSTED_PROXIES,
    );

    expect(claimed.trust).toBe(ClientAddressTrust.Claimed);
    expect(
      readUnvouchedForwarding(eventOf(claimed), NO_TRUSTED_PROXIES),
    ).toBeNull();
  });

  test("the first one from the server out that nothing vouches for is named", () => {
    const trust: TrustedProxies = proxies({
      blocks: blocks("10.0.0.0/24"),
      trustsPrivateAddresses: true,
    });
    // The client, an unlisted private hop, then the listed proxy the app saw.
    const reading: ClientAddressReading = through(
      "10.0.0.9",
      `${VICTIM}, 10.50.0.3`,
      trust,
    );

    expect(reading.forwardedBy).toEqual(["10.50.0.3", "10.0.0.9"]);
    expect(readUnvouchedForwarding(eventOf(reading), trust)).toEqual({
      hop: "10.50.0.3",
    });
  });

  test("every proxy vouched for: nothing to say", () => {
    const trust: TrustedProxies = proxies({
      blocks: blocks("10.0.0.0/24", "203.0.113.0/24"),
      trustsPrivateAddresses: true,
    });
    const reading: ClientAddressReading = through(
      "10.0.0.9",
      `${VICTIM}, 203.0.113.10`,
      trust,
    );

    expect(readUnvouchedForwarding(eventOf(reading), trust)).toBeNull();
  });

  test("read with the proxies as they are now: listing the proxy since lets it act; a load balancer found since stops it", () => {
    const recorded: { attributes: JSONObject } = eventOf(
      through("10.50.0.3", VICTIM, NO_TRUSTED_PROXIES),
    );

    expect(
      readUnvouchedForwarding(recorded, NO_TRUSTED_PROXIES),
    ).toEqual({ hop: "10.50.0.3" });
    expect(
      readUnvouchedForwarding(
        recorded,
        proxies({ blocks: blocks("10.50.0.0/24") }),
      ),
    ).toBeNull();
    expect(
      readUnvouchedForwarding(
        recorded,
        proxies({
          blocks: blocks("10.50.0.0/24"),
          untrustedBlocks: blocks("10.50.0.0/26"),
        }),
      ),
    ).toEqual({ hop: "10.50.0.3" });
  });

  test("an event that cannot say which proxies it came through is never acted on: it names none, or as many as it keeps", () => {
    // Recorded before events said whom they came through (#11046).
    expect(
      readUnvouchedForwarding(
        {
          attributes: {
            [SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust]:
              ClientAddressTrust.TrustedProxy,
          },
        },
        proxies({ blocks: blocks("10.0.0.0/8") }),
      ),
    ).toEqual({ hop: "" });

    // As many as it keeps: the nearest of more, the farthest unknown.
    const trust: TrustedProxies = proxies({ blocks: blocks("10.0.0.0/8") });
    const hops: Array<string> = Array.from(
      { length: MAX_FORWARDED_BY + 2 },
      (_value: unknown, index: number): string => {
        return `10.0.0.${index + 1}`;
      },
    );
    const reading: ClientAddressReading = through(
      "10.0.1.1",
      [VICTIM, ...hops].join(", "),
      trust,
    );

    expect(reading.forwardedBy).toHaveLength(MAX_FORWARDED_BY);

    const answer: UnvouchedForwarding | null = readUnvouchedForwarding(
      eventOf(reading),
      trust,
    );

    expect(answer).toEqual({ hop: "" });
  });

  test("an event of fewer hops than it keeps, every one vouched for, says nothing", () => {
    const trust: TrustedProxies = proxies({ blocks: blocks("10.0.0.0/8") });
    const hops: Array<string> = Array.from(
      { length: MAX_FORWARDED_BY - 2 },
      (_value: unknown, index: number): string => {
        return `10.0.0.${index + 1}`;
      },
    );
    const reading: ClientAddressReading = through(
      "10.0.1.1",
      [VICTIM, ...hops].join(", "),
      trust,
    );

    expect(reading.forwardedBy).toHaveLength(MAX_FORWARDED_BY - 1);
    expect(readUnvouchedForwarding(eventOf(reading), trust)).toBeNull();
  });

  test("an event with no attributes, or attributes that are not an object, says nothing", () => {
    for (const attributes of [undefined, null, "TrustedProxy", 7, []]) {
      expect(
        readUnvouchedForwarding({ attributes }, NO_TRUSTED_PROXIES),
      ).toBeNull();
    }
  });
});

/*
 * Where each trusted proxy comes from (Check a log line), as the scans read
 * them: what is never trusted first, then the most particular reason.
 */
describe("the sources of trust", () => {
  function sources(data: Partial<TrustedProxySources>): TrustedProxySources {
    return { ...NO_TRUSTED_PROXY_SOURCES, ...data };
  }

  test("what is never trusted beats every source that would trust it", () => {
    const all: TrustedProxySources = sources({
      listed: blocks("10.0.0.0/8"),
      edges: [{ name: "Cloudflare", blocks: blocks("10.0.0.0/16") }],
      ownLoadBalancers: blocks("10.0.1.57/32"),
      googleFrontEnds: blocks("10.0.1.0/24"),
      untrusted: blocks("10.0.1.0/24"),
      trustsPrivateAddresses: true,
    });

    expect(findTrustedProxySource("10.0.1.57", all)).toBeNull();
    expect(isTrustedProxy("10.0.1.57", trustedProxiesOf(all))).toBe(false);
  });

  test("the most particular reason first: listed, an edge, a load balancer of the project's, Google's front ends, then private", () => {
    const all: TrustedProxySources = sources({
      listed: blocks("10.1.0.0/16"),
      edges: [{ name: "Cloudflare", blocks: blocks("10.1.0.0/17", "10.2.0.0/16") }],
      ownLoadBalancers: blocks("10.1.0.5/32", "10.2.0.5/32", "10.3.0.5/32"),
      googleFrontEnds: blocks("10.1.0.0/24", "10.4.0.0/16"),
      trustsPrivateAddresses: true,
    });

    expect(findTrustedProxySource("10.1.0.5", all)?.source).toBe(
      TrustedProxySource.Listed,
    );
    expect(findTrustedProxySource("10.2.0.5", all)).toEqual({
      address: "10.2.0.5",
      source: TrustedProxySource.Edge,
      edgeName: "Cloudflare",
    });
    expect(findTrustedProxySource("10.3.0.5", all)?.source).toBe(
      TrustedProxySource.OwnLoadBalancer,
    );
    expect(findTrustedProxySource("10.4.0.5", all)?.source).toBe(
      TrustedProxySource.GoogleFrontEnd,
    );
    expect(findTrustedProxySource("10.5.0.5", all)?.source).toBe(
      TrustedProxySource.Private,
    );
  });

  test("private only while the project trusts private addresses", () => {
    expect(
      findTrustedProxySource(
        "10.5.0.5",
        sources({ trustsPrivateAddresses: false }),
      ),
    ).toBeNull();
    expect(
      findTrustedProxySource("10.5.0.5", UNREAD_TRUSTED_PROXY_SOURCES),
    ).toBeNull();
    expect(
      findTrustedProxySource("10.5.0.5", NO_TRUSTED_PROXY_SOURCES)?.source,
    ).toBe(TrustedProxySource.Private);
  });

  test("a source says it trusts an address exactly when the parsers trust it", () => {
    const all: TrustedProxySources = sources({
      listed: blocks("203.0.113.0/24", "10.1.0.0/16"),
      edges: [{ name: "Cloudflare", blocks: blocks("104.16.0.0/13") }],
      ownLoadBalancers: blocks("52.1.2.3/32"),
      googleFrontEnds: blocks("35.191.0.0/16"),
      untrusted: blocks("10.1.9.0/24", "35.191.4.0/24"),
    });

    for (const trustsPrivateAddresses of [true, false]) {
      const set: TrustedProxySources = { ...all, trustsPrivateAddresses };

      for (const address of [
        "203.0.113.10",
        "10.1.0.4",
        "10.1.9.4",
        "104.16.1.1",
        "52.1.2.3",
        "35.191.1.1",
        "35.191.4.8",
        "10.77.0.1",
        "127.0.0.1",
        "198.51.100.20",
        "fd00::1",
        "not an address",
      ]) {
        expect({
          address,
          trustsPrivateAddresses,
          trusted: isTrustedProxy(address, trustedProxiesOf(set)),
        }).toEqual({
          address,
          trustsPrivateAddresses,
          trusted: findTrustedProxySource(address, set) !== null,
        });
      }
    }
  });
});
