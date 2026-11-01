import { replaceHtmlMarkup } from "../../../../Types/HtmlMarkup";
import FieldCollector from "../../../../Utils/DataSecurity/FieldCollector";
import { MAX_FIELD_VALUE_LENGTH } from "../../../../Utils/DataSecurity/FieldClassifier";

/*
 * TEXT, READ AS THE RECORDS AND FIELDS IT HOLDS.
 *
 * A scan classifies structured data field by field, so the text of an
 * object is first read into fields: CSV and TSV by column, JSON and JSON
 * lines by the path to each value, .env / .ini / .properties / TOML by
 * key, YAML by its keys' nesting. Markup is read as the text a person
 * would see, attribute values included for XML.
 *
 * Everything here reads text of any length in time that grows with its
 * length alone, and with no regular expression over more than a short,
 * bounded piece of it (AGENTS.md, "Megabyte-long values"): loops and
 * indexOf find lines, cells, tags and strings. A scan reads the first
 * bytes of an object, so every reader also accepts text cut off anywhere:
 * the record that was cut is dropped and the rest is kept.
 */

// The most records whose values are collected; the rest are only counted.
export const MAX_RECORDS_COLLECTED: number = 1_000;

// The most columns of a delimited file read.
const MAX_COLUMNS: number = 500;

// The most characters of one key, header or path segment kept.
const MAX_KEY_LENGTH: number = 256;

// The most characters of text no format claims, kept to scan as text.
const MAX_LEFTOVER_TEXT_LENGTH: number = 1024 * 1024;

const LINE_FEED: number = 10;
const CARRIAGE_RETURN: number = 13;
const DOUBLE_QUOTE: number = 34;
const BACKSLASH: number = 92;

// A cell that reads as a column's name: short, starting with a letter.
const HEADER_CELL: RegExp = /^[\p{L}_][\p{L}\p{N} _.()#/&+:-]{0,127}$/u;

// A key of a key-value line: no spaces, nothing a sentence would have.
const KEY_VALUE_KEY: RegExp = /^[A-Za-z0-9_.\-[\]$@/]{1,256}$/;

// A YAML mapping key, quoted or not.
const YAML_KEY: RegExp =
  /^(?:"[^"]{1,256}"|'[^']{1,256}'|[^\s:#'"][^:#]{0,255})$/;

// The brackets of an ini or TOML section header: [section], [[table]].
const SECTION_BRACKETS: RegExp = /^\[{1,2}|\]{1,2}$/g;

export interface StructuredRead {
  collector: FieldCollector;
  // How many records the text holds, counted past the ones collected.
  records: number;
  // Lines no structure claimed, to be scanned as text.
  leftoverText: string;
  // Whether the text read as this format at all.
  isStructured: boolean;
}

function newCollector(): FieldCollector {
  return new FieldCollector({ maxValueLength: MAX_FIELD_VALUE_LENGTH });
}

function emptyRead(): StructuredRead {
  return {
    collector: newCollector(),
    records: 0,
    leftoverText: "",
    isStructured: false,
  };
}

/*
 * Calls `visit` with every line of the text, without its line ending, and
 * its number from 0, until it returns false.
 */
export function forEachLine(
  text: string,
  visit: (line: string, index: number) => boolean | void,
): void {
  let start: number = 0;
  let index: number = 0;

  while (start <= text.length) {
    let end: number = text.indexOf("\n", start);

    if (end < 0) {
      end = text.length;
    }

    const lineEnd: number =
      end > start && text.charCodeAt(end - 1) === CARRIAGE_RETURN
        ? end - 1
        : end;

    if (start === text.length && end === text.length) {
      break;
    }

    if (visit(text.slice(start, lineEnd), index) === false) {
      return;
    }

    index++;
    start = end + 1;
  }
}

// The text without its last line, when that line may have been cut short.
export function withoutCutLastLine(text: string, isTruncated: boolean): string {
  if (!isTruncated) {
    return text;
  }

  const lastLineFeed: number = text.lastIndexOf("\n");

  return lastLineFeed < 0 ? "" : text.slice(0, lastLineFeed);
}

function boundedKey(value: string): string {
  return value.trim().slice(0, MAX_KEY_LENGTH);
}

function appendLeftover(leftover: Array<string>, line: string): number {
  leftover.push(line);
  return line.length + 1;
}

/*
 * DELIMITED TEXT: CSV, TSV.
 *
 * A cell may be quoted, hold the delimiter, quotes ("" inside quotes) and
 * line breaks. Rows past MAX_RECORDS_COLLECTED are parsed only to be
 * counted, and only the first MAX_FIELD_VALUE_LENGTH characters of a cell
 * are kept.
 */
export interface DelimitedRows {
  rows: Array<Array<string>>;
  totalRows: number;
  // The text ended inside a quoted cell: its last row was cut.
  endedInsideQuotes: boolean;
}

export function parseDelimitedRows(
  text: string,
  delimiter: string,
  maxRows: number,
): DelimitedRows {
  const delimiterCode: number = delimiter.charCodeAt(0);
  const rows: Array<Array<string>> = [];
  let totalRows: number = 0;
  let row: Array<string> = [];
  let cellsInRow: number = 0;
  let cellStart: number = 0;
  let isQuoted: boolean = false;
  let afterQuote: boolean = false;
  let pieces: Array<string> = [];
  let piecesLength: number = 0;
  let pieceStart: number = 0;
  let rowHasContent: boolean = false;

  // Whether the cell being read is kept, or only counted.
  const keep: () => boolean = (): boolean => {
    return rows.length < maxRows && cellsInRow < MAX_COLUMNS;
  };

  const addPiece: (piece: string) => void = (piece: string): void => {
    if (piecesLength < MAX_FIELD_VALUE_LENGTH) {
      pieces.push(piece);
      piecesLength += piece.length;
    }
  };

  const endCell: (end: number) => void = (end: number): void => {
    const wasQuoted: boolean = pieces.length > 0 || afterQuote;
    const unquotedEnd: number =
      end > cellStart && text.charCodeAt(end - 1) === CARRIAGE_RETURN
        ? end - 1
        : end;

    if (wasQuoted || unquotedEnd > cellStart) {
      rowHasContent = true;
    }

    if (keep()) {
      const value: string = wasQuoted
        ? pieces.join("")
        : text.slice(
            cellStart,
            Math.min(unquotedEnd, cellStart + MAX_FIELD_VALUE_LENGTH),
          );

      row.push(value.slice(0, MAX_FIELD_VALUE_LENGTH));
    }

    cellsInRow++;
    pieces = [];
    piecesLength = 0;
    afterQuote = false;
  };

  const endRow: () => void = (): void => {
    if (rowHasContent || cellsInRow > 1) {
      totalRows++;

      if (rows.length < maxRows) {
        rows.push(row);
      }
    }

    row = [];
    cellsInRow = 0;
    rowHasContent = false;
  };

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (isQuoted) {
      if (code !== DOUBLE_QUOTE) {
        continue;
      }

      if (text.charCodeAt(index + 1) === DOUBLE_QUOTE) {
        // An escaped quote: keep one.
        if (keep()) {
          addPiece(text.slice(pieceStart, index + 1));
        }

        index++;
        pieceStart = index + 1;
        continue;
      }

      if (keep()) {
        addPiece(text.slice(pieceStart, index));
      }

      isQuoted = false;
      afterQuote = true;
      continue;
    }

    if (code === delimiterCode) {
      endCell(index);
      cellStart = index + 1;
      continue;
    }

    if (code === LINE_FEED) {
      endCell(index);
      endRow();
      cellStart = index + 1;
      continue;
    }

    if (code === DOUBLE_QUOTE && index === cellStart && !afterQuote) {
      isQuoted = true;
      pieceStart = index + 1;
      rowHasContent = true;
      continue;
    }
  }

  const endedInsideQuotes: boolean = isQuoted;

  // The last row, when the text does not end with a line break.
  if (!endedInsideQuotes && (cellStart < text.length || cellsInRow > 0)) {
    endCell(text.length);
    endRow();
  }

  return { rows, totalRows, endedInsideQuotes };
}

/*
 * Whether a row reads as column names: short names that start with a
 * letter, no two alike (an index column's empty name aside), none of them
 * a value the scan would report.
 */
export function looksLikeHeaderRow(
  cells: Array<string>,
  isSensitive: (text: string) => boolean,
): boolean {
  const seen: Set<string> = new Set();
  let named: number = 0;

  for (let index: number = 0; index < cells.length; index++) {
    const cell: string = (cells[index] || "").trim();

    if (cell.length === 0) {
      if (index === 0) {
        continue;
      }

      return false;
    }

    const lower: string = cell.toLowerCase();

    if (!HEADER_CELL.test(cell) || seen.has(lower)) {
      return false;
    }

    seen.add(lower);
    named++;
  }

  return named > 0 && !isSensitive(cells.join(" "));
}

export function readDelimited(data: {
  text: string;
  delimiter: string;
  isTruncated: boolean;
  isSensitive: (text: string) => boolean;
}): StructuredRead {
  const parsed: DelimitedRows = parseDelimitedRows(
    data.text,
    data.delimiter,
    MAX_RECORDS_COLLECTED + 1,
  );
  const rows: Array<Array<string>> = parsed.rows;
  let totalRows: number = parsed.totalRows;

  /*
   * A cut object's last row is cut too, and is not read. One cut inside a
   * quoted cell was never ended, so it is not among the rows at all.
   */
  if (data.isTruncated && !parsed.endedInsideQuotes && totalRows > 1) {
    if (rows.length === totalRows) {
      rows.pop();
    }

    totalRows--;
  }

  if (rows.length === 0) {
    return emptyRead();
  }

  const first: Array<string> = rows[0]!;
  const hasHeader: boolean =
    rows.length > 1 && looksLikeHeaderRow(first, data.isSensitive);
  const names: Array<string> = [];
  const width: number = rows.reduce((widest: number, row: Array<string>) => {
    return Math.max(widest, row.length);
  }, 0);

  for (let column: number = 0; column < width; column++) {
    const header: string = hasHeader ? boundedKey(first[column] || "") : "";

    names.push(header || `column${column + 1}`);
  }

  // A file that is one row and one column is not a table.
  if (width <= 1 && !hasHeader && totalRows <= 1) {
    return emptyRead();
  }

  const collector: FieldCollector = newCollector();

  for (let index: number = hasHeader ? 1 : 0; index < rows.length; index++) {
    const row: Array<string> = rows[index]!;

    for (let column: number = 0; column < row.length; column++) {
      collector.addValue(names[column]!, row[column]);
    }
  }

  return {
    collector,
    records: Math.max(0, totalRows - (hasHeader ? 1 : 0)),
    leftoverText: "",
    isStructured: true,
  };
}

/*
 * JSON.
 *
 * Whole JSON is parsed natively. JSON that does not parse - most often
 * because the scan read only its first bytes - is walked as far as it goes
 * by walkJsonPrefix, which tokenizes it in one pass and gives every value
 * it reaches the path FieldCollector would.
 */

// The records of a whole document, when it is an array or holds one.
function addJsonDocument(value: unknown, collector: FieldCollector): number {
  if (Array.isArray(value)) {
    for (const item of value.slice(0, MAX_RECORDS_COLLECTED)) {
      collector.addRecord(item);
    }

    return value.length;
  }

  collector.addRecord(value);

  if (value && typeof value === "object") {
    let largest: number = 1;

    for (const child of Object.values(value as Record<string, unknown>)) {
      if (Array.isArray(child) && child.length > largest) {
        const holdsRecords: boolean = child.some((item: unknown) => {
          return Boolean(item) && typeof item === "object";
        });

        if (holdsRecords) {
          largest = child.length;
        }
      }
    }

    return largest;
  }

  return 1;
}

interface JsonFrame {
  isArray: boolean;
  path: string;
  key: string;
  expectingKey: boolean;
}

function decodeJsonString(raw: string): string {
  if (raw.indexOf("\\") < 0) {
    return raw;
  }

  let decoded: string = "";
  let start: number = 0;

  for (let index: number = 0; index < raw.length; index++) {
    if (raw.charCodeAt(index) !== BACKSLASH) {
      continue;
    }

    decoded += raw.slice(start, index);

    const next: string = raw[index + 1] || "";

    if (next === "u") {
      const code: number = parseInt(raw.slice(index + 2, index + 6), 16);

      decoded += Number.isNaN(code) ? "" : String.fromCharCode(code);
      index += 5;
    } else {
      const escapes: Record<string, string> = {
        n: "\n",
        t: "\t",
        r: "\r",
        b: "\b",
        f: "\f",
      };

      decoded += escapes[next] ?? next;
      index++;
    }

    start = index + 1;
  }

  return decoded + raw.slice(Math.min(start, raw.length));
}

// Where a JSON string that opens at `open` closes, or -1 when it never does.
function findJsonStringEnd(text: string, open: number): number {
  for (let index: number = open + 1; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code === BACKSLASH) {
      index++;
      continue;
    }

    if (code === DOUBLE_QUOTE) {
      return index;
    }
  }

  return -1;
}

const JSON_LITERALS: ReadonlyArray<string> = ["true", "false", "null"];

// The literal - true, false, null - that starts at `index`, if one does.
function findJsonLiteral(text: string, index: number): string | undefined {
  for (const literal of JSON_LITERALS) {
    if (text.startsWith(literal, index)) {
      return literal;
    }
  }

  return undefined;
}

function isJsonNumberCharacter(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    code === 45 ||
    code === 43 ||
    code === 46 ||
    code === 101 ||
    code === 69
  );
}

/*
 * Every value of a JSON text that may be cut short, with its path: the
 * elements of a top-level array are records, as are the objects of an
 * array under the top-level object. Returns how many records it saw.
 */
export function walkJsonPrefix(
  text: string,
  onValue: (path: string, value: unknown) => void,
  maxDepth: number,
): { records: number; reachedEnd: boolean } {
  const stack: Array<JsonFrame> = [];
  let records: number = 0;
  let index: number = 0;
  let rootIsArray: boolean = false;
  let sawRoot: boolean = false;

  const valuePath: () => string = (): string => {
    const top: JsonFrame | undefined = stack[stack.length - 1];

    if (!top) {
      return "";
    }

    if (top.isArray) {
      // The top-level array's elements are records: their paths start fresh.
      return stack.length === 1 ? "" : top.path + "[]";
    }

    return top.path ? `${top.path}.${top.key}` : top.key;
  };

  const startValue: () => void = (): void => {
    const top: JsonFrame | undefined = stack[stack.length - 1];

    if (!sawRoot) {
      sawRoot = true;
      return;
    }

    if (top?.isArray && stack.length === 1 && rootIsArray) {
      records++;
    } else if (top?.isArray && stack.length === 2 && !rootIsArray) {
      records++;
    }
  };

  const emit: (value: unknown) => void = (value: unknown): void => {
    const top: JsonFrame | undefined = stack[stack.length - 1];

    if (top && !top.isArray && top.expectingKey) {
      return;
    }

    startValue();

    if (stack.length <= maxDepth) {
      onValue(valuePath() || "value", value);
    }
  };

  while (index < text.length) {
    const code: number = text.charCodeAt(index);
    const top: JsonFrame | undefined = stack[stack.length - 1];

    if (code === 32 || code === 9 || code === LINE_FEED || code === 13) {
      index++;
      continue;
    }

    if (code === 123 || code === 91) {
      // { or [
      const path: string = valuePath();

      if (stack.length === 0) {
        rootIsArray = code === 91;
      }

      startValue();
      stack.push({
        isArray: code === 91,
        path,
        key: "",
        expectingKey: code === 123,
      });
      index++;
      continue;
    }

    if (code === 125 || code === 93) {
      // } or ]
      stack.pop();
      index++;

      if (stack.length === 0) {
        return { records: Math.max(records, 1), reachedEnd: true };
      }

      continue;
    }

    if (code === 44) {
      // ,
      if (top && !top.isArray) {
        top.expectingKey = true;
      }

      index++;
      continue;
    }

    if (code === 58) {
      // :
      if (top && !top.isArray) {
        top.expectingKey = false;
      }

      index++;
      continue;
    }

    if (code === DOUBLE_QUOTE) {
      const end: number = findJsonStringEnd(text, index);

      if (end < 0) {
        // Cut inside a string: what it held is not whole, and is not read.
        break;
      }

      const raw: string = text.slice(
        index + 1,
        Math.min(end, index + 1 + MAX_FIELD_VALUE_LENGTH),
      );
      const value: string = decodeJsonString(raw);

      if (top && !top.isArray && top.expectingKey) {
        top.key = boundedKey(value);
      } else {
        emit(value);
      }

      index = end + 1;
      continue;
    }

    if (isJsonNumberCharacter(code)) {
      let end: number = index;

      while (end < text.length && isJsonNumberCharacter(text.charCodeAt(end))) {
        end++;
      }

      if (end >= text.length) {
        // A number at the very end may have been cut.
        break;
      }

      emit(text.slice(index, Math.min(end, index + 64)));
      index = end;
      continue;
    }

    const literal: string | undefined = findJsonLiteral(text, index);

    if (!literal) {
      // Not JSON from here on.
      break;
    }

    emit(literal === "null" ? null : literal === "true");
    index += literal.length;
  }

  return { records: Math.max(records, sawRoot ? 1 : 0), reachedEnd: false };
}

export function readJson(data: {
  text: string;
  isTruncated: boolean;
  // Only whole JSON or JSON lines: for text that merely starts like JSON.
  wholeOnly?: boolean | undefined;
}): StructuredRead {
  const collector: FieldCollector = newCollector();
  const trimmed: string = data.text.trim();

  if (trimmed.length === 0) {
    return emptyRead();
  }

  try {
    const value: unknown = JSON.parse(trimmed);

    return {
      collector,
      records: addJsonDocument(value, collector),
      leftoverText: "",
      isStructured: true,
    };
  } catch {
    // Cut short, or not one document: read below.
  }

  if (looksLikeJsonLines(trimmed)) {
    return readJsonLines(data);
  }

  const first: number = trimmed.charCodeAt(0);

  if (data.wholeOnly || (first !== 123 && first !== 91)) {
    return emptyRead();
  }

  const walked: { records: number; reachedEnd: boolean } = walkJsonPrefix(
    trimmed,
    (path: string, value: unknown): void => {
      collector.addValue(path, value);
    },
    12,
  );

  return {
    collector,
    records: walked.records,
    leftoverText: "",
    isStructured: collector.getFields().length > 0,
  };
}

// Whether text is one JSON value a line: two or more lines, each one whole.
export function looksLikeJsonLines(text: string): boolean {
  let parsed: number = 0;
  let failed: boolean = false;

  forEachLine(text, (line: string): boolean => {
    const trimmed: string = line.trim();

    if (trimmed.length === 0) {
      return true;
    }

    const first: number = trimmed.charCodeAt(0);

    if (first !== 123 && first !== 91) {
      failed = true;
      return false;
    }

    try {
      JSON.parse(trimmed);
      parsed++;
    } catch {
      failed = parsed === 0;
      return false;
    }

    return parsed < 2;
  });

  return !failed && parsed >= 2;
}

export function readJsonLines(data: {
  text: string;
  isTruncated: boolean;
}): StructuredRead {
  const collector: FieldCollector = newCollector();
  const text: string = withoutCutLastLine(data.text, data.isTruncated);
  let records: number = 0;
  let parsed: number = 0;
  const leftover: Array<string> = [];
  let leftoverLength: number = 0;

  forEachLine(text, (line: string): void => {
    const trimmed: string = line.trim();

    if (trimmed.length === 0) {
      return;
    }

    records++;

    if (parsed >= MAX_RECORDS_COLLECTED) {
      return;
    }

    try {
      collector.addRecord(JSON.parse(trimmed));
      parsed++;
    } catch {
      if (leftoverLength < MAX_LEFTOVER_TEXT_LENGTH) {
        leftoverLength += appendLeftover(leftover, line);
      }
    }
  });

  return {
    collector,
    records,
    leftoverText: leftover.join("\n"),
    isStructured: parsed > 0,
  };
}

/*
 * KEY-VALUE FILES: .env, .ini, .cfg, .conf, .properties, TOML.
 *
 * KEY=value, key: value and key = "value", under [section] headers; an
 * `export ` before a key, comments (#, ;, !) and quotes are read as a shell
 * or an ini parser would. A line that is not a key and a value is kept as
 * text, so nothing in the file goes unread.
 */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first: string = value[0]!;
    const last: string = value[value.length - 1]!;

    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1);
    }
  }

  return value;
}

// A value without a comment after it: `secret # the old one`.
function withoutTrailingComment(value: string): string {
  const first: string = value[0] || "";

  if (first === '"' || first === "'") {
    const close: number = value.indexOf(first, 1);

    return close > 0 ? value.slice(0, close + 1) : value;
  }

  for (const marker of [" #", "\t#", " ;", "\t;"]) {
    const at: number = value.indexOf(marker);

    if (at >= 0) {
      return value.slice(0, at).trimEnd();
    }
  }

  return value;
}

export function readKeyValue(data: {
  text: string;
  isTruncated: boolean;
}): StructuredRead {
  const collector: FieldCollector = newCollector();
  const text: string = withoutCutLastLine(data.text, data.isTruncated);
  const leftover: Array<string> = [];
  let leftoverLength: number = 0;
  let section: string = "";
  let pairs: number = 0;

  forEachLine(text, (line: string): void => {
    let trimmed: string = line.trim();

    if (
      trimmed.length === 0 ||
      trimmed.startsWith("#") ||
      trimmed.startsWith(";") ||
      trimmed.startsWith("!") ||
      trimmed.startsWith("//")
    ) {
      return;
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      section = boundedKey(trimmed.replace(SECTION_BRACKETS, ""));
      return;
    }

    if (trimmed.startsWith("export ")) {
      trimmed = trimmed.slice(7).trimStart();
    }

    const equals: number = trimmed.indexOf("=");
    const colon: number = trimmed.indexOf(":");
    const separator: number =
      equals < 0 ? colon : colon < 0 ? equals : Math.min(equals, colon);
    const key: string = separator > 0 ? trimmed.slice(0, separator).trim() : "";

    if (!key || !KEY_VALUE_KEY.test(key)) {
      if (leftoverLength < MAX_LEFTOVER_TEXT_LENGTH) {
        leftoverLength += appendLeftover(leftover, line);
      }

      return;
    }

    const value: string = unquote(
      withoutTrailingComment(trimmed.slice(separator + 1).trim()),
    );

    collector.addValue(section ? `${section}.${key}` : key, value);
    pairs++;
  });

  return {
    collector,
    records: pairs > 0 ? 1 : 0,
    leftoverText: leftover.join("\n"),
    isStructured: pairs > 0,
  };
}

/*
 * YAML, READ AS KEY: VALUE LINES.
 *
 * Not a YAML parser: keys nest by their indentation, list items fold into
 * "[]" (`servers[].password`), a block scalar (| or >) is one value, and
 * anchors, tags and flow collections are left as the text they are. That
 * is what configuration files and manifests are made of.
 */
interface YamlFrame {
  indent: number;
  path: string;
  isListItem: boolean;
}

function countIndent(line: string): number {
  let indent: number = 0;

  while (indent < line.length && line.charCodeAt(indent) === 32) {
    indent++;
  }

  return indent;
}

function cleanYamlScalar(value: string): string {
  let cleaned: string = withoutTrailingComment(value.trim());

  // An anchor or a tag before the value: &default, !!str.
  while (cleaned.startsWith("&") || cleaned.startsWith("!")) {
    const space: number = cleaned.indexOf(" ");

    if (space < 0) {
      return "";
    }

    cleaned = cleaned.slice(space + 1).trimStart();
  }

  return unquote(cleaned);
}

export function readYaml(data: {
  text: string;
  isTruncated: boolean;
}): StructuredRead {
  const collector: FieldCollector = newCollector();
  const text: string = withoutCutLastLine(data.text, data.isTruncated);
  const leftover: Array<string> = [];
  let leftoverLength: number = 0;
  const stack: Array<YamlFrame> = [];
  let pairs: number = 0;
  let block: { path: string; indent: number; lines: Array<string> } | null =
    null;

  const flushBlock: () => void = (): void => {
    if (block && block.lines.length > 0) {
      collector.addValue(block.path, block.lines.join("\n"));
    }

    block = null;
  };

  const parentPath: (indent: number, forListItem: boolean) => string = (
    indent: number,
    forListItem: boolean,
  ): string => {
    while (stack.length > 0) {
      const top: YamlFrame = stack[stack.length - 1]!;

      // A list may sit at its key's own indent: "key:\n- item".
      const keepsTop: boolean = forListItem
        ? top.indent < indent || (top.indent === indent && !top.isListItem)
        : top.indent < indent;

      if (keepsTop) {
        break;
      }

      stack.pop();
    }

    return stack.length > 0 ? stack[stack.length - 1]!.path : "";
  };

  const join: (parent: string, key: string) => string = (
    parent: string,
    key: string,
  ): string => {
    return parent ? `${parent}.${key}` : key;
  };

  const readPair: (
    content: string,
    indent: number,
    parent: string,
  ) => boolean = (content: string, indent: number, parent: string): boolean => {
    const colon: number = content.indexOf(": ");
    const endsWithColon: boolean = content.endsWith(":");
    const keyEnd: number =
      colon >= 0 ? colon : endsWithColon ? content.length - 1 : -1;

    if (keyEnd <= 0) {
      return false;
    }

    const rawKey: string = content.slice(0, keyEnd).trim();

    if (!YAML_KEY.test(rawKey)) {
      return false;
    }

    const key: string = boundedKey(unquote(rawKey));
    const path: string = join(parent, key);
    const rest: string = colon >= 0 ? content.slice(colon + 2).trim() : "";

    pairs++;

    if (rest === "" || rest.startsWith("&")) {
      stack.push({ indent, path, isListItem: false });
      return true;
    }

    if (rest.startsWith("|") || rest.startsWith(">")) {
      block = { path, indent, lines: [] };
      return true;
    }

    collector.addValue(path, cleanYamlScalar(rest));
    return true;
  };

  forEachLine(text, (line: string): void => {
    const indent: number = countIndent(line);
    const content: string = line.slice(indent).trimEnd();

    if (block) {
      if (content.length === 0 || indent > block.indent) {
        block.lines.push(content);
        return;
      }

      flushBlock();
    }

    if (
      content.length === 0 ||
      content.startsWith("#") ||
      content === "---" ||
      content === "..."
    ) {
      return;
    }

    if (content === "-" || content.startsWith("- ")) {
      const parent: string = parentPath(indent, true);
      const itemPath: string = parent ? `${parent}[]` : "[]";
      const item: string = content.slice(1).trim();

      stack.push({ indent, path: itemPath, isListItem: true });

      if (item.length === 0) {
        return;
      }

      // "- key: value" opens a mapping inside the item.
      if (!readPair(item, indent + 2, itemPath)) {
        collector.addValue(itemPath, cleanYamlScalar(item));
        pairs++;
      }

      return;
    }

    const parent: string = parentPath(indent, false);

    if (!readPair(content, indent, parent)) {
      if (leftoverLength < MAX_LEFTOVER_TEXT_LENGTH) {
        leftoverLength += appendLeftover(leftover, line);
      }
    }
  });

  flushBlock();

  return {
    collector,
    records: pairs > 0 ? 1 : 0,
    leftoverText: leftover.join("\n"),
    isStructured: pairs > 0,
  };
}

/*
 * MARKUP, READ AS TEXT.
 *
 * Tags go (removeHtmlMarkup's walk, which reads any markup in one pass),
 * and what they separated stays apart: a block's end is a line break, a
 * cell's a tab, any other tag a space, so "<td>a@b.co</td><td>12</td>"
 * does not become one word. XML keeps its attribute values - data lives
 * there too (<user email="...">) - and HTML keeps a script's text, where
 * keys are pasted, but not a style's.
 */
const HTML_BLOCK_TAGS: ReadonlySet<string> = new Set([
  "p",
  "div",
  "br",
  "tr",
  "li",
  "ul",
  "ol",
  "table",
  "section",
  "article",
  "header",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "blockquote",
  "hr",
  "dt",
  "dd",
  "title",
]);

// The name of the element a tag opens or closes, lower-cased.
export function getTagName(markup: string): string {
  let start: number = 1;

  if (markup.charCodeAt(1) === 47) {
    start = 2;
  }

  let end: number = start;

  while (end < markup.length) {
    const code: number = markup.charCodeAt(end);

    if (
      code === 32 ||
      code === 9 ||
      code === LINE_FEED ||
      code === 13 ||
      code === 47 ||
      code === 62
    ) {
      break;
    }

    end++;
  }

  return markup.slice(start, end).toLowerCase();
}

// The values of a tag's attributes, in order: <a b="1" c='2'> gives 1, 2.
export function getAttributeValues(markup: string): Array<string> {
  const values: Array<string> = [];
  let index: number = markup.indexOf("=");

  while (index >= 0 && index < markup.length) {
    let start: number = index + 1;

    while (
      start < markup.length &&
      (markup.charCodeAt(start) === 32 || markup.charCodeAt(start) === 9)
    ) {
      start++;
    }

    const quote: string = markup[start] || "";

    if (quote === '"' || quote === "'") {
      const end: number = markup.indexOf(quote, start + 1);

      if (end < 0) {
        break;
      }

      values.push(markup.slice(start + 1, end));
      index = markup.indexOf("=", end + 1);
    } else {
      index = markup.indexOf("=", start);
    }
  }

  return values;
}

const XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  hellip: "…",
  ndash: "–",
  mdash: "—",
};

// Text with &amp;, &#64; and &#x40; read as the characters they stand for.
export function decodeXmlEntities(text: string): string {
  let ampersand: number = text.indexOf("&");

  if (ampersand < 0) {
    return text;
  }

  let decoded: string = "";
  let start: number = 0;

  while (ampersand >= 0) {
    const semicolon: number = text.indexOf(";", ampersand + 1);

    if (semicolon < 0 || semicolon - ampersand > 12) {
      ampersand = text.indexOf("&", ampersand + 1);
      continue;
    }

    const name: string = text.slice(ampersand + 1, semicolon);
    let character: string | undefined = XML_ENTITIES[name];

    if (character === undefined && name.startsWith("#")) {
      const code: number =
        name[1] === "x" || name[1] === "X"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);

      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        character = String.fromCodePoint(code);
      }
    }

    if (character !== undefined) {
      decoded += text.slice(start, ampersand) + character;
      start = semicolon + 1;
    }

    ampersand = text.indexOf("&", semicolon + 1);
  }

  return decoded + text.slice(start);
}

export function markupToText(text: string, flavor: "xml" | "html"): string {
  const stripped: string = replaceHtmlMarkup(
    text,
    (markup: string): string => {
      // A comment's text: commented-out settings still hold their values.
      if (markup.startsWith("<!--")) {
        return ` ${markup.slice(4, markup.endsWith("-->") ? -3 : undefined)} `;
      }

      const name: string = getTagName(markup);

      if (flavor === "html") {
        if (name === "script") {
          // A script's text: where a key or a token is pasted.
          const open: number = markup.indexOf(">");
          const close: number = markup.lastIndexOf("<");

          return close > open ? ` ${markup.slice(open + 1, close)} ` : " ";
        }

        if (name === "td" || name === "th") {
          return "\t";
        }

        return HTML_BLOCK_TAGS.has(name) ? "\n" : " ";
      }

      const values: Array<string> = getAttributeValues(markup);

      if (markup.charCodeAt(1) === 47) {
        return "\n";
      }

      return values.length > 0 ? ` ${values.join(" ")} ` : " ";
    },
    { rawTextElements: flavor === "html" },
  );

  return decodeXmlEntities(stripped);
}
