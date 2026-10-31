import DataConfidence from "../../Types/DataSecurity/DataConfidence";
import {
  checkScrubRuleCustomRegex,
  ScrubRuleCustomRegexCheck,
} from "../../Types/Telemetry/ScrubRule";
import LinearRegExp, { LinearRegExpMatch } from "../LinearRegExp/LinearRegExp";
import { getLinearRegExp } from "../LinearRegExp/PatternCache";
import { digitsOnly } from "./Detector";
import { ScanDetector } from "./TextScanner";
import { ibanMod97, luhn, verhoeff } from "./Validators";

/*
 * A PROJECT'S OWN DATA TYPE: AN EMPLOYEE ID, A POLICY NUMBER, A PROJECT CODE.
 *
 * A person describes it the way the built-in types are described - a
 * pattern, the words that confirm it, the field names that hint at it, and
 * optionally a checksum it must pass - and it is scanned exactly like them.
 * The pattern is someone's own regular expression, so it is matched by
 * LinearRegExp, in time in line with the text whatever the pattern is, and
 * checked when it is saved the way a scrub rule's custom pattern is
 * (checkScrubRuleCustomRegex: not empty, compiles, can run in linear time,
 * matches no empty text).
 */

export enum CustomDataTypeValidator {
  None = "None",
  Luhn = "Luhn",
  Mod97 = "Mod97",
  Verhoeff = "Verhoeff",
}

export const ALL_CUSTOM_DATA_TYPE_VALIDATORS: ReadonlyArray<CustomDataTypeValidator> =
  [
    CustomDataTypeValidator.None,
    CustomDataTypeValidator.Luhn,
    CustomDataTypeValidator.Mod97,
    CustomDataTypeValidator.Verhoeff,
  ];

export interface CustomDataTypeDefinition {
  // "custom:" and the row's id, so it can never collide with a built-in id.
  dataTypeId: string;
  pattern?: string | undefined;
  ignoreCase?: boolean | undefined;
  keywords?: ReadonlyArray<string> | undefined;
  requiresKeyword?: boolean | undefined;
  nameHints?: ReadonlyArray<string> | undefined;
  validator?: CustomDataTypeValidator | undefined;
}

export const CUSTOM_DATA_TYPE_ID_PREFIX: string = "custom:";

export function customDataTypeId(rowId: string): string {
  return CUSTOM_DATA_TYPE_ID_PREFIX + rowId;
}

export function isCustomDataTypeId(dataTypeId: string): boolean {
  return dataTypeId.startsWith(CUSTOM_DATA_TYPE_ID_PREFIX);
}

function runValidator(
  validator: CustomDataTypeValidator | undefined,
  value: string,
): boolean {
  switch (validator) {
    case CustomDataTypeValidator.Luhn:
      return luhn(digitsOnly(value));
    case CustomDataTypeValidator.Mod97:
      return ibanMod97(value.replace(/[^A-Za-z0-9]/g, "").toUpperCase());
    case CustomDataTypeValidator.Verhoeff:
      return verhoeff(digitsOnly(value));
    default:
      return true;
  }
}

/*
 * What stops a custom type from being saved, in the same words a scrub
 * rule's custom pattern gets, or null. A type with no pattern is allowed
 * only when it has field names to be found by.
 */
export function checkCustomDataType(
  definition: CustomDataTypeDefinition,
): ScrubRuleCustomRegexCheck | null {
  const hasPattern: boolean = Boolean(definition.pattern?.trim());

  if (!hasPattern && (definition.nameHints || []).length > 0) {
    return null;
  }

  return checkScrubRuleCustomRegex(definition.pattern);
}

/*
 * The detector a custom type runs as, or null when its pattern cannot run
 * (a stored pattern that no longer compiles scans nothing rather than
 * failing the scan).
 */
export function compileCustomDataType(
  definition: CustomDataTypeDefinition,
): ScanDetector | null {
  const keywords: Array<string> = (definition.keywords || [])
    .map((keyword: string) => {
      return keyword.trim().toLowerCase();
    })
    .filter((keyword: string) => {
      return keyword.length > 0;
    });

  if (!definition.pattern?.trim()) {
    return null;
  }

  let regex: LinearRegExp;

  try {
    regex = getLinearRegExp(
      definition.pattern,
      definition.ignoreCase ? "gi" : "g",
    );
  } catch {
    return null;
  }

  return {
    dataTypeId: definition.dataTypeId,
    findCandidates: (
      text: string,
    ): Array<{ start: number; end: number; value: string }> => {
      let matches: Array<LinearRegExpMatch>;

      try {
        matches = regex.matchAll(text);
      } catch {
        // A pattern built to take too long stops here, finding nothing.
        return [];
      }

      return matches
        .filter((match: LinearRegExpMatch) => {
          return match.value.length > 0;
        })
        .map((match: LinearRegExpMatch) => {
          return { start: match.index, end: match.end, value: match.value };
        });
    },
    validate: (normalized: string): boolean => {
      return runValidator(definition.validator, normalized);
    },
    keywords,
    requiresContext: Boolean(definition.requiresKeyword) && keywords.length > 0,
    confidenceWithoutContext:
      definition.validator &&
      definition.validator !== CustomDataTypeValidator.None
        ? DataConfidence.Medium
        : DataConfidence.Low,
    specificity:
      definition.validator &&
      definition.validator !== CustomDataTypeValidator.None
        ? 2
        : 1,
  };
}
