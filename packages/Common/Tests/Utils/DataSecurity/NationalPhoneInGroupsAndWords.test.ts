import { describe, expect, test } from "@jest/globals";
import ToolResultSerializer from "../../../Server/Utils/AI/Toolbox/Serializer";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import {
  ScrubRegExp,
  scrubRegExpFromBuiltIn,
  SCRUB_RULE_BUILT_IN_PATTERNS,
} from "../../../Types/Telemetry/ScrubRule";
import {
  isWrittenAsNationalPhoneNumber,
  PHONE_NUMBER_DETECTORS,
} from "../../../Utils/DataSecurity/Detectors/ContactDetectors";
import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import {
  findDetectorRanges,
  TextRange,
} from "../../../Utils/DataSecurity/TextReadings";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";
import { compileBuiltInScrubPattern } from "../../../Utils/Telemetry/ScrubBuiltInPatterns";

/*
 * ---------------------------------------------------------------------------
 * A NATIONAL PHONE NUMBER IN GROUPS BESIDE ITS WORD (#11493), AND WHAT
 * "CALL", "CELL" AND "CONTACT" SAY OF A RUN OF DIGITS (#11496).
 *
 * A national number - one with no calling code - was found only as one
 * run of 9 to 12 digits beside a word that names it, so tel 03-1234-5678
 * (Tokyo), phone 020 3123 4567 (London) and tel 03ー1234ー5678 were kept by
 * Data Security and by a Phone Number rule. Written in two to five groups
 * set apart by one separator, or after an area code in parentheses, it is
 * now one - and dates, times, versions, ranges, IPv4 addresses and counts
 * beside the same words are none.
 *
 * And nine to twelve digits after "call", "cell" or "contact" were a phone
 * number, so a Unix time after "call started at" and a size after "cell"
 * were reported, redacted in AI tool results and hidden by the rule's
 * detectors. Those words now name a number only with a word after them
 * that names one ("call me on", "contact number"), or before a national
 * number dialled with its trunk prefix, 0.
 * ---------------------------------------------------------------------------
 */

const PHONE: ScrubRegExp = compileBuiltInScrubPattern(
  LogScrubPatternType.PhoneNumber,
)!;

// What Data Security finds of a phone number in a text, as written.
function phonesIn(text: string): Array<string> {
  return findSensitiveValues(text)
    .filter((match: TextMatch): boolean => {
      return match.dataTypeId === "phone-number";
    })
    .map((match: TextMatch): string => {
      return text.slice(match.start, match.end);
    });
}

// What the phone detectors alone find, as a rule built on them finds it.
function detectorPhonesIn(text: string): Array<string> {
  return findDetectorRanges(PHONE_NUMBER_DETECTORS, text).map(
    ([start, end]: TextRange): string => {
      return text.slice(start, end);
    },
  );
}

function redacted(text: string): string {
  return PHONE.replace(text, (): string => {
    return "[REDACTED]";
  });
}

// What the rule's own pattern finds, as it always did: any ten digits, North American shapes.
function ownPatternRanges(text: string): Array<TextRange> {
  return scrubRegExpFromBuiltIn(
    SCRUB_RULE_BUILT_IN_PATTERNS[LogScrubPatternType.PhoneNumber]!,
  ).matchRanges(text);
}

describe("a national number in the groups people write it in, beside its word (#11493)", () => {
  test.each([
    [
      "Tokyo, its groups set apart by hyphens",
      "tel 03-1234-5678",
      "03-1234-5678",
    ],
    ["London, by spaces", "phone 020 3123 4567", "020 3123 4567"],
    [
      "London, by spaces, the word after it",
      "020 3123 4567 (phone)",
      "020 3123 4567",
    ],
    [
      "Paris, in pairs set apart by spaces",
      "mobile 06 12 34 56 78",
      "06 12 34 56 78",
    ],
    [
      "Paris, in pairs set apart by dots",
      "fax 01.42.68.53.07",
      "01.42.68.53.07",
    ],
    ["Madrid, its first group of three", "tel 612 34 56 78", "612 34 56 78"],
    ["Madrid, in threes", "whatsapp 612 345 678", "612 345 678"],
    ["Berlin, two groups", "telephone 030 12345678", "030 12345678"],
    [
      "Sydney, its area code in parentheses",
      "phone (02) 9123 4567",
      "(02) 9123 4567",
    ],
    [
      "Sydney, its area code in parentheses and a hyphen",
      "tel (02) 9123-4567",
      "(02) 9123-4567",
    ],
    ["Amsterdam, two groups and a hyphen", "sms 06-12345678", "06-12345678"],
    ["a word in capitals", "TEL: 03-1234-5678", "03-1234-5678"],
    ["after a key's colon in JSON", '{"tel":"03-1234-5678"}', "03-1234-5678"],
    [
      "beside a word that names it by itself, cellphone",
      "cellphone 0612 345 678",
      "0612 345 678",
    ],
  ])("finds %s: %s", (_label: string, text: string, number: string) => {
    expect(phonesIn(text)).toEqual([number]);
    expect(detectorPhonesIn(text)).toEqual([number]);
    expect(redacted(text)).toBe(text.replace(number, "[REDACTED]"));
  });

  test.each([
    [
      "the prolonged sound mark a number typed in Japanese is set apart by",
      "tel 03ー1234ー5678",
      "03ー1234ー5678",
    ],
    ["the halfwidth prolonged sound mark", "tel 03ｰ1234ｰ5678", "03ｰ1234ｰ5678"],
    ["an en dash", "phone 020–3123–4567", "020–3123–4567"],
    ["a non-breaking hyphen", "tel 03‑1234‑5678", "03‑1234‑5678"],
    [
      "fullwidth digits and hyphens",
      "tel ０３－１２３４－５６７８",
      "０３－１２３４－５６７８",
    ],
    [
      "fullwidth digits and an ideographic space",
      "電話 tel ０２０　３１２３　４５６７",
      "０２０　３１２３　４５６７",
    ],
    ["Arabic-Indic digits", "tel ٠٣-١٢٣٤-٥٦٧٨", "٠٣-١٢٣٤-٥٦٧٨"],
  ])(
    "finds one set apart by %s: %s",
    (_label: string, text: string, number: string) => {
      expect(phonesIn(text)).toEqual([number]);
      expect(redacted(text)).toBe(text.replace(number, "[REDACTED]"));
    },
  );

  test.each([
    [
      "percent-encoded",
      "GET /x?phone=03%2D1234%2D5678 HTTP/1.1",
      "03%2D1234%2D5678",
    ],
    [
      "as a form writes its spaces",
      "GET /x?tel=020+3123+4567 HTTP/1.1",
      "020+3123+4567",
    ],
    [
      "its words typed into a form",
      "GET /x?phone+number=03-1234-5678 HTTP/1.1",
      "03-1234-5678",
    ],
  ])(
    "finds one in a URL, %s: %s",
    (_label: string, text: string, number: string) => {
      expect(phonesIn(text)).toEqual([number]);
      expect(redacted(text)).toBe(text.replace(number, "[REDACTED]"));
    },
  );

  test.each([
    ["a date", "tel 2026-11-28 ok"],
    ["a date and its time", "tel 2026-11-28 10:30:00 ok"],
    ["a date written day first", "phone 28.11.2026 ok"],
    ["a date written month first", "phone 11-28-2026 ok"],
    ["a date with a time after it in its groups", "tel 2026-11-28-1030 ok"],
    ["a time", "phone 10:30:00 ok"],
    ["a version", "tel version 1.2.3 ok"],
    ["a build of a version", "tel 10.0.19045.2965 ok"],
    ["a range of pages", "phone pages 10-20 ok"],
    ["a range of two numbers of one length", "tel 10000-20000 ok"],
    ["an IPv4 address", "tel 192.168.100.200 ok"],
    ["counts of two digits", "phone counts 10 20 30 40 50 ok"],
    ["too few digits", "tel 03-1234 ok"],
    ["too many digits", "tel 03-1234-5678-9012-3456 ok"],
    ["one digit repeated", "tel 11-1111-1111 ok"],
    ["groups of one digit", "tel 0 3 1 2 3 4 5 6 7 8 ok"],
    ["no word that names it", "order 03-1234-5678 ok"],
    ["a word inside another", "hotel 03-1234-5678 ok"],
    ["its word too far before it", `tel ${"x".repeat(30)} 03-1234-5678`],
    ["groups glued to a letter", "tel A03-1234-5678 ok"],
    [
      "groups after a plus sign that is no calling code",
      "tel +03-1234-5678 ok",
    ],
    // A US Social Security number's own groups, three, two and four.
    ["an SSN's groups by hyphens", "tel 666-22-8731 ok"],
    ["an SSN's groups by dots", "phone 536.22.8731 ok"],
    ["an SSN's groups by spaces", "mobile 536 22 8731 ok"],
  ])("finds none in %s: %s", (_label: string, text: string) => {
    expect(phonesIn(text)).toEqual([]);
    expect(detectorPhonesIn(text)).toEqual([]);
    // The rule hides only what its own pattern always found there.
    expect(PHONE.matchRanges(text)).toEqual(ownPatternRanges(text));
  });

  test("a number in groups followed by another group is never cut short", () => {
    // The groups run on past what a phone number holds: none of it is one.
    expect(phonesIn("tel 020 3123 4567 8901 ok")).toEqual([]);
    // But one followed by a word is one.
    expect(phonesIn("tel 020 3123 4567 ok 8901")).toEqual(["020 3123 4567"]);
  });

  test("a number set aside for fiction is counted apart, as a test value", () => {
    const matches: Array<TextMatch> = findSensitiveValues(
      "phone 020 7946 0958 ok",
    );

    expect(
      matches.map((match: TextMatch): [string, boolean] => {
        return [match.dataTypeId, match.isTestValue];
      }),
    ).toEqual([["phone-number", true]]);
  });
});

describe("isWrittenAsNationalPhoneNumber (#11493)", () => {
  test.each([
    ["0312345678", "03-1234-5678"],
    ["02031234567", "020 3123 4567"],
    ["0612345678", "06 12 34 56 78"],
    ["612345678", "612 34 56 78"],
    ["0291234567", "(02) 9123 4567"],
    ["0612345678", "06-12345678"],
  ])("takes %s written %s", (digits: string, raw: string) => {
    expect(isWrittenAsNationalPhoneNumber(digits, raw)).toBe(true);
  });

  test.each([
    ["20261128", "2026-11-28", "too few digits"],
    ["2026112810", "2026-11-28-10", "a date first"],
    ["2811202610", "28.11.2026.10", "a date day first"],
    ["1128202610", "11-28-2026-10", "a date month first"],
    ["192168100200", "192.168.100.200", "an IPv4 address"],
    ["1000020000", "10000-20000", "a range"],
    ["1020304050", "10 20 30 40 50", "counts"],
    ["1111111111", "11-1111-1111", "one digit repeated"],
    ["1234567890", "123-456-7890", "a straight run"],
    ["0312345678901", "03-1234-5678-901", "too many digits"],
    ["0312345678", "0312345678", "one run: no groups"],
    ["536228731", "536-22-8731", "a Social Security number's groups"],
    ["536228731", "536.22.8731", "a Social Security number's groups by dots"],
    [
      "012345678",
      "012 34 5678",
      "a Social Security number's groups, a 0 first",
    ],
    [
      "71848763058",
      "(718) 487-63058",
      "a North American area code, the North American detector's",
    ],
    [
      "7184876305",
      "(718) 487 6305",
      "a North American number, the North American detector's",
    ],
  ])("refuses %s written %s: %s", (digits: string, raw: string) => {
    expect(isWrittenAsNationalPhoneNumber(digits, raw)).toBe(false);
  });

  test.each([
    ["11912345678", "(11) 91234-5678", "Brazil's two-digit area code"],
    ["5512345678", "(55) 1234 5678", "Mexico City's"],
    ["02012345678", "(020) 1234 5678", "an area code with its trunk prefix"],
  ])("takes %s written %s: %s", (digits: string, raw: string) => {
    expect(isWrittenAsNationalPhoneNumber(digits, raw)).toBe(true);
  });

  test("a malformed North American number beside its word is no phone number, and a proper one still is", () => {
    expect(phonesIn("tel (718) 487-63058 ok")).toEqual([]);
    expect(redacted("GET /contact?tel=%28718%29+487-63058")).toBe(
      "GET /contact?tel=%28718%29+487-63058",
    );
    // The North American detector's own: three digits, then four.
    const northAmerican: Array<string> = phonesIn("tel (718) 487-6305 ok");

    expect(northAmerican).toHaveLength(1);
    expect(northAmerican[0]).toContain("718) 487-6305");
    // Brazil writes its two-digit area code so.
    expect(phonesIn("tel (11) 91234-5678 ok")).toEqual(["(11) 91234-5678"]);
  });

  test("groups of an SSN's lengths in another order, or more of them, are still a phone number's", () => {
    // Korea's 02-123-4567, two, three and four.
    expect(isWrittenAsNationalPhoneNumber("021234567", "02-123-4567")).toBe(
      true,
    );
    // Four groups, the first two of an SSN's lengths.
    expect(
      isWrittenAsNationalPhoneNumber("61234567890", "612 34 567 890"),
    ).toBe(true);
  });

  /*
   * An SSN a phone word is near is the SSN rule's to mask: before this
   * check, the Phone Number rule read 536.22.8731 beside "phone" as a
   * national number and hid it first.
   */
  test("an SSN a phone word is near is left to the SSN rule", () => {
    const ssn: ScrubRegExp = compileBuiltInScrubPattern(
      LogScrubPatternType.SSN,
    )!;
    const text: string = "call to phone 201234567 for SSN 536.22.8731 failed";
    const afterPhone: string = redacted(text);

    expect(afterPhone).toBe(
      "call to phone [REDACTED] for SSN 536.22.8731 failed",
    );
    expect(
      ssn.replace(afterPhone, (): string => {
        return "[SSN]";
      }),
    ).toBe("call to phone [REDACTED] for SSN [SSN] failed");
    // Data Security calls it what it is.
    expect(
      findSensitiveValues(text)
        .filter((match: TextMatch): boolean => {
          return text.slice(match.start, match.end) === "536.22.8731";
        })
        .map((match: TextMatch): string => {
          return match.dataTypeId;
        }),
    ).toEqual(["us-ssn"]);
  });

  test("a range of two numbers of unlike lengths, or with a trunk prefix, is a phone number", () => {
    expect(
      isWrittenAsNationalPhoneNumber("061234567890", "06-1234567890"),
    ).toBe(true);
    expect(isWrittenAsNationalPhoneNumber("0201234567", "02012-34567")).toBe(
      true,
    );
  });

  test("an address of four groups no octet is, is a phone number", () => {
    expect(isWrittenAsNationalPhoneNumber("0612345678", "06.123.456.78")).toBe(
      true,
    );
    // A public IPv4 address of four octets is never one, whichever octet is short.
    expect(isWrittenAsNationalPhoneNumber("2030113200", "203.0.113.200")).toBe(
      false,
    );
  });
});

describe('"call", "cell" and "contact" name a phone number only with more (#11496)', () => {
  test.each([
    ["a Unix time after call", "call started at 1732752000 ok"],
    ["a Unix time just after call", "call 1732752000 ok"],
    [
      "a Unix time in milliseconds after call",
      "call started at 1732752000123 ok",
    ],
    ["a size in bytes after cell", "cell 104857600 bytes"],
    ["a count after cell", "cell: 201234567"],
    ["an id after contact", "contact 123456789012 created"],
    ["an id in JSON after contact", '{"contact": 482910374615}'],
    ["a number after callback, no word", "callback 2012345678 queued"],
    ["a grouped count after cell", "cell 104 857 600 bytes"],
  ])("finds no phone number in %s: %s", (_label: string, text: string) => {
    expect(phonesIn(text)).toEqual([]);
    expect(detectorPhonesIn(text)).toEqual([]);
  });

  test.each([
    [
      "a national number after call me on",
      "please call me on 2012345678 tomorrow",
      "2012345678",
    ],
    ["after call me at", "call me at 612345678", "612345678"],
    ["after call us on", "call us on 2012345678", "2012345678"],
    ["after call back on", "call back on 2012345678", "2012345678"],
    ["after callback number", "callback number: 2012345678", "2012345678"],
    ["after contact number", '{"contact number": "612345678"}', "612345678"],
    ["after contact no", "contact no. 612345678", "612345678"],
    ["after cell number", "cell number: 201234567", "201234567"],
    ["after cell #", "cell # 201234567", "201234567"],
    [
      "a national number with its trunk prefix after cell",
      "support cell: 0612345678",
      "0612345678",
    ],
    ["with its trunk prefix after call", "call 02031234567 now", "02031234567"],
    [
      "with its trunk prefix after contact",
      "contact 02012345678",
      "02012345678",
    ],
    [
      "in groups with its trunk prefix after call",
      "call 020 3123 4567 queued",
      "020 3123 4567",
    ],
    [
      "in groups with its trunk prefix after contact",
      "contact: 03-1234-5678",
      "03-1234-5678",
    ],
  ])("finds %s: %s", (_label: string, text: string, number: string) => {
    expect(phonesIn(text)).toEqual([number]);
    expect(detectorPhonesIn(text)).toEqual([number]);
    expect(redacted(text)).toContain("[REDACTED]");
    expect(redacted(text)).not.toContain(number);
  });

  test("the words that name a phone number by themselves still need nothing more", () => {
    for (const word of [
      "phone",
      "telephone",
      "tel",
      "mobile",
      "cellphone",
      "sms",
      "whatsapp",
      "fax",
    ]) {
      expect([word, phonesIn(`${word} 2012345678 ok`)]).toEqual([
        word,
        ["2012345678"],
      ]);
    }
  });

  test("a phone number of its own shape after call, cell or contact is still one, and still surer beside it", () => {
    for (const text of [
      "call +44 20 3123 4567 now",
      "cell (415) 555-2671",
      "contact 07911 123456",
    ]) {
      expect([text, phonesIn(text).length]).toEqual([text, 1]);
    }
  });

  test("each detector of a national number asks for the words it needs, in lower case", () => {
    const national: ReadonlyArray<DataTypeDetector> =
      PHONE_NUMBER_DETECTORS.filter((detector: DataTypeDetector): boolean => {
        return Boolean(detector.requiresContext);
      });

    expect(national).toHaveLength(3);

    const [bare, grouped, trunk] = national as [
      DataTypeDetector,
      DataTypeDetector,
      DataTypeDetector,
    ];

    for (const detector of [bare, grouped]) {
      expect(detector.keywords).toEqual(
        expect.arrayContaining([
          "phone",
          "tel",
          "call me on",
          "contact number",
        ]),
      );
      expect(detector.keywords).not.toContain("call");
      expect(detector.keywords).not.toContain("cell");
      expect(detector.keywords).not.toContain("contact");
    }

    expect(trunk.keywords).toEqual(["call", "cell", "contact"]);
  });
});

describe("AI tool results redact what Data Security finds, and keep the numbers a model needs (#11493, #11496)", () => {
  function redactedForAi(text: string): string {
    return ToolResultSerializer.redact(text).text;
  }

  test.each([
    ["tel 03-1234-5678 ok", "tel [redacted-phone] ok"],
    ["phone 020 3123 4567", "phone [redacted-phone]"],
    ["tel 03ー1234ー5678", "tel [redacted-phone]"],
    ["call me on 2012345678", "call me on [redacted-phone]"],
    ["support cell: 0612345678", "support cell: [redacted-phone]"],
  ])("redacts %s", (text: string, expected: string) => {
    expect(redactedForAi(text)).toBe(expected);
  });

  test.each([
    "call started at 1732752000 ok",
    "call 1732752000123 ended",
    "cell 104857600 bytes",
    "contact 123456789012 created",
    "tel 2026-11-28 10:30:00",
    "phone version 1.2.3",
    "phone pages 10-20",
    "tel 192.168.100.200",
  ])("keeps %s as it is", (text: string) => {
    expect(redactedForAi(text)).toBe(text);
  });
});
