import DataConfidence from "../../Types/DataSecurity/DataConfidence";
import {
  FINDING_WRONG_MATCH_SIGNS,
  FindingWrongMatchSign,
} from "../../Types/DataSecurity/DataStoreFindingVerdict";
import { getFieldNameWords, getHintedDataTypeIds } from "./FieldNameHints";

/*
 * WHICH FINDINGS WAIT FOR A PERSON, AND WHICH ARE ALIKE (#10372).
 *
 * A finding waits for someone to Confirm it or mark it Not Sensitive when
 * the scan was not sure of it - a Low finding, which OneUptime AI's
 * suggestions always are - or when a Medium or High one shows a sign it
 * matched wrongly:
 *
 *   - most of what matched were well-known test values;
 *   - the field's name points at another data type, and not at this one
 *     (a column named `phone` whose values passed an ID's checksum);
 *   - an id-like field - `order_number`, `invoice_no`, `ref_id` - holds a
 *     type checked by Luhn's algorithm, which one in ten of any digits
 *     passes, and its name does not point at that type.
 *
 * Only those get OneUptime AI's verdict: it never second-guesses a finding
 * the scan is sure of and that shows no sign (#10372's decision).
 *
 * Two findings are alike when they are of the same data type and their
 * fields have the same name, split into words the way the scanner reads a
 * field's own name (FieldNameHints.getFieldNameWords): `order_number`,
 * `orderNumber`, `OrderNumber` and `public.orders.order_number` are all
 * "order number", and `card.number` stays "card number" because a generic
 * last word keeps the one before it. A finding in free text - a log body,
 * a message, an object read as text - has no name to be alike by: what one
 * text holds says nothing about another's. Nor does a name of nothing but
 * generic words (`value`, `payload`, `data`).
 *
 * This decides what Apply to similar lists and what precedent is found
 * first; MeaningSearch only ranks the rest of the precedent, and never
 * picks what a decision is applied to.
 *
 * Pure: the server and the Dashboard decide alike.
 */

/*
 * What separates an object pattern from the field inside its objects in a
 * finding's location: "exports/*\/users-*.csv › email". The object store
 * scanner's LOCATION_SEPARATOR, which a test holds this to.
 */
export const OBJECT_FIELD_SEPARATOR: string = " › ";

// The location kinds whose findings sit in free text, not in a named field.
const FREE_TEXT_LOCATION_KINDS: ReadonlySet<string> = new Set(["Body", "Text"]);

// An object read whole, as text: its pattern names no field.
const OBJECT_LOCATION_KIND: string = "Object";

/*
 * Words that name no kind of data on their own: a field named only with
 * them - `value`, `payload`, `data.json` - is alike every other.
 */
export const GENERIC_FIELD_NAME_WORDS: ReadonlySet<string> = new Set([
  "attr",
  "attribute",
  "attributes",
  "blob",
  "body",
  "code",
  "comment",
  "comments",
  "content",
  "contents",
  "data",
  "desc",
  "description",
  "detail",
  "details",
  "extra",
  "field",
  "id",
  "info",
  "item",
  "items",
  "json",
  "key",
  "line",
  "log",
  "message",
  "meta",
  "metadata",
  "msg",
  "no",
  "note",
  "notes",
  "num",
  "number",
  "object",
  "payload",
  "raw",
  "str",
  "string",
  "text",
  "token",
  "value",
  "values",
]);

/*
 * The data types whose validator is Luhn's check (Utils/DataSecurity/
 * Detectors): one in ten of any digits passes it, so an id-like field of
 * them is often order numbers, not card numbers. A test holds this to the
 * detectors.
 */
export const LUHN_DATA_TYPE_IDS: ReadonlySet<string> = new Set([
  "credit-card-number",
  "ca-sin",
  "se-personnummer",
  "gr-amka",
  "il-teudat-zehut",
  "za-id",
  "ae-emirates-id",
  "sa-national-id",
  "us-npi",
]);

// The last words of a field's name that say it holds an identifier.
export const ID_LIKE_FIELD_WORDS: ReadonlySet<string> = new Set([
  "code",
  "guid",
  "id",
  "identifier",
  "key",
  "no",
  "nr",
  "num",
  "number",
  "ref",
  "reference",
  "seq",
  "serial",
  "sku",
  "uuid",
]);

// What a finding's place is read from: its location, its kind, whether free text.
export interface FindingPlaceFacts {
  location?: string | null | undefined;
  locationKind?: string | null | undefined;
  isFreeText?: boolean | null | undefined;
}

export interface FindingSimilarityFacts extends FindingPlaceFacts {
  dataTypeId?: string | null | undefined;
}

// What decides whether a finding waits for a person.
export interface FindingJudgementFacts extends FindingSimilarityFacts {
  confidence?: string | null | undefined;
  matchCount?: number | null | undefined;
  testValueCount?: number | null | undefined;
  isNameHinted?: boolean | null | undefined;
  isAiSuggested?: boolean | null | undefined;
  isSuppressed?: boolean | null | undefined;
  isConfirmed?: boolean | null | undefined;
}

/*
 * The field a finding sits in, as its location names it: the location
 * itself, or for an object's field the part after its pattern. Null when
 * the finding sits in free text - a body, a message, an object read whole.
 */
export function getFindingFieldName(finding: FindingPlaceFacts): string | null {
  const location: string = (finding.location || "").trim();

  if (
    !location ||
    finding.isFreeText === true ||
    FREE_TEXT_LOCATION_KINDS.has(finding.locationKind || "")
  ) {
    return null;
  }

  const separator: number = location.lastIndexOf(OBJECT_FIELD_SEPARATOR);

  if (separator >= 0) {
    const field: string = location
      .slice(separator + OBJECT_FIELD_SEPARATOR.length)
      .trim();

    return field || null;
  }

  // An object's pattern alone: the object was read as text.
  return finding.locationKind === OBJECT_LOCATION_KIND ? null : location;
}

/*
 * The words of a finding's field's own name, as the scanner reads them:
 * [] when it sits in free text or its name is nothing but generic words.
 */
export function getFindingNameWords(
  finding: FindingPlaceFacts,
): Array<string> {
  const field: string | null = getFindingFieldName(finding);

  if (!field) {
    return [];
  }

  const words: Array<string> = getFieldNameWords(field);

  return words.some((word: string): boolean => {
    return !GENERIC_FIELD_NAME_WORDS.has(word);
  })
    ? words
    : [];
}

/*
 * The name two findings are alike by: "order number" for `order_number`,
 * `orderNumber` and `public.orders.order_number`. Null for a finding with
 * no name to be alike by.
 */
export function getFindingNameKey(finding: FindingPlaceFacts): string | null {
  const words: Array<string> = getFindingNameWords(finding);

  return words.length > 0 ? words.join(" ") : null;
}

/*
 * Whether two findings are alike: the same data type, and fields of the
 * same name. What Apply to similar lists, and the precedent found first.
 */
export function areFindingsSimilar(
  a: FindingSimilarityFacts,
  b: FindingSimilarityFacts,
): boolean {
  if (!a.dataTypeId || a.dataTypeId !== b.dataTypeId) {
    return false;
  }

  const key: string | null = getFindingNameKey(a);

  return key !== null && key === getFindingNameKey(b);
}

/*
 * The signs that a finding matched wrongly, whatever its confidence (see
 * the module comment), in FINDING_WRONG_MATCH_SIGNS' order.
 */
export function getWrongMatchSigns(
  finding: FindingJudgementFacts,
): Array<FindingWrongMatchSign> {
  const signs: Set<FindingWrongMatchSign> = new Set();
  const testValues: number = finding.testValueCount || 0;

  if (testValues > 0 && testValues > (finding.matchCount || 0)) {
    signs.add(FindingWrongMatchSign.MostlyTestValues);
  }

  const words: Array<string> = getFindingNameWords(finding);
  const dataTypeId: string = finding.dataTypeId || "";

  if (words.length > 0 && dataTypeId && finding.isNameHinted !== true) {
    const field: string = getFindingFieldName(finding) || "";
    const hinted: Set<string> = getHintedDataTypeIds(field);

    if (hinted.size > 0 && !hinted.has(dataTypeId)) {
      signs.add(FindingWrongMatchSign.NamePointsElsewhere);
    }

    if (
      LUHN_DATA_TYPE_IDS.has(dataTypeId) &&
      !hinted.has(dataTypeId) &&
      ID_LIKE_FIELD_WORDS.has(words[words.length - 1]!)
    ) {
      signs.add(FindingWrongMatchSign.IdFieldWithLuhnNumbers);
    }
  }

  return FINDING_WRONG_MATCH_SIGNS.filter(
    (sign: FindingWrongMatchSign): boolean => {
      return signs.has(sign);
    },
  );
}

/*
 * Whether a finding waits for a person: nobody decided it yet, and the
 * scan was not sure of it, or it shows a sign it matched wrongly.
 */
export function isFindingAwaitingJudgement(
  finding: FindingJudgementFacts,
): boolean {
  if (finding.isSuppressed === true || finding.isConfirmed === true) {
    return false;
  }

  if (
    finding.isAiSuggested === true ||
    finding.confidence === DataConfidence.Low ||
    !finding.confidence
  ) {
    return true;
  }

  return getWrongMatchSigns(finding).length > 0;
}
