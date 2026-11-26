import { JSONObject } from "../../../Types/JSON";
import { SecurityBlockAction } from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityAttackCampaign,
  readSecurityAttackCampaign,
} from "../../../Types/SecurityEvent/SecurityAttackCampaign";
import {
  SECURITY_ATTACK_NETWORK_ADDRESSES_KEPT,
  SECURITY_ATTACK_NETWORK_ASN_ATTRIBUTE,
  SecurityAttackNetwork,
  SecurityAttackNetworkKind,
  getSecurityAttackNetworkChallengeValues,
  getSecurityAttackNetworkOf,
  getSecurityAttackNetworkRequestsFilter,
  getSecurityAttackRangeAddressGlobs,
  getSecurityAttackRangeOfAddress,
  groupSecurityAttackCampaignsByNetwork,
  readSecurityAttackNetwork,
} from "../../../Types/SecurityEvent/SecurityAttackNetwork";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { CLOUDFLARE_ATTRIBUTES } from "../../../Utils/SecurityEvent/Connectors/CloudflareNormalizer";
import NetworkAddressBlockUtil from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import escapeRegExp from "../../../Utils/RegExpEscape";
import { describe, expect, test } from "@jest/globals";

/*
 * CAMPAIGNS BY NETWORK (#10354): a rotating attacker's addresses on one row
 * - by its ASN where Cloudflare's events carry one, else by its /24 (IPv4)
 * or /48 (IPv6) - with its counts added up, worst first, and an ASN's row
 * naming the ranges it sent from.
 */

function campaign(
  sourceIp: string,
  overrides: Partial<SecurityAttackCampaign> = {},
): SecurityAttackCampaign {
  return {
    sourceIp,
    requestCount: 10,
    rejectedCount: 10,
    reachedAppCount: 0,
    erroredCount: 0,
    reachedDatabaseCount: 0,
    worstOutcome: SecurityEventRequestOutcome.Rejected,
    maxSeverityId: 3,
    attackKinds: ["PathTraversal"],
    userAgents: ["zgrab/0.x"],
    targetCount: 4,
    sampleTargets: ["/.env"],
    firstSeen: "2026-11-20T10:00:00.000Z",
    lastSeen: "2026-11-20T11:00:00.000Z",
    ...overrides,
  };
}

function networkNamed(
  networks: Array<SecurityAttackNetwork>,
  name: string,
): SecurityAttackNetwork {
  const found: SecurityAttackNetwork | undefined = networks.find(
    (network: SecurityAttackNetwork): boolean => {
      return network.network === name;
    },
  );

  if (!found) {
    throw new Error(`No network row for ${name}.`);
  }

  return found;
}

describe("the network of an address", () => {
  test("an IPv4 address is in its /24", () => {
    expect(getSecurityAttackRangeOfAddress("203.0.113.77")).toBe(
      "203.0.113.0/24",
    );
    expect(getSecurityAttackRangeOfAddress("198.51.100.0")).toBe(
      "198.51.100.0/24",
    );
  });

  test("an IPv6 address is in its /48, however it is written", () => {
    expect(getSecurityAttackRangeOfAddress("2001:db8:1:2::7")).toBe(
      "2001:db8:1::/48",
    );
    expect(
      getSecurityAttackRangeOfAddress(
        "2001:0DB8:0001:FFFF:0000:0000:0000:0001",
      ),
    ).toBe("2001:db8:1::/48");
  });

  test("an IPv4 address an IPv6 one maps is in the IPv4 /24", () => {
    expect(getSecurityAttackRangeOfAddress("::ffff:203.0.113.9")).toBe(
      "203.0.113.0/24",
    );
  });

  test("nothing that is no single address has a network", () => {
    expect(getSecurityAttackRangeOfAddress("")).toBeNull();
    expect(getSecurityAttackRangeOfAddress("unknown")).toBeNull();
    expect(getSecurityAttackRangeOfAddress("203.0.113.0/24")).toBeNull();
    expect(getSecurityAttackRangeOfAddress(undefined)).toBeNull();
  });

  test("an address whose events carry an ASN is in its ASN", () => {
    expect(
      getSecurityAttackNetworkOf({ sourceIp: "203.0.113.7", asn: "AS14061" }),
    ).toEqual({ network: "AS14061", kind: SecurityAttackNetworkKind.Asn });
  });

  test("an address with no ASN is in its range", () => {
    expect(getSecurityAttackNetworkOf({ sourceIp: "203.0.113.7" })).toEqual({
      network: "203.0.113.0/24",
      kind: SecurityAttackNetworkKind.Range,
    });
  });

  test("a campaign with no address has no network", () => {
    expect(getSecurityAttackNetworkOf({ sourceIp: "" })).toBeNull();
  });
});

describe("grouping campaigns by network", () => {
  test("groups IPv4 addresses by their /24", () => {
    const networks: Array<SecurityAttackNetwork> =
      groupSecurityAttackCampaignsByNetwork([
        campaign("203.0.113.7"),
        campaign("203.0.113.9"),
        campaign("198.51.100.4"),
      ]);

    expect(
      networks.map((network: SecurityAttackNetwork): string => {
        return network.network;
      }),
    ).toEqual(["203.0.113.0/24", "198.51.100.0/24"]);

    const range: SecurityAttackNetwork = networkNamed(
      networks,
      "203.0.113.0/24",
    );
    expect(range.kind).toBe(SecurityAttackNetworkKind.Range);
    expect(range.addressCount).toBe(2);
    expect(range.addresses).toEqual(["203.0.113.7", "203.0.113.9"]);
    expect(range.requestCount).toBe(20);
    expect(range.ranges).toEqual([
      { range: "203.0.113.0/24", addressCount: 2, requestCount: 20 },
    ]);
  });

  test("groups IPv6 addresses by their /48, one address however it is written", () => {
    const networks: Array<SecurityAttackNetwork> =
      groupSecurityAttackCampaignsByNetwork([
        campaign("2001:db8:1:2::7"),
        campaign("2001:DB8:1:3::1"),
        campaign("2001:0db8:0001:0003:0000:0000:0000:0001"),
        campaign("2001:db8:2::1"),
      ]);

    const range: SecurityAttackNetwork = networkNamed(
      networks,
      "2001:db8:1::/48",
    );
    expect(range.kind).toBe(SecurityAttackNetworkKind.Range);
    // Two spellings of 2001:db8:1:3::1 are one address.
    expect(range.addressCount).toBe(2);
    expect(range.addresses).toEqual(["2001:db8:1:2::7", "2001:db8:1:3::1"]);
    expect(range.requestCount).toBe(30);
    expect(networkNamed(networks, "2001:db8:2::/48").addressCount).toBe(1);
  });

  test("groups addresses whose events carry an ASN by the ASN, naming its ranges and its name", () => {
    const networks: Array<SecurityAttackNetwork> =
      groupSecurityAttackCampaignsByNetwork([
        campaign("203.0.113.7", { asn: "AS14061", requestCount: 5 }),
        campaign("203.0.113.8", {
          asn: "AS14061",
          asnName: "DIGITALOCEAN-ASN",
          requestCount: 7,
        }),
        campaign("198.51.100.9", { asn: "AS14061", requestCount: 3 }),
        // No ASN on its events: by its range, beside the ASN's.
        campaign("203.0.113.200", { requestCount: 2 }),
      ]);

    const asn: SecurityAttackNetwork = networkNamed(networks, "AS14061");
    expect(asn.kind).toBe(SecurityAttackNetworkKind.Asn);
    expect(asn.asnName).toBe("DIGITALOCEAN-ASN");
    expect(asn.addressCount).toBe(3);
    expect(asn.requestCount).toBe(15);
    expect(asn.ranges).toEqual([
      { range: "203.0.113.0/24", addressCount: 2, requestCount: 12 },
      { range: "198.51.100.0/24", addressCount: 1, requestCount: 3 },
    ]);

    const range: SecurityAttackNetwork = networkNamed(
      networks,
      "203.0.113.0/24",
    );
    expect(range.kind).toBe(SecurityAttackNetworkKind.Range);
    expect(range.addresses).toEqual(["203.0.113.200"]);
  });

  test("adds a network's counts up, keeps its worst outcome and severity, and its first and last sighting", () => {
    const [network] = groupSecurityAttackCampaignsByNetwork([
      campaign("203.0.113.7", {
        requestCount: 4,
        rejectedCount: 3,
        reachedAppCount: 1,
        worstOutcome: SecurityEventRequestOutcome.ReachedApp,
        maxSeverityId: 2,
        attackKinds: ["SqlInjection"],
        userAgents: ["sqlmap/1.7"],
        sampleTargets: ["/login?id=1'--"],
        targetCount: 9,
        firstSeen: "2026-11-20T09:00:00.000Z",
        lastSeen: "2026-11-20T12:00:00.000Z",
      }),
      campaign("203.0.113.8", {
        requestCount: 6,
        rejectedCount: 4,
        erroredCount: 1,
        reachedDatabaseCount: 1,
        worstOutcome: SecurityEventRequestOutcome.ReachedDatabase,
        maxSeverityId: 5,
        attackKinds: ["SqlInjection", "PathTraversal"],
        userAgents: ["sqlmap/1.7", "curl/8.4"],
        sampleTargets: ["/login?id=1'--", "/../../etc/passwd"],
        targetCount: 3,
        firstSeen: "2026-11-19T08:00:00.000Z",
        lastSeen: "2026-11-20T11:00:00.000Z",
      }),
    ]);

    expect(network!.requestCount).toBe(10);
    expect(network!.rejectedCount).toBe(7);
    expect(network!.reachedAppCount).toBe(1);
    expect(network!.erroredCount).toBe(1);
    expect(network!.reachedDatabaseCount).toBe(1);
    expect(network!.worstOutcome).toBe(
      SecurityEventRequestOutcome.ReachedDatabase,
    );
    expect(network!.maxSeverityId).toBe(5);
    expect(network!.attackKinds).toEqual(["SqlInjection", "PathTraversal"]);
    expect(network!.userAgents).toEqual(["sqlmap/1.7", "curl/8.4"]);
    expect(network!.sampleTargets).toEqual([
      "/login?id=1'--",
      "/../../etc/passwd",
    ]);
    // At least the most any one address sent: one read by address says no more.
    expect(network!.targetCount).toBe(9);
    expect(network!.firstSeen).toBe("2026-11-19T08:00:00.000Z");
    expect(network!.lastSeen).toBe("2026-11-20T12:00:00.000Z");
  });

  test("lists the worst network first: the furthest a request got, then the most requests, then the most addresses", () => {
    const networks: Array<SecurityAttackNetwork> =
      groupSecurityAttackCampaignsByNetwork([
        campaign("198.51.100.1", { requestCount: 500 }),
        campaign("192.0.2.10", {
          requestCount: 2,
          rejectedCount: 1,
          reachedDatabaseCount: 1,
          worstOutcome: SecurityEventRequestOutcome.ReachedDatabase,
        }),
        campaign("203.0.113.1", { requestCount: 30 }),
        campaign("203.0.113.2", { requestCount: 30 }),
        campaign("100.64.0.0", { requestCount: 60 }),
      ]);

    expect(
      networks.map((network: SecurityAttackNetwork): string => {
        return network.network;
      }),
    ).toEqual([
      "192.0.2.0/24",
      "198.51.100.0/24",
      // 60 requests each: two addresses before one.
      "203.0.113.0/24",
      "100.64.0.0/24",
    ]);
  });

  test("keeps the requests with no address on a row of their own, with what a scrub rule hid", () => {
    const networks: Array<SecurityAttackNetwork> =
      groupSecurityAttackCampaignsByNetwork([
        campaign("", { requestCount: 12, hiddenAddressCount: 12 }),
        campaign("203.0.113.7"),
      ]);

    const none: SecurityAttackNetwork = networkNamed(networks, "");
    expect(none.kind).toBe("");
    expect(none.addressCount).toBe(0);
    expect(none.addresses).toEqual([]);
    expect(none.ranges).toEqual([]);
    expect(none.hiddenAddressCount).toBe(12);
    expect(getSecurityAttackNetworkChallengeValues(none)).toEqual([]);
  });

  test("names at most SECURITY_ATTACK_NETWORK_ADDRESSES_KEPT addresses on a row, and counts them all", () => {
    const campaigns: Array<SecurityAttackCampaign> = [];

    for (let index: number = 1; index <= 30; index++) {
      campaigns.push(campaign(`203.0.113.${index}`));
    }

    const [network] = groupSecurityAttackCampaignsByNetwork(campaigns);

    expect(network!.addressCount).toBe(30);
    expect(network!.addresses).toHaveLength(
      SECURITY_ATTACK_NETWORK_ADDRESSES_KEPT,
    );
    expect(network!.addresses[0]).toBe("203.0.113.1");
  });

  test("an address that is no address goes on the row of no address", () => {
    const networks: Array<SecurityAttackNetwork> =
      groupSecurityAttackCampaignsByNetwork([
        campaign("not-an-address", { requestCount: 3 }),
      ]);

    expect(networks).toHaveLength(1);
    expect(networks[0]!.network).toBe("");
    expect(networks[0]!.requestCount).toBe(3);
  });
});

describe("what a network row may be challenged as", () => {
  test("a range, as itself", () => {
    expect(
      getSecurityAttackNetworkChallengeValues({
        network: "203.0.113.0/24",
        kind: SecurityAttackNetworkKind.Range,
        ranges: [
          { range: "203.0.113.0/24", addressCount: 4, requestCount: 40 },
        ],
      }),
    ).toEqual(["203.0.113.0/24"]);
  });

  test("an ASN, as itself, then each range it sent from, the most addresses first", () => {
    expect(
      getSecurityAttackNetworkChallengeValues({
        network: "AS14061",
        kind: SecurityAttackNetworkKind.Asn,
        ranges: [
          { range: "203.0.113.0/24", addressCount: 4, requestCount: 40 },
          { range: "198.51.100.0/24", addressCount: 1, requestCount: 3 },
        ],
      }),
    ).toEqual(["AS14061", "203.0.113.0/24", "198.51.100.0/24"]);
  });
});

describe("reading rows from the wire", () => {
  test("a campaign keeps its ASN as blocks write it, its ASN's name, and the block that holds it", () => {
    const read: SecurityAttackCampaign = readSecurityAttackCampaign({
      sourceIp: "203.0.113.7",
      requestCount: 3,
      asn: "14061",
      asnName: "DIGITALOCEAN-ASN",
      block: {
        value: "203.0.113.0/24",
        action: SecurityBlockAction.Challenge,
        expiresAt: "2026-11-21T10:00:00.000Z",
      },
    } as JSONObject);

    expect(read.asn).toBe("AS14061");
    expect(read.asnName).toBe("DIGITALOCEAN-ASN");
    expect(read.block).toEqual({
      value: "203.0.113.0/24",
      action: SecurityBlockAction.Challenge,
      expiresAt: "2026-11-21T10:00:00.000Z",
    });
  });

  test("a campaign with no ASN, or one that is none, has none - nor its name", () => {
    expect(
      readSecurityAttackCampaign({ sourceIp: "203.0.113.7", asn: "" }).asn,
    ).toBeUndefined();

    const read: SecurityAttackCampaign = readSecurityAttackCampaign({
      sourceIp: "203.0.113.7",
      asn: "zero",
      asnName: "Nobody",
    });
    expect(read.asn).toBeUndefined();
    expect(read.asnName).toBeUndefined();
    expect(read.block).toBeUndefined();
  });

  test("a block kept until lifted, read back, has no end", () => {
    expect(
      readSecurityAttackCampaign({
        sourceIp: "203.0.113.7",
        block: { value: "203.0.113.7", action: SecurityBlockAction.Block },
      }).block,
    ).toEqual({
      value: "203.0.113.7",
      action: SecurityBlockAction.Block,
      expiresAt: null,
    });
  });

  test("a network row round-trips", () => {
    const [network] = groupSecurityAttackCampaignsByNetwork([
      campaign("203.0.113.7", { asn: "AS14061", asnName: "DIGITALOCEAN-ASN" }),
      campaign("198.51.100.9", { asn: "AS14061" }),
    ]);

    const read: SecurityAttackNetwork = readSecurityAttackNetwork(
      JSON.parse(JSON.stringify(network)) as JSONObject,
    );

    expect(read).toEqual(network);
  });

  test("a network row of an unknown kind reads as no network kind", () => {
    expect(
      readSecurityAttackNetwork({ network: "AS1", kind: "Country" }).kind,
    ).toBe("");
  });
});

/*
 * A NETWORK ROW'S REQUESTS (#10896): what the Security Events explorer
 * reads a row's requests by - an ASN row's by the ASN its Cloudflare events
 * carry, a /24's or a /48's by globs that every address in it is written to
 * match, however the event writes it, and no address outside it.
 */
describe("a network row's requests", () => {
  // A glob as ClickHouse's ILIKE reads the explorer's: `*` any run of characters, without case.
  function matchesGlob(text: string, glob: string): boolean {
    const pattern: string = glob.split("*").map(escapeRegExp).join(".*");

    return new RegExp(`^${pattern}$`, "i").test(text);
  }

  function matchesAny(text: string, globs: Array<string>): boolean {
    return globs.some((glob: string): boolean => {
      return matchesGlob(text, glob);
    });
  }

  // An IPv6 address's groups, written in full: four digits each, no group left out.
  function writtenInFull(groups: Array<number>): string {
    return groups
      .map((group: number): string => {
        return group.toString(16).padStart(4, "0");
      })
      .join(":");
  }

  // Every way an event may write the address: shortest, in full, and in capitals.
  function spellings(groups: Array<number>): Array<string> {
    const shortest: string = NetworkAddressBlockUtil.canonicalAddress(
      groups
        .map((group: number): string => {
          return group.toString(16);
        })
        .join(":"),
    )!;

    return [
      shortest,
      writtenInFull(groups),
      shortest.toUpperCase(),
      writtenInFull(groups).toUpperCase(),
    ];
  }

  // The last five groups an address of a /48 may have: zeros in every place a run of them can take.
  const TAILS: Array<Array<number>> = [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0],
    [0, 0, 0x1a2b, 0, 0],
    [0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
    [0, 7, 0, 0, 7],
    [0x10, 0, 0, 0x200, 0],
    [0, 0, 0, 0xabc, 0xdef],
    [0x8a2e, 0x370, 0x7334, 0, 0x1],
  ];

  test("an IPv4 /24's addresses, by its three octets", () => {
    expect(getSecurityAttackRangeAddressGlobs("203.0.113.0/24")).toEqual([
      "203.0.113.*",
    ]);
    expect(getSecurityAttackRangeAddressGlobs("10.0.4.0/24")).toEqual([
      "10.0.4.*",
    ]);
    expect(getSecurityAttackRangeAddressGlobs("0.0.0.0/24")).toEqual([
      "0.0.0.*",
    ]);
    expect(getSecurityAttackRangeAddressGlobs("255.255.255.0/24")).toEqual([
      "255.255.255.*",
    ]);
  });

  test("every address of an IPv4 /24 matches, and no address of the /24s beside it", () => {
    const globs: Array<string> =
      getSecurityAttackRangeAddressGlobs("203.0.113.0/24");

    for (let last: number = 0; last <= 255; last++) {
      expect(matchesAny(`203.0.113.${last}`, globs)).toBe(true);
    }

    for (const outside of [
      "203.0.112.255",
      "203.0.114.0",
      "203.0.11.3",
      "203.0.1130.1",
      "103.0.113.7",
      "1203.0.113.7",
      "2001:db8::203.0.113.7",
    ]) {
      expect(matchesAny(outside, globs)).toBe(false);
    }
  });

  test("an IPv6 /48 with no zero group: its shortest form, and in full", () => {
    expect(getSecurityAttackRangeAddressGlobs("2001:db8:85a3::/48")).toEqual([
      "2001:db8:85a3:*",
      "2001:0db8:85a3:*",
    ]);
  });

  test("an IPv6 /48 whose groups have all four digits is one glob: in full it is written the same", () => {
    expect(getSecurityAttackRangeAddressGlobs("2a03:2880:f0ff::/48")).toEqual([
      "2a03:2880:f0ff:*",
    ]);
  });

  test("an IPv6 /48 whose third group is zero matches too the shortest form that runs its zeros together", () => {
    expect(getSecurityAttackRangeAddressGlobs("2001:db8::/48")).toEqual([
      "2001:db8:0:*",
      "2001:db8::*",
      "2001:0db8:0000:*",
    ]);
  });

  test("an IPv6 /48 whose second and third groups are zero", () => {
    expect(getSecurityAttackRangeAddressGlobs("2600::/48")).toEqual([
      "2600:0:0:*",
      "2600::*",
      "2600:0000:0000:*",
    ]);
  });

  test("a /48 written another way is read as blocks write it", () => {
    expect(
      getSecurityAttackRangeAddressGlobs("2001:0DB8:85A3:0000::/48"),
    ).toEqual(getSecurityAttackRangeAddressGlobs("2001:db8:85a3::/48"));
  });

  test.each([
    ["2001:db8:85a3::/48", [0x2001, 0xdb8, 0x85a3]],
    ["2001:db8::/48", [0x2001, 0xdb8, 0]],
    ["2600::/48", [0x2600, 0, 0]],
    ["2a03:2880:f0ff::/48", [0x2a03, 0x2880, 0xf0ff]],
    ["2001:0:1::/48", [0x2001, 0, 1]],
  ])(
    "every address of %s matches, however the event writes it, and no address outside it",
    (range: string, head: Array<number>) => {
      const globs: Array<string> = getSecurityAttackRangeAddressGlobs(range);

      for (const tail of TAILS) {
        for (const spelling of spellings([...head, ...tail])) {
          expect({ spelling, matches: matchesAny(spelling, globs) }).toEqual({
            spelling,
            matches: true,
          });
        }
      }

      // The /48s beside it, and one that shares its first groups' digits.
      const outsides: Array<Array<number>> = [
        [head[0]!, head[1]!, (head[2]! + 1) & 0xffff],
        [head[0]!, head[1]!, (head[2]! + 0xffff) & 0xffff],
        [head[0]!, (head[1]! + 1) & 0xffff, head[2]!],
        [(head[0]! + 1) & 0xffff, head[1]!, head[2]!],
        [head[0]!, head[1]!, (head[2]! << 4) & 0xffff || 0x10],
      ];

      for (const outside of outsides) {
        for (const tail of TAILS) {
          for (const spelling of spellings([...outside, ...tail])) {
            expect({
              spelling,
              matches: matchesAny(spelling, globs),
            }).toEqual({ spelling, matches: false });
          }
        }
      }
    },
  );

  test("anything that is no IPv4 /24 or IPv6 /48 has none: an address, a /16, a /25, a /64, an ASN, words", () => {
    for (const value of [
      "203.0.113.7",
      "203.0.0.0/16",
      "203.0.113.0/25",
      "2001:db8:85a3::/64",
      "2001:db8::/32",
      "2001:db8::7",
      "AS14061",
      "",
      "not a network",
    ]) {
      expect(getSecurityAttackRangeAddressGlobs(value)).toEqual([]);
    }
  });

  test("an ASN row is found by the ASN its Cloudflare events carry, as Cloudflare writes it and as a block does", () => {
    expect(
      getSecurityAttackNetworkRequestsFilter({
        network: "AS14061",
        kind: SecurityAttackNetworkKind.Asn,
      }),
    ).toEqual({ asnValues: ["14061", "AS14061"], addressGlobs: [] });
  });

  test("the ASN's attribute is the one Cloudflare's events carry it in", () => {
    expect(SECURITY_ATTACK_NETWORK_ASN_ATTRIBUTE).toBe(
      CLOUDFLARE_ATTRIBUTES.asn,
    );
  });

  test("a range row is found by its addresses' globs", () => {
    expect(
      getSecurityAttackNetworkRequestsFilter({
        network: "203.0.113.0/24",
        kind: SecurityAttackNetworkKind.Range,
      }),
    ).toEqual({ asnValues: [], addressGlobs: ["203.0.113.*"] });
    expect(
      getSecurityAttackNetworkRequestsFilter({
        network: "2001:db8::/48",
        kind: SecurityAttackNetworkKind.Range,
      }),
    ).toEqual({
      asnValues: [],
      addressGlobs: ["2001:db8:0:*", "2001:db8::*", "2001:0db8:0000:*"],
    });
  });

  test("the row of no address, and a network OneUptime cannot read, have no filter", () => {
    expect(
      getSecurityAttackNetworkRequestsFilter({ network: "", kind: "" }),
    ).toBeNull();
    expect(
      getSecurityAttackNetworkRequestsFilter({
        network: "Unknown",
        kind: SecurityAttackNetworkKind.Asn,
      }),
    ).toBeNull();
    expect(
      getSecurityAttackNetworkRequestsFilter({
        network: "203.0.113.0/25",
        kind: SecurityAttackNetworkKind.Range,
      }),
    ).toBeNull();
  });

  test("every row the grouping makes has a filter but the row of no address", () => {
    const rows: Array<SecurityAttackNetwork> =
      groupSecurityAttackCampaignsByNetwork([
        campaign("203.0.113.7", { asn: "AS14061" }),
        campaign("198.51.100.9"),
        campaign("2001:db8:85a3::7"),
        campaign(""),
      ]);

    expect(
      rows.map((row: SecurityAttackNetwork): string => {
        return `${row.network}:${getSecurityAttackNetworkRequestsFilter(row) ? "filter" : "none"}`;
      }),
    ).toEqual(
      expect.arrayContaining([
        "AS14061:filter",
        "198.51.100.0/24:filter",
        "2001:db8:85a3::/48:filter",
        ":none",
      ]),
    );
  });
});
