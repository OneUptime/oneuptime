import IndicatorListParser, {
  INDICATOR_LIST_MAX_VALUE_LENGTH,
  IndicatorListParseResult,
  classifyIndicatorValue,
} from "../../../../Utils/SecurityEvent/ThreatIntel/IndicatorListParser";
import StixPatternParser, {
  ParsedIndicatorValue,
} from "../../../../Utils/SecurityEvent/ThreatIntel/StixPatternParser";
import { ThreatIntelIndicatorType } from "../../../../Types/SecurityEvent/ThreatIntelConstants";
import { describe, expect, test } from "@jest/globals";
import { fastestRun } from "../../../Helpers/FastestRun";

/*
 * A list of indicators, as the free blocklists publish them: one value a
 * line, comments and blank lines between. The parser types each value by
 * its shape and stores it as a STIX pattern's value would be stored, so a
 * list's indicators match events exactly as a TAXII collection's do.
 */

const parse: (text: string, maxValues?: number) => IndicatorListParseResult = (
  text: string,
  maxValues: number = 50000,
): IndicatorListParseResult => {
  return IndicatorListParser.parse(text, { maxValues });
};

const valuesOf: (result: IndicatorListParseResult) => Array<string> = (
  result: IndicatorListParseResult,
): Array<string> => {
  return result.values.map((value: ParsedIndicatorValue): string => {
    return `${value.type} ${value.value}`;
  });
};

const MD5: string = "44d88612fea8a8f36de82e1278abb02f";
const SHA1: string = "3395856ce81f2b7382dee72602f798b642f14140";
const SHA256: string =
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";

describe("the free lists, as they are published", () => {
  test("abuse.ch Feodo Tracker: a commented header, one address a line, an END line", () => {
    const result: IndicatorListParseResult = parse(
      [
        "################################################################",
        "# abuse.ch Feodo Tracker Botnet C2 IP Blocklist (recommended)  #",
        "# Last updated: 2026-10-21 08:13:28 UTC                         #",
        "#                                                              #",
        "# Terms Of Use: https://abuse.ch/terms-of-use/                 #",
        "################################################################",
        "#",
        "# DstIP",
        "192.0.2.10",
        "198.51.100.20",
        "# END 2 entries",
      ].join("\n"),
    );

    expect(valuesOf(result)).toEqual([
      "ipv4-addr 192.0.2.10",
      "ipv4-addr 198.51.100.20",
    ]);
    expect(result).toMatchObject({
      lines: 2,
      duplicates: 0,
      unsupported: 0,
      overLimit: 0,
    });
  });

  test("Emerging Threats and the Tor exit list: bare addresses, Windows line ends too", () => {
    const result: IndicatorListParseResult = parse(
      "203.0.113.5\r\n203.0.113.6\r\n2001:db8::7\r\n",
    );

    expect(valuesOf(result)).toEqual([
      "ipv4-addr 203.0.113.5",
      "ipv4-addr 203.0.113.6",
      "ipv6-addr 2001:db8::7",
    ]);
  });

  test("a CSV export: the first column is the indicator, the rest is left out", () => {
    const result: IndicatorListParseResult = parse(
      [
        "# first_seen,dst_ip,port",
        '"evil.example","2026-10-01","Emotet"',
        "203.0.113.9,443,online",
        "payroll@phish.example;reported",
        "203.0.113.10\tQakBot",
        "203.0.113.11 # seen yesterday",
      ].join("\n"),
    );

    expect(valuesOf(result)).toEqual([
      "domain-name evil.example",
      "ipv4-addr 203.0.113.9",
      "email-addr payroll@phish.example",
      "ipv4-addr 203.0.113.10",
      "ipv4-addr 203.0.113.11",
    ]);
  });
});

describe("each value is typed by its shape", () => {
  test.each([
    ["192.0.2.1", ThreatIntelIndicatorType.Ipv4Address, "192.0.2.1"],
    ["2001:DB8::1", ThreatIntelIndicatorType.Ipv6Address, "2001:db8::1"],
    ["Evil.Example", ThreatIntelIndicatorType.DomainName, "evil.example"],
    ["c2.evil.co.uk", ThreatIntelIndicatorType.DomainName, "c2.evil.co.uk"],
    [
      "HTTP://Evil.Example/Payload.EXE",
      ThreatIntelIndicatorType.Url,
      "http://evil.example/payload.exe",
    ],
    [
      "Payroll@Phish.Example",
      ThreatIntelIndicatorType.EmailAddress,
      "payroll@phish.example",
    ],
    [MD5.toUpperCase(), ThreatIntelIndicatorType.FileHashMd5, MD5],
    [SHA1, ThreatIntelIndicatorType.FileHashSha1, SHA1],
    [SHA256, ThreatIntelIndicatorType.FileHashSha256, SHA256],
  ])("%s is a %s", (raw: string, type: string, value: string) => {
    expect(classifyIndicatorValue(raw)).toEqual({ type, value });
  });

  test("an address or a domain with a port is the address or the domain", () => {
    expect(classifyIndicatorValue("203.0.113.7:443")).toEqual({
      type: ThreatIntelIndicatorType.Ipv4Address,
      value: "203.0.113.7",
    });
    expect(classifyIndicatorValue("[2001:db8::7]:8443")).toEqual({
      type: ThreatIntelIndicatorType.Ipv6Address,
      value: "2001:db8::7",
    });
    expect(classifyIndicatorValue("[2001:db8::7]")).toEqual({
      type: ThreatIntelIndicatorType.Ipv6Address,
      value: "2001:db8::7",
    });
    expect(classifyIndicatorValue("evil.example:8080")).toEqual({
      type: ThreatIntelIndicatorType.DomainName,
      value: "evil.example",
    });
  });

  test.each([
    ["198.51.100.0/24", "a range is many addresses"],
    ["2001:db8::/32", "an IPv6 range"],
    ["999.1.1.1", "not an address"],
    ["localhost", "a name without a domain"],
    ["hello", "a word"],
    ["evil.example/path", "a URL without its scheme"],
    ["[2001:db8::7]:https", "a port that is not a number"],
    ["[evil.example]", "brackets around a name"],
    ["@evil.example", "a mailbox without a name"],
    ["a@b@evil.example", "two at signs"],
    ["payroll@localhost", "a mailbox without a domain"],
    [`${"a".repeat(65)}@evil.example`, "a mailbox name longer than 64"],
    ["44d88612fea8a8f36de82e1278abb02", "31 hex digits: no hash"],
    ["", "nothing"],
    ["   ", "spaces"],
  ])("%s is not one: %s", (raw: string) => {
    expect(classifyIndicatorValue(raw)).toBeNull();
  });

  test("a value longer than any indicator is not one", () => {
    const longUrl: string = `https://evil.example/${"a".repeat(INDICATOR_LIST_MAX_VALUE_LENGTH)}`;

    expect(classifyIndicatorValue(longUrl)).toBeNull();
  });

  test("values are stored as a STIX pattern's are, so both kinds of feed match the same events", () => {
    for (const [pattern, listValue] of [
      ["[ipv4-addr:value = '192.0.2.44']", "192.0.2.44"],
      ["[domain-name:value = 'C2.Evil.Example']", "C2.Evil.Example"],
      ["[url:value = 'http://Evil.Example/x']", "http://Evil.Example/x"],
      [`[file:hashes.'SHA-256' = '${SHA256.toUpperCase()}']`, SHA256],
      ["[email-addr:value = 'Payroll@Phish.Example']", "payroll@phish.example"],
    ] as Array<[string, string]>) {
      expect([classifyIndicatorValue(listValue)]).toEqual(
        StixPatternParser.parse(pattern),
      );
    }
  });
});

describe("what the parse counts", () => {
  test("comments and blank lines are not lines; #, ; and // start a comment", () => {
    const result: IndicatorListParseResult = parse(
      [
        "# a comment",
        "; another",
        "// and another",
        "",
        "   ",
        "\t",
        "192.0.2.1",
      ].join("\n"),
    );

    expect(result.lines).toBe(1);
    expect(valuesOf(result)).toEqual(["ipv4-addr 192.0.2.1"]);
  });

  test("a value listed twice is one indicator, the second counted as a duplicate", () => {
    const result: IndicatorListParseResult = parse(
      [
        "192.0.2.1",
        "192.0.2.1",
        "EVIL.example",
        "evil.example",
        "192.0.2.1:80",
      ].join("\n"),
    );

    expect(valuesOf(result)).toEqual([
      "ipv4-addr 192.0.2.1",
      "domain-name evil.example",
    ]);
    expect(result.duplicates).toBe(3);
  });

  test("lines OneUptime cannot match are counted, not guessed at", () => {
    const result: IndicatorListParseResult = parse(
      ["198.51.100.0/24", "hello world", "192.0.2.1"].join("\n"),
    );

    expect(valuesOf(result)).toEqual(["ipv4-addr 192.0.2.1"]);
    expect(result.unsupported).toBe(2);
    expect(result.lines).toBe(3);
  });

  test("the list is cut at the limit, and the rest is counted", () => {
    const lines: Array<string> = [];

    for (let index: number = 1; index <= 12; index++) {
      lines.push(`192.0.2.${index}`);
    }

    const result: IndicatorListParseResult = parse(lines.join("\n"), 10);

    expect(result.values).toHaveLength(10);
    expect(result.values[9]!.value).toBe("192.0.2.10");
    expect(result.overLimit).toBe(2);
  });

  test("an empty list, or one of comments only, holds nothing and is not an error", () => {
    for (const text of ["", "\n\n", "# END 0 entries\n"]) {
      expect(parse(text)).toEqual({
        values: [],
        lines: 0,
        duplicates: 0,
        unsupported: 0,
        overLimit: 0,
      });
    }
  });

  test("a line longer than any indicator is skipped, and the lines after it are read", () => {
    const result: IndicatorListParseResult = parse(
      [`${"x".repeat(INDICATOR_LIST_MAX_VALUE_LENGTH * 3)}`, "192.0.2.1"].join(
        "\n",
      ),
    );

    expect(valuesOf(result)).toEqual(["ipv4-addr 192.0.2.1"]);
    expect(result.unsupported).toBe(1);
  });

  test("a long line whose first value is short keeps the value", () => {
    const result: IndicatorListParseResult = parse(
      `192.0.2.1 ${"#".repeat(INDICATOR_LIST_MAX_VALUE_LENGTH * 2)}`,
    );

    expect(valuesOf(result)).toEqual(["ipv4-addr 192.0.2.1"]);
  });
});

/*
 * A list is text somebody else wrote: the worst it can be costs one pass.
 * Each input is 400,000 characters shaped against one step of the parse.
 */
describe("a list is read in time linear in its length", () => {
  const SIZE: number = 400000;

  /*
   * How long the work takes: the fastest of up to three attempts, counted as
   * it would have run on a usual runner when every attempt overran on a slow
   * one (Tests/Helpers/FastestRun).
   */
  const timed: (text: string) => number = (text: string): number => {
    return fastestRun({
      run: (): void => {
        parse(text);
      },
      limitInMs: 2000,
    }).inMs;
  };

  test.each([
    ["one line, no separator", "a".repeat(SIZE)],
    ["one line of separators", " ,;\t".repeat(SIZE / 4)],
    ["one line of colons", ":".repeat(SIZE)],
    ["one line of dots", ".".repeat(SIZE)],
    ["one line of at signs", "@".repeat(SIZE)],
    ["one line of brackets", "[".repeat(SIZE)],
    ["one line of hex", "a1".repeat(SIZE / 2)],
    ["one line of quotes", '"'.repeat(SIZE)],
    ["one line of slashes", "/".repeat(SIZE)],
    ["newlines only", "\n".repeat(SIZE)],
    ["carriage returns only", "\r".repeat(SIZE)],
    ["comment lines", "#x\n".repeat(SIZE / 3)],
    ["short labels", "a.".repeat(SIZE / 2)],
    ["dotted digits", "1.".repeat(SIZE / 2)],
    ["IPv6 groups", "ffff:".repeat(SIZE / 5)],
    [
      "long almost-domains a line",
      `${"a-".repeat(1000)}a\n`.repeat(SIZE / 2002),
    ],
    [
      "long almost-mailboxes a line",
      `${"a".repeat(64)}@${"b.".repeat(900)}\n`.repeat(SIZE / 1866),
    ],
    [
      "addresses with long ports",
      `192.0.2.1:${"9".repeat(2000)}\n`.repeat(SIZE / 2011),
    ],
    [
      "distinct addresses",
      Array.from({ length: SIZE / 12 }, (_: unknown, index: number): string => {
        return `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`;
      }).join("\n"),
    ],
  ])("%s", (_name: string, text: string) => {
    expect(text.length).toBeGreaterThanOrEqual(SIZE * 0.95);
    expect(timed(text)).toBeLessThan(2000);
  });
});
