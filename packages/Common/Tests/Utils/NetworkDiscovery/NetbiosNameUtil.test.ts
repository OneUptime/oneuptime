import {
  MAX_NETBIOS_NAME_LENGTH,
  isNetbiosQueryableIPv4Address,
  normalizeNetbiosName,
} from "../../../Utils/NetworkDiscovery/NetbiosNameUtil";
import { normalizeReverseDnsName } from "../../../Utils/NetworkDiscovery/ReverseDnsNameUtil";
import Slug from "../../../Utils/Slug";
import { describe, expect, it } from "@jest/globals";

/*
 * OneUptime issue #3677 — discovered hosts with no DNS record and no SNMP show
 * only as raw IPs in "Review Discovered Devices".
 *
 * The probe now asks such hosts for their NetBIOS name (an NBSTAT query to UDP
 * 137). This is the gate on what that answer may become. The value is
 * SELF-REPORTED by whatever machine is at the scanned address, so it is
 * untrusted input that goes on to be a rendered line in the Review dialog, a
 * NetworkDevice's name and that device's slug.
 *
 * Two halves that pull in opposite directions, and both matter:
 *
 *   - Real names must survive, including the padding every responder leaves on
 *     the 15-byte field. A rule that is too strict names every Windows host by
 *     its address again and nothing says why.
 *   - Everything that is not a single-label machine name must not: dots,
 *     whitespace inside, markup, control characters, non-ASCII, the browser
 *     election pseudo-name, and names that merely restate a number.
 *
 * Every non-printing and non-ASCII character in this file is written as a
 * \uXXXX escape, for the reason ReverseDnsNameUtil.test.ts gives: the point of
 * several cases is that the character is invisible, and a literal one would be
 * unreviewable in a diff.
 */

describe("normalizeNetbiosName — names that must survive", () => {
  it("accepts an ordinary workstation name and lower-cases it", () => {
    /*
     * NetBIOS upper-cases on the wire, so the case carries no intent. Lower
     * case matches the estate's DNS names in the same list.
     */
    expect(normalizeNetbiosName("WORKSTATION01")).toBe("workstation01");
  });

  it("strips the space padding RFC 1001 puts on the 15-byte field", () => {
    expect(normalizeNetbiosName("REG01          ")).toBe("reg01");
  });

  it("strips NUL padding, which some embedded stacks use instead", () => {
    expect(
      normalizeNetbiosName("REG01\u0000\u0000\u0000\u0000\u0000\u0000"),
    ).toBe("reg01");
  });

  it("strips mixed space and NUL padding in any order", () => {
    expect(normalizeNetbiosName("REG01 \u0000 \u0000")).toBe("reg01");
    expect(normalizeNetbiosName("REG01\u0000 \u0000 ")).toBe("reg01");
    expect(normalizeNetbiosName("REG01\u0000\t")).toBe("reg01");
  });

  it("trims leading whitespace", () => {
    expect(normalizeNetbiosName("  REG01")).toBe("reg01");
    expect(normalizeNetbiosName("\tREG01\n")).toBe("reg01");
  });

  it("accepts hyphens and underscores inside the name", () => {
    expect(normalizeNetbiosName("WB-0660-KDS01")).toBe("wb-0660-kds01");
    expect(normalizeNetbiosName("FIN_SRV_2")).toBe("fin_srv_2");
  });

  it("accepts a leading underscore, which the shared label rule allows", () => {
    expect(normalizeNetbiosName("_SVC1")).toBe("_svc1");
  });

  it("accepts a single letter", () => {
    expect(normalizeNetbiosName("A")).toBe("a");
  });

  it("accepts a name that starts with digits as long as it has a letter", () => {
    expect(normalizeNetbiosName("1PRINTER")).toBe("1printer");
    expect(normalizeNetbiosName("0660A")).toBe("0660a");
  });

  it("accepts exactly fifteen characters", () => {
    const fifteen: string = "ABCDEFGHIJKLMNO";

    expect(fifteen).toHaveLength(MAX_NETBIOS_NAME_LENGTH);
    expect(normalizeNetbiosName(fifteen)).toBe("abcdefghijklmno");
  });

  it("accepts fifteen characters followed by padding", () => {
    // The padding is not part of the name, so it does not count to the limit.
    expect(normalizeNetbiosName("ABCDEFGHIJKLMNO\u0000   ")).toBe(
      "abcdefghijklmno",
    );
  });

  it("leaves an already-lower-case name as it is", () => {
    expect(normalizeNetbiosName("fileserver")).toBe("fileserver");
  });
});

describe("normalizeNetbiosName — values that are not a name", () => {
  it("rejects sixteen characters", () => {
    expect(normalizeNetbiosName("ABCDEFGHIJKLMNOP")).toBeUndefined();
  });

  it("rejects an empty string and pure padding", () => {
    expect(normalizeNetbiosName("")).toBeUndefined();
    expect(normalizeNetbiosName("               ")).toBeUndefined();
    expect(normalizeNetbiosName("\u0000\u0000\u0000")).toBeUndefined();
    expect(normalizeNetbiosName(" \u0000 \t\n")).toBeUndefined();
  });

  it("rejects dots, including a trailing root dot a DNS normaliser would drop", () => {
    expect(normalizeNetbiosName("HOST.CORP")).toBeUndefined();
    expect(normalizeNetbiosName("HOST.")).toBeUndefined();
    expect(normalizeNetbiosName(".HOST")).toBeUndefined();
    expect(normalizeNetbiosName("10.0.0.1")).toBeUndefined();
  });

  it("rejects whitespace or NUL inside the name", () => {
    expect(normalizeNetbiosName("CORE SWITCH")).toBeUndefined();
    expect(normalizeNetbiosName("CORE\u0000SW")).toBeUndefined();
    expect(normalizeNetbiosName("CORE\tSW")).toBeUndefined();
  });

  it("rejects a leading or trailing hyphen", () => {
    expect(normalizeNetbiosName("-HOST")).toBeUndefined();
    expect(normalizeNetbiosName("HOST-")).toBeUndefined();
  });

  it("rejects markup and punctuation", () => {
    for (const value of [
      "<script>",
      "<b>HOST</b>",
      'HOST"',
      "HOST'",
      "HOST/1",
      "HOST\\1",
      "HOST&CO",
      "HOST;DROP",
      "HOST~1",
      "HOST@X",
      "HOST%20",
    ]) {
      expect({ value: value, result: normalizeNetbiosName(value) }).toEqual({
        value: value,
        result: undefined,
      });
    }
  });

  it("rejects the NBSTAT wildcard name", () => {
    expect(normalizeNetbiosName("*")).toBeUndefined();
    expect(
      normalizeNetbiosName(
        "*\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000",
      ),
    ).toBeUndefined();
  });

  it("rejects the browser election pseudo-name as it appears on the wire", () => {
    // "\x01\x02__MSBROWSE__\x02", registered as a group with suffix <01>.
    expect(
      normalizeNetbiosName("\u0001\u0002__MSBROWSE__\u0002"),
    ).toBeUndefined();
  });

  it("rejects the browser election pseudo-name with its control bytes stripped", () => {
    /*
     * The bare spelling is label-shaped and has letters, so only the explicit
     * refusal stops a responder that strips the control bytes from naming a
     * device "__msbrowse__".
     */
    expect(normalizeNetbiosName("__MSBROWSE__")).toBeUndefined();
    expect(normalizeNetbiosName("__msbrowse__")).toBeUndefined();
  });

  it("rejects the IIS 'IS~' names, whose tilde is not a label character", () => {
    expect(normalizeNetbiosName("IS~WEB01")).toBeUndefined();
  });

  it("rejects control characters anywhere", () => {
    expect(normalizeNetbiosName("\u0001HOST")).toBeUndefined();
    expect(normalizeNetbiosName("HO\u001bST")).toBeUndefined();
    expect(normalizeNetbiosName("HOST\u007f")).toBeUndefined();
  });

  it("rejects non-ASCII, including latin1 bytes a raw decode produces", () => {
    expect(normalizeNetbiosName("K\u00d6LN01")).toBeUndefined();
    expect(normalizeNetbiosName("HOST\u00a0")).toBe("host");
    expect(normalizeNetbiosName("HO\u00a0ST")).toBeUndefined();
    expect(normalizeNetbiosName("\u0445OST")).toBeUndefined();
    expect(normalizeNetbiosName("HO\u200dST")).toBeUndefined();
    expect(normalizeNetbiosName("HOST\u202e")).toBeUndefined();
  });

  it("rejects names with no letter at all", () => {
    expect(normalizeNetbiosName("12345")).toBeUndefined();
    expect(normalizeNetbiosName("10-18-167-31")).toBeUndefined();
    expect(normalizeNetbiosName("____")).toBeUndefined();
    expect(normalizeNetbiosName("_1_")).toBeUndefined();
  });

  it("rejects every non-string input without throwing", () => {
    for (const value of [
      undefined,
      null,
      0,
      1234,
      true,
      {},
      [],
      ["HOST"],
      { name: "HOST" },
      Symbol("HOST"),
      BigInt(5),
      (): string => {
        return "HOST";
      },
    ]) {
      expect(normalizeNetbiosName(value)).toBeUndefined();
    }
  });

  it("does not stall on a very long run of padding before one real character", () => {
    /*
     * A backtracking `/[ \0]+$/` would be quadratic here. The server reads
     * these values out of jsonb, so a hostile row must stay cheap to reject.
     */
    const startedAt: number = Date.now();

    expect(
      normalizeNetbiosName("A" + " ".repeat(200000) + "B"),
    ).toBeUndefined();
    expect(normalizeNetbiosName("A" + " \u0000".repeat(100000))).toBe("a");
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});

describe("normalizeNetbiosName — agrees with the shared DNS label rule", () => {
  it("accepts exactly what normalizeReverseDnsName accepts as a single short label, lower-cased", () => {
    const labels: Array<string> = [
      "HOST",
      "host-1",
      "a_b",
      "_x",
      "x_",
      "A-B-C",
      "-bad",
      "bad-",
      "a b",
      "a<b",
    ];

    for (const label of labels) {
      const dnsVerdict: string | undefined = normalizeReverseDnsName(label);
      const netbiosVerdict: string | undefined = normalizeNetbiosName(label);

      expect({ label: label, netbios: netbiosVerdict }).toEqual({
        label: label,
        netbios: dnsVerdict === label ? label.toLowerCase() : undefined,
      });
    }
  });
});

describe("normalizeNetbiosName — invariants", () => {
  it("is idempotent", () => {
    for (const value of [
      "WORKSTATION01",
      "REG01          ",
      "REG01\u0000\u0000",
      "  wb-0660-kds01",
      "FIN_SRV_2",
      "ABCDEFGHIJKLMNO",
    ]) {
      const once: string | undefined = normalizeNetbiosName(value);

      expect(once).toBeDefined();
      expect(normalizeNetbiosName(once)).toBe(once);
    }
  });

  it("produces a value Slug can turn into a non-empty slug", () => {
    const name: string | undefined = normalizeNetbiosName("REG01          ");

    expect(name).toBe("reg01");
    expect(Slug.getSlug(name!)).toContain("reg01");
  });

  it("property: every output is a lower-case single label of 1-15 safe characters with a letter, and stable", () => {
    /*
     * A deterministic LCG, not Math.random: a property test that fails on one
     * run in a thousand is a flaky test, and a flaky guard gets deleted.
     */
    let seed: number = 0x3677;

    const nextRandom: () => number = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    /*
     * Weighted toward the characters the rule has an opinion about, so the
     * accepted branch is actually exercised rather than drowned in noise.
     */
    const alphabet: Array<string> = [
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-",
      " ",
      "\u0000",
      ".",
      "*",
      "~",
      "<",
      "\u0001",
      "\u00e9",
      "\t",
    ];

    let acceptedCount: number = 0;

    for (let iteration: number = 0; iteration < 5000; iteration++) {
      const length: number = Math.floor(nextRandom() * 20);
      let value: string = "";

      for (let index: number = 0; index < length; index++) {
        value += alphabet[Math.floor(nextRandom() * alphabet.length)];
      }

      const result: string | undefined = normalizeNetbiosName(value);

      if (result === undefined) {
        continue;
      }

      acceptedCount++;

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.length).toBeLessThanOrEqual(MAX_NETBIOS_NAME_LENGTH);
      expect(result).toMatch(/^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/);
      expect(result).toMatch(/[a-z]/);
      expect(result).not.toBe("__msbrowse__");
      expect(normalizeNetbiosName(result)).toBe(result);
    }

    // A guard on the guard: a property that is never exercised proves nothing.
    expect(acceptedCount).toBeGreaterThan(50);
  });
});

/*
 * OneUptime issue #3916 — the Review dialog told an unnamed host on a scan
 * with NetBIOS off that "NetBIOS lookup asks Windows hosts for their own
 * name" whatever its address. The probe only ever queries private and CGNAT
 * IPv4 (isNetbiosQueryAddressAllowed, Probe/Utils/Discovery/
 * NetbiosNameResolver.ts), so on public space that advice led to a rescan
 * whose only news was "not asked".
 *
 * This is the browser-safe copy of the probe's rule that the dialog now asks
 * first. The expectations are written out by hand from RFC 1918 and RFC 6598,
 * not computed, so a wrong range in the helper cannot agree with itself here.
 * The probe's NetbiosEligibilityParity test then holds the helper to the
 * probe's own answer on the same edges and a sweep.
 */
describe("isNetbiosQueryableIPv4Address — the addresses the probe would ask", () => {
  it("accepts the first, last and an inside address of every range", () => {
    for (const address of [
      // 10.0.0.0/8
      "10.0.0.0",
      "10.0.0.1",
      "10.16.42.51",
      "10.255.255.255",
      // 172.16.0.0/12
      "172.16.0.0",
      "172.20.1.2",
      "172.31.255.255",
      // 192.168.0.0/16
      "192.168.0.0",
      "192.168.1.1",
      "192.168.255.255",
      // 100.64.0.0/10, CGNAT
      "100.64.0.0",
      "100.100.100.100",
      "100.127.255.255",
    ]) {
      expect({
        address: address,
        queryable: isNetbiosQueryableIPv4Address(address),
      }).toEqual({ address: address, queryable: true });
    }
  });

  it("refuses the address just outside each edge, and the special ranges", () => {
    for (const address of [
      "9.255.255.255",
      "11.0.0.0",
      "172.15.255.255",
      "172.32.0.0",
      "192.167.255.255",
      "192.169.0.0",
      "100.63.255.255",
      "100.128.0.0",
      // Public, documentation, loopback, link-local, broadcast, multicast.
      "8.8.8.8",
      "203.0.113.7",
      "198.51.100.1",
      "127.0.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "255.255.255.255",
      "224.0.0.251",
    ]) {
      expect({
        address: address,
        queryable: isNetbiosQueryableIPv4Address(address),
      }).toEqual({ address: address, queryable: false });
    }
  });

  it("draws the 172.16/12 edge between 15 and 16, and between 31 and 32", () => {
    expect(isNetbiosQueryableIPv4Address("172.15.0.1")).toBe(false);
    expect(isNetbiosQueryableIPv4Address("172.16.0.1")).toBe(true);
    expect(isNetbiosQueryableIPv4Address("172.31.0.1")).toBe(true);
    expect(isNetbiosQueryableIPv4Address("172.32.0.1")).toBe(false);
  });

  it("draws the 100.64/10 edge between 63 and 64, and between 127 and 128", () => {
    expect(isNetbiosQueryableIPv4Address("100.63.0.1")).toBe(false);
    expect(isNetbiosQueryableIPv4Address("100.64.0.1")).toBe(true);
    expect(isNetbiosQueryableIPv4Address("100.127.0.1")).toBe(true);
    expect(isNetbiosQueryableIPv4Address("100.128.0.1")).toBe(false);
  });

  it("accepts exactly the second octets each first octet allows", () => {
    /*
     * Every second octet under the four first octets that have a range, and
     * under the neighbours of each. The last two octets never matter, since
     * no range is narrower than a /16, so each is tried at both ends.
     */
    const range: (start: number, count: number) => Array<number> = (
      start: number,
      count: number,
    ): Array<number> => {
      return Array.from({ length: count }, (_value: unknown, index: number) => {
        return start + index;
      });
    };
    const expected: Array<[number, Array<number>]> = [
      [9, []],
      [10, range(0, 256)],
      [11, []],
      [99, []],
      [100, range(64, 64)],
      [101, []],
      [171, []],
      [172, range(16, 16)],
      [173, []],
      [191, []],
      [192, [168]],
      [193, []],
    ];

    for (const [first, secondOctets] of expected) {
      const accepted: Set<number> = new Set<number>();

      for (let second: number = 0; second <= 255; second++) {
        for (const tail of ["0.0", "0.1", "255.254", "255.255"]) {
          if (isNetbiosQueryableIPv4Address(`${first}.${second}.${tail}`)) {
            accepted.add(second);
          }
        }
      }

      expect({ first: first, accepted: Array.from(accepted) }).toEqual({
        first: first,
        accepted: secondOctets,
      });
    }
  });

  it("refuses leading zeros, which the probe's net.isIPv4 refuses", () => {
    /*
     * "010" is octal to some parsers and ten to others. The sweep never
     * reports one, and the probe would refuse it, so the dialog must too.
     */
    for (const value of [
      "010.0.0.1",
      "10.00.0.1",
      "10.0.00.1",
      "10.0.0.01",
      "10.0.0.00",
      "0172.16.0.1",
      "172.016.0.1",
      "192.168.001.1",
      "100.064.0.1",
      "00.0.0.0",
    ]) {
      expect({
        value: value,
        queryable: isNetbiosQueryableIPv4Address(value),
      }).toEqual({ value: value, queryable: false });
    }
  });

  it("refuses surrounding or inner whitespace, rather than trimming it", () => {
    for (const value of [
      " 10.0.0.1",
      "10.0.0.1 ",
      "\t10.0.0.1",
      "10.0.0.1\n",
      "10.0.0.1\r\n",
      "10. 0.0.1",
      "10.0.0.1\u00a0",
      "\u200b10.0.0.1",
      "\ufeff10.0.0.1",
      "10.0.0.1\u0000",
    ]) {
      expect({
        value: value,
        queryable: isNetbiosQueryableIPv4Address(value),
      }).toEqual({ value: value, queryable: false });
    }
  });

  it("refuses everything else that is not a strict dotted quad", () => {
    for (const value of [
      "",
      ".",
      "...",
      "10.0.0",
      "10.0.0.0.1",
      "10.0.0.1.",
      ".10.0.0.1",
      "10..0.1",
      "10.0.0.256",
      "10.0.0.999",
      "10.0.0.1000",
      "10.0.0.-1",
      "+10.0.0.1",
      "0x0a.0.0.1",
      "1e1.0.0.1",
      "10.0.0.1/8",
      "10.0.0.1:137",
      "::ffff:10.0.0.1",
      "::ffff:a00:1",
      "fd00::1",
      "fe80::1",
      "2001:db8::5",
      "::1",
      "10.0.0.a",
      "host.corp.example.com",
      // Full-width and Arabic-Indic digits: digits, but not ASCII ones.
      "\uff11\uff10.0.0.1",
      "\u0661\u0660.0.0.1",
    ]) {
      expect({
        value: value,
        queryable: isNetbiosQueryableIPv4Address(value),
      }).toEqual({ value: value, queryable: false });
    }
  });

  it("refuses anything that is not a string, even one that stringifies to an address", () => {
    /*
     * The dialog reads the address out of jsonb. An array or an object with
     * a toString would pass a check that coerced first; the probe checks the
     * type, so this does too.
     */
    for (const value of [
      undefined,
      null,
      167772161,
      Number.NaN,
      true,
      ["10.0.0.1"],
      {
        toString: (): string => {
          return "10.0.0.1";
        },
      },
    ]) {
      expect(isNetbiosQueryableIPv4Address(value)).toBe(false);
    }
  });

  it("answers a very long input without throwing", () => {
    expect(isNetbiosQueryableIPv4Address(`${"1".repeat(100000)}.0.0.1`)).toBe(
      false,
    );
    expect(isNetbiosQueryableIPv4Address("10.".repeat(100000))).toBe(false);
  });
});
