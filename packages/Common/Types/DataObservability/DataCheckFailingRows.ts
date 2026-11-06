import { maskValue } from "../../Utils/DataSecurity/Masking";
import { DataTypeInfo } from "../DataSecurity/DataTypeCatalog";
import { findDataTypeOfColumnName } from "./DataColumnSensitivity";
import {
  MAX_FAILING_ROW_COLUMNS,
  MAX_FAILING_ROWS,
  MAX_FAILING_ROW_VALUE_LENGTH,
} from "./DataCheckType";

/*
 * A SAMPLE OF THE ROWS A CHECK FOUND FAILING, MASKED.
 *
 * Knowing how many rows fail says something is wrong; seeing a few says what.
 * A project can choose to keep them: off until it does, deleted when it stops.
 * Every value of a column that holds sensitive data - by what a scan found in
 * it or, failing that, by its name - is masked where the row is read, so what
 * leaves the database, and a probe, is already masked. The server masks again
 * with what it knows, and trusts no probe.
 */

export type FailingRow = Record<string, string>;

// A column known to hold sensitive data, and the type its values are masked as.
export type MaskedColumns = Readonly<Record<string, string>>;

function asCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text: string =
    value instanceof Date ? value.toISOString() : String(value);

  return text.slice(0, MAX_FAILING_ROW_VALUE_LENGTH);
}

function getMaskType(
  column: string,
  maskedColumns: MaskedColumns,
): string | null {
  const known: string | undefined = maskedColumns[column.toLowerCase()];

  if (known) {
    return known;
  }

  const hinted: DataTypeInfo | null = findDataTypeOfColumnName(column);

  return hinted ? hinted.id : null;
}

export function maskFailingRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  maskedColumns: MaskedColumns = {},
): Array<FailingRow> {
  return rows.slice(0, MAX_FAILING_ROWS).map((row: Record<string, unknown>) => {
    const masked: FailingRow = {};

    for (const column of Object.keys(row).slice(0, MAX_FAILING_ROW_COLUMNS)) {
      const cell: string = asCell(row[column]);
      const type: string | null = getMaskType(column, maskedColumns);

      masked[column] = type && cell ? maskValue(type, cell) : cell;
    }

    return masked;
  });
}

// What a report says of a check's failing rows, read strictly: bounded text and nothing else.
export function readFailingRows(value: unknown): Array<FailingRow> {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: Array<FailingRow> = [];

  for (const item of value.slice(0, MAX_FAILING_ROWS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const row: FailingRow = {};

    for (const [column, cell] of Object.entries(item).slice(
      0,
      MAX_FAILING_ROW_COLUMNS,
    )) {
      if (typeof cell === "string" && column.length <= 240) {
        row[column] = cell.slice(0, MAX_FAILING_ROW_VALUE_LENGTH);
      }
    }

    rows.push(row);
  }

  return rows;
}
