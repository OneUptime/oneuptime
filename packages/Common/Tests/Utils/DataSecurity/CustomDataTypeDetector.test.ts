import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import { ScrubRuleCustomRegexProblem } from "../../../Types/Telemetry/ScrubRule";
import {
  ALL_CUSTOM_DATA_TYPE_VALIDATORS,
  checkCustomDataType,
  compileCustomDataType,
  CUSTOM_DATA_TYPE_ID_PREFIX,
  customDataTypeId,
  CustomDataTypeValidator,
  isCustomDataTypeId,
} from "../../../Utils/DataSecurity/CustomDataTypeDetector";
import { isBuiltInDataType } from "../../../Types/DataSecurity/DataTypeCatalog";
import {
  findSensitiveValues,
  ScanDetector,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";

/*
 * A PROJECT'S OWN DATA TYPE.
 *
 * Its pattern is someone's own regular expression, checked when it is
 * saved as a scrub rule's is (missing, invalid, a back-reference, matching
 * empty text), and run by LinearRegExp. Its keywords, its validator and
 * whether it needs a keyword decide its confidence as they do for a
 * built-in type.
 */

function values(
  detector: ScanDetector,
  text: string,
): Array<[string, DataConfidence]> {
  return findSensitiveValues(text, { detectors: [detector] }).map(
    (match: TextMatch) => {
      return [text.slice(match.start, match.end), match.confidence];
    },
  );
}

describe("custom data type ids", () => {
  test("start with custom: so none can be a built-in id", () => {
    expect(CUSTOM_DATA_TYPE_ID_PREFIX).toBe("custom:");
    expect(customDataTypeId("b9f2")).toBe("custom:b9f2");
    expect(isCustomDataTypeId("custom:b9f2")).toBe(true);
    expect(isCustomDataTypeId("email-address")).toBe(false);
    expect(isBuiltInDataType(customDataTypeId("email-address"))).toBe(false);
  });

  test("offer every validator", () => {
    expect(ALL_CUSTOM_DATA_TYPE_VALIDATORS).toEqual([
      CustomDataTypeValidator.None,
      CustomDataTypeValidator.Luhn,
      CustomDataTypeValidator.Mod97,
      CustomDataTypeValidator.Verhoeff,
    ]);
  });
});

describe("checkCustomDataType", () => {
  test("says a pattern is missing, unless the type has field names to be found by", () => {
    expect(checkCustomDataType({ dataTypeId: "custom:a" })).toEqual({
      problem: ScrubRuleCustomRegexProblem.Missing,
    });
    expect(
      checkCustomDataType({ dataTypeId: "custom:a", pattern: "   " }),
    ).toEqual({
      problem: ScrubRuleCustomRegexProblem.Missing,
    });
    expect(
      checkCustomDataType({
        dataTypeId: "custom:a",
        pattern: " ",
        nameHints: ["staff id"],
      }),
    ).toBeNull();
  });

  test("says why an invalid pattern is invalid", () => {
    expect(
      checkCustomDataType({ dataTypeId: "custom:a", pattern: "(EMP" }),
    ).toEqual({
      problem: ScrubRuleCustomRegexProblem.Invalid,
      reason: "Unterminated group",
    });
  });

  test("refuses a back-reference, which a linear-time matcher cannot run", () => {
    expect(
      checkCustomDataType({ dataTypeId: "custom:a", pattern: "(a)\\1" }),
    ).toEqual({
      problem: ScrubRuleCustomRegexProblem.CannotRun,
      cannotRunReason: "BackReference",
    });
  });

  test("refuses a pattern that matches empty text", () => {
    for (const pattern of ["x*", "[0-9]{0,6}", "\\b", "(?=@)"]) {
      expect([
        pattern,
        checkCustomDataType({ dataTypeId: "custom:a", pattern }),
      ]).toEqual([
        pattern,
        { problem: ScrubRuleCustomRegexProblem.MatchesEmptyText },
      ]);
    }
  });

  test("accepts a pattern it can run, even one that backtracking engines cannot", () => {
    for (const pattern of ["EMP-[0-9]{6}", "(?<=id:)[0-9]{4}", "(a+)+b"]) {
      expect([
        pattern,
        checkCustomDataType({ dataTypeId: "custom:a", pattern }),
      ]).toEqual([pattern, null]);
    }
  });
});

describe("compileCustomDataType", () => {
  test("is nothing without a pattern, or with one that no longer compiles", () => {
    expect(compileCustomDataType({ dataTypeId: "custom:a" })).toBeNull();
    expect(
      compileCustomDataType({ dataTypeId: "custom:a", pattern: "  " }),
    ).toBeNull();
    expect(
      compileCustomDataType({ dataTypeId: "custom:a", pattern: "(EMP" }),
    ).toBeNull();
    expect(
      compileCustomDataType({ dataTypeId: "custom:a", pattern: "(a)\\1" }),
    ).toBeNull();
  });

  test("is Low and least specific without a validator, Medium and more specific with one", () => {
    const plain: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:a",
      pattern: "EMP-[0-9]{6}",
    })!;
    const checked: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:b",
      pattern: "[0-9]{16}",
      validator: CustomDataTypeValidator.Luhn,
    })!;

    expect([plain.confidenceWithoutContext, plain.specificity]).toEqual([
      DataConfidence.Low,
      1,
    ]);
    expect([checked.confidenceWithoutContext, checked.specificity]).toEqual([
      DataConfidence.Medium,
      2,
    ]);
    expect(
      compileCustomDataType({
        dataTypeId: "custom:c",
        pattern: "x",
        validator: CustomDataTypeValidator.None,
      })!.confidenceWithoutContext,
    ).toBe(DataConfidence.Low);
  });

  test("reads its keywords trimmed and lower-cased, and drops empty ones", () => {
    const detector: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:a",
      pattern: "EMP-[0-9]{6}",
      keywords: ["  Employee ", "", "   ", "STAFF"],
    })!;

    expect(detector.keywords).toEqual(["employee", "staff"]);
    expect(values(detector, "Staff EMP-104233")).toEqual([
      ["EMP-104233", DataConfidence.Medium],
    ]);
  });

  test("needs its keyword only when asked to and when it has one", () => {
    const needsKeyword: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:a",
      pattern: "EMP-[0-9]{6}",
      keywords: ["employee"],
      requiresKeyword: true,
    })!;
    const noKeywords: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:b",
      pattern: "EMP-[0-9]{6}",
      requiresKeyword: true,
    })!;

    expect(needsKeyword.requiresContext).toBe(true);
    expect(values(needsKeyword, "EMP-104233")).toEqual([]);
    expect(values(needsKeyword, "employee EMP-104233")).toEqual([
      ["EMP-104233", DataConfidence.Medium],
    ]);
    expect(noKeywords.requiresContext).toBe(false);
    expect(values(noKeywords, "EMP-104233")).toEqual([
      ["EMP-104233", DataConfidence.Low],
    ]);
  });

  test("matches in any case when asked to", () => {
    const detector: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:a",
      pattern: "EMP-[0-9]{6}",
      ignoreCase: true,
    })!;

    expect(values(detector, "emp-104233 and EMP-104234")).toEqual([
      ["emp-104233", DataConfidence.Low],
      ["EMP-104234", DataConfidence.Low],
    ]);
  });

  test("never reports an empty match of a pattern saved before the check", () => {
    const detector: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:a",
      pattern: "x*",
    })!;

    expect(values(detector, "a xx a")).toEqual([["xx", DataConfidence.Low]]);
  });

  test("keeps only the matches its Luhn validator accepts", () => {
    const detector: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:a",
      pattern: "LOY-[0-9]{12}",
      validator: CustomDataTypeValidator.Luhn,
    })!;

    expect(values(detector, "LOY-000000000018 LOY-000000000019")).toEqual([
      ["LOY-000000000018", DataConfidence.Medium],
    ]);
  });

  test("keeps only the matches its mod-97 validator accepts, read without spaces in upper case", () => {
    const detector: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:a",
      pattern: "[A-Za-z]{2}[0-9]{2}[A-Za-z0-9 ]{18,23}",
      validator: CustomDataTypeValidator.Mod97,
    })!;

    expect(values(detector, "gb82 west 1234 5698 7654 32")).toEqual([
      ["gb82 west 1234 5698 7654 32", DataConfidence.Medium],
    ]);
    expect(values(detector, "GB83WEST12345698765432")).toEqual([]);
  });

  test("keeps only the matches its Verhoeff validator accepts, and none without digits", () => {
    const digits: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:a",
      pattern: "[0-9]{4}",
      validator: CustomDataTypeValidator.Verhoeff,
    })!;
    const letters: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:b",
      pattern: "REF-[A-Z]{3}",
      validator: CustomDataTypeValidator.Verhoeff,
    })!;

    expect(values(digits, "2363 2364")).toEqual([
      ["2363", DataConfidence.Medium],
    ]);
    expect(values(letters, "REF-ABC")).toEqual([]);
  });
});
