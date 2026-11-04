import DataSensitivity from "../DataSecurity/DataSensitivity";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../DataSecurity/DataTypeCatalog";

/*
 * WHICH COLUMNS OF A TABLE HOLD SENSITIVE DATA.
 *
 * Data Security's scans say so from the values they read. A table in a store
 * nothing scans, or a column added since the last scan, can still say so from
 * its name, through the same catalog of data types: a column called ssn is
 * worth treating as one until a scan says otherwise.
 */

export interface DataColumnSensitivity {
  column: string;
  dataTypeId: string;
  dataTypeName: string;
  sensitivity: DataSensitivity | null;
  // True when only the column's name says so: no scan has read its values.
  isFromName: boolean;
}

const WORD_BREAK: RegExp = /[^a-z0-9]+/g;
const CAMEL_CASE: RegExp = /([a-z0-9])([A-Z])/g;

// A name as words, however it is written: customerEmail, customer_email, customer-email.
export function toNameWords(name: string): string {
  return ` ${name
    .replace(CAMEL_CASE, "$1 $2")
    .toLowerCase()
    .replace(WORD_BREAK, " ")
    .trim()} `;
}

// The data type a column's name says it holds, if any: the longest hint wins.
export function findDataTypeOfColumnName(
  columnName: string,
  catalog: ReadonlyArray<DataTypeInfo> = DATA_TYPE_CATALOG,
): DataTypeInfo | null {
  const words: string = toNameWords(columnName);
  let found: DataTypeInfo | null = null;
  let foundLength: number = 0;

  for (const type of catalog) {
    for (const hint of type.nameHints) {
      const hinted: string = toNameWords(hint);

      if (hinted.length > foundLength && words.includes(hinted)) {
        found = type;
        foundLength = hinted.length;
      }
    }
  }

  return found;
}
