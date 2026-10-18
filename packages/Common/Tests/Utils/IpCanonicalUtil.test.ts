import { describe, expect, test } from "@jest/globals";
import IpCanonicalUtil from "../../Utils/IpCanonicalUtil";

/*
 * Trap/syslog correlation compares datagram source addresses (Node's
 * normalized lowercase-compressed form) against user-typed device
 * hostnames. These pin the RFC 5952 canonicalization that makes every
 * spelling of the same IPv6 address compare equal — without it, an
 * IPv6-registered device silently never matches its own traps.
 */

describe("IpCanonicalUtil.canonicalize", () => {
  test("IPv4 passes through", () => {
    expect(IpCanonicalUtil.canonicalize("192.168.1.10")).toBe("192.168.1.10");
    expect(IpCanonicalUtil.canonicalize("  10.0.0.1  ")).toBe("10.0.0.1");
  });

  test("non-IP input is returned unchanged", () => {
    expect(IpCanonicalUtil.canonicalize("switch-01.example.com")).toBe(
      "switch-01.example.com",
    );
    expect(IpCanonicalUtil.canonicalize("")).toBe("");
  });

  test("uppercase IPv6 lowers", () => {
    expect(IpCanonicalUtil.canonicalize("2001:DB8::1")).toBe("2001:db8::1");
  });

  test("fully expanded IPv6 compresses per RFC 5952", () => {
    expect(IpCanonicalUtil.canonicalize("2001:db8:0:0:0:0:0:1")).toBe(
      "2001:db8::1",
    );
  });

  test("leading zeros are stripped", () => {
    expect(IpCanonicalUtil.canonicalize("2001:0db8::0001")).toBe("2001:db8::1");
  });

  test("longest zero run wins; leftmost on ties", () => {
    expect(IpCanonicalUtil.canonicalize("2001:0:0:1:0:0:0:1")).toBe(
      "2001:0:0:1::1",
    );
    expect(IpCanonicalUtil.canonicalize("2001:db8:0:0:1:0:0:1")).toBe(
      "2001:db8::1:0:0:1",
    );
  });

  test("a single zero group is not compressed", () => {
    expect(IpCanonicalUtil.canonicalize("2001:db8:0:1:1:1:1:1")).toBe(
      "2001:db8:0:1:1:1:1:1",
    );
  });

  test("all-zeros and loopback", () => {
    expect(IpCanonicalUtil.canonicalize("0:0:0:0:0:0:0:0")).toBe("::");
    expect(IpCanonicalUtil.canonicalize("0:0:0:0:0:0:0:1")).toBe("::1");
    expect(IpCanonicalUtil.canonicalize("::1")).toBe("::1");
  });

  test("IPv4-mapped tails fold into hex groups", () => {
    expect(IpCanonicalUtil.canonicalize("::ffff:192.168.1.1")).toBe(
      IpCanonicalUtil.canonicalize("::ffff:c0a8:101"),
    );
  });
});

describe("IpCanonicalUtil.areSameIpAddress", () => {
  test("matches different spellings of one IPv6 address", () => {
    expect(
      IpCanonicalUtil.areSameIpAddress("2001:DB8::1", "2001:db8:0:0:0:0:0:1"),
    ).toBe(true);
  });

  test("distinct addresses do not match", () => {
    expect(IpCanonicalUtil.areSameIpAddress("2001:db8::1", "2001:db8::2")).toBe(
      false,
    );
  });

  test("DNS names never match as IPs", () => {
    expect(
      IpCanonicalUtil.areSameIpAddress("switch.example.com", "2001:db8::1"),
    ).toBe(false);
  });
});

/*
 * The /64 an IPv6 address is in: what a rate limit counts together, beside
 * each address (Server/Utils/ClientIp getRateLimitClient), since one host
 * is commonly given a whole /64. Every spelling of an address in it names
 * the same /64, and nothing that is not an IPv6 address has one.
 */
describe("IpCanonicalUtil.getIpv6Network64", () => {
  test("an address's /64 is its first four groups", () => {
    expect(IpCanonicalUtil.getIpv6Network64("2001:db8:1:2:3:4:5:6")).toBe(
      "2001:db8:1:2::/64",
    );
  });

  test("every address of one /64 names the same /64", () => {
    const addresses: Array<string> = [
      "2001:db8:1:2::1",
      "2001:db8:1:2::ffff",
      "2001:db8:1:2:ffff:ffff:ffff:ffff",
      "2001:db8:1:2:a:b:c:d",
      "2001:db8:1:2::",
    ];

    for (const address of addresses) {
      expect(IpCanonicalUtil.getIpv6Network64(address)).toBe(
        "2001:db8:1:2::/64",
      );
    }
  });

  test("every spelling of one address names the same /64", () => {
    const spellings: Array<string> = [
      "2001:DB8:1:2::1",
      "2001:0db8:0001:0002:0000:0000:0000:0001",
      "2001:db8:1:2:0:0:0:1",
      "  2001:db8:1:2::1  ",
    ];

    for (const spelling of spellings) {
      expect(IpCanonicalUtil.getIpv6Network64(spelling)).toBe(
        "2001:db8:1:2::/64",
      );
    }
  });

  test("neighbouring /64s are different", () => {
    expect(IpCanonicalUtil.getIpv6Network64("2001:db8:1:3::1")).toBe(
      "2001:db8:1:3::/64",
    );
    expect(IpCanonicalUtil.getIpv6Network64("2001:db8:1:1::1")).toBe(
      "2001:db8:1:1::/64",
    );
    expect(IpCanonicalUtil.getIpv6Network64("2001:db9:1:2::1")).toBe(
      "2001:db9:1:2::/64",
    );
  });

  test("an address whose compressed zeros reach into the /64", () => {
    expect(IpCanonicalUtil.getIpv6Network64("2001:db8::1")).toBe(
      "2001:db8:0:0::/64",
    );
    expect(IpCanonicalUtil.getIpv6Network64("::1")).toBe("0:0:0:0::/64");
    expect(IpCanonicalUtil.getIpv6Network64("::")).toBe("0:0:0:0::/64");
    expect(IpCanonicalUtil.getIpv6Network64("fe80::1")).toBe("fe80:0:0:0::/64");
  });

  test("an IPv4 address has no /64", () => {
    expect(IpCanonicalUtil.getIpv6Network64("203.0.113.7")).toBeNull();
    expect(IpCanonicalUtil.getIpv6Network64(" 10.0.0.1 ")).toBeNull();
  });

  test("an IPv4-mapped address is the IPv4 address it maps, which has no /64", () => {
    expect(IpCanonicalUtil.getIpv6Network64("::ffff:203.0.113.7")).toBeNull();
    expect(IpCanonicalUtil.getIpv6Network64("::FFFF:203.0.113.8")).toBeNull();
    expect(IpCanonicalUtil.getIpv6Network64("::ffff:cb00:7107")).toBeNull();
  });

  test("an IPv6 address with an IPv4 tail that is not IPv4-mapped is IPv6", () => {
    expect(IpCanonicalUtil.getIpv6Network64("64:ff9b::203.0.113.7")).toBe(
      "64:ff9b:0:0::/64",
    );
  });

  test("anything that is not an address has no /64", () => {
    for (const value of [
      "",
      "unknown",
      "switch-01.example.com",
      "2001:db8::1::2",
      "[2001:db8::1]:443",
      "2001:db8:1:2::1/64",
      "12345::1",
    ]) {
      expect(IpCanonicalUtil.getIpv6Network64(value)).toBeNull();
    }
  });
});

describe("IpCanonicalUtil.canonicalize, after its expansion was shared", () => {
  test("still canonicalizes as before", () => {
    expect(
      IpCanonicalUtil.canonicalize("2001:0DB8:0000:0000:0000:0000:0000:0001"),
    ).toBe("2001:db8::1");
    expect(IpCanonicalUtil.canonicalize("::ffff:192.168.1.1")).toBe(
      "::ffff:c0a8:101",
    );
    expect(IpCanonicalUtil.canonicalize("1:0:0:2:0:0:0:3")).toBe("1:0:0:2::3");
  });
});
