import {
  compileCustomDataType,
  CustomDataTypeDefinition,
} from "./CustomDataTypeDetector";
import {
  classifyField,
  FieldClassification,
  MAX_FIELD_VALUES,
  toScannableValue,
} from "./FieldClassifier";
import { ScanDetector } from "./TextScanner";

/*
 * A DATA TYPE RUN IN SHADOW: COUNTED, NEVER FOUND (#10371).
 *
 * Before OneUptime AI offers a data type it drafted from the fields scans
 * could not place, the draft runs in the next scans of the stores that keep
 * them: each scan runs it, on its own, over every field it reads, and
 * counts how many values it would find - in each field where it finds any,
 * and in all of them - and makes no finding, names no value and keeps none.
 * The proposal is then shown from those counts alone: "Matches 98% of the
 * values in these 11 fields, and 0.1% of values elsewhere in the same
 * stores" (Utils/DataSecurity/DataTypeProposal).
 *
 * A draft runs alone, never among the scan's own detectors: there it could
 * take a value from a built-in type, or lose one to it, and change what the
 * scan finds. So each field is classified once more for each draft, with
 * that draft as the only detector and its field names as its only hints -
 * exactly what it would find, were it added.
 *
 * Counts travel with the scan's result as its unplaced fields do: by the
 * location as each scanner names it, prefixed where a scanner names a part
 * of a store (a bucket's object pattern, an account's container) - and a
 * probe's are read again, bounded, before they are kept.
 */

// What a draft's detector is called while it runs: never a finding's type.
export const SHADOW_DATA_TYPE_ID_PREFIX: string = "shadow:";

// The most drafts one scan runs in shadow.
export const MAX_SHADOW_DETECTORS: number = 20;

// The most fields, by location, one draft's counts name.
export const MAX_SHADOW_FIELDS_PER_DRAFT: number = 300;

// The longest location a count names (DataStoreFinding.location).
export const MAX_SHADOW_LOCATION_LENGTH: number = 500;

// The most one count may say: a scan reads far fewer values.
const MAX_SHADOW_COUNT: number = 1_000_000_000;

// A draft's key: what the scan's result counts it under.
const SHADOW_KEY: RegExp = /^[A-Za-z0-9:_-]{1,100}$/;

export interface ShadowDraft {
  key: string;
  definition: Omit<CustomDataTypeDefinition, "dataTypeId">;
}

export interface ShadowScanDetector {
  key: string;
  detector: ScanDetector;
  // The draft's field names: a field named so is context, as for a saved type.
  hints: Array<string>;
}

export interface ShadowFieldCount {
  // Values the scan read in the field, as the classifier reads them.
  values: number;
  // ...and how many of them the draft would find.
  matched: number;
}

export interface ShadowDraftCount {
  // Every field the scan read.
  fields: number;
  values: number;
  matched: number;
  // The fields it would find a value in, by location.
  matchedFields: Record<string, ShadowFieldCount>;
}

// By draft key.
export type ShadowCounts = Record<string, ShadowDraftCount>;

export function isShadowKey(key: unknown): key is string {
  return typeof key === "string" && SHADOW_KEY.test(key);
}

/*
 * The drafts a scan runs in shadow, compiled as a saved type would be: a
 * draft whose pattern cannot run is left out (and counts nothing).
 */
export function compileShadowDetectors(
  drafts: ReadonlyArray<ShadowDraft>,
): Array<ShadowScanDetector> {
  const detectors: Array<ShadowScanDetector> = [];

  for (const draft of drafts) {
    if (
      detectors.length >= MAX_SHADOW_DETECTORS ||
      !isShadowKey(draft.key) ||
      detectors.some((known: ShadowScanDetector): boolean => {
        return known.key === draft.key;
      })
    ) {
      continue;
    }

    const detector: ScanDetector | null = compileCustomDataType({
      ...draft.definition,
      dataTypeId: `${SHADOW_DATA_TYPE_ID_PREFIX}${draft.key}`,
    });

    if (detector) {
      detectors.push({
        key: draft.key,
        detector,
        hints: (draft.definition.nameHints || [])
          .map((hint: string): string => {
            return hint.trim().toLowerCase();
          })
          .filter((hint: string): boolean => {
            return hint.length > 0;
          }),
      });
    }
  }

  return detectors;
}

function emptyDraftCount(): ShadowDraftCount {
  return { fields: 0, values: 0, matched: 0, matchedFields: {} };
}

// How many of a field's values the classifier reads.
function countScannableValues(values: ReadonlyArray<unknown>): number {
  let count: number = 0;

  for (const value of values) {
    if (count >= MAX_FIELD_VALUES) {
      break;
    }

    if (toScannableValue(value) !== null) {
      count++;
    }
  }

  return count;
}

function addFieldCount(
  draft: ShadowDraftCount,
  location: string,
  count: ShadowFieldCount,
): void {
  const known: ShadowFieldCount | undefined = draft.matchedFields[location];

  if (known) {
    known.values += count.values;
    known.matched += count.matched;
    return;
  }

  if (
    location.length > MAX_SHADOW_LOCATION_LENGTH ||
    Object.keys(draft.matchedFields).length >= MAX_SHADOW_FIELDS_PER_DRAFT
  ) {
    return;
  }

  draft.matchedFields[location] = { ...count };
}

/*
 * One field the scan read, counted for every draft: how many of its values
 * each would find. A value found only as a test value is not found.
 */
export function countShadowField(data: {
  counts: ShadowCounts;
  detectors: ReadonlyArray<ShadowScanDetector>;
  location: string;
  values: ReadonlyArray<unknown>;
  allowedValues?: ReadonlySet<string> | undefined;
}): void {
  if (data.detectors.length === 0) {
    return;
  }

  const values: number = countScannableValues(data.values);

  if (values === 0) {
    return;
  }

  for (const shadow of data.detectors) {
    let matched: number = 0;

    try {
      const found: FieldClassification | undefined = classifyField(
        data.location,
        data.values,
        {
          detectors: [shadow.detector],
          extraHints:
            shadow.hints.length > 0
              ? [{ dataTypeId: shadow.detector.dataTypeId, hints: shadow.hints }]
              : [],
          allowedValues: data.allowedValues,
        },
      ).find((classification: FieldClassification): boolean => {
        return classification.dataTypeId === shadow.detector.dataTypeId;
      });

      matched = Math.min(values, found?.valuesWithMatch || 0);
    } catch {
      // A draft that fails on a field finds nothing there.
      matched = 0;
    }

    const draft: ShadowDraftCount =
      data.counts[shadow.key] || emptyDraftCount();

    draft.fields++;
    draft.values += values;
    draft.matched += matched;

    if (matched > 0) {
      addFieldCount(draft, data.location, { values, matched });
    }

    data.counts[shadow.key] = draft;
  }
}

/*
 * A part's counts into the whole's: a bucket's object pattern, an account's
 * container, each named by the prefix its locations take.
 */
export function mergeShadowCounts(
  into: ShadowCounts,
  part: ShadowCounts | undefined,
  prefix: string = "",
): void {
  for (const [key, counted] of Object.entries(part || {})) {
    const draft: ShadowDraftCount = into[key] || emptyDraftCount();

    draft.fields += counted.fields;
    draft.values += counted.values;
    draft.matched += counted.matched;

    for (const [location, count] of Object.entries(counted.matchedFields)) {
      addFieldCount(draft, `${prefix}${location}`, count);
    }

    into[key] = draft;
  }
}

function readCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_SHADOW_COUNT
    ? Math.floor(value)
    : null;
}

/*
 * Counts as a probe sends them, read again: only the drafts it was handed,
 * each number a count, a field never said to hold more matches than values,
 * at most MAX_SHADOW_FIELDS_PER_DRAFT fields a draft.
 */
export function readShadowCounts(
  value: unknown,
  isExpectedKey: (key: string) => boolean = (): boolean => {
    return true;
  },
): ShadowCounts {
  const counts: ShadowCounts = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return counts;
  }

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (
      Object.keys(counts).length >= MAX_SHADOW_DETECTORS ||
      !isShadowKey(key) ||
      !isExpectedKey(key) ||
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      continue;
    }

    const entry: Record<string, unknown> = raw as Record<string, unknown>;
    const fields: number | null = readCount(entry["fields"]);
    const values: number | null = readCount(entry["values"]);
    const matched: number | null = readCount(entry["matched"]);

    if (fields === null || values === null || matched === null) {
      continue;
    }

    const draft: ShadowDraftCount = {
      fields,
      values,
      matched: Math.min(matched, values),
      matchedFields: {},
    };
    const rawFields: unknown = entry["matchedFields"];

    if (rawFields && typeof rawFields === "object" && !Array.isArray(rawFields)) {
      for (const [location, field] of Object.entries(
        rawFields as Record<string, unknown>,
      )) {
        if (!location || !field || typeof field !== "object") {
          continue;
        }

        const fieldValues: number | null = readCount(
          (field as Record<string, unknown>)["values"],
        );
        const fieldMatched: number | null = readCount(
          (field as Record<string, unknown>)["matched"],
        );

        if (fieldValues === null || fieldMatched === null || fieldMatched === 0) {
          continue;
        }

        addFieldCount(draft, location, {
          values: fieldValues,
          matched: Math.min(fieldMatched, fieldValues),
        });
      }
    }

    counts[key] = draft;
  }

  return counts;
}
