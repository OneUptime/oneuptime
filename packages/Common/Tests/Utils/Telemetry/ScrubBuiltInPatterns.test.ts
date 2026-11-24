import { describe, expect, test } from "@jest/globals";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import {
  SCRUB_RULE_BUILT_IN_PATTERNS,
  ScrubRegExp,
  scrubRegExpFromBuiltIn,
} from "../../../Types/Telemetry/ScrubRule";
import { EMAIL_ADDRESS_DETECTORS } from "../../../Utils/DataSecurity/Detectors/ContactDetectors";
import { CARD_NUMBER_DETECTORS } from "../../../Utils/DataSecurity/Detectors/FinancialDetectors";
import { TextRange } from "../../../Utils/DataSecurity/TextReadings";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";
import {
  compileBuiltInScrubPattern,
  findCardNumberRanges,
  findEmailAddressRanges,
} from "../../../Utils/Telemetry/ScrubBuiltInPatterns";
import ScrubIpAddress from "../../../Utils/Telemetry/ScrubIpAddress";

/*
 * WHAT A BUILT-IN SCRUB PATTERN FINDS, FOR EVERY PLACE A RULE RUNS.
 *
 * An Email Address rule hides its own pattern's matches - as written and in
 * a percent-encoded URL (#10935) - and every address Data Security's email
 * detectors find, one in any script among them (#10960). A Credit Card rule
 * hides its own pattern's matches - in any script's digits too - and every
 * card the card detectors find (#10960). Each keeps what it hid before, and
 * hides what its type's findings hold: these tests read both, and the
 * scanner's findings beside them.
 */

function hiddenBy(
  findRanges: (text: string) => Array<TextRange>,
  text: string,
): Array<string> {
  return findRanges(text).map(([start, end]: TextRange): string => {
    return text.slice(start, end);
  });
}

function redact(patternType: string, text: string): string {
  return compileBuiltInScrubPattern(patternType)!.replace(text, (): string => {
    return "[REDACTED]";
  });
}

const EMAIL: RegExp = SCRUB_RULE_BUILT_IN_PATTERNS[LogScrubPatternType.Email]!;
const CARD: RegExp =
  SCRUB_RULE_BUILT_IN_PATTERNS[LogScrubPatternType.CreditCard]!;

// Every finding of a type a rule's ranges cover, and every range a finding or the rule's own pattern.
function expectFoundHidden(data: {
  text: string;
  dataTypeId: string;
  findRanges: (text: string) => Array<TextRange>;
}): void {
  const ranges: Array<TextRange> = data.findRanges(data.text);
  const found: Array<TextMatch> = findSensitiveValues(data.text).filter(
    (match: TextMatch): boolean => {
      return match.dataTypeId === data.dataTypeId;
    },
  );

  for (const match of found) {
    expect({
      finding: data.text.slice(match.start, match.end),
      hidden: ranges.some(([start, end]: TextRange): boolean => {
        return start <= match.start && match.end <= end;
      }),
    }).toEqual({
      finding: data.text.slice(match.start, match.end),
      hidden: true,
    });
  }
}

describe("an Email Address rule (#10935, #10960)", () => {
  test.each([
    [
      "an address in a percent-encoded URL",
      "GET /signup?email=jane.doe%40acmecorp.io HTTP/1.1",
      "GET /signup?email=[REDACTED] HTTP/1.1",
    ],
    [
      "its plus sign encoded too",
      "u=Jane.Doe%2Bnews%40AcmeCorp.io&n=1",
      "u=[REDACTED]&n=1",
    ],
    ["its dots encoded too", "to=jane%2Edoe%40acmecorp%2Eio", "to=[REDACTED]"],
    [
      "encoded twice, in a URL inside a query string",
      "next=%2Fsignup%3Femail%3Djane%2540acmecorp.io",
      "next=%2Fsignup%3Femail%3D[REDACTED]",
    ],
    ["in lower-case escapes", "u=jane%40acmecorp.io", "u=[REDACTED]"],
    ["a name in Han letters", "to 张伟@acmecorp.io ok", "to [REDACTED] ok"],
    [
      "a name with accents",
      "to josé.garcía@acmecorp.io ok",
      "to [REDACTED] ok",
    ],
    ["a domain in another script", "to user@例え.jp ok", "to [REDACTED] ok"],
    [
      "a name and domain in Cyrillic",
      "to почта@пример.рф ok",
      "to [REDACTED] ok",
    ],
    [
      "a punycode top-level domain",
      "to user@пример.xn--p1ai ok",
      "to [REDACTED] ok",
    ],
    [
      "right after a letter of another script",
      "邮箱jane@acmecorp.io已发送",
      "邮箱[REDACTED]已发送",
    ],
    ["an address as written", "user jane@acmecorp.io in", "user [REDACTED] in"],
  ])("hides %s: %s", (_label: string, text: string, scrubbed: string) => {
    expect(redact(LogScrubPatternType.Email, text)).toBe(scrubbed);
    expectFoundHidden({
      text,
      dataTypeId: "email-address",
      findRanges: findEmailAddressRanges,
    });
  });

  test("still hides everything its own pattern hid, as written", () => {
    for (const text of [
      "logo@2x.png",
      "-@http.route:/health",
      "a@b.co and x.y+z@sub.domain.example.org",
      "jane@acme.io-prod",
      "jane@acme.md",
      "a".repeat(70) + "@acme.io",
    ]) {
      const own: Array<TextRange> =
        scrubRegExpFromBuiltIn(EMAIL).matchRanges(text);
      const ranges: Array<TextRange> = findEmailAddressRanges(text);

      for (const [ownStart, ownEnd] of own) {
        expect({
          text,
          covered: ranges.some(([start, end]: TextRange): boolean => {
            return start <= ownStart && ownEnd <= end;
          }),
        }).toEqual({ text, covered: true });
      }
    }
  });

  test("keeps the rest of an encoded URL, its other escapes among them", () => {
    expect(
      hiddenBy(
        findEmailAddressRanges,
        "https://app.io/cb?to=jane%40acmecorp.io&next=%2Fhome%3Ftab%3D2",
      ),
    ).toEqual(["jane%40acmecorp.io"]);
  });

  test("keeps what is no address, encoded or not", () => {
    for (const text of [
      "GET /search?q=jane%40&n=1",
      "100%40 off",
      "@用户 你好",
      "邮箱 张伟@ 已发送",
      "caf%C3%A9 at noon",
      "no address here",
      "",
    ]) {
      expect([text, findEmailAddressRanges(text)]).toEqual([text, []]);
    }
  });

  test("replace, matchRanges and test read the same matches", () => {
    const regex: ScrubRegExp = compileBuiltInScrubPattern(
      LogScrubPatternType.Email,
    )!;
    const text: string = "a jane%40acme.io b 张伟@acme.io c";

    expect(regex.matchRanges(text)).toEqual(findEmailAddressRanges(text));
    expect(regex.test(text)).toBe(true);
    expect(regex.test("nothing")).toBe(false);
    expect(regex.source).toBe(EMAIL.source);
  });
});

describe("a Credit Card rule (#10960)", () => {
  test.each([
    [
      "in fullwidth digits",
      "カード番号：４５３２ ０１５１ １２８３ ０３６６",
      "カード番号：[REDACTED]",
    ],
    [
      "in Arabic-Indic digits",
      "رقم البطاقة ٤٥٣٢٠١٥١١٢٨٣٠٣٦٦",
      "رقم البطاقة [REDACTED]",
    ],
    [
      "in Persian digits, with dashes",
      "شماره کارت ۴۵۳۲-۰۱۵۱-۱۲۸۳-۰۳۶۶",
      "شماره کارت [REDACTED]",
    ],
    [
      "in Devanagari digits",
      "कार्ड ४५३२ ०१५१ १२८३ ०३६६ अस्वीकृत",
      "कार्ड [REDACTED] अस्वीकृत",
    ],
    [
      "typed in two scripts",
      "card ４５３２ 0151 1283 0366 declined",
      "card [REDACTED] declined",
    ],
    [
      "right against a letter of another script",
      "卡号４５３２０１５１１２８３０３６６已拒绝",
      "卡号[REDACTED]已拒绝",
    ],
    [
      "an American Express card, which its own pattern never read",
      "card 3782 822463 10005 declined",
      "card [REDACTED] declined",
    ],
    [
      "an ASCII card as before",
      "card 4532 0151 1283 0366 declined",
      "card [REDACTED] declined",
    ],
  ])(
    "hides a card %s: %s",
    (_label: string, text: string, scrubbed: string) => {
      expect(redact(LogScrubPatternType.CreditCard, text)).toBe(scrubbed);
      expectFoundHidden({
        text,
        dataTypeId: "credit-card-number",
        findRanges: findCardNumberRanges,
      });
    },
  );

  test("a digit of another script beside a card is no part of it", () => {
    expect(hiddenBy(findCardNumberRanges, "۴۵۳۲۰۱۵۱۱۲۸۳۰۳۶۶١ end")).toEqual([
      "۴۵۳۲۰۱۵۱۱۲۸۳۰۳۶۶",
    ]);
  });

  test("still hides everything its own pattern hid, sixteen digits that fail the Luhn check among them", () => {
    for (const text of [
      "card 4532 0151 1283 0367",
      "ref 1234-5678-9012-3456",
      "n 1111222233334444",
    ]) {
      expect([text, findCardNumberRanges(text)]).toEqual([
        text,
        scrubRegExpFromBuiltIn(CARD).matchRanges(text),
      ]);
    }
  });

  test("its own pattern reads a sixteen-digit card in any script's digits too", () => {
    expect(
      hiddenBy(findCardNumberRanges, "ref ４５３２ ０１５１ １２８３ ０３６７"),
    ).toEqual(["４５３２ ０１５１ １２８３ ０３６７"]);
  });

  test("keeps what is no card", () => {
    for (const text of [
      "order ４１１１ １１１１",
      "timestamp 1700000000000",
      "٤١١١١١١١١١١١١",
      "no digits",
      "",
    ]) {
      expect([text, findCardNumberRanges(text)]).toEqual([text, []]);
    }
  });
});

describe("compileBuiltInScrubPattern", () => {
  test("is what an IP Address rule finds for an IP address", () => {
    const text: string = "peer ip:2a00:1450::1 and 8.8.8.8 and 10.0.0.1";

    expect(
      compileBuiltInScrubPattern(LogScrubPatternType.IPAddress)!.matchRanges(
        text,
      ),
    ).toEqual(ScrubIpAddress.findRanges(text));
  });

  test("keeps the SSN and Phone Number patterns as they are", () => {
    for (const patternType of [
      LogScrubPatternType.SSN,
      LogScrubPatternType.PhoneNumber,
    ]) {
      const regex: ScrubRegExp = compileBuiltInScrubPattern(patternType)!;
      const text: string = "ssn 123-45-6789 call 415-555-2671";

      expect(regex.source).toBe(
        SCRUB_RULE_BUILT_IN_PATTERNS[patternType]!.source,
      );
      expect(regex.matchRanges(text)).toEqual(
        scrubRegExpFromBuiltIn(
          SCRUB_RULE_BUILT_IN_PATTERNS[patternType]!,
        ).matchRanges(text),
      );
    }
  });

  test("is null for a pattern type no table lists, and for one that reads keys", () => {
    for (const patternType of [
      "custom",
      "sensitiveKeys",
      "namedKeys",
      "constructor",
      "toString",
      "",
    ]) {
      expect([patternType, compileBuiltInScrubPattern(patternType)]).toEqual([
        patternType,
        null,
      ]);
    }
  });

  test("the email and card detectors it hides are the scanner's own", () => {
    for (const detector of [
      ...EMAIL_ADDRESS_DETECTORS,
      ...CARD_NUMBER_DETECTORS,
    ]) {
      expect(["email-address", "credit-card-number"]).toContain(
        detector.dataTypeId,
      );
    }
  });
});
