import { describe, expect, test } from "@jest/globals";
import {
  PRIVATE_PROXY_RANGES,
  AUTOMATIC_TRUSTED_PROXIES_PATH,
  AutomaticTrustedProxies,
  NO_AUTOMATIC_TRUSTED_PROXIES,
  automaticTrustedProxiesToJSON,
  findListedPassOnOverlaps,
  readAutomaticTrustedProxies,
} from "../../../Types/SecurityEvent/AutomaticTrustedProxies";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  NO_TRUSTED_PROXIES,
  isTrustedProxy,
} from "../../../Utils/SecurityEvent/ClientAddressTrust";
import { OwnLoadBalancerKind } from "../../../Utils/SecurityEvent/OwnLoadBalancers";
import {
  PassOnLoadBalancerKind,
  PassOnReason,
} from "../../../Utils/SecurityEvent/PassOnLoadBalancers";

/*
 * #10546: WHAT TRUSTED PROXIES SHOWS AS TRUSTED WITHOUT BEING TOLD, as the
 * server writes it and the page reads it. The ranges every project trusts
 * are listed for a person to read; the trust itself is by an address's
 * scope (ClientAddressTrust.isTrustedProxy), so the list must say exactly
 * what that trusts.
 */

const ANSWER: AutomaticTrustedProxies = {
  edges: [{ name: "Cloudflare", rangeCount: 22 }],
  loadBalancers: [
    {
      kind: OwnLoadBalancerKind.GoogleCloudApplicationLoadBalancer,
      name: "web-https",
      where: "Google Cloud shop",
      addresses: ["34.120.1.2"],
    },
    {
      kind: OwnLoadBalancerKind.AwsApplicationLoadBalancer,
      name: "web",
      where: "",
      addresses: ["52.1.2.3", "2600:1f18:4000::7"],
    },
  ],
  googleFrontEnds: {
    ranges: ["35.191.0.0/16", "130.211.0.0/22", "2600:2d00:1:1::/64"],
    broughtBy: [{ name: "web-https", where: "Google Cloud shop" }],
    withheldBy: [],
    isWithheldForIncompleteRead: false,
    isTrusted: true,
  },
  // #11389: what passes on the X-Forwarded-For a client wrote, each with why.
  passOnLoadBalancers: [
    {
      kind: PassOnLoadBalancerKind.AwsNetworkLoadBalancer,
      name: "tcp-ingress",
      where: "Production AWS",
      reasons: [PassOnReason.ClientIpNotPreserved, PassOnReason.Dualstack],
      targetGroups: ["ingress-ip", "ingress-ip-v6"],
      ranges: ["10.0.1.0/24", "10.0.2.0/24"],
      areRangesIncomplete: false,
    },
    {
      kind: PassOnLoadBalancerKind.GoogleCloudProxyNetworkLoadBalancer,
      name: "db-proxy",
      where: "Google Cloud shop",
      reasons: [PassOnReason.ProxyOnlySubnet],
      targetGroups: [],
      ranges: ["10.129.0.0/23"],
      areRangesIncomplete: false,
    },
    {
      kind: PassOnLoadBalancerKind.AwsClassicLoadBalancer,
      name: "legacy-tcp",
      where: "",
      reasons: [PassOnReason.TcpListener],
      targetGroups: [],
      ranges: [],
      areRangesIncomplete: true,
    },
  ],
  areLoadBalancersRead: true,
  areLoadBalancersComplete: false,
};

describe("the answer", () => {
  test("is at its path", () => {
    expect(AUTOMATIC_TRUSTED_PROXIES_PATH).toBe(
      "/security-trusted-proxies/automatic",
    );
  });

  test("reads back as it was written", () => {
    expect(
      readAutomaticTrustedProxies(automaticTrustedProxiesToJSON(ANSWER)),
    ).toEqual(ANSWER);
    expect(
      readAutomaticTrustedProxies(
        automaticTrustedProxiesToJSON(NO_AUTOMATIC_TRUSTED_PROXIES),
      ),
    ).toEqual(NO_AUTOMATIC_TRUSTED_PROXIES);
  });

  test("an entry it cannot read is left out, never guessed at", () => {
    expect(
      readAutomaticTrustedProxies({
        edges: [
          { name: "Cloudflare", rangeCount: -1 },
          { name: "" },
          "Fastly",
          null,
        ],
        loadBalancers: [
          { kind: "host", name: "app-1", addresses: ["198.51.100.20"] },
          {
            kind: OwnLoadBalancerKind.AzureApplicationGateway,
            name: "no-address",
            addresses: [],
          },
          {
            kind: OwnLoadBalancerKind.AzureApplicationGateway,
            name: "web-agw",
            addresses: ["20.50.1.7", 7, ""],
          },
        ],
        areLoadBalancersRead: true,
      }),
    ).toEqual({
      edges: [{ name: "Cloudflare", rangeCount: 0 }],
      loadBalancers: [
        {
          kind: OwnLoadBalancerKind.AzureApplicationGateway,
          name: "web-agw",
          where: "",
          addresses: ["20.50.1.7"],
        },
      ],
      googleFrontEnds: null,
      passOnLoadBalancers: [],
      areLoadBalancersRead: true,
      areLoadBalancersComplete: true,
    });
  });

  test("an answer that does not say its load balancers were read says they were not", () => {
    for (const value of [undefined, null, "nothing", [], {}]) {
      expect(readAutomaticTrustedProxies(value as never)).toEqual({
        edges: [],
        loadBalancers: [],
        googleFrontEnds: null,
        passOnLoadBalancers: [],
        areLoadBalancersRead: false,
        areLoadBalancersComplete: true,
      });
    }
  });
});

// #11389: the load balancers that pass on what a client wrote, as the page reads them.
describe("the load balancers that pass on what a client wrote, in the answer", () => {
  function readPassOn(value: unknown): AutomaticTrustedProxies {
    return readAutomaticTrustedProxies({
      areLoadBalancersRead: true,
      passOnLoadBalancers: value,
    } as never);
  }

  const ONE: Record<string, unknown> = {
    kind: PassOnLoadBalancerKind.AwsNetworkLoadBalancer,
    name: "tcp-ingress",
    where: "Production AWS",
    reasons: [PassOnReason.ClientIpNotPreserved],
    targetGroups: ["ingress-ip"],
    ranges: ["10.0.1.0/24"],
    areRangesIncomplete: false,
  };

  test("one of a kind or with only reasons the page does not know is left out", () => {
    expect(
      readPassOn([
        { ...ONE, kind: "haproxy" },
        { ...ONE, reasons: ["because"] },
        { ...ONE, reasons: [] },
        "tcp-ingress",
        null,
        ONE,
      ]).passOnLoadBalancers,
    ).toEqual([
      {
        kind: PassOnLoadBalancerKind.AwsNetworkLoadBalancer,
        name: "tcp-ingress",
        where: "Production AWS",
        reasons: [PassOnReason.ClientIpNotPreserved],
        targetGroups: ["ingress-ip"],
        ranges: ["10.0.1.0/24"],
        areRangesIncomplete: false,
      },
    ]);
  });

  test("the reasons and target groups it can read are kept, the rest dropped", () => {
    expect(
      readPassOn([
        {
          ...ONE,
          reasons: [
            PassOnReason.Dualstack,
            "because",
            7,
            PassOnReason.ClientIpUnknown,
          ],
          targetGroups: ["ingress-ip", "", 3, null],
        },
      ]).passOnLoadBalancers[0],
    ).toEqual(
      expect.objectContaining({
        reasons: [PassOnReason.Dualstack, PassOnReason.ClientIpUnknown],
        targetGroups: ["ingress-ip"],
      }),
    );
  });

  test("one whose ranges were not said says they could not be read", () => {
    for (const ranges of [[], undefined, null, "10.0.1.0/24", ["", 7]]) {
      expect(
        readPassOn([{ ...ONE, ranges, areRangesIncomplete: false }])
          .passOnLoadBalancers[0],
      ).toEqual(
        expect.objectContaining({ ranges: [], areRangesIncomplete: true }),
      );
    }

    expect(
      readPassOn([{ ...ONE, areRangesIncomplete: "yes" }]).passOnLoadBalancers[0]
        ?.areRangesIncomplete,
    ).toBe(false);
    expect(
      readPassOn([{ ...ONE, areRangesIncomplete: true }]).passOnLoadBalancers[0]
        ?.areRangesIncomplete,
    ).toBe(true);
  });

  test("an answer of before them says none", () => {
    expect(
      readAutomaticTrustedProxies({ areLoadBalancersRead: true } as never)
        .passOnLoadBalancers,
    ).toEqual([]);
  });
});

/*
 * #11388, #11389: a range of Trusted Proxies that holds where such a load
 * balancer connects from - Google's front ends, as the old docs said to
 * list, or an AWS Network Load Balancer's subnet - is said under the list.
 */
describe("a listed range that holds where one connects from", () => {
  function listed(...ranges: Array<string>): Array<NetworkAddressBlock> {
    return ranges.map((range: string): NetworkAddressBlock => {
      return NetworkAddressBlockUtil.parse(range)!;
    });
  }

  const GOOGLE_FRONT_END_PASS_ON: AutomaticTrustedProxies["passOnLoadBalancers"][0] =
    {
      kind: PassOnLoadBalancerKind.GoogleCloudProxyNetworkLoadBalancer,
      name: "db-tcp",
      where: "Google Cloud shop",
      reasons: [PassOnReason.GoogleFrontEnds],
      targetGroups: [],
      ranges: ["35.191.0.0/16", "130.211.0.0/22", "2600:2d00:1:1::/64"],
      areRangesIncomplete: false,
    };

  test("the old docs' Google front ends, while a TCP or SSL proxy load balancer connects from them", () => {
    expect(
      findListedPassOnOverlaps({
        listed: listed("35.191.0.0/16", "130.211.0.0/22", "203.0.113.0/24"),
        passOnLoadBalancers: [GOOGLE_FRONT_END_PASS_ON],
      }),
    ).toEqual([
      { range: "35.191.0.0/16", loadBalancer: "db-tcp", isGoogleFrontEnds: true },
      {
        range: "130.211.0.0/22",
        loadBalancer: "db-tcp",
        isGoogleFrontEnds: true,
      },
    ]);
  });

  test("a range wider or narrower than a load balancer's subnet, and one address in it, each hold it", () => {
    const passOn: AutomaticTrustedProxies["passOnLoadBalancers"] = [
      ANSWER.passOnLoadBalancers[0]!,
    ];

    expect(
      findListedPassOnOverlaps({
        listed: listed(
          "10.0.0.0/8",
          "10.0.1.128/25",
          "10.0.2.7",
          "10.0.3.0/24",
          "192.168.0.0/16",
        ),
        passOnLoadBalancers: passOn,
      }).map((overlap: { range: string }): string => {
        return overlap.range;
      }),
    ).toEqual(["10.0.0.0/8", "10.0.1.128/25", "10.0.2.7"]);
  });

  test("once a range and load balancer, however many of its ranges the range holds, in the list's order", () => {
    expect(
      findListedPassOnOverlaps({
        listed: listed("10.0.0.0/8"),
        passOnLoadBalancers: ANSWER.passOnLoadBalancers,
      }),
    ).toEqual([
      {
        range: "10.0.0.0/8",
        loadBalancer: "tcp-ingress",
        isGoogleFrontEnds: false,
      },
      {
        range: "10.0.0.0/8",
        loadBalancer: "db-proxy",
        isGoogleFrontEnds: false,
      },
    ]);
  });

  test("nothing is said of a list that holds none of them, an empty list, or one with none to hold", () => {
    expect(
      findListedPassOnOverlaps({
        listed: listed("203.0.113.0/24", "2001:db8::/48"),
        passOnLoadBalancers: ANSWER.passOnLoadBalancers,
      }),
    ).toEqual([]);
    expect(
      findListedPassOnOverlaps({
        listed: [],
        passOnLoadBalancers: ANSWER.passOnLoadBalancers,
      }),
    ).toEqual([]);
    expect(
      findListedPassOnOverlaps({
        listed: listed("10.0.0.0/8"),
        passOnLoadBalancers: [],
      }),
    ).toEqual([]);
  });

  test("a load balancer whose ranges could not be read holds nothing: there is nothing to say of it", () => {
    expect(
      findListedPassOnOverlaps({
        listed: listed("10.0.0.0/8", "0.0.0.0/1"),
        passOnLoadBalancers: [ANSWER.passOnLoadBalancers[2]!],
      }),
    ).toEqual([]);
  });
});

// #11047: Google's front ends, with the load balancers that bring them and what keeps them untrusted.
describe("Google's front ends in the answer", () => {
  const BROUGHT: Record<string, unknown> = {
    ranges: ["35.191.0.0/16", "130.211.0.0/22"],
    broughtBy: [{ name: "shop-https", where: "Google Cloud shop" }],
    withheldBy: [],
    isWithheldForIncompleteRead: false,
    isTrusted: true,
  };

  test("are none when no load balancer brings them, or no range is said", () => {
    for (const googleFrontEnds of [
      undefined,
      null,
      "35.191.0.0/16",
      { ...BROUGHT, broughtBy: [] },
      { ...BROUGHT, ranges: [] },
      { ...BROUGHT, ranges: ["", 7] },
    ]) {
      expect(
        readAutomaticTrustedProxies({
          areLoadBalancersRead: true,
          googleFrontEnds,
        } as never).googleFrontEnds,
      ).toBeNull();
    }
  });

  test("are trusted only when the answer says so, and never while anything withholds them", () => {
    const read: (value: Record<string, unknown>) => boolean | undefined = (
      value: Record<string, unknown>,
    ): boolean | undefined => {
      return readAutomaticTrustedProxies({
        areLoadBalancersRead: true,
        googleFrontEnds: value,
      } as never).googleFrontEnds?.isTrusted;
    };

    expect(read(BROUGHT)).toBe(true);
    expect(read({ ...BROUGHT, isTrusted: "yes" })).toBe(false);
    expect(read({ ...BROUGHT, isTrusted: undefined })).toBe(false);
    expect(read({ ...BROUGHT, withheldBy: [{ name: "db", where: "" }] })).toBe(
      false,
    );
    expect(read({ ...BROUGHT, isWithheldForIncompleteRead: true })).toBe(false);
  });

  test("name the load balancers that withhold them, as written", () => {
    expect(
      readAutomaticTrustedProxies({
        areLoadBalancersRead: true,
        googleFrontEnds: {
          ...BROUGHT,
          isTrusted: false,
          withheldBy: [
            { name: "db", where: "Google Cloud shop" },
            "mail",
            null,
          ],
        },
      } as never).googleFrontEnds?.withheldBy,
    ).toEqual([{ name: "db", where: "Google Cloud shop" }]);
  });
});

/*
 * #11389: the ranges a project trusts while Private Addresses is on - every
 * project from before the switch, until it turns it off. Off, none of them
 * is trusted unlisted.
 */
describe("the private ranges", () => {
  test("with Private Addresses off, none of them is trusted unlisted, at either end", () => {
    for (const range of PRIVATE_PROXY_RANGES) {
      const block: NetworkAddressBlock = NetworkAddressBlockUtil.parse(range)!;

      for (const address of [
        block.text.split("/")[0]!,
        "10.255.255.255",
        "172.31.255.254",
        "192.168.255.254",
        "100.127.255.254",
        "127.0.0.1",
        "169.254.169.254",
        "fdff:ffff::1",
        "fe80::1",
        "::1",
      ]) {
        expect(
          isTrustedProxy(address, { blocks: [], trustsPrivateAddresses: false }),
        ).toBe(false);
      }
    }
  });

  test("with it off, one is trusted when the project lists it", () => {
    expect(
      isTrustedProxy("10.0.0.5", {
        blocks: [NetworkAddressBlockUtil.parse("10.0.0.0/24")!],
        trustsPrivateAddresses: false,
      }),
    ).toBe(true);
    expect(
      isTrustedProxy("10.0.1.5", {
        blocks: [NetworkAddressBlockUtil.parse("10.0.0.0/24")!],
        trustsPrivateAddresses: false,
      }),
    ).toBe(false);
  });

  test("each is a range, and every address at either end of it is trusted with nothing listed", () => {
    for (const range of PRIVATE_PROXY_RANGES) {
      const block: NetworkAddressBlock | null =
        NetworkAddressBlockUtil.parse(range);

      expect(block).not.toBeNull();
    }

    for (const address of [
      "10.0.0.0",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.0.1",
      "192.168.255.254",
      "100.64.0.1",
      "100.127.255.254",
      "127.0.0.1",
      "169.254.169.254",
      "fc00::1",
      "fdff:ffff::1",
      "fe80::1",
      "::1",
    ]) {
      expect(isTrustedProxy(address, NO_TRUSTED_PROXIES)).toBe(true);
      expect(
        PRIVATE_PROXY_RANGES.some((range: string): boolean => {
          return NetworkAddressBlockUtil.contains(
            NetworkAddressBlockUtil.parse(range)!,
            address,
          );
        }),
      ).toBe(true);
    }
  });

  test("their public neighbours are not trusted unless a project lists them", () => {
    for (const address of [
      "9.255.255.255",
      "11.0.0.0",
      "172.15.255.255",
      "172.32.0.0",
      "192.167.255.255",
      "192.169.0.0",
      "100.63.255.255",
      "100.128.0.0",
      "169.253.255.255",
      "203.0.113.7",
      "2001:db8::7",
      "fbff::1",
      "fe00::1",
    ]) {
      expect(isTrustedProxy(address, NO_TRUSTED_PROXIES)).toBe(false);
      expect(
        PRIVATE_PROXY_RANGES.some((range: string): boolean => {
          return NetworkAddressBlockUtil.contains(
            NetworkAddressBlockUtil.parse(range)!,
            address,
          );
        }),
      ).toBe(false);
    }
  });
});
