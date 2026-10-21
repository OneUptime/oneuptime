import { redactDatabaseQueryText } from "../../Common/Utils/AiRemediation/Resource/DatabaseQueryRedactor";

/*
 * What a `db` command prints. The diagnostics describe their answer as
 * sections — a table, name/value fields, one record per row, raw text or a
 * JSON document — and this module renders them, the same way for every
 * engine:
 *
 *   - a table: UPPERCASE headers, columns aligned with three spaces, the
 *     LAST column unpadded and uncut up to MAX_LAST_CELL_CHARS. Query text is
 *     always the last column: the redactor normalizes a statement from where
 *     it starts to the end of its line, so nothing after it can be masked by
 *     accident, and nothing in it can escape;
 *   - query text is normalized here already (redactDatabaseQueryText: every
 *     string and number literal becomes ?), before it is cut or joined onto
 *     one line, and then once more by the output redactor — so a statement
 *     that does not start with a keyword (a comment, "autovacuum: ...") is
 *     masked too;
 *   - every value is one line: control characters become spaces, NUL never
 *     survives, long values are cut with "...";
 *   - `json` renders the same sections as one JSON document (for a catalog
 *     that offers --format json), with query text normalized the same way.
 *
 * Nothing here throws on odd values: an object prints as compact JSON, a
 * Buffer as its size, a Date as ISO 8601, a bigint as digits.
 */

export type CellKind = "text" | "query" | "json";

export interface OutputColumn {
  // The row's key.
  key: string;
  // The header ("PID"); the key uppercased when absent.
  header?: string | undefined;
  // How its values print; "text" when absent.
  kind?: CellKind | undefined;
}

export type OutputSection =
  | {
      kind: "table";
      title?: string | undefined;
      columns: Array<OutputColumn>;
      rows: Array<Record<string, unknown>>;
      // Printed instead of the table when there are no rows.
      emptyText?: string | undefined;
    }
  | {
      kind: "records";
      title?: string | undefined;
      columns: Array<OutputColumn>;
      rows: Array<Record<string, unknown>>;
      emptyText?: string | undefined;
    }
  | {
      kind: "fields";
      title?: string | undefined;
      fields: Array<{ name: string; value: unknown; kind?: CellKind }>;
    }
  | { kind: "text"; title?: string | undefined; text: string }
  | { kind: "json"; title?: string | undefined; value: unknown }
  | { kind: "note"; text: string };

export type OutputFormat = "table" | "json";

// Every cell but the last of a table row: kept short so columns stay readable.
export const MAX_CELL_CHARS: number = 64;
// The last cell of a table row, a field's or a record's value, a JSON cell.
export const MAX_LAST_CELL_CHARS: number = 1_000;
// A text section, or a JSON document (the output cap still applies after).
export const MAX_TEXT_SECTION_CHARS: number = 200_000;

const COLUMN_GAP: string = "   ";
const EMPTY_CELL: string = "-";
const ELLIPSIS: string = "...";

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS: RegExp = /[\u0000-\u001f\u007f]+/g;
const CONTROL_CHARACTERS_BUT_NEWLINE: RegExp =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b-\u001f\u007f]/g;
const WHITESPACE_RUN: RegExp = /\s+/g;

function cut(text: string, maxChars: number): string {
  return text.length > maxChars
    ? `${text.slice(0, Math.max(0, maxChars - ELLIPSIS.length))}${ELLIPSIS}`
    : text;
}

// JSON.stringify that never throws: bigint as digits, cycles as "[circular]".
export function safeJson(value: unknown, indent?: number): string {
  const seen: WeakSet<Record<string, unknown>> = new WeakSet<
    Record<string, unknown>
  >();

  try {
    const text: string | undefined = JSON.stringify(
      value,
      (_key: string, entry: unknown): unknown => {
        if (typeof entry === "bigint") {
          return entry.toString();
        }

        if (entry && typeof entry === "object") {
          if (Buffer.isBuffer(entry)) {
            return `<${entry.length} bytes>`;
          }

          // A Buffer reaches the replacer already through its toJSON().
          const record: Record<string, unknown> = entry as Record<
            string,
            unknown
          >;

          if (record["type"] === "Buffer" && Array.isArray(record["data"])) {
            return `<${record["data"].length} bytes>`;
          }

          if (seen.has(record)) {
            return "[circular]";
          }

          seen.add(record);
        }

        return entry;
      },
      indent,
    );

    return text === undefined ? "" : text;
  } catch {
    return "[unprintable]";
  }
}

/*
 * A (JSON-safe) value as text: strings as they are, dates as ISO 8601,
 * buffers as their size, objects as compact JSON.
 */
export function valueToText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `<${value.length} bytes>`;
  }

  return safeJson(value);
}

// Normalize statement text: literals become ?, as pg_stat_statements prints them.
export function normalizeQueryText(value: unknown): string {
  const text: string = valueToText(value);

  if (!text) {
    return "";
  }

  try {
    return redactDatabaseQueryText(text);
  } catch {
    return "[query text withheld: it could not be normalized]";
  }
}

// One cell as one line: normalized (query), flattened, cut.
export function formatCell(
  value: unknown,
  kind: CellKind,
  maxChars: number,
): string {
  if (value === null || value === undefined || value === "") {
    return EMPTY_CELL;
  }

  const text: string =
    kind === "query" ? normalizeQueryText(value) : valueToText(value);

  const flat: string = text
    .replace(CONTROL_CHARACTERS, " ")
    .replace(WHITESPACE_RUN, " ")
    .trim();

  return flat ? cut(flat, maxChars) : EMPTY_CELL;
}

function headerOf(column: OutputColumn): string {
  return (column.header || column.key).toUpperCase();
}

function renderTable(
  columns: Array<OutputColumn>,
  rows: Array<Record<string, unknown>>,
): string {
  const cells: Array<Array<string>> = rows.map(
    (row: Record<string, unknown>): Array<string> => {
      return columns.map((column: OutputColumn, index: number): string => {
        return formatCell(
          row[column.key],
          column.kind || "text",
          index === columns.length - 1 ? MAX_LAST_CELL_CHARS : MAX_CELL_CHARS,
        );
      });
    },
  );

  const headers: Array<string> = columns.map(headerOf);
  const widths: Array<number> = headers.map(
    (header: string, index: number): number => {
      return Math.max(
        header.length,
        ...cells.map((line: Array<string>): number => {
          return (line[index] || "").length;
        }),
      );
    },
  );

  const renderLine: (line: Array<string>) => string = (
    line: Array<string>,
  ): string => {
    return line
      .map((cell: string, index: number): string => {
        return index === line.length - 1
          ? cell
          : cell.padEnd(widths[index] || 0);
      })
      .join(COLUMN_GAP)
      .trimEnd();
  };

  return [renderLine(headers), ...cells.map(renderLine)].join("\n");
}

function renderFields(
  fields: Array<{ name: string; value: unknown; kind?: CellKind }>,
): string {
  const width: number = Math.max(
    0,
    ...fields.map((field: { name: string }): number => {
      return field.name.length + 1;
    }),
  );

  return fields
    .map((field: { name: string; value: unknown; kind?: CellKind }): string => {
      return `${`${field.name}:`.padEnd(width)} ${formatCell(
        field.value,
        field.kind || "text",
        MAX_LAST_CELL_CHARS,
      )}`;
    })
    .join("\n");
}

function renderRecords(
  columns: Array<OutputColumn>,
  rows: Array<Record<string, unknown>>,
): string {
  return rows
    .map((row: Record<string, unknown>, index: number): string => {
      return `[${index + 1}]\n${renderFields(
        columns.map(
          (
            column: OutputColumn,
          ): { name: string; value: unknown; kind: CellKind } => {
            return {
              name: `  ${column.header || column.key}`,
              value: row[column.key],
              kind: column.kind || "text",
            };
          },
        ),
      )}`;
    })
    .join("\n\n");
}

// A text section: its lines kept, control characters (but tabs and newlines) dropped.
function renderText(text: string): string {
  return cut(
    text.replace(/\r\n?/g, "\n").replace(CONTROL_CHARACTERS_BUT_NEWLINE, ""),
    MAX_TEXT_SECTION_CHARS,
  ).trimEnd();
}

function renderSectionBody(section: OutputSection): string {
  switch (section.kind) {
    case "table":
      return section.rows.length === 0
        ? section.emptyText || "(no rows)"
        : renderTable(section.columns, section.rows);
    case "records":
      return section.rows.length === 0
        ? section.emptyText || "(no rows)"
        : renderRecords(section.columns, section.rows);
    case "fields":
      return renderFields(section.fields);
    case "text":
      return renderText(section.text) || "(empty)";
    case "json":
      return renderText(safeJson(section.value, 2));
    case "note":
      return renderText(section.text);
    default:
      return "";
  }
}

// The sections as text: each under its title, one blank line apart.
export function renderSectionsAsText(sections: Array<OutputSection>): string {
  return sections
    .map((section: OutputSection): string => {
      const body: string = renderSectionBody(section);
      const title: string | undefined =
        section.kind === "note" ? undefined : section.title;

      return title ? `${title}:\n${body}` : body;
    })
    .join("\n\n");
}

// A row's values as JSON: query text normalized, everything JSON-safe.
function rowToJson(
  columns: Array<OutputColumn>,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const column of columns) {
    const value: unknown = row[column.key];

    if (value === undefined) {
      out[column.key] = null;
    } else if (column.kind === "query") {
      out[column.key] = value === null ? null : normalizeQueryText(value);
    } else if (value instanceof Date || Buffer.isBuffer(value)) {
      out[column.key] = valueToText(value);
    } else if (typeof value === "bigint") {
      out[column.key] = value.toString();
    } else {
      out[column.key] = value;
    }
  }

  return out;
}

/*
 * The sections as one JSON document. Never keyed "data" at the top: the
 * output redactor reads a top-level data object as a Kubernetes Secret.
 */
export function renderSectionsAsJson(data: {
  operation: string;
  engine: string;
  sections: Array<OutputSection>;
}): string {
  const sections: Array<Record<string, unknown>> = data.sections.map(
    (section: OutputSection): Record<string, unknown> => {
      switch (section.kind) {
        case "table":
        case "records":
          return {
            title: section.title || null,
            rows: section.rows.map(
              (row: Record<string, unknown>): Record<string, unknown> => {
                return rowToJson(section.columns, row);
              },
            ),
          };
        case "fields": {
          const fields: Record<string, unknown> = {};

          for (const field of section.fields) {
            fields[field.name] =
              field.kind === "query"
                ? normalizeQueryText(field.value)
                : field.value instanceof Date || Buffer.isBuffer(field.value)
                  ? valueToText(field.value)
                  : field.value;
          }

          return { title: section.title || null, fields };
        }
        case "text":
          return { title: section.title || null, text: section.text };
        case "json":
          return { title: section.title || null, document: section.value };
        case "note":
          return { note: section.text };
        default:
          return {};
      }
    },
  );

  return renderText(
    safeJson({ operation: data.operation, engine: data.engine, sections }, 2),
  );
}

export function renderSections(data: {
  format: OutputFormat;
  operation: string;
  engine: string;
  sections: Array<OutputSection>;
}): string {
  return data.format === "json"
    ? renderSectionsAsJson(data)
    : renderSectionsAsText(data.sections);
}

/*
 * The first `limit` rows, and a note when the query found more (every
 * listing asks its server for limit + 1 rows to know).
 */
export function limitRows<T>(
  rows: Array<T>,
  limit: number,
  hint: string,
): { rows: Array<T>; note: OutputSection | null } {
  if (rows.length <= limit) {
    return { rows, note: null };
  }

  return {
    rows: rows.slice(0, limit),
    note: {
      kind: "note",
      text: `Showing the first ${limit} rows; there are more. ${hint}`,
    },
  };
}

// A byte count as people read it ("1.5 GiB"); "" for a non-number.
export function formatBytes(value: unknown): string {
  const bytes: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }

  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let size: number = bytes;
  let unit: number = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }

  return unit === 0
    ? `${Math.round(size)} ${units[0]}`
    : `${size.toFixed(1)} ${units[unit]}`;
}

/*
 * A MongoDB command document as a query shape: every key kept, the command
 * name's own value kept (the collection), every other value replaced by
 * "?" — a filter's values are customers' data, the way a SQL literal is.
 */
export function mongoCommandShape(
  command: unknown,
  depth: number = 0,
): unknown {
  if (depth > 12) {
    return "?";
  }

  if (Array.isArray(command)) {
    return command.map((entry: unknown): unknown => {
      return mongoCommandShape(entry, depth + 1);
    });
  }

  if (command && typeof command === "object") {
    const shaped: Record<string, unknown> = {};
    const entries: Array<[string, unknown]> = Object.entries(
      command as Record<string, unknown>,
    );

    entries.forEach(([key, value]: [string, unknown], index: number): void => {
      if (
        depth === 0 &&
        (index === 0 || key === "$db") &&
        typeof value === "string"
      ) {
        // The command's target (find: "orders") and its database.
        shaped[key] = value;
        return;
      }

      shaped[key] = mongoCommandShape(value, depth + 1);
    });

    return shaped;
  }

  return command === null || command === undefined ? command : "?";
}
