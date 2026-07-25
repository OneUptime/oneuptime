import { VoidFunction } from "Common/Types/FunctionTypes";

/*
 * Pure CSV parsing + import planning for the Network Sites bulk import
 * page. React-free on purpose: this module must never import RouteMap or
 * Config (they touch window at module load), so it stays testable from
 * the node-env jest suite in App/Tests/Dashboard.
 *
 * Expected CSV columns (header row required, any order, case-insensitive):
 *   name,siteType,parentName,address,latitude,longitude
 *
 * The siteType cell is validated against the PROJECT's configured site
 * types, which the caller passes in — they are NetworkSiteType rows now,
 * not a fixed enum, so this module cannot know the valid values on its own
 * and must never hardcode them.
 */

/*
 * A project's configured site type, reduced to what resolution needs: the
 * id every imported site is pointed at, and the name the CSV cell is
 * matched against (case-insensitively).
 */
export interface NetworkSiteTypeOption {
  id: string;
  name: string;
}

export interface ParsedSiteRow {
  // 1-based line number in the CSV where this row starts.
  line: number;
  name: string;
  /*
   * The resolved NetworkSiteType — the id is what gets written to the site,
   * the name is the configured type's canonical spelling (not the cell's
   * casing) and exists only so the preview table can show it.
   */
  networkSiteTypeId: string;
  siteType: string;
  // Empty string for root sites.
  parentName: string;
  address: string;
  latitude: number | undefined;
  longitude: number | undefined;
}

export interface SiteCsvError {
  // 1-based line the error belongs to; 0 for file-level errors.
  line: number;
  message: string;
}

export interface SiteCsvParseResult {
  rows: Array<ParsedSiteRow>;
  errors: Array<SiteCsvError>;
}

export const SITE_CSV_COLUMNS: Array<string> = [
  "name",
  "siteType",
  "parentName",
  "address",
  "latitude",
  "longitude",
];

const REQUIRED_COLUMNS: Array<string> = ["name", "siteType"];

interface CsvRecord {
  // 1-based line the record starts on (quoted fields may span lines).
  line: number;
  cells: Array<string>;
}

interface CsvLexResult {
  records: Array<CsvRecord>;
  errors: Array<SiteCsvError>;
}

/*
 * Character-level CSV lexer: quoted fields ("" escapes a quote), commas
 * and newlines inside quotes, CRLF and LF record separators. Blank
 * records are dropped.
 */
function lexCsv(text: string): CsvLexResult {
  const records: Array<CsvRecord> = [];
  const errors: Array<SiteCsvError> = [];

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

/*
 * Index the project's configured types by lowercased name so cells match
 * case-insensitively. First definition wins on a case-only collision — the
 * name column is unique per project, so that is a degenerate case anyway,
 * and either row is an equally correct answer.
 */
function indexSiteTypesByLowercaseName(
  siteTypes: Array<NetworkSiteTypeOption>,
): Map<string, NetworkSiteTypeOption> {
  const byLowercaseName: Map<string, NetworkSiteTypeOption> = new Map<
    string,
    NetworkSiteTypeOption
  >();
  for (const siteType of siteTypes) {
    const key: string = siteType.name.trim().toLowerCase();
    if (key === "" || byLowercaseName.has(key)) {
      continue;
    }
    byLowercaseName.set(key, siteType);
  }
  return byLowercaseName;
}

type HeaderIndex = Map<string, number>;

function parseHeader(
  record: CsvRecord,
  errors: Array<SiteCsvError>,
): HeaderIndex | null {
  const canonicalByLowercase: Map<string, string> = new Map<string, string>(
    SITE_CSV_COLUMNS.map((column: string) => {
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
        message: `Unknown column "${cell.trim()}" in header. Expected columns: ${SITE_CSV_COLUMNS.join(
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

interface CoordinateParseResult {
  value: number | undefined;
  error: string | null;
}

function parseCoordinate(
  raw: string,
  label: string,
  min: number,
  max: number,
): CoordinateParseResult {
  if (raw === "") {
    return { value: undefined, error: null };
  }
  const parsed: number = Number(raw);
  if (!isFinite(parsed)) {
    return { value: undefined, error: `${label} "${raw}" is not a number.` };
  }
  if (parsed < min || parsed > max) {
    return {
      value: undefined,
      error: `${label} ${parsed} is out of range (${min} to ${max}).`,
    };
  }
  return { value: parsed, error: null };
}

/*
 * Parse a Network Sites CSV against the project's configured site types.
 * Every siteType cell must resolve to one of `siteTypes`; a project with
 * none configured cannot import at all, which is reported once as a
 * file-level error rather than repeated on every row.
 */
export function parseSiteCsv(
  text: string,
  siteTypes: Array<NetworkSiteTypeOption>,
): SiteCsvParseResult {
  const errors: Array<SiteCsvError> = [];
  const rows: Array<ParsedSiteRow> = [];

  const siteTypeByLowercaseName: Map<string, NetworkSiteTypeOption> =
    indexSiteTypesByLowercaseName(siteTypes);
  const siteTypeNames: Array<string> = Array.from(
    siteTypeByLowercaseName.values(),
  ).map((siteType: NetworkSiteTypeOption) => {
    return siteType.name;
  });

  if (siteTypeNames.length === 0) {
    errors.push({
      line: 0,
      message:
        "This project has no site types configured, so no row can be imported. Add them under Network > Settings > Site Types first.",
    });
    return { rows: [], errors: errors };
  }

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

    const siteTypeRaw: string = cellAt(record, headerIndex, "siteType");
    const siteType: NetworkSiteTypeOption | undefined =
      siteTypeByLowercaseName.get(siteTypeRaw.trim().toLowerCase());
    if (!siteType) {
      rowErrors.push(
        siteTypeRaw === ""
          ? "siteType is required."
          : `Unknown siteType "${siteTypeRaw}". Valid values: ${siteTypeNames.join(
              ", ",
            )}.`,
      );
    }

    const parentName: string = cellAt(record, headerIndex, "parentName");
    if (name !== "" && parentName === name) {
      rowErrors.push("A site cannot be its own parent.");
    }

    const address: string = cellAt(record, headerIndex, "address");

    const latitudeResult: CoordinateParseResult = parseCoordinate(
      cellAt(record, headerIndex, "latitude"),
      "latitude",
      -90,
      90,
    );
    if (latitudeResult.error) {
      rowErrors.push(latitudeResult.error);
    }

    const longitudeResult: CoordinateParseResult = parseCoordinate(
      cellAt(record, headerIndex, "longitude"),
      "longitude",
      -180,
      180,
    );
    if (longitudeResult.error) {
      rowErrors.push(longitudeResult.error);
    }

    if (
      !latitudeResult.error &&
      !longitudeResult.error &&
      (latitudeResult.value === undefined) !==
        (longitudeResult.value === undefined)
    ) {
      rowErrors.push("latitude and longitude must be provided together.");
    }

    if (name !== "") {
      const firstLine: number | undefined = firstLineByName.get(name);
      if (firstLine !== undefined) {
        rowErrors.push(
          `Duplicate site name "${name}" (first used on line ${firstLine}).`,
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
      networkSiteTypeId: siteType!.id,
      siteType: siteType!.name,
      parentName: parentName,
      address: address,
      latitude: latitudeResult.value,
      longitude: longitudeResult.value,
    });
  }

  return { rows: rows, errors: errors };
}

export interface SkippedSiteRow {
  row: ParsedSiteRow;
  reason: string;
}

export interface SiteImportPlan {
  /*
   * Rows grouped into creation batches in dependency order: batch 0 is
   * every row whose parent is empty or already exists, batch 1 the rows
   * whose parent is created by batch 0, and so on.
   */
  batches: Array<Array<ParsedSiteRow>>;
  // Rows that can never be created, with a human-readable reason.
  skipped: Array<SkippedSiteRow>;
}

/*
 * Order parsed rows for creation. Parent references resolve against the
 * project's existing site names plus the names created by earlier
 * batches; anything left over (missing parent, or a dependency cycle) is
 * skipped with a reason. Rows whose name collides with an existing site
 * are skipped up front — the server would reject them anyway.
 */
export function planSiteImport(
  rows: Array<ParsedSiteRow>,
  existingSiteNames: Array<string>,
): SiteImportPlan {
  const existing: Set<string> = new Set<string>(existingSiteNames);

  const skipped: Array<SkippedSiteRow> = [];
  let pending: Array<ParsedSiteRow> = [];

  for (const row of rows) {
    if (existing.has(row.name)) {
      skipped.push({
        row: row,
        reason: `A site named "${row.name}" already exists in this project.`,
      });
    } else {
      pending.push(row);
    }
  }

  const batches: Array<Array<ParsedSiteRow>> = [];
  const resolvable: Set<string> = new Set<string>(existing);

  while (pending.length > 0) {
    const batch: Array<ParsedSiteRow> = [];
    const remaining: Array<ParsedSiteRow> = [];

    for (const row of pending) {
      if (row.parentName === "" || resolvable.has(row.parentName)) {
        batch.push(row);
      } else {
        remaining.push(row);
      }
    }

    if (batch.length === 0) {
      // No progress — every remaining parent is unresolvable.
      break;
    }

    for (const row of batch) {
      resolvable.add(row.name);
    }
    batches.push(batch);
    pending = remaining;
  }

  for (const row of pending) {
    skipped.push({
      row: row,
      reason: `Parent site "${row.parentName}" was not found in the file or the project.`,
    });
  }

  return { batches: batches, skipped: skipped };
}
