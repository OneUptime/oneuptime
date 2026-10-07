import {
  SnmpTableColumn,
  SnmpTableDefinition,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpOidListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpOidListUtil";

/*
 * The text forms the table editor shows for structured values, and the
 * inline error for a table. Kept out of the component so the parsing is
 * testable on its own.
 */
export default class SnmpTableEditorUtil {
  // "0=inactive, 1=active" -> { "0": "inactive", "1": "active" }.
  public static parseValueLabels(
    text: string,
  ): Record<string, string> | undefined {
    const labels: Record<string, string> = {};

    for (const pair of text.split(",")) {
      const separator: number = pair.indexOf("=");

      if (separator <= 0) {
        continue;
      }

      const raw: string = pair.substring(0, separator).trim();
      const label: string = pair.substring(separator + 1).trim();

      if (raw && label) {
        labels[raw] = label;
      }
    }

    return Object.keys(labels).length > 0 ? labels : undefined;
  }

  public static formatValueLabels(
    labels: Record<string, string> | undefined,
  ): string {
    return Object.entries(labels || {})
      .map(([raw, label]: [string, string]): string => {
        return `${raw}=${label}`;
      })
      .join(", ");
  }

  // "1, 3" -> ["1", "3"]; blanks dropped.
  public static parseList(text: string): Array<string> {
    return text
      .split(",")
      .map((item: string): string => {
        return item.trim();
      })
      .filter((item: string): boolean => {
        return item.length > 0;
      });
  }

  public static formatList(items: Array<string> | undefined): string {
    return (items || []).join(", ");
  }

  /*
   * What the server would refuse on save, said beside the table instead of
   * in a toast. A table that is still blank (the "Add Table" button's own
   * artifact) is not judged, and a half-typed OID in a column row that has
   * no name yet is left alone until the operator moves on - only rows with
   * something in them are checked.
   */
  public static getTableError(table: SnmpTableDefinition): string | undefined {
    const hasContent: boolean =
      Boolean(table.name?.trim()) ||
      (table.columns || []).some((column: SnmpTableColumn): boolean => {
        return Boolean(column.oid?.trim());
      });

    if (!hasContent) {
      return undefined;
    }

    const malformedColumn: SnmpTableColumn | undefined = (
      table.columns || []
    ).find((column: SnmpTableColumn): boolean => {
      const oid: string = SnmpOidListUtil.normalizeOid(column.oid);
      return Boolean(oid) && !SnmpOidListUtil.isValidOid(oid);
    });

    if (malformedColumn) {
      return `"${malformedColumn.oid}" is not a numeric OID. Use the column's dotted OID, for example 1.3.6.1.4.1.2604.5.1.6.1.1.1.1.9.`;
    }

    try {
      SnmpTableListUtil.validateTable(table, "This table");
    } catch (err) {
      return (err as Error).message;
    }

    return undefined;
  }
}
