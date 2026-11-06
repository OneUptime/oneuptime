import { getHintedDataTypeIds } from "../../Utils/DataSecurity/FieldNameHints";
import DataCategory from "../DataSecurity/DataCategory";
import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
  isDataSensitivity,
} from "../DataSecurity/DataSensitivity";
import {
  DataTypeInfo,
  getBuiltInDataType,
} from "../DataSecurity/DataTypeCatalog";

/*
 * WHICH COLUMNS OF A TABLE HOLD SENSITIVE DATA.
 *
 * Data Security's scans say so from the values they read. A table in a store
 * nothing scans, or a column added since the last scan, can still say so from
 * its name, through the same hints the scans use: a column called ssn is worth
 * treating as one until a scan says otherwise.
 *
 * The same reading tells Data Security about a column that was just added: a
 * migration can start collecting personal data with nobody having decided it
 * should, and the day it ships is when it is cheapest to mask, move or drop.
 */

export interface DataColumnSensitivity {
  column: string;
  dataTypeId: string;
  dataTypeName: string;
  sensitivity: DataSensitivity | null;
  // True when only the column's name says so: no scan has read its values.
  isFromName: boolean;
}

// What a Data Security scan found in a column, as the finding says it.
export interface ColumnFinding {
  location?: string | null | undefined;
  dataTypeId?: string | null | undefined;
  dataTypeName?: string | null | undefined;
  sensitivity?: string | null | undefined;
}

// A column Data Observability saw appear, and what its name says it holds.
export interface NewPersonalDataColumn {
  // schema.table.column
  column: string;
  dataType: string;
  seenAt: string;
}

// How long a new column that holds personal data stays an issue.
export const NEW_PERSONAL_DATA_COLUMN_WINDOW_IN_DAYS: number = 14;

// The most new columns a store remembers: the newest are kept.
export const MAX_NEW_PERSONAL_DATA_COLUMNS: number = 50;

const MILLISECONDS_IN_A_DAY: number = 86_400_000;

// What is about a person. A secret or a business document is sensitive, but no one's personal data.
const PERSONAL_DATA_CATEGORIES: ReadonlyArray<DataCategory> = [
  DataCategory.ContactAndIdentity,
  DataCategory.GovernmentId,
  DataCategory.Financial,
  DataCategory.Health,
  DataCategory.SpecialCategory,
];

function getRank(sensitivity: string | null | undefined): number {
  return isDataSensitivity(sensitivity)
    ? DATA_SENSITIVITY_RANK[sensitivity]
    : -1;
}

// The data type a column's name says it holds, if any: the most sensitive one it hints at.
export function findDataTypeOfColumnName(
  columnName: string,
): DataTypeInfo | null {
  let found: DataTypeInfo | null = null;

  for (const dataTypeId of getHintedDataTypeIds(columnName)) {
    const type: DataTypeInfo | undefined = getBuiltInDataType(dataTypeId);

    if (
      type &&
      (!found || getRank(type.sensitivity) > getRank(found.sensitivity))
    ) {
      found = type;
    }
  }

  return found;
}

/*
 * The column a finding's location names, if it is in this table. A scan writes
 * "schema.table.column" for a database and "table.field.path" for a document
 * store, so a location can name a field inside a column: it counts for the column.
 */
export function getFindingColumn(data: {
  location: string | null | undefined;
  schemaName: string | null | undefined;
  tableName: string;
}): string | null {
  const location: string = (data.location || "").toLowerCase();
  const prefixes: Array<string> = [
    ...(data.schemaName
      ? [`${data.schemaName}.${data.tableName}.`.toLowerCase()]
      : []),
    `${data.tableName}.`.toLowerCase(),
  ];

  for (const prefix of prefixes) {
    if (location.startsWith(prefix)) {
      return location.slice(prefix.length).split(".")[0] || null;
    }
  }

  return null;
}

/*
 * What each column of a table holds: what the scans found in it, the most
 * sensitive first, and what its name says when no scan has found anything.
 */
export function readColumnSensitivities(data: {
  schemaName: string | null | undefined;
  tableName: string;
  columns: ReadonlyArray<{ name: string }>;
  findings: ReadonlyArray<ColumnFinding>;
}): Array<DataColumnSensitivity> {
  const fromScans: Map<string, ColumnFinding> = new Map();

  for (const finding of data.findings) {
    const column: string | null = getFindingColumn({
      location: finding.location,
      schemaName: data.schemaName,
      tableName: data.tableName,
    });

    if (!column || !finding.dataTypeId) {
      continue;
    }

    const known: ColumnFinding | undefined = fromScans.get(column);

    if (!known || getRank(finding.sensitivity) > getRank(known.sensitivity)) {
      fromScans.set(column, finding);
    }
  }

  const sensitivities: Array<DataColumnSensitivity> = [];

  for (const column of data.columns) {
    const finding: ColumnFinding | undefined = fromScans.get(
      column.name.toLowerCase(),
    );

    if (finding) {
      sensitivities.push({
        column: column.name,
        dataTypeId: finding.dataTypeId || "",
        dataTypeName: finding.dataTypeName || finding.dataTypeId || "",
        sensitivity: isDataSensitivity(finding.sensitivity)
          ? finding.sensitivity
          : null,
        isFromName: false,
      });
      continue;
    }

    const hinted: DataTypeInfo | null = findDataTypeOfColumnName(column.name);

    if (hinted) {
      sensitivities.push({
        column: column.name,
        dataTypeId: hinted.id,
        dataTypeName: hinted.name,
        sensitivity: hinted.sensitivity,
        isFromName: true,
      });
    }
  }

  return sensitivities;
}

// The new columns of one table whose names say they hold personal data.
export function findNewPersonalDataColumns(data: {
  tableKey: string;
  columnNames: ReadonlyArray<string>;
  seenAt: Date;
}): Array<NewPersonalDataColumn> {
  const found: Array<NewPersonalDataColumn> = [];

  for (const columnName of data.columnNames) {
    const type: DataTypeInfo | null = findDataTypeOfColumnName(columnName);

    if (type && PERSONAL_DATA_CATEGORIES.includes(type.category)) {
      found.push({
        column: `${data.tableKey}.${columnName}`,
        dataType: type.name,
        seenAt: data.seenAt.toISOString(),
      });
    }
  }

  return found;
}

function isNewPersonalDataColumn(item: unknown): item is NewPersonalDataColumn {
  const candidate: Partial<NewPersonalDataColumn> =
    (item as Partial<NewPersonalDataColumn> | null) || {};

  return (
    typeof candidate.column === "string" &&
    typeof candidate.dataType === "string" &&
    typeof candidate.seenAt === "string"
  );
}

// The ones still inside the window, the newest first, from what a store has remembered.
export function readNewPersonalDataColumns(
  raw: unknown,
  now: Date,
): Array<NewPersonalDataColumn> {
  if (!Array.isArray(raw)) {
    return [];
  }

  const since: number =
    now.getTime() -
    NEW_PERSONAL_DATA_COLUMN_WINDOW_IN_DAYS * MILLISECONDS_IN_A_DAY;

  return raw
    .filter(isNewPersonalDataColumn)
    .filter((item: NewPersonalDataColumn) => {
      return Date.parse(item.seenAt) >= since;
    })
    .sort((a: NewPersonalDataColumn, b: NewPersonalDataColumn) => {
      return Date.parse(b.seenAt) - Date.parse(a.seenAt);
    });
}

// What a store remembers after a collection: a column seen again keeps the day it first appeared.
export function mergeNewPersonalDataColumns(data: {
  previous: unknown;
  found: ReadonlyArray<NewPersonalDataColumn>;
  now: Date;
}): Array<NewPersonalDataColumn> {
  const merged: Array<NewPersonalDataColumn> = readNewPersonalDataColumns(
    data.previous,
    data.now,
  );
  const known: Set<string> = new Set(
    merged.map((item: NewPersonalDataColumn) => {
      return item.column;
    }),
  );

  return [
    ...data.found.filter((item: NewPersonalDataColumn) => {
      return !known.has(item.column);
    }),
    ...merged,
  ].slice(0, MAX_NEW_PERSONAL_DATA_COLUMNS);
}

// How a data security issue names a new column.
export function describeNewPersonalDataColumn(
  item: NewPersonalDataColumn,
): string {
  return `${item.column} (${item.dataType})`;
}
