import { toScannableValue } from "./FieldClassifier";

/*
 * THE FIELDS A SCAN CANNOT PLACE, DESCRIBED WITHOUT THEIR VALUES.
 *
 * A column or a document field whose name hints at no data type and whose
 * values matched no detector is not known to be safe: it can be a
 * customer's own identifier, a code nobody wrote a detector for, a column
 * named in another language. When the project's Enable AI is on, OneUptime
 * AI is asked what such a field holds (Server/Utils/AI/DataSecurity/
 * FieldSuggestion) - and is told only:
 *
 *   - the field's name, and the names of the fields beside it;
 *   - the shapes of its values: every letter written as "a" or "A", every
 *     digit as "9", the rest as it is - "AB-1234" is "AA-9999",
 *     "kim@acme.example" is "aaa@aaaa.aaaaaaa" - the most common ones
 *     first, each with its share of the values;
 *   - how many values were read, and how long they are on average.
 *
 * Never a value: a shape says what a value looks like, never what it is.
 * A shape a probe sends is read again here (isValueShape), so a value
 * cannot reach a prompt dressed as one.
 *
 * Not every unplaced field is worth asking about: free text (values of
 * more than FREE_TEXT_AVERAGE_LENGTH characters on average) has its own
 * classification; a field with fewer than MIN_UNPLACED_VALUES values says
 * too little; small whole numbers (counts, ids, flags) and true or false
 * are not data anyone protects; and a field named as bookkeeping - an id,
 * a timestamp, a status - is left alone.
 */

// The fewest non-empty values a field needs before it is asked about.
export const MIN_UNPLACED_VALUES: number = 5;

// The most values of one field whose shapes are read.
export const MAX_SHAPED_VALUES: number = 1000;

// The most shapes, and the longest shape, a field is described with.
export const MAX_FIELD_SHAPES: number = 6;
export const MAX_SHAPE_LENGTH: number = 40;

// The most neighbours named beside a field, and the longest name.
export const MAX_FIELD_NEIGHBOURS: number = 20;
export const MAX_NEIGHBOUR_LENGTH: number = 100;

// The longest location a field is described at (DataStoreFinding.location).
export const MAX_UNPLACED_LOCATION_LENGTH: number = 500;

// The most unplaced fields one scan keeps.
export const MAX_UNPLACED_FIELDS_PER_SCAN: number = 200;

// Above this average length a field is free text, not one kind of value.
export const FREE_TEXT_AVERAGE_LENGTH: number = 80;

// Whole numbers below this are counts and ids, not protected data.
const SMALL_NUMBER_LIMIT: number = 1_000_000;

// What a shape cut at MAX_SHAPE_LENGTH ends with.
const SHAPE_CUT: string = "…";

/*
 * The last word of a field's name that makes it bookkeeping: created_at,
 * order_id, row_version, is_active.
 */
const BOOKKEEPING_WORDS: ReadonlySet<string> = new Set([
  "id",
  "ids",
  "uuid",
  "guid",
  "pk",
  "fk",
  "at",
  "on",
  "timestamp",
  "ts",
  "created",
  "updated",
  "modified",
  "deleted",
  "version",
  "revision",
  "status",
  "state",
  "type",
  "kind",
  "count",
  "total",
  "enabled",
  "active",
  "flag",
  "order",
  "index",
  "position",
  "sort",
  "rank",
]);

export interface UnplacedValueShape {
  shape: string;
  // The share of the field's values with this shape, from 0 to 1.
  share: number;
}

export interface UnplacedField {
  // Where the field is, as a finding there would name it.
  location: string;
  locationKind: string;
  // The other fields of the same table or record, by name.
  neighbours: Array<string>;
  shapes: Array<UnplacedValueShape>;
  valueCount: number;
  averageLength: number;
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

const OTHER_DIGIT: RegExp = /\p{Nd}/u;
const LETTER: RegExp = /\p{L}/u;

function isAnyDigit(character: string): boolean {
  return isDigit(character) || OTHER_DIGIT.test(character);
}

function isAnyLetter(character: string): boolean {
  return (
    character.toUpperCase() !== character.toLowerCase() ||
    LETTER.test(character)
  );
}

/*
 * A value's shape: a letter that has a case as "A" or "a", one that has
 * none (Chinese, Japanese) as "a", a digit as "9", a tab or a line break
 * as a space, and every other character as itself. At most
 * MAX_SHAPE_LENGTH characters, and an ellipsis when it was longer.
 */
export function valueShape(value: string): string {
  let shape: string = "";
  let length: number = 0;

  for (const character of value) {
    if (length >= MAX_SHAPE_LENGTH) {
      return `${shape}${SHAPE_CUT}`;
    }

    if (isAnyDigit(character)) {
      shape += "9";
    } else if (character.toUpperCase() !== character.toLowerCase()) {
      shape += character === character.toUpperCase() ? "A" : "a";
    } else if (LETTER.test(character)) {
      shape += "a";
    } else if (character === "\t" || character === "\n" || character === "\r") {
      shape += " ";
    } else {
      shape += character;
    }

    length++;
  }

  return shape;
}

/*
 * Whether a text is a shape and nothing more: no letter but "A" and "a",
 * no digit but "9", an ellipsis only at its end, and no longer than a
 * shape is cut to. A probe's shapes are read with it.
 */
export function isValueShape(text: string): boolean {
  if (text.length === 0) {
    return false;
  }

  const characters: Array<string> = Array.from(text);

  if (characters.length > MAX_SHAPE_LENGTH + 1) {
    return false;
  }

  for (let index: number = 0; index < characters.length; index++) {
    const character: string = characters[index]!;

    if (character === SHAPE_CUT) {
      if (index !== characters.length - 1 || index !== MAX_SHAPE_LENGTH) {
        return false;
      }
      continue;
    }

    if (character === "A" || character === "a" || character === "9") {
      continue;
    }

    if (
      isAnyDigit(character) ||
      isAnyLetter(character) ||
      character === "\t" ||
      character === "\n" ||
      character === "\r"
    ) {
      return false;
    }
  }

  return true;
}

// The words of a field's name: "billing.customerRef" -> billing, customer, ref.
export function fieldNameWords(path: string): Array<string> {
  const words: Array<string> = [];
  let word: string = "";

  const flush: () => void = (): void => {
    if (word) {
      words.push(word.toLowerCase());
      word = "";
    }
  };

  for (const character of path) {
    const isSeparator: boolean =
      character === "_" ||
      character === "-" ||
      character === "." ||
      character === " " ||
      character === "[" ||
      character === "]" ||
      character === "/" ||
      character === ":";

    if (isSeparator) {
      flush();
      continue;
    }

    // customerRef: a capital after a lower-case letter starts a word.
    if (
      word &&
      character !== character.toLowerCase() &&
      word.charAt(word.length - 1) !==
        word.charAt(word.length - 1).toUpperCase()
    ) {
      flush();
    }

    word += character;
  }

  flush();

  return words;
}

// The field's own name: the last part of its path ("public.users.email" -> "email").
export function fieldOwnName(path: string): string {
  const separator: number = path.lastIndexOf(".");

  return separator >= 0 ? path.slice(separator + 1) : path;
}

// Whether a field is named as bookkeeping: its last word is an id, a time, a status.
export function isBookkeepingField(path: string): boolean {
  const words: Array<string> = fieldNameWords(fieldOwnName(path));
  const last: string = words[words.length - 1] || "";

  return BOOKKEEPING_WORDS.has(last) || (words[0] === "is" && words.length > 1);
}

function isSmallWholeNumber(value: string): boolean {
  if (value.length === 0 || value.length > 7) {
    return false;
  }

  for (const character of value) {
    if (!isDigit(character)) {
      return false;
    }
  }

  return Number(value) < SMALL_NUMBER_LIMIT;
}

/*
 * The names of a field's neighbours as the field's own table or record
 * names them: "public.users.email" beside "public.users.kundennr" is
 * "email". At most MAX_FIELD_NEIGHBOURS, the field itself left out.
 */
export function neighbourNames(
  path: string,
  neighbours: ReadonlyArray<string>,
): Array<string> {
  const separator: number = path.lastIndexOf(".");
  const parent: string = separator >= 0 ? path.slice(0, separator + 1) : "";
  const names: Array<string> = [];

  for (const neighbour of neighbours) {
    if (names.length >= MAX_FIELD_NEIGHBOURS) {
      break;
    }

    if (!neighbour || neighbour === path) {
      continue;
    }

    const name: string = (
      parent && neighbour.startsWith(parent)
        ? neighbour.slice(parent.length)
        : neighbour
    ).slice(0, MAX_NEIGHBOUR_LENGTH);

    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

/*
 * One field the scan could not place, described for OneUptime AI - or null
 * when it is not worth asking about.
 */
export function describeUnplacedField(data: {
  path: string;
  values: ReadonlyArray<unknown>;
  neighbours: ReadonlyArray<string>;
  locationKind: string;
}): UnplacedField | null {
  if (
    !data.path ||
    data.path.length > MAX_UNPLACED_LOCATION_LENGTH ||
    isBookkeepingField(data.path)
  ) {
    return null;
  }

  const values: Array<string> = [];
  let booleans: number = 0;

  for (const raw of data.values) {
    if (values.length >= MAX_SHAPED_VALUES) {
      break;
    }

    if (typeof raw === "boolean") {
      booleans++;
      continue;
    }

    const value: string | null = toScannableValue(raw);

    if (value !== null) {
      values.push(value);
    }
  }

  if (values.length < MIN_UNPLACED_VALUES || booleans > values.length) {
    return null;
  }

  const total: number = values.reduce((sum: number, value: string) => {
    return sum + value.length;
  }, 0);
  const averageLength: number = total / values.length;

  if (averageLength > FREE_TEXT_AVERAGE_LENGTH) {
    return null;
  }

  if (values.every(isSmallWholeNumber)) {
    return null;
  }

  const counts: Map<string, number> = new Map();

  for (const value of values) {
    const shape: string = valueShape(value);
    counts.set(shape, (counts.get(shape) || 0) + 1);
  }

  const shapes: Array<UnplacedValueShape> = Array.from(counts.entries())
    .sort((a: [string, number], b: [string, number]): number => {
      return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    })
    .slice(0, MAX_FIELD_SHAPES)
    .map(([shape, count]: [string, number]): UnplacedValueShape => {
      return {
        shape,
        share: Math.round((count / values.length) * 100) / 100,
      };
    });

  return {
    location: data.path,
    locationKind: data.locationKind,
    neighbours: neighbourNames(data.path, data.neighbours),
    shapes,
    valueCount: values.length,
    averageLength: Math.round(averageLength * 10) / 10,
  };
}

/*
 * What identifies the description of a field: its location and its
 * shapes. A field asked about once is not asked about again while it
 * looks the same.
 */
export function unplacedFieldSignature(field: UnplacedField): string {
  return [
    field.location,
    ...field.shapes.map((shape: UnplacedValueShape): string => {
      return shape.shape;
    }),
  ].join("|");
}

function readBoundedNumber(value: unknown, max: number): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max
    ? value
    : null;
}

/*
 * Unplaced fields as a probe sends them, read again: at most
 * MAX_UNPLACED_FIELDS_PER_SCAN, each location and name held to its length,
 * each shape a shape (isValueShape) with its share - and a field with no
 * shape left, or a location kind the server does not know, left out.
 */
export function readUnplacedFields(
  value: unknown,
  isLocationKind: (kind: string) => boolean,
): Array<UnplacedField> {
  if (!Array.isArray(value)) {
    return [];
  }

  const fields: Array<UnplacedField> = [];

  for (const item of value.slice(0, MAX_UNPLACED_FIELDS_PER_SCAN)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const raw: Record<string, unknown> = item as Record<string, unknown>;
    const location: unknown = raw["location"];
    const locationKind: unknown = raw["locationKind"];
    const valueCount: number | null = readBoundedNumber(
      raw["valueCount"],
      MAX_SHAPED_VALUES,
    );
    const averageLength: number | null = readBoundedNumber(
      raw["averageLength"],
      FREE_TEXT_AVERAGE_LENGTH,
    );

    if (
      typeof location !== "string" ||
      location.length === 0 ||
      location.length > MAX_UNPLACED_LOCATION_LENGTH ||
      typeof locationKind !== "string" ||
      !isLocationKind(locationKind) ||
      valueCount === null ||
      averageLength === null
    ) {
      continue;
    }

    const shapes: Array<UnplacedValueShape> = [];

    for (const shape of Array.isArray(raw["shapes"])
      ? (raw["shapes"] as Array<unknown>).slice(0, MAX_FIELD_SHAPES)
      : []) {
      const entry: Record<string, unknown> =
        shape && typeof shape === "object"
          ? (shape as Record<string, unknown>)
          : {};
      const text: unknown = entry["shape"];
      const share: number | null = readBoundedNumber(entry["share"], 1);

      if (typeof text === "string" && isValueShape(text) && share !== null) {
        shapes.push({ shape: text, share });
      }
    }

    if (shapes.length === 0) {
      continue;
    }

    const neighbours: Array<string> = (
      Array.isArray(raw["neighbours"])
        ? (raw["neighbours"] as Array<unknown>)
        : []
    )
      .filter((name: unknown): name is string => {
        return typeof name === "string" && name.length > 0;
      })
      .slice(0, MAX_FIELD_NEIGHBOURS)
      .map((name: string): string => {
        return name.slice(0, MAX_NEIGHBOUR_LENGTH);
      });

    fields.push({
      location,
      locationKind,
      neighbours,
      shapes,
      valueCount: Math.floor(valueCount),
      averageLength,
    });
  }

  return fields;
}
