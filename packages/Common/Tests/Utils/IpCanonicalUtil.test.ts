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
