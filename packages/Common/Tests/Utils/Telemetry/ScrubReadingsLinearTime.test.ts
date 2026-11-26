import { describe, expect, test } from "@jest/globals";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import { ScrubRegExp } from "../../../Types/Telemetry/ScrubRule";
import { DIGIT_ZEROS } from "../../../Utils/DataSecurity/DigitReadings";
import {
  EMAIL_ADDRESS_DETECTORS,
  PHONE_NUMBER_DETECTORS,
} from "../../../Utils/DataSecurity/Detectors/ContactDetectors";
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
];

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
