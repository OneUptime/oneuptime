import DataCategory, {
  isDataCategory,
} from "../../Types/DataSecurity/DataCategory";
import DataSensitivity, {
  isDataSensitivity,
} from "../../Types/DataSecurity/DataSensitivity";
import { JSONObject } from "../../Types/JSON";
import {
  ALL_CUSTOM_DATA_TYPE_VALIDATORS,
  checkCustomDataType,
  compileCustomDataType,
  CustomDataTypeDefinition,
  CustomDataTypeValidator,
} from "./CustomDataTypeDetector";
import { isSignificantWord } from "./DataTypeCandidates";
import { ShadowDraftCount, ShadowFieldCount } from "./ShadowCount";
import { ScanDetector } from "./TextScanner";
import {
  isValueShape,
  MAX_FIELD_SHAPES,
  MAX_UNPLACED_LOCATION_LENGTH,
  UnplacedValueShape,
} from "./UnplacedFields";

/*
 * A DATA TYPE ONEUPTIME AI PROPOSES, AND THE PROOF IT IS SHOWN WITH (#10371).
 *
 * A group of fields scans could not place (DataTypeCandidates) is drafted
 * into a data type by OneUptime AI - from names and shapes, never a value -
 * and the draft is held to what a saved type is held to: a pattern that
 * compiles, runs in linear time and matches no empty text
 * (checkDataTypeDraft). Then it is proven in shadow (ShadowCount): the next
 * scan of each store of the group, within PROVING_HOURS, counts what it
 * would find in the group's own fields and elsewhere in the same stores,
 * and makes no finding. Twice: as drafted, and narrowed - outside the
 * group's fields it counts only beside a keyword or under a field name
 * that names it - so a draft that reaches too far is narrowed without
 * another wait.
 *
 * The proof decides (decideDataTypeProof), from counts alone:
 *
 *   - it must find at least MIN_GROUP_MATCH_SHARE of the values of the
 *     fields it was drafted from, or it is not their type;
 *   - elsewhere in the same stores it may find at most
 *     MAX_SCATTERED_MATCH_SHARE of the values - not counting a field where
 *     it finds nearly every value (WHOLE_FIELD_MATCH_SHARE), which is the
 *     same data under another name and is shown as such;
 *   - narrowed, it is offered narrowed; otherwise it is dropped.
 *
 * What is offered is the plan: the group (where each field is, never a
 * value), the draft, and its proof - "Matches 98% of the values in these 11
 * fields, and 0.1% of values elsewhere in the same stores". Pure: the
 * server and the Dashboard read it alike.
 */

// How long a draft is proven for at most, unless the project scans less often.
export const PROVING_HOURS: number = 48;

// The share of its own fields' values a draft must find.
export const MIN_GROUP_MATCH_SHARE: number = 0.8;

// The share of other values in the same stores it may find.
export const MAX_SCATTERED_MATCH_SHARE: number = 0.01;

// A field elsewhere where it finds this share of the values holds the same data.
export const WHOLE_FIELD_MATCH_SHARE: number = 0.8;

// The fewest values a count must rest on: its fields', and a whole field's.
export const MIN_PROOF_VALUES: number = 5;

// How long a dropped draft's group waits before it is drafted again.
export const DROPPED_DATA_TYPE_COOLDOWN_DAYS: number = 30;

// What a draft may hold, as a saved type may (DataSecurityCustomDataTypeService).
export const MAX_DRAFT_NAME_LENGTH: number = 100;
export const MAX_DRAFT_DESCRIPTION_LENGTH: number = 500;
export const MAX_DRAFT_PATTERN_LENGTH: number = 500;
export const MAX_DRAFT_WORDS: number = 20;
export const MAX_DRAFT_REASON_LENGTH: number = 300;

// The most fields a plan keeps, and fields elsewhere it names.
export const MAX_PLAN_FIELDS: number = 50;
export const MAX_PROOF_ALSO_IN: number = 10;

/*
 * Plain words, numbers and dates no data type of a company's own should
 * find: a pattern that finds a word here finds words everywhere.
 */
const PLAIN_TEXT: string =
  "the quick brown fox jumps over the lazy dog while Kim and Lee ship orders on Monday, status active pending done, price 12.50 EUR, 2026-11-23 10:30";

export enum DataTypeDraftVariant {
  AsDrafted = "AsDrafted",
  Narrowed = "Narrowed",
}

export const DATA_TYPE_DRAFT_VARIANTS: ReadonlyArray<DataTypeDraftVariant> = [
  DataTypeDraftVariant.AsDrafted,
  DataTypeDraftVariant.Narrowed,
];

// Why a draft was dropped rather than offered.
export enum DataTypeDropReason {
  // OneUptime AI said the group is no data type of its own.
  NotADataType = "NotADataType",
  // Its pattern could not be used: see checkDataTypeDraft.
  DraftUnusable = "DraftUnusable",
  // No store of the group was scanned while it was proven.
  NotScanned = "NotScanned",
  // It found too few of its own fields' values.
  MissesItsFields = "MissesItsFields",
  // It found too much elsewhere, narrowed too.
  ReachesTooFar = "ReachesTooFar",
}

export interface DataTypeDraft {
  name: string;
  description: string;
  category: DataCategory;
  sensitivity: DataSensitivity;
  pattern: string;
  ignoreCase: boolean;
  keywords: Array<string>;
  requiresKeyword: boolean;
  nameHints: Array<string>;
  validator: CustomDataTypeValidator;
}

// One field of the group, as the plan keeps it: where it is, never a value.
export interface DataTypeGroupField {
  dataStoreId: string;
  storeName: string;
  storeKind: string;
  // A telemetry store's service.
  serviceId?: string | undefined;
  location: string;
  locationKind: string;
  shapes: Array<UnplacedValueShape>;
  valueCount: number;
}

// What one scan of one store counted of one variant.
export interface DataTypeStoreVariantCount {
  // The group's fields the scan read, by location.
  fields: Record<string, ShadowFieldCount>;
  // Every other value it read.
  elsewhere: ShadowFieldCount;
  // Fields elsewhere where it found nearly every value, by location.
  wholeFields: Record<string, ShadowFieldCount>;
}

export interface DataTypeStoreCount {
  // When the scan that counted it finished, as an ISO date.
  scannedAt: string;
  variants: Partial<Record<DataTypeDraftVariant, DataTypeStoreVariantCount>>;
}

export interface DataTypeProofField {
  dataStoreId: string;
  storeName: string;
  location: string;
  values: number;
  matched: number;
}

export interface DataTypeProof {
  variant: DataTypeDraftVariant;
  storesInGroup: number;
  storesCounted: number;
  fieldsInGroup: number;
  fieldsCounted: number;
  groupValues: number;
  groupMatched: number;
  elsewhereValues: number;
  elsewhereMatched: number;
  // Elsewhere, less the whole fields: what says whether it reaches too far.
  scatteredValues: number;
  scatteredMatched: number;
  // The group's fields the scans read, each with what it found.
  fields: Array<DataTypeProofField>;
  // Fields elsewhere where it found nearly every value: the same data.
  alsoIn: Array<DataTypeProofField>;
}

export interface DataTypeProposalPlan {
  // What makes it the same group again (DataTypeCandidates).
  groupKey: string;
  skeleton: string;
  // The words its fields' names share, the most shared first.
  words: Array<string>;
  fields: Array<DataTypeGroupField>;
  // How many fields and stores the group has, all of them.
  fieldCount: number;
  storeCount: number;
  shapes: Array<UnplacedValueShape>;
  draft: DataTypeDraft;
  narrowed: DataTypeDraft;
  // Why OneUptime AI says these fields hold one data type.
  reason: string;
  provingSince: string;
  provingUntil: string;
  // Once proven: what was counted, and so which variant is offered.
  proof?: DataTypeProof | undefined;
}

export type DataTypeProofDecision =
  | { outcome: "waiting" }
  | { outcome: "propose"; proof: DataTypeProof }
  | {
      outcome: "drop";
      reason: DataTypeDropReason;
      proof?: DataTypeProof | undefined;
    };

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

// A list of words as a saved type keeps them: trimmed, lower case, once each.
export function readDraftWords(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const words: Array<string> = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const word: string = item.trim().toLowerCase().slice(0, 100);

    if (word && !words.includes(word)) {
      words.push(word);
    }

    if (words.length >= MAX_DRAFT_WORDS) {
      break;
    }
  }

  return words;
}

/*
 * A draft, read again however it was written - by OneUptime AI's answer, or
 * from a stored plan - or null when it is not one: a name, a category and a
 * sensitivity a saved type can carry, a pattern, and the rest held to what
 * a saved type holds.
 */
export function readDataTypeDraft(value: unknown): DataTypeDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: JSONObject = value as JSONObject;
  const name: string = readText(raw["name"], MAX_DRAFT_NAME_LENGTH);
  const pattern: string = readText(raw["pattern"], MAX_DRAFT_PATTERN_LENGTH + 1);
  const validator: unknown = raw["validator"] ?? CustomDataTypeValidator.None;

  if (
    !name ||
    !pattern ||
    pattern.length > MAX_DRAFT_PATTERN_LENGTH ||
    !isDataCategory(raw["category"]) ||
    !isDataSensitivity(raw["sensitivity"]) ||
    !(ALL_CUSTOM_DATA_TYPE_VALIDATORS as ReadonlyArray<unknown>).includes(
      validator,
    )
  ) {
    return null;
  }

  const keywords: Array<string> = readDraftWords(raw["keywords"]);

  return {
    name,
    description: readText(raw["description"], MAX_DRAFT_DESCRIPTION_LENGTH),
    category: raw["category"] as DataCategory,
    sensitivity: raw["sensitivity"] as DataSensitivity,
    pattern,
    ignoreCase: raw["ignoreCase"] === true,
    keywords,
    // It asks for one of the keywords: with none, it would ask nothing.
    requiresKeyword: raw["requiresKeyword"] === true && keywords.length > 0,
    nameHints: readDraftWords(raw["nameHints"]),
    validator: validator as CustomDataTypeValidator,
  };
}

// The draft as the scanner compiles a saved type.
export function toCustomDataTypeDefinition(
  draft: DataTypeDraft,
  dataTypeId: string,
): CustomDataTypeDefinition {
  return {
    dataTypeId,
    pattern: draft.pattern,
    ignoreCase: draft.ignoreCase,
    keywords: draft.keywords,
    requiresKeyword: draft.requiresKeyword,
    nameHints: draft.nameHints,
    validator: draft.validator,
  };
}

// Whether a shape is a value the pattern finds whole: AA-9999999 for [A-Z]{2}-?\d{7}.
function findsWhole(detector: ScanDetector, text: string): boolean {
  if (!("findCandidates" in detector)) {
    return false;
  }

  return detector
    .findCandidates(text)
    .some((candidate: { start: number; end: number }): boolean => {
      return candidate.start === 0 && candidate.end === text.length;
    });
}

export enum DataTypeDraftProblem {
  // No pattern, or one that does not compile, cannot run in linear time or matches empty text.
  PatternUnusable = "PatternUnusable",
  // It finds plain words: it would find words everywhere.
  FindsPlainWords = "FindsPlainWords",
  // It finds none of the shapes it was drafted from.
  MissesItsShapes = "MissesItsShapes",
}

/*
 * What stops a draft from being proven, or null: a pattern held to what a
 * saved type's is held to, that finds no plain word, and - for a draft
 * written from a group's shapes - finds at least one of them whole: a
 * shape is a value of its own shape (AA-9999999 is two capitals, a dash and
 * seven digits), so a pattern that finds none of them was not written for
 * these values.
 */
export function checkDataTypeDraft(
  draft: DataTypeDraft,
  shapes?: ReadonlyArray<UnplacedValueShape> | undefined,
): DataTypeDraftProblem | null {
  const definition: CustomDataTypeDefinition = toCustomDataTypeDefinition(
    draft,
    "custom:draft",
  );

  if (checkCustomDataType(definition) !== null) {
    return DataTypeDraftProblem.PatternUnusable;
  }

  const detector: ScanDetector | null = compileCustomDataType(definition);

  if (!detector || !("findCandidates" in detector)) {
    return DataTypeDraftProblem.PatternUnusable;
  }

  const plainWords: boolean = detector
    .findCandidates(PLAIN_TEXT)
    .some((candidate: { value: string }): boolean => {
      return /^[\p{L}\s]+$/u.test(candidate.value);
    });

  if (plainWords) {
    return DataTypeDraftProblem.FindsPlainWords;
  }

  if (
    shapes &&
    shapes.length > 0 &&
    !shapes.some((shape: UnplacedValueShape): boolean => {
      return findsWhole(detector, shape.shape);
    })
  ) {
    return DataTypeDraftProblem.MissesItsShapes;
  }

  return null;
}

/*
 * The draft narrowed: it finds a value only beside one of its keywords - its
 * own, and the words its fields' names share - or in a field its field
 * names name. Its own fields' values are found as before.
 */
export function narrowDataTypeDraft(
  draft: DataTypeDraft,
  words: ReadonlyArray<string>,
): DataTypeDraft {
  const keywords: Array<string> = [...draft.keywords];

  for (const word of words) {
    const keyword: string = word.trim().toLowerCase();

    if (
      keyword &&
      isSignificantWord(keyword) &&
      !keywords.includes(keyword) &&
      keywords.length < MAX_DRAFT_WORDS
    ) {
      keywords.push(keyword);
    }
  }

  return {
    ...draft,
    keywords,
    requiresKeyword: keywords.length > 0,
  };
}

// What the data type form is filled in with: a saved type's columns.
export function toCustomDataTypeFormValues(draft: DataTypeDraft): JSONObject {
  return {
    name: draft.name,
    description: draft.description,
    category: draft.category,
    sensitivity: draft.sensitivity,
    pattern: draft.pattern,
    ignoreCase: draft.ignoreCase,
    keywords: [...draft.keywords],
    requiresKeyword: draft.requiresKeyword,
    nameHints: [...draft.nameHints],
    validator: draft.validator,
    isEnabled: true,
  };
}

function share(matched: number, values: number): number {
  return values > 0 ? matched / values : 0;
}

/*
 * What one scan of one store counted of one variant, as the proof keeps it:
 * each of the group's fields the scan read - those it found nothing in by
 * the values the scan read there (readFieldValues: the field's description
 * as an unplaced field, or its findings) - every other value it read, and
 * the fields elsewhere where it found nearly every value. Null when the
 * scan did not run the variant.
 */
export function toStoreVariantCount(data: {
  counted: ShadowDraftCount | undefined;
  groupLocations: ReadonlyArray<string>;
  readFieldValues: (location: string) => number;
}): DataTypeStoreVariantCount | null {
  if (!data.counted) {
    return null;
  }

  const count: DataTypeStoreVariantCount = {
    fields: {},
    elsewhere: { values: 0, matched: 0 },
    wholeFields: {},
  };
  const group: Set<string> = new Set(data.groupLocations);
  let groupValues: number = 0;
  let groupMatched: number = 0;

  for (const location of group) {
    const found: ShadowFieldCount | undefined =
      data.counted.matchedFields[location];
    const field: ShadowFieldCount = found
      ? {
          values: found.values,
          matched: Math.min(found.matched, found.values),
        }
      : { values: Math.max(0, data.readFieldValues(location)), matched: 0 };

    if (field.values <= 0) {
      continue;
    }

    count.fields[location] = field;
    groupValues += field.values;
    groupMatched += field.matched;
  }

  count.elsewhere = {
    values: Math.max(0, data.counted.values - groupValues),
    matched: Math.max(0, data.counted.matched - groupMatched),
  };
  count.elsewhere.matched = Math.min(
    count.elsewhere.matched,
    count.elsewhere.values,
  );

  const whole: Array<[string, ShadowFieldCount]> = Object.entries(
    data.counted.matchedFields,
  )
    .filter(([location, field]: [string, ShadowFieldCount]): boolean => {
      return (
        !group.has(location) &&
        field.values >= MIN_PROOF_VALUES &&
        share(field.matched, field.values) >= WHOLE_FIELD_MATCH_SHARE
      );
    })
    .sort(
      (a: [string, ShadowFieldCount], b: [string, ShadowFieldCount]): number => {
        return b[1].matched - a[1].matched;
      },
    )
    .slice(0, MAX_PROOF_ALSO_IN);

  for (const [location, field] of whole) {
    count.wholeFields[location] = {
      values: field.values,
      matched: Math.min(field.matched, field.values),
    };
  }

  return count;
}

/*
 * What the scans counted of one variant, over the group's stores: in the
 * group's own fields, elsewhere, and in fields elsewhere where it found
 * nearly every value.
 */
export function getDataTypeProof(data: {
  plan: Pick<DataTypeProposalPlan, "fields" | "fieldCount" | "storeCount">;
  stores: Readonly<Record<string, DataTypeStoreCount>>;
  variant: DataTypeDraftVariant;
}): DataTypeProof {
  const groupLocations: Map<string, Set<string>> = new Map();
  const storeNames: Map<string, string> = new Map();

  for (const field of data.plan.fields) {
    const locations: Set<string> =
      groupLocations.get(field.dataStoreId) || new Set<string>();

    locations.add(field.location);
    groupLocations.set(field.dataStoreId, locations);
    storeNames.set(field.dataStoreId, field.storeName);
  }

  const proof: DataTypeProof = {
    variant: data.variant,
    storesInGroup: Math.max(data.plan.storeCount, groupLocations.size),
    storesCounted: 0,
    fieldsInGroup: Math.max(data.plan.fieldCount, data.plan.fields.length),
    fieldsCounted: 0,
    groupValues: 0,
    groupMatched: 0,
    elsewhereValues: 0,
    elsewhereMatched: 0,
    scatteredValues: 0,
    scatteredMatched: 0,
    fields: [],
    alsoIn: [],
  };

  for (const [dataStoreId, locations] of groupLocations) {
    const count: DataTypeStoreVariantCount | undefined =
      data.stores[dataStoreId]?.variants[data.variant];

    if (!count) {
      continue;
    }

    proof.storesCounted++;

    for (const [location, field] of Object.entries(count.fields)) {
      if (!locations.has(location) || field.values <= 0) {
        continue;
      }

      proof.fieldsCounted++;
      proof.groupValues += field.values;
      proof.groupMatched += Math.min(field.matched, field.values);
      proof.fields.push({
        dataStoreId,
        storeName: storeNames.get(dataStoreId) || "",
        location,
        values: field.values,
        matched: Math.min(field.matched, field.values),
      });
    }

    proof.elsewhereValues += count.elsewhere.values;
    proof.elsewhereMatched += Math.min(
      count.elsewhere.matched,
      count.elsewhere.values,
    );

    let wholeValues: number = 0;
    let wholeMatched: number = 0;

    for (const [location, field] of Object.entries(count.wholeFields)) {
      wholeValues += field.values;
      wholeMatched += Math.min(field.matched, field.values);
      proof.alsoIn.push({
        dataStoreId,
        storeName: storeNames.get(dataStoreId) || "",
        location,
        values: field.values,
        matched: Math.min(field.matched, field.values),
      });
    }

    proof.scatteredValues += Math.max(0, count.elsewhere.values - wholeValues);
    proof.scatteredMatched += Math.max(
      0,
      Math.min(count.elsewhere.matched, count.elsewhere.values) - wholeMatched,
    );
  }

  proof.scatteredMatched = Math.min(
    proof.scatteredMatched,
    proof.scatteredValues,
  );
  proof.alsoIn = proof.alsoIn
    .sort((a: DataTypeProofField, b: DataTypeProofField): number => {
      return b.matched - a.matched;
    })
    .slice(0, MAX_PROOF_ALSO_IN);

  return proof;
}

// The share of its own fields' values a proof says it found.
export function getGroupMatchShare(proof: DataTypeProof): number {
  return share(proof.groupMatched, proof.groupValues);
}

// The share of values elsewhere in the same stores it found.
export function getElsewhereMatchShare(proof: DataTypeProof): number {
  return share(proof.elsewhereMatched, proof.elsewhereValues);
}

// ...and of those outside the fields that hold the same data.
export function getScatteredMatchShare(proof: DataTypeProof): number {
  return share(proof.scatteredMatched, proof.scatteredValues);
}

// Whether every store of the group was counted by a scan since it was drafted.
export function isEveryStoreCounted(data: {
  plan: Pick<DataTypeProposalPlan, "fields" | "provingSince">;
  stores: Readonly<Record<string, DataTypeStoreCount>>;
}): boolean {
  const since: number = Date.parse(data.plan.provingSince);
  const storeIds: Set<string> = new Set(
    data.plan.fields.map((field: DataTypeGroupField): string => {
      return field.dataStoreId;
    }),
  );

  for (const storeId of storeIds) {
    const counted: DataTypeStoreCount | undefined = data.stores[storeId];
    const at: number = counted ? Date.parse(counted.scannedAt) : NaN;

    if (!counted || !Number.isFinite(at) || (Number.isFinite(since) && at < since)) {
      return false;
    }
  }

  return storeIds.size > 0;
}

/*
 * What the proof says, once every store of the group was counted or the
 * proving time is over: offer it as drafted, offer it narrowed, or drop it.
 */
export function decideDataTypeProof(data: {
  plan: DataTypeProposalPlan;
  stores: Readonly<Record<string, DataTypeStoreCount>>;
  now: Date;
}): DataTypeProofDecision {
  const until: number = Date.parse(data.plan.provingUntil);
  const isOver: boolean =
    !Number.isFinite(until) || data.now.getTime() >= until;

  if (!isOver && !isEveryStoreCounted(data)) {
    return { outcome: "waiting" };
  }

  const drafted: DataTypeProof = getDataTypeProof({
    plan: data.plan,
    stores: data.stores,
    variant: DataTypeDraftVariant.AsDrafted,
  });

  if (drafted.groupValues < MIN_PROOF_VALUES) {
    return {
      outcome: "drop",
      reason: DataTypeDropReason.NotScanned,
      proof: drafted,
    };
  }

  // Narrowing finds no more of its own fields' values: never enough.
  if (getGroupMatchShare(drafted) < MIN_GROUP_MATCH_SHARE) {
    return {
      outcome: "drop",
      reason: DataTypeDropReason.MissesItsFields,
      proof: drafted,
    };
  }

  if (getScatteredMatchShare(drafted) <= MAX_SCATTERED_MATCH_SHARE) {
    return { outcome: "propose", proof: drafted };
  }

  const narrowed: DataTypeProof = getDataTypeProof({
    plan: data.plan,
    stores: data.stores,
    variant: DataTypeDraftVariant.Narrowed,
  });

  if (
    narrowed.groupValues >= MIN_PROOF_VALUES &&
    getGroupMatchShare(narrowed) >= MIN_GROUP_MATCH_SHARE &&
    getScatteredMatchShare(narrowed) <= MAX_SCATTERED_MATCH_SHARE
  ) {
    return { outcome: "propose", proof: narrowed };
  }

  return {
    outcome: "drop",
    reason: DataTypeDropReason.ReachesTooFar,
    proof: drafted,
  };
}

// The draft a plan offers: the variant its proof chose.
export function getOfferedDraft(plan: DataTypeProposalPlan): DataTypeDraft {
  return plan.proof?.variant === DataTypeDraftVariant.Narrowed
    ? plan.narrowed
    : plan.draft;
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function readShapes(value: unknown): Array<UnplacedValueShape> {
  return (Array.isArray(value) ? value : [])
    .filter((item: unknown): boolean => {
      const raw: JSONObject = (item || {}) as JSONObject;

      return (
        typeof raw["shape"] === "string" &&
        isValueShape(raw["shape"]) &&
        typeof raw["share"] === "number" &&
        raw["share"] >= 0 &&
        raw["share"] <= 1
      );
    })
    .slice(0, MAX_FIELD_SHAPES)
    .map((item: unknown): UnplacedValueShape => {
      const raw: JSONObject = item as JSONObject;

      return { shape: raw["shape"] as string, share: raw["share"] as number };
    });
}

function readProofFields(value: unknown): Array<DataTypeProofField> {
  return (Array.isArray(value) ? value : [])
    .filter((item: unknown): boolean => {
      const raw: JSONObject = (item || {}) as JSONObject;

      return (
        typeof raw["dataStoreId"] === "string" &&
        typeof raw["location"] === "string"
      );
    })
    .slice(0, MAX_PLAN_FIELDS)
    .map((item: unknown): DataTypeProofField => {
      const raw: JSONObject = item as JSONObject;
      const values: number = readCount(raw["values"]);

      return {
        dataStoreId: raw["dataStoreId"] as string,
        storeName: readText(raw["storeName"], 200),
        location: readText(raw["location"], MAX_UNPLACED_LOCATION_LENGTH),
        values,
        matched: Math.min(values, readCount(raw["matched"])),
      };
    });
}

function readProof(value: unknown): DataTypeProof | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const raw: JSONObject = value as JSONObject;
  const variant: unknown = raw["variant"];

  if (
    !(DATA_TYPE_DRAFT_VARIANTS as ReadonlyArray<unknown>).includes(variant)
  ) {
    return undefined;
  }

  const groupValues: number = readCount(raw["groupValues"]);
  const elsewhereValues: number = readCount(raw["elsewhereValues"]);
  const scatteredValues: number = readCount(raw["scatteredValues"]);

  return {
    variant: variant as DataTypeDraftVariant,
    storesInGroup: readCount(raw["storesInGroup"]),
    storesCounted: readCount(raw["storesCounted"]),
    fieldsInGroup: readCount(raw["fieldsInGroup"]),
    fieldsCounted: readCount(raw["fieldsCounted"]),
    groupValues,
    groupMatched: Math.min(groupValues, readCount(raw["groupMatched"])),
    elsewhereValues,
    elsewhereMatched: Math.min(
      elsewhereValues,
      readCount(raw["elsewhereMatched"]),
    ),
    scatteredValues,
    scatteredMatched: Math.min(
      scatteredValues,
      readCount(raw["scatteredMatched"]),
    ),
    fields: readProofFields(raw["fields"]),
    alsoIn: readProofFields(raw["alsoIn"]).slice(0, MAX_PROOF_ALSO_IN),
  };
}

/*
 * A stored plan, read again: what the Dashboard draws and the proof reads.
 * Null when it is not one.
 */
export function readDataTypeProposalPlan(
  value: unknown,
): DataTypeProposalPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: JSONObject = value as JSONObject;
  const draft: DataTypeDraft | null = readDataTypeDraft(raw["draft"]);
  const narrowed: DataTypeDraft | null = readDataTypeDraft(raw["narrowed"]);
  const groupKey: string = readText(raw["groupKey"], 100);

  if (!draft || !groupKey) {
    return null;
  }

  const fields: Array<DataTypeGroupField> = (
    Array.isArray(raw["fields"]) ? (raw["fields"] as Array<unknown>) : []
  )
    .filter((item: unknown): boolean => {
      const entry: JSONObject = (item || {}) as JSONObject;

      return (
        typeof entry["dataStoreId"] === "string" &&
        typeof entry["location"] === "string" &&
        entry["location"].length > 0
      );
    })
    .slice(0, MAX_PLAN_FIELDS)
    .map((item: unknown): DataTypeGroupField => {
      const entry: JSONObject = item as JSONObject;
      const field: DataTypeGroupField = {
        dataStoreId: entry["dataStoreId"] as string,
        storeName: readText(entry["storeName"], 200),
        storeKind: readText(entry["storeKind"], 100),
        location: readText(entry["location"], MAX_UNPLACED_LOCATION_LENGTH),
        locationKind: readText(entry["locationKind"], 100),
        shapes: readShapes(entry["shapes"]),
        valueCount: readCount(entry["valueCount"]),
      };
      const serviceId: string = readText(entry["serviceId"], 100);

      if (serviceId) {
        field.serviceId = serviceId;
      }

      return field;
    });

  return {
    groupKey,
    skeleton: readText(raw["skeleton"], 100),
    words: readDraftWords(raw["words"]),
    fields,
    fieldCount: Math.max(readCount(raw["fieldCount"]), fields.length),
    storeCount: Math.max(
      readCount(raw["storeCount"]),
      new Set(
        fields.map((field: DataTypeGroupField): string => {
          return field.dataStoreId;
        }),
      ).size,
    ),
    shapes: readShapes(raw["shapes"]),
    draft,
    narrowed: narrowed || draft,
    reason: readText(raw["reason"], MAX_DRAFT_REASON_LENGTH),
    provingSince: readText(raw["provingSince"], 40),
    provingUntil: readText(raw["provingUntil"], 40),
    proof: readProof(raw["proof"]),
  };
}

function readFieldCounts(
  value: unknown,
  maxFields: number,
): Record<string, ShadowFieldCount> {
  const counts: Record<string, ShadowFieldCount> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return counts;
  }

  for (const [location, field] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (
      Object.keys(counts).length >= maxFields ||
      !location ||
      location.length > MAX_UNPLACED_LOCATION_LENGTH ||
      !field ||
      typeof field !== "object"
    ) {
      continue;
    }

    const values: number = readCount((field as JSONObject)["values"]);

    counts[location] = {
      values,
      matched: Math.min(values, readCount((field as JSONObject)["matched"])),
    };
  }

  return counts;
}

/*
 * What the scans of a proposal's stores counted (the proposal's result,
 * by store), read again: each store's last scan, by variant.
 */
export function readDataTypeStoreCounts(
  value: unknown,
): Record<string, DataTypeStoreCount> {
  const stores: Record<string, DataTypeStoreCount> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return stores;
  }

  for (const [storeId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (
      Object.keys(stores).length >= MAX_PLAN_FIELDS ||
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      continue;
    }

    const entry: JSONObject = raw as JSONObject;
    const scannedAt: string = readText(entry["scannedAt"], 40);
    const variants: Partial<
      Record<DataTypeDraftVariant, DataTypeStoreVariantCount>
    > = {};
    const rawVariants: JSONObject =
      entry["variants"] &&
      typeof entry["variants"] === "object" &&
      !Array.isArray(entry["variants"])
        ? (entry["variants"] as JSONObject)
        : {};

    for (const variant of DATA_TYPE_DRAFT_VARIANTS) {
      const counted: unknown = rawVariants[variant];

      if (!counted || typeof counted !== "object" || Array.isArray(counted)) {
        continue;
      }

      const elsewhere: JSONObject = ((counted as JSONObject)["elsewhere"] ||
        {}) as JSONObject;
      const elsewhereValues: number = readCount(elsewhere["values"]);

      variants[variant] = {
        fields: readFieldCounts(
          (counted as JSONObject)["fields"],
          MAX_PLAN_FIELDS,
        ),
        elsewhere: {
          values: elsewhereValues,
          matched: Math.min(elsewhereValues, readCount(elsewhere["matched"])),
        },
        wholeFields: readFieldCounts(
          (counted as JSONObject)["wholeFields"],
          MAX_PROOF_ALSO_IN,
        ),
      };
    }

    if (scannedAt && !Number.isNaN(Date.parse(scannedAt))) {
      stores[storeId] = { scannedAt, variants };
    }
  }

  return stores;
}

// The stores a plan's group is in.
export function getPlanStoreIds(plan: DataTypeProposalPlan): Array<string> {
  return Array.from(
    new Set(
      plan.fields.map((field: DataTypeGroupField): string => {
        return field.dataStoreId;
      }),
    ),
  );
}
