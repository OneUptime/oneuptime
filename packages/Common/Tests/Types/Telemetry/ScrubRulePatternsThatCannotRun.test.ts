import { describe, expect, test } from "@jest/globals";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  checkScrubRuleCustomRegex,
  compileScrubRuleCustomRegex,
  doesScrubRuleScrubNothing,
  LOG_SCRUB_FIELDS,
  LOG_SCRUB_PATTERN_TYPES,
  ScrubRegExp,
  ScrubRuleCustomRegexCheck,
  ScrubRuleCustomRegexProblem,
} from "../../../Types/Telemetry/ScrubRule";
import { PatternProblemReason } from "../../../Utils/LinearRegExp/PatternProblem";
import {
  clearLinearRegExpCache,
  getCachedPatternCharacters,
  getCachedPatternCount,
} from "../../../Utils/LinearRegExp/PatternCache";
import { validateScrubRule } from "../../../Server/Utils/ScrubRuleValidation";
import {
  getScrubRuleCustomRegexError,
  SCRUB_RULE_CUSTOM_REGEX_BACK_REFERENCE,
  SCRUB_RULE_CUSTOM_REGEX_TOO_LARGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/ScrubRuleForm";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * A CUSTOM SCRUB PATTERN INGEST CANNOT RUN: REFUSED, FLAGGED, SAID WHY.
 *
 * A Custom Regex scrub rule runs on every log and span a project sends, on
 * the linear-time matcher. A pattern that refers back to a group (\1,
 * \k<name>), or is too large, cannot run there: the form and the API refuse
 * to save one, saying why, and one saved before is flagged "Scrubs nothing"
 * in the rules table - ingest skips it as it skips a pattern that does not
 * compile. And a pattern that would read a value over and over to find
 * every match scrubs the whole value rather than store it.
 * ---------------------------------------------------------------------------
 */

const BACK_REFERENCE: string = "([\"'])secret\\1";
const TOO_LARGE: string = "x{0,20000}y";

describe("checking a pattern before it is saved", () => {
  test("a back-reference cannot run, and the check says so", () => {
    const check: ScrubRuleCustomRegexCheck | null =
      checkScrubRuleCustomRegex(BACK_REFERENCE);

    expect(check).toEqual({
      problem: ScrubRuleCustomRegexProblem.CannotRun,
      cannotRunReason: PatternProblemReason.BackReference,
    });
  });

  test("so is a pattern too large", () => {
    expect(checkScrubRuleCustomRegex(TOO_LARGE)).toEqual({
      problem: ScrubRuleCustomRegexProblem.CannotRun,
      cannotRunReason: PatternProblemReason.TooLarge,
    });
  });

  test("megabytes of pattern are too large, said at once, and nothing of them is kept", () => {
    clearLinearRegExpCache();

    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        for (let index: number = 0; index < 20; index++) {
          // Distinct, as one save after another could send them.
          expect(
            checkScrubRuleCustomRegex(`${index}${"x".repeat(1_000_000)}`),
          ).toEqual({
            problem: ScrubRuleCustomRegexProblem.CannotRun,
            cannotRunReason: PatternProblemReason.TooLarge,
          });
        }
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(getCachedPatternCount()).toBe(0);
    expect(getCachedPatternCharacters()).toBe(0);
  });

  test("a look-behind or look-ahead runs, as it always has", () => {
    for (const pattern of [
      "(?<=password=)\\S+",
      "\\d{12}(?=\\d{4}\\b)",
      "(?<![A-Z])[A-Z]{3}-\\d{4}",
    ]) {
      expect(checkScrubRuleCustomRegex(pattern)).toBeNull();
    }
  });
});

describe("saving one", () => {
  test("the API refuses it with what to change", () => {
    expect(() => {
      validateScrubRule(
        {
          patternType: LogScrubPatternType.Custom,
          customRegex: BACK_REFERENCE,
        },
        {
          recordNoun: "logs",
          patternTypes: LOG_SCRUB_PATTERN_TYPES,
          fieldsToScrub: LOG_SCRUB_FIELDS,
        },
      );
    }).toThrow(
      new BadDataException(
        "The custom pattern refers back to what an earlier group matched (\\1 or \\k<name>). Patterns are run in time that grows only in line with the text they read, which a back-reference cannot do. Write the pattern without it. Until then the rule would scrub nothing.",
      ),
    );
  });

  test("the form says why in the reader's words", () => {
    expect(getScrubRuleCustomRegexError(BACK_REFERENCE)).toBe(
      SCRUB_RULE_CUSTOM_REGEX_BACK_REFERENCE,
    );
    expect(getScrubRuleCustomRegexError(TOO_LARGE)).toBe(
      SCRUB_RULE_CUSTOM_REGEX_TOO_LARGE,
    );
  });
});

describe("one saved before", () => {
  test("ingest skips it, and the rules table flags it", () => {
    expect(compileScrubRuleCustomRegex(BACK_REFERENCE)).toBeNull();
    expect(
      doesScrubRuleScrubNothing({
        patternType: LogScrubPatternType.Custom,
        customRegex: BACK_REFERENCE,
        fieldsToScrub: "both",
        knownPatternTypes: LOG_SCRUB_PATTERN_TYPES,
        knownFieldsToScrub: LOG_SCRUB_FIELDS,
      }),
    ).toBe(true);
  });
});

describe("a pattern that would read a value over and over", () => {
  // Each "a" matches, after a read to the end of the value for a "c".
  const pattern: ScrubRegExp = compileScrubRuleCustomRegex("(?:a.*c|a)")!;

  test("scrubs the whole of a long value", () => {
    const value: string = "a".repeat(100000);
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(
          pattern.replace(value, (): string => {
            return "[REDACTED]";
          }),
        ).toBe("[REDACTED]");
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("and every match of a short one, as before", () => {
    expect(
      pattern.replace("aab", (): string => {
        return "#";
      }),
    ).toBe("##b");
  });

  test("is taken to hold what it scrubs when asked", () => {
    expect(pattern.test("bbb")).toBe(false);
    expect(pattern.test("a")).toBe(true);
  });
});
