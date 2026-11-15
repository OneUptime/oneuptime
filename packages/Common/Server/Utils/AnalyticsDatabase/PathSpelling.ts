import { SQL, Statement } from "./Statement";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";

/*
 * A path read in one spelling in ClickHouse: the reads' side of
 * UrlScrubber.normalizePathSpelling, for the rows stored before the
 * scrubber and the product analytics ingest wrote that spelling.
 *
 * One page can be written several ways - "/caf%c3%a9" (lower-case hex),
 * "/caf%C3%A9", "/cafe%CC%81" (its accent decomposed), "/café" - and a row
 * holds whichever its recorder sent. A rewrite of those rows is out of
 * reach: product analytics keeps the page in its table's sort key, which
 * ClickHouse never updates, and links and saved views keep it outside the
 * database altogether. So a read compares and groups a stored path in this
 * spelling instead, and names the result in the scrubber's.
 *
 * Every escape is decoded and the text composed (NFC), so "%c3%a9",
 * "%C3%A9" and "e%CC%81" all read "é". An escape of an ASCII character is
 * decoded behind U+FFFF, which no stored path holds unescaped, so it never
 * reads as the character itself: "/a%2Fb" stays apart from "/a/b", while
 * "%2f" reads as "%2F". Bytes that are not UTF-8 read as U+FFFD
 * (normalizeUTF8NFC refuses them), so two such paths can read alike, but
 * never as a page of words. The three characters NFC turns into ASCII
 * (U+037E, U+1FEF, U+212A) read as that character, where the scrubber keeps
 * their escape.
 */

const OPEN: string =
  "normalizeUTF8NFC(toValidUTF8(decodeURLComponent(replaceRegexpAll(";
const CLOSE: string = ", '%([0-7][0-9A-Fa-f])', '%EF%BF%BF%\\\\1'))))";

/* A text that can be spelled more ways than one: an escape, or a character beyond ASCII. */
const SPELLED_TEXT: RegExp = /[%\u0080-￿]/;

export function hasPathSpellings(text: string): boolean {
  return SPELLED_TEXT.test(text);
}

/*
 * `expression` in one spelling. It is a column, a lambda argument or an
 * expression of those this module's callers write, never a request's
 * value: a value goes through pathSpellingOfValue, bound.
 */
export function pathSpellingSql(expression: string): string {
  return `${OPEN}${expression}${CLOSE}`;
}

/* A value a request names, bound, in one spelling. */
export function pathSpellingOfValue(value: string): Statement {
  const statement: Statement = SQL``;
  statement.append(OPEN);
  statement.append(SQL`${{ type: TableColumnType.Text, value: value }}`);
  statement.append(CLOSE);
  return statement;
}

/*
 * Whether a stored path can be spelled more ways than one: it has an
 * escape, or a character beyond ASCII (more bytes than characters). Any
 * other path is its own spelling, so a read leaves it as it is.
 */
export function hasPathSpellingsSql(expression: string): string {
  return `(position(${expression}, '%') > 0 OR length(${expression}) != lengthUTF8(${expression}))`;
}

/*
 * What a read groups a stored path by: its one spelling when it has more
 * than one, else the path itself. Every spelling of a page has the same
 * key, and a page in plain ASCII keeps its own.
 */
export function pathSpellingKeySql(expression: string): string {
  return `if(${hasPathSpellingsSql(expression)}, ${pathSpellingSql(expression)}, ${expression})`;
}

/*
 * "<expression> is the page `value` names", in any of its spellings:
 * `expression = value`, and, when the value can be spelled more ways than
 * one, every stored path with more than one spelling that reads as it. A
 * value in plain ASCII is matched as written, so the read keeps the use of
 * an index on the column.
 */
export function samePathStatement(
  expression: string,
  value: string,
): Statement {
  const statement: Statement = SQL`(`;
  statement.append(expression);
  statement.append(SQL` = ${{ type: TableColumnType.Text, value: value }}`);

  if (hasPathSpellings(value)) {
    statement.append(
      ` OR (${hasPathSpellingsSql(expression)} AND ${pathSpellingSql(expression)} = `,
    );
    statement.append(pathSpellingOfValue(value));
    statement.append(")");
  }

  statement.append(")");
  return statement;
}
