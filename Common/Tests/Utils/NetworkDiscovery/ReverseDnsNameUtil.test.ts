import {
  MAX_REVERSE_DNS_LABEL_LENGTH,
  MAX_REVERSE_DNS_NAME_LENGTH,
  normalizeReverseDnsName,
} from "../../../Utils/NetworkDiscovery/ReverseDnsNameUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * OneUptime issue #3529 — discovery results should carry the reverse-DNS name
 * of each host, not just its address.
 *
 * This is the gate on the ONE field in a scan result whose value is chosen by
 * the scanned network rather than by OneUptime or by the operator. A PTR
 * record is published by whoever runs DNS for the subnet being swept, and a
 * discovery scan is routinely pointed at a subnet this project does not
 * administer — so what comes back is untrusted input that goes on to become a
 * rendered line in the Review dialog, a NetworkDevice's name, and that
 * device's slug.
 *
 * The suite therefore has two halves that pull in opposite directions, and
 * both matter:
 *
 *   - Real names must survive. A rule that is too strict silently drops the
 *     very names the issue asked for, and does it invisibly: the operator
 *     sees the address they always saw and has no way to tell "no PTR record"
 *     from "we threw your PTR record away". Underscores, single labels,
 *     dashes-with-digits and long FQDNs are all real, and all pass.
 *   - Everything that is not a hostname must not. Whitespace, quotes, angle
 *     brackets, control characters, non-ASCII and over-length values are what
 *     a hostile or broken reverse zone answers with, and they must never
 *     reach a name column.
 */

describe("normalizeReverseDnsName — names that must survive", () => {
  it("accepts an ordinary FQDN", () => {
    expect(normalizeReverseDnsName("core-switch-01.corp.example.com")).toBe(
      "core-switch-01.corp.example.com",
    );
  });

  it("accepts a single-label name", () => {
    /*
     * Flat internal zones and small networks publish bare names, and
     * "printer-3" is a strictly better answer for the Review dialog than
     * 10.18.166.51. Rejecting single labels would throw those away.
     */
    expect(normalizeReverseDnsName("printer-3")).toBe("printer-3");
  });

  it("accepts underscores, which are illegal in a hostname but common in the wild", () => {
    /*
     * Windows/DHCP-registered names and hand-authored reverse zones use them
     * constantly. The rule here is "is this safe to store and render", not
     * "does this satisfy RFC 952".
     */
    expect(normalizeReverseDnsName("ws_finance_12.corp.example.com")).toBe(
      "ws_finance_12.corp.example.com",
    );
  });

  it("accepts a generated name built out of the address's octets", () => {
    /*
     * NOT all-numeric — the octets are joined by dashes into one label — so
     * this is a real name that happens to encode the address, and it carries
     * the zone it lives in. It is more useful than the bare address.
     */
    expect(normalizeReverseDnsName("10-18-166-51.dhcp.corp.example.com")).toBe(
      "10-18-166-51.dhcp.corp.example.com",
    );
  });

  it("strips exactly one trailing root dot", () => {
    expect(normalizeReverseDnsName("host.example.com.")).toBe(
      "host.example.com",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeReverseDnsName("  host.example.com  ")).toBe(
      "host.example.com",
    );
  });

  it("preserves case as the reverse zone authored it", () => {
    /*
     * DNS is case-insensitive, which is a reason not to COMPARE on case — not
     * a reason to discard it. "SW-Core-01" is how somebody wrote it down, and
     * that is as close to operator intent as this data gets.
     */
    expect(normalizeReverseDnsName("SW-Core-01.Corp.Example.COM")).toBe(
      "SW-Core-01.Corp.Example.COM",
    );
  });

  it("accepts a label of exactly the maximum length", () => {
    const label: string = "a".repeat(MAX_REVERSE_DNS_LABEL_LENGTH);
    expect(normalizeReverseDnsName(`${label}.example.com`)).toBe(
      `${label}.example.com`,
    );
  });

  it("accepts a name of exactly the maximum length", () => {
    /*
     * Built out of 63-character labels so the LABEL rule cannot be what
     * decides this case: 3 * 63 + 3 separators + 61 = 253.
     */
    const label: string = "a".repeat(MAX_REVERSE_DNS_LABEL_LENGTH);
    const name: string = `${label}.${label}.${label}.${"b".repeat(61)}`;
    expect(name).toHaveLength(MAX_REVERSE_DNS_NAME_LENGTH);
    expect(normalizeReverseDnsName(name)).toBe(name);
  });

  it("accepts a name whose trailing dot is what pushes it over the limit", () => {
    /*
     * The root label is not part of the name, so a 253-character name written
     * fully qualified is 254 characters of input and must still be accepted.
     * Measuring before stripping would reject it.
     */
    const label: string = "a".repeat(MAX_REVERSE_DNS_LABEL_LENGTH);
    const name: string = `${label}.${label}.${label}.${"b".repeat(61)}`;
    expect(normalizeReverseDnsName(`${name}.`)).toBe(name);
  });
});

describe("normalizeReverseDnsName — answers that restate the address", () => {
  /*
   * The entire premise of the feature is that a name tells the operator more
   * than an address does. A "name" that IS the address is not a name — and
   * worse, presenting it as one asserts a resolved hostname that nobody
   * published. These must fall through so the caller uses the address it
   * already had.
   */

  it("rejects a dotted-quad", () => {
    expect(normalizeReverseDnsName("10.18.166.51")).toBeUndefined();
  });

  it("rejects a single numeric label", () => {
    expect(normalizeReverseDnsName("51")).toBeUndefined();
  });

  it("rejects a partially numeric answer with no alphabetic label", () => {
    expect(normalizeReverseDnsName("10.18")).toBeUndefined();
  });

  it("rejects an in-addr.arpa query name echoed back", () => {
    /*
     * Some resolvers hand the query name back on certain failures. It passes
     * every character rule and is a strictly worse label than the address it
     * was derived from.
     */
    expect(
      normalizeReverseDnsName("51.166.18.10.in-addr.arpa"),
    ).toBeUndefined();
    expect(
      normalizeReverseDnsName("51.166.18.10.IN-ADDR.ARPA."),
    ).toBeUndefined();
  });

  it("rejects an ip6.arpa query name echoed back", () => {
    expect(
      normalizeReverseDnsName(
        "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa",
      ),
    ).toBeUndefined();
  });

  it("keeps a real name that merely CONTAINS arpa", () => {
    // The suffix rule must be a suffix rule, not a substring rule.
    expect(normalizeReverseDnsName("arpa-gw.example.com")).toBe(
      "arpa-gw.example.com",
    );
    expect(normalizeReverseDnsName("in-addr.arpa.example.com")).toBe(
      "in-addr.arpa.example.com",
    );
  });
});

describe("normalizeReverseDnsName — values that are not names at all", () => {
  it("rejects empty and whitespace-only input", () => {
    expect(normalizeReverseDnsName("")).toBeUndefined();
    expect(normalizeReverseDnsName("   ")).toBeUndefined();
    expect(normalizeReverseDnsName("\t\n")).toBeUndefined();
  });

  it("rejects a bare root label", () => {
    expect(normalizeReverseDnsName(".")).toBeUndefined();
  });

  it("rejects empty labels", () => {
    /*
     * Only ONE trailing dot is the root label. A second leaves an empty final
     * label, which is malformed rather than a typo to repair — inventing the
     * repair would be inventing a name.
     */
    expect(normalizeReverseDnsName("host.example.com..")).toBeUndefined();
    expect(normalizeReverseDnsName("host..example.com")).toBeUndefined();
    expect(normalizeReverseDnsName(".host.example.com")).toBeUndefined();
  });

  it("rejects a leading or trailing hyphen in a label", () => {
    expect(normalizeReverseDnsName("-host.example.com")).toBeUndefined();
    expect(normalizeReverseDnsName("host-.example.com")).toBeUndefined();
  });

  it("rejects whitespace inside the name", () => {
    /*
     * " " is truthy, and a name with a space in it renders as a plausible
     * device name and slugifies into something else entirely. This is the
     * same class of bug normalizeDiscoveredHosts fixed for ipAddress.
     */
    expect(normalizeReverseDnsName("core switch.example.com")).toBeUndefined();
    expect(normalizeReverseDnsName("host.example .com")).toBeUndefined();
  });

  it("rejects markup, quotes and path characters", () => {
    /*
     * React escapes on render, so this is not an XSS test — it is a "this was
     * never a hostname" test. A reverse zone that answers with any of these
     * is broken or hostile, and either way the address is the better answer.
     */
    const hostile: Array<string> = [
      "<script>alert(1)</script>",
      '"><img src=x onerror=alert(1)>',
      "host.example.com/../../etc/passwd",
      "host.example.com:8080",
      "host@example.com",
      "host;rm -rf /",
      "host,example,com",
      "host\\example",
      "host%00.example.com",
      "host|example.com",
      "$(whoami).example.com",
      "{{constructor}}.example.com",
    ];

    for (const value of hostile) {
      expect(normalizeReverseDnsName(value)).toBeUndefined();
    }
  });

  it("rejects control characters, including ones that survive a trim", () => {
    /*
     * trim() removes \n at the ENDS. A newline in the middle would otherwise
     * put a second line into a name column.
     */
    expect(normalizeReverseDnsName("host\n.example.com")).toBeUndefined();
    expect(normalizeReverseDnsName("host.exa mple.com")).toBeUndefined();
    expect(normalizeReverseDnsName("host.example.com")).toBeUndefined();
  });

  it("rejects non-ASCII, including homoglyphs of a legitimate name", () => {
    /*
     * A Cyrillic "с" renders identically to a Latin "c". Punycode
     * ("xn--...") is the encoding a real internationalised name arrives in
     * and is pure ASCII, so this rejects nothing that a resolver would
     * actually answer with.
     */
    expect(normalizeReverseDnsName("сore-switch.example.com")).toBeUndefined();
    expect(normalizeReverseDnsName("hôte.example.com")).toBeUndefined();
    expect(normalizeReverseDnsName("router​.example.com")).toBeUndefined();
    // ...while the punycode form of the same idea is fine.
    expect(normalizeReverseDnsName("xn--hte-snab.example.com")).toBe(
      "xn--hte-snab.example.com",
    );
  });

  it("rejects a label one character over the limit", () => {
    const label: string = "a".repeat(MAX_REVERSE_DNS_LABEL_LENGTH + 1);
    expect(normalizeReverseDnsName(`${label}.example.com`)).toBeUndefined();
  });

  it("rejects a name one character over the limit", () => {
    const label: string = "a".repeat(MAX_REVERSE_DNS_LABEL_LENGTH);
    const name: string = `${label}.${label}.${label}.${"b".repeat(62)}`;
    expect(name).toHaveLength(MAX_REVERSE_DNS_NAME_LENGTH + 1);
    expect(normalizeReverseDnsName(name)).toBeUndefined();
  });

  it("rejects an absurdly long value without depending on the label rule", () => {
    // A single 10,000-character label: caught by the name limit first.
    expect(normalizeReverseDnsName("a".repeat(10000))).toBeUndefined();
  });
});

describe("normalizeReverseDnsName — non-string input", () => {
  /*
   * On the server side the input is read out of a jsonb column, so "the probe
   * sent a number" and "the key is missing" are cases that have to return
   * undefined rather than throw inside a React render. This is the same
   * lesson normalizeDiscoveredHosts learned from a null row in the same
   * column.
   */

  it("returns undefined for nullish input", () => {
    expect(normalizeReverseDnsName(undefined)).toBeUndefined();
    expect(normalizeReverseDnsName(null)).toBeUndefined();
  });

  it("returns undefined rather than coercing a number", () => {
    expect(normalizeReverseDnsName(51)).toBeUndefined();
    expect(normalizeReverseDnsName(0)).toBeUndefined();
    expect(normalizeReverseDnsName(NaN)).toBeUndefined();
  });

  it("returns undefined for booleans, objects and arrays", () => {
    expect(normalizeReverseDnsName(true)).toBeUndefined();
    expect(
      normalizeReverseDnsName({
        toString: () => {
          return "host.example.com";
        },
      }),
    ).toBeUndefined();
    expect(normalizeReverseDnsName(["host.example.com"])).toBeUndefined();
  });
});

describe("normalizeReverseDnsName — idempotence", () => {
  /*
   * The value is normalised on the probe, again by normalizeDiscoveredHosts
   * on the way out of the column, and again by getDiscoveredHostDisplayName
   * at the point of use. Three passes must produce what one pass produced, or
   * the name an operator ticks and the name the device gets could differ.
   */
  it("is stable under repeated application", () => {
    const inputs: Array<string> = [
      "host.example.com.",
      "  SW-Core-01.corp.example.com  ",
      "printer_2",
      "10.18.166.51",
      "<script>",
    ];

    for (const input of inputs) {
      const once: string | undefined = normalizeReverseDnsName(input);
      expect(normalizeReverseDnsName(once)).toBe(once);
    }
  });
});
