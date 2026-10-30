import { describe, expect, test } from "@jest/globals";
import DataConfidence from "Common/Types/DataSecurity/DataConfidence";
import { CustomDataTypeValidator } from "Common/Utils/DataSecurity/CustomDataTypeDetector";
import {
  CUSTOM_DATA_TYPE_PATTERN_BACK_REFERENCE,
  CUSTOM_DATA_TYPE_PATTERN_MATCHES_EMPTY_TEXT,
  CUSTOM_DATA_TYPE_PATTERN_MISSING,
  CUSTOM_DATA_TYPE_PATTERN_TOO_LARGE,
  CUSTOM_DATA_TYPE_TEST_ID,
  CUSTOM_DATA_TYPE_TEST_LOW_CONFIDENCE,
  CUSTOM_DATA_TYPE_TEST_NEEDS_KEYWORD,
  CustomDataTypeTestMatch,
  CustomDataTypeTestOutcome,
  CustomDataTypeTestResult,
  getCustomDataTypePatternError,
  MAX_CUSTOM_DATA_TYPE_TEST_LENGTH,
  MAX_CUSTOM_DATA_TYPE_TEST_MATCHES,
  readCustomDataTypeDefinition,
  readCustomDataTypeWords,
  testCustomDataType,
} from "../../FeatureSet/Dashboard/src/Components/DataSecurity/CustomDataTypeTest";

/*
 * Data Security > Settings > Data Types: the Test It panel of a project's
 * own data type runs the scanner's own code on the form's values, in the
 * browser (Components/DataSecurity/CustomDataTypeTest). What it promises:
 *
 *   - it reads the form's values the way the server saves them - words
 *     lower-cased and trimmed, a dropdown's pick by its value;
 *   - a pattern the server would refuse is refused here, in the server's
 *     words, both by the form's validation and by the panel;
 *   - what it finds is what a scan of that text would find: the keywords,
 *     the requirement of one, the checksum and case work as they do there;
 *   - no value it finds is ever shown as pasted: every one is masked;
 *   - however much is pasted, it reads a bounded amount and lists a bounded
 *     number of values.
 */

const EMPLOYEE_ID: Record<string, unknown> = {
  pattern: "EMP-\\d{6}",
};

const CARD_LIKE: Record<string, unknown> = {
  pattern: "\\b\\d{16}\\b",
  validator: CustomDataTypeValidator.Luhn,
};

function found(result: CustomDataTypeTestResult): Array<string> {
  return result.matches.map((match: CustomDataTypeTestMatch): string => {
    return match.masked;
  });
}

describe("reading the form's values", () => {
  test("words are trimmed, lower-cased and given once, as the server saves them", () => {
    expect(
      readCustomDataTypeWords(["  Employee ", "STAFF", "employee", "", 7]),
    ).toEqual(["employee", "staff"]);
  });

  test("words typed one to a line, or with commas, are read as a list", () => {
    expect(readCustomDataTypeWords("Employee ID\nstaff number, badge")).toEqual(
      ["employee id", "staff number", "badge"],
    );
    expect(readCustomDataTypeWords(undefined)).toEqual([]);
    expect(readCustomDataTypeWords(null)).toEqual([]);
  });

  test("a dropdown's pick is read by its value; an unknown checksum is none", () => {
    expect(
      readCustomDataTypeDefinition({
        ...EMPLOYEE_ID,
        validator: { value: "Verhoeff", label: "Verhoeff" },
      }).validator,
    ).toBe(CustomDataTypeValidator.Verhoeff);
    expect(
      readCustomDataTypeDefinition({ ...EMPLOYEE_ID, validator: "CRC32" })
        .validator,
    ).toBe(CustomDataTypeValidator.None);
  });

  test("the definition is the one a scan builds, as a custom type's", () => {
    expect(
      readCustomDataTypeDefinition({
        pattern: "EMP-\\d{6}",
        ignoreCase: true,
        keywords: ["Employee"],
        requiresKeyword: true,
        nameHints: ["Employee ID"],
        validator: "None",
      }),
    ).toEqual({
      dataTypeId: CUSTOM_DATA_TYPE_TEST_ID,
      pattern: "EMP-\\d{6}",
      ignoreCase: true,
      keywords: ["employee"],
      requiresKeyword: true,
      nameHints: ["employee id"],
      validator: CustomDataTypeValidator.None,
    });
    expect(CUSTOM_DATA_TYPE_TEST_ID.startsWith("custom:")).toBe(true);
  });

  test("a pattern of spaces is no pattern", () => {
    expect(readCustomDataTypeDefinition({ pattern: "   " }).pattern).toBe(
      undefined,
    );
  });
});

describe("the pattern's problem, in the server's words", () => {
  test("no pattern and no field names: one or the other is needed", () => {
    expect(getCustomDataTypePatternError({})).toBe(
      CUSTOM_DATA_TYPE_PATTERN_MISSING,
    );
    expect(getCustomDataTypePatternError({ pattern: "  " })).toBe(
      CUSTOM_DATA_TYPE_PATTERN_MISSING,
    );
  });

  test("no pattern with field names is a type found from field names alone", () => {
    expect(
      getCustomDataTypePatternError({ nameHints: ["employee id"] }),
    ).toBeNull();
  });

  test("a pattern that does not compile says what the engine said", () => {
    const error: string | null = getCustomDataTypePatternError({
      pattern: "EMP-(\\d{6}",
    });

    expect(error).toMatch(/^The pattern is not a valid regular expression: /);
    expect(error).not.toContain("{{reason}}");
  });

  test("a back-reference cannot run in linear time", () => {
    expect(getCustomDataTypePatternError({ pattern: "(a)\\1" })).toBe(
      CUSTOM_DATA_TYPE_PATTERN_BACK_REFERENCE,
    );
  });

  test("a pattern too large to run says so", () => {
    expect(getCustomDataTypePatternError({ pattern: "(a{1000}){1000}" })).toBe(
      CUSTOM_DATA_TYPE_PATTERN_TOO_LARGE,
    );
  });

  test("a pattern that matches empty text would match everywhere", () => {
    expect(getCustomDataTypePatternError({ pattern: "\\d*" })).toBe(
      CUSTOM_DATA_TYPE_PATTERN_MATCHES_EMPTY_TEXT,
    );
  });

  test("a pattern that runs is no problem", () => {
    expect(getCustomDataTypePatternError(EMPLOYEE_ID)).toBeNull();
  });
});

describe("Test It", () => {
  test("an unusable pattern tests nothing and says why", () => {
    const result: CustomDataTypeTestResult = testCustomDataType(
      { pattern: "\\d*" },
      "EMP-123456",
    );

    expect(result.outcome).toBe(CustomDataTypeTestOutcome.Unusable);
    expect(result.problem).toBe(CUSTOM_DATA_TYPE_PATTERN_MATCHES_EMPTY_TEXT);
    expect(result.matches).toEqual([]);
  });

  test("a type found from field names alone has nothing to test in text", () => {
    expect(
      testCustomDataType({ nameHints: ["employee id"] }, "EMP-123456").outcome,
    ).toBe(CustomDataTypeTestOutcome.FieldNamesOnly);
  });

  test("nothing pasted is nothing tested", () => {
    expect(testCustomDataType(EMPLOYEE_ID, "").outcome).toBe(
      CustomDataTypeTestOutcome.NoSample,
    );
    expect(testCustomDataType(EMPLOYEE_ID, "  \n ").outcome).toBe(
      CustomDataTypeTestOutcome.NoSample,
    );
    expect(testCustomDataType(EMPLOYEE_ID, undefined).outcome).toBe(
      CustomDataTypeTestOutcome.NoSample,
    );
  });

  test("finds every value, in order, each masked - never as pasted", () => {
    const text: string =
      "Badge EMP-123456 opened the door; EMP-654321 did not.";
    const result: CustomDataTypeTestResult = testCustomDataType(
      EMPLOYEE_ID,
      text,
    );

    expect(result.outcome).toBe(CustomDataTypeTestOutcome.Found);
    expect(result.foundCount).toBe(2);
    expect(found(result)).toEqual(["***-**3456", "***-**4321"]);

    for (const match of result.matches) {
      const pasted: string = text.slice(match.start, match.end);

      expect(pasted).toMatch(/^EMP-\d{6}$/);
      expect(match.masked).not.toBe(pasted);
      expect(match.masked).not.toContain(pasted.slice(4, 8));
    }
  });

  test("a value with nothing to confirm it is Low, and the panel says what raises it", () => {
    const result: CustomDataTypeTestResult = testCustomDataType(
      EMPLOYEE_ID,
      "EMP-123456",
    );

    expect(result.matches[0]?.confidence).toBe(DataConfidence.Low);
    expect(result.hints).toEqual([CUSTOM_DATA_TYPE_TEST_LOW_CONFIDENCE]);
  });

  test("a keyword near a value raises its confidence", () => {
    const result: CustomDataTypeTestResult = testCustomDataType(
      { ...EMPLOYEE_ID, keywords: ["Employee"] },
      "employee EMP-123456",
    );

    expect(result.matches[0]?.confidence).toBe(DataConfidence.Medium);
    expect(result.hints).toEqual([]);
  });

  test("a type that requires a keyword finds nothing without one, and says so", () => {
    const definition: Record<string, unknown> = {
      ...EMPLOYEE_ID,
      keywords: ["employee"],
      requiresKeyword: true,
    };

    const without: CustomDataTypeTestResult = testCustomDataType(
      definition,
      "Ticket EMP-123456",
    );

    expect(without.outcome).toBe(CustomDataTypeTestOutcome.NothingFound);
    expect(without.hints).toEqual([CUSTOM_DATA_TYPE_TEST_NEEDS_KEYWORD]);

    const withKeyword: CustomDataTypeTestResult = testCustomDataType(
      definition,
      "Employee EMP-123456",
    );

    expect(withKeyword.outcome).toBe(CustomDataTypeTestOutcome.Found);
    expect(withKeyword.foundCount).toBe(1);
  });

  test("requiring a keyword with no keywords requires nothing, as in a scan", () => {
    expect(
      testCustomDataType(
        { ...EMPLOYEE_ID, requiresKeyword: true },
        "Ticket EMP-123456",
      ).outcome,
    ).toBe(CustomDataTypeTestOutcome.Found);
  });

  test("case counts unless the type ignores it", () => {
    const lowerCasePattern: Record<string, unknown> = {
      pattern: "emp-\\d{6}",
    };

    expect(testCustomDataType(lowerCasePattern, "EMP-123456").outcome).toBe(
      CustomDataTypeTestOutcome.NothingFound,
    );
    expect(
      testCustomDataType(
        { ...lowerCasePattern, ignoreCase: true },
        "EMP-123456",
      ).outcome,
    ).toBe(CustomDataTypeTestOutcome.Found);
  });

  test("a value must pass the checksum, which raises its confidence", () => {
    const passes: CustomDataTypeTestResult = testCustomDataType(
      CARD_LIKE,
      "4242424242424242",
    );

    expect(passes.outcome).toBe(CustomDataTypeTestOutcome.Found);
    expect(passes.matches[0]?.confidence).toBe(DataConfidence.Medium);
    expect(passes.matches[0]?.masked).toBe("************4242");

    const fails: CustomDataTypeTestResult = testCustomDataType(
      CARD_LIKE,
      "4242424242424241",
    );

    expect(fails.outcome).toBe(CustomDataTypeTestOutcome.NothingFound);
    expect(fails.hints).toEqual([
      "A value counts only when it passes the Luhn checksum.",
    ]);
  });

  test("only the type is looked for: a built-in type's value is not reported", () => {
    const result: CustomDataTypeTestResult = testCustomDataType(
      EMPLOYEE_ID,
      "jane@example.com 4242424242424242 EMP-123456",
    );

    expect(result.foundCount).toBe(1);
    expect(found(result)).toEqual(["***-**3456"]);
  });

  test("a long paste is read up to its limit, and says so", () => {
    const padding: string = "x".repeat(MAX_CUSTOM_DATA_TYPE_TEST_LENGTH);
    const result: CustomDataTypeTestResult = testCustomDataType(
      EMPLOYEE_ID,
      `EMP-111111 ${padding} EMP-222222`,
    );

    expect(result.isSampleCut).toBe(true);
    expect(result.foundCount).toBe(1);
    expect(found(result)).toEqual(["***-**1111"]);

    expect(testCustomDataType(EMPLOYEE_ID, "EMP-111111").isSampleCut).toBe(
      false,
    );
  });

  test("many values are counted in full and listed up to the limit", () => {
    const values: Array<string> = [];

    for (let index: number = 0; index < 40; index++) {
      values.push(`EMP-${String(100000 + index)}`);
    }

    const result: CustomDataTypeTestResult = testCustomDataType(
      EMPLOYEE_ID,
      values.join(" "),
    );

    expect(result.foundCount).toBe(40);
    expect(result.matches).toHaveLength(MAX_CUSTOM_DATA_TYPE_TEST_MATCHES);
  });
});
