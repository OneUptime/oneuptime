/*
 * ---------------------------------------------------------------------------
 * THE SCIM FILTERS ONEUPTIME ANSWERS.
 *
 * An identity provider looks a resource up before it creates or changes it:
 * Okta with `userName eq "..."`, Microsoft Entra ID with an equality on each
 * of its matching attributes - `userName`, `externalId`, a group's
 * `displayName` - joined by `and` (RFC 7644, section 3.4.2.2). That is the
 * whole of what this reads: equalities, joined by `and`, on an attribute or a
 * value path such as `members[value eq "<id>"]`. Anything else - another
 * operator, `or`, `not`, a group of filters - is refused with RFC 7644's
 * `invalidFilter`, rather than answered as if no filter had been sent, which
 * is what a filter OneUptime did not read used to be: every user listed, and
 * the identity provider matching the wrong one.
 *
 * It is read with a loop, not a regular expression: a filter is the caller's
 * text, and MAX_SCIM_FILTER_LENGTH bounds it besides.
 * ---------------------------------------------------------------------------
 */

// Longer than any filter an identity provider sends.
export const MAX_SCIM_FILTER_LENGTH: number = 4096;

export type ScimFilterValue = string | number | boolean | null;

export interface ScimEqualityFilter {
  /*
   * The attribute, as written, with a value path's sub-attribute joined by a
   * dot: `userName`, `externalId`, `members.value` for
   * `members[value eq "..."]`. A schema URN in front of it is dropped
   * (`urn:ietf:params:scim:schemas:core:2.0:User:userName` is `userName`).
   */
  attribute: string;
  value: ScimFilterValue;
}

// One character of an attribute path, or of a keyword.
const ATTRIBUTE_CHARACTER: RegExp = /^[A-Za-z0-9_$.:-]$/;

// The four hex digits of a \u escape.
const UNICODE_ESCAPE: RegExp = /^[0-9A-Fa-f]{4}$/;

export class ScimFilterError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ScimFilterError";
  }
}

const SCHEMA_URN_PREFIXES: ReadonlyArray<string> = [
  "urn:ietf:params:scim:schemas:core:2.0:user:",
  "urn:ietf:params:scim:schemas:core:2.0:group:",
];

const isAttributeCharacter: (character: string) => boolean = (
  character: string,
): boolean => {
  return ATTRIBUTE_CHARACTER.test(character);
};

const isWhitespace: (character: string) => boolean = (
  character: string,
): boolean => {
  return character === " " || character === "\t";
};

class Reader {
  private readonly text: string;
  private position: number = 0;

  public constructor(text: string) {
    this.text = text;
  }

  public isAtEnd(): boolean {
    this.skipWhitespace();
    return this.position >= this.text.length;
  }

  public skipWhitespace(): void {
    while (
      this.position < this.text.length &&
      isWhitespace(this.text.charAt(this.position))
    ) {
      this.position++;
    }
  }

  public peek(): string {
    return this.text.charAt(this.position);
  }

  public expect(character: string): void {
    this.skipWhitespace();

    if (this.text.charAt(this.position) !== character) {
      throw new ScimFilterError(
        `Expected "${character}" at character ${this.position + 1} of the filter.`,
      );
    }

    this.position++;
  }

  // An attribute path, or a keyword: a run of attribute characters.
  public readWord(): string {
    this.skipWhitespace();

    const start: number = this.position;

    while (
      this.position < this.text.length &&
      isAttributeCharacter(this.text.charAt(this.position))
    ) {
      this.position++;
    }

    return this.text.substring(start, this.position);
  }

  // A comparison value: a JSON string, true, false, null or a number.
  public readValue(): ScimFilterValue {
    this.skipWhitespace();

    if (this.peek() === '"') {
      return this.readString();
    }

    const word: string = this.readWord();
    const lowerCaseWord: string = word.toLowerCase();

    if (lowerCaseWord === "true") {
      return true;
    }

    if (lowerCaseWord === "false") {
      return false;
    }

    if (lowerCaseWord === "null") {
      return null;
    }

    if (word !== "" && !isNaN(Number(word))) {
      return Number(word);
    }

    throw new ScimFilterError(
      "A filter compares with a quoted string, true, false, null or a number.",
    );
  }

  private readString(): string {
    // The opening quote.
    this.position++;

    let value: string = "";

    while (this.position < this.text.length) {
      const character: string = this.text.charAt(this.position);

      if (character === '"') {
        this.position++;
        return value;
      }

      if (character === "\\") {
        const escaped: string = this.text.charAt(this.position + 1);

        if (escaped === "u") {
          const hex: string = this.text.substring(
            this.position + 2,
            this.position + 6,
          );

          if (!UNICODE_ESCAPE.test(hex)) {
            throw new ScimFilterError("A filter string has a bad \\u escape.");
          }

          value += String.fromCharCode(parseInt(hex, 16));
          this.position += 6;
          continue;
        }

        const escapes: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };

        const unescaped: string | undefined = escapes[escaped];

        if (unescaped === undefined) {
          throw new ScimFilterError("A filter string has a bad escape.");
        }

        value += unescaped;
        this.position += 2;
        continue;
      }

      value += character;
      this.position++;
    }

    throw new ScimFilterError("A filter string is not closed.");
  }
}

const withoutSchemaUrn: (attribute: string) => string = (
  attribute: string,
): string => {
  const lowerCaseAttribute: string = attribute.toLowerCase();

  for (const prefix of SCHEMA_URN_PREFIXES) {
    if (lowerCaseAttribute.startsWith(prefix)) {
      return attribute.substring(prefix.length);
    }
  }

  return attribute;
};

const expectKeyword: (reader: Reader, keyword: string) => void = (
  reader: Reader,
  keyword: string,
): void => {
  const word: string = reader.readWord();

  /*
   * The refusal never repeats the filter's text: it reaches the SCIM log,
   * and a filter carries people's addresses.
   */
  if (word.toLowerCase() !== keyword) {
    throw new ScimFilterError(
      word
        ? 'OneUptime answers filters of equalities (eq) joined by "and"; other operators, "or", "not" and groups are not supported.'
        : `Expected "${keyword}" in the filter.`,
    );
  }
};

// attrPath eq value, or attrPath[subAttr eq value].
const readEquality: (reader: Reader) => ScimEqualityFilter = (
  reader: Reader,
): ScimEqualityFilter => {
  const attribute: string = reader.readWord();

  if (!attribute) {
    throw new ScimFilterError(
      'A filter starts with an attribute, as in userName eq "someone@example.com".',
    );
  }

  reader.skipWhitespace();

  if (reader.peek() === "[") {
    reader.expect("[");

    const subAttribute: string = reader.readWord();

    if (!subAttribute) {
      throw new ScimFilterError("A value path names a sub-attribute.");
    }

    expectKeyword(reader, "eq");

    const value: ScimFilterValue = reader.readValue();

    reader.expect("]");

    return {
      attribute: `${withoutSchemaUrn(attribute)}.${subAttribute}`,
      value: value,
    };
  }

  expectKeyword(reader, "eq");

  return {
    attribute: withoutSchemaUrn(attribute),
    value: reader.readValue(),
  };
};

/*
 * The equalities `filter` asks for, all of which a resource must meet.
 * Throws ScimFilterError for anything else.
 */
export const parseScimFilter: (filter: string) => Array<ScimEqualityFilter> = (
  filter: string,
): Array<ScimEqualityFilter> => {
  if (filter.length > MAX_SCIM_FILTER_LENGTH) {
    throw new ScimFilterError(
      `A filter may be at most ${MAX_SCIM_FILTER_LENGTH} characters long.`,
    );
  }

  const reader: Reader = new Reader(filter);

  if (reader.isAtEnd()) {
    throw new ScimFilterError("The filter is empty.");
  }

  const equalities: Array<ScimEqualityFilter> = [readEquality(reader)];

  while (!reader.isAtEnd()) {
    expectKeyword(reader, "and");
    equalities.push(readEquality(reader));
  }

  return equalities;
};

/*
 * Whether `attribute`, as a filter names it, is `name` (one of OneUptime's
 * attribute names, such as "userName" or "members.value"). Attribute names
 * are case-insensitive (RFC 7643, section 2.1).
 */
export const isScimAttribute: (attribute: string, name: string) => boolean = (
  attribute: string,
  name: string,
): boolean => {
  return attribute.toLowerCase() === name.toLowerCase();
};

// The text a filter compares with, or null when it compares with no text.
export const getScimFilterText: (value: ScimFilterValue) => string | null = (
  value: ScimFilterValue,
): string | null => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
};
