import { JSONObject } from "../../../Types/JSON";
import {
  SNMP_TABLE_COLUMN_ATTRIBUTE,
  SNMP_TABLE_COLUMN_OID_ATTRIBUTE,
  SNMP_TABLE_KEY_ATTRIBUTE,
  SNMP_TABLE_NAME_ATTRIBUTE,
  SNMP_TABLE_ROW_ATTRIBUTE,
  SNMP_TABLE_ROW_INDEX_ATTRIBUTE,
  SnmpTableSnapshot,
  SnmpTableSnapshotCell,
  SnmpTableSnapshotColumn,
  SnmpTableSnapshotRow,
} from "../../../Types/Monitor/SnmpMonitor/SnmpTable";

export interface SnmpTablePoint {
  value: number;
  unit?: string | undefined;
  attributes: JSONObject;
}

/*
 * One metric point per numeric table cell, labelled with the attributes
 * declared in SnmpTable.ts.
 */
export default class SnmpTableMetricUtil {
  /*
   * Points in table order, then row order, then column order. A table that
   * failed this walk has no rows and so writes nothing - a gap in the chart
   * is the honest record of a walk that did not happen.
   */
  public static getPoints(
    tables: Array<SnmpTableSnapshot> | undefined,
  ): Array<SnmpTablePoint> {
    const points: Array<SnmpTablePoint> = [];

    for (const table of tables || []) {
      for (const row of table.rows || []) {
        for (const column of table.columns || []) {
          const cell: SnmpTableSnapshotCell | undefined =
            row.cells?.[column.oid];

          if (
            !cell ||
            typeof cell.numeric !== "number" ||
            !Number.isFinite(cell.numeric)
          ) {
            continue;
          }

          points.push({
            value: cell.numeric,
            unit: column.unit,
            attributes: SnmpTableMetricUtil.getAttributes({
              table: table,
              column: column,
              row: row,
            }),
          });
        }
      }
    }

    return points;
  }

  public static getAttributes(data: {
    table: SnmpTableSnapshot;
    column: SnmpTableSnapshotColumn;
    row: SnmpTableSnapshotRow;
  }): JSONObject {
    return {
      [SNMP_TABLE_KEY_ATTRIBUTE]: data.table.key,
      [SNMP_TABLE_NAME_ATTRIBUTE]: data.table.name,
      [SNMP_TABLE_COLUMN_ATTRIBUTE]: data.column.name,
      [SNMP_TABLE_COLUMN_OID_ATTRIBUTE]: data.column.oid,
      [SNMP_TABLE_ROW_ATTRIBUTE]: data.row.label,
      [SNMP_TABLE_ROW_INDEX_ATTRIBUTE]: data.row.index,
    };
  }
}
