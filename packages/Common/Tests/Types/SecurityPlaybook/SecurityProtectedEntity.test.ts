import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  PROTECTED_ENTITY_TYPES,
  findProtectingRule,
  isProtectedEntityType,
  matchesProtectedAddress,
  matchesProtectedEntityPattern,
  normalizeProtectedAddressValue,
  normalizeProtectedEntityValue,
} from "../../../Types/SecurityPlaybook/SecurityProtectedEntity";
import { describe, expect, test } from "@jest/globals";

/*
 * How a protected entry matches a user or host: the value itself, whatever
 * the case, or a pattern whose `*` stands for any run of characters. And an
 * address entry, which matches as a range.
 */

describe("matchesProtectedEntityPattern", () => {
  test("a plain value matches itself, whatever the case or the spaces around it", () => {
    expect(
      matchesProtectedEntityPattern(
        "BreakGlass@Acme.com",
        " breakglass@acme.com ",
      ),
    ).toBe(true);
    expect(
      matchesProtectedEntityPattern(
        "breakglass@acme.com",
        "breakglass@acme.co",
      ),
    ).toBe(false);
    expect(matchesProtectedEntityPattern("vpn-gw-01", "vpn-gw-010")).toBe(
      false,
    );
  });

  test("* stands for any run of characters, at the start, the end or between", () => {
    expect(matchesProtectedEntityPattern("svc-*", "svc-backup")).toBe(true);
    expect(matchesProtectedEntityPattern("svc-*", "svc-")).toBe(true);
    expect(matchesProtectedEntityPattern("svc-*", "my-svc-backup")).toBe(false);
    expect(
      matchesProtectedEntityPattern(
        "*.corp.example.com",
        "DC1.corp.example.com",
      ),
    ).toBe(true);
    expect(
      matchesProtectedEntityPattern(
        "*.corp.example.com",
        "dc1.corp.example.org",
      ),
    ).toBe(false);
    expect(matchesProtectedEntityPattern("dc*-*.corp", "dc01-east.corp")).toBe(
      true,
    );
    expect(matchesProtectedEntityPattern("dc*-*.corp", "dc01.corp")).toBe(
      false,
    );
    expect(matchesProtectedEntityPattern("*", "anything")).toBe(true);
  });

  test("the pieces of a pattern cannot overlap", () => {
    expect(matchesProtectedEntityPattern("ab*ba", "aba")).toBe(false);
    expect(matchesProtectedEntityPattern("ab*ba", "abba")).toBe(true);
  });

  test("an empty pattern or value matches nothing", () => {
    expect(matchesProtectedEntityPattern("", "web-01")).toBe(false);
    expect(matchesProtectedEntityPattern("  ", "web-01")).toBe(false);
    expect(matchesProtectedEntityPattern("*", "")).toBe(false);
  });

  test("reads a long value without a regular expression", () => {
    const value: string = `${"a".repeat(200000)}-gw`;

    expect(matchesProtectedEntityPattern("*a*a*a*-gw", value)).toBe(true);
    expect(matchesProtectedEntityPattern("*a*a*a*-gx", value)).toBe(false);
  });
});

describe("normalizeProtectedEntityValue", () => {
  test("trims, and folds a run of wildcards into one", () => {
    expect(normalizeProtectedEntityValue("  svc-***  ")).toBe("svc-*");
    expect(normalizeProtectedEntityValue(42)).toBe("");
  });
});

describe("findProtectingRule", () => {
  test("matches only a rule of the entity's own kind", () => {
    const rules: Array<{ type: SecurityEntityType; value: string }> = [
      { type: SecurityEntityType.User, value: "vpn-*" },
      { type: SecurityEntityType.Host, value: "VPN-GW-*" },
    ];

    expect(
      findProtectingRule({
        type: SecurityEntityType.Host,
        value: "vpn-gw-01",
        rules,
      }),
    ).toEqual({ type: SecurityEntityType.Host, value: "VPN-GW-*" });
    expect(
      findProtectingRule({
        type: SecurityEntityType.User,
        value: "alice",
        rules,
      }),
    ).toBeUndefined();
  });

  test("protects users, hosts and addresses, the kinds containment acts on, and nothing else", () => {
    expect([...PROTECTED_ENTITY_TYPES]).toEqual([
      SecurityEntityType.User,
      SecurityEntityType.Host,
      SecurityEntityType.IpAddress,
    ]);
    expect(isProtectedEntityType(SecurityEntityType.IpAddress)).toBe(true);
    expect(isProtectedEntityType("User")).toBe(true);
    expect(isProtectedEntityType(SecurityEntityType.Domain)).toBe(false);
    expect(isProtectedEntityType(SecurityEntityType.DataStore)).toBe(false);
  });
});

/*
 * A protected address (#10338) is an address or a range, matched as a range
 * whichever way they meet: an entry of a range protects every address
 * inside it, and an entry of an address refuses a block of a range that
 * holds it. Never a pattern: a `*` is no address.
 */
describe("protected addresses", () => {
  const rules: Array<{ type: SecurityEntityType; value: string }> = [
    { type: SecurityEntityType.IpAddress, value: "203.0.113.0/24" },
    { type: SecurityEntityType.IpAddress, value: "198.51.100.7" },
    { type: SecurityEntityType.IpAddress, value: "2001:db8:1::/48" },
    // A user's rule never protects an address, whatever it says.
    { type: SecurityEntityType.User, value: "*" },
  ];

  function protectedBy(value: string): string | undefined {
    return findProtectingRule({
      type: SecurityEntityType.IpAddress,
      value,
      rules,
    })?.value;
  }

  test("an address inside an entry's range is protected by it", () => {
    expect(protectedBy("203.0.113.10")).toBe("203.0.113.0/24");
    expect(protectedBy("203.0.113.255")).toBe("203.0.113.0/24");
    expect(protectedBy("2001:db8:1:ffff::9")).toBe("2001:db8:1::/48");
  });

  test("a range that holds an entry's address is protected by it", () => {
    expect(protectedBy("198.51.100.0/24")).toBe("198.51.100.7");
    expect(protectedBy("2001:db8::/32")).toBe("2001:db8:1::/48");
  });

  test("ranges that overlap protect each other, however they were written", () => {
    expect(protectedBy("203.0.113.128/25")).toBe("203.0.113.0/24");
    expect(protectedBy("203.0.112.0/23")).toBe("203.0.113.0/24");
    expect(protectedBy("2001:DB8:1:0:0:0:0:1")).toBe("2001:db8:1::/48");
  });

  test("an address no entry holds is not protected, and families never meet", () => {
    expect(protectedBy("203.0.114.1")).toBeUndefined();
    expect(protectedBy("198.51.100.8")).toBeUndefined();
    expect(protectedBy("2001:db8:2::1")).toBeUndefined();
    expect(protectedBy("::ffff:203.0.114.1")).toBeUndefined();
    expect(
      findProtectingRule({
        type: SecurityEntityType.IpAddress,
        value: "2001:db8::1",
        rules: [{ type: SecurityEntityType.IpAddress, value: "0.0.0.0/0" }],
      }),
    ).toBeUndefined();
  });

  test("an IPv4 address an IPv6 one maps is matched as that IPv4 address", () => {
    expect(protectedBy("::ffff:203.0.113.10")).toBe("203.0.113.0/24");
  });

  test("a user's or a host's rule never protects an address, nor an address rule a user", () => {
    expect(
      findProtectingRule({
        type: SecurityEntityType.IpAddress,
        value: "192.0.2.1",
        rules: [
          { type: SecurityEntityType.User, value: "*" },
          { type: SecurityEntityType.Host, value: "192.0.2.1" },
        ],
      }),
    ).toBeUndefined();
    expect(
      findProtectingRule({
        type: SecurityEntityType.User,
        value: "203.0.113.10",
        rules,
      })?.value,
    ).toBe("*");
    expect(
      findProtectingRule({
        type: SecurityEntityType.Host,
        value: "203.0.113.10",
        rules,
      }),
    ).toBeUndefined();
  });

  test("a value that is no address, a pattern included, matches no address entry", () => {
    expect(protectedBy("203.0.113.*")).toBeUndefined();
    expect(protectedBy("web-3")).toBeUndefined();
    expect(protectedBy("")).toBeUndefined();
    expect(
      findProtectingRule({
        type: SecurityEntityType.IpAddress,
        value: "203.0.113.10",
        rules: [{ type: SecurityEntityType.IpAddress, value: "203.0.113.*" }],
      }),
    ).toBeUndefined();
  });
});

describe("matchesProtectedAddress", () => {
  test("is whether the two share any address", () => {
    expect(matchesProtectedAddress("10.0.0.0/8", "10.18.167.35")).toBe(true);
    expect(matchesProtectedAddress("10.18.167.35", "10.0.0.0/8")).toBe(true);
    expect(matchesProtectedAddress("10.18.167.0/24", "10.18.168.0/24")).toBe(
      false,
    );
    expect(matchesProtectedAddress("fe80::/10", "FE80::1")).toBe(true);
    expect(matchesProtectedAddress("10.0.0.0/8", "fe80::1")).toBe(false);
    expect(matchesProtectedAddress("", "10.0.0.1")).toBe(false);
    expect(matchesProtectedAddress("10.0.0.0/8", "")).toBe(false);
  });
});

describe("normalizeProtectedAddressValue", () => {
  test("writes an address or a range the one way blocks are", () => {
    expect(normalizeProtectedAddressValue(" 203.0.113.7 ")).toBe("203.0.113.7");
    expect(normalizeProtectedAddressValue("203.0.113.7/24")).toBe(
      "203.0.113.0/24",
    );
    expect(normalizeProtectedAddressValue("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeProtectedAddressValue("2001:db8::1/128")).toBe(
      "2001:db8::1",
    );
    expect(normalizeProtectedAddressValue("::ffff:203.0.113.7")).toBe(
      "203.0.113.7",
    );
  });

  test("is null for anything else", () => {
    expect(normalizeProtectedAddressValue("203.0.113.*")).toBeNull();
    expect(normalizeProtectedAddressValue("vpn-gw-01")).toBeNull();
    expect(normalizeProtectedAddressValue("203.0.113.0/33")).toBeNull();
    expect(normalizeProtectedAddressValue("")).toBeNull();
    expect(normalizeProtectedAddressValue(42)).toBeNull();
    expect(normalizeProtectedAddressValue(undefined)).toBeNull();
  });
});
