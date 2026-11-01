import DataConfidence from "Common/Types/DataSecurity/DataConfidence";
import {
  ScrubRuleCustomRegexCheck,
  ScrubRuleCustomRegexProblem,
} from "Common/Types/Telemetry/ScrubRule";
import {
  ALL_CUSTOM_DATA_TYPE_VALIDATORS,
  checkCustomDataType,
  compileCustomDataType,
  CustomDataTypeDefinition,
  customDataTypeId,
  CustomDataTypeValidator,
} from "Common/Utils/DataSecurity/CustomDataTypeDetector";
import { maskValue } from "Common/Utils/DataSecurity/Masking";
import {
  findSensitiveValues,
  ScanDetector,
  TextMatch,
} from "Common/Utils/DataSecurity/TextScanner";
import { PatternProblemReason } from "Common/Utils/LinearRegExp/PatternProblem";
import {
  translateTemplate,
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * "TEST IT" FOR A PROJECT'S OWN DATA TYPE, RUN IN THE BROWSER.
 *
 * Data Security > Settings > Data Types lets a project describe a kind of
 * sensitive data of its own - a pattern, the words that confirm it, the
 * field names that hint at it, a checksum (DataSecurityCustomDataType). Its
 * form has a Test It panel: paste some text, and see what the type finds in
 * it, before it is saved and long before a scan runs.
 *
 * The panel runs the scanner's own code on the form's current values, so
 * what it shows is what a scan would find in that text:
 *
 *   - the definition is compiled with compileCustomDataType, the detector a
 *     scan builds from the saved row, and run with findSensitiveValues with
 *     that detector alone - the same windows, keyword rules, checksum and
 *     confidence;
 *   - each value found is shown masked (maskValue, which masks a custom
 *     type's value the generic way: its last few characters), never as
 *     pasted, as every finding is;
 *   - a pattern that cannot be used says why, in the words the server
 *     refuses it with (DataSecurityCustomDataTypeService.describeProblem):
 *     checkCustomDataType is the check both make. The same words are the
 *     form's own validation of the pattern (getCustomDataTypePatternError).
 *
 * Nothing pasted leaves the browser: no request is made.
 */

// The id the test detector runs as: a custom type's, so it masks like one.
export const CUSTOM_DATA_TYPE_TEST_ID: string = customDataTypeId("test");

/*
 * The most of a sample that is tested: as much text as one window of a scan
 * reads (TextScanner WINDOW_SIZE), so a large paste never slows the form.
 */
export const MAX_CUSTOM_DATA_TYPE_TEST_LENGTH: number = 65_536;

// The most values listed; a count says how many were found in all.
export const MAX_CUSTOM_DATA_TYPE_TEST_MATCHES: number = 25;

/*
 * Why a pattern cannot be used, one whole sentence per reason, as the
 * server words them.
 */
export const CUSTOM_DATA_TYPE_PATTERN_MISSING: string = translationKey(
  "Enter a pattern, or field names the data type is found by.",
);

export const CUSTOM_DATA_TYPE_PATTERN_INVALID: string = translationKey(
  "The pattern is not a valid regular expression: {{reason}}.",
);

export const CUSTOM_DATA_TYPE_PATTERN_BACK_REFERENCE: string = translationKey(
  "This pattern refers back to what an earlier group matched, such as \\1. Patterns run in time in line with the text they read, which a back-reference cannot do. Write the pattern without it.",
);

export const CUSTOM_DATA_TYPE_PATTERN_TOO_LARGE: string = translationKey(
  "This pattern is too large to run. Shorten it, or repeat its parts fewer times.",
);

export const CUSTOM_DATA_TYPE_PATTERN_CAPTURE_IN_LOOKAROUND: string =
  translationKey(
    "This pattern captures a group inside a look-ahead or look-behind. Use a non-capturing group (?:...) there.",
  );

export const CUSTOM_DATA_TYPE_PATTERN_MATCHES_EMPTY_TEXT: string =
  translationKey(
    "The pattern matches empty text, so it would match everywhere. Make every part of it match at least one character.",
  );

export const CUSTOM_DATA_TYPE_PATTERN_CANNOT_BE_USED: string = translationKey(
  "The pattern cannot be used.",
);

// What a test that finds nothing may come down to.
export const CUSTOM_DATA_TYPE_TEST_NEEDS_KEYWORD: string = translationKey(
  "A value counts only with one of the keywords near it.",
);

export const CUSTOM_DATA_TYPE_TEST_NEEDS_CHECKSUM: string = translationKey(
  "A value counts only when it passes the {{checksum}} checksum.",
);

// What a test that finds only Low-confidence values means.
export const CUSTOM_DATA_TYPE_TEST_LOW_CONFIDENCE: string = translationKey(
  "Values found with Low confidence do not make a store sensitive. Keywords near a value, or a checksum, raise it.",
);

export enum CustomDataTypeTestOutcome {
  // The pattern cannot be used: `problem` says why.
  Unusable = "Unusable",
  // No pattern: scans find the type from field names alone.
  FieldNamesOnly = "FieldNamesOnly",
  // Nothing has been pasted yet.
  NoSample = "NoSample",
  // The text holds no value of the type.
  NothingFound = "NothingFound",
  Found = "Found",
}

export interface CustomDataTypeTestMatch {
  // Where the value is in the text tested.
  start: number;
  end: number;
  // The value, masked as a finding's sample is. Never the value itself.
  masked: string;
  confidence: DataConfidence;
}

export interface CustomDataTypeTestResult {
  outcome: CustomDataTypeTestOutcome;
  // For an unusable pattern: why, in the reader's language.
  problem?: string | undefined;
  // The values found, in the order they appear, at most the limit.
  matches: Array<CustomDataTypeTestMatch>;
  // How many values were found in all.
  foundCount: number;
  // Whether only the start of the text was tested.
  isSampleCut: boolean;
  // Sentences that explain the result, in the reader's language.
  hints: Array<string>;
}

// A form value as the form holds it: a dropdown's pick is { value, label }.
function readValue(value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "value")
  ) {
    return (value as Record<string, unknown>)["value"];
  }

  return value;
}

function readText(value: unknown): string | undefined {
  const read: unknown = readValue(value);

  return typeof read === "string" && read.trim().length > 0 ? read : undefined;
}

function readBoolean(value: unknown): boolean {
  return readValue(value) === true;
}

/*
 * A list of words as the form holds it - the list itself, or text with one
 * word to a line or a comma - lower-cased and trimmed, as the server saves
 * it (DataSecurityCustomDataTypeService.readWords).
 */
export function readCustomDataTypeWords(value: unknown): Array<string> {
  const read: unknown = readValue(value);
  let words: Array<unknown> = [];

  if (Array.isArray(read)) {
    words = read.map((word: unknown): unknown => {
      return readValue(word);
    });
  } else if (typeof read === "string") {
    words = read.split(/[\n,]/);
  }

  const seen: Set<string> = new Set<string>();

  for (const word of words) {
    if (typeof word !== "string") {
      continue;
    }

    const normalized: string = word.trim().toLowerCase();

    if (normalized.length > 0) {
      seen.add(normalized);
    }
  }

  return Array.from(seen);
}

function readValidator(value: unknown): CustomDataTypeValidator {
  const read: unknown = readValue(value);

  return (
    ALL_CUSTOM_DATA_TYPE_VALIDATORS.find(
      (validator: CustomDataTypeValidator): boolean => {
        return validator === read;
      },
    ) || CustomDataTypeValidator.None
  );
}

/*
 * The definition a scan would build from the form's values as they are now
 * (DataSecurityCustomDataType's columns: pattern, ignoreCase, keywords,
 * requiresKeyword, nameHints, validator).
 */
export function readCustomDataTypeDefinition(
  values: Record<string, unknown> | null | undefined,
  dataTypeId: string = CUSTOM_DATA_TYPE_TEST_ID,
): CustomDataTypeDefinition {
  const formValues: Record<string, unknown> = values || {};

  return {
    dataTypeId: dataTypeId,
    pattern: readText(formValues["pattern"]),
    ignoreCase: readBoolean(formValues["ignoreCase"]),
    keywords: readCustomDataTypeWords(formValues["keywords"]),
    requiresKeyword: readBoolean(formValues["requiresKeyword"]),
    nameHints: readCustomDataTypeWords(formValues["nameHints"]),
    validator: readValidator(formValues["validator"]),
  };
}

// Why a pattern cannot be used, in the reader's language.
export function describeCustomDataTypeProblem(
  check: ScrubRuleCustomRegexCheck,
): string {
  switch (check.problem) {
    case ScrubRuleCustomRegexProblem.Missing:
      return (
        translateText(CUSTOM_DATA_TYPE_PATTERN_MISSING) ||
        CUSTOM_DATA_TYPE_PATTERN_MISSING
      );
    case ScrubRuleCustomRegexProblem.Invalid:
      return translateTemplate(CUSTOM_DATA_TYPE_PATTERN_INVALID, {
        reason: check.reason || "",
      });
    case ScrubRuleCustomRegexProblem.CannotRun:
      if (check.cannotRunReason === PatternProblemReason.BackReference) {
        return (
          translateText(CUSTOM_DATA_TYPE_PATTERN_BACK_REFERENCE) ||
          CUSTOM_DATA_TYPE_PATTERN_BACK_REFERENCE
        );
      }

      if (check.cannotRunReason === PatternProblemReason.TooLarge) {
        return (
          translateText(CUSTOM_DATA_TYPE_PATTERN_TOO_LARGE) ||
          CUSTOM_DATA_TYPE_PATTERN_TOO_LARGE
        );
      }

      return (
        translateText(CUSTOM_DATA_TYPE_PATTERN_CAPTURE_IN_LOOKAROUND) ||
        CUSTOM_DATA_TYPE_PATTERN_CAPTURE_IN_LOOKAROUND
      );
    case ScrubRuleCustomRegexProblem.MatchesEmptyText:
      return (
        translateText(CUSTOM_DATA_TYPE_PATTERN_MATCHES_EMPTY_TEXT) ||
        CUSTOM_DATA_TYPE_PATTERN_MATCHES_EMPTY_TEXT
      );
    default:
      return (
        translateText(CUSTOM_DATA_TYPE_PATTERN_CANNOT_BE_USED) ||
        CUSTOM_DATA_TYPE_PATTERN_CANNOT_BE_USED
      );
  }
}

/*
 * What stops the form's values from being saved, in the reader's language,
 * or null: the check the server makes (checkCustomDataType) - a pattern that
 * compiles, runs in linear time and matches no empty text, or no pattern and
 * field names to be found by. For the pattern field's customValidation.
 */
export function getCustomDataTypePatternError(
  values: Record<string, unknown> | null | undefined,
): string | null {
  const check: ScrubRuleCustomRegexCheck | null = checkCustomDataType(
    readCustomDataTypeDefinition(values),
  );

  return check ? describeCustomDataTypeProblem(check) : null;
}

// What may have kept a value from counting, given the definition.
function getRequirementHints(
  definition: CustomDataTypeDefinition,
): Array<string> {
  const hints: Array<string> = [];

  if (definition.requiresKeyword && (definition.keywords || []).length > 0) {
    hints.push(
      translateText(CUSTOM_DATA_TYPE_TEST_NEEDS_KEYWORD) ||
        CUSTOM_DATA_TYPE_TEST_NEEDS_KEYWORD,
    );
  }

  if (
    definition.validator &&
    definition.validator !== CustomDataTypeValidator.None
  ) {
    hints.push(
      translateTemplate(CUSTOM_DATA_TYPE_TEST_NEEDS_CHECKSUM, {
        checksum: definition.validator,
      }),
    );
  }

  return hints;
}

/*
 * Runs the form's data type over sample text, as a scan would, and says
 * what it found - every value masked.
 */
export function testCustomDataType(
  values: Record<string, unknown> | null | undefined,
  sampleText: string | null | undefined,
): CustomDataTypeTestResult {
  const definition: CustomDataTypeDefinition =
    readCustomDataTypeDefinition(values);
  const text: string = sampleText || "";
  const isSampleCut: boolean = text.length > MAX_CUSTOM_DATA_TYPE_TEST_LENGTH;
  const tested: string = isSampleCut
    ? text.slice(0, MAX_CUSTOM_DATA_TYPE_TEST_LENGTH)
    : text;

  const result: CustomDataTypeTestResult = {
    outcome: CustomDataTypeTestOutcome.NoSample,
    matches: [],
    foundCount: 0,
    isSampleCut: isSampleCut,
    hints: [],
  };

  const check: ScrubRuleCustomRegexCheck | null =
    checkCustomDataType(definition);

  if (check) {
    result.outcome = CustomDataTypeTestOutcome.Unusable;
    result.problem = describeCustomDataTypeProblem(check);
    return result;
  }

  if (!definition.pattern) {
    // Allowed only with field names: there is nothing to match in text.
    result.outcome = CustomDataTypeTestOutcome.FieldNamesOnly;
    return result;
  }

  const detector: ScanDetector | null = compileCustomDataType(definition);

  if (!detector) {
    result.outcome = CustomDataTypeTestOutcome.Unusable;
    result.problem =
      translateText(CUSTOM_DATA_TYPE_PATTERN_CANNOT_BE_USED) ||
      CUSTOM_DATA_TYPE_PATTERN_CANNOT_BE_USED;
    return result;
  }

  if (tested.trim().length === 0) {
    return result;
  }

  const found: Array<TextMatch> = findSensitiveValues(tested, {
    detectors: [detector],
  });

  result.foundCount = found.length;
  result.matches = found
    .slice(0, MAX_CUSTOM_DATA_TYPE_TEST_MATCHES)
    .map((match: TextMatch): CustomDataTypeTestMatch => {
      return {
        start: match.start,
        end: match.end,
        masked: maskValue(
          CUSTOM_DATA_TYPE_TEST_ID,
          tested.slice(match.start, match.end),
        ),
        confidence: match.confidence,
      };
    });

  if (found.length === 0) {
    result.outcome = CustomDataTypeTestOutcome.NothingFound;
    result.hints = getRequirementHints(definition);
    return result;
  }

  result.outcome = CustomDataTypeTestOutcome.Found;

  if (
    found.every((match: TextMatch): boolean => {
      return match.confidence === DataConfidence.Low;
    })
  ) {
    result.hints = [
      translateText(CUSTOM_DATA_TYPE_TEST_LOW_CONFIDENCE) ||
        CUSTOM_DATA_TYPE_TEST_LOW_CONFIDENCE,
    ];
  }

  return result;
}
