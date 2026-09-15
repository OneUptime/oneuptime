import getShortHostnameDefault, {
  getShortHostname,
} from "../../../Utils/NetworkDiscovery/ShortHostnameUtil";
import {
  MAX_REVERSE_DNS_LABEL_LENGTH,
  MAX_REVERSE_DNS_NAME_LENGTH,
  normalizeReverseDnsName,
} from "../../../Utils/NetworkDiscovery/ReverseDnsNameUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * getShortHostname is the ONE definition of "short name" behind OneUptime
 * issue #3678: the discovery scan setting that names new imports, the Review
 * dialog that previews those names, and the bulk action that renames devices
 * imported before the setting existed all call it. So what is pinned here is
 * not a string helper's convenience behaviour — it is the rule that decides
 * which of an operator's devices get renamed, and every case below is one
 * where a looser or stricter rule would rename the wrong device or refuse the
 * right one.
 *
 * The contract, in the order the tests take it:
 *
 *   - The customer's case comes out as the customer asked:
 *     "wb-0660-kds01.wbhq.com" -> "wb-0660-kds01".
 *   - A value that is not a DNS name has no short form (undefined), whatever
 *     type it arrives as.
 *   - A dotted value that merely PASSES as a DNS name is not shortened when
 *     shortening would mangle it: an OS version string ("ubuntu-22.04") or an
 *     address spelled with dashes ("10-18-167-31.dhcp.corp.com").
 *   - The answer is always the input's own first label, byte for byte — never
 *     a re-cased, re-spelled or invented string.
 *
 * Undefined rather than the value unchanged is itself part of the contract:
 * the bulk action uses it to tell "already short" from "shortened", and a
 * caller that wants a display name writes `getShortHostname(x) || x`.
 */

describe("getShortHostname", () => {
  describe("the customer's case (issue #3678)", () => {
    test("drops the corporate domain from a reverse-DNS name", () => {
      expect(getShortHostname("wb-0660-kds01.wbhq.com")).toBe("wb-0660-kds01");
    });

    /*
     * The estate in the issue has hundreds of these, all under one domain,
     * and the point of the feature is that they all come out the same way.
     */
    test("shortens every host of the estate the same way", () => {
      expect(
        [
          "wb-0660-kds01.wbhq.com",
          "wb-0660-kds02.wbhq.com",
          "wb-0661-pos01.wbhq.com",
        ].map((name: string): string | undefined => {
          return getShortHostname(name);
        }),
      ).toEqual(["wb-0660-kds01", "wb-0660-kds02", "wb-0661-pos01"]);
    });

    test("takes only the first label of a deep name, not everything but the last", () => {
      /*
       * First label, not "strip the TLD" and not "strip the registrable
       * domain": a suffix-based rule would leave "kds01.store-0660" here, and
       * the operator asked for the hostname.
       */
      expect(getShortHostname("kds01.store-0660.east.wbhq.com")).toBe("kds01");
    });

    test("is the module's default export as well as a named one", () => {
      expect(getShortHostnameDefault).toBe(getShortHostname);
    });
  });

  describe("spelling of the input", () => {
    /*
     * Resolvers disagree on whether they include the root label, so the same
     * host can arrive either way. Both must shorten identically, or a device
     * imported from one probe version and renamed on another would disagree
     * with itself.
     */
    test("ignores a single trailing root dot", () => {
      expect(getShortHostname("wb-0660-kds01.wbhq.com.")).toBe("wb-0660-kds01");
    });

    test("refuses a doubled trailing dot rather than repairing it", () => {
      expect(getShortHostname("wb-0660-kds01.wbhq.com..")).toBeUndefined();
    });

    /*
     * Case is the operator's (or the reverse zone author's), and DNS being
     * case-insensitive is not a reason to rewrite it. A lower-casing rule
     * would rename "WB-0660-KDS01.WBHQ.COM" to a name nobody chose.
     */
    test("preserves the case of the first label", () => {
      expect(getShortHostname("WB-0660-KDS01.WBHQ.COM")).toBe("WB-0660-KDS01");
      expect(getShortHostname("Core-SW-01.Corp.Example.com")).toBe(
        "Core-SW-01",
      );
    });

    test("trims surrounding whitespace before deciding", () => {
      expect(getShortHostname("  wb-0660-kds01.wbhq.com  ")).toBe(
        "wb-0660-kds01",
      );
      expect(getShortHostname("\twb-0660-kds01.wbhq.com\n")).toBe(
        "wb-0660-kds01",
      );
    });

    /*
     * Underscore is not legal in a hostname but is common in Windows / DHCP
     * registered names, and ReverseDnsNameUtil deliberately accepts it. The
     * short form follows the same rule rather than a second, stricter one.
     */
    test("keeps an underscore in the first label", () => {
      expect(getShortHostname("pos_register_01.store.example.com")).toBe(
        "pos_register_01",
      );
    });

    test("keeps digits in a first label that also has a letter", () => {
      expect(getShortHostname("10a.corp.example.com")).toBe("10a");
      expect(getShortHostname("r2d2.corp.example.com")).toBe("r2d2");
    });
  });

  describe("values with no short form", () => {
    /*
     * Already as short as it gets. Undefined — not the value back — so the
     * bulk action can skip the device honestly instead of "renaming" it to
     * its own name.
     */
    test("a single label", () => {
      expect(getShortHostname("wb-0660-kds01")).toBeUndefined();
      expect(getShortHostname("core-switch")).toBeUndefined();
      expect(getShortHostname("localhost")).toBeUndefined();
    });

    test("a single label with a root dot is still a single label", () => {
      expect(getShortHostname("core-switch.")).toBeUndefined();
    });

    /*
     * An address has no domain to remove. Shortening "10.18.167.31" to "10"
     * would name a device after an octet.
     */
    test("an IPv4 literal", () => {
      expect(getShortHostname("10.18.167.31")).toBeUndefined();
      expect(getShortHostname("255.255.255.255")).toBeUndefined();
      expect(getShortHostname("10.18.167.31.")).toBeUndefined();
    });

    test("an IPv6 literal", () => {
      expect(getShortHostname("2001:db8::1")).toBeUndefined();
      expect(
        getShortHostname("2001:0db8:85a3:0000:0000:8a2e:0370:7334"),
      ).toBeUndefined();
      expect(getShortHostname("::1")).toBeUndefined();
      expect(getShortHostname("fe80::1%eth0")).toBeUndefined();
    });

    /*
     * A resolver that echoes the query name back hands over one of these, and
     * "31" or "1" would be a worse name than the address it came from.
     */
    test("a reverse-lookup zone name, in-addr.arpa or ip6.arpa", () => {
      expect(getShortHostname("31.167.18.10.in-addr.arpa")).toBeUndefined();
      expect(getShortHostname("31.167.18.10.IN-ADDR.ARPA.")).toBeUndefined();
      expect(getShortHostname("in-addr.arpa")).toBeUndefined();
      expect(
        getShortHostname(
          "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa",
        ),
      ).toBeUndefined();
      expect(getShortHostname("ip6.arpa")).toBeUndefined();
    });

    /*
     * THE LETTER RULE. A first label with no letter in it is an address, or a
     * fragment of one, spelled as a label. The DHCP-style name is the one that
     * matters: a wildcard reverse zone names every host in a pool
     * "10-18-167-31.dhcp.corp.com", and shortening it would dress an address
     * up as a hostname — exactly what the reverse-DNS feature refuses to do.
     */
    test("a first label without a letter", () => {
      expect(getShortHostname("51.corp.example")).toBeUndefined();
      expect(getShortHostname("10-18-167-31.dhcp.corp.com")).toBeUndefined();
      expect(getShortHostname("0660.wbhq.com")).toBeUndefined();
      expect(getShortHostname("_-_.corp.example.com")).toBeUndefined();
    });

    /*
     * THE TOP-LEVEL RULE. "ubuntu-22.04" is a legal label sequence and a very
     * common sysName; cutting it at the dot would rename a server "ubuntu-22".
     * A real top-level domain is letters only (or IDNA), so a last label with
     * a digit in it means the dot was never a domain separator.
     */
    test("a last label that is not letters only", () => {
      expect(getShortHostname("ubuntu-22.04")).toBeUndefined();
      expect(getShortHostname("a.b.v2")).toBeUndefined();
      expect(getShortHostname("RouterOS-7.12")).toBeUndefined();
      expect(getShortHostname("kds01.wbhq.c0m")).toBeUndefined();
      expect(getShortHostname("kds01.wbhq.co_uk")).toBeUndefined();
      expect(getShortHostname("kds01.wbhq.co-uk")).toBeUndefined();
    });

    // ...and it is the whole last label that is tested, not its first letter.
    test("a last label that merely starts with letters", () => {
      expect(getShortHostname("host.example.com1")).toBeUndefined();
    });

    /*
     * Anything ReverseDnsNameUtil refuses is not a hostname, so it has no
     * short form. These are the values the bulk action meets on hand-named
     * devices — "Core Switch 1.5" — and they must be left exactly alone.
     */
    test("a name with markup, spaces, non-ASCII or control characters", () => {
      expect(getShortHostname("<script>alert(1)</script>.com")).toBeUndefined();
      expect(getShortHostname("<b>kds01</b>.wbhq.com")).toBeUndefined();
      expect(getShortHostname("Core Switch 1.5")).toBeUndefined();
      expect(getShortHostname("core switch.corp.example.com")).toBeUndefined();
      expect(getShortHostname("kds01.wbhq.com (10.0.0.5)")).toBeUndefined();
      expect(getShortHostname("café.example.com")).toBeUndefined();
      expect(getShortHostname("kds01.wbhq.cöm")).toBeUndefined();
      expect(getShortHostname("kds01 .wbhq.com")).toBeUndefined();
      expect(getShortHostname("kds01.wbhq.com")).toBeUndefined();
      expect(getShortHostname("kds01.wb​hq.com")).toBeUndefined();
      expect(getShortHostname("kds01/.wbhq.com")).toBeUndefined();
      expect(getShortHostname('"kds01".wbhq.com')).toBeUndefined();
    });

    test("a malformed label sequence", () => {
      expect(getShortHostname(".wbhq.com")).toBeUndefined();
      expect(getShortHostname("kds01..wbhq.com")).toBeUndefined();
      expect(getShortHostname("-kds01.wbhq.com")).toBeUndefined();
      expect(getShortHostname("kds01-.wbhq.com")).toBeUndefined();
      expect(getShortHostname(".")).toBeUndefined();
    });

    test("an empty or blank string", () => {
      expect(getShortHostname("")).toBeUndefined();
      expect(getShortHostname("   ")).toBeUndefined();
      expect(getShortHostname("\n\t")).toBeUndefined();
    });

    /*
     * Names reach this function out of jsonb and API rows, and the Review
     * dialog calls it during render. A throw here unmounts the dialog, so
     * every wrong type must come back undefined — and none may be COERCED:
     * `["kds01.wbhq.com"].toString()` is a perfectly shortenable string.
     */
    test("a value that is not a string at all", () => {
      const notStrings: Array<unknown> = [
        42,
        4.2,
        Number.NaN,
        true,
        false,
        null,
        undefined,
        {},
        { name: "kds01.wbhq.com" },
        ["kds01.wbhq.com"],
        [],
        Symbol("kds01.wbhq.com"),
        (): string => {
          return "kds01.wbhq.com";
        },
        {
          toString: (): string => {
            return "kds01.wbhq.com";
          },
        },
      ];

      for (const value of notStrings) {
        expect(() => {
          return getShortHostname(value);
        }).not.toThrow();
        expect(getShortHostname(value)).toBeUndefined();
      }
    });
  });

  describe("internationalised top-level domains", () => {
    /*
     * An IDNA top-level domain arrives in its ASCII "xn--" form, which has
     * digits and hyphens in it and would otherwise fail the letters-only
     * rule. Refusing it would make short names silently do nothing for every
     * estate under a non-Latin TLD.
     */
    test("an xn-- last label is accepted", () => {
      expect(getShortHostname("kds01.example.xn--p1ai")).toBe("kds01");
      expect(getShortHostname("kds01.example.xn--fiqs8s")).toBe("kds01");
    });

    test("an xn-- first label is still a first label with letters", () => {
      expect(getShortHostname("xn--bcher-kva.example.com")).toBe(
        "xn--bcher-kva",
      );
    });

    /*
     * Case is not part of the ACE prefix: DNS is case-insensitive and some
     * zones are authored in upper case, so "XN--P1AI" is the same top-level
     * domain as "xn--p1ai" and must shorten the same way.
     */
    test("an upper-case XN-- last label is accepted too", () => {
      expect(getShortHostname("KDS01.EXAMPLE.XN--P1AI")).toBe("KDS01");
      expect(getShortHostname("kds01.example.Xn--p1ai")).toBe("kds01");
    });

    test("a last label that only looks like xn-- is not", () => {
      expect(getShortHostname("kds01.example.xn-p1ai")).toBeUndefined();
      expect(getShortHostname("kds01.example.x--p1ai")).toBeUndefined();
    });
  });

  describe("length ceilings", () => {
    /*
     * RFC 1035's 63-octet label is the longest first label there can be, and
     * the planner relies on it: a first label always survives the 80-character
     * device-name clamp intact.
     */
    test("a 63-character first label is returned whole", () => {
      const label: string = `a${"b".repeat(61)}c`;

      expect(label).toHaveLength(MAX_REVERSE_DNS_LABEL_LENGTH);
      expect(getShortHostname(`${label}.corp.example.com`)).toBe(label);
    });

    test("a 64-character first label is not a DNS label, so has no short form", () => {
      expect(
        getShortHostname(`${"a".repeat(64)}.corp.example.com`),
      ).toBeUndefined();
    });

    // 63 + 1 + 63 + 1 + 63 + 1 + 61 = 253: the longest presentation-form name.
    const MAXIMAL_NAME: string = `${"a".repeat(63)}.${"b".repeat(
      63,
    )}.${"c".repeat(63)}.${"d".repeat(61)}`;

    test("a 253-character name is accepted", () => {
      expect(MAXIMAL_NAME).toHaveLength(MAX_REVERSE_DNS_NAME_LENGTH);
      expect(getShortHostname(MAXIMAL_NAME)).toBe("a".repeat(63));
    });

    test("a 253-character name with its root dot is still accepted", () => {
      expect(getShortHostname(`${MAXIMAL_NAME}.`)).toBe("a".repeat(63));
    });

    test("a 254-character name was never a DNS name, so has no short form", () => {
      const tooLong: string = `${MAXIMAL_NAME.substring(
        0,
        MAXIMAL_NAME.length - 1,
      )}dd`;

      expect(tooLong).toHaveLength(MAX_REVERSE_DNS_NAME_LENGTH + 1);
      // Anti-vacuity: every label is still legal, only the total offends.
      expect(tooLong.split(".").length).toBe(4);
      expect(getShortHostname(tooLong)).toBeUndefined();
    });
  });

  describe("idempotence", () => {
    /*
     * A short name has no short name: it is a single label. That is what
     * makes the bulk action safe to run twice over the same selection — the
     * second run skips every device the first one renamed.
     */
    test("the short form of a short form is undefined", () => {
      const once: string | undefined = getShortHostname(
        "wb-0660-kds01.wbhq.com",
      );

      expect(once).toBe("wb-0660-kds01");
      expect(getShortHostname(once)).toBeUndefined();
    });

    /*
     * The display pattern every caller uses. Applying it twice must be the
     * same as applying it once, or a name re-rendered by the Review dialog
     * could differ from the one it imported under.
     */
    test("`getShortHostname(x) || x` is a fixed point", () => {
      const display: (value: string) => string = (value: string): string => {
        return getShortHostname(value) || value;
      };

      for (const value of [
        "wb-0660-kds01.wbhq.com",
        "wb-0660-kds01",
        "ubuntu-22.04",
        "10.18.167.31",
        "Core Switch",
        "10-18-167-31.dhcp.corp.com",
      ]) {
        expect(display(display(value))).toBe(display(value));
      }
    });
  });

  /*
   * PROPERTIES over a large generated population, so the rule is tested
   * beyond the spellings someone thought to write down.
   *
   * The generator is seeded, so a failure reproduces exactly. It mixes
   * letter-only, alphanumeric, numeric and junk labels in one to four label
   * names, with optional padding and root dots, so that every branch of the
   * rule is taken many times — which the anti-vacuity counts at the end
   * prove.
   */
  describe("properties over generated names", () => {
    type RandomFunction = () => number;

    // mulberry32: small, fast, and deterministic across platforms.
    function seededRandom(seed: number): RandomFunction {
      let state: number = seed >>> 0;

      return (): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t: number = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function pick(random: RandomFunction, characters: string): string {
      return characters.charAt(Math.floor(random() * characters.length));
    }

    function word(
      random: RandomFunction,
      characters: string,
      maxLength: number,
    ): string {
      const length: number = 1 + Math.floor(random() * maxLength);
      let result: string = "";

      for (let index: number = 0; index < length; index++) {
        result += pick(random, characters);
      }

      return result;
    }

    const LETTERS: string =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const DIGITS: string = "0123456789";
    const INNER: string = `${LETTERS}${DIGITS}-_`;
    const JUNK: string = " <>\"'/\\:;()[]{}é ​";

    function label(random: RandomFunction): string {
      const kind: number = random();

      if (kind < 0.35) {
        return word(random, LETTERS, 10);
      }

      if (kind < 0.7) {
        // A hostname-shaped label: alphanumeric ends, hyphens inside.
        const ends: string = `${LETTERS}${DIGITS}`;
        return `${pick(random, ends)}${
          random() < 0.7 ? word(random, INNER, 12) : ""
        }${pick(random, ends)}`;
      }

      if (kind < 0.88) {
        return word(random, DIGITS, 4);
      }

      if (kind < 0.94) {
        return `xn--${word(random, `${LETTERS}${DIGITS}`, 8)}`;
      }

      return `${word(random, LETTERS, 4)}${pick(random, JUNK)}${word(
        random,
        LETTERS,
        4,
      )}`;
    }

    function generatedName(random: RandomFunction): string {
      const labelCount: number = 1 + Math.floor(random() * 4);
      const labels: Array<string> = [];

      for (let index: number = 0; index < labelCount; index++) {
        labels.push(label(random));
      }

      let name: string = labels.join(".");

      if (random() < 0.15) {
        name = `${name}.`;
      }

      if (random() < 0.15) {
        name = `  ${name} `;
      }

      return name;
    }

    const random: RandomFunction = seededRandom(3678);

    const NAMES: Array<string> = [];

    for (let index: number = 0; index < 5000; index++) {
      NAMES.push(generatedName(random));
    }

    const SAFE_OUTPUT: RegExp = /^[A-Za-z0-9_-]+$/;
    const HAS_LETTER: RegExp = /[A-Za-z]/;
    const TOP_LEVEL_LABEL: RegExp = /^(?:[A-Za-z]+|[Xx][Nn]--[A-Za-z0-9-]+)$/;

    test("every short name is made only of hostname characters and has a letter", () => {
      for (const name of NAMES) {
        const short: string | undefined = getShortHostname(name);

        if (short === undefined) {
          continue;
        }

        expect(short).toMatch(SAFE_OUTPUT);
        expect(short).toMatch(HAS_LETTER);
        expect(short.length).toBeLessThanOrEqual(MAX_REVERSE_DNS_LABEL_LENGTH);
      }
    });

    /*
     * The answer is the input's own text up to its first dot — never a
     * re-spelling. This is what lets the bulk action promise "old -> new"
     * examples in its confirm dialog that are literally prefixes of the
     * current names.
     */
    test("every short name is exactly the input up to its first dot", () => {
      for (const name of NAMES) {
        const short: string | undefined = getShortHostname(name);

        if (short === undefined) {
          continue;
        }

        const trimmed: string = name.trim();

        expect(trimmed.startsWith(`${short}.`)).toBe(true);
        expect(trimmed.split(".")[0]).toBe(short);
      }
    });

    /*
     * Shortening never ACCEPTS what reverse-DNS normalisation refuses: the
     * short-name rule is strictly narrower, so it cannot be a way around the
     * untrusted-name checks.
     */
    test("a name normalisation refuses never has a short form", () => {
      for (const name of NAMES) {
        if (normalizeReverseDnsName(name) === undefined) {
          expect(getShortHostname(name)).toBeUndefined();
        }
      }
    });

    test("a short name is never itself shortenable", () => {
      for (const name of NAMES) {
        const short: string | undefined = getShortHostname(name);

        if (short !== undefined) {
          expect(getShortHostname(short)).toBeUndefined();
        }
      }
    });

    /*
     * Anti-vacuity. Each property above skips half the population, so prove
     * the population really does contain plenty of both halves — and plenty
     * of the specific rejections (numeric first label, non-letter top-level
     * label) the rule exists for.
     */
    test("the generated population exercises every branch many times", () => {
      let shortened: number = 0;
      let refusedByNormalisation: number = 0;
      let refusedAsSingleLabel: number = 0;
      let refusedByTopLevelRule: number = 0;
      let refusedByLetterRule: number = 0;

      for (const name of NAMES) {
        const normalized: string | undefined = normalizeReverseDnsName(name);

        if (getShortHostname(name) !== undefined) {
          shortened++;
          continue;
        }

        if (normalized === undefined) {
          refusedByNormalisation++;
          continue;
        }

        const labels: Array<string> = normalized.split(".");

        if (labels.length < 2) {
          refusedAsSingleLabel++;
        } else if (!TOP_LEVEL_LABEL.test(labels[labels.length - 1]!)) {
          refusedByTopLevelRule++;
        } else {
          refusedByLetterRule++;
        }
      }

      expect(shortened).toBeGreaterThan(500);
      expect(refusedByNormalisation).toBeGreaterThan(200);
      expect(refusedAsSingleLabel).toBeGreaterThan(200);
      expect(refusedByTopLevelRule).toBeGreaterThan(200);
      expect(refusedByLetterRule).toBeGreaterThan(100);
    });
  });
});
