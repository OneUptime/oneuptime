import DataConfidence from "../../Types/DataSecurity/DataConfidence";
import {
  DataTypeInfo,
  getBuiltInDataType,
} from "../../Types/DataSecurity/DataTypeCatalog";
import { DataTypeDetector } from "./Detector";
import { getBuiltInDetectorsOf } from "./Detectors/Index";
import { getHintedDataTypeIds } from "./FieldNameHints";
import { DataTypeTally, DataTypeTallyJSON } from "./FindingTally";
import { maskValue } from "./Masking";
import {
  findSensitiveValues,
  ScanDetector,
  TextMatch,
  TextScanOptions,
} from "./TextScanner";

/*
 * WHAT ONE FIELD HOLDS: A COLUMN, A JSON KEY, A LOG ATTRIBUTE.
 *
 * A field is judged as a whole, from two kinds of evidence. Its name hints
 * at a type (FieldNameHints.ts); its sampled values prove one. The share of
 * values that pass a type's detector decides how sure the finding is:
 *
 *  - 60% or more: High - the field holds that type.
 *  - 25% or more: High when the name agrees, Medium otherwise.
 *  - Fewer: Medium when the name agrees, Low otherwise - a few emails in a
 *    column of something else.
 *
 * A field of long free text (notes, messages, descriptions) is not expected
 * to be one type, so its findings keep the confidence each match earned on
 * its own, and are marked as free text.
 *
 * A type found only from names - a person's name, religion - is reported
 * when the name matches and the field has values; its values are checked
 * only for plausibility (NAME_VALUE_SHAPES), which lifts it to High.
 */

// The most values of one field read, and the most of one value.
export const MAX_FIELD_VALUES: number = 1_000;
export const MAX_FIELD_VALUE_LENGTH: number = 16_384;

// A field whose values average more than this many characters is free text.
const FREE_TEXT_AVERAGE_LENGTH: number = 80;

// Plausible values of a name-found type, checked whole.
const NAME_VALUE_SHAPES: Readonly<Record<string, RegExp>> = {
  "person-name": /^[\p{L}][\p{L}' .-]{0,63}$/u,
  username: /^[A-Za-z0-9._@-]{2,64}$/,
  gender:
    /^(?:m|f|x|u|male|female|man|woman|non-binary|nonbinary|other|unknown|prefer not to say)$/i,
  nationality: /^[\p{L}][\p{L} .-]{1,47}$/u,
};

export interface FieldClassification extends DataTypeTallyJSON {
  // The share of the field's non-empty values that held this type.
  matchRatio: number;
  // How many non-empty values were read.
  valueCount: number;
  // How many of them held this type.
  valuesWithMatch: number;
  isFreeText: boolean;
  // The field's name pointed at this type.
  nameHinted: boolean;
  // Found from the name alone (a name-found type).
  foundByName: boolean;
}

export interface FieldClassifierOptions extends TextScanOptions {
  // Extra name hints, from a project's custom data types.
  extraHints?:
    | ReadonlyArray<{ dataTypeId: string; hints: ReadonlyArray<string> }>
    | undefined;
}

// A value as text, or null when it holds nothing to classify.
export function toScannableValue(value: unknown): string | null {
  if (value === null || value === undefined || typeof value === "boolean") {
    return null;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  if (typeof value === "string") {
    const trimmed: string = value.trim();

    return trimmed.length > 0 ? trimmed.slice(0, MAX_FIELD_VALUE_LENGTH) : null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  try {
    const json: string = JSON.stringify(value);

    return json && json.length > 2
      ? json.slice(0, MAX_FIELD_VALUE_LENGTH)
      : null;
  } catch {
    return null;
  }
}

function confidenceForRatio(
  ratio: number,
  nameHinted: boolean,
): DataConfidence {
  if (ratio >= 0.6) {
    return DataConfidence.High;
  }

  if (ratio >= 0.25) {
    return nameHinted ? DataConfidence.High : DataConfidence.Medium;
  }

  return nameHinted ? DataConfidence.Medium : DataConfidence.Low;
}

/*
 * Whether a whole value has the shape a hinted type expects, for a field
 * whose name is all the context its values have: a `cvv` column of "123".
 */
function matchesFieldShape(
  detector: DataTypeDetector | ScanDetector,
  value: string,
): string | null {
  if (!detector.fieldValuePattern || !detector.fieldValuePattern.test(value)) {
    return null;
  }

  const normalized: string = detector.normalize
    ? detector.normalize(value)
    : value;

  if (detector.validate && !detector.validate(normalized, value)) {
    return null;
  }

  return normalized;
}

export function classifyField(
  fieldPath: string,
  rawValues: ReadonlyArray<unknown>,
  options: FieldClassifierOptions = {},
): Array<FieldClassification> {
  const values: Array<string> = [];

  for (const raw of rawValues) {
    if (values.length >= MAX_FIELD_VALUES) {
      break;
    }

    const value: string | null = toScannableValue(raw);

    if (value !== null) {
      values.push(value);
    }
  }

  if (values.length === 0) {
    return [];
  }

  const hinted: Set<string> = getHintedDataTypeIds(
    fieldPath,
    options.extraHints,
  );

  for (const disabled of options.disabledDataTypeIds || []) {
    hinted.delete(disabled);
  }

  const totalLength: number = values.reduce((sum: number, value: string) => {
    return sum + value.length;
  }, 0);
  const isFreeText: boolean =
    totalLength / values.length > FREE_TEXT_AVERAGE_LENGTH;

  const tallies: Map<string, DataTypeTally> = new Map();
  const valuesWithMatch: Map<string, number> = new Map();

  const tallyOf: (dataTypeId: string) => DataTypeTally = (
    dataTypeId: string,
  ): DataTypeTally => {
    let tally: DataTypeTally | undefined = tallies.get(dataTypeId);

    if (!tally) {
      tally = new DataTypeTally(dataTypeId);
      tallies.set(dataTypeId, tally);
    }

    return tally;
  };

  const scanOptions: TextScanOptions = {
    ...options,
    hintedDataTypeIds: hinted,
  };

  /*
   * Detectors of hinted types that can judge a whole value by its shape:
   * of the detectors the scan runs (every built-in one when none are
   * given, as the scanner does), so a detector given in that list is never
   * counted twice.
   */
  const shapeDetectors: Array<ScanDetector> = [];

  for (const dataTypeId of hinted) {
    const detectorsOfType: ReadonlyArray<ScanDetector> = options.detectors
      ? options.detectors.filter((detector: ScanDetector): boolean => {
          return detector.dataTypeId === dataTypeId;
        })
      : getBuiltInDetectorsOf(dataTypeId);

    for (const detector of detectorsOfType) {
      if (detector.fieldValuePattern) {
        shapeDetectors.push(detector);
      }
    }
  }

  for (const value of values) {
    const matches: Array<TextMatch> = findSensitiveValues(value, scanOptions);
    // Types with a real match in the value, which its ratio counts.
    const typesInValue: Set<string> = new Set();
    // Types the value was counted for at all, test values too: once is enough.
    const typesCounted: Set<string> = new Set();

    for (const match of matches) {
      tallyOf(match.dataTypeId).add({
        normalized: match.normalized,
        confidence: match.confidence,
        isTestValue: match.isTestValue,
        raw: value.slice(match.start, match.end),
      });
      typesCounted.add(match.dataTypeId);

      if (!match.isTestValue) {
        typesInValue.add(match.dataTypeId);
      }
    }

    if (!isFreeText) {
      for (const detector of shapeDetectors) {
        if (typesCounted.has(detector.dataTypeId)) {
          continue;
        }

        const normalized: string | null = matchesFieldShape(detector, value);

        if (normalized === null) {
          continue;
        }

        const isTestValue: boolean = Boolean(
          detector.isTestValue?.(normalized),
        );

        tallyOf(detector.dataTypeId).add({
          normalized,
          confidence: DataConfidence.Medium,
          isTestValue,
          raw: value,
        });
        typesCounted.add(detector.dataTypeId);

        if (!isTestValue) {
          typesInValue.add(detector.dataTypeId);
        }
      }
    }

    for (const dataTypeId of typesInValue) {
      valuesWithMatch.set(
        dataTypeId,
        (valuesWithMatch.get(dataTypeId) || 0) + 1,
      );
    }
  }

  const results: Array<FieldClassification> = [];

  for (const tally of tallies.values()) {
    const json: DataTypeTallyJSON = tally.toJSON();
    const withMatch: number = valuesWithMatch.get(tally.dataTypeId) || 0;
    const ratio: number = withMatch / values.length;
    const nameHinted: boolean = hinted.has(tally.dataTypeId);

    results.push({
      ...json,
      confidence:
        isFreeText || json.matchCount === 0
          ? json.confidence
          : confidenceForRatio(ratio, nameHinted),
      matchRatio: ratio,
      valueCount: values.length,
      valuesWithMatch: withMatch,
      isFreeText,
      nameHinted,
      foundByName: false,
    });
  }

  // Types found from names only.
  for (const dataTypeId of hinted) {
    const info: DataTypeInfo | undefined = getBuiltInDataType(dataTypeId);

    if (!info || info.foundBy !== "name" || tallies.has(dataTypeId)) {
      continue;
    }

    const shape: RegExp | undefined = NAME_VALUE_SHAPES[dataTypeId];
    let plausible: number = 0;
    const samples: Array<string> = [];

    for (const value of values) {
      if (!shape || shape.test(value)) {
        plausible++;

        if (samples.length < 3) {
          const masked: string = maskValue(dataTypeId, value);

          if (!samples.includes(masked)) {
            samples.push(masked);
          }
        }
      }
    }

    if (plausible === 0) {
      continue;
    }

    const ratio: number = plausible / values.length;

    results.push({
      dataTypeId,
      matchCount: plausible,
      testValueCount: 0,
      confidence:
        shape && ratio >= 0.6 ? DataConfidence.High : DataConfidence.Medium,
      maskedSamples: samples,
      distinctValues: new Set(values).size,
      distinctValuesCapped: false,
      matchRatio: ratio,
      valueCount: values.length,
      valuesWithMatch: plausible,
      isFreeText,
      nameHinted: true,
      foundByName: true,
    });
  }

  return results;
}
