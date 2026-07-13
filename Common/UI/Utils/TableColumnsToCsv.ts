import Column from "../Components/Table/Types/Column";
import Columns from "../Components/Table/Types/Columns";
import FieldType from "../Components/Types/FieldType";
import GenericObject from "../../Types/GenericObject";
import OneUptimeDate from "../../Types/Date";

/*
 * Converts the rows currently rendered in a table (or a bulk-selected subset of
 * them) into a CSV file using the table's own column definitions. The goal is
 * to export "what you see": one column per visible table column, formatted the
 * same way the table renders it (dates, booleans, currency, etc).
 *
 * The value extraction is deliberately model-agnostic so the same utility works
 * for:
 *  - DatabaseBaseModel instances (column values are stored as direct
 *    properties, so falsy values like false / 0 / "" are preserved).
 *  - AnalyticsBaseModel instances (column values live in an internal map that
 *    is only reachable through getColumnValue()).
 *  - Plain objects used by LocalTable.
 */
export default class TableColumnsToCsv {
  /*
   * Escapes a single CSV field per RFC 4180 - wraps the value in double quotes
   * and doubles any embedded quotes when it contains a comma, quote, or
   * newline.
   */
  public static escapeCsvValue(value: string): string {
    const needsQuoting: boolean =
      value.includes(",") ||
      value.includes('"') ||
      value.includes("\n") ||
      value.includes("\r");

    if (needsQuoting) {
      return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
  }

  /*
   * Neutralizes spreadsheet formula injection. A field that begins with "=",
   * "+", "@", or a leading control character can be executed as a formula when
   * the CSV is opened in Excel / Google Sheets. Prefixing such a value with a
   * single quote makes the spreadsheet treat it as literal text. A leading "-"
   * is intentionally left untouched so negative numbers are not corrupted.
   */
  public static sanitizeForCsvInjection(value: string): string {
    if (value.length === 0) {
      return value;
    }

    const firstChar: string = value.charAt(0);

    if (
      firstChar === "=" ||
      firstChar === "+" ||
      firstChar === "@" ||
      firstChar === "\t" ||
      firstChar === "\r"
    ) {
      return `'${value}`;
    }

    return value;
  }

  /*
   * Reads a nested value from an item using dot-notation, e.g. "label.name".
   * Each segment is resolved via direct property access first (which works for
   * database models and plain objects and keeps falsy values) and falls back to
   * getColumnValue() for analytics models that keep values in an internal map.
   */
  public static getRawValueByPath<T extends GenericObject>(
    item: T,
    path: string,
  ): unknown {
    const segments: Array<string> = path.split(".");
    let current: unknown = item;

    for (const segment of segments) {
      current = this.getSegmentValue(current, segment);

      if (current === null || current === undefined) {
        return current;
      }
    }

    return current;
  }

  private static getSegmentValue(obj: unknown, segment: string): unknown {
    if (obj === null || obj === undefined) {
      return undefined;
    }

    const direct: unknown = (obj as Record<string, unknown>)[segment];

    if (direct !== undefined) {
      return direct;
    }

    const getColumnValue: ((name: string) => unknown) | undefined = (
      obj as { getColumnValue?: (name: string) => unknown }
    ).getColumnValue;

    if (typeof getColumnValue === "function") {
      try {
        return getColumnValue.call(obj, segment);
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  /*
   * Formats a raw value into a display string based on the column's field type,
   * mirroring how the table renders the same value. Arrays are formatted
   * element-by-element and joined so multi-value cells stay in a single CSV
   * field.
   */
  public static formatValueForCsv(rawValue: unknown, type: FieldType): string {
    if (rawValue === null || rawValue === undefined) {
      return "";
    }

    if (Array.isArray(rawValue)) {
      return rawValue
        .map((element: unknown) => {
          return this.formatScalarValue(element, type);
        })
        .filter((formatted: string) => {
          return formatted.length > 0;
        })
        .join("; ");
    }

    return this.formatScalarValue(rawValue, type);
  }

  private static formatScalarValue(rawValue: unknown, type: FieldType): string {
    if (rawValue === null || rawValue === undefined) {
      return "";
    }

    switch (type) {
      case FieldType.Date:
        return this.formatDate(rawValue, true);
      case FieldType.DateTime:
        return this.formatDate(rawValue, false);
      case FieldType.Boolean:
        return rawValue ? "Yes" : "No";
      case FieldType.USDCents: {
        const num: number = Number(rawValue);
        if (Number.isNaN(num)) {
          return "";
        }
        return `${num / 100} USD`;
      }
      case FieldType.Percent:
        return `${this.stringifyValue(rawValue)}%`;
      default:
        return this.stringifyValue(rawValue);
    }
  }

  private static formatDate(rawValue: unknown, onlyShowDate: boolean): string {
    if (rawValue instanceof Date) {
      return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        rawValue,
        onlyShowDate,
      );
    }

    if (typeof rawValue === "string" && rawValue.length > 0) {
      return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        rawValue,
        onlyShowDate,
      );
    }

    return "";
  }

  private static stringifyValue(rawValue: unknown): string {
    if (rawValue === null || rawValue === undefined) {
      return "";
    }

    const valueType: string = typeof rawValue;

    if (valueType === "string") {
      return rawValue as string;
    }

    if (
      valueType === "number" ||
      valueType === "boolean" ||
      valueType === "bigint"
    ) {
      return String(rawValue);
    }

    if (valueType === "object") {
      const customString: string | null = this.getCustomToString(rawValue);

      if (customString !== null) {
        return customString;
      }

      const obj: Record<string, unknown> = rawValue as Record<string, unknown>;

      for (const displayKey of ["name", "title", "value"]) {
        const displayValue: unknown = obj[displayKey];

        if (typeof displayValue === "string" && displayValue.length > 0) {
          return displayValue;
        }

        if (displayValue !== null && typeof displayValue === "object") {
          const nested: string | null = this.getCustomToString(displayValue);

          if (nested !== null && nested.length > 0) {
            return nested;
          }
        }
      }

      try {
        return JSON.stringify(rawValue);
      } catch {
        return "";
      }
    }

    return String(rawValue);
  }

  /*
   * Returns the result of a value's own toString() when it overrides the
   * default Object.prototype.toString (as ObjectID, Color, Name, Email, etc do)
   * and null otherwise so the caller can fall back to other strategies.
   */
  private static getCustomToString(value: unknown): string | null {
    const toStringFn: (() => string) | undefined = (
      value as { toString?: () => string }
    )?.toString;

    if (
      typeof toStringFn === "function" &&
      toStringFn !== Object.prototype.toString
    ) {
      const asString: string = toStringFn.call(value);

      if (typeof asString === "string" && asString !== "[object Object]") {
        return asString;
      }
    }

    return null;
  }

  /*
   * Columns that can be exported: everything except the Actions column (which
   * only holds buttons) and columns without a data key (purely presentational).
   */
  public static getExportableColumns<T extends GenericObject>(
    columns: Columns<T>,
  ): Columns<T> {
    return (columns || []).filter((column: Column<T>) => {
      if (column.type === FieldType.Actions) {
        return false;
      }

      if (column.key === null || column.key === undefined) {
        return false;
      }

      return true;
    });
  }

  public static getCellValue<T extends GenericObject>(
    item: T,
    column: Column<T>,
  ): string {
    if (column.key === null || column.key === undefined) {
      return "";
    }

    const rawValue: unknown = this.getRawValueByPath(item, String(column.key));

    return this.formatValueForCsv(rawValue, column.type);
  }

  /*
   * Builds the full CSV text (header row + one row per item). Fields are
   * sanitized against formula injection and escaped per RFC 4180, and rows are
   * separated with CRLF.
   */
  public static convertToCsv<T extends GenericObject>(data: {
    items: Array<T>;
    columns: Columns<T>;
  }): string {
    const exportColumns: Columns<T> = this.getExportableColumns(data.columns);

    const encodeField: (value: string) => string = (value: string): string => {
      return this.escapeCsvValue(this.sanitizeForCsvInjection(value));
    };

    const headerRow: string = exportColumns
      .map((column: Column<T>) => {
        return encodeField(column.title || "");
      })
      .join(",");

    const rows: Array<string> = (data.items || []).map((item: T) => {
      return exportColumns
        .map((column: Column<T>) => {
          return encodeField(this.getCellValue(item, column));
        })
        .join(",");
    });

    return [headerRow, ...rows].join("\r\n");
  }

  /*
   * Builds a filesystem-safe, timestamped file name from a human label, e.g.
   * "Monitors" -> "monitors-export-2024-01-31T10-30-00.csv".
   */
  public static getExportFilename(label: string): string {
    const safeLabel: string =
      (label || "table")
        .replace(/[^a-zA-Z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "table";

    const timestamp: string = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);

    return `${safeLabel}-export-${timestamp}.csv`;
  }

  public static downloadCsv(data: { csv: string; filename: string }): void {
    /*
     * A UTF-8 byte order mark makes Excel open the file with the correct
     * encoding so non-ASCII characters are not mangled.
     */
    const byteOrderMark: string = String.fromCharCode(0xfeff);

    const blob: Blob = new Blob([`${byteOrderMark}${data.csv}`], {
      type: "text/csv;charset=utf-8;",
    });

    const url: string = window.URL.createObjectURL(blob);
    const anchor: HTMLAnchorElement = document.createElement("a");
    anchor.href = url;
    anchor.download = data.filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  }

  public static exportItemsToCsv<T extends GenericObject>(data: {
    items: Array<T>;
    columns: Columns<T>;
    label: string;
  }): void {
    const csv: string = this.convertToCsv({
      items: data.items,
      columns: data.columns,
    });

    this.downloadCsv({
      csv: csv,
      filename: this.getExportFilename(data.label),
    });
  }
}
