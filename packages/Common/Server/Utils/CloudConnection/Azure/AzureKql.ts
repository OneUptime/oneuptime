import BadDataException from "../../../../Types/Exception/BadDataException";

/*
 * KQL, AS ONEUPTIME WRITES IT (#11142): every Kusto Query Language query an
 * Azure connection sends - to Resource Graph (the inventory, its subnets,
 * Data Security's stores, a live read's resource) and to Log Analytics (a
 * live read's log lines) - is written with the `kql` tag:
 *
 *   kql`Resources | where id =~ ${resourceId} | project id, name`
 *
 * A value is placed as a literal of its own, never as query text, so
 * whatever it holds - a quote, a backslash, a line break, a "|", a "//" -
 * it stays one value and the query keeps the shape it was written in:
 *
 *   - A string is a single-quoted string literal (kqlStringLiteral), each
 *     character that would end or break it escaped the way KQL's string
 *     data type says: the quote and the backslash with a backslash; a line
 *     break, a carriage return and a tab as \n, \r and \t, since a literal
 *     cannot span lines; and every other control character, the line and
 *     paragraph separators and half a surrogate pair as \uXXXX. Everything
 *     else stays as it is, a double quote too.
 *   - A whole number of zero or more is its digits: a row limit, a count of
 *     minutes. Anything else - a fraction, a negative, NaN - is a mistake,
 *     and throws.
 *   - A list of strings is their literals, a comma between each, for
 *     `in~ (${types})`. An empty list throws: `in~ ()` is no query.
 *   - A KqlText - a piece written with the tag, or lines joined with
 *     kqlLines - is placed as it is.
 *
 * A KqlText is all AzureArm.queryResourceGraph and the live read's Log
 * Analytics query take, so a query is made only of the text written in its
 * template and of literals made here.
 *
 * The queries are held to Microsoft's grammar by Microsoft's own parser,
 * Kusto.Language (@kusto/language-service-next), in the tests
 * (Tests/Server/Utils/CloudConnection/AzureKqlGrammar.ts): each one parses,
 * binds against Resource Graph's Resources table, and keeps to the
 * operators and limits Resource Graph documents. The subnet query once
 * wrote mv-expand's row limit before what it expands, which Resource Graph
 * refuses (ParserFailure at line 3, character 18), and no subnet was listed.
 */

/*
 * A KqlText is recognised by this mark rather than by instanceof, so a
 * piece made by another copy of this module is recognised too.
 */
const KQL_TEXT_MARK: unique symbol = Symbol.for("oneuptime.AzureKql.KqlText");

/*
 * The one way to make a KqlText: a module-private key the constructor
 * checks, so nothing outside this module turns a string into a query.
 */
const CONSTRUCTION_KEY: unique symbol = Symbol("AzureKql construction key");

export class KqlText {
  private readonly text: string;

  public readonly [KQL_TEXT_MARK] = true as const;

  public constructor(key: typeof CONSTRUCTION_KEY, text: string) {
    if (key !== CONSTRUCTION_KEY) {
      throw new Error("A KqlText is made with the kql tag or kqlLines.");
    }

    this.text = text;
  }

  public toString(): string {
    return this.text;
  }
}

// What may be placed into `kql`: text, whole numbers, lists of text, KQL.
export type KqlValue = KqlText | string | number | ReadonlyArray<string>;

type IsKqlTextFunction = (value: unknown) => value is KqlText;

export const isKqlText: IsKqlTextFunction = (
  value: unknown,
): value is KqlText => {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [KQL_TEXT_MARK]?: unknown })[KQL_TEXT_MARK] === true
  );
};

// The characters a literal holds escaped by name, by their UTF-16 code.
const NAMED_ESCAPES: ReadonlyMap<number, string> = new Map<number, string>([
  // The backslash, which starts every escape.
  [0x5c, "\\\\"],
  // The quote, which would end the literal.
  [0x27, "\\'"],
  // A line break, a carriage return and a tab: a literal cannot span lines.
  [0x0a, "\\n"],
  [0x0d, "\\r"],
  [0x09, "\\t"],
]);

// A character placed as \uXXXX: a control character, or a line or paragraph separator.
function isEscapedByCode(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029
  );
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function unicodeEscape(code: number): string {
  return `\\u${code.toString(16).padStart(4, "0")}`;
}

/*
 * A text as a single-quoted KQL string literal that reads back as exactly
 * the text: see the top of this file for what is escaped.
 */
export function kqlStringLiteral(text: string): string {
  if (typeof text !== "string") {
    throw new BadDataException(
      `A KQL string literal is made of text, not ${typeof text}.`,
    );
  }

  let literal: string = "'";

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    const named: string | undefined = NAMED_ESCAPES.get(code);

    if (named !== undefined) {
      literal += named;
      continue;
    }

    // A whole surrogate pair is one character, kept as it is.
    if (isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(index + 1))) {
      literal += text.slice(index, index + 2);
      index++;
      continue;
    }

    literal +=
      isEscapedByCode(code) || isHighSurrogate(code) || isLowSurrogate(code)
        ? unicodeEscape(code)
        : text.charAt(index);
  }

  return `${literal}'`;
}

// A whole number of zero or more, as its digits.
function kqlWholeNumber(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BadDataException(
      `A KQL query takes a whole number of zero or more here, not ${String(value)}.`,
    );
  }

  return String(value);
}

// The literals of a list of texts, a comma between each: what `in~ (...)` holds.
function kqlStringList(values: ReadonlyArray<unknown>): string {
  if (values.length === 0) {
    throw new BadDataException(
      "A KQL list holds one value or more: `in~ ()` is no query.",
    );
  }

  return values
    .map((value: unknown): string => {
      if (typeof value !== "string") {
        throw new BadDataException(
          `A KQL list is a list of text, not of ${typeof value}.`,
        );
      }

      return kqlStringLiteral(value);
    })
    .join(", ");
}

function renderKqlValue(value: unknown): string {
  if (isKqlText(value)) {
    return value.toString();
  }

  if (typeof value === "string") {
    return kqlStringLiteral(value);
  }

  if (typeof value === "number") {
    return kqlWholeNumber(value);
  }

  if (Array.isArray(value)) {
    return kqlStringList(value as ReadonlyArray<unknown>);
  }

  throw new BadDataException(
    `A KQL query takes text, a whole number, a list of text or KQL, not ${
      value === null ? "null" : typeof value
    }.`,
  );
}

type KqlFunction = (
  literals: TemplateStringsArray,
  ...values: Array<KqlValue>
) => KqlText;

/*
 * A query, or a piece of one: the template's own text as it is written, and
 * each value as a literal. See the top of this file.
 */
export const kql: KqlFunction = (
  literals: TemplateStringsArray,
  ...values: Array<KqlValue>
): KqlText => {
  let text: string = literals[0] || "";

  for (let index: number = 0; index < values.length; index++) {
    text += renderKqlValue(values[index]) + (literals[index + 1] || "");
  }

  return new KqlText(CONSTRUCTION_KEY, text);
};

// The lines of one query, one after another: how the queries here are written.
export function kqlLines(lines: ReadonlyArray<KqlText>): KqlText {
  return new KqlText(
    CONSTRUCTION_KEY,
    lines
      .map((line: KqlText): string => {
        if (!isKqlText(line)) {
          throw new BadDataException(
            "A line of a KQL query is written with the kql tag.",
          );
        }

        return line.toString();
      })
      .join("\n"),
  );
}
