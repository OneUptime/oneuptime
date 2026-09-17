import {
  MAX_REVERSE_DNS_LABEL_LENGTH,
  MAX_REVERSE_DNS_NAME_LENGTH,
  normalizeReverseDnsName,
} from "../../../Utils/NetworkDiscovery/ReverseDnsNameUtil";
import Slug from "../../../Utils/Slug";
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
 *     dashes-with-digits, a purely numeric label sitting next to alphabetic
 *     ones, and long FQDNs are all real, and all pass.
 *   - Everything that is not a hostname must not. Whitespace, quotes, angle
 *     brackets, control characters, non-ASCII and over-length values are what
 *     a hostile or broken reverse zone answers with, and they must never
 *     reach a name column.
 *
 * The two rules that are written as a quantifier over labels — "reject when
 * EVERY label is numeric" and "reject when the name ends AT A LABEL BOUNDARY
 * with a reverse-lookup zone" — are the ones where a one-token edit (`every`
 * to `some`, `.${zone}` to `zone`) turns a narrow rejection into a broad one
 * and deletes real names without a single error surfacing anywhere. Those two
 * survive-directions have describe blocks of their own below.
 *
 * Every non-printing and non-ASCII character in this file is written as a
 * \uXXXX escape rather than pasted literally. The whole point of several of
 * these cases is that the character is INVISIBLE — a literal NUL, zero-width
 * joiner or right-to-left override in the source is unreviewable in a diff,
 * survives a careless copy-paste into the source it is meant to guard, and is
 * mangled by tooling that normalises text. The escape is the test.
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
});

describe("normalizeReverseDnsName — a numeric label beside alphabetic ones", () => {
  /*
   * The single most load-bearing acceptance in the file, and the one the rest
   * of the suite could not see.
   *
   * The address-restating rule is "reject when EVERY label is numeric". Its
   * rejection direction is pinned three times over ("10.18.166.51", "51",
   * "10.18"). Its SURVIVE direction — a name that merely CONTAINS an
   * all-digit label — had no case at all, so rewriting
   * `labels.every(isNumeric)` as `labels.some(isNumeric)` left the whole
   * suite green while deleting exactly the names issue #3529 is about: a
   * reverse zone that publishes each host as `<last octet>.<zone>`, so hosts
   * .51, .53, .54 and .55 answer "51.corp.example.com" and friends. Under the
   * `some` mutation every one of those hosts silently loses its name and the
   * operator sees the addresses they always saw, with nothing logged.
   *
   * These cases fail under that mutation and pass under the real rule, which
   * is the whole reason they are here.
   */

  it("accepts a name whose leading label is purely numeric", () => {
    /*
     * The canonical shape from the issue: the PTR for 10.18.166.51 in a zone
     * that names hosts by octet. It is not the address restated — "corp" and
     * "example" and "com" are not digits — so it is a real name and must be
     * kept.
     */
    expect(normalizeReverseDnsName("51.corp.example.com")).toBe(
      "51.corp.example.com",
    );
    expect(normalizeReverseDnsName("10.corp.example.com")).toBe(
      "10.corp.example.com",
    );

    /*
     * "0.pool.ntp.org" is the real-world one: a leading zero, a single digit,
     * and a name millions of hosts genuinely resolve to. If a numeric label
     * anywhere were disqualifying, this would come back undefined.
     */
    expect(normalizeReverseDnsName("0.pool.ntp.org")).toBe("0.pool.ntp.org");
  });

  it("accepts a numeric label in an interior or trailing position", () => {
    /*
     * Position must not matter either — the rule is a quantifier over ALL
     * labels, not an inspection of the first one. A rule written as "reject
     * if the first label is numeric" would pass the case above's mutation
     * test but fail here, so both shapes are pinned.
     */
    expect(normalizeReverseDnsName("gw.51.example.com")).toBe(
      "gw.51.example.com",
    );
    expect(normalizeReverseDnsName("printer.3")).toBe("printer.3");
    expect(normalizeReverseDnsName("a.1")).toBe("a.1");
  });
});

describe("normalizeReverseDnsName — length boundaries", () => {
  /*
   * These are the off-by-one seams in the function, pinned on both sides.
   * Each one is a place where a "<" that should be "<=" either silently
   * discards a legitimate long FQDN (the failure nobody notices, because the
   * dialog just shows the address it always showed) or lets an over-length
   * value through into a varchar column.
   */

  const LABEL_AT_LIMIT: string = "a".repeat(MAX_REVERSE_DNS_LABEL_LENGTH);

  /*
   * 3 * 63 + 3 separators + 61 = 253. Built out of maximum-length labels so
   * the per-label rule cannot be what decides any of the whole-name cases
   * below — only the whole-name limit can. Note that this arithmetic is
   * load-bearing on MAX_REVERSE_DNS_LABEL_LENGTH staying 63: the
   * `toHaveLength` assertions below are what re-derive both constants, so a
   * change to either number turns this block red rather than silently
   * shifting what "at the limit" means.
   */
  const NAME_AT_LIMIT: string = `${LABEL_AT_LIMIT}.${LABEL_AT_LIMIT}.${LABEL_AT_LIMIT}.${"b".repeat(61)}`;

  it("accepts a label of exactly the maximum length and rejects one character more", () => {
    expect(LABEL_AT_LIMIT).toHaveLength(63);
    expect(normalizeReverseDnsName(`${LABEL_AT_LIMIT}.example.com`)).toBe(
      `${LABEL_AT_LIMIT}.example.com`,
    );

    const overLimit: string = "a".repeat(MAX_REVERSE_DNS_LABEL_LENGTH + 1);
    expect(normalizeReverseDnsName(`${overLimit}.example.com`)).toBeUndefined();
  });

  it("accepts a name that is one label of exactly the maximum length", () => {
    /*
     * The label limit and the name limit are different numbers, and a single
     * maximal label exercises both at once: it must be judged by the label
     * rule (63) and pass the name rule (253) without either being applied to
     * the other's value.
     */
    expect(normalizeReverseDnsName(LABEL_AT_LIMIT)).toBe(LABEL_AT_LIMIT);
  });

  it("accepts a name of exactly the maximum length and rejects one character more", () => {
    expect(NAME_AT_LIMIT).toHaveLength(MAX_REVERSE_DNS_NAME_LENGTH);
    expect(normalizeReverseDnsName(NAME_AT_LIMIT)).toBe(NAME_AT_LIMIT);

    const overLimit: string = `${LABEL_AT_LIMIT}.${LABEL_AT_LIMIT}.${LABEL_AT_LIMIT}.${"b".repeat(62)}`;
    expect(overLimit).toHaveLength(MAX_REVERSE_DNS_NAME_LENGTH + 1);
    expect(normalizeReverseDnsName(overLimit)).toBeUndefined();
  });

  it("accepts a name whose trailing dot is what pushes it over the limit", () => {
    /*
     * The root label is not part of the name, so a 253-character name written
     * fully qualified is 254 characters of INPUT and must still be accepted.
     * Measuring before stripping would reject it — and the resolvers that
     * emit fully qualified answers are exactly the well-run ones whose names
     * are worth having.
     */
    expect(`${NAME_AT_LIMIT}.`).toHaveLength(MAX_REVERSE_DNS_NAME_LENGTH + 1);
    expect(normalizeReverseDnsName(`${NAME_AT_LIMIT}.`)).toBe(NAME_AT_LIMIT);
  });

  it("trims before it strips the root label and before it measures", () => {
    /*
     * The two orderings the cases above leave open, pinned in one input.
     * "  <253 chars>.  " is 258 characters of raw input, and it is the answer
     * a well-run resolver's fully qualified reply looks like once it has been
     * through a text field or a log line that padded it.
     *
     * Reasoned against the mutated implementations:
     *   - measure-then-trim: 258 > 253, rejected, name silently lost.
     *   - strip-root-then-trim: the raw value ends in a SPACE, so nothing is
     *     stripped; after trimming, the trailing dot survives into the label
     *     split as an empty final label, and the name is rejected.
     * Only trim -> strip -> measure returns NAME_AT_LIMIT, so this case dies
     * under either reordering.
     *
     * It also pins the returned value byte-for-byte at the maximum length:
     * what comes back is the trimmed, root-stripped INPUT, unmodified and
     * untruncated.
     */
    const padded: string = `  ${NAME_AT_LIMIT}.  `;
    expect(padded).toHaveLength(MAX_REVERSE_DNS_NAME_LENGTH + 5);
    expect(normalizeReverseDnsName(padded)).toBe(NAME_AT_LIMIT);
  });

  it("rejects an absurdly long value made entirely of legal labels", () => {
    /*
     * Ten thousand characters in which EVERY label is a legal two-character
     * label, so the per-label rule has nothing to object to and the whole-name
     * limit is the only thing that can reject it. Delete the
     * MAX_REVERSE_DNS_NAME_LENGTH check and this value is accepted — a
     * ten-thousand-character "hostname" on its way to a varchar(100) column.
     *
     * (Its earlier form, "a".repeat(10000), was a single 10,000-character
     * label and so was rejected by the 63-character label rule first; it
     * could not fail if the name limit were removed, which is the point of
     * building this one out of legal labels instead.)
     */
    const legalLabelsOverLimit: string = "ab.".repeat(3334);
    expect(legalLabelsOverLimit.length).toBeGreaterThan(
      MAX_REVERSE_DNS_NAME_LENGTH,
    );
    expect(normalizeReverseDnsName(legalLabelsOverLimit)).toBeUndefined();
  });
});

describe("normalizeReverseDnsName — answers that restate the address", () => {
  /*
   * The entire premise of the feature is that a name tells the operator more
   * than an address does. A "name" that IS the address is not a name — and
   * worse, presenting it as one asserts a resolved hostname that nobody
   * published. These must fall through so the caller uses the address it
   * already had.
   *
   * The complement — a numeric label that sits BESIDE alphabetic ones and
   * must survive — is its own describe block above; neither half of the rule
   * is safe without the other.
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
});

describe("normalizeReverseDnsName — the reverse zones as an apex", () => {
  /*
   * The suffix rule alone left a hole: a resolver that echoes a TRUNCATED
   * query name, or a zone whose PTR points at the zone apex itself, answers
   * with the bare zone. "in-addr.arpa" is a perfectly well-formed hostname
   * string — right charset, right label lengths, not all-numeric — so
   * everything else in this function waves it through, and the operator gets
   * a fleet of devices all called "in-addr.arpa" instead of their addresses.
   * That is why the check is `lowerCased === zone` as well as `endsWith`.
   */

  it("rejects the bare in-addr.arpa apex", () => {
    expect(normalizeReverseDnsName("in-addr.arpa")).toBeUndefined();
  });

  it("rejects the bare ip6.arpa apex", () => {
    expect(normalizeReverseDnsName("ip6.arpa")).toBeUndefined();
  });

  it("rejects the apex with a trailing root dot, in any case", () => {
    /*
     * Two orderings in one case, because the separate lower-case-with-dot
     * test was fully contained in this one's inputs and pinned nothing extra.
     *
     * Root-dot ordering: the apex comparison runs AFTER the root label is
     * stripped. Reversed, "in-addr.arpa." would match neither the apex (extra
     * dot) nor the suffix (nothing before it) and would sail through.
     *
     * Case ordering: DNS is case-insensitive and resolvers echo whatever case
     * they were handed — 0x20 query randomisation makes mixed case the NORMAL
     * shape of an echoed name, not an exotic one. Comparing the raw string
     * would accept "In-Addr.ARPA"; lower-casing the value but not comparing
     * against a lower-case zone would reject everything.
     */
    expect(normalizeReverseDnsName("in-addr.arpa.")).toBeUndefined();
    expect(normalizeReverseDnsName("ip6.arpa.")).toBeUndefined();
    expect(normalizeReverseDnsName("IN-ADDR.ARPA")).toBeUndefined();
    expect(normalizeReverseDnsName("In-Addr.Arpa")).toBeUndefined();
    expect(normalizeReverseDnsName("iN-aDdR.aRpA.")).toBeUndefined();
    expect(normalizeReverseDnsName("IP6.ARPA")).toBeUndefined();
    expect(normalizeReverseDnsName("Ip6.Arpa.")).toBeUndefined();
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

  it("matches the zone at a label boundary, not as a bare string suffix", () => {
    /*
     * The other half of "it is a suffix rule", and the one the CONTAINS cases
     * above could not see. Every accepted arpa name in this file
     * ("arpa-gw.example.com", "in-addr.arpa.example.com",
     * "gw.arpa.example.com", "something.arpa") ends somewhere OTHER than the
     * zone string, so rewriting `lowerCased.endsWith(`.${zone}`)` as
     * `lowerCased.endsWith(zone)` — dropping one character — survived the
     * entire suite.
     *
     * Under that mutation "notin-addr.arpa" and "voip6.arpa" are rejected:
     * both end with the zone's characters while their final labels are
     * "notin-addr" and "voip6", which are somebody's real hostnames and are
     * nothing to do with a reverse-lookup zone. The dot is what makes the
     * difference between "this name lives IN the zone" and "this name happens
     * to end with those letters", so it is asserted here.
     */
    expect(normalizeReverseDnsName("notin-addr.arpa")).toBe("notin-addr.arpa");
    expect(normalizeReverseDnsName("voip6.arpa")).toBe("voip6.arpa");
    expect(normalizeReverseDnsName("myip6.arpa")).toBe("myip6.arpa");

    /*
     * ...while the genuine label-boundary forms of the same strings stay
     * rejected, so the case above cannot be satisfied by deleting the zone
     * rule outright.
     */
    expect(normalizeReverseDnsName("x.in-addr.arpa")).toBeUndefined();
    expect(normalizeReverseDnsName("x.ip6.arpa")).toBeUndefined();
  });

  it("keeps a name with an interior or trailing label called arpa", () => {
    /*
     * ACCEPTED, deliberately, and this is the line the apex check must not
     * cross. The rule targets the two REVERSE-LOOKUP zones, not the .arpa
     * TLD: `arpa` is a real, delegated top-level domain, and "gw.arpa" or
     * "gw.arpa.example.com" is a name somebody published on purpose. It is
     * still a better label for the Review dialog than 10.18.166.51, which is
     * the only thing the operator would otherwise see.
     *
     * Widening the check to "ends in .arpa" would silently delete these — the
     * exact invisible over-rejection this suite exists to prevent — and would
     * buy nothing, because the harm is specific to the two zones whose names
     * merely restate the address.
     */
    expect(normalizeReverseDnsName("gw.arpa.example.com")).toBe(
      "gw.arpa.example.com",
    );
    expect(normalizeReverseDnsName("something.arpa")).toBe("something.arpa");
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
     * trim() only removes whitespace at the ENDS, so an interior control
     * character reaches the charset check or nothing does. A newline puts a
     * second line into a name column and into the Review dialog row; a NUL
     * truncates the value in anything that reaches a C string boundary
     * (Postgres rejects it outright in a text column, failing the import);
     * ESC starts a terminal escape sequence in probe and server logs, which
     * is where an operator reads these names back.
     *
     * Written as escapes on purpose — see the file header.
     */
    expect(normalizeReverseDnsName("host\n.example.com")).toBeUndefined();
    expect(normalizeReverseDnsName("host\r\n.example.com")).toBeUndefined();
    // U+0000 NUL.
    expect(normalizeReverseDnsName("host.exa\u0000mple.com")).toBeUndefined();
    // U+001B ESC — the lead byte of an ANSI terminal escape sequence.
    expect(normalizeReverseDnsName("host.exa\u001Bmple.com")).toBeUndefined();
    // U+007F DEL.
    expect(normalizeReverseDnsName("host\u007F.example.com")).toBeUndefined();
  });

  it("rejects non-ASCII, including homoglyphs of a legitimate name", () => {
    /*
     * Punycode ("xn--...") is the encoding a real internationalised name
     * arrives in and is pure ASCII, so rejecting non-ASCII rejects nothing a
     * resolver would actually answer with.
     */
    // U+0441 CYRILLIC SMALL LETTER ES — renders identically to Latin "c".
    expect(
      normalizeReverseDnsName("\u0441ore-switch.example.com"),
    ).toBeUndefined();
    // U+00F4 LATIN SMALL LETTER O WITH CIRCUMFLEX.
    expect(normalizeReverseDnsName("h\u00F4te.example.com")).toBeUndefined();
    // U+200B ZERO WIDTH SPACE — invisible, and not stripped by trim().
    expect(normalizeReverseDnsName("router\u200B.example.com")).toBeUndefined();
    // ...while the punycode form of the same idea is fine.
    expect(normalizeReverseDnsName("xn--hte-snab.example.com")).toBe(
      "xn--hte-snab.example.com",
    );
  });

  it("rejects unicode that renders as ASCII to a human reading the dialog", () => {
    /*
     * This is the class the charset rule exists for. Every one of these
     * renders in the Review dialog as something the operator would read as an
     * ordinary hostname, while being a different string underneath — so an
     * operator ticking "core-switch" cannot be shown a device that is not it.
     * A blocklist of "suspicious" codepoints would be an arms race; the
     * ASCII-only rule ends it, and costs nothing because PTR answers are
     * ASCII on the wire.
     */
    // U+FF48 U+FF4F U+FF53 U+FF54 — FULLWIDTH h, o, s, t.
    expect(
      normalizeReverseDnsName("\uFF48\uFF4F\uFF53\uFF54.example.com"),
    ).toBeUndefined();
    // U+0430 CYRILLIC SMALL LETTER A inside an otherwise Latin word.
    expect(normalizeReverseDnsName("g\u0430teway.example.com")).toBeUndefined();
    // U+200D ZERO WIDTH JOINER — invisible, and splits a word for search.
    expect(
      normalizeReverseDnsName("core\u200Dswitch.example.com"),
    ).toBeUndefined();
    // U+202E RIGHT-TO-LEFT OVERRIDE — reverses everything rendered after it.
    expect(
      normalizeReverseDnsName("host\u202Emoc.elpmaxe.example.com"),
    ).toBeUndefined();
    /*
     * U+FEFF ZERO WIDTH NO-BREAK SPACE (BOM) in the middle, where trim() is
     * no help.
     */
    expect(
      normalizeReverseDnsName("host\uFEFFname.example.com"),
    ).toBeUndefined();
  });
});

describe("normalizeReverseDnsName — hostile-looking values that the charset allows", () => {
  /*
   * These pass every rule in the function, and that is the correct outcome:
   * this gate decides "is this string shaped like a hostname", not "is this
   * string a good idea". Pinning the acceptances matters as much as pinning
   * the rejections, because each one is a place somebody might later be
   * tempted to add a blocklist — and a blocklist here would silently delete
   * real names while the actual defence lives where the value is USED.
   */

  it("accepts a name that collides with a Review dialog badge", () => {
    /*
     * "Already-added" is the badge the dialog puts on a host that is already
     * imported. A PTR record can legitimately say exactly that, and the
     * function cannot tell the difference — nor should it try. The dialog
     * must keep the badge distinguishable by POSITION (its own element),
     * never by comparing it against the name text, and this case is the
     * standing reminder that name text can be anything.
     */
    expect(normalizeReverseDnsName("Already-added")).toBe("Already-added");
  });

  it("accepts a single label at the full 63 characters", () => {
    /*
     * Nothing here clamps for display — MAX_DEVICE_NAME_LENGTH (80) in
     * DiscoveredDeviceBuilder and the `truncate` class in the dialog do that.
     * If this function ever started truncating too, the displayed name and
     * the created name would diverge, which is the bug the dialog was fixed
     * to avoid.
     */
    const longLabel: string =
      "very-long-single-label-".repeat(2) + "a".repeat(17);
    expect(longLabel).toHaveLength(MAX_REVERSE_DNS_LABEL_LENGTH);
    expect(normalizeReverseDnsName(longLabel)).toBe(longLabel);
  });

  it("accepts a name of only underscores", () => {
    /*
     * Ugly, and real: an underscore is a legal first and last character here
     * precisely because Windows/DHCP-registered names use them. "___" is not
     * a value to invent a special rule for — it slugifies fine (see the slug
     * suite below) and it is still a name somebody published.
     */
    expect(normalizeReverseDnsName("___")).toBe("___");
    expect(normalizeReverseDnsName("_")).toBe("_");
  });

  it("rejects a name of only hyphens", () => {
    /*
     * The mirror image of the underscore case, and it falls out of the
     * "hyphen may not lead or trail" rule rather than a special case: with
     * every character a hyphen, the first one always leads. Worth pinning
     * because "-" and "--" are what a placeholder or a truncated answer looks
     * like, and either would render as a device named nothing at all.
     */
    expect(normalizeReverseDnsName("-")).toBeUndefined();
    expect(normalizeReverseDnsName("--")).toBeUndefined();
    expect(normalizeReverseDnsName("---")).toBeUndefined();
    expect(normalizeReverseDnsName("-.-")).toBeUndefined();
  });

  it("treats prototype-shaped values as the ordinary strings they are", () => {
    /*
     * "__proto__", "constructor" and "prototype" are valid DNS labels and are
     * returned verbatim. That is correct AND safe here for a specific reason:
     * this function only ever tests and returns the VALUE, never uses it as
     * an object key, so there is no lookup for a magic name to hijack — the
     * string's destinations are a varchar column and a React text node.
     *
     * The assertion that matters is `toBe`: a returned "__proto__" must be
     * that literal string. If a future implementation routed names through
     * an object map (a cache keyed by name, say), "__proto__" would come back
     * as something else entirely, and this case would catch it.
     *
     * There is deliberately no `typeof ... === "string"` assertion alongside:
     * `toBe("__proto__")` already implies it, so the typeof line could not
     * fail on its own and only made the case look broader than it was.
     */
    expect(normalizeReverseDnsName("__proto__")).toBe("__proto__");
    expect(normalizeReverseDnsName("constructor")).toBe("constructor");
    expect(normalizeReverseDnsName("prototype.example.com")).toBe(
      "prototype.example.com",
    );
  });
});

describe("normalizeReverseDnsName — accepted names are safe to slugify", () => {
  /*
   * NetworkDevice is @SlugifyColumn("name", "slug") with slug varchar(100),
   * so every accepted name here becomes a URL segment without anyone looking
   * at it again. Slug.getSlug strips [&*+~.,\\/()|'"!:@] — which includes the
   * dot, the one character a hostname is made of — and then appends a
   * ten-digit random suffix.
   *
   * The suffix is random but its SHAPE is not, and the regex below rests on
   * that: Faker.getRandomNumbers(10) pushes ten digits each in 1..9 (never 0)
   * and parses the joined string, so no leading zero can ever be dropped and
   * the suffix is always exactly ten digits. Without that guarantee this
   * suite would be intermittently red on roughly one run in ten.
   *
   * Because the suffix means getSlug's return value is never literally empty,
   * a bare "is it non-empty" assertion would be unfalsifiable. So these cases
   * assert on the NAME-DERIVED STEM: the slug must be more than the random
   * suffix, AND it must still contain a recognisable piece of the name. A
   * name that slugified away to nothing would give every such device a slug
   * that is pure entropy, with no trace of what it names.
   */

  /*
   * [name, the lower-case fragment of it that must survive slugification].
   * The fragment is what a human would use to recognise the device in a URL,
   * and it is written out rather than derived so that a change in getSlug
   * that quietly mangled names has something concrete to fail against.
   */
  const acceptedNames: Array<[string, string]> = [
    ["core-switch-01.corp.example.com", "core-switch-01"],
    ["printer-3", "printer-3"],
    ["ws_finance_12.corp.example.com", "ws_finance_12"],
    ["10-18-166-51.dhcp.corp.example.com", "10-18-166-51"],
    ["SW-Core-01.Corp.Example.COM", "sw-core-01"],
    ["xn--hte-snab.example.com", "hte-snab"],
    ["Already-added", "already-added"],
    ["something.arpa", "somethingarpa"],
    ["51.corp.example.com", "51corpexamplecom"],
    ["notin-addr.arpa", "notin-addrarpa"],
    ["___", "___"],
    ["_", "_"],
    ["a.b", "ab"],
    ["a".repeat(MAX_REVERSE_DNS_LABEL_LENGTH), "a".repeat(20)],
  ];

  it("leaves a name-derived stem in the slug for every accepted name", () => {
    for (const [name, fragment] of acceptedNames) {
      /*
       * Guard the guard: if the gate stopped accepting one of these, the slug
       * assertion below would be testing a value that never reaches a device.
       */
      expect(normalizeReverseDnsName(name)).toBe(name);

      const slug: string = Slug.getSlug(name);

      /*
       * getSlug always appends "-" plus ten digits, so a name that slugified
       * to "" yields exactly "-##########" — which fails this match, because
       * the capture needs at least one character before the suffix.
       */
      const stem: RegExpMatchArray | null = slug.match(/^(.+)-\d{10}$/);
      expect(stem).not.toBeNull();

      /*
       * And the stem must be THIS name's stem, not merely some non-empty
       * string. The old assertion here was `expect(stem?.[1]).not.toBe("")`,
       * which could not fail in either branch: a matched capture of `.+` is
       * non-empty by construction, and an unmatched one is `undefined`, which
       * also is not "". Comparing against the fragment is what makes the case
       * die if the name stopped reaching the slug.
       */
      expect(stem?.[1]).toContain(fragment);
    }
  });

  it("does not itself keep a name short enough for the slug column", () => {
    /*
     * The complement of the case above, and the reason MAX_DEVICE_NAME_LENGTH
     * exists: this gate accepts up to 253 characters, which is well past the
     * slug column's varchar(100). Length safety is DiscoveredDeviceBuilder's
     * clamp to 80, not this function's — asserting it here pins where the
     * responsibility lives, so nobody removes the clamp believing the DNS
     * limit already covers it.
     *
     * Asserted on the length of what THIS function returns rather than on
     * Slug.getSlug(...).length, deliberately: the claim is about this gate
     * not truncating, and routing it through Slug would put a foreign
     * module's behaviour (if Slug ever gained a clamp of its own) on the
     * failure path of a suite that does not own it.
     */
    const label: string = "a".repeat(MAX_REVERSE_DNS_LABEL_LENGTH);
    const maximalName: string = `${label}.${label}.${label}.${"b".repeat(61)}`;
    const normalized: string | undefined = normalizeReverseDnsName(maximalName);
    expect(normalized).toBe(maximalName);
    expect(normalized?.length).toBeGreaterThan(100);
  });
});

describe("normalizeReverseDnsName — non-string input", () => {
  /*
   * On the server side the input is read out of a jsonb column, so "the probe
   * sent a number" and "the key is missing" are cases that have to return
   * undefined rather than throw inside a React render. This is the same
   * lesson normalizeDiscoveredHosts learned from a null row in the same
   * column.
   *
   * This block is also what covers re-normalising the `undefined` that a
   * rejected name produces: a later stage feeding its own output back in is
   * exactly `normalizeReverseDnsName(undefined)`, pinned once here rather
   * than re-spelled in a loop that only ever passed it the same value.
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

describe("normalizeReverseDnsName — idempotence and repeat-call stability", () => {
  /*
   * The value is normalised on the probe, again by normalizeDiscoveredHosts
   * on the way out of the jsonb column, and again by
   * getDiscoveredHostDisplayName at the point of use. Three passes must
   * produce what one pass produced, or the name an operator ticks in the
   * Review dialog and the name the created device gets could differ.
   */

  it("returns an accepted name unchanged on every later pass", () => {
    /*
     * Each of these CHANGES on the first pass — a root dot dropped, surrounding
     * whitespace trimmed — so the second pass is a real test of convergence
     * rather than a repeat of a no-op.
     */
    const changedByNormalisation: Array<[string, string]> = [
      ["host.example.com.", "host.example.com"],
      ["  SW-Core-01.corp.example.com  ", "SW-Core-01.corp.example.com"],
      ["\tprinter_2\n", "printer_2"],
      ["  51.corp.example.com.  ", "51.corp.example.com"],
    ];

    for (const [input, expected] of changedByNormalisation) {
      const first: string | undefined = normalizeReverseDnsName(input);
      expect(first).toBe(expected);

      const second: string | undefined = normalizeReverseDnsName(first);
      const third: string | undefined = normalizeReverseDnsName(second);

      /*
       * Compared against the expected STRING, not against `first`: comparing
       * the passes to each other would be satisfied by `undefined ===
       * undefined` if a later pass dropped the name entirely.
       */
      expect(second).toBe(expected);
      expect(third).toBe(expected);
    }
  });

  it("keeps an already-normalised name byte-identical", () => {
    const alreadyNormal: Array<string> = [
      "core-switch-01.corp.example.com",
      "ws_finance_12.corp.example.com",
      "something.arpa",
      "notin-addr.arpa",
      "51.corp.example.com",
      "xn--hte-snab.example.com",
    ];

    for (const name of alreadyNormal) {
      expect(normalizeReverseDnsName(name)).toBe(name);
    }
  });

  it("gives the same answer when the same value is passed again", () => {
    /*
     * Purity, asserted by calling the function repeatedly on the IDENTICAL
     * input and requiring the identical answer each time.
     *
     * This is not the tautology it looks like, and it replaces a loop whose
     * second assertion was always `normalizeReverseDnsName(undefined)` — the
     * same call for every input, unable to fail unless the nullish case
     * already had. The mutation this one exists for is a `g` flag on either
     * module-level regex, a one-character edit that reads as harmless
     * housekeeping: `RegExp.prototype.test` with /g advances `lastIndex`, so
     * `/^[0-9]+$/g.test("51")` is true, then false, then true again on
     * successive calls. Under it "51" would be rejected on the probe and
     * ACCEPTED on the server's re-normalisation of the same string — the
     * dialog and the created device disagreeing about a device's name, with
     * nothing to show for it in a single-call test. A memoising cache keyed
     * by name would land here too.
     *
     * Both directions are in the table on purpose: a rejected value must stay
     * rejected across calls, and an accepted one must stay accepted.
     */
    const repeated: Array<[unknown, string | undefined]> = [
      ["51", undefined],
      ["10.18.166.51", undefined],
      ["in-addr.arpa", undefined],
      ["host..example.com", undefined],
      ["a".repeat(MAX_REVERSE_DNS_NAME_LENGTH + 1), undefined],
      ["51.corp.example.com", "51.corp.example.com"],
      ["core-switch-01.corp.example.com", "core-switch-01.corp.example.com"],
      ["___", "___"],
    ];

    for (const [value, expected] of repeated) {
      expect(normalizeReverseDnsName(value)).toBe(expected);
      expect(normalizeReverseDnsName(value)).toBe(expected);
      expect(normalizeReverseDnsName(value)).toBe(expected);
    }
  });
});
