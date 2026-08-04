import { VoidFunction } from "Common/Types/FunctionTypes";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";

/*
 * Pure CSV parsing + import planning for the Status Page > Groups bulk
 * import. React-free on purpose: this module must never import RouteMap or
 * Config (they touch window at module load), so it stays testable from the
 * node-env jest suite in App/Tests/Dashboard.
 *
 * Expected CSV columns (header row required, any order, case-insensitive):
 *   name,parentName,description,isExpandedByDefault,showCurrentStatus,
 *   showUptimePercent,uptimePercentPrecision,viewMode,rowAxisLabel,
 *   rowAxisValues,columnAxisLabel,columnAxisValues
 *
 * Only `name` is required. Every other column may be omitted from the header
 * entirely or left blank on a row, in which case the model's own default
 * applies — an import must never write a value the user did not ask for.
 *
 * Groups nest, so this file also owns the dependency ordering: a parent
 * created by the same file is resolved before its children, and the nesting
 * limit StatusPageGroupService enforces on write is checked here first so a
 * too-deep row is reported in the preview instead of failing mid-run.
 */

/*
 * How deep a group may be nested. Mirrors
 * StatusPageGroupTreeUtil.MaxNestingDepth, which is what the server enforces
 * on write — duplicated rather than imported because that module pulls in the
 * StatusPageGroup entity (and with it typeorm) for a single number, and this
 * module is deliberately dependency-free. StatusPageGroupCsv.test.ts pins the
 * two together.
 */
export const MAX_GROUP_NESTING_DEPTH: number = 10;

export interface ParsedStatusPageGroupRow {
  // 1-based line number in the CSV where this row starts.
  line: number;
  name: string;
  // Empty string for a top level group.
  parentName: string;
  description: string;
  /*
   * undefined means "the column was blank" — the create leaves the field off
   * entirely so the model default (or the status page's own behaviour) wins.
   */
  isExpandedByDefault: boolean | undefined;
  showCurrentStatus: boolean | undefined;
  showUptimePercent: boolean | undefined;
  uptimePercentPrecision: UptimePrecision | undefined;
  viewMode: StatusPageGroupViewMode | undefined;
  rowAxisLabel: string;
  rowAxisValues: string;
  columnAxisLabel: string;
  columnAxisValues: string;
}

export interface StatusPageGroupCsvError {
  // 1-based line the error belongs to; 0 for file-level errors.
  line: number;
  message: string;
}

export interface StatusPageGroupCsvParseResult {
  rows: Array<ParsedStatusPageGroupRow>;
  errors: Array<StatusPageGroupCsvError>;
}

export const STATUS_PAGE_GROUP_CSV_COLUMNS: Array<string> = [
  "name",
  "parentName",
  "description",
  "isExpandedByDefault",
  "showCurrentStatus",
  "showUptimePercent",
  "uptimePercentPrecision",
  "viewMode",
  "rowAxisLabel",
  "rowAxisValues",
  "columnAxisLabel",
  "columnAxisValues",
];

const REQUIRED_COLUMNS: Array<string> = ["name"];

/*
 * The file the modal offers as a downloadable template, and shows as the
 * textarea's placeholder. It lives here rather than in the component so the
 * parser's own suite can import it and prove that the example we hand people
 * actually imports — a template that fails validation is worse than none.
 *
 * It deliberately exercises the three shapes an author has to get right: a
 * top level group, a child naming its parent from the same file, and a grid
 * whose axis lists are quoted because they contain commas.
 */
export const STATUS_PAGE_GROUP_CSV_EXAMPLE: string = [
  STATUS_PAGE_GROUP_CSV_COLUMNS.join(","),
  "Core Services,,The services everything else runs on,true,true,true,ONE_DECIMAL,List,,,,",
  "API,Core Services,,true,true,false,,List,,,,",
  '"Regional Availability",,,true,true,false,,Grid,Service,"Auth, API, Database",Region,"US-East, EU-West"',
].join("\n");

// The grid layout columns, which only mean anything when viewMode is Grid.
const GRID_ONLY_COLUMNS: Array<string> = [
  "rowAxisLabel",
  "rowAxisValues",
  "columnAxisLabel",
  "columnAxisValues",
];

interface CsvRecord {
  // 1-based line the record starts on (quoted fields may span lines).
  line: number;
  cells: Array<string>;
}

interface CsvLexResult {
  records: Array<CsvRecord>;
  errors: Array<StatusPageGroupCsvError>;
}

/*
 * Character-level CSV lexer: quoted fields ("" escapes a quote), commas
 * and newlines inside quotes, CRLF and LF record separators. Blank
 * records are dropped.
 */
function lexCsv(text: string): CsvLexResult {
  const records: Array<CsvRecord> = [];
  const errors: Array<StatusPageGroupCsvError> = [];

  let cells: Array<string> = [];
  let current: string = "";
  let inQuotes: boolean = false;
  let cellHadQuotes: boolean = false;
  let line: number = 1;
  let recordStartLine: number = 1;

  const endCell: VoidFunction = (): void => {
    // Quoted cells keep their exact content; bare cells are trimmed.
    cells.push(cellHadQuotes ? current : current.trim());
    current = "";
    cellHadQuotes = false;
  };

  const endRecord: VoidFunction = (): void => {
    endCell();
    const isBlank: boolean = cells.every((cell: string) => {
      return cell === "";
    });
    if (!isBlank) {
      records.push({ line: recordStartLine, cells: cells });
    }
    cells = [];
  };

  for (let i: number = 0; i < text.length; i++) {
    const char: string = text[i]!;
    const nextChar: string | undefined = text[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        if (char === "\n") {
          line++;
        }
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      cellHadQuotes = true;
    } else if (char === ",") {
      endCell();
    } else if (char === "\r" && nextChar === "\n") {
      // CRLF — consume both, one record separator.
      i++;
      line++;
      endRecord();
      recordStartLine = line;
    } else if (char === "\n" || char === "\r") {
      line++;
      endRecord();
      recordStartLine = line;
    } else {
      current += char;
    }
  }

  if (inQuotes) {
    errors.push({
      line: recordStartLine,
      message: "Unterminated quoted field — a closing quote is missing.",
    });
    return { records: records, errors: errors };
  }

  // Flush the trailing record (files often end without a newline).
  endRecord();

  return { records: records, errors: errors };
}

type HeaderIndex = Map<string, number>;

function parseHeader(
  record: CsvRecord,
  errors: Array<StatusPageGroupCsvError>,
): HeaderIndex | null {
  const canonicalByLowercase: Map<string, string> = new Map<string, string>(
    STATUS_PAGE_GROUP_CSV_COLUMNS.map((column: string) => {
      return [column.toLowerCase(), column];
    }),
  );

  const headerIndex: HeaderIndex = new Map<string, number>();
  let hasErrors: boolean = false;

  record.cells.forEach((cell: string, index: number) => {
    const canonical: string | undefined = canonicalByLowercase.get(
      cell.trim().toLowerCase(),
    );
    if (!canonical) {
      errors.push({
        line: record.line,
        message: `Unknown column "${cell.trim()}" in header. Expected columns: ${STATUS_PAGE_GROUP_CSV_COLUMNS.join(
          ", ",
        )}.`,
      });
      hasErrors = true;
      return;
    }
    if (headerIndex.has(canonical)) {
      errors.push({
        line: record.line,
        message: `Duplicate column "${canonical}" in header.`,
      });
      hasErrors = true;
      return;
    }
    headerIndex.set(canonical, index);
  });

  for (const required of REQUIRED_COLUMNS) {
    if (!headerIndex.has(required)) {
      errors.push({
        line: record.line,
        message: `Missing required column "${required}" in header.`,
      });
      hasErrors = true;
    }
  }

  return hasErrors ? null : headerIndex;
}

function cellAt(
  record: CsvRecord,
  headerIndex: HeaderIndex,
  column: string,
): string {
  const index: number | undefined = headerIndex.get(column);
  if (index === undefined) {
    return "";
  }
  // The lexer already trimmed bare cells; quoted cells keep their spacing.
  return record.cells[index] || "";
}

interface BooleanParseResult {
  value: boolean | undefined;
  error: string | null;
}

const TRUE_WORDS: Array<string> = ["true", "yes", "y", "1"];
const FALSE_WORDS: Array<string> = ["false", "no", "n", "0"];

/*
 * Spreadsheets export booleans in whatever the author typed, so all the
 * spellings a human would reach for are accepted. Anything else is an error
 * rather than a silent false — "off" quietly becoming "expanded" is exactly
 * the kind of surprise a bulk import must not spring on somebody.
 */
function parseBoolean(raw: string, column: string): BooleanParseResult {
  const value: string = raw.trim().toLowerCase();

  if (value === "") {
    return { value: undefined, error: null };
  }
  if (TRUE_WORDS.includes(value)) {
    return { value: true, error: null };
  }
  if (FALSE_WORDS.includes(value)) {
    return { value: false, error: null };
  }

  return {
    value: undefined,
    error: `${column} "${raw.trim()}" is not a true/false value. Use true or false (yes/no and 1/0 also work).`,
  };
}

/*
 * Enum cells are matched on letters and digits alone, so a project can write
 * "One Decimal", "one-decimal", "ONE_DECIMAL" or the precision's own display
 * value and mean the same thing.
 */
function normalizeEnumCell(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface EnumParseResult<TEnumValue> {
  value: TEnumValue | undefined;
  error: string | null;
}

function parseEnumCell<TEnumValue extends string>(data: {
  raw: string;
  column: string;
  // The enum object itself — both its keys and its values are accepted.
  enumObject: Record<string, TEnumValue>;
}): EnumParseResult<TEnumValue> {
  if (data.raw.trim() === "") {
    return { value: undefined, error: null };
  }

  const byNormalized: Map<string, TEnumValue> = new Map<string, TEnumValue>();

  for (const key of Object.keys(data.enumObject)) {
    const value: TEnumValue = data.enumObject[key]!;
    // Values win over keys where the two normalize to the same string.
    byNormalized.set(normalizeEnumCell(key), value);
    byNormalized.set(normalizeEnumCell(value), value);
  }

  const matched: TEnumValue | undefined = byNormalized.get(
    normalizeEnumCell(data.raw),
  );

  if (matched === undefined) {
    return {
      value: undefined,
      error: `Unknown ${data.column} "${data.raw.trim()}". Valid values: ${Object.keys(
        data.enumObject,
      ).join(", ")}.`,
    };
  }

  return { value: matched, error: null };
}

/*
 * Parse a Status Page Groups CSV. Rows that fail validation are reported and
 * dropped; the rows around them still import, so one bad line never costs the
 * whole file.
 */
export function parseStatusPageGroupCsv(
  text: string,
): StatusPageGroupCsvParseResult {
  const errors: Array<StatusPageGroupCsvError> = [];
  const rows: Array<ParsedStatusPageGroupRow> = [];

  const { records, errors: lexErrors } = lexCsv(text);
  errors.push(...lexErrors);
  if (lexErrors.length > 0) {
    return { rows: [], errors: errors };
  }

  if (records.length === 0) {
    errors.push({ line: 0, message: "The CSV is empty." });
    return { rows: [], errors: errors };
  }

  const headerRecord: CsvRecord = records[0]!;
  const headerIndex: HeaderIndex | null = parseHeader(headerRecord, errors);
  if (!headerIndex) {
    return { rows: [], errors: errors };
  }

  const dataRecords: Array<CsvRecord> = records.slice(1);
  if (dataRecords.length === 0) {
    errors.push({
      line: 0,
      message: "The CSV has a header but no data rows.",
    });
    return { rows: [], errors: errors };
  }

  // name -> line of first use, for duplicate flagging.
  const firstLineByName: Map<string, number> = new Map<string, number>();

  for (const record of dataRecords) {
    const rowErrors: Array<string> = [];

    if (record.cells.length > headerRecord.cells.length) {
      errors.push({
        line: record.line,
        message: `Row has ${record.cells.length} values but the header has ${headerRecord.cells.length} columns.`,
      });
      continue;
    }

    const name: string = cellAt(record, headerIndex, "name");
    if (name === "") {
      rowErrors.push("name is required.");
    }

    const parentName: string = cellAt(record, headerIndex, "parentName");
    if (name !== "" && parentName === name) {
      rowErrors.push("A group cannot be its own parent.");
    }

    const description: string = cellAt(record, headerIndex, "description");

    const isExpandedByDefault: BooleanParseResult = parseBoolean(
      cellAt(record, headerIndex, "isExpandedByDefault"),
      "isExpandedByDefault",
    );
    const showCurrentStatus: BooleanParseResult = parseBoolean(
      cellAt(record, headerIndex, "showCurrentStatus"),
      "showCurrentStatus",
    );
    const showUptimePercent: BooleanParseResult = parseBoolean(
      cellAt(record, headerIndex, "showUptimePercent"),
      "showUptimePercent",
    );

    for (const result of [
      isExpandedByDefault,
      showCurrentStatus,
      showUptimePercent,
    ]) {
      if (result.error) {
        rowErrors.push(result.error);
      }
    }

    const uptimePercentPrecision: EnumParseResult<UptimePrecision> =
      parseEnumCell<UptimePrecision>({
        raw: cellAt(record, headerIndex, "uptimePercentPrecision"),
        column: "uptimePercentPrecision",
        enumObject: UptimePrecision as unknown as Record<
          string,
          UptimePrecision
        >,
      });
    if (uptimePercentPrecision.error) {
      rowErrors.push(uptimePercentPrecision.error);
    }

    const viewMode: EnumParseResult<StatusPageGroupViewMode> =
      parseEnumCell<StatusPageGroupViewMode>({
        raw: cellAt(record, headerIndex, "viewMode"),
        column: "viewMode",
        enumObject: StatusPageGroupViewMode as unknown as Record<
          string,
          StatusPageGroupViewMode
        >,
      });
    if (viewMode.error) {
      rowErrors.push(viewMode.error);
    }

    const rowAxisLabel: string = cellAt(record, headerIndex, "rowAxisLabel");
    const rowAxisValues: string = cellAt(record, headerIndex, "rowAxisValues");
    const columnAxisLabel: string = cellAt(
      record,
      headerIndex,
      "columnAxisLabel",
    );
    const columnAxisValues: string = cellAt(
      record,
      headerIndex,
      "columnAxisValues",
    );

    /*
     * The axis columns are only read when the group renders as a grid. A row
     * that fills them in on a List group has said two contradictory things,
     * and importing it would drop the axes on the floor without a word — so
     * it is an error the author can see and fix in the preview.
     */
    if (!viewMode.error && viewMode.value !== StatusPageGroupViewMode.Grid) {
      const suppliedGridColumns: Array<string> = GRID_ONLY_COLUMNS.filter(
        (column: string) => {
          return cellAt(record, headerIndex, column).trim() !== "";
        },
      );

      if (suppliedGridColumns.length > 0) {
        rowErrors.push(
          `${suppliedGridColumns.join(
            ", ",
          )} only applies when viewMode is ${StatusPageGroupViewMode.Grid}.`,
        );
      }
    }

    if (name !== "") {
      const firstLine: number | undefined = firstLineByName.get(name);
      if (firstLine !== undefined) {
        rowErrors.push(
          `Duplicate group name "${name}" (first used on line ${firstLine}).`,
        );
      } else {
        firstLineByName.set(name, record.line);
      }
    }

    if (rowErrors.length > 0) {
      for (const message of rowErrors) {
        errors.push({ line: record.line, message: message });
      }
      continue;
    }

    rows.push({
      line: record.line,
      name: name,
      parentName: parentName,
      description: description,
      isExpandedByDefault: isExpandedByDefault.value,
      showCurrentStatus: showCurrentStatus.value,
      showUptimePercent: showUptimePercent.value,
      /*
       * The create form makes the precision required the moment uptime is
       * shown, and defaults it to one decimal. A CSV that asks for the
       * percent without naming a precision means the same thing.
       */
      uptimePercentPrecision:
        uptimePercentPrecision.value ??
        (showUptimePercent.value === true
          ? UptimePrecision.ONE_DECIMAL
          : undefined),
      viewMode: viewMode.value,
      rowAxisLabel: rowAxisLabel,
      rowAxisValues: rowAxisValues,
      columnAxisLabel: columnAxisLabel,
      columnAxisValues: columnAxisValues,
    });
  }

  return { rows: rows, errors: errors };
}

/*
 * A group that is already on this status page. Imported rows may name one as
 * their parent, and a row whose name collides with one cannot be created —
 * `name` is unique per status page.
 */
export interface ExistingStatusPageGroup {
  id: string;
  name: string;
  // 0 for a top level group.
  depth: number;
}

export interface SkippedStatusPageGroupRow {
  row: ParsedStatusPageGroupRow;
  reason: string;
}

export interface StatusPageGroupImportPlan {
  /*
   * Rows grouped into creation batches in dependency order: batch 0 is
   * every row whose parent is empty or already exists, batch 1 the rows
   * whose parent is created by batch 0, and so on.
   */
  batches: Array<Array<ParsedStatusPageGroupRow>>;
  // Rows that can never be created, with a human-readable reason.
  skipped: Array<SkippedStatusPageGroupRow>;
}

/*
 * Order parsed rows for creation. Parent references resolve against the
 * groups already on the status page plus the names created by earlier
 * batches; anything left over (missing parent, or a dependency cycle) is
 * skipped with a reason.
 *
 * Two other rows can never be created, and both are cheaper to catch here
 * than to send and have rejected: a name that collides with a group already
 * on the page, and a row that would sit deeper than the nesting limit
 * StatusPageGroupService enforces.
 */
export function planStatusPageGroupImport(
  rows: Array<ParsedStatusPageGroupRow>,
  existingGroups: Array<ExistingStatusPageGroup>,
): StatusPageGroupImportPlan {
  const depthByName: Map<string, number> = new Map<string, number>();
  for (const group of existingGroups) {
    depthByName.set(group.name, group.depth);
  }

  const skipped: Array<SkippedStatusPageGroupRow> = [];
  let pending: Array<ParsedStatusPageGroupRow> = [];

  for (const row of rows) {
    if (depthByName.has(row.name)) {
      skipped.push({
        row: row,
        reason: `A group named "${row.name}" already exists on this status page.`,
      });
    } else {
      pending.push(row);
    }
  }

  const batches: Array<Array<ParsedStatusPageGroupRow>> = [];

  while (pending.length > 0) {
    const batch: Array<ParsedStatusPageGroupRow> = [];
    const remaining: Array<ParsedStatusPageGroupRow> = [];
    // Depths resolved this round, applied only once the round is decided.
    const depthsFromBatch: Array<[string, number]> = [];

    for (const row of pending) {
      if (row.parentName === "") {
        batch.push(row);
        depthsFromBatch.push([row.name, 0]);
        continue;
      }

      const parentDepth: number | undefined = depthByName.get(row.parentName);

      if (parentDepth === undefined) {
        remaining.push(row);
        continue;
      }

      const depth: number = parentDepth + 1;

      if (depth >= MAX_GROUP_NESTING_DEPTH) {
        /*
         * Skipped rather than batched, so its own children fall out as
         * "parent was not found" rather than being sent and rejected one by
         * one at the same depth.
         */
        skipped.push({
          row: row,
          reason: `Nesting "${row.name}" under "${row.parentName}" would be more than ${MAX_GROUP_NESTING_DEPTH} levels deep.`,
        });
        continue;
      }

      batch.push(row);
      depthsFromBatch.push([row.name, depth]);
    }

    /*
     * Before the progress check, and unconditionally: a row skipped inside
     * this round is in neither list, and leaving it in `pending` would have
     * the leftover pass report it a second time under a different reason.
     */
    pending = remaining;

    if (batch.length === 0) {
      /*
       * No progress. Nothing new can become resolvable — a skip adds no
       * names — so every row still pending is unreachable.
       */
      break;
    }

    for (const [name, depth] of depthsFromBatch) {
      depthByName.set(name, depth);
    }

    batches.push(batch);
  }

  /*
   * Whatever is left is unreachable. Its parent is either a row this file
   * never got to create (too deep, or itself unreachable, or one half of a
   * cycle) or a name that exists nowhere at all — and the two want different
   * things from the reader, so they are told apart rather than lumped into
   * one "not found".
   */
  const namesInFile: Set<string> = new Set<string>(
    rows.map((row: ParsedStatusPageGroupRow) => {
      return row.name;
    }),
  );

  for (const row of pending) {
    skipped.push({
      row: row,
      reason: namesInFile.has(row.parentName)
        ? `Parent group "${row.parentName}" could not be created.`
        : `Parent group "${row.parentName}" was not found in the file or on this status page.`,
    });
  }

  return { batches: batches, skipped: skipped };
}
