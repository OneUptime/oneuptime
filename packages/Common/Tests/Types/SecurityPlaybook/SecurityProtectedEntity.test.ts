import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  PROTECTED_DOMAIN_PROBLEM,
  PROTECTED_ENTITY_TYPES,
  PROTECTED_FILE_HASH_PROBLEM,
  findProtectingRule,
  getProtectedEntityTypeFor,
  isProtectedEntityType,
  matchesProtectedAddress,
  matchesProtectedDomain,
  matchesProtectedEntityPattern,
  matchesProtectedFileHash,
  normalizeProtectedAddressValue,
  normalizeProtectedDomainValue,
  normalizeProtectedEntityValue,
  normalizeProtectedFileHashValue,
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

  test("protects users, hosts, addresses, domains and files, the kinds containment acts on, and nothing else", () => {
    expect([...PROTECTED_ENTITY_TYPES]).toEqual([
      SecurityEntityType.User,
      SecurityEntityType.Host,
      SecurityEntityType.IpAddress,
      SecurityEntityType.Domain,
      SecurityEntityType.FileHash,
    ]);
    expect(isProtectedEntityType(SecurityEntityType.IpAddress)).toBe(true);
    expect(isProtectedEntityType("User")).toBe(true);
    expect(isProtectedEntityType(SecurityEntityType.Domain)).toBe(true);
    expect(isProtectedEntityType(SecurityEntityType.FileHash)).toBe(true);
    // A URL is protected by its host's domain entries.
    expect(isProtectedEntityType(SecurityEntityType.Url)).toBe(false);
    expect(isProtectedEntityType(SecurityEntityType.DataStore)).toBe(false);
  });
});

/*
 * A protected domain and a protected file (#10346): a name, or `*.` and a
 * name for every name under it, and a file's hash.
 */
describe("protected domains", () => {
  test("an entry is written as blocks write a domain, `*.` kept", () => {
    expect(normalizeProtectedDomainValue("Example.COM.")).toBe("example.com");
    expect(normalizeProtectedDomainValue(" *.Example.com ")).toBe(
      "*.example.com",
    );
    expect(normalizeProtectedDomainValue("bücher.example")).toBe(
      "xn--bcher-kva.example",
    );
    expect(normalizeProtectedDomainValue("ex*ample.com")).toBeNull();
    expect(normalizeProtectedDomainValue("*example.com")).toBeNull();
    expect(normalizeProtectedDomainValue("localhost")).toBeNull();
    expect(normalizeProtectedDomainValue("")).toBeNull();
    expect(normalizeProtectedDomainValue(5)).toBeNull();
  });

  test("an exact entry protects its name, and refuses a block of any name above it", () => {
    expect(matchesProtectedDomain("status.acme.com", "status.acme.com")).toBe(
      true,
    );
    expect(matchesProtectedDomain("status.acme.com", "STATUS.acme.com.")).toBe(
      true,
    );
    // A block of a domain blocks the names under it.
    expect(matchesProtectedDomain("status.acme.com", "acme.com")).toBe(true);
    // A name under an exact entry is not the entry.
    expect(matchesProtectedDomain("acme.com", "evil.acme.com")).toBe(false);
    expect(matchesProtectedDomain("acme.com", "notacme.com")).toBe(false);
    expect(matchesProtectedDomain("acme.com", "evil.example")).toBe(false);
  });

  test("a `*.` entry protects every name under its domain, and the domain itself", () => {
    expect(matchesProtectedDomain("*.acme.com", "evil.acme.com")).toBe(true);
    expect(matchesProtectedDomain("*.acme.com", "a.b.acme.com")).toBe(true);
    expect(matchesProtectedDomain("*.acme.com", "acme.com")).toBe(true);
    expect(matchesProtectedDomain("*.acme.com", "com")).toBe(false);
    expect(matchesProtectedDomain("*.acme.com", "notacme.com")).toBe(false);
  });

  test("a URL is protected by its host", () => {
    expect(
      matchesProtectedDomain("status.acme.com", "https://status.acme.com/x"),
    ).toBe(true);
    expect(
      matchesProtectedDomain("acme.com", "https://evil.acme.com/login"),
    ).toBe(false);
    expect(
      matchesProtectedDomain("*.acme.com", "https://evil.acme.com/login"),
    ).toBe(true);
    // A URL's block blocks that page alone, never the names above its host.
    expect(
      matchesProtectedDomain("status.acme.com", "https://acme.com/login"),
    ).toBe(false);
    expect(matchesProtectedDomain("acme.com", "http://198.51.100.7/")).toBe(
      false,
    );
  });

  test("an entry that is no domain protects nothing", () => {
    expect(matchesProtectedDomain("not a domain", "acme.com")).toBe(false);
    expect(matchesProtectedDomain("acme.com", "not a domain")).toBe(false);
  });
});

describe("protected files", () => {
  const MD5: string = "44d88612fea8a8f36de82e1278abb02f";
  const SHA256: string =
    "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";

  test("an entry is the file's hash in lower-case hex", () => {
    expect(normalizeProtectedFileHashValue(MD5.toUpperCase())).toBe(MD5);
    expect(normalizeProtectedFileHashValue(SHA256)).toBe(SHA256);
    expect(normalizeProtectedFileHashValue("abc")).toBeNull();
    expect(normalizeProtectedFileHashValue(undefined)).toBeNull();
  });

  test("a hash matches its entry whatever its case, and a hash of another kind never", () => {
    expect(matchesProtectedFileHash(MD5, MD5.toUpperCase())).toBe(true);
    expect(matchesProtectedFileHash(MD5, SHA256)).toBe(false);
    expect(matchesProtectedFileHash("not a hash", "not a hash")).toBe(false);
  });

  test("the entries' refusals are sentences", () => {
    for (const problem of [
      PROTECTED_DOMAIN_PROBLEM,
      PROTECTED_FILE_HASH_PROBLEM,
    ]) {
      expect(problem.charAt(0)).toMatch(/[A-Z]/);
      expect(problem.endsWith(".")).toBe(true);
    }
  });
});

describe("findProtectingRule, for domains, URLs and files", () => {
  const rules: Array<{ type: SecurityEntityType; value: string }> = [
    { type: SecurityEntityType.Domain, value: "*.acme.com" },
    { type: SecurityEntityType.Domain, value: "status.partner.example" },
    {
      type: SecurityEntityType.FileHash,
      value: "44d88612fea8a8f36de82e1278abb02f",
    },
    { type: SecurityEntityType.Host, value: "acme.com" },
  ];

  test("a domain by the domain entries", () => {
    expect(
      findProtectingRule({
        type: SecurityEntityType.Domain,
        value: "partner.example",
        rules,
      }),
    ).toEqual(rules[1]);
    expect(
      findProtectingRule({
        type: SecurityEntityType.Domain,
        value: "evil.example",
        rules,
      }),
    ).toBeUndefined();
  });

  test("a URL by its host's domain entries, never a host entry of the same text", () => {
    expect(getProtectedEntityTypeFor(SecurityEntityType.Url)).toBe(
      SecurityEntityType.Domain,
    );
    expect(getProtectedEntityTypeFor(SecurityEntityType.Host)).toBe(
      SecurityEntityType.Host,
    );
    expect(
      findProtectingRule({
        type: SecurityEntityType.Url,
        value: "https://login.acme.com/reset",
        rules,
      }),
    ).toEqual(rules[0]);
    expect(
      findProtectingRule({
        type: SecurityEntityType.Url,
        value: "https://evil.example/",
        rules,
      }),
    ).toBeUndefined();
  });

  test("a file by its hash", () => {
    expect(
      findProtectingRule({
        type: SecurityEntityType.FileHash,
        value: "44D88612FEA8A8F36DE82E1278ABB02F",
        rules,
      }),
    ).toEqual(rules[2]);
  });

  test("a host still by its own entries", () => {
    expect(
      findProtectingRule({
        type: SecurityEntityType.Host,
        value: "ACME.com",
        rules,
      }),
    ).toEqual(rules[3]);
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
