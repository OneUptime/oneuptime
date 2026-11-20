/*
 * ONEUPTIME AI'S ANSWER TO A DATA SECURITY FEATURE, READ STRICTLY (#10365).
 *
 * A feature that asks for a structured answer says its shape here, and the
 * answer is the object asked for, or no answer: readStrictAnswer hands back
 * the value typed as the shape says, or null. Every Data Security feature
 * reads its answer this way, and none parses a model's text itself.
 *
 *   - The answer is one JSON object, with nothing around it but white space
 *     or one code fence (```json ... ```), which models put around JSON on
 *     their own. A sentence before or after it is no answer: a model that
 *     says something besides the object was not answering what it was asked.
 *   - Every field the shape names is there and of its kind; a field the
 *     shape does not name is left out, never read. Text is held to its
 *     length - cut there, or refused where a cut value would mean something
 *     else (an id) - and put on one line where the shape says so; a number
 *     is finite and within its bounds; a choice is one of its values.
 *   - In a list, an item that is not of its shape is left out by default,
 *     and the rest kept: one bad field of forty is not forty bad fields. A
 *     list can refuse the whole answer instead. A list is read only as far
 *     as it may be long: the items after maxItems are never read.
 *
 * The answer is never evaluated, only parsed: JSON.parse, at most
 * MAX_STRICT_ANSWER_CHARACTERS of it.
 */

// The longest answer read at all: anything longer is no answer.
export const MAX_STRICT_ANSWER_CHARACTERS: number = 100_000;

export interface StrictText {
  readonly kind: "text";
  readonly maxLength: number;
  // A longer text is cut to maxLength (the default), or the value is refused.
  readonly whenTooLong: "cut" | "refuse";
  // Every run of white space one space, and none at the ends.
  readonly isOneLine: boolean;
  // When given, the text must be one of these, exactly.
  readonly oneOf?: ReadonlyArray<string> | undefined;
}

export interface StrictNumber {
  readonly kind: "number";
  readonly min: number;
  readonly max: number;
  readonly isWhole: boolean;
}

export interface StrictFlag {
  readonly kind: "flag";
}

export interface StrictList<Item extends StrictShape = StrictShape> {
  readonly kind: "list";
  readonly of: Item;
  readonly maxItems: number;
  // An item not of its shape is left out (the default), or refuses the answer.
  readonly whenItemIsWrong: "skip" | "refuse";
}

export interface StrictObject<
  Fields extends Record<string, StrictShape> = Record<string, StrictShape>,
> {
  readonly kind: "object";
  readonly fields: Fields;
}

export interface StrictNullable<Inner extends StrictShape = StrictShape> {
  readonly kind: "nullable";
  readonly of: Inner;
}

export interface StrictOptional<Inner extends StrictShape = StrictShape> {
  readonly kind: "optional";
  readonly of: Inner;
}

export type StrictShape =
  | StrictText
  | StrictNumber
  | StrictFlag
  | StrictList
  | StrictObject
  | StrictNullable
  | StrictOptional;

// The value an answer of a shape is read as.
export type StrictValue<Shape> = Shape extends StrictText
  ? string
  : Shape extends StrictNumber
    ? number
    : Shape extends StrictFlag
      ? boolean
      : Shape extends StrictList<infer Item>
        ? Array<StrictValue<Item>>
        : Shape extends StrictNullable<infer Inner>
          ? StrictValue<Inner> | null
          : Shape extends StrictOptional<infer Inner>
            ? StrictValue<Inner> | undefined
            : Shape extends StrictObject<infer Fields>
              ? { [Key in keyof Fields]: StrictValue<Fields[Key]> }
              : never;

// What a value read against a shape came to: the value, or that it was not one.
type Reading = { isRead: true; value: unknown } | { isRead: false };

const NOT_READ: Reading = { isRead: false };

function read(value: unknown): Reading {
  return { isRead: true, value };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Every run of white space one space, and none at the ends.
function toOneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/*
 * The text cut to its length, never inside a pair of UTF-16 code units: a
 * character outside the basic plane is one character to a person.
 */
function cutText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  let cut: number = maxLength;
  const code: number = text.charCodeAt(cut - 1);

  if (cut > 0 && code >= 0xd800 && code <= 0xdbff) {
    cut--;
  }

  return text.slice(0, cut);
}

function readText(shape: StrictText, value: unknown): Reading {
  if (typeof value !== "string") {
    return NOT_READ;
  }

  let text: string = shape.isOneLine ? toOneLine(value) : value;

  if (text.length > shape.maxLength) {
    if (shape.whenTooLong === "refuse") {
      return NOT_READ;
    }

    text = cutText(text, shape.maxLength);
  }

  if (shape.oneOf && !shape.oneOf.includes(text)) {
    return NOT_READ;
  }

  return read(text);
}

function readNumber(shape: StrictNumber, value: unknown): Reading {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < shape.min ||
    value > shape.max ||
    (shape.isWhole && !Number.isInteger(value))
  ) {
    return NOT_READ;
  }

  return read(value);
}

function readList(shape: StrictList, value: unknown): Reading {
  if (!Array.isArray(value)) {
    return NOT_READ;
  }

  const items: Array<unknown> = [];

  for (const item of value.slice(0, shape.maxItems)) {
    const reading: Reading = readShape(shape.of, item);

    if (reading.isRead) {
      items.push(reading.value);
    } else if (shape.whenItemIsWrong === "refuse") {
      return NOT_READ;
    }
  }

  return read(items);
}

function readObject(shape: StrictObject, value: unknown): Reading {
  if (!isPlainObject(value)) {
    return NOT_READ;
  }

  const object: Record<string, unknown> = {};

  for (const [name, fieldShape] of Object.entries(shape.fields)) {
    const has: boolean = Object.prototype.hasOwnProperty.call(value, name);

    if (!has || value[name] === undefined) {
      if (fieldShape.kind === "optional") {
        continue;
      }

      return NOT_READ;
    }

    const reading: Reading = readShape(fieldShape, value[name]);

    if (!reading.isRead) {
      return NOT_READ;
    }

    if (reading.value !== undefined) {
      object[name] = reading.value;
    }
  }

  return read(object);
}

function readShape(shape: StrictShape, value: unknown): Reading {
  switch (shape.kind) {
    case "text":
      return readText(shape, value);
    case "number":
      return readNumber(shape, value);
    case "flag":
      return typeof value === "boolean" ? read(value) : NOT_READ;
    case "list":
      return readList(shape, value);
    case "object":
      return readObject(shape, value);
    case "nullable":
      return value === null ? read(null) : readShape(shape.of, value);
    case "optional":
      return value === undefined ? read(undefined) : readShape(shape.of, value);
  }
}

const FENCE_START: RegExp = /^```[A-Za-z]*[ \t]*\r?\n/;
const FENCE_END: RegExp = /\r?\n?```$/;

/*
 * The JSON an answer is: the whole of it, or the whole of the one code fence
 * it is - nothing outside the fence but white space. Undefined otherwise.
 */
export function getAnswerJsonText(content: string): string | undefined {
  const text: string = content.trim();

  if (text.startsWith("{")) {
    return text;
  }

  if (!FENCE_START.test(text) || !FENCE_END.test(text)) {
    return undefined;
  }

  const inside: string = text
    .replace(FENCE_START, "")
    .replace(FENCE_END, "")
    .trim();

  // One fence: a second one inside would be words around the object.
  return inside.startsWith("{") && !inside.includes("```") ? inside : undefined;
}

/*
 * The answer as the shape asks for it, or null: not one JSON object, too
 * long, or not of the shape.
 */
export function readStrictAnswer<Fields extends Record<string, StrictShape>>(
  content: string | null | undefined,
  shape: StrictObject<Fields>,
): StrictValue<StrictObject<Fields>> | null {
  if (
    typeof content !== "string" ||
    content.length > MAX_STRICT_ANSWER_CHARACTERS
  ) {
    return null;
  }

  const json: string | undefined = getAnswerJsonText(content);

  if (json === undefined) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const reading: Reading = readShape(shape, parsed);

  return reading.isRead
    ? (reading.value as StrictValue<StrictObject<Fields>>)
    : null;
}

// The shapes, as a feature writes its answer's: StrictAnswer.object({ ... }).
export const StrictAnswer: {
  text: (options: {
    maxLength: number;
    whenTooLong?: "cut" | "refuse" | undefined;
    isOneLine?: boolean | undefined;
    oneOf?: ReadonlyArray<string> | undefined;
  }) => StrictText;
  number: (options: {
    min: number;
    max: number;
    isWhole?: boolean | undefined;
  }) => StrictNumber;
  flag: () => StrictFlag;
  list: <Item extends StrictShape>(
    of: Item,
    options: {
      maxItems: number;
      whenItemIsWrong?: "skip" | "refuse" | undefined;
    },
  ) => StrictList<Item>;
  object: <Fields extends Record<string, StrictShape>>(
    fields: Fields,
  ) => StrictObject<Fields>;
  nullable: <Inner extends StrictShape>(of: Inner) => StrictNullable<Inner>;
  optional: <Inner extends StrictShape>(of: Inner) => StrictOptional<Inner>;
} = {
  text: (options: {
    maxLength: number;
    whenTooLong?: "cut" | "refuse" | undefined;
    isOneLine?: boolean | undefined;
    oneOf?: ReadonlyArray<string> | undefined;
  }): StrictText => {
    return {
      kind: "text",
      maxLength: options.maxLength,
      whenTooLong: options.whenTooLong || "cut",
      isOneLine: options.isOneLine === true,
      ...(options.oneOf ? { oneOf: options.oneOf } : {}),
    };
  },
  number: (options: {
    min: number;
    max: number;
    isWhole?: boolean | undefined;
  }): StrictNumber => {
    return {
      kind: "number",
      min: options.min,
      max: options.max,
      isWhole: options.isWhole === true,
    };
  },
  flag: (): StrictFlag => {
    return { kind: "flag" };
  },
  list: <Item extends StrictShape>(
    of: Item,
    options: {
      maxItems: number;
      whenItemIsWrong?: "skip" | "refuse" | undefined;
    },
  ): StrictList<Item> => {
    return {
      kind: "list",
      of,
      maxItems: options.maxItems,
      whenItemIsWrong: options.whenItemIsWrong || "skip",
    };
  },
  object: <Fields extends Record<string, StrictShape>>(
    fields: Fields,
  ): StrictObject<Fields> => {
    return { kind: "object", fields };
  },
  nullable: <Inner extends StrictShape>(of: Inner): StrictNullable<Inner> => {
    return { kind: "nullable", of };
  },
  optional: <Inner extends StrictShape>(of: Inner): StrictOptional<Inner> => {
    return { kind: "optional", of };
  },
};
