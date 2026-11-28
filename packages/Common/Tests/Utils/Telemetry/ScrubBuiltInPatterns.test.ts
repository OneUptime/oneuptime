import { describe, expect, test } from "@jest/globals";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import {
  SCRUB_RULE_BUILT_IN_PATTERNS,
  ScrubRegExp,
  scrubRegExpFromBuiltIn,
} from "../../../Types/Telemetry/ScrubRule";
import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import {
  EMAIL_ADDRESS_DETECTORS,
  PHONE_NUMBER_DETECTORS,
} from "../../../Utils/DataSecurity/Detectors/ContactDetectors";
import { CARD_NUMBER_DETECTORS } from "../../../Utils/DataSecurity/Detectors/FinancialDetectors";
import { US_SSN_DETECTORS } from "../../../Utils/DataSecurity/Detectors/GovernmentIdDetectors";
import { getBuiltInDetectorsOf } from "../../../Utils/DataSecurity/Detectors/Index";
import {
  findDetectorRanges,
  findInEveryReading,
  ReadingNeeds,
  TextRange,
} from "../../../Utils/DataSecurity/TextReadings";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";
import {
  compileBuiltInScrubPattern,
  findCardNumberRanges,
  findEmailAddressRanges,
  findPhoneNumberRanges,
  findSsnRanges,
} from "../../../Utils/Telemetry/ScrubBuiltInPatterns";
import ScrubIpAddress from "../../../Utils/Telemetry/ScrubIpAddress";
import { INTERNATIONAL_PHONE_NUMBERS } from "../../Helpers/InternationalPhoneNumbers";

/*
 * WHAT A BUILT-IN SCRUB PATTERN FINDS, FOR EVERY PLACE A RULE RUNS.
 *
 * An Email Address rule hides its own pattern's matches - as written and in
 * a percent-encoded URL (#10935) - and every address Data Security's email
 * detectors find, one in any script among them (#10960). A Credit Card rule
 * hides its own pattern's matches - in any script's digits too - and every
 * card the card detectors find (#10960). A Phone Number and an SSN rule
 * hide their own pattern's matches and every phone or Social Security
 * number the detectors find on its own, international numbers among them
 * (#11025, #11030). Each keeps what it hid before, and hides what its
 * type's findings hold: these tests read both, and the scanner's findings
 * beside them.
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
const PHONE: RegExp =
  SCRUB_RULE_BUILT_IN_PATTERNS[LogScrubPatternType.PhoneNumber]!;
const SSN: RegExp = SCRUB_RULE_BUILT_IN_PATTERNS[LogScrubPatternType.SSN]!;
const ANY_DIGIT: RegExp = /[0-9]/;

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

/*
 * A PHONE NUMBER RULE HIDES WHAT DATA SECURITY CALLS A PHONE NUMBER (#11025,
 * #11030): its own pattern's North American numbers as before, and every
 * number the phone detectors find on its own - an international one in the
 * groups people write it in, a North American one as written, a UK mobile -
 * as written, percent-encoded and in every script's digits. What only looks
 * like one is left as the rule left it before.
 */
describe("a Phone Number rule (#11025, #11030)", () => {
  test.each(
    INTERNATIONAL_PHONE_NUMBERS.map((phone: string) => {
      return [phone];
    }),
  )(
    "hides an international number as grouping v4 reads one: %s",
    (phone: string) => {
      const text: string = `SMS to ${phone} was not delivered`;
      const scrubbed: string = redact(LogScrubPatternType.PhoneNumber, text);

      // Not one digit of it is left.
      expect([phone, ANY_DIGIT.test(scrubbed)]).toEqual([phone, false]);
      expect(scrubbed).toContain("[REDACTED]");
      expect(scrubbed.startsWith("SMS to ")).toBe(true);
      expect(scrubbed.endsWith(" was not delivered")).toBe(true);
      expectFoundHidden({
        text,
        dataTypeId: "phone-number",
        findRanges: findPhoneNumberRanges,
      });
    },
  );

  test.each([
    ["the issue's own example", "+44 20 7946 0958", "+44 20 7946 0958"],
    ["the issue's other example", "+49 30 123456", "+49 30 123456"],
    [
      "one the US pattern only half hid before",
      "+44 207 946 0958",
      "+44 207 946 0958",
    ],
    [
      "a number with no separator, as E.164 writes it",
      "+442079460958",
      "+442079460958",
    ],
    ["a dotted one", "+44.20.7946.0958", "+44.20.7946.0958"],
    ["a North American one with dots", "+1.415.555.2671", "+1.415.555.2671"],
    ["one in a JSON string", `"+33 6 12 34 56 78"`, "+33 6 12 34 56 78"],
    ["one at the end of a sentence", "+49 30 123456.", "+49 30 123456"],
    ["one run on into a word", "+44 20 7946 0958abc", "+44 20 7946 0958"],
    ["a UK mobile written the UK way", "07911 123456", "07911 123456"],
    ["a North American one written with dots", "415.555.2671", "415.555.2671"],
  ])("hides %s", (_label: string, written: string, hidden: string) => {
    const text: string = `call ${written} now`;

    expect(hiddenBy(findPhoneNumberRanges, text)).toEqual([hidden]);
    expectFoundHidden({
      text,
      dataTypeId: "phone-number",
      findRanges: findPhoneNumberRanges,
    });
  });

  test("the US pattern half-hid +44 207 946 0958 before, and the rule hides it whole now", () => {
    const text: string = "call +44 207 946 0958 failed";

    expect(redact(LogScrubPatternType.PhoneNumber, text)).toBe(
      "call [REDACTED] failed",
    );
    expect(
      scrubRegExpFromBuiltIn(PHONE).replace(text, (): string => {
        return "[REDACTED]";
      }),
    ).toBe("call +44 [REDACTED] failed");
  });

  test.each([
    [
      "in a percent-encoded URL",
      "GET /callback?phone=%2B44%2020%207946%200958&step=2 HTTP/1.1",
      "GET /callback?phone=[REDACTED]&step=2 HTTP/1.1",
    ],
    [
      "in a URL with its spaces encoded only",
      "GET /callback?phone=+44%2020%207946%200958 HTTP/1.1",
      "GET /callback?phone=[REDACTED] HTTP/1.1",
    ],
    [
      "a North American one in a percent-encoded URL",
      "/sms?to=%28415%29%20555-2671",
      "/sms?to=[REDACTED]",
    ],
    [
      "in Arabic-Indic digits",
      "رقم الهاتف +٤٤ ٢٠ ٧٩٤٦ ٠٩٥٨",
      "رقم الهاتف [REDACTED]",
    ],
    [
      "in Persian digits",
      "شماره تلفن +۴۹ ۳۰ ۱۲۳۴۵۶۷۸",
      "شماره تلفن [REDACTED]",
    ],
    [
      "in fullwidth digits after an ASCII plus",
      "電話：+８１ ３-１２３４-５６７８",
      "電話：[REDACTED]",
    ],
    ["in Devanagari digits", "फ़ोन +९१ ९८७६५ ४३२१०", "फ़ोन [REDACTED]"],
    ["typed in two scripts", "phone +44 ２０ 7946 0958", "phone [REDACTED]"],
    [
      "a North American one in Arabic-Indic digits",
      "هاتف ٤١٥-٥٥٥-٢٦٧١",
      "هاتف [REDACTED]",
    ],
    [
      "set apart by no-break spaces",
      "call +49\u00A030\u00A0123456 now",
      "call [REDACTED] now",
    ],
  ])(
    "hides a number %s: %s",
    (_label: string, text: string, scrubbed: string) => {
      expect(redact(LogScrubPatternType.PhoneNumber, text)).toBe(scrubbed);
      expectFoundHidden({
        text,
        dataTypeId: "phone-number",
        findRanges: findPhoneNumberRanges,
      });
    },
  );

  test("still hides everything its own pattern hid, as written", () => {
    for (const text of [
      "call 555-123-4567 now",
      "call (555) 123-4567 now",
      "call +1 555 123 4567 now",
      "call 1-555-123-4567 now",
      "call 5551234567 now",
      "ref 1234-567890-1234",
    ]) {
      const before: Array<TextRange> =
        scrubRegExpFromBuiltIn(PHONE).matchRanges(text);

      expect(before.length).toBeGreaterThan(0);

      for (const [start, end] of before) {
        expect([
          text,
          findPhoneNumberRanges(text).some(([from, to]: TextRange): boolean => {
            return from <= start && end <= to;
          }),
        ]).toEqual([text, true]);
      }
    }
  });

  /*
   * What only looks like a phone number - an order number, a timestamp or a
   * time zone's offset, a version, an id, a decimal, a coordinate, an
   * address - is hidden by nothing more than the rule's own pattern hid
   * before: grouping v4's near misses (ExceptionGroupingV4.test.ts) as
   * logs write them, and a few the raw text adds.
   */
  test.each([
    ["order numbers", "order ORD-2024-000123 failed"],
    ["order numbers", "order #12345 failed"],
    ["order numbers", "order 1234 5678 failed"],
    ["order numbers", "order 123 456 789 failed"],
    ["order numbers", "order 12-34-56-78 failed"],
    ["order numbers", "order 1234-567890-1234 failed"],
    ["timestamps", "at 2026-11-24 10:15:00 +0000 failed"],
    ["timestamps", "at Sat Nov 24 10:15:00 +0100 2026 failed"],
    ["timestamps", "at 10:15:00 +05:30 failed"],
    ["timestamps", "at 2026-11-24T10:15:00+01:00 failed"],
    ["timestamps", "at UTC+1 failed"],
    ["timestamps", "at UTC +1 2026 failed"],
    ["timestamps", "at GMT +12 2026-11-24 failed"],
    ["timestamps", "at UTC +1 2026-11-24 10:15:00 failed"],
    ["timestamps", "at GMT+5 1999-12-31 23:59 failed"],
    ["timestamps", "at +0000 failed"],
    ["timestamps", "offset +05 30 failed"],
    ["version strings", "build v1.2.3+build.5 failed"],
    ["version strings", "node 18.19.0+1 failed"],
    ["version strings", "upgrade to +1.2.3 failed"],
    ["version strings", "upgrade to version +2.3.4.5 failed"],
    ["version strings", "release 2.10.3 failed"],
    ["version strings", "semver 1.0.0-rc.1+20261124 failed"],
    ["ids", "user 42 of 1000 failed"],
    ["ids", "tenant t_8812 shard 3 failed"],
    ["ids", "job 2026 attempt 3 of 5 failed"],
    ["ids", "HTTP 503 after 3 retries"],
    ["ids", "trace 4bf92f3577b34da6a3ce929d0e0e4736 failed"],
    ["decimals", "delta +51.507217 out of range"],
    ["decimals", "delta +12.345678 out of range"],
    ["decimals", "balance +1 000 000 left"],
    ["decimals", "balance +1 000 000 000 left"],
    ["coordinates", "at +40.6894-074.0447/ failed"],
    ["coordinates", "at +48.8584 2.2945 failed"],
    ["coordinates", "at +51.507217, -0.127758 failed"],
    ["addresses", "peer +192.168.100.200 refused"],
    ["almost a phone number", "call +0044 20 7946 0958 failed"],
    ["almost a phone number", "call a+44 20 7946 0958 failed"],
    ["almost a phone number", "call ++44 20 7946 0958 failed"],
    ["almost a phone number", "call +44 failed"],
    ["almost a phone number", "call +44 20 failed"],
    ["almost a phone number", "call +44 2079 failed"],
    ["almost a phone number", "call +1 2 3 4 5 6 7 8 failed"],
    ["almost a phone number", "call +44 20 7946 0958 12 34 failed"],
    ["almost a phone number", "call +1-800-FLOWERS failed"],
    ["almost a phone number", "call 020 7946 0958 failed"],
    ["almost a phone number", "call +999 1234 5678 failed"],
  ])("leaves %s as it was: %s", (_kind: string, text: string) => {
    expect(findPhoneNumberRanges(text)).toEqual(
      scrubRegExpFromBuiltIn(PHONE).matchRanges(text),
    );
    expect(findDetectorRanges(PHONE_NUMBER_DETECTORS, text)).toEqual([]);
  });

  test.each([
    ["a decimal", "delta %2B51.507217 out of range"],
    ["a version", "/v%2B1.2.3"],
    ["an image asset", "/assets/logo%2B2x.png"],
    ["an encoded space", "a%2012%2034%2056%2078 b"],
  ])(
    "leaves %s in a percent-encoded URL: %s",
    (_kind: string, text: string) => {
      expect(findPhoneNumberRanges(text)).toEqual(
        scrubRegExpFromBuiltIn(PHONE).matchRanges(text),
      );
    },
  );

  test.each([
    ["a decimal", "دلتا +٥١٫٥٠٧٢١٧"],
    ["a decimal written with an ASCII dot", "دلتا +٥١.٥٠٧٢١٧"],
    ["a count", "+١ ٢ ٣ ٤ ٥ ٦ ٧ ٨"],
    ["a date", "UTC +١ ٢٠٢٦-١١-٢٤"],
  ])(
    "leaves %s in another script's digits: %s",
    (_kind: string, text: string) => {
      expect(findPhoneNumberRanges(text)).toEqual([]);
    },
  );

  test("a number in another script's digits is read whole, as one in ASCII is: past fifteen digits it is no number, a group of one after it no part of it", () => {
    expect(
      hiddenBy(findPhoneNumberRanges, "phone +٤٤ ٢٠ ٧٩٤٦ ٠٩٥٨١ end"),
    ).toEqual(["+٤٤ ٢٠ ٧٩٤٦ ٠٩٥٨١"]);
    expect(
      hiddenBy(findPhoneNumberRanges, "phone +44 20 7946 09581 end"),
    ).toEqual(["+44 20 7946 09581"]);
    expect(
      hiddenBy(findPhoneNumberRanges, "phone +٤٤ ٢٠ ٧٩٤٦ ٠٩٥٨ ١٢٣٤ end"),
    ).toEqual([]);
    expect(
      hiddenBy(findPhoneNumberRanges, "phone +44 20 7946 0958 1234 end"),
    ).toEqual([]);
  });

  test("hides each of several numbers in one text, and the text between them stays", () => {
    const text: string =
      "forwarded +44 20 7946 0958 to +49 30 123456 and 555-123-4567, ref 42";

    expect(redact(LogScrubPatternType.PhoneNumber, text)).toBe(
      "forwarded [REDACTED] to [REDACTED] and [REDACTED], ref 42",
    );
  });

  test("replace, matchRanges and test read the same matches", () => {
    const regex: ScrubRegExp = compileBuiltInScrubPattern(
      LogScrubPatternType.PhoneNumber,
    )!;
    const text: string = "to %2B44%2020%207946%200958 and +49 30 123456";

    expect(regex.matchRanges(text)).toEqual(findPhoneNumberRanges(text));
    expect(regex.test(text)).toBe(true);
    expect(regex.test("+51.507217")).toBe(false);
    expect(regex.source).toBe(PHONE.source);
  });
});

/*
 * AN SSN RULE HIDES WHAT DATA SECURITY CALLS A SOCIAL SECURITY NUMBER
 * (#11030): its own pattern's 123-45-6789 as before, and every number the
 * SSN detector finds on its own - its groups set apart by dots or spaces
 * too, by the SSA's rules - as written and in every script's digits.
 */
describe("an SSN rule (#11030)", () => {
  test.each([
    [
      "with dashes, as before",
      "ssn 123-45-6789 on file",
      "ssn [REDACTED] on file",
    ],
    ["with dots", "ssn 536.22.8731 on file", "ssn [REDACTED] on file"],
    ["with spaces", "ssn 536 22 8731 on file", "ssn [REDACTED] on file"],
    ["in Arabic-Indic digits", "الرقم ١٢٣-٤٥-٦٧٨٩", "الرقم [REDACTED]"],
    ["in Persian digits", "شماره ۱۲۳-۴۵-۶۷۸۹", "شماره [REDACTED]"],
    ["in fullwidth digits", "番号 １２３-４５-６７８９", "番号 [REDACTED]"],
    [
      "typed in two scripts",
      "ssn ١٢٣-45-6789 on file",
      "ssn [REDACTED] on file",
    ],
    ["in a JSON string", `{"ssn":"536.22.8731"}`, `{"ssn":"[REDACTED]"}`],
    [
      "in Arabic-Indic digits with dots",
      "الرقم ٥٣٦.٢٢.٨٧٣١",
      "الرقم [REDACTED]",
    ],
  ])(
    "hides a Social Security number %s: %s",
    (_label: string, text: string, scrubbed: string) => {
      expect(redact(LogScrubPatternType.SSN, text)).toBe(scrubbed);
      expectFoundHidden({
        text,
        dataTypeId: "us-ssn",
        findRanges: findSsnRanges,
      });
    },
  );

  test("still hides everything its own pattern hid, numbers no SSN can be among them", () => {
    for (const text of [
      "ssn 123-45-6789",
      "ssn 000-12-3456",
      "ssn 666-12-3456",
      "ssn 987-65-4321",
      "ref 123-45-6789-01",
    ]) {
      expect([text, findSsnRanges(text)]).toEqual([
        text,
        scrubRegExpFromBuiltIn(SSN).matchRanges(text),
      ]);
    }
  });

  test.each([
    ["an area no SSN has", "ssn 000.12.3456"],
    ["the area 666", "ssn 666 12 3456"],
    ["an ITIN's area", "ssn 987.65.4321"],
    ["a group of 00", "ssn 123.00.4567"],
    ["a serial of 0000", "ssn 123 45 0000"],
    ["a longer chain of groups", "ref 123.45.6789.01"],
    ["an address", "peer 123.45.67.89"],
    ["a run of digits", "id 123 45 67890"],
    ["a version", "release 1.22.3333"],
    [
      "nine digits in a row, which only a word beside them makes one",
      "order 123456789",
    ],
    ["a phone number", "call 555-123-4567"],
  ])("leaves %s: %s", (_kind: string, text: string) => {
    expect(findSsnRanges(text)).toEqual(
      scrubRegExpFromBuiltIn(SSN).matchRanges(text),
    );
    expect(findDetectorRanges(US_SSN_DETECTORS, text)).toEqual([]);
  });

  test("replace, matchRanges and test read the same matches", () => {
    const regex: ScrubRegExp = compileBuiltInScrubPattern(
      LogScrubPatternType.SSN,
    )!;
    const text: string = "ssn 123.45.6789 and ١٢٣-٤٥-٦٧٨٩";

    expect(regex.matchRanges(text)).toEqual(findSsnRanges(text));
    expect(regex.test(text)).toBe(true);
    expect(regex.test("ref 123.45.6789.01")).toBe(false);
    expect(regex.source).toBe(SSN.source);
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

  test("an SSN and a Phone Number rule say what their own pattern finds, and hide what it hid", () => {
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

  test("is what a Phone Number rule finds for a phone number, and an SSN rule for a Social Security number", () => {
    const text: string = "call +44 20 7946 0958, ssn 123.45.6789";

    expect(
      compileBuiltInScrubPattern(LogScrubPatternType.PhoneNumber)!.matchRanges(
        text,
      ),
    ).toEqual(findPhoneNumberRanges(text));
    expect(
      compileBuiltInScrubPattern(LogScrubPatternType.SSN)!.matchRanges(text),
    ).toEqual(findSsnRanges(text));
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

  /*
   * #11114: every one of them, those that need a word beside the value
   * too - a national number, nine digits in a row - which a rule judges by
   * the words in the value it reads, as the scanner does.
   */
  test("the phone and SSN detectors it hides are the scanner's own, every one, and those that need a word beside the value among them", () => {
    for (const [dataTypeId, detectors] of [
      ["phone-number", PHONE_NUMBER_DETECTORS],
      ["us-ssn", US_SSN_DETECTORS],
    ] as Array<[string, ReadonlyArray<DataTypeDetector>]>) {
      const scanners: Array<DataTypeDetector> = [
        ...getBuiltInDetectorsOf(dataTypeId),
      ];

      expect(scanners).toEqual([...detectors]);
      expect(
        scanners.some((detector: DataTypeDetector) => {
          return detector.requiresContext === true;
        }),
      ).toBe(true);
      expect(
        scanners.every((detector: DataTypeDetector) => {
          return (
            detector.readsDigitsOfEveryScript === true &&
            detector.readsFullwidthForms === true
          );
        }),
      ).toBe(true);
    }

    // The very phone detectors the scanner runs, not copies of them.
    getBuiltInDetectorsOf("phone-number").forEach(
      (detector: DataTypeDetector, index: number): void => {
        expect(detector).toBe(PHONE_NUMBER_DETECTORS[index]);
      },
    );

    expect(
      getBuiltInDetectorsOf("phone-number").every(
        (detector: DataTypeDetector) => {
          return detector.readsPercentEncoded === true;
        },
      ),
    ).toBe(true);
  });
});

const IDEOGRAPHIC_SPACE: string = "　";

// Every reading a number's rule reads its own pattern in.
const EVERY_READING_OF_A_NUMBER: ReadingNeeds = {
  readsPercentEncoded: true,
  readsDigitsOfEveryScript: true,
  readsPlusAsSpace: true,
  readsFullwidthForms: true,
};

// What a rule's own pattern hides in every reading of a number, and nothing else.
function ownPatternRanges(pattern: RegExp, text: string): Array<TextRange> {
  return findInEveryReading({
    text,
    needs: EVERY_READING_OF_A_NUMBER,
    findIn: (reading: string): Array<TextRange> => {
      return scrubRegExpFromBuiltIn(pattern).matchRanges(reading);
    },
  });
}

// A text typed wholly in fullwidth: its digits, its signs and separators, its spaces.
function inFullwidth(text: string): string {
  let written: string = "";

  for (const character of text) {
    const code: number = character.charCodeAt(0);

    if (character === " ") {
      written += IDEOGRAPHIC_SPACE;
    } else if ((code >= 0x30 && code <= 0x39) || "+-()./".includes(character)) {
      written += String.fromCharCode(code - 0x20 + 0xff00);
    } else {
      written += character;
    }
  }

  return written;
}

/*
 * #11115: a number typed wholly in fullwidth, as Japanese and Chinese text
 * writes one - its digits, its plus sign, hyphens, parentheses, full stops
 * and ideographic spaces - is the number it reads as, to every rule built
 * on the detectors: hidden whole, as it is written.
 */
describe("a Phone Number rule, a number typed wholly in fullwidth (#11115)", () => {
  test.each([
    [
      "its groups apart by hyphens",
      "電話：＋８１ ３－１２３４－５６７８ 自宅",
      "電話：[REDACTED] 自宅",
    ],
    [
      "an ideographic space after its calling code",
      `電話：＋８１${IDEOGRAPHIC_SPACE}３－１２３４－５６７８`,
      "電話：[REDACTED]",
    ],
    [
      "its groups apart by ideographic spaces",
      `手机 ${inFullwidth("+86 138 0013 8241")}`,
      "手机 [REDACTED]",
    ],
    ["its digits in ASCII", "電話：＋81 3－1234－5678", "電話：[REDACTED]"],
    [
      "a North American number, its area code in fullwidth parentheses",
      "電話：（４１５）３２１－８７３１",
      "電話：[REDACTED]",
    ],
    [
      "one with an ideographic space after its area code",
      `電話：（４１５）${IDEOGRAPHIC_SPACE}３２１－８７３１`,
      "電話：[REDACTED]",
    ],
    [
      "a UK mobile",
      `携帯 ０７９１１${IDEOGRAPHIC_SPACE}１２３４５６`,
      "携帯 [REDACTED]",
    ],
    [
      "its calling code in fullwidth parentheses",
      "（＋４４）２０ ７９４６ ０９５８",
      // The parenthesis before the "+" is no part of it, as in ASCII.
      "（[REDACTED]",
    ],
    [
      "in a URL, each fullwidth character's UTF-8 bytes escaped",
      `GET /callback?phone=${encodeURIComponent("＋８１ ３－１２３４－５６７８")} HTTP/1.1`,
      "GET /callback?phone=[REDACTED] HTTP/1.1",
    ],
    [
      "typed into a form, its spaces '+' and its fullwidth signs escaped",
      "GET /callback?phone=%EF%BC%8B81+3%EF%BC%8D1234%EF%BC%8D5678 HTTP/1.1",
      "GET /callback?phone=[REDACTED] HTTP/1.1",
    ],
    [
      "in a JSON string",
      `{"tel":"＋８１ ３－１２３４－５６７８"}`,
      `{"tel":"[REDACTED]"}`,
    ],
  ])("hides one %s: %s", (_label: string, text: string, scrubbed: string) => {
    expect(redact(LogScrubPatternType.PhoneNumber, text)).toBe(scrubbed);
    expectFoundHidden({
      text,
      dataTypeId: "phone-number",
      findRanges: findPhoneNumberRanges,
    });
  });

  test.each([
    ["a decimal", `delta ${inFullwidth("+51.507217")} out of range`],
    [
      "a time zone's offset beside a date",
      `at UTC ${inFullwidth("+1 2026-11-24")} ok`,
    ],
    ["a count", `counted ${inFullwidth("+1 2 3 4 5 6 7 8")} ok`],
    ["a coordinate pair", `at ${inFullwidth("+40.6894-074.0447")} ok`],
    ["an address", `peer ${inFullwidth("+192.168.100.200")} refused`],
    [
      "fifteen digits and more",
      `id ${inFullwidth("+44 20 7946 0958 12 34")} ok`,
    ],
    ["a Japanese number with no plus sign", "電話：（０３）１２３４－５６７８"],
    ["CJK prose", `（注）設定を確認してください。${IDEOGRAPHIC_SPACE}以上。`],
  ])("leaves %s, as in ASCII: %s", (_kind: string, text: string) => {
    expect(findPhoneNumberRanges(text)).toEqual(ownPatternRanges(PHONE, text));
    expect(findDetectorRanges(PHONE_NUMBER_DETECTORS, text)).toEqual([]);
  });
});

/*
 * #11114: a national phone number of 9 to 12 digits, with no other shape,
 * is a phone number to Data Security only beside a word that names it.
 * The rule hides it there - judged by the words in the value it reads, as
 * the scanner judges them - and nowhere else.
 */
describe("a Phone Number rule, a national number beside the word that names it (#11114)", () => {
  test.each([
    ["after tel", "tel 02012345678 ok", "tel [REDACTED] ok"],
    ["after Tel: in capitals", "Tel: 02012345678", "Tel: [REDACTED]"],
    [
      "after phone=",
      "user phone=02012345678 saved",
      "user phone=[REDACTED] saved",
    ],
    [
      "of twelve digits after mobile",
      "mobile 447911123456",
      "mobile [REDACTED]",
    ],
    ["of nine digits after cell", "cell: 201234567", "cell: [REDACTED]"],
    ["after fax", "fax 02012345678", "fax [REDACTED]"],
    ["after contact", "contact 02012345678", "contact [REDACTED]"],
    ["after a word that follows it", "02012345678 (tel)", "[REDACTED] (tel)"],
    [
      "in a JSON text, its key the word",
      `{"tel":"02012345678"}`,
      `{"tel":"[REDACTED]"}`,
    ],
    [
      "in a URL, its = escaped",
      "GET /x?phone%3D02012345678 HTTP/1.1",
      "GET /x?phone%3D[REDACTED] HTTP/1.1",
    ],
    [
      "in a URL, its words typed into a form",
      "GET /x?phone+number=02012345678 HTTP/1.1",
      "GET /x?phone+number=[REDACTED] HTTP/1.1",
    ],
    [
      "the word's letters escaped",
      "%74%65%6C=02012345678",
      "%74%65%6C=[REDACTED]",
    ],
    ["in fullwidth digits", "tel ０２０１２３４５６７８", "tel [REDACTED]"],
    [
      "in fullwidth, after a fullwidth colon and an ideographic space",
      `tel：${IDEOGRAPHIC_SPACE}０２０１２３４５６７８`,
      `tel：${IDEOGRAPHIC_SPACE}[REDACTED]`,
    ],
    ["in Arabic-Indic digits", "tel ٠٢٠١٢٣٤٥٦٧٨", "tel [REDACTED]"],
  ])(
    "hides a national number %s: %s",
    (_label: string, text: string, scrubbed: string) => {
      expect(redact(LogScrubPatternType.PhoneNumber, text)).toBe(scrubbed);
      expectFoundHidden({
        text,
        dataTypeId: "phone-number",
        findRanges: findPhoneNumberRanges,
      });
    },
  );

  test.each([
    ["no word that names it", "order 02012345678 ok"],
    ["a word inside another", "telemetry 02012345678 ok"],
    ["a word inside another, before it", "hotel 02012345678 ok"],
    ["a word inside another, the word first", "callback 02012345678 ok"],
    ["its word too far before it", `tel ${"x".repeat(30)} 02012345678`],
    ["its word too far after it", `02012345678 ${"x".repeat(8)} tel`],
    ["too many digits", "tel 02012345678901234 ok"],
    ["one digit repeated", "tel 111111111 ok"],
    ["a reference beside no word", "ref 201234567 ok"],
  ])("leaves a number with %s: %s", (_kind: string, text: string) => {
    expect(findPhoneNumberRanges(text)).toEqual(ownPatternRanges(PHONE, text));
  });

  test("its own pattern still hides any ten digits, beside a word or not, as it always has", () => {
    for (const text of ["order 0201234567", "tel 0201234567"]) {
      expect(redact(LogScrubPatternType.PhoneNumber, text)).toBe(
        text.replace("0201234567", "[REDACTED]"),
      );
    }
  });
});

describe("an SSN rule, typed wholly in fullwidth (#11115)", () => {
  test.each([
    [
      "its groups apart by fullwidth hyphens",
      "SSN ５３６－２２－８７３１ ok",
      "SSN [REDACTED] ok",
    ],
    [
      "its groups apart by fullwidth full stops",
      "SSN ５３６．２２．８７３１ ok",
      "SSN [REDACTED] ok",
    ],
    [
      "its groups apart by ideographic spaces",
      `SSN ５３６${IDEOGRAPHIC_SPACE}２２${IDEOGRAPHIC_SPACE}８７３１ ok`,
      "SSN [REDACTED] ok",
    ],
    ["its digits in ASCII", "SSN 536－22－8731 ok", "SSN [REDACTED] ok"],
    [
      "in a URL, its bytes escaped",
      `GET /verify?ssn=${encodeURIComponent("５３６－２２－８７３１")} HTTP/1.1`,
      "GET /verify?ssn=[REDACTED] HTTP/1.1",
    ],
  ])("hides one %s: %s", (_label: string, text: string, scrubbed: string) => {
    expect(redact(LogScrubPatternType.SSN, text)).toBe(scrubbed);
    expectFoundHidden({
      text,
      dataTypeId: "us-ssn",
      findRanges: findSsnRanges,
    });
  });

  test.each([
    ["the area 666", "SSN ６６６．２２．８７３１"],
    ["a longer chain of groups", "ref ５３６．２２．８７３１．０１"],
    ["a placeholder", "SSN １２３．４５．６７８９"],
    [
      "a group of 00",
      `SSN ５３６${IDEOGRAPHIC_SPACE}００${IDEOGRAPHIC_SPACE}８７３１`,
    ],
  ])("leaves %s, as in ASCII: %s", (_kind: string, text: string) => {
    expect(findSsnRanges(text)).toEqual(ownPatternRanges(SSN, text));
    expect(findDetectorRanges(US_SSN_DETECTORS, text)).toEqual([]);
  });
});

describe("an SSN rule, nine digits beside the word that names them (#11114)", () => {
  test.each([
    ["after SSN", "SSN 536221234 ok", "SSN [REDACTED] ok"],
    ["after ssn:", "ssn: 536221234", "ssn: [REDACTED]"],
    [
      "after social security",
      "social security 536221234",
      "social security [REDACTED]",
    ],
    [
      "after social security number",
      "Social Security Number: 536221234",
      "Social Security Number: [REDACTED]",
    ],
    ["after soc sec", "soc sec 536221234", "soc sec [REDACTED]"],
    ["after ss no", "ss no 536221234", "ss no [REDACTED]"],
    [
      "in a JSON text, its key the word",
      `{"ssn":"536221234"}`,
      `{"ssn":"[REDACTED]"}`,
    ],
    ["after a word that follows it", "536221234 (ssn)", "[REDACTED] (ssn)"],
    [
      "in a URL, its = escaped",
      "GET /verify?ssn%3D536221234 HTTP/1.1",
      "GET /verify?ssn%3D[REDACTED] HTTP/1.1",
    ],
    [
      "in a URL, its words typed into a form",
      "GET /apply?social+security+number=536221234 HTTP/1.1",
      "GET /apply?social+security+number=[REDACTED] HTTP/1.1",
    ],
    ["in Arabic-Indic digits", "SSN ٥٣٦٢٢١٢٣٤", "SSN [REDACTED]"],
    ["in fullwidth digits", "SSN ５３６２２１２３４", "SSN [REDACTED]"],
    [
      "in fullwidth, after an ideographic space",
      `SSN${IDEOGRAPHIC_SPACE}５３６２２１２３４`,
      `SSN${IDEOGRAPHIC_SPACE}[REDACTED]`,
    ],
    [
      "its words apart by ideographic spaces",
      `social${IDEOGRAPHIC_SPACE}security${IDEOGRAPHIC_SPACE}５３６２２１２３４`,
      `social${IDEOGRAPHIC_SPACE}security${IDEOGRAPHIC_SPACE}[REDACTED]`,
    ],
  ])(
    "hides nine digits %s: %s",
    (_label: string, text: string, scrubbed: string) => {
      expect(redact(LogScrubPatternType.SSN, text)).toBe(scrubbed);
      expectFoundHidden({
        text,
        dataTypeId: "us-ssn",
        findRanges: findSsnRanges,
      });
    },
  );

  test.each([
    ["no word that names them", "ref 536221234 ok"],
    ["a word inside another", "ssns 536221234 ok"],
    ["an area never issued", "SSN 666221234"],
    ["no area", "SSN 000221234"],
    ["an ITIN's area", "SSN 950221234"],
    ["a group of 00", "SSN 536001234"],
    ["a serial of 0000", "SSN 536220000"],
    ["a placeholder", "SSN 123456789"],
    ["ten digits", "SSN 5362212345"],
    ["eight digits", "SSN 53622123"],
    ["their word too far before them", `SSN ${"x".repeat(62)} 536221234`],
    ["their word too far after them", `536221234 ${"x".repeat(30)} ssn`],
    ["a longer run of digits around them", "SSN 12-536221234-7"],
  ])("leaves nine digits with %s: %s", (_kind: string, text: string) => {
    expect(findSsnRanges(text)).toEqual(ownPatternRanges(SSN, text));
  });
});

describe("a Credit Card rule, a card typed wholly in fullwidth (#11115)", () => {
  test.each([
    [
      "its groups apart by fullwidth hyphens",
      "カード ４５３２－０１５１－１２８３－０３６６",
      "カード [REDACTED]",
    ],
    [
      "its groups apart by ideographic spaces",
      `カード ${inFullwidth("4532 0151 1283 0366")}`,
      "カード [REDACTED]",
    ],
    [
      "its digits in ASCII",
      "カード 4532－0151－1283－0366",
      "カード [REDACTED]",
    ],
    [
      "an American Express card",
      `カード ${inFullwidth("3782-822463-10005")}`,
      "カード [REDACTED]",
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

  test("leaves a number of no card's length", () => {
    const text: string = "注文 ４１１１－１１１１";

    expect(findCardNumberRanges(text)).toEqual(ownPatternRanges(CARD, text));
    expect(findDetectorRanges(CARD_NUMBER_DETECTORS, text)).toEqual([]);
  });
});

/*
 * A text typed wholly in fullwidth is the text typed in ASCII to every
 * number's rule: each fullwidth character is one unit as its ASCII one
 * is, so the rule hides the very same positions of it.
 */
describe("a number's rule hides a text typed wholly in fullwidth where it hides the text in ASCII (#11115)", () => {
  test.each([
    [LogScrubPatternType.PhoneNumber, findPhoneNumberRanges],
    [LogScrubPatternType.SSN, findSsnRanges],
    [LogScrubPatternType.CreditCard, findCardNumberRanges],
  ] as Array<[string, (text: string) => Array<TextRange>]>)(
    "%s",
    (_patternType: string, findRanges: (text: string) => Array<TextRange>) => {
      for (const text of [
        "call +44 20 7946 0958 or +81 3-1234-5678 now",
        "call (415) 321-8731, +33 6 12 34 56 78 and 07911 123456",
        "tel 02012345678 but order 02012345678",
        "delta +51.507217 at UTC +1 2026-11-24, counted +1 2 3 4 5 6 7 8",
        "ssn 536-22-8731, 536.22.8731 and 536 22 8731, SSN 536221234",
        "ref 536221234, ssn 666.22.8731, ref 536.22.8731.01",
        "card 4532 0151 1283 0366 and 4532-0151-1283-0366, amex 3782 822463 10005",
        "order 4111 1111, total 1234.56",
      ]) {
        expect([text, findRanges(inFullwidth(text))]).toEqual([
          text,
          findRanges(text),
        ]);
      }
    },
  );
});
