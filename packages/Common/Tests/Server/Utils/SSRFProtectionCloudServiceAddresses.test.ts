import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import dns from "dns";

const ALLOW_PRIVATE_NETWORKS_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const PRIVATE_NETWORK_ALLOWLIST_ENV: string =
  "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";

const OPTED_IN: { allowPrivateNetworkTargets: true } = {
  allowPrivateNetworkTargets: true,
};

const TRUSTED_PRIVATE_NETWORK_POLICY: {
  allowPrivateNetworkTargets: true;
  privateNetworkAccessIsAllowed: true;
} = {
  allowPrivateNetworkTargets: true,
  privateNetworkAccessIsAllowed: true,
};

type PrivateNetworkPolicyOptions = {
  allowPrivateNetworkTargets: true;
  privateNetworkAccessIsAllowed?: false;
};

const defaultedPrivateNetworkPolicies: Array<
  [string, PrivateNetworkPolicyOptions]
> = [
  ["absent", OPTED_IN],
  ["false", { ...OPTED_IN, privateNetworkAccessIsAllowed: false }],
];

type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

interface AddressCase {
  label: string;
  address: string;
  url: string;
}

interface BoundaryAddressCase extends AddressCase {
  strictResult: "allowed" | "blocked";
}

const forbiddenAddresses: Array<AddressCase> = [
  {
    label: "Alibaba metadata",
    address: "100.100.100.200",
    url: "http://100.100.100.200/latest/meta-data/",
  },
  {
    label: "Azure WireServer",
    address: "168.63.129.16",
    url: "http://168.63.129.16/machine/?comp=goalstate",
  },
  {
    label: "Oracle Cloud metadata",
    address: "192.0.0.192",
    url: "http://192.0.0.192/opc/v2/instance/",
  },
  {
    label: "the first AWS IPv6 service address",
    address: "fd00:ec2::",
    url: "http://[fd00:ec2::]/latest/meta-data/",
  },
  {
    label: "the last AWS fd00:ec2::/32 address",
    address: "fd00:ec2:ffff:ffff:ffff:ffff:ffff:ffff",
    url: "http://[fd00:ec2:ffff:ffff:ffff:ffff:ffff:ffff]/",
  },
  {
    label: "Google Cloud IPv6 metadata",
    address: "fd20:ce::254",
    url: "http://[fd20:ce::254]/computeMetadata/v1/",
  },
  {
    label: "the first RFC 8215 local-use translation address",
    address: "64:ff9b:1::",
    url: "http://[64:ff9b:1::]/",
  },
  {
    label: "the last RFC 8215 local-use translation address",
    address: "64:ff9b:1:ffff:ffff:ffff:ffff:ffff",
    url: "http://[64:ff9b:1:ffff:ffff:ffff:ffff:ffff]/",
  },
  {
    label: "the first legacy SIIT translation address",
    address: "0:0:0:0:ffff:0:0:0",
    url: "http://[0:0:0:0:ffff:0:0:0]/",
  },
  {
    label: "the last legacy SIIT translation address",
    address: "0:0:0:0:ffff:0:ffff:ffff",
    url: "http://[0:0:0:0:ffff:0:ffff:ffff]/",
  },
];

const boundaryAddresses: Array<BoundaryAddressCase> = [
  {
    label: "the address below Alibaba metadata",
    address: "100.100.100.199",
    url: "http://100.100.100.199/",
    strictResult: "blocked",
  },
  {
    label: "the address above Alibaba metadata",
    address: "100.100.100.201",
    url: "http://100.100.100.201/",
    strictResult: "blocked",
  },
  {
    label: "the address below Azure WireServer",
    address: "168.63.129.15",
    url: "http://168.63.129.15/",
    strictResult: "allowed",
  },
  {
    label: "the address above Azure WireServer",
    address: "168.63.129.17",
    url: "http://168.63.129.17/",
    strictResult: "allowed",
  },
  {
    label: "the address below Oracle Cloud metadata",
    address: "192.0.0.191",
    url: "http://192.0.0.191/",
    strictResult: "blocked",
  },
  {
    label: "the address above Oracle Cloud metadata",
    address: "192.0.0.193",
    url: "http://192.0.0.193/",
    strictResult: "blocked",
  },
  {
    label: "the ULA address below AWS fd00:ec2::/32",
    address: "fd00:ec1:ffff:ffff:ffff:ffff:ffff:ffff",
    url: "http://[fd00:ec1:ffff:ffff:ffff:ffff:ffff:ffff]/",
    strictResult: "blocked",
  },
  {
    label: "the ULA address above AWS fd00:ec2::/32",
    address: "fd00:ec3::",
    url: "http://[fd00:ec3::]/",
    strictResult: "blocked",
  },
  {
    label: "the ULA address below Google Cloud IPv6 metadata",
    address: "fd20:ce::253",
    url: "http://[fd20:ce::253]/",
    strictResult: "blocked",
  },
  {
    label: "the ULA address above Google Cloud IPv6 metadata",
    address: "fd20:ce::255",
    url: "http://[fd20:ce::255]/",
    strictResult: "blocked",
  },
  {
    label: "the address below the RFC 8215 /48",
    address: "64:ff9b:0:ffff:ffff:ffff:ffff:ffff",
    url: "http://[64:ff9b:0:ffff:ffff:ffff:ffff:ffff]/",
    strictResult: "allowed",
  },
  {
    label: "the address above the RFC 8215 /48",
    address: "64:ff9b:2::",
    url: "http://[64:ff9b:2::]/",
    strictResult: "allowed",
  },
  {
    label: "the address below the legacy SIIT /96",
    address: "0:0:0:0:fffe:ffff:ffff:ffff",
    url: "http://[0:0:0:0:fffe:ffff:ffff:ffff]/",
    strictResult: "allowed",
  },
  {
    label: "the address above the legacy SIIT /96",
    address: "0:0:0:0:ffff:1:0:0",
    url: "http://[0:0:0:0:ffff:1:0:0]/",
    strictResult: "allowed",
  },
];

const nonGlobalPrivateAddresses: Array<AddressCase> = [
  {
    label: "the first IETF protocol-assignment address",
    address: "192.0.0.0",
    url: "http://192.0.0.0/",
  },
  {
    label: "the last IETF protocol-assignment address",
    address: "192.0.0.255",
    url: "http://192.0.0.255/",
  },
  {
    label: "the first benchmarking address",
    address: "198.18.0.0",
    url: "http://198.18.0.0/",
  },
  {
    label: "the last benchmarking address",
    address: "198.19.255.255",
    url: "http://198.19.255.255/",
  },
  {
    label: "TEST-NET-1",
    address: "192.0.2.1",
    url: "http://192.0.2.1/",
  },
  {
    label: "TEST-NET-2",
    address: "198.51.100.1",
    url: "http://198.51.100.1/",
  },
  {
    label: "TEST-NET-3",
    address: "203.0.113.1",
    url: "http://203.0.113.1/",
  },
  {
    label: "the first deprecated IPv6 site-local address",
    address: "fec0::",
    url: "http://[fec0::]/",
  },
  {
    label: "the last deprecated IPv6 site-local address",
    address: "feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    url: "http://[feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]/",
  },
  {
    label: "the first IPv6 documentation address",
    address: "2001:db8::",
    url: "http://[2001:db8::]/",
  },
  {
    label: "the last IPv6 documentation address",
    address: "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff",
    url: "http://[2001:db8:ffff:ffff:ffff:ffff:ffff:ffff]/",
  },
];

describe("SSRFProtection — cloud service and translation addresses", () => {
  let lookupSpy: LookupSpy;
  let originalAllowPrivateNetworks: string | undefined;
  let originalPrivateNetworkAllowlist: string | undefined;

  beforeEach(() => {
    originalAllowPrivateNetworks = process.env[ALLOW_PRIVATE_NETWORKS_ENV];
    originalPrivateNetworkAllowlist =
      process.env[PRIVATE_NETWORK_ALLOWLIST_ENV];

    delete process.env[ALLOW_PRIVATE_NETWORKS_ENV];
    delete process.env[PRIVATE_NETWORK_ALLOWLIST_ENV];

    lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;
    lookupSpy.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (originalAllowPrivateNetworks === undefined) {
      delete process.env[ALLOW_PRIVATE_NETWORKS_ENV];
    } else {
      process.env[ALLOW_PRIVATE_NETWORKS_ENV] = originalAllowPrivateNetworks;
    }

    if (originalPrivateNetworkAllowlist === undefined) {
      delete process.env[PRIVATE_NETWORK_ALLOWLIST_ENV];
    } else {
      process.env[PRIVATE_NETWORK_ALLOWLIST_ENV] =
        originalPrivateNetworkAllowlist;
    }
  });

  describe("literal targets", () => {
    test.each(forbiddenAddresses)(
      "blocks $label under the strict policy",
      async ({ url }: AddressCase) => {
        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(url),
        ).rejects.toThrow(/not allowed/i);
        expect(lookupSpy).not.toHaveBeenCalled();
      },
    );

    test.each(forbiddenAddresses)(
      "blocks $label after private-network access is enabled",
      async ({ url }: AddressCase) => {
        process.env[ALLOW_PRIVATE_NETWORKS_ENV] = "true";

        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(url, OPTED_IN),
        ).rejects.toThrow(/not allowed/i);
        expect(lookupSpy).not.toHaveBeenCalled();
      },
    );

    test.each(forbiddenAddresses)(
      "blocks $label under a trusted caller's private-network policy",
      async ({ url }: AddressCase) => {
        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(
            url,
            TRUSTED_PRIVATE_NETWORK_POLICY,
          ),
        ).rejects.toThrow(/not allowed/i);
        expect(lookupSpy).not.toHaveBeenCalled();
      },
    );
  });

  describe("range boundaries", () => {
    test.each(boundaryAddresses)(
      "preserves the strict-policy verdict for $label",
      async ({ url, strictResult }: BoundaryAddressCase): Promise<void> => {
        const validation: Promise<void> =
          SSRFProtection.validateWebhookTargetIsSafe(url);

        if (strictResult === "allowed") {
          await expect(validation).resolves.toBeUndefined();
        } else {
          await expect(validation).rejects.toThrow(/private network/i);
        }
      },
    );

    test.each(boundaryAddresses)(
      "does not absorb $label into a forbidden range",
      async ({ url }: BoundaryAddressCase): Promise<void> => {
        process.env[ALLOW_PRIVATE_NETWORKS_ENV] = "true";

        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(url, OPTED_IN),
        ).resolves.toBeUndefined();
      },
    );
  });

  describe("non-global private tier", () => {
    test.each(nonGlobalPrivateAddresses)(
      "blocks $label under strict policy but permits it under trusted opt-in",
      async ({ url }: AddressCase): Promise<void> => {
        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(url),
        ).rejects.toThrow(/private network/i);

        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(
            url,
            TRUSTED_PRIVATE_NETWORK_POLICY,
          ),
        ).resolves.toBeUndefined();
      },
    );

    test.each(nonGlobalPrivateAddresses)(
      "applies the same strict/opted-in policy when DNS resolves to $label",
      async ({ address }: AddressCase): Promise<void> => {
        lookupSpy.mockResolvedValue([{ address, family: 0 }]);

        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(
            "https://non-global.example/request",
          ),
        ).rejects.toThrow(/resolves to a private network/i);

        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(
            "https://non-global.example/request",
            TRUSTED_PRIVATE_NETWORK_POLICY,
          ),
        ).resolves.toBeUndefined();
      },
    );
  });

  describe("DNS-resolved targets", () => {
    test("returns the canonical URL and the exact addresses from its validation lookup", async () => {
      lookupSpy.mockResolvedValue([
        { address: "8.8.8.8", family: 4 },
        { address: "2001:4860:4860::8888", family: 6 },
      ]);

      const target: Awaited<
        ReturnType<typeof SSRFProtection.validateAndResolveWebhookTarget>
      > = await SSRFProtection.validateAndResolveWebhookTarget(
        "HTTP://resolver.example:80/a/../health",
      );

      expect(target.url.toString()).toBe("http://resolver.example/health");
      expect(target.addresses).toEqual([
        { address: "8.8.8.8", family: 4 },
        { address: "2001:4860:4860::8888", family: 6 },
      ]);
      expect(lookupSpy).toHaveBeenCalledTimes(1);
      expect(lookupSpy).toHaveBeenCalledWith("resolver.example", { all: true });
    });

    test("still resolves an explicitly allowlisted hostname once so the socket can be pinned", async () => {
      process.env[PRIVATE_NETWORK_ALLOWLIST_ENV] = "service.internal";
      lookupSpy.mockResolvedValue([{ address: "10.20.30.40", family: 4 }]);

      const target: Awaited<
        ReturnType<typeof SSRFProtection.validateAndResolveWebhookTarget>
      > = await SSRFProtection.validateAndResolveWebhookTarget(
        "https://service.internal/health",
        OPTED_IN,
      );

      expect(target.addresses).toEqual([{ address: "10.20.30.40", family: 4 }]);
      expect(lookupSpy).toHaveBeenCalledTimes(1);
    });

    test("fails an allowlisted hostname whose pinning lookup returns no addresses", async () => {
      process.env[PRIVATE_NETWORK_ALLOWLIST_ENV] = "service.internal";
      lookupSpy.mockResolvedValue([]);

      await expect(
        SSRFProtection.validateAndResolveWebhookTarget(
          "https://service.internal/health",
          OPTED_IN,
        ),
      ).rejects.toThrow(/could not be resolved/i);
    });

    test.each(forbiddenAddresses)(
      "blocks a hostname resolving to $label under the strict policy",
      async ({ address }: AddressCase): Promise<void> => {
        lookupSpy.mockResolvedValue([{ address, family: 0 }]);

        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(
            "https://attacker.example/request",
          ),
        ).rejects.toThrow(/resolves to .*not allowed/i);
      },
    );

    test.each(forbiddenAddresses)(
      "blocks a hostname resolving to $label after private-network access is enabled",
      async ({ address }: AddressCase): Promise<void> => {
        process.env[ALLOW_PRIVATE_NETWORKS_ENV] = "true";
        lookupSpy.mockResolvedValue([{ address, family: 0 }]);

        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(
            "https://attacker.example/request",
            OPTED_IN,
          ),
        ).rejects.toThrow(/resolves to .*not allowed/i);
      },
    );

    test.each(forbiddenAddresses)(
      "blocks a hostname resolving to $label under a trusted caller's private-network policy",
      async ({ address }: AddressCase): Promise<void> => {
        lookupSpy.mockResolvedValue([{ address, family: 0 }]);

        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(
            "https://attacker.example/request",
            TRUSTED_PRIVATE_NETWORK_POLICY,
          ),
        ).rejects.toThrow(/resolves to .*not allowed/i);
      },
    );

    test.each(boundaryAddresses)(
      "keeps the opted-in DNS boundary outside the forbidden range for $label",
      async ({ address }: BoundaryAddressCase): Promise<void> => {
        process.env[ALLOW_PRIVATE_NETWORKS_ENV] = "true";
        lookupSpy.mockResolvedValue([{ address, family: 0 }]);

        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(
            "https://boundary.example/request",
            OPTED_IN,
          ),
        ).resolves.toBeUndefined();
      },
    );
  });

  describe("trusted caller private-network policy", () => {
    test("allows an ordinary private literal when both gates are true", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://10.20.30.40/health",
          TRUSTED_PRIVATE_NETWORK_POLICY,
        ),
      ).resolves.toBeUndefined();
    });

    test("allows an ordinary private DNS answer when both gates are true", async () => {
      lookupSpy.mockResolvedValue([{ address: "10.20.30.40", family: 4 }]);

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "https://service.internal/health",
          TRUSTED_PRIVATE_NETWORK_POLICY,
        ),
      ).resolves.toBeUndefined();
    });

    test("cannot grant access without the authenticated-context gate", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://10.20.30.40/health",
          { privateNetworkAccessIsAllowed: true },
        ),
      ).rejects.toThrow(/private network/i);
    });

    test.each(defaultedPrivateNetworkPolicies)(
      "preserves the default policy when the trusted override is %s",
      async (
        _label: string,
        options: PrivateNetworkPolicyOptions,
      ): Promise<void> => {
        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(
            "http://10.20.30.40/health",
            options,
          ),
        ).rejects.toThrow(/private network/i);
      },
    );

    test("explicit false is authoritative over the webhook policy", async () => {
      process.env[ALLOW_PRIVATE_NETWORKS_ENV] = "true";

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://10.20.30.40/health",
          {
            ...OPTED_IN,
            privateNetworkAccessIsAllowed: false,
          },
        ),
      ).rejects.toThrow(/private network/i);
    });

    test.each(forbiddenAddresses)(
      "ignores a webhook allowlist containing $label when trusted policy is supplied",
      async ({ address, url }: AddressCase): Promise<void> => {
        process.env[ALLOW_PRIVATE_NETWORKS_ENV] = "true";
        process.env[PRIVATE_NETWORK_ALLOWLIST_ENV] = address;

        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(
            url,
            TRUSTED_PRIVATE_NETWORK_POLICY,
          ),
        ).rejects.toThrow(/not allowed/i);
      },
    );

    test("ignores the webhook allowlist for DNS answers under trusted policy", async () => {
      process.env[PRIVATE_NETWORK_ALLOWLIST_ENV] = "100.100.100.200";
      lookupSpy.mockResolvedValue([{ address: "100.100.100.200", family: 4 }]);

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "https://attacker.example/request",
          TRUSTED_PRIVATE_NETWORK_POLICY,
        ),
      ).rejects.toThrow(/resolves to .*not allowed/i);
    });

    test("the legacy workflow path still honors its explicit allowlist", async () => {
      process.env[PRIVATE_NETWORK_ALLOWLIST_ENV] = "100.100.100.200";

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://100.100.100.200/latest/meta-data/",
          OPTED_IN,
        ),
      ).resolves.toBeUndefined();
    });
  });
});
