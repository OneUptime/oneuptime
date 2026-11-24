import { describe, expect, test } from "@jest/globals";
import {
  ALWAYS_TRUSTED_PROXY_RANGES,
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
      areLoadBalancersRead: true,
      areLoadBalancersComplete: true,
    });
  });

  test("an answer that does not say its load balancers were read says they were not", () => {
    for (const value of [undefined, null, "nothing", [], {}]) {
      expect(readAutomaticTrustedProxies(value as never)).toEqual({
        edges: [],
        loadBalancers: [],
        areLoadBalancersRead: false,
        areLoadBalancersComplete: true,
      });
    }
  });
});

describe("the ranges every project trusts", () => {
  test("each is a range, and every address at either end of it is trusted with nothing listed", () => {
    for (const range of ALWAYS_TRUSTED_PROXY_RANGES) {
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
        ALWAYS_TRUSTED_PROXY_RANGES.some((range: string): boolean => {
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
        ALWAYS_TRUSTED_PROXY_RANGES.some((range: string): boolean => {
          return NetworkAddressBlockUtil.contains(
            NetworkAddressBlockUtil.parse(range)!,
            address,
          );
        }),
      ).toBe(false);
    }
  });
});
