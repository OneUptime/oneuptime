import { sha256Hex } from "../../Types/AutoRemediation/RemediationPlanFingerprint";
import {
  fieldNameWords,
  MAX_FIELD_SHAPES,
  UnplacedField,
  UnplacedValueShape,
} from "./UnplacedFields";

/*
 * THE COMPANY'S OWN DATA TYPES, IN THE FIELDS SCANS COULD NOT PLACE (#10371).
 *
 * Every content scan keeps the fields no detector could place, by their
 * names and the shapes of their values, never a value (UnplacedFields). One
 * such field is a question for OneUptime AI (FieldSuggestion); the same
 * unknown shape under the same kind of name in eleven columns of six
 * stores is a data type the company has and OneUptime does not know.
 *
 * This finds those groups, from names and shapes alone:
 *
 *   - by shape: each field by the skeleton of its values' shapes - its runs
 *     of capitals, small letters and digits, in order, the separators
 *     between them optional - so `AB-1234567` and `AB1234567` (AA-9999999,
 *     AA9999999) are one kind of value, and `AB-1234-X` (AA-9999-A) another.
 *     A field whose values do not mostly share one skeleton holds no one
 *     kind of value. A skeleton with no digit (names, words, statuses) is
 *     never a company's identifier, nor is a date, a time or a decimal
 *     number;
 *   - by name: fields of one skeleton belong together when their names share
 *     a word that says what they hold - `policy_no`, `policyNumber` and
 *     `police_nr` share policy (police is one letter from it); `no`, `nr`,
 *     `number`, `id`, `ref` and the like say nothing by themselves;
 *   - a group of at least MIN_CANDIDATE_FIELDS fields in at least
 *     MIN_CANDIDATE_STORES stores is a candidate: one odd column is not a
 *     data type.
 *
 * A candidate's key is its skeleton and the word its fields' names share
 * most: it stays the same as the group gains or loses a field, so a group
 * a person said is not a data type is never proposed again.
 *
 * Pure: the server reads the stores' fields, this groups them.
 */

export const MIN_CANDIDATE_FIELDS: number = 3;
export const MIN_CANDIDATE_STORES: number = 2;

// The share of a field's values one skeleton must have for the field to hold one kind of value.
export const DOMINANT_SKELETON_SHARE: number = 0.6;

// The most fields one grouping reads: the newest scans' of every store.
export const MAX_CANDIDATE_INPUT_FIELDS: number = 20_000;

// The most fields a candidate keeps, the most valued first.
export const MAX_CANDIDATE_FIELDS: number = 50;

// Separators a value may or may not write between its parts: AB-123 and AB123.
const OPTIONAL_SEPARATORS: ReadonlySet<string> = new Set([
  "-",
  "_",
  " ",
  ".",
  "/",
]);

/*
 * Words that say how a field holds something, not what: a policy number,
 * a policy no., a policy ref and a policy id are all policies.
 */
const GENERIC_NAME_WORDS: ReadonlySet<string> = new Set([
  "no",
  "nr",
  "num",
  "nbr",
  "number",
  "numero",
  "nummer",
  "id",
  "ids",
  "ident",
  "identifier",
  "ref",
  "refs",
  "reference",
  "code",
  "key",
  "value",
  "val",
  "data",
  "info",
  "field",
  "col",
  "column",
  "attr",
  "attribute",
  "attributes",
  "txt",
  "text",
  "str",
  "string",
  "the",
  "of",
  "and",
  "de",
  "du",
  "la",
  "le",
  "el",
  "der",
  "die",
  "das",
  "und",
  "resource",
]);

// Shapes that are a date, a time or a decimal number: never a company's identifier.
const NOT_AN_IDENTIFIER: ReadonlyArray<RegExp> = [
  // 2026-11-23, 2026-11-23T12:00:00
  /^9{4}-9{2}-9{2}/,
  // 23.11.2026, 11/23/26
  /^9{1,2}[./-]9{1,2}[./-]9{2,4}$/,
  // 12:00, 12:00:00.000
  /^9{1,2}:9{2}/,
  // 3.14, -12,50
  /^-?9+[.,]9+$/,
];

export interface CandidateInputField {
  dataStoreId: string;
  storeName: string;
  storeKind: string;
  // A telemetry store's service: where a telemetry scan finds the store.
  serviceId?: string | undefined;
  field: UnplacedField;
}

export interface DataTypeCandidateField extends CandidateInputField {
  // The field's own name, in its words: policy_no is "policy no".
  nameWords: Array<string>;
}

export interface DataTypeCandidate {
  // What makes it the same group again: its skeleton and its name's word.
  key: string;
  skeleton: string;
  // The word its fields' names share most, and the others they share.
  words: Array<string>;
  fields: Array<DataTypeCandidateField>;
  stores: number;
  // Its fields' shapes together, each by its share of all their values.
  shapes: Array<UnplacedValueShape>;
  values: number;
}

/*
 * A shape's skeleton: its runs of capitals (A), small letters (a) and
 * digits (9), in order, whatever their lengths, with the separators a value
 * may leave out (OPTIONAL_SEPARATORS) left out, and any other character
 * kept as it is. AA-9999999 and AA9999999 are both "A9"; 999-99-9999 is
 * "9"; aaaa@aaaa.aaa is "a@a".
 */
export function shapeSkeleton(shape: string): string {
  let skeleton: string = "";
  let previous: string = "";

  for (const character of shape) {
    if (OPTIONAL_SEPARATORS.has(character)) {
      continue;
    }

    const isRun: boolean =
      character === "A" || character === "a" || character === "9";

    if (!isRun || character !== previous) {
      skeleton += character;
    }

    previous = isRun ? character : "";
  }

  return skeleton;
}

/*
 * The skeleton most of a field's values share, or null when no one does
 * (DOMINANT_SKELETON_SHARE), or it is no identifier's.
 */
export function getFieldSkeleton(field: UnplacedField): string | null {
  const shares: Map<string, number> = new Map();
  let topShape: UnplacedValueShape | undefined = undefined;

  for (const shape of field.shapes) {
    const skeleton: string = shapeSkeleton(shape.shape);

    shares.set(skeleton, (shares.get(skeleton) || 0) + shape.share);

    if (!topShape || shape.share > topShape.share) {
      topShape = shape;
    }
  }

  let best: string | null = null;
  let bestShare: number = 0;

  for (const [skeleton, share] of shares) {
    if (
      share > bestShare ||
      (share === bestShare && best !== null && skeleton < best)
    ) {
      best = skeleton;
      bestShare = share;
    }
  }

  if (
    best === null ||
    bestShare + 1e-9 < DOMINANT_SKELETON_SHARE ||
    !best.includes("9") ||
    (topShape &&
      NOT_AN_IDENTIFIER.some((pattern: RegExp): boolean => {
        return pattern.test(topShape!.shape);
      }))
  ) {
    return null;
  }

  return best;
}

// A name's word as it is compared: lower case, a plural made singular.
function normalizeWord(word: string): string {
  const lower: string = word.toLowerCase();

  if (lower.length > 4 && lower.endsWith("ies")) {
    return `${lower.slice(0, -3)}y`;
  }

  if (lower.length > 4 && lower.endsWith("s") && !lower.endsWith("ss")) {
    return lower.slice(0, -1);
  }

  return lower;
}

/*
 * A field's own name, in words: the last part of its path, and the part
 * before it where the last says nothing by itself (attributes.customer.id
 * is "customer id").
 */
export function getOwnNameWords(location: string): Array<string> {
  const parts: Array<string> = location
    .split(".")
    .filter((part: string): boolean => {
      return part.length > 0;
    });
  const words: Array<string> = [];

  for (let index: number = parts.length - 1; index >= 0; index--) {
    const partWords: Array<string> = fieldNameWords(parts[index]!).map(
      normalizeWord,
    );

    words.unshift(...partWords);

    if (
      partWords.some((word: string): boolean => {
        return isSignificantWord(word);
      })
    ) {
      break;
    }

    // At most the last two parts: a path's start names where, not what.
    if (index <= parts.length - 2) {
      break;
    }
  }

  return words;
}

// A word that says what a field holds: not a generic one, and not a letter or two.
export function isSignificantWord(word: string): boolean {
  return (
    word.length >= 3 && !GENERIC_NAME_WORDS.has(word) && !/^\d+$/.test(word)
  );
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) {
    return false;
  }

  let index: number = 0;

  while (index < a.length && index < b.length && a[index] === b[index]) {
    index++;
  }

  if (a.length === b.length) {
    return a.slice(index + 1) === b.slice(index + 1);
  }

  return a.length > b.length
    ? a.slice(index + 1) === b.slice(index)
    : a.slice(index) === b.slice(index + 1);
}

/*
 * Whether two names' words say the same thing: the same word, one the start
 * of the other (cust, customer), or one letter apart (policy, police).
 */
export function isSameNameWord(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }

  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) {
    return true;
  }

  return a.length >= 5 && b.length >= 5 && editDistanceAtMostOne(a, b);
}

class UnionFind {
  private readonly parents: Array<number>;

  public constructor(size: number) {
    this.parents = Array.from({ length: size }, (_: unknown, index: number) => {
      return index;
    });
  }

  public find(index: number): number {
    let root: number = index;

    while (this.parents[root] !== root) {
      root = this.parents[root]!;
    }

    // Every step on the way now points at the root.
    let step: number = index;

    while (this.parents[step] !== root) {
      const next: number = this.parents[step]!;
      this.parents[step] = root;
      step = next;
    }

    return root;
  }

  public union(a: number, b: number): void {
    const rootA: number = this.find(a);
    const rootB: number = this.find(b);

    if (rootA !== rootB) {
      this.parents[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
    }
  }
}

// What a candidate is keyed by: its skeleton and its name's word, hashed.
export function getDataTypeCandidateKey(data: {
  skeleton: string;
  word: string;
}): string {
  return `data-type:${sha256Hex(`${data.skeleton}\n${data.word}`).slice(0, 16)}`;
}

// The shapes of a group's fields together, each by its share of all their values.
function mergeShapes(
  fields: ReadonlyArray<DataTypeCandidateField>,
): Array<UnplacedValueShape> {
  const weights: Map<string, number> = new Map();
  let total: number = 0;

  for (const entry of fields) {
    const values: number = Math.max(1, entry.field.valueCount);

    total += values;

    for (const shape of entry.field.shapes) {
      weights.set(
        shape.shape,
        (weights.get(shape.shape) || 0) + shape.share * values,
      );
    }
  }

  return Array.from(weights.entries())
    .sort((a: [string, number], b: [string, number]): number => {
      return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    })
    .slice(0, MAX_FIELD_SHAPES)
    .map(([shape, weight]: [string, number]): UnplacedValueShape => {
      return {
        shape,
        share: total > 0 ? Math.round((weight / total) * 100) / 100 : 0,
      };
    });
}

// The word a group's fields' names share most: the one its key keeps.
function rankWords(fields: ReadonlyArray<DataTypeCandidateField>): Array<string> {
  const counts: Map<string, number> = new Map();

  for (const entry of fields) {
    for (const word of new Set(entry.nameWords.filter(isSignificantWord))) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }

  const ranked: Array<string> = Array.from(counts.entries())
    .sort((a: [string, number], b: [string, number]): number => {
      return (
        b[1] - a[1] ||
        a[0].length - b[0].length ||
        (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
      );
    })
    .map(([word]: [string, number]): string => {
      return word;
    });

  if (ranked.length > 0) {
    return ranked;
  }

  // Names of generic words alone (ref, number): the name itself is the word.
  return [fields[0]!.nameWords.join(" ")];
}

/*
 * The groups of fields that look like one data type of the company's own:
 * at least MIN_CANDIDATE_FIELDS fields in at least MIN_CANDIDATE_STORES
 * stores, most fields first.
 */
export function findDataTypeCandidates(
  input: ReadonlyArray<CandidateInputField>,
): Array<DataTypeCandidate> {
  const fields: Array<DataTypeCandidateField & { skeleton: string }> = [];

  for (const entry of input.slice(0, MAX_CANDIDATE_INPUT_FIELDS)) {
    const skeleton: string | null = getFieldSkeleton(entry.field);
    const nameWords: Array<string> = getOwnNameWords(entry.field.location);

    if (skeleton && nameWords.length > 0) {
      fields.push({ ...entry, nameWords, skeleton });
    }
  }

  const unions: UnionFind = new UnionFind(fields.length);
  const bySkeleton: Map<string, Array<number>> = new Map();

  fields.forEach(
    (field: DataTypeCandidateField & { skeleton: string }, index: number) => {
      bySkeleton.set(field.skeleton, [
        ...(bySkeleton.get(field.skeleton) || []),
        index,
      ]);
    },
  );

  for (const indexes of bySkeleton.values()) {
    // Each word of the bucket, and the fields that say it.
    const fieldsByWord: Map<string, Array<number>> = new Map();
    // Names of generic words alone, by the whole name.
    const fieldsByName: Map<string, Array<number>> = new Map();

    for (const index of indexes) {
      const words: Array<string> = fields[index]!.nameWords.filter(
        isSignificantWord,
      );

      if (words.length === 0) {
        const name: string = fields[index]!.nameWords.join(" ");
        fieldsByName.set(name, [...(fieldsByName.get(name) || []), index]);
        continue;
      }

      for (const word of new Set(words)) {
        fieldsByWord.set(word, [...(fieldsByWord.get(word) || []), index]);
      }
    }

    for (const group of [...fieldsByWord.values(), ...fieldsByName.values()]) {
      for (const index of group.slice(1)) {
        unions.union(group[0]!, index);
      }
    }

    // Words that say the same thing join their fields: policy and police.
    const words: Array<string> = Array.from(fieldsByWord.keys()).sort();

    for (let a: number = 0; a < words.length; a++) {
      for (let b: number = a + 1; b < words.length; b++) {
        if (isSameNameWord(words[a]!, words[b]!)) {
          unions.union(
            fieldsByWord.get(words[a]!)![0]!,
            fieldsByWord.get(words[b]!)![0]!,
          );
        }
      }
    }
  }

  const groups: Map<number, Array<number>> = new Map();

  fields.forEach((_field: DataTypeCandidateField, index: number): void => {
    const root: number = unions.find(index);
    groups.set(root, [...(groups.get(root) || []), index]);
  });

  const candidates: Array<DataTypeCandidate> = [];

  for (const indexes of groups.values()) {
    const members: Array<DataTypeCandidateField & { skeleton: string }> =
      indexes.map((index: number) => {
        return fields[index]!;
      });
    const stores: Set<string> = new Set(
      members.map((member: DataTypeCandidateField): string => {
        return member.dataStoreId;
      }),
    );

    if (
      members.length < MIN_CANDIDATE_FIELDS ||
      stores.size < MIN_CANDIDATE_STORES
    ) {
      continue;
    }

    const ordered: Array<DataTypeCandidateField> = members
      .sort((a: DataTypeCandidateField, b: DataTypeCandidateField): number => {
        return (
          b.field.valueCount - a.field.valueCount ||
          (a.dataStoreId < b.dataStoreId
            ? -1
            : a.dataStoreId > b.dataStoreId
              ? 1
              : 0) ||
          (a.field.location < b.field.location
            ? -1
            : a.field.location > b.field.location
              ? 1
              : 0)
        );
      })
      .map(
        ({
          skeleton: _skeleton,
          ...member
        }: DataTypeCandidateField & {
          skeleton: string;
        }): DataTypeCandidateField => {
          return member;
        },
      );
    const words: Array<string> = rankWords(ordered);
    const skeleton: string = members[0]!.skeleton;

    candidates.push({
      key: getDataTypeCandidateKey({ skeleton, word: words[0]! }),
      skeleton,
      words: words.slice(0, 10),
      fields: ordered.slice(0, MAX_CANDIDATE_FIELDS),
      stores: stores.size,
      shapes: mergeShapes(ordered),
      values: ordered.reduce((sum: number, entry: DataTypeCandidateField) => {
        return sum + entry.field.valueCount;
      }, 0),
    });
  }

  return candidates.sort((a: DataTypeCandidate, b: DataTypeCandidate) => {
    return (
      b.fields.length - a.fields.length ||
      b.stores - a.stores ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    );
  });
}
