import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import IP from "../../../Types/IP/IP";
import IPv6 from "../../../Types/IP/IPv6";
import IpCanonicalUtil from "../../../Utils/IpCanonicalUtil";
import { describe, expect, test } from "@jest/globals";
import net from "net";

/*
 * EVERY TEXT FORM OF AN IPv6 ADDRESS (issue #8927).
 *
 * IP.isIPv6 took an IPv4 address at the end of an IPv6 one only after "::",
 * "::ffff:" or up to four groups and "::". RFC 4291 section 2.2 allows it
 * after six groups and in any compressed form with up to five of them, and
 * Node's net.isIPv6, which every address check of an outbound request reads
 * addresses by, takes every one. So a HOST of [2001:db8::1:192.0.2.1]
 * stopped every service at boot ("Hostname ... is not in valid format"),
 * and an IP allowlist entry or a monitor destination in such a form was
 * refused. The app now takes what Node takes, apart from a zone, which it
 * takes on a link-local address only, as it always has.
 */

function isIPv6(text: string): boolean {
  return IP.isIP(text) && new IP(text).isIPv6();
}

/*
 * IPv6 addresses and near misses of every length: 0 to 9 groups, "::" in
 * every place or none, an IPv4 address (or a broken one) at the end, and a
 * group that is too long, not hex or empty - the corpus
 * Tests/Ops/HelmHost.test.js holds the Helm chart's copy of the rule to,
 * and then some.
 */
function ipv6Shapes(): Array<string> {
  const groups: Array<string> = [
    "0",
    "1",
    "db8",
    "FFFF",
    "abcd",
    "0000",
    "fe80",
    "64",
    "ff9b",
  ];
  const tails: Array<string> = [
    "",
    "192.0.2.1",
    "127.0.0.1",
    "256.0.2.1",
    "1.2.3",
    "01.2.3.4",
    "1.2.3.04",
    "0.0.0.0",
    "255.255.255.255",
    "1.2.3.4.5",
    "1..2.3",
  ];
  const badGroups: Array<[number, string]> = [
    [-1, ""],
    [0, "00000"],
    [1, "g1"],
    [2, ""],
  ];
  const texts: Set<string> = new Set<string>();

  for (let count: number = 0; count <= 9; count++) {
    for (let gap: number = -1; gap <= count; gap++) {
      for (const tail of tails) {
        for (const [bad, badGroup] of badGroups) {
          for (let offset: number = 0; offset < 3; offset++) {
            const parts: Array<string> = [];

            for (let index: number = 0; index < count; index++) {
              parts.push(
                index === bad
                  ? badGroup
                  : groups[(index * 3 + count + offset) % groups.length]!,
              );
            }

            let text: string =
              gap === -1
                ? parts.join(":")
                : `${parts.slice(0, gap).join(":")}::${parts
                    .slice(gap)
                    .join(":")}`;

            if (tail) {
              text =
                text && !text.endsWith(":") ? `${text}:${tail}` : text + tail;
            }

            if (text) {
              texts.add(text);
            }
          }
        }
      }
    }
  }

  return Array.from(texts);
}

describe("IP.isIPv6 takes every text form of RFC 4291", () => {
  // Section 2.2, form 1: eight groups.
  const FULL: Array<string> = [
    "ABCD:EF01:2345:6789:ABCD:EF01:2345:6789",
    "2001:DB8:0:0:8:800:200C:417A",
    "2001:0db8:0000:0000:0000:0000:0000:0001",
    "0:0:0:0:0:0:0:0",
    "0:0:0:0:0:0:0:1",
    "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
  ];

  // Form 2: "::" in place of one or more groups of zeros.
  const COMPRESSED: Array<string> = [
    "2001:DB8::8:800:200C:417A",
    "FF01::101",
    "::1",
    "::",
    "1::",
    "1:2:3:4:5:6:7::",
    "::2:3:4:5:6:7:8",
    "1::8",
    "1:2::7:8",
    "1:2:3::6:7:8",
    "1:2:3:4::5:6:7",
    "fe80::1",
  ];

  // Form 3: an IPv4 address in the last 32 bits, after six groups' worth.
  const WITH_IPV4: Array<string> = [
    // Six groups, then the IPv4 address (RFC 4291's own examples).
    "0:0:0:0:0:0:13.1.68.3",
    "0:0:0:0:0:FFFF:129.144.52.38",
    "1:2:3:4:5:6:1.2.3.4",
    "2001:db8:0:0:0:0:192.0.2.1",
    // Compressed, the forms the app used to refuse (#8927).
    "2001:db8::1:192.0.2.1",
    "::1:2:3:4:5:1.2.3.4",
    "1:2::3:1.2.3.4",
    "1::2:3:4:5:192.0.2.1",
    "1:2:3:4:5::192.0.2.1",
    "1:2:3:4::5:192.0.2.1",
    "::ffff:0:192.0.2.1",
    "0::ffff:192.0.2.1",
    "64:ff9b:0:0:0:0:192.0.2.33",
    "2002:c000:201::192.0.2.1",
    // And the compressed forms it always took.
    "::13.1.68.3",
    "::FFFF:129.144.52.38",
    "::ffff:192.0.2.1",
    "64:ff9b::192.0.2.33",
    "2001:db8::192.168.0.1",
    "1:2:3:4::192.0.2.1",
    // Every octet at its edges.
    "::ffff:0.0.0.0",
    "::ffff:255.255.255.255",
    "::ffff:9.99.100.249",
  ];

  test.each([...FULL, ...COMPRESSED, ...WITH_IPV4])(
    "takes %s, as net.isIPv6 does",
    (text: string) => {
      expect(net.isIPv6(text)).toBe(true);
      expect(isIPv6(text)).toBe(true);
      expect(new IP(text).isIPv4()).toBe(false);
      expect(new IPv6(text).toString()).toBe(text);
    },
  );

  test.each(WITH_IPV4)(
    "%s is the address Node and a browser read it as",
    (text: string) => {
      // WHATWG writes the IPv4 part in hex; the app's canonical form agrees.
      const whatwg: string = new globalThis.URL(
        `http://[${text}]/`,
      ).hostname.slice(1, -1);

      expect(IpCanonicalUtil.canonicalize(text)).toBe(
        IpCanonicalUtil.canonicalize(whatwg),
      );
      expect(IpCanonicalUtil.areSameIpAddress(text, whatwg)).toBe(true);
    },
  );
});

describe("IP.isIPv6 refuses what is no IPv6 address", () => {
  const NEAR_MISSES: Array<[string, string]> = [
    ["1:2:3:4:5:6:7:1.2.3.4", "an IPv4 address after seven groups"],
    ["1:2:3:4:5:1.2.3.4", "an IPv4 address after five groups, without ::"],
    ["::1:2:3:4:5:6:1.2.3.4", "six groups and :: before an IPv4 address"],
    ["1:2:3:4:5:6::1.2.3.4", "an IPv4 address after six groups and ::"],
    ["::ffff:01.2.3.4", "an IPv4 part with a leading zero"],
    ["::ffff:1.2.3.04", "an IPv4 part with a leading zero, last"],
    ["::ffff:256.0.2.1", "an IPv4 part past 255"],
    ["::ffff:1.2.3", "three IPv4 parts"],
    ["::ffff:1.2.3.4.5", "five IPv4 parts"],
    ["::1.2.3.4:5", "a group after the IPv4 address"],
    ["1.2.3.4::", ":: after an IPv4 address"],
    ["::ffff:1..2.3", "an empty IPv4 part"],
    ["1:2:3:4:5:6:7:8:9", "nine groups"],
    ["1::2::3", "two ::"],
    ["1:::2", "a triple colon"],
    [":1:2:3:4:5:6:7", "a lone colon at the start"],
    ["1:2:3:4:5:6:7:", "a lone colon at the end"],
    ["12345::", "a group of five digits"],
    ["g::1", "a group that is not hex"],
    ["2001:db8::1%eth0", "a zone on an address that is not link-local"],
    ["[2001:db8::1:192.0.2.1]", "brackets"],
    [" 2001:db8::1:192.0.2.1", "a leading space"],
    ["2001:db8::1:192.0.2.1 ", "a trailing space"],
    ["2001:db8::/32", "a prefix"],
  ];

  test.each(NEAR_MISSES)("refuses %s, %s", (text: string) => {
    expect(isIPv6(text)).toBe(false);
    expect(() => {
      return new IP(text);
    }).toThrow("IP is not a valid address");
  });

  test.each(
    NEAR_MISSES.filter(([text]: [string, string]) => {
      return !text.includes("%");
    }),
  )("net.isIPv6 refuses %s too", (text: string) => {
    expect(net.isIPv6(text)).toBe(false);
  });
});

describe("IP.isIPv6 and net.isIPv6 give one answer", () => {
  test("for every address and near miss of every length", () => {
    const texts: Array<string> = ipv6Shapes();
    const disagreements: Array<string> = texts
      .filter((text: string): boolean => {
        return isIPv6(text) !== net.isIPv6(text);
      })
      .map((text: string): string => {
        return `${text}: IP.isIPv6 ${isIPv6(text) ? "takes" : "refuses"} it, net.isIPv6 ${
          net.isIPv6(text) ? "takes" : "refuses"
        } it`;
      });

    expect(disagreements).toEqual([]);

    // The corpus holds every kind: plain, compressed, with an IPv4 address.
    const taken: Array<string> = texts.filter(isIPv6);
    expect(texts.length).toBeGreaterThan(5000);
    expect(taken.length).toBeGreaterThan(300);
    expect(
      taken.filter((text: string): boolean => {
        return text.includes(".");
      }).length,
    ).toBeGreaterThan(50);
  });

  test("for every address with an IPv4 address in its last 32 bits", () => {
    const disagreements: Array<string> = [];

    // Every way to write six leading groups: none to six, "::" anywhere.
    for (let head: number = 0; head <= 6; head++) {
      for (let tail: number = 0; head + tail <= 6; tail++) {
        const headGroups: Array<string> = ["1", "2", "3", "4", "5", "6"].slice(
          0,
          head,
        );
        const tailGroups: Array<string> = ["a", "b", "c", "d", "e", "f"].slice(
          0,
          tail,
        );
        const forms: Array<string> = [
          `${headGroups.join(":")}::${tailGroups
            .map((group: string) => {
              return `${group}:`;
            })
            .join("")}192.0.2.1`,
        ];

        if (tail === 0) {
          forms.push(`${headGroups.join(":")}:192.0.2.1`);
        }

        for (const form of forms) {
          if (isIPv6(form) !== net.isIPv6(form)) {
            disagreements.push(form);
          }
        }
      }
    }

    expect(disagreements).toEqual([]);
  });
});

describe("a link-local address keeps its zone, as it always has", () => {
  test.each(["fe80::1%eth0", "fe80::abcd:1%en0", "fe80::%25"])(
    "takes %s",
    (text: string) => {
      expect(isIPv6(text)).toBe(true);
    },
  );
});

describe("a host in brackets with an IPv4 address at its end is a host", () => {
  test.each([
    "[2001:db8::1:192.0.2.1]",
    "[2001:db8::1:192.0.2.1]:8080",
    "[1:2:3:4:5:6:1.2.3.4]",
    "[::1:2:3:4:5:1.2.3.4]",
    "[0:0:0:0:0:ffff:192.0.2.1]",
  ])("Hostname takes %s, as HOST and in a URL", (host: string) => {
    expect(Hostname.isValid(host)).toBe(true);
    expect(new Hostname(host).hostname).toBe(host);
    expect(URL.fromString(`https://${host}/status`).hostname.toString()).toBe(
      host,
    );
  });

  test.each(["[::ffff:01.2.3.4]", "[1:2:3:4:5:6:7:1.2.3.4]"])(
    "Hostname still refuses %s",
    (host: string) => {
      expect(Hostname.isValid(host)).toBe(false);
    },
  );
});

describe("IpCanonicalUtil reads the newly taken forms by the bits they spell", () => {
  test("a canonical form, RFC 5952's, with the IPv4 part in hex", () => {
    expect(IpCanonicalUtil.canonicalize("2001:db8::1:192.0.2.1")).toBe(
      "2001:db8::1:c000:201",
    );
    expect(IpCanonicalUtil.canonicalize("1:2:3:4:5:6:1.2.3.4")).toBe(
      "1:2:3:4:5:6:102:304",
    );
    expect(IpCanonicalUtil.canonicalize("::1:2:3:4:5:1.2.3.4")).toBe(
      "0:1:2:3:4:5:102:304",
    );
    expect(IpCanonicalUtil.canonicalize("0:0:0:0:0:FFFF:192.0.2.1")).toBe(
      "::ffff:c000:201",
    );
  });

  test("an IPv4 address written as IPv6 in full is still that IPv4 host", () => {
    expect(IpCanonicalUtil.getEmbeddedIpv4("0:0:0:0:0:ffff:203.0.113.7")).toBe(
      "203.0.113.7",
    );
    expect(IpCanonicalUtil.getEmbeddedIpv4("0::ffff:203.0.113.7")).toBe(
      "203.0.113.7",
    );
    expect(IpCanonicalUtil.getEmbeddedIpv4("64:ff9b:0:0:0:0:203.0.113.7")).toBe(
      "203.0.113.7",
    );
    expect(IpCanonicalUtil.getIpv6Network64("0:0:0:0:0:ffff:203.0.113.7")).toBe(
      null,
    );
  });

  test("an IPv6 address that only ends in an IPv4 address is an IPv6 address", () => {
    expect(IpCanonicalUtil.getEmbeddedIpv4("2001:db8::1:192.0.2.1")).toBe(null);
    expect(IpCanonicalUtil.getEmbeddedIpv4("1:2:3:4:5:6:127.0.0.1")).toBe(null);
    expect(IpCanonicalUtil.getIpv6Network64("2001:db8::1:192.0.2.1")).toBe(
      "2001:db8:0:0::/64",
    );
  });
});
