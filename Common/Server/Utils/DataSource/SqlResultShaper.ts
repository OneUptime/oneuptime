import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import DataSourceTableResult, {
  DataSourceTableColumn,
  DataSourceTableColumnType,
} from "../../../Types/DataSource/DataSourceTableResult";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONValue } from "../../../Types/JSON";

/*
 * Shared row → chart/table shaping for every SQL-family connector
 * (PostgreSQL, MySQL, SQL Server, ClickHouse). One implementation means one
 * behavior: the same query against any engine renders the same chart.
 *
 * Time-series convention (Grafana-compatible):
 *  - a TIME column named time / timestamp / date / ts (case-insensitive);
 *  - a numeric VALUE column named value (or the first numeric non-time
 *    column);
 *  - every OTHER column becomes a series label — rows sharing the same
 *    label values merge into one series. The chart layer groups on the
 *    `attributes` object of each data point.
 */

const TIME_COLUMN_NAMES: Array<string> = ["time", "timestamp", "date", "ts"];
const VALUE_COLUMN_NAME: string = "value";

export interface ShapedRows {
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
}

/*
 * A 9-19 digit unsigned integer string — an epoch in seconds through
 * nanoseconds. Shorter numeric strings (bare years, YYYYMMDD) stay on the
 * Date-parse path.
 */
const NUMERIC_EPOCH_STRING_REGEX: RegExp = /^\d{9,19}$/;

export default class SqlResultShaper {
  /*
   * Clamp raw driver rows to the cap. Connectors fetch cap+1 so the shaper
   * can tell "exactly cap" apart from "more than cap".
   */
  public static clampRows(
    rows: Array<Record<string, unknown>>,
    maxRows: number,
  ): ShapedRows {
    if (rows.length > maxRows) {
      return { rows: rows.slice(0, maxRows), truncated: true };
    }
    return { rows: rows, truncated: false };
  }

  /*
   * Copy of the probe SqlMonitor's cell coercion semantics: keep JSON-safe
   * primitives, ISO-ify dates, never ship raw binary.
   */
  public static coerceCell(value: unknown): JSONValue {
    if (value === null || value === undefined) {
      return null;
    }
    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "string"
    ) {
      return value;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (Buffer.isBuffer(value)) {
      return "[binary]";
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private static findTimeColumn(
    columnNames: Array<string>,
  ): string | undefined {
    return columnNames.find((name: string) => {
      return TIME_COLUMN_NAMES.includes(name.toLowerCase());
    });
  }

  private static findValueColumn(
    columnNames: Array<string>,
    timeColumn: string,
    firstRow: Record<string, unknown>,
  ): string | undefined {
    const explicit: string | undefined = columnNames.find((name: string) => {
      return name.toLowerCase() === VALUE_COLUMN_NAME;
    });
    if (explicit) {
      return explicit;
    }
    // First numeric non-time column.
    return columnNames.find((name: string) => {
      if (name === timeColumn) {
        return false;
      }
      const cell: unknown = firstRow[name];
      return (
        typeof cell === "number" ||
        typeof cell === "bigint" ||
        (typeof cell === "string" &&
          cell.trim() !== "" &&
          Number.isFinite(Number(cell)))
      );
    });
  }

  /*
   * Parse a SQL time cell: Date object, ISO-ish string, or epoch number
   * (ms when >= 1e12, seconds when >= 1e9). Returns null when
   * unparseable.
   */
  public static coerceTimestamp(value: unknown): Date | null {
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "number" || typeof value === "bigint") {
      const numeric: number = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
      }
      if (numeric >= 1e12) {
        return new Date(numeric);
      }
      if (numeric >= 1e9) {
        return new Date(numeric * 1000);
      }
      return null;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const trimmed: string = value.trim();
      /*
       * Numeric-string epochs: ClickHouse's JSON format serializes
       * 64-bit integers as strings, and REST payloads routinely quote
       * epoch numbers — route them through the same epoch heuristic as
       * native numbers instead of letting new Date('1700000000000')
       * produce Invalid Date and silently drop the row. 9+ digits only,
       * so short numeric strings (bare years) keep the Date-parse path.
       */
      if (NUMERIC_EPOCH_STRING_REGEX.test(trimmed)) {
        return this.coerceTimestamp(Number(trimmed));
      }
      /*
       * Engines commonly return 'YYYY-MM-DD HH:MM:SS' with no zone —
       * treat it as UTC (the macros are UTC, and Date.parse would
       * otherwise apply the server's local zone).
       */
      const spaceSeparated: RegExpMatchArray | null = trimmed.match(
        /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/,
      );
      const normalized: string = spaceSeparated
        ? `${spaceSeparated[1]}T${spaceSeparated[2]}Z`
        : trimmed;
      const parsed: Date = new Date(normalized);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  private static coerceValue(value: unknown): number | null {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "bigint") {
      return Number(value);
    }
    if (typeof value === "string" && value.trim() !== "") {
      const numeric: number = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }
    return null;
  }

  public static rowsToTimeSeries(
    rows: Array<Record<string, unknown>>,
    options: { maxRows: number },
  ): AggregatedResult {
    const clamped: ShapedRows = this.clampRows(rows, options.maxRows);

    if (clamped.rows.length === 0) {
      return { data: [], truncated: false };
    }

    const firstRow: Record<string, unknown> = clamped.rows[0]!;
    const columnNames: Array<string> = Object.keys(firstRow);

    const timeColumn: string | undefined = this.findTimeColumn(columnNames);
    if (!timeColumn) {
      throw new BadDataException(
        `Time-series queries must return a time column named one of: ${TIME_COLUMN_NAMES.join(
          ", ",
        )}. Got columns: ${columnNames.join(", ")}. Use the Table widget for non-time-series results.`,
      );
    }

    const valueColumn: string | undefined = this.findValueColumn(
      columnNames,
      timeColumn,
      firstRow,
    );
    if (!valueColumn) {
      throw new BadDataException(
        `Time-series queries must return a numeric column (name it "value"). Got columns: ${columnNames.join(
          ", ",
        )}.`,
      );
    }

    const labelColumns: Array<string> = columnNames.filter((name: string) => {
      return name !== timeColumn && name !== valueColumn;
    });

    const data: Array<AggregatedModel> = [];
    for (const row of clamped.rows) {
      const timestamp: Date | null = this.coerceTimestamp(row[timeColumn]);
      const value: number | null = this.coerceValue(row[valueColumn]);
      if (timestamp === null || value === null) {
        continue; // skip unplottable rows rather than failing the chart.
      }

      const point: AggregatedModel = {
        timestamp: timestamp,
        value: value,
      } as AggregatedModel;

      if (labelColumns.length > 0) {
        const attributes: Record<string, string> = {};
        for (const labelColumn of labelColumns) {
          const cell: JSONValue = this.coerceCell(row[labelColumn]);
          attributes[labelColumn] = cell === null ? "(unset)" : String(cell);
        }
        (point as Record<string, unknown>)["attributes"] = attributes;
      }

      data.push(point);
    }

    return { data: data, truncated: clamped.truncated };
  }

  private static sniffColumnType(value: unknown): DataSourceTableColumnType {
    if (typeof value === "number" || typeof value === "bigint") {
      return DataSourceTableColumnType.Number;
    }
    if (typeof value === "boolean") {
      return DataSourceTableColumnType.Boolean;
    }
    if (value instanceof Date) {
      return DataSourceTableColumnType.Date;
    }
    if (value !== null && typeof value === "object") {
      return DataSourceTableColumnType.Json;
    }
    return DataSourceTableColumnType.Text;
  }

  public static rowsToTable(
    rows: Array<Record<string, unknown>>,
    options: { maxRows: number },
  ): DataSourceTableResult {
    const clamped: ShapedRows = this.clampRows(rows, options.maxRows);

    if (clamped.rows.length === 0) {
      return { columns: [], rows: [], truncated: false };
    }

    /*
     * Column set = union across rows (drivers can omit NULL columns in
     * some row formats); type sniffed from the first non-null cell.
     */
    const columnNames: Array<string> = [];
    for (const row of clamped.rows) {
      for (const name of Object.keys(row)) {
        if (!columnNames.includes(name)) {
          columnNames.push(name);
        }
      }
    }

    const columns: Array<DataSourceTableColumn> = columnNames.map(
      (name: string) => {
        const sampleRow: Record<string, unknown> | undefined =
          clamped.rows.find((row: Record<string, unknown>) => {
            return row[name] !== null && row[name] !== undefined;
          });
        return {
          key: name,
          title: name,
          type: this.sniffColumnType(sampleRow ? sampleRow[name] : null),
        };
      },
    );

    const shapedRows: Array<{ [key: string]: JSONValue }> = clamped.rows.map(
      (row: Record<string, unknown>) => {
        const shaped: { [key: string]: JSONValue } = {};
        for (const name of columnNames) {
          shaped[name] = this.coerceCell(row[name]);
        }
        return shaped;
      },
    );

    return {
      columns: columns,
      rows: shapedRows,
      truncated: clamped.truncated,
    };
  }

  /*
   * Redact credentials and connection internals from driver errors before
   * they reach API responses (probe SqlMonitor semantics).
   */
  /*
   * Every user-supplied credential on a connection-settings object,
   * including custom header VALUES (write-only in the model, so they can
   * carry tokens) — the standard secret list for sanitizeError so no
   * connector forgets one.
   */
  public static collectSecrets(settings: {
    password?: string | undefined;
    apiToken?: string | undefined;
    username?: string | undefined;
    databaseHost?: string | undefined;
    customHeaders?: Record<string, string> | undefined;
  }): Array<string | undefined> {
    return [
      settings.password,
      settings.apiToken,
      settings.username,
      settings.databaseHost,
      ...Object.values(settings.customHeaders || {}),
    ];
  }

  public static sanitizeError(
    error: unknown,
    secrets: Array<string | undefined>,
  ): string {
    let message: string =
      error instanceof Error ? error.message : String(error);

    for (const secret of secrets) {
      if (secret && secret.length >= 4) {
        message = message.split(secret).join("***");
      }
    }

    // DSNs with embedded credentials.
    message = message.replace(/[a-zA-Z]+:\/\/[^\s]*@[^\s]*/g, "[redacted-dsn]");
    // Connection-string password pairs.
    message = message.replace(
      /(password|pwd)\s*[=:]\s*(\{[^}]*\}|"[^"]*"|'[^']*'|[^;\r\n]+)/gi,
      "$1=***",
    );

    return message;
  }
}
