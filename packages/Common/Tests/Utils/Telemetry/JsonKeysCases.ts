import {
  JSON_STYLES,
  JsonStyle,
  JsonToken,
  pick,
  Random,
  readJsonTokens,
  writeJson,
} from "./JsonTextCases";

/*
 * JSON TEXTS HELD IN STRINGS, FOR A SENSITIVE ATTRIBUTE KEYS RULE (#8993):
 * A SEEDED GENERATOR, AND A READER THAT KNOWS WHAT THE RULE MUST HIDE.
 *
 * For the property tests of Utils/Telemetry/ScrubJsonKeys.ts here and of
 * the scrub rules over real records in App/Tests/Telemetry: random lists
 * and maps whose strings hold JSON texts of their own, up to a chosen depth,
 * each written its own way (compact, indented, or escaped as other
 * producers write it, keys included: `password`). Secret keys sit at
 * every level - in a map, in an OTLP {key, value} pair whose value is the
 * secret - beside keys that name none, values that only mention a secret
 * word ("password reset"), strings that only look like JSON (`{token}`),
 * and numbers JSON.parse cannot keep (12345678901234567890, 1.50, -0.0,
 * 1E400), which a rule must leave as they are written.
 *
 * Every text is marked: a text under a secret key holds a secret mark, and
 * any other a plain one, so a test can say what must be gone and what must
 * still be there without asking the rule.
 *
 * The reader (expectedReading, readingOf) is written apart from the rule on
 * purpose - JSON.parse and a walk of what it returns, not the rule's reading
 * of the text in place - so a test that compares what both read is not the
 * rule agreeing with itself.
 */

// The rule's key pattern, as both engines declare it.
export const SENSITIVE_KEY_PATTERN: RegExp =
  /(password|passwd|pwd|secret|token|api[._-]?key|access[._-]?key|private[._-]?key|client[._-]?secret|authorization|auth[._-]?header|cookie|session[._-]?id|credit[._-]?card|card[._-]?number|ssn|csrf|xsrf)/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

// Keys a rule finds secret, written as applications write them.
export const SECRET_KEYS: ReadonlyArray<string> = [
  "password",
  "db.password",
  "api_key",
  "apiKey",
  "Authorization",
  "x-auth-token",
  "client_secret",
  "set-cookie",
  "session_id",
  "card_number",
  "ssn",
  "csrf_token",
  "privateKey",
  "accessKey",
];

/*
 * Keys that name no secret. Not `key` and `value`: a map with both is read
 * as an OTLP pair, which the generator writes as one of its own.
 */
export const PLAIN_KEYS: ReadonlyArray<string> = [
  "user",
  "message",
  "level",
  "log",
  "payload",
  "body",
  "data",
  "items",
  "count",
  "id",
  "tags",
  "event",
  "stream",
  "content",
  "role",
  "__proto__",
  "",
];

/*
 * Texts that name a secret but are no key, or only look like JSON: a rule
 * reads no free text, so each is kept as it is.
 */
export const LOOKS_SECRET: ReadonlyArray<string> = [
  "password reset requested",
  "{token}",
  "[password] rotated",
  '{"password": "cut short',
  "[1, 2,",
  "token=abc",
  " {not json}",
  "{}",
  "[]",
];

/*
 * Numbers JSON.parse cannot keep as written, put in place of these
 * placeholders once a text is written: a rule must leave each as it is.
 */
const RAW_NUMBERS: ReadonlyArray<[string, string]> = [
  ['"~_~"', "12345678901234567890"],
  ['"~__~"', "1.50"],
  ['"~___~"', "-0.0"],
  ['"~____~"', "1E400"],
];

export interface KeysCaseOptions {
  // How many more JSON texts deep a string may hold another.
  jsonInsideStrings: number;
  // The next mark's number: each text gets a mark of its own.
  marks: { next: number };
}

export function secretMark(number: number): string {
  return `Qx${number}xQ`;
}

export function plainMark(number: number): string {
  return `Vw${number}wV`;
}

// A text with its mark: secret under a secret key, plain elsewhere.
function markedText(
  random: Random,
  options: KeysCaseOptions,
  underSecret: boolean,
): string {
  const number: number = options.marks.next++;
  const mark: string = underSecret ? secretMark(number) : plainMark(number);
  const roll: number = random();

  if (roll < 0.15) {
    return mark;
  }

  if (roll < 0.3) {
    return `${pick(random, LOOKS_SECRET)} ${mark}`;
  }

  if (roll < 0.45) {
    return `line one\n${mark}\t"quoted" \\ é 中 😀`;
  }

  return `${mark} ${pick(random, ["ok", "retry", "café", "日本語", "a"])}`;
}

function randomKey(random: Random): string {
  return random() < 0.3 ? pick(random, SECRET_KEYS) : pick(random, PLAIN_KEYS);
}

/*
 * A JSON text of a random list or map, written in a random style, its
 * placeholders replaced by numbers written as JSON.parse cannot keep them.
 */
export function randomJsonText(
  random: Random,
  options: KeysCaseOptions,
  underSecret: boolean,
  style?: JsonStyle | undefined,
): string {
  const value: unknown = randomKeysListOrMap(random, options, underSecret);
  let text: string = writeJson(
    value,
    style || pick(random, JSON_STYLES),
    random,
  );

  for (const [placeholder, number] of RAW_NUMBERS) {
    text = text.split(placeholder).join(number);
  }

  return text;
}

export function randomKeysValue(
  random: Random,
  depth: number,
  options: KeysCaseOptions,
  underSecret: boolean,
): unknown {
  const roll: number = random();

  if (depth > 0 && roll < 0.3) {
    const map: Record<string, unknown> = {};
    const size: number = Math.floor(random() * 4);

    for (let index: number = 0; index < size; index++) {
      const key: string = randomKey(random);

      Object.defineProperty(map, key, {
        value: randomKeysValue(
          random,
          depth - 1,
          options,
          underSecret || isSensitiveKey(key),
        ),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    return map;
  }

  if (depth > 0 && roll < 0.4) {
    // An OTLP {key, value} pair: a key that names a secret names its value.
    const key: string = randomKey(random);

    return {
      key: key,
      value: {
        stringValue: markedText(
          random,
          options,
          underSecret || isSensitiveKey(key),
        ),
      },
    };
  }

  if (depth > 0 && roll < 0.55) {
    const size: number = Math.floor(random() * 4);
    const list: Array<unknown> = [];

    for (let index: number = 0; index < size; index++) {
      list.push(randomKeysValue(random, depth - 1, options, underSecret));
    }

    return list;
  }

  if (roll < 0.7 && options.jsonInsideStrings > 0) {
    // A JSON text held in a string: a Fluentd record's `log`, a request's body.
    return randomJsonText(
      random,
      {
        jsonInsideStrings: options.jsonInsideStrings - 1,
        marks: options.marks,
      },
      underSecret,
    );
  }

  if (roll < 0.75) {
    return pick(random, ["~_~", "~__~", "~___~", "~____~"]);
  }

  if (roll < 0.8) {
    return pick(random, [0, -1.5, 3e21, 42, true, false, null]);
  }

  return markedText(random, options, underSecret);
}

// A list or a map at the top, as a JSON text held in a string is.
export function randomKeysListOrMap(
  random: Random,
  options: KeysCaseOptions,
  underSecret: boolean,
): unknown {
  for (;;) {
    const value: unknown = randomKeysValue(random, 3, options, underSecret);

    if (value !== null && typeof value === "object") {
      return value;
    }
  }
}

/*
 * ---------------------------------------------------------------------------
 * THE READER: what a JSON text holds, JSON texts in its strings read too.
 * ---------------------------------------------------------------------------
 */

// How many JSON texts deep, each a string of the one around, a rule reads.
export const JSON_TEXTS_READ: number = 4;

// A string that held the JSON text of a list or a map, read.
export class JsonInString {
  public readonly reading: unknown;

  public constructor(reading: unknown) {
    this.reading = reading;
  }
}

function asListOrMap(text: string): unknown {
  const start: string = text.trimStart().charAt(0);

  if (start !== "{" && start !== "[") {
    return null;
  }

  try {
    const value: unknown = JSON.parse(text);

    return value !== null && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/*
 * What a JSON text holds, its strings that are JSON texts read too, down
 * to JSON_TEXTS_READ: the form both sides of a comparison are put in.
 */
export function readingOf(jsonText: string, jsonDepth: number = 0): unknown {
  return readValue(JSON.parse(jsonText), jsonDepth);
}

function readValue(value: unknown, jsonDepth: number): unknown {
  if (typeof value === "string") {
    const inside: unknown =
      jsonDepth < JSON_TEXTS_READ ? asListOrMap(value) : null;

    return inside === null
      ? value
      : new JsonInString(readValue(inside, jsonDepth + 1));
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown): unknown => {
      return readValue(item, jsonDepth);
    });
  }

  if (value !== null && typeof value === "object") {
    const read: Record<string, unknown> = {};

    for (const key of Object.keys(value)) {
      Object.defineProperty(read, key, {
        value: readValue((value as Record<string, unknown>)[key], jsonDepth),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    return read;
  }

  return value;
}

/*
 * What a Sensitive Attribute Keys rule must leave of a JSON text, as
 * readingOf reads it: every text under a key that names a secret - a map's
 * key, or the key of an OTLP pair for its value - replaced by `hide` of
 * it, numbers, true, false and null kept; a JSON text held in a string read
 * the same way down to JSON_TEXTS_READ, and one past that hidden whole when
 * its text names a secret, its escapes read. Within the bounds of the
 * record: small values.
 */
export function expectedReading(
  jsonText: string,
  hide: (text: string) => string,
): unknown {
  return expectedValue(JSON.parse(jsonText), false, 0, hide);
}

function expectedValue(
  value: unknown,
  underSecret: boolean,
  jsonDepth: number,
  hide: (text: string) => string,
): unknown {
  if (typeof value === "string") {
    if (underSecret) {
      return hide(value);
    }

    const inside: unknown = asListOrMap(value);

    if (inside === null) {
      return value;
    }

    if (jsonDepth >= JSON_TEXTS_READ) {
      // Read as its JSON text: a word written with escapes read too.
      return isSensitiveKey(value) ||
        isSensitiveKey(JSON.stringify(JSON.parse(value)))
        ? hide(value)
        : value;
    }

    return new JsonInString(expectedValue(inside, false, jsonDepth + 1, hide));
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown): unknown => {
      return expectedValue(item, underSecret, jsonDepth, hide);
    });
  }

  if (value !== null && typeof value === "object") {
    const map: Record<string, unknown> = value as Record<string, unknown>;
    const isSensitivePair: boolean =
      !underSecret &&
      typeof map["key"] === "string" &&
      Object.prototype.hasOwnProperty.call(map, "value") &&
      isSensitiveKey(map["key"] as string);
    const expected: Record<string, unknown> = {};

    for (const key of Object.keys(map)) {
      Object.defineProperty(expected, key, {
        value: expectedValue(
          map[key],
          underSecret ||
            (isSensitivePair && key === "value") ||
            isSensitiveKey(key),
          jsonDepth,
          hide,
        ),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    return expected;
  }

  return value;
}

/*
 * Every text a JSON text holds, at every depth of JSON texts in strings,
 * its keys included: where a mark is looked for.
 */
export function everyText(jsonText: string): Array<string> {
  const texts: Array<string> = [];
  const visit: (value: unknown) => void = (value: unknown): void => {
    if (typeof value === "string") {
      texts.push(value);

      const inside: unknown = asListOrMap(value);

      if (inside !== null) {
        visit(inside);
      }

      return;
    }

    if (value !== null && typeof value === "object") {
      for (const key of Object.keys(value)) {
        texts.push(key);
        visit((value as Record<string, unknown>)[key]);
      }
    }
  };

  visit(JSON.parse(jsonText));

  return texts;
}

// The marks of one kind a JSON text holds, at every depth.
export function marksIn(jsonText: string, secret: boolean): Set<string> {
  const marks: Set<string> = new Set<string>();
  const pattern: RegExp = secret ? /Qx\d+xQ/g : /Vw\d+wV/g;

  for (const text of everyText(jsonText)) {
    for (const match of text.match(pattern) || []) {
      marks.add(match);
    }
  }

  return marks;
}

/*
 * Whether a rule kept a JSON text's shape: the same tokens - punctuation,
 * spaces, numbers, true, false and null exactly as written - and each
 * string either the very string it was, a string still, or, when it held a
 * JSON text, a JSON text of the same shape. Null when it did; else what
 * differs.
 */
export function shapeDifference(
  before: string,
  after: string,
  jsonDepth: number = 0,
): string | null {
  const was: Array<JsonToken> = readJsonTokens(before);
  const is: Array<JsonToken> = readJsonTokens(after);

  if (was.length !== is.length) {
    return `${was.length} tokens became ${is.length}: ${before} -> ${after}`;
  }

  for (let index: number = 0; index < was.length; index++) {
    const old: JsonToken = was[index]!;
    const now: JsonToken = is[index]!;

    if (old.kind !== "string" || old.text === now.text) {
      if (old.text !== now.text) {
        return `token ${index} ${old.text} became ${now.text}`;
      }

      continue;
    }

    if (now.kind !== "string") {
      return `string ${old.text} became ${now.text}`;
    }

    const oldText: string = JSON.parse(old.text) as string;
    const newText: string = JSON.parse(now.text) as string;

    if (
      jsonDepth < JSON_TEXTS_READ &&
      asListOrMap(oldText) !== null &&
      asListOrMap(newText) !== null
    ) {
      const inside: string | null = shapeDifference(
        oldText,
        newText,
        jsonDepth + 1,
      );

      if (inside !== null) {
        return inside;
      }
    }
  }

  return null;
}
