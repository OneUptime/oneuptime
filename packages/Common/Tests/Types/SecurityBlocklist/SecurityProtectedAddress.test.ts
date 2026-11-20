import {
  SECURITY_LOCAL_ADDRESS_RANGES,
  SECURITY_PROTECTED_ADDRESS_SENTENCES,
  SECURITY_PROTECTED_CLOUD_RESOURCE_WITHOUT_ACCOUNT,
  SECURITY_PROTECTED_OWN_ADDRESS,
  SECURITY_PROTECTED_RECORD_SOURCES,
  SecurityAddressProtection,
  SecurityProtectedAddressSource,
  SecurityProtectionOverlap,
  describeSecurityAddressProtection,
  findLocalRangeProtection,
  findProtectionAmong,
  getSecurityProtectionOverlap,
  getSecurityProtectionSentence,
  isSecurityProtectionWithheld,
} from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import { describe, expect, test } from "@jest/globals";

/*
 * The addresses no block ever touches (#10338): a range that is not on the
 * internet, and whatever protects an address, said in one sentence of what
 * it is - "203.0.113.10 is the address of host web-3." - and, when the
 * block and the protected value differ, how they meet. A record is named
 * only to whoever may read it; anyone else is told the address is the
 * project's own.
 */

function block(text: string): NetworkAddressBlock {
  const parsed: NetworkAddressBlock | null =
    NetworkAddressBlockUtil.parse(text);

  if (!parsed) {
    throw new Error(`${text} did not parse`);
  }

  return parsed;
}

function localRangeOf(text: string): string | null {
  return findLocalRangeProtection(block(text))?.protectedValue || null;
}

describe("findLocalRangeProtection", () => {
  test("an IPv4 address that is not on the internet is protected by its range", () => {
    expect(localRangeOf("10.0.4.12")).toBe("10.0.0.0/8");
    expect(localRangeOf("172.16.0.9")).toBe("172.16.0.0/12");
    expect(localRangeOf("172.31.255.255")).toBe("172.16.0.0/12");
    expect(localRangeOf("192.168.1.20")).toBe("192.168.0.0/16");
    expect(localRangeOf("100.64.3.4")).toBe("100.64.0.0/10");
    expect(localRangeOf("127.0.0.1")).toBe("127.0.0.0/8");
    expect(localRangeOf("169.254.169.254")).toBe("169.254.0.0/16");
    expect(localRangeOf("224.0.0.251")).toBe("224.0.0.0/4");
    expect(localRangeOf("255.255.255.255")).toBe("240.0.0.0/4");
    expect(localRangeOf("0.0.0.0")).toBe("0.0.0.0/8");
  });

  test("a range is protected when any of it is not on the internet", () => {
    expect(localRangeOf("10.0.4.0/24")).toBe("10.0.0.0/8");
    // A /8 that holds a private range overlaps it.
    expect(localRangeOf("172.0.0.0/8")).toBe("172.16.0.0/12");
    expect(localRangeOf("192.0.0.0/8")).toBe("192.168.0.0/16");
  });

  test("an address or range on the internet is not", () => {
    expect(localRangeOf("35.205.11.131")).toBeNull();
    expect(localRangeOf("35.205.11.0/24")).toBeNull();
    expect(localRangeOf("172.32.0.1")).toBeNull();
    expect(localRangeOf("100.128.0.1")).toBeNull();
    expect(localRangeOf("11.0.0.0/8")).toBeNull();
  });

  test("IPv6's loopback, link-local, unique local and multicast are protected", () => {
    expect(localRangeOf("::1")).toBe("::1");
    expect(localRangeOf("fe80::1")).toBe("fe80::/10");
    expect(localRangeOf("fc00::1")).toBe("fc00::/7");
    expect(localRangeOf("fd12::/16")).toBe("fc00::/7");
    expect(localRangeOf("ff02::1")).toBe("ff00::/8");
    expect(localRangeOf("::")).toBe("::");
  });

  test("a public IPv6 address or range is not", () => {
    expect(localRangeOf("2001:db8::1")).toBeNull();
    expect(localRangeOf("2606:4700::/32")).toBeNull();
  });

  test("every range it reads is a range", () => {
    for (const range of SECURITY_LOCAL_ADDRESS_RANGES) {
      expect(NetworkAddressBlockUtil.parse(range)).not.toBeNull();
    }
  });
});

describe("getSecurityProtectionOverlap", () => {
  test("says how the block meets what protects it", () => {
    expect(
      getSecurityProtectionOverlap({
        value: block("35.205.11.131"),
        protectedBlock: block("35.205.11.131"),
      }),
    ).toBe(SecurityProtectionOverlap.Same);
    expect(
      getSecurityProtectionOverlap({
        value: block("35.205.11.0/24"),
        protectedBlock: block("35.205.11.131"),
      }),
    ).toBe(SecurityProtectionOverlap.BlockHoldsProtected);
    expect(
      getSecurityProtectionOverlap({
        value: block("10.0.4.12"),
        protectedBlock: block("10.0.0.0/8"),
      }),
    ).toBe(SecurityProtectionOverlap.BlockInsideProtected);
    expect(
      getSecurityProtectionOverlap({
        value: block("2001:db8::/48"),
        protectedBlock: block("2001:db8::/48"),
      }),
    ).toBe(SecurityProtectionOverlap.Same);
  });
});

describe("describeSecurityAddressProtection", () => {
  const host: SecurityAddressProtection = {
    source: SecurityProtectedAddressSource.Host,
    protectedValue: "35.205.11.131",
    name: "web-3",
    recordId: "11111111-1111-4111-8111-111111111111",
  };

  test("the same address: one sentence of what it is", () => {
    expect(
      describeSecurityAddressProtection({
        value: "35.205.11.131",
        protection: host,
      }),
    ).toBe("35.205.11.131 is the address of host web-3.");
  });

  test("a range that holds it says so first", () => {
    expect(
      describeSecurityAddressProtection({
        value: "35.205.11.0/24",
        protection: host,
      }),
    ).toBe(
      "35.205.11.0/24 holds 35.205.11.131. 35.205.11.131 is the address of host web-3.",
    );
  });

  test("an address inside a protected range says so first", () => {
    expect(
      describeSecurityAddressProtection({
        value: "10.0.4.12",
        protection: {
          source: SecurityProtectedAddressSource.LocalRange,
          protectedValue: "10.0.0.0/8",
        },
      }),
    ).toBe(
      "10.0.4.12 is inside 10.0.0.0/8. 10.0.0.0/8 is not on the internet: it is a private, loopback, link-local or reserved range, which no edge needs to block.",
    );
  });

  test("a cloud resource is named by its kind and its account, and without an account when there is none", () => {
    const balancer: SecurityAddressProtection = {
      source: SecurityProtectedAddressSource.CloudResource,
      protectedValue: "203.0.113.10",
      name: "prod-alb",
      kind: "Application Load Balancer",
      where: "Production",
    };

    expect(
      describeSecurityAddressProtection({
        value: "203.0.113.10",
        protection: balancer,
      }),
    ).toBe(
      "203.0.113.10 is the address of Application Load Balancer prod-alb in Production.",
    );
    expect(
      describeSecurityAddressProtection({
        value: "203.0.113.10",
        protection: { ...balancer, where: undefined },
      }),
    ).toBe(
      "203.0.113.10 is the address of Application Load Balancer prod-alb.",
    );
    expect(
      getSecurityProtectionSentence({ ...balancer, where: undefined }),
    ).toBe(SECURITY_PROTECTED_CLOUD_RESOURCE_WITHOUT_ACCOUNT);
  });

  test("a record the reader may not read is said to be the project's own, never named", () => {
    const withheld: SecurityAddressProtection = {
      source: SecurityProtectedAddressSource.Host,
      protectedValue: "35.205.11.131",
    };

    expect(isSecurityProtectionWithheld(withheld)).toBe(true);
    expect(getSecurityProtectionSentence(withheld)).toBe(
      SECURITY_PROTECTED_OWN_ADDRESS,
    );
    expect(
      describeSecurityAddressProtection({
        value: "35.205.11.131",
        protection: withheld,
      }),
    ).toBe("35.205.11.131 is one of your project's own addresses.");
    expect(
      describeSecurityAddressProtection({
        value: "35.205.11.0/24",
        protection: withheld,
      }),
    ).toBe(
      "35.205.11.0/24 holds 35.205.11.131. 35.205.11.131 is one of your project's own addresses.",
    );
  });

  test("a source that names no record is never withheld", () => {
    for (const source of [
      SecurityProtectedAddressSource.LocalRange,
      SecurityProtectedAddressSource.OneUptimeCloud,
      SecurityProtectedAddressSource.Edge,
      SecurityProtectedAddressSource.GlobalProbe,
    ]) {
      expect(SECURITY_PROTECTED_RECORD_SOURCES).not.toContain(source);
      expect(
        isSecurityProtectionWithheld({ source, protectedValue: "1.2.3.4" }),
      ).toBe(false);
    }
  });

  test("the edge in front of the app and OneUptime Cloud's probes say why they matter", () => {
    expect(
      describeSecurityAddressProtection({
        value: "104.16.0.1",
        protection: {
          source: SecurityProtectedAddressSource.Edge,
          protectedValue: "104.16.0.0/13",
          name: "Cloudflare",
        },
      }),
    ).toBe(
      "104.16.0.1 is inside 104.16.0.0/13. 104.16.0.0/13 is one of Cloudflare's addresses, and Cloudflare is in front of your app: blocking it would take your site down.",
    );
    expect(
      describeSecurityAddressProtection({
        value: "198.51.100.20",
        protection: {
          source: SecurityProtectedAddressSource.OneUptimeCloud,
          protectedValue: "198.51.100.20",
          name: "OneUptime Cloud",
        },
      }),
    ).toBe("198.51.100.20 is one of OneUptime Cloud's probe addresses.");
  });

  test("a value that is no address is said with the sentence alone", () => {
    expect(
      describeSecurityAddressProtection({
        value: "not an address",
        protection: host,
      }),
    ).toBe("35.205.11.131 is the address of host web-3.");
  });
});

describe("findProtectionAmong", () => {
  const protections: Array<SecurityAddressProtection> = [
    {
      source: SecurityProtectedAddressSource.ProtectedEntity,
      protectedValue: "not a range",
      name: "Broken entry",
    },
    {
      source: SecurityProtectedAddressSource.ProtectedEntity,
      protectedValue: "203.0.113.0/24",
      name: "Office",
    },
    {
      source: SecurityProtectedAddressSource.Host,
      protectedValue: "203.0.113.10",
      name: "web-3",
    },
  ];

  test("the first protection that overlaps, in the list's order, its value as kept", () => {
    expect(
      findProtectionAmong({ block: block("203.0.113.10"), protections }),
    ).toEqual({
      source: SecurityProtectedAddressSource.ProtectedEntity,
      protectedValue: "203.0.113.0/24",
      name: "Office",
    });
    expect(
      findProtectionAmong({
        block: block("203.0.113.10"),
        protections: [
          {
            source: SecurityProtectedAddressSource.OneUptimeCloud,
            protectedValue: " 203.0.113.10/32 ",
          },
        ],
      }),
    ).toEqual({
      source: SecurityProtectedAddressSource.OneUptimeCloud,
      protectedValue: "203.0.113.10",
    });
  });

  test("a range that holds a protected address is protected by it", () => {
    expect(
      findProtectionAmong({
        block: block("203.0.112.0/23"),
        protections: protections.slice(2),
      })?.name,
    ).toBe("web-3");
  });

  test("none when nothing overlaps, and never across families", () => {
    expect(
      findProtectionAmong({ block: block("198.51.100.4"), protections }),
    ).toBeNull();
    expect(
      findProtectionAmong({ block: block("2001:db8::1"), protections }),
    ).toBeNull();
    expect(
      findProtectionAmong({ block: block("198.51.100.4"), protections: [] }),
    ).toBeNull();
  });
});

describe("SECURITY_PROTECTED_ADDRESS_SENTENCES", () => {
  test("has one sentence for every source, about the protected address", () => {
    for (const source of Object.values(SecurityProtectedAddressSource)) {
      const sentence: string | undefined =
        SECURITY_PROTECTED_ADDRESS_SENTENCES[source];

      expect(sentence).toBeTruthy();
      expect(sentence!.startsWith("{{address}} ")).toBe(true);
      expect(sentence!.endsWith(".")).toBe(true);
    }
  });
});
