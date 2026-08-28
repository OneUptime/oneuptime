import StixPatternParser, {
  ParsedIndicatorValue,
} from "../../../../Utils/SecurityEvent/ThreatIntel/StixPatternParser";
import { ThreatIntelIndicatorType } from "../../../../Types/SecurityEvent/ThreatIntelConstants";
import { describe, expect, test } from "@jest/globals";

/*
 * The STIX pattern subset contract: plain IOC equality parses into
 * normalized (lowercased, deduped) values; everything else returns null,
 * all-or-nothing — a half-translated AND pattern would match MORE than
 * its author intended, which for a detection feed is the dangerous
 * direction. These tests pin both sides of that line, because the parser
 * is what stands between a third-party feed's arbitrary text and this
 * platform's match semantics.
 */

function parse(pattern: string): Array<ParsedIndicatorValue> | null {
  return StixPatternParser.parse(pattern);
}

describe("StixPatternParser — supported patterns", () => {
  test("parses a single ipv4 comparison", () => {
    expect(parse("[ipv4-addr:value = '198.51.100.7']")).toEqual([
      {
        type: ThreatIntelIndicatorType.Ipv4Address,
        value: "198.51.100.7",
      },
    ]);
  });

  test("parses every supported value path onto its indicator type", () => {
    const cases: Array<[string, ThreatIntelIndicatorType, string]> = [
      [
        "[ipv6-addr:value = '2001:db8::1']",
        ThreatIntelIndicatorType.Ipv6Address,
        "2001:db8::1",
      ],
      [
        "[domain-name:value = 'evil.example']",
        ThreatIntelIndicatorType.DomainName,
        "evil.example",
      ],
      [
        "[url:value = 'http://evil.example/path']",
        ThreatIntelIndicatorType.Url,
        "http://evil.example/path",
      ],
      [
        "[email-addr:value = 'attacker@evil.example']",
        ThreatIntelIndicatorType.EmailAddress,
        "attacker@evil.example",
      ],
    ];

    for (const [pattern, type, value] of cases) {
      expect(parse(pattern)).toEqual([{ type, value }]);
    }
  });

  test("parses file hash paths in single-quoted, double-quoted and bare spellings", () => {
    const sha256: string = "a".repeat(64);

    expect(parse(`[file:hashes.'SHA-256' = '${sha256}']`)).toEqual([
      {
        type: ThreatIntelIndicatorType.FileHashSha256,
        value: sha256,
      },
    ]);

    expect(parse(`[file:hashes."SHA-1" = 'ABCDEF01']`)).toEqual([
      {
        type: ThreatIntelIndicatorType.FileHashSha1,
        value: "abcdef01",
      },
    ]);

    expect(
      parse("[file:hashes.MD5 = 'D41D8CD98F00B204E9800998ECF8427E']"),
    ).toEqual([
      {
        type: ThreatIntelIndicatorType.FileHashMd5,
        value: "d41d8cd98f00b204e9800998ecf8427e",
      },
    ]);
  });

  test("lowercases and trims values — indicators store the canonical form once", () => {
    expect(parse("[domain-name:value = '  EVIL.Example  ']")).toEqual([
      {
        type: ThreatIntelIndicatorType.DomainName,
        value: "evil.example",
      },
    ]);
  });

  test("parses OR-combined comparisons inside one observation expression", () => {
    expect(
      parse(
        "[domain-name:value = 'evil.example' OR domain-name:value = 'evil2.example']",
      ),
    ).toEqual([
      {
        type: ThreatIntelIndicatorType.DomainName,
        value: "evil.example",
      },
      {
        type: ThreatIntelIndicatorType.DomainName,
        value: "evil2.example",
      },
    ]);
  });

  test("parses OR across observation expressions and mixed types", () => {
    expect(
      parse(
        "[ipv4-addr:value = '198.51.100.7'] OR [url:value = 'http://evil.example/x']",
      ),
    ).toEqual([
      {
        type: ThreatIntelIndicatorType.Ipv4Address,
        value: "198.51.100.7",
      },
      {
        type: ThreatIntelIndicatorType.Url,
        value: "http://evil.example/x",
      },
    ]);
  });

  test("dedupes repeated values case-insensitively across expressions", () => {
    expect(
      parse(
        "[domain-name:value = 'evil.example' OR domain-name:value = 'EVIL.EXAMPLE'] OR [domain-name:value = 'evil.example']",
      ),
    ).toEqual([
      {
        type: ThreatIntelIndicatorType.DomainName,
        value: "evil.example",
      },
    ]);
  });

  test("handles escaped quotes and backslashes inside values", () => {
    expect(parse("[url:value = 'http://evil.example/a\\'b']")).toEqual([
      {
        type: ThreatIntelIndicatorType.Url,
        value: "http://evil.example/a'b",
      },
    ]);

    expect(parse("[url:value = 'c:\\\\temp']")).toEqual([
      {
        type: ThreatIntelIndicatorType.Url,
        value: "c:\\temp",
      },
    ]);
  });

  test("a value containing the word OR inside quotes does not split the comparison", () => {
    expect(parse("[url:value = 'http://evil.example/a OR b']")).toEqual([
      {
        type: ThreatIntelIndicatorType.Url,
        value: "http://evil.example/a or b",
      },
    ]);
  });

  test("tolerates whitespace, newlines, and redundant parentheses around comparisons", () => {
    expect(
      parse(
        "[ (ipv4-addr:value = '198.51.100.7') OR\n  (ipv4-addr:value = '198.51.100.8') ]",
      ),
    ).toEqual([
      {
        type: ThreatIntelIndicatorType.Ipv4Address,
        value: "198.51.100.7",
      },
      {
        type: ThreatIntelIndicatorType.Ipv4Address,
        value: "198.51.100.8",
      },
    ]);
  });

  test("case-insensitive OR keyword and uppercase object types", () => {
    expect(
      parse(
        "[IPV4-ADDR:value = '198.51.100.7' or ipv4-addr:value = '198.51.100.8']",
      ),
    ).toEqual([
      {
        type: ThreatIntelIndicatorType.Ipv4Address,
        value: "198.51.100.7",
      },
      {
        type: ThreatIntelIndicatorType.Ipv4Address,
        value: "198.51.100.8",
      },
    ]);
  });
});

describe("StixPatternParser — unsupported patterns return null, whole", () => {
  test("empty and garbage input", () => {
    expect(parse("")).toBeNull();
    expect(parse("   ")).toBeNull();
    expect(parse("not a pattern at all")).toBeNull();
    expect(parse("[]")).toBeNull();
  });

  test("AND between comparisons", () => {
    expect(
      parse(
        "[ipv4-addr:value = '198.51.100.7' AND domain-name:value = 'evil.example']",
      ),
    ).toBeNull();
  });

  test("AND / FOLLOWEDBY between observation expressions", () => {
    expect(
      parse(
        "[ipv4-addr:value = '198.51.100.7'] AND [domain-name:value = 'evil.example']",
      ),
    ).toBeNull();
    expect(
      parse(
        "[ipv4-addr:value = '198.51.100.7'] FOLLOWEDBY [domain-name:value = 'evil.example']",
      ),
    ).toBeNull();
  });

  test("temporal qualifiers", () => {
    expect(
      parse("[ipv4-addr:value = '198.51.100.7'] REPEATS 5 TIMES"),
    ).toBeNull();
    expect(
      parse("[ipv4-addr:value = '198.51.100.7'] WITHIN 120 SECONDS"),
    ).toBeNull();
  });

  test("negation and non-equality operators", () => {
    expect(parse("[ipv4-addr:value != '198.51.100.7']")).toBeNull();
    expect(parse("[NOT ipv4-addr:value = '198.51.100.7']")).toBeNull();
    expect(parse("[url:value LIKE 'http://evil%']")).toBeNull();
    expect(parse("[url:value MATCHES '^http']")).toBeNull();
    expect(parse("[ipv4-addr:value ISSUBSET '198.51.100.0/24']")).toBeNull();
  });

  test("unsupported object paths", () => {
    expect(parse("[process:name = 'evil.exe']")).toBeNull();
    expect(parse("[windows-registry-key:key = 'HKLM\\\\x']")).toBeNull();
    expect(parse("[file:name = 'evil.exe']")).toBeNull();
    expect(parse("[file:hashes.SSDEEP = 'x']")).toBeNull();
    expect(parse("[ipv4-addr:x_custom = '198.51.100.7']")).toBeNull();
  });

  test("one unsupported comparison poisons the whole pattern — no partial extraction", () => {
    expect(
      parse("[ipv4-addr:value = '198.51.100.7' OR process:name = 'evil.exe']"),
    ).toBeNull();
  });

  test("unterminated string literals and unbalanced brackets", () => {
    expect(parse("[ipv4-addr:value = '198.51.100.7]")).toBeNull();
    expect(parse("[ipv4-addr:value = '198.51.100.7'")).toBeNull();
    expect(parse("ipv4-addr:value = '198.51.100.7']")).toBeNull();
  });

  test("empty values are not indicators", () => {
    expect(parse("[domain-name:value = '']")).toBeNull();
    expect(parse("[domain-name:value = '   ']")).toBeNull();
  });

  test("stray text between observation expressions", () => {
    expect(
      parse(
        "[ipv4-addr:value = '198.51.100.7'] garbage [domain-name:value = 'evil.example']",
      ),
    ).toBeNull();
  });
});
