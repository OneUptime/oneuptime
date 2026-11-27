import { describe, expect, test } from "@jest/globals";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import { ScrubRegExp } from "../../../Types/Telemetry/ScrubRule";
import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import { DIGIT_ZEROS } from "../../../Utils/DataSecurity/DigitReadings";
import {
  EMAIL_ADDRESS_DETECTORS,
  PHONE_NUMBER_DETECTORS,
} from "../../../Utils/DataSecurity/Detectors/ContactDetectors";
import { getBuiltInDetectorsOf } from "../../../Utils/DataSecurity/Detectors/Index";
import { CARD_NUMBER_DETECTORS } from "../../../Utils/DataSecurity/Detectors/FinancialDetectors";
import { US_SSN_DETECTORS } from "../../../Utils/DataSecurity/Detectors/GovernmentIdDetectors";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";
import { compileBuiltInScrubPattern } from "../../../Utils/Telemetry/ScrubBuiltInPatterns";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * AN EMAIL ADDRESS, CARD, PHONE NUMBER OR SSN RULE, AND THE SCANNER, READ A
 * TEXT IN TIME IN LINE WITH ITS LENGTH, WHATEVER WAYS THEY READ IT (#10935,
 * #10960, #11030).
 *
 * The Email Address rule reads a text as written and with its escapes read,
 * with its own pattern and the email detectors - one of them of Unicode's
 * classes; the Credit Card rule with each script's digits read alone and
 * all of them together; the Phone Number rule both ways, and the SSN rule
 * with every script's digits. Each runs over every record of a project with such
 * a rule, at ingest, over text an application - or an attacker - writes.
 * Each pattern is bounded and starts a run of its characters once, and each
 * reading of a text is made once: 400,000 characters of each awkward text,
 * under two seconds (Tests/Helpers/FastestRun).
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400_000;
const LIMIT_IN_MS: number = 2000;

function repeat(unit: string, length: number): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

// One digit of each script in turn, value by value.
const EVERY_SCRIPT_DIGITS: string = DIGIT_ZEROS.map((zero: number): string => {
  return String.fromCharCode(zero + 4);
}).join("");

// Twelve digits of each script in turn: a reading of each script's own.
const EVERY_SCRIPT_RUNS: string = DIGIT_ZEROS.map((zero: number): string => {
  return String.fromCharCode(zero + 4).repeat(12) + " ";
}).join("");

const IDEOGRAPHIC_SPACE: string = "　";

// Every fullwidth form a number is read with, beside no digit, then a letter: CJK prose.
const FORMS_BESIDE_NO_DIGIT: string = `（）－＋．／${IDEOGRAPHIC_SPACE}あ`;

const EMAIL_CASES: Array<[string, string]> = [
  ["at signs without end", repeat("@", LENGTH)],
  ["letters and at signs", repeat("a@", LENGTH)],
  ["encoded at signs without end", repeat("%40", LENGTH)],
  ["letters and encoded at signs", repeat("a%40", LENGTH)],
  ["at signs encoded twice", repeat("%2540", LENGTH)],
  ["a name without end", repeat("a", LENGTH) + "@acme.io"],
  ["a name of dots and letters", repeat("a.", LENGTH) + "@acme.io"],
  ["Han letters and at signs", repeat("张伟@", LENGTH)],
  ["Han letters without end, then an at sign", repeat("张", LENGTH) + "@"],
  ["accents without end, then an address", repeat("é", LENGTH) + "@acme.io"],
  ["a domain of another script without end", "a@" + repeat("例", LENGTH)],
  ["a domain of dots without end", "a@" + repeat("例.", LENGTH)],
  ["labels without a top-level domain", repeat("x@例え.", LENGTH)],
  ["addresses in any script back to back", repeat("张伟@例え.jp ", LENGTH)],
  ["punycode labels without end", "a@b." + repeat("xn--", LENGTH)],
  ["digits and spaces before at signs", repeat("1 2@", LENGTH)],
  ["marks without end", "a" + repeat("́", LENGTH) + "@acme.io"],
  [
    "encoded addresses back to back",
    repeat("u=jane.doe%40acmecorp.io&", LENGTH),
  ],
];

const CARD_CASES: Array<[string, string]> = [
  ["fullwidth digits without end", repeat("４", LENGTH)],
  ["fullwidth digits and spaces", repeat("４ ", LENGTH)],
  ["fullwidth digits and dashes", repeat("４-", LENGTH)],
  ["two scripts' digits in turn", repeat("٤۴", LENGTH)],
  ["every script's digits in turn", repeat(EVERY_SCRIPT_DIGITS, LENGTH)],
  ["a run of each script's digits in turn", repeat(EVERY_SCRIPT_RUNS, LENGTH)],
  ["ASCII and Arabic-Indic digits and spaces", repeat("4 ٤ ", LENGTH)],
  [
    "cards in fullwidth digits back to back",
    repeat("４５３２ ０１５１ １２８３ ０３６６ ", LENGTH),
  ],
  // #11199: as a URL's query string writes a card's spaces.
  ["'+'s for spaces between digits without end", repeat("4+", LENGTH)],
  [
    "cards typed into a form back to back",
    repeat("4532+0151+1283+0366&", LENGTH),
  ],
  [
    "cards with %20 between their groups back to back",
    repeat("4532%200151%201283%200366&", LENGTH),
  ],
  ["escaped '+'s between digits without end", repeat("4%2B", LENGTH)],
  ["escapes glued to digits without end", repeat("%2212", LENGTH)],
  ["'+' runs between digits without end", repeat("4++", LENGTH)],
  ["Arabic-Indic digits typed into a form", repeat("٤+", LENGTH)],
  // #11115: a number's fullwidth forms, read as ASCII beside a digit.
  [
    "fullwidth hyphens between fullwidth digits without end",
    repeat("４－", LENGTH),
  ],
  [
    "ideographic spaces between digits without end",
    repeat(`4${IDEOGRAPHIC_SPACE}`, LENGTH),
  ],
  [
    "cards typed wholly in fullwidth back to back",
    repeat(`４５３２－０１５１－１２８３－０３６６${IDEOGRAPHIC_SPACE}`, LENGTH),
  ],
  [
    "fullwidth forms beside no digit without end",
    repeat(FORMS_BESIDE_NO_DIGIT, LENGTH),
  ],
];

const PHONE_CASES: Array<[string, string]> = [
  ["plus signs without end", repeat("+", LENGTH)],
  ["plus signs and digits", repeat("+4", LENGTH)],
  ["a plus sign and digits without end", "+4" + repeat("4", LENGTH)],
  ["a plus sign and groups without end", "+44 " + repeat("12 ", LENGTH)],
  ["a plus sign and groups of one", "+1 " + repeat("2 ", LENGTH)],
  ["a plus sign and dots", "+1" + repeat(".2", LENGTH)],
  ["a plus sign and open parentheses", "+1 " + repeat("(2", LENGTH)],
  ["a plus sign and no-break spaces", "+44" + repeat("\u00A012", LENGTH)],
  ["encoded plus signs without end", repeat("%2B", LENGTH)],
  ["encoded plus signs and spaces", repeat("%2B4%20", LENGTH)],
  ["plus signs encoded twice", repeat("%252B44", LENGTH)],
  ["dates after an offset", repeat("+1 2026-11-24 ", LENGTH)],
  ["decimals without end", repeat("+51.507217 ", LENGTH)],
  ["a plus sign and fullwidth digits", "+" + repeat("４ ", LENGTH)],
  [
    "plus signs and every script's digits",
    repeat(`+${EVERY_SCRIPT_DIGITS} `, LENGTH),
  ],
  ["numbers back to back", repeat("+44 20 7946 0958 ", LENGTH)],
  [
    "North American numbers back to back in Arabic-Indic digits",
    repeat("٤١٥-٥٥٥-٢٦٧١ ", LENGTH),
  ],
  ["UK mobiles back to back", repeat("07911 123456 ", LENGTH)],
  // #11199: as a form writes a phone number, its own "+" escaped or not.
  ["a form's '+'s and escaped plus signs", repeat("%2B44+20+", LENGTH)],
  ["'+' runs before digits", repeat("++4", LENGTH)],
  ["a form's spaces after numbers' signs", repeat("=+4+", LENGTH)],
  [
    "numbers a form wrote back to back",
    repeat("phone=%2B44+20+7946+0958&", LENGTH),
  ],
  // #11115: a number typed wholly in fullwidth, its signs and separators too.
  ["fullwidth plus signs before digits without end", repeat("＋４", LENGTH)],
  ["fullwidth hyphens between digits without end", repeat("４－", LENGTH)],
  ["digits in fullwidth parentheses without end", repeat("（４）", LENGTH)],
  [
    "a fullwidth plus sign and groups without end",
    "＋４４" + repeat(`${IDEOGRAPHIC_SPACE}１２`, LENGTH),
  ],
  [
    "numbers typed wholly in fullwidth back to back",
    repeat(
      `＋８１${IDEOGRAPHIC_SPACE}３－１２３４－５６７８${IDEOGRAPHIC_SPACE}`,
      LENGTH,
    ),
  ],
  [
    "fullwidth signs escaped in a URL without end",
    repeat("%EF%BC%8B%EF%BC%94%EF%BC%8D", LENGTH),
  ],
  [
    "fullwidth forms beside no digit without end",
    repeat(FORMS_BESIDE_NO_DIGIT, LENGTH),
  ],
  // #11114: a national number, judged by the words beside it.
  [
    "phone words and national numbers back to back",
    repeat("tel 02012345678 ", LENGTH),
  ],
  [
    "phone words without end, then a number",
    repeat("tel ", LENGTH) + "02012345678",
  ],
  ["a phone word, then digits without end", "tel " + repeat("2", LENGTH)],
  [
    "words that hold a phone word, and national numbers, back to back",
    repeat("telemetry 02012345678 callback ", LENGTH),
  ],
  [
    "national numbers back to back beside no phone word",
    repeat("order 02012345678 ", LENGTH),
  ],
  [
    "phone words escaped in a URL, and numbers, back to back",
    repeat("%74%65%6C%3D02012345678&", LENGTH),
  ],
];

const SSN_CASES: Array<[string, string]> = [
  ["groups and dashes without end", repeat("123-", LENGTH)],
  ["digits and dashes", repeat("1-", LENGTH)],
  ["groups and dots", repeat("123.45.", LENGTH)],
  ["fullwidth groups and spaces", repeat("１２３ ", LENGTH)],
  ["every script's digits in turn", repeat(EVERY_SCRIPT_DIGITS, LENGTH)],
  ["Social Security numbers back to back", repeat("536-22-8731 ", LENGTH)],
  [
    "Social Security numbers back to back in Arabic-Indic digits",
    repeat("٥٣٦-٢٢-٨٧٣١ ", LENGTH),
  ],
  // #11199
  ["groups typed into a form without end", repeat("123+", LENGTH)],
  [
    "Social Security numbers typed into a form back to back",
    repeat("536+22+8731&", LENGTH),
  ],
  [
    "Social Security numbers with %20 back to back",
    repeat("536%2022%208731&", LENGTH),
  ],
  // #11115
  ["fullwidth groups and hyphens without end", repeat("５３６－", LENGTH)],
  [
    "Social Security numbers typed wholly in fullwidth back to back",
    repeat(`５３６－２２－８７３１${IDEOGRAPHIC_SPACE}`, LENGTH),
  ],
  [
    "fullwidth forms beside no digit without end",
    repeat(FORMS_BESIDE_NO_DIGIT, LENGTH),
  ],
  // #11114: nine digits in a row, judged by the words beside them.
  [
    "SSN words and nine digits back to back",
    repeat("SSN 536221234 ", LENGTH),
  ],
  ["an SSN word, then digits without end", "ssn " + repeat("5", LENGTH)],
  [
    "SSN words without end, then nine digits",
    repeat("ssn ", LENGTH) + "536221234",
  ],
  [
    "words of an SSN apart by ideographic spaces, and nine digits, back to back",
    repeat(
      `social${IDEOGRAPHIC_SPACE}security${IDEOGRAPHIC_SPACE}５３６２２１２３４${IDEOGRAPHIC_SPACE}`,
      LENGTH,
    ),
  ],
  [
    "nine digits back to back beside no SSN word",
    repeat("ref 536221234 ", LENGTH),
  ],
];

/*
 * #11200, #11199: a date of birth, a postcode, an address and a bank's
 * or a card's code, read in every script's digits and as a URL's query
 * string writes them - by the scanner, every detector of their types.
 */
const CODE_TYPES: ReadonlyArray<string> = [
  "date-of-birth",
  "postal-code",
  "postal-address",
  "card-verification-code",
  "card-expiration-date",
  "bank-account-number",
  "uk-sort-code",
  "au-bsb",
  "swift-bic",
  "in-ifsc",
];

const CODE_CASES: Array<[string, string]> = [
  [
    "dates of birth with escaped slashes back to back",
    repeat("dob=12%2F03%2F1985&", LENGTH),
  ],
  [
    "birth's words typed into a form without end",
    repeat("date+of+birth=", LENGTH),
  ],
  [
    "dates of birth in Arabic-Indic digits back to back",
    repeat("dob ١٢/٠٣/١٩٨٥ ", LENGTH),
  ],
  [
    "written dates typed into a form back to back",
    repeat("born=12+Mar+1985&", LENGTH),
  ],
  [
    "postcodes typed into a form back to back",
    repeat("postcode=SW1A+2AA&", LENGTH),
  ],
  [
    "addresses typed into a form back to back",
    repeat("address=10+Downing+Street&", LENGTH),
  ],
  [
    "a street's words typed into a form without end",
    "12+" + repeat("Main+", LENGTH),
  ],
  [
    "security codes typed into a form back to back",
    repeat("security+code=123&", LENGTH),
  ],
  ["expiry dates in a URL back to back", repeat("exp=04%2F27&", LENGTH)],
  [
    "account numbers after their words in a URL",
    repeat("account%20number%3D12345679&", LENGTH),
  ],
  [
    "sort codes in Persian digits back to back",
    repeat("sort code ۴۰-۴۷-۸۴ ", LENGTH),
  ],
  [
    "BICs before Arabic-Indic digits back to back",
    repeat("swift DEUTDEFF٥٠٠ ", LENGTH),
  ],
  ["letters and digits of another script in turn", repeat("A٥", LENGTH)],
];

describe("Data Security's scanner, reading dates, postcodes, addresses and codes every way (#11199, #11200)", () => {
  const detectors: Array<DataTypeDetector> = CODE_TYPES.flatMap(
    (dataTypeId: string): Array<DataTypeDetector> => {
      return [...getBuiltInDetectorsOf(dataTypeId)];
    },
  );

  test.each(CODE_CASES)(
    "reads %s in time in line with its length",
    (_label: string, text: string) => {
      const timed: FastestRun<number> = fastestRun({
        run: (): number => {
          return findSensitiveValues(text, { detectors }).length;
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    },
  );
});

describe("an Email Address rule", () => {
  const regex: ScrubRegExp = compileBuiltInScrubPattern(
    LogScrubPatternType.Email,
  )!;

  test.each(EMAIL_CASES)(
    "reads %s in time in line with its length",
    (_label: string, text: string) => {
      const timed: FastestRun<string> = fastestRun({
        run: (): string => {
          return regex.replace(text, (): string => {
            return "[REDACTED]";
          });
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
      expect(typeof timed.result).toBe("string");
    },
  );
});

describe("a Credit Card rule", () => {
  const regex: ScrubRegExp = compileBuiltInScrubPattern(
    LogScrubPatternType.CreditCard,
  )!;

  test.each(CARD_CASES)(
    "reads %s in time in line with its length",
    (_label: string, text: string) => {
      const timed: FastestRun<string> = fastestRun({
        run: (): string => {
          return regex.replace(text, (): string => {
            return "[REDACTED]";
          });
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    },
  );

  test("still hides every card of a long text of them, and keeps the rest", () => {
    const unit: string =
      "card ４５３２ ０１５１ １２８３ ０３６６, code ٤١١١; ";
    const text: string = repeat(unit, unit.length * 1000);
    const scrubbed: string = regex.replace(text, (): string => {
      return "[C]";
    });
    const left: string = "card [C], code ٤١١١; ";

    expect(scrubbed).toBe(repeat(left, left.length * 1000));
  });
});

describe.each([
  ["a Phone Number rule", LogScrubPatternType.PhoneNumber, PHONE_CASES],
  ["an SSN rule", LogScrubPatternType.SSN, SSN_CASES],
] as Array<[string, string, Array<[string, string]>]>)(
  "%s",
  (_rule: string, patternType: string, cases: Array<[string, string]>) => {
    const regex: ScrubRegExp = compileBuiltInScrubPattern(patternType)!;

    test.each(cases)(
      "reads %s in time in line with its length",
      (_label: string, text: string) => {
        const timed: FastestRun<string> = fastestRun({
          run: (): string => {
            return regex.replace(text, (): string => {
              return "[REDACTED]";
            });
          },
          limitInMs: LIMIT_IN_MS,
        });

        expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
      },
    );
  },
);

describe("a Phone Number and an SSN rule over a long text of them", () => {
  test("hide every one, and keep the rest", () => {
    const unit: string =
      "to %2B49%2030%2012345678 and +٤٤ ١٦١ ٣٢١ ٤٥٦٧, ssn ٥٣٦-٢٢-٨٧٣١ at +51.507217; ";
    const text: string = repeat(unit, unit.length * 1000);
    const phone: ScrubRegExp = compileBuiltInScrubPattern(
      LogScrubPatternType.PhoneNumber,
    )!;
    const ssn: ScrubRegExp = compileBuiltInScrubPattern(
      LogScrubPatternType.SSN,
    )!;
    const scrubbed: string = ssn.replace(
      phone.replace(text, (): string => {
        return "[P]";
      }),
      (): string => {
        return "[S]";
      },
    );
    const left: string = "to [P] and [P], ssn [S] at +51.507217; ";

    expect(scrubbed).toBe(repeat(left, left.length * 1000));
  });
});

describe("a Phone Number and an SSN rule over a long text of numbers typed in fullwidth or beside their words (#11114, #11115)", () => {
  test("hide every one, and keep the rest", () => {
    // Further apart than any word's reach (32 or 64 characters before, 8 or 32 after).
    const apart: string = ` ${"x".repeat(70)} `;
    const unit: string = `電話：＋８１${IDEOGRAPHIC_SPACE}３－１２３４－５６７８ tel 02012345678${apart}order 02012345678${apart}SSN 536221234${apart}ref 536221234${apart}ssn ５３６－２２－８７３１${apart}`;
    const text: string = repeat(unit, unit.length * 1000);
    const phone: ScrubRegExp = compileBuiltInScrubPattern(
      LogScrubPatternType.PhoneNumber,
    )!;
    const ssn: ScrubRegExp = compileBuiltInScrubPattern(
      LogScrubPatternType.SSN,
    )!;
    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return ssn.replace(
          phone.replace(text, (): string => {
            return "[P]";
          }),
          (): string => {
            return "[S]";
          },
        );
      },
      limitInMs: LIMIT_IN_MS,
    });
    const left: string = `電話：[P] tel [P]${apart}order 02012345678${apart}SSN [S]${apart}ref 536221234${apart}ssn [S]${apart}`;

    expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    expect(timed.result).toBe(repeat(left, left.length * 1000));
  });
});

describe("Data Security's scanner, reading the same texts", () => {
  test.each(EMAIL_CASES)(
    "reads %s for email addresses in time in line with its length",
    (_label: string, text: string) => {
      const timed: FastestRun<number> = fastestRun({
        run: (): number => {
          return findSensitiveValues(text, {
            detectors: EMAIL_ADDRESS_DETECTORS,
          }).length;
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    },
  );

  test.each(CARD_CASES)(
    "reads %s for cards in time in line with its length",
    (_label: string, text: string) => {
      const timed: FastestRun<number> = fastestRun({
        run: (): number => {
          return findSensitiveValues(text, {
            detectors: CARD_NUMBER_DETECTORS,
          }).length;
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    },
  );

  test.each(PHONE_CASES)(
    "reads %s for phone numbers in time in line with its length",
    (_label: string, text: string) => {
      const timed: FastestRun<number> = fastestRun({
        run: (): number => {
          return findSensitiveValues(text, {
            detectors: PHONE_NUMBER_DETECTORS,
          }).length;
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    },
  );

  test.each(SSN_CASES)(
    "reads %s for Social Security numbers in time in line with its length",
    (_label: string, text: string) => {
      const timed: FastestRun<number> = fastestRun({
        run: (): number => {
          return findSensitiveValues(text, {
            detectors: US_SSN_DETECTORS,
          }).length;
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    },
  );

  test("finds every encoded and every other-script address of a long text of them, across its windows", () => {
    // Fewer to a window than the scanner keeps of one detector there (512).
    const unit: string = `u=jane.doe%40acmecorp.io ${"x".repeat(300)} to 张伟@acmecorp.io `;
    const text: string = repeat(unit, unit.length * 500);
    const found: Array<TextMatch> = findSensitiveValues(text, {
      detectors: EMAIL_ADDRESS_DETECTORS,
    });

    expect(found).toHaveLength(1000);
    expect(
      found.every((match: TextMatch): boolean => {
        const written: string = text.slice(match.start, match.end);

        return (
          written === "jane.doe%40acmecorp.io" || written === "张伟@acmecorp.io"
        );
      }),
    ).toBe(true);
  });
});
