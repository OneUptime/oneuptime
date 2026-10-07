import { JSONObject } from "../../../Types/JSON";
import {
  SnmpTableSnapshot,
  SnmpTableSnapshotCell,
  SnmpTableSnapshotColumn,
  SnmpTableSnapshotRow,
} from "../../../Types/Monitor/SnmpMonitor/SnmpTable";

/*
 * Rows offered to a template per table. A template renders a sentence, not a
 * report: past a few dozen rows nobody reads them, and every row is
 * serialized into the storage map of every alert the monitor raises.
 */
export const MAX_TEMPLATE_ROWS_PER_TABLE: number = 50;

/*
 * Walked SNMP tables as template variables, keyed by table key:
 *
 *   tables.<key>.name                - the table's name
 *   tables.<key>.rowCount            - rows walked
 *   tables.<key>.rows.N.name         - a row's name (its label, or index)
 *   tables.<key>.rows.N.index        - its index
 *   tables.<key>.rows.N.values.<col> - a cell as shown, by column name
 *   tables.<key>.unhealthyRowCount   - rows with a status outside its
 *   tables.<key>.unhealthyRows       -   column's healthy values
 *   tables.<key>.failureCause        - why the table was not walked, if so
 */
export default class SnmpTableTemplateUtil {
  public static toTemplateVariables(
    tables: Array<SnmpTableSnapshot>,
  ): JSONObject {
    const variables: JSONObject = {};

    for (const table of tables) {
      const unhealthyRows: Array<SnmpTableSnapshotRow> = table.rows.filter(
        (row: SnmpTableSnapshotRow) => {
          return SnmpTableTemplateUtil.isUnhealthy(row);
        },
      );

      const tableVariables: JSONObject = {
        name: table.name,
        rowCount: table.rows.length,
        rows: table.rows
          .slice(0, MAX_TEMPLATE_ROWS_PER_TABLE)
          .map((row: SnmpTableSnapshotRow) => {
            return SnmpTableTemplateUtil.toRowVariables(table, row);
          }),
        unhealthyRowCount: unhealthyRows.length,
        unhealthyRows: unhealthyRows
          .slice(0, MAX_TEMPLATE_ROWS_PER_TABLE)
          .map((row: SnmpTableSnapshotRow) => {
            return SnmpTableTemplateUtil.toRowVariables(table, row);
          }),
      };

      if (table.failureCause) {
        tableVariables["failureCause"] = table.failureCause;
      }

      variables[table.key] = tableVariables;
    }

    return variables;
  }

  // A row is unhealthy when any of its status columns is outside its healthy values.
  public static isUnhealthy(row: SnmpTableSnapshotRow): boolean {
    return Object.values(row.cells || {}).some(
      (cell: SnmpTableSnapshotCell) => {
        return cell.isHealthy === false;
      },
    );
  }

  private static toRowVariables(
    table: SnmpTableSnapshot,
    row: SnmpTableSnapshotRow,
  ): JSONObject {
    const values: JSONObject = {};

    for (const column of table.columns) {
      const cell: SnmpTableSnapshotCell | undefined = row.cells[column.oid];
      values[SnmpTableTemplateUtil.getColumnVariableName(column)] =
        cell?.display ?? "";
    }

    return {
      name: row.label,
      index: row.index,
      values: values,
    };
  }

  /*
   * Column names are written by people ("TX Power (dBm)"), but a template
   * path ends at the first space or dot, so they are reduced to an
   * identifier: "tx_power_dbm".
   */
  public static getColumnVariableName(column: SnmpTableSnapshotColumn): string {
    const name: string = column.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    return name || column.oid.replace(/\./g, "_");
  }
}
