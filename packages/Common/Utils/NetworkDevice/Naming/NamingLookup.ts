import {
  MAX_NAMING_LOOKUP_ENTRIES,
  MAX_NAMING_LOOKUP_KEY_LENGTH,
  MAX_NAMING_LOOKUP_VALUE_LENGTH,
  NamingLookupEntry,
  NamingLookupKey,
  isNamingLookupKey,
} from "../../../Types/NetworkDevice/DeviceNaming";
import { readIpv4Octets, readMacAddressDigits } from "./NamePattern";

/*
 * A NAMING RULE'S LOOKUP TABLE (OneUptime issue #6619).
 *
 * A naming convention is often a table, not a formula. The reporter's is:
 * in every unit's subnet, the device at .51 is the menu player MNUPLR01, the
 * one at .151 the left screen MNUSCR01, the ones at .154 to .159 the drive-
 * through screens DRTSCR01 to DRTSCR06. No pattern computes that from the
 * address. So a rule may carry a table - the last part of the IP address, the
 * IP address, the MAC address or the discovered name, each with the value it
 * stands for - and its pattern puts the device's value where it says
 * {lookup}: "UN{site.code}{lookup}" names all seventeen devices of every unit.
 *
 * A device whose value is not in the table is not named by the rule, and the
 * next rule is tried. The table is typed in the rule form, pasted from a
 * spreadsheet, or read from a CSV file, and saved back as one.
 *
 * Keys are compared the way their kind is written by different tools: an
 * address without leading zeros, a MAC without its separators, a name
 * without case.
 */

/*
 * Marks an English sentence as a key of the Dashboard's locales (see
 * NamePattern.ts, whose marker this is too).
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

// One part of an IPv4 address, as digits.
const OCTET_DIGITS: RegExp = /^\d{1,3}$/;
// What an IPv6 address is written with.
const IPV6_CHARACTERS: RegExp = /^[0-9a-fA-F:.]+$/;
/*
 * A cell a spreadsheet would run as a formula, and the same cell as the
 * export writes it, behind an apostrophe.
 */
const FORMULA_CELL: RegExp = /^[=+\-@]/;
const ESCAPED_FORMULA_CELL: RegExp = /^'[=+\-@]/;
// A cell the CSV export puts in quotes.
const CELL_NEEDING_QUOTES: RegExp = /[",;\t\r\n]/;

// What the rule form's choice and the table's first column call each key.
export const NAMING_LOOKUP_KEY_TITLES: Readonly<
  Record<NamingLookupKey, string>
> = {
  [NamingLookupKey.LastIpOctet]: translationKey("Last part of the IP address"),
  [NamingLookupKey.IpAddress]: translationKey("IP address"),
  [NamingLookupKey.MacAddress]: translationKey("MAC address"),
  [NamingLookupKey.DiscoveredName]: translationKey("Discovered name"),
};

// An example of a table's value: the reporter's menu player's code.
export const NAMING_LOOKUP_VALUE_EXAMPLE: string = "MNUPLR01";

// An example key of each kind, for the table's empty row.
export const NAMING_LOOKUP_KEY_EXAMPLES: Readonly<
  Record<NamingLookupKey, string>
> = {
  [NamingLookupKey.LastIpOctet]: "51",
  [NamingLookupKey.IpAddress]: "10.48.145.51",
  [NamingLookupKey.MacAddress]: "00:05:0b:b0:7f:fc",
  [NamingLookupKey.DiscoveredName]: "dmb-5",
};

export const NAMING_LOOKUP_PROBLEMS: {
  readonly notAList: string;
  readonly tooMany: string;
  readonly noKeyKind: string;
  readonly unusedTable: string;
  readonly emptyTable: string;
  readonly badKey: string;
  readonly keyTooLong: string;
  readonly emptyValue: string;
  readonly valueTooLong: string;
  readonly controlCharacter: string;
  readonly duplicateKey: string;
} = {
  notAList: translationKey(
    "The lookup table must be a list of rows, each with a key and a value.",
  ),
  tooMany: translationKey("A lookup table can have at most {{max}} rows."),
  noKeyKind: translationKey(
    "Choose what the lookup table is keyed by: the last part of the IP address, the IP address, the MAC address or the discovered name.",
  ),
  unusedTable: translationKey(
    "Put {lookup} in the name pattern where the table's value goes, or clear the table.",
  ),
  emptyTable: translationKey(
    "The name pattern uses {lookup}: add a row to the lookup table, or take {lookup} out of the pattern.",
  ),
  badKey: translationKey(
    'Row {{row}}: "{{key}}" is not a {{kind}}, such as {{example}}.',
  ),
  keyTooLong: translationKey(
    "Row {{row}}: the key can be at most {{max}} characters long.",
  ),
  emptyValue: translationKey("Row {{row}}: enter the value for {{key}}."),
  valueTooLong: translationKey(
    "Row {{row}}: the value can be at most {{max}} characters long.",
  ),
  controlCharacter: translationKey(
    "Row {{row}}: a key or value can't contain line breaks or other control characters.",
  ),
  duplicateKey: translationKey(
    'Rows {{first}} and {{row}} both have the key "{{key}}". Keep one of them.',
  ),
};

export interface NamingLookupProblem {
  template: string;
  values: Record<string, string>;
}

export function formatNamingLookupProblem(
  problem: NamingLookupProblem,
): string {
  let text: string = problem.template;

  for (const [key, value] of Object.entries(problem.values)) {
    text = text.split(`{{${key}}}`).join(value);
  }

  return text;
}

function hasControlCharacter(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }

  return false;
}

/**
 * A key as the table compares it, or null when it is not a key of its kind:
 * "051" is 51, "00-05-0B-B0-7F-FC" is 00:05:0b:b0:7f:fc, "DMB-5" is dmb-5.
 */
export function normalizeNamingLookupKey(
  kind: NamingLookupKey,
  value: unknown,
): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const text: string = String(value).trim();

  if (!text || text.length > MAX_NAMING_LOOKUP_KEY_LENGTH) {
    return null;
  }

  switch (kind) {
    case NamingLookupKey.LastIpOctet: {
      // A whole number from 0 to 255, or a written ".51".
      const digits: string = text.startsWith(".") ? text.substring(1) : text;

      if (!OCTET_DIGITS.test(digits)) {
        return null;
      }

      const octet: number = parseInt(digits, 10);

      return octet <= 255 ? String(octet) : null;
    }
    case NamingLookupKey.IpAddress: {
      const octets: Array<string> | null = readIpv4Octets(text);

      if (octets) {
        return octets.join(".");
      }

      // An IPv6 address, compared without case.
      return text.includes(":") && IPV6_CHARACTERS.test(text)
        ? text.toLowerCase()
        : null;
    }
    case NamingLookupKey.MacAddress: {
      const digits: string | null = readMacAddressDigits(text);

      if (!digits) {
        return null;
      }

      const lower: string = digits.toLowerCase();
      const pairs: Array<string> = [];

      for (let index: number = 0; index < lower.length; index += 2) {
        pairs.push(lower.substring(index, index + 2));
      }

      return pairs.join(":");
    }
    case NamingLookupKey.DiscoveredName:
      return hasControlCharacter(text) ? null : text.toLowerCase();
    default:
      return null;
  }
}

export interface NamingLookupTable {
  kind: NamingLookupKey;
  // Normalized key -> value.
  values: ReadonlyMap<string, string>;
}

/**
 * The table a rule stored, read for lookups: each row's key normalized, the
 * first row of a key winning. Rows that are not rows are skipped - the
 * service refuses them at save, so a skipped row is one written around it.
 */
export function readNamingLookupTable(data: {
  kind: unknown;
  entries: unknown;
}): NamingLookupTable | null {
  if (!isNamingLookupKey(data.kind) || !Array.isArray(data.entries)) {
    return null;
  }

  const values: Map<string, string> = new Map<string, string>();

  for (const entry of data.entries.slice(0, MAX_NAMING_LOOKUP_ENTRIES)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const key: string | null = normalizeNamingLookupKey(
      data.kind,
      record["key"],
    );
    const value: string =
      typeof record["value"] === "string" ? record["value"].trim() : "";

    if (!key || !value || values.has(key)) {
      continue;
    }

    values.set(key, value);
  }

  return { kind: data.kind, values: values };
}

// The facts of a device a table is looked up with.
export interface NamingLookupFacts {
  ipAddress?: string | undefined;
  macAddress?: string | undefined;
  discoveredName?: string | undefined;
}

// The device's key in a table of this kind, or null when it has none.
export function getNamingLookupKeyOf(
  kind: NamingLookupKey,
  facts: NamingLookupFacts,
): string | null {
  switch (kind) {
    case NamingLookupKey.LastIpOctet: {
      const octets: Array<string> | null = readIpv4Octets(facts.ipAddress);
      return octets ? octets[3]! : null;
    }
    case NamingLookupKey.IpAddress:
      return normalizeNamingLookupKey(kind, facts.ipAddress || "");
    case NamingLookupKey.MacAddress:
      return normalizeNamingLookupKey(kind, facts.macAddress || "");
    case NamingLookupKey.DiscoveredName:
      return normalizeNamingLookupKey(kind, facts.discoveredName || "");
    default:
      return null;
  }
}

// The table's value for the device, or undefined when the table has no row for it.
export function lookUpNamingValue(
  table: NamingLookupTable,
  facts: NamingLookupFacts,
): string | undefined {
  const key: string | null = getNamingLookupKeyOf(table.kind, facts);

  return key === null ? undefined : table.values.get(key);
}

/**
 * The rows checked as the service saves them and the form shows them: each
 * key a key of the kind, each value there and short enough, no key twice.
 * Returns the rows to store - trimmed, keys as typed - or the first problem.
 * Row numbers count from 1, as a person reads the table.
 */
export function validateNamingLookupEntries(data: {
  kind: unknown;
  entries: unknown;
}): { entries: Array<NamingLookupEntry> } | { problem: NamingLookupProblem } {
  if (data.entries === undefined || data.entries === null) {
    return { entries: [] };
  }

  if (!Array.isArray(data.entries)) {
    return {
      problem: { template: NAMING_LOOKUP_PROBLEMS.notAList, values: {} },
    };
  }

  if (data.entries.length === 0) {
    return { entries: [] };
  }

  if (data.entries.length > MAX_NAMING_LOOKUP_ENTRIES) {
    return {
      problem: {
        template: NAMING_LOOKUP_PROBLEMS.tooMany,
        values: { max: String(MAX_NAMING_LOOKUP_ENTRIES) },
      },
    };
  }

  if (!isNamingLookupKey(data.kind)) {
    return {
      problem: { template: NAMING_LOOKUP_PROBLEMS.noKeyKind, values: {} },
    };
  }

  const kind: NamingLookupKey = data.kind;
  const entries: Array<NamingLookupEntry> = [];
  const firstRowOfKey: Map<string, number> = new Map<string, number>();

  for (let index: number = 0; index < data.entries.length; index++) {
    const row: string = String(index + 1);
    const entry: unknown = data.entries[index];

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return {
        problem: { template: NAMING_LOOKUP_PROBLEMS.notAList, values: {} },
      };
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const rawKey: string =
      typeof record["key"] === "string" || typeof record["key"] === "number"
        ? String(record["key"]).trim()
        : "";
    const value: string =
      typeof record["value"] === "string" ? record["value"].trim() : "";

    if (hasControlCharacter(rawKey) || hasControlCharacter(value)) {
      return {
        problem: {
          template: NAMING_LOOKUP_PROBLEMS.controlCharacter,
          values: { row: row },
        },
      };
    }

    if (rawKey.length > MAX_NAMING_LOOKUP_KEY_LENGTH) {
      return {
        problem: {
          template: NAMING_LOOKUP_PROBLEMS.keyTooLong,
          values: { row: row, max: String(MAX_NAMING_LOOKUP_KEY_LENGTH) },
        },
      };
    }

    const key: string | null = normalizeNamingLookupKey(kind, rawKey);

    if (!key) {
      return {
        problem: {
          template: NAMING_LOOKUP_PROBLEMS.badKey,
          values: {
            row: row,
            key: rawKey,
            kind: NAMING_LOOKUP_KEY_TITLES[kind].toLowerCase(),
            example: NAMING_LOOKUP_KEY_EXAMPLES[kind],
          },
        },
      };
    }

    if (!value) {
      return {
        problem: {
          template: NAMING_LOOKUP_PROBLEMS.emptyValue,
          values: { row: row, key: rawKey },
        },
      };
    }

    if (value.length > MAX_NAMING_LOOKUP_VALUE_LENGTH) {
      return {
        problem: {
          template: NAMING_LOOKUP_PROBLEMS.valueTooLong,
          values: { row: row, max: String(MAX_NAMING_LOOKUP_VALUE_LENGTH) },
        },
      };
    }

    const first: number | undefined = firstRowOfKey.get(key);

    if (first !== undefined) {
      return {
        problem: {
          template: NAMING_LOOKUP_PROBLEMS.duplicateKey,
          values: { first: String(first), row: row, key: rawKey },
        },
      };
    }

    firstRowOfKey.set(key, index + 1);
    entries.push({ key: rawKey, value: value });
  }

  return { entries: entries };
}

/*
 * PASTED OR UPLOADED TABLES. A spreadsheet's two columns pasted into the
 * form arrive as tab-separated lines; a CSV file as comma- (or, from a
 * spreadsheet set to a comma decimal, semicolon-) separated lines, with
 * quotes around a cell that holds the separator. The first two cells of a
 * line are its key and value; a line with fewer is skipped when it is blank
 * and reported when it is not. A first line that reads as a header - "key"
 * and "value", or the key's own title - is skipped.
 */
export interface ParsedNamingLookupText {
  entries: Array<NamingLookupEntry>;
  // Lines that had text but no value cell, by number from 1.
  incompleteLines: Array<number>;
}

// The longest text a paste or a file may be read from: 5,000 rows of 200 characters.
export const MAX_NAMING_LOOKUP_TEXT_LENGTH: number = 1_000_000;

/*
 * The separator the text is written with: whichever of a tab, a comma and a
 * semicolon its first lines use most, outside quotes - a quoted cell may
 * hold the others.
 */
function detectSeparator(lines: Array<string>): string {
  const totals: Map<string, number> = new Map<string, number>([
    ["\t", 0],
    [",", 0],
    [";", 0],
  ]);

  for (const line of lines.slice(0, 20)) {
    let isQuoted: boolean = false;

    for (const character of line) {
      if (character === '"') {
        isQuoted = !isQuoted;
        continue;
      }

      if (!isQuoted && totals.has(character)) {
        totals.set(character, totals.get(character)! + 1);
      }
    }
  }

  const counts: Array<{ separator: string; count: number }> = [
    "\t",
    ",",
    ";",
  ].map((separator: string) => {
    return { separator: separator, count: totals.get(separator) || 0 };
  });

  // A tab wins any tie: a spreadsheet's paste is tab-separated.
  counts.sort(
    (
      left: { separator: string; count: number },
      right: { separator: string; count: number },
    ): number => {
      return right.count - left.count;
    },
  );

  return counts[0] && counts[0].count > 0 ? counts[0].separator : ",";
}

// One line's cells, honouring quotes ("a,b" is one cell, "" a quote in it).
function splitCells(line: string, separator: string): Array<string> {
  const cells: Array<string> = [];
  let cell: string = "";
  let isQuoted: boolean = false;

  for (let index: number = 0; index < line.length; index++) {
    const character: string = line[index]!;

    if (isQuoted) {
      if (character === '"' && line[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (character === '"') {
        isQuoted = false;
      } else {
        cell += character;
      }

      continue;
    }

    if (character === '"' && cell.trim().length === 0) {
      cell = "";
      isQuoted = true;
      continue;
    }

    if (character === separator) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += character;
  }

  cells.push(cell.trim());

  return cells;
}

/*
 * A cell as text: trimmed, and without the apostrophe toNamingLookupCsv puts
 * before text a spreadsheet would read as a formula, so a table exported and
 * read back has the same rows.
 */
function fromCsvText(cell: string): string {
  const trimmed: string = cell.trim();

  return ESCAPED_FORMULA_CELL.test(trimmed) ? trimmed.substring(1) : trimmed;
}

function isHeaderLine(cells: Array<string>, kind: NamingLookupKey): boolean {
  const first: string = (cells[0] || "").trim().toLowerCase();
  const second: string = (cells[1] || "").trim().toLowerCase();

  if (second !== "value" && second !== "name") {
    return false;
  }

  return (
    first === "key" ||
    first === NAMING_LOOKUP_KEY_TITLES[kind].toLowerCase() ||
    normalizeNamingLookupKey(kind, cells[0] || "") === null
  );
}

/**
 * The rows of a pasted table or a CSV file. Rows are not checked here: the
 * form shows them and validateNamingLookupEntries says what is wrong, with
 * the row it is on.
 */
export function parseNamingLookupText(
  text: string,
  kind: NamingLookupKey,
): ParsedNamingLookupText {
  const limited: string =
    text.length > MAX_NAMING_LOOKUP_TEXT_LENGTH
      ? text.substring(0, MAX_NAMING_LOOKUP_TEXT_LENGTH)
      : text;
  // A byte order mark a spreadsheet writes at the start of a CSV file.
  const withoutBom: string = limited.startsWith("﻿")
    ? limited.substring(1)
    : limited;
  const lines: Array<string> = withoutBom.split(/\r\n|\n|\r/);
  const separator: string = detectSeparator(lines);
  const entries: Array<NamingLookupEntry> = [];
  const incompleteLines: Array<number> = [];
  let isFirstContentLine: boolean = true;

  for (let index: number = 0; index < lines.length; index++) {
    const line: string = lines[index]!;

    if (!line.trim()) {
      continue;
    }

    const cells: Array<string> = splitCells(line, separator);

    if (isFirstContentLine) {
      isFirstContentLine = false;

      if (isHeaderLine(cells, kind)) {
        continue;
      }
    }

    const key: string = fromCsvText(cells[0] || "");
    const value: string = fromCsvText(cells[1] || "");

    if (!key && !value) {
      continue;
    }

    if (!key || !value) {
      incompleteLines.push(index + 1);
      continue;
    }

    entries.push({ key: key, value: value });

    if (entries.length >= MAX_NAMING_LOOKUP_ENTRIES + 1) {
      break;
    }
  }

  return { entries: entries, incompleteLines: incompleteLines };
}

/*
 * One CSV cell, quoted when it holds a separator of any kind the reader
 * tells apart (a comma, a semicolon, a tab), a quote or a line break - so
 * the file reads back with the comma it was written with.
 */
function toCsvCell(value: string): string {
  /*
   * A cell a spreadsheet would read as a formula (=, +, -, @) is kept as
   * text with a leading apostrophe, so an exported table opened in a
   * spreadsheet never runs one.
   */
  const safe: string = FORMULA_CELL.test(value) ? `'${value}` : value;

  return CELL_NEEDING_QUOTES.test(safe)
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
}

/**
 * The table as a CSV file: a header line naming the key, then a line per
 * row. parseNamingLookupText reads it back to the same rows.
 */
export function toNamingLookupCsv(
  kind: NamingLookupKey,
  entries: ReadonlyArray<NamingLookupEntry>,
): string {
  const lines: Array<string> = [
    `${toCsvCell(NAMING_LOOKUP_KEY_TITLES[kind])},Value`,
  ];

  for (const entry of entries) {
    lines.push(`${toCsvCell(entry.key)},${toCsvCell(entry.value)}`);
  }

  return lines.join("\r\n") + "\r\n";
}
