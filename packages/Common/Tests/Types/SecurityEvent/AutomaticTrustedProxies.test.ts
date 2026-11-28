import { describe, expect, test } from "@jest/globals";
import {
  PRIVATE_PROXY_RANGES,
  AUTOMATIC_TRUSTED_PROXIES_PATH,
  AutomaticTrustedProxies,
  NO_AUTOMATIC_TRUSTED_PROXIES,
  automaticTrustedProxiesToJSON,
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
        areLoadBalancersRead: false,
        areLoadBalancersComplete: true,
      });
    }
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

describe("the ranges every project trusts", () => {
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
