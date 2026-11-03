/*
 * HOW A SERVICE USES A TABLE, AS ITS DATABASE SPANS SAY.
 *
 * A client span to a database names the statement's operation
 * (db.operation.name: SELECT, INSERT, ...) and, when the instrumentation
 * knows it, the table (db.collection.name, or the older db.sql.table). A
 * table's page lists the services that write it and the services that read
 * it from those spans, so a table that stopped changing points at the job
 * or service that stopped writing it.
 */

export enum DataAssetAccessKind {
  // The service changes the table's rows: INSERT, UPDATE, DELETE, MERGE, COPY...
  Write = "Write",
  // The service reads them: SELECT and its kin.
  Read = "Read",
}

export const DATA_ASSET_ACCESS_KINDS: ReadonlyArray<DataAssetAccessKind> = [
  DataAssetAccessKind.Write,
  DataAssetAccessKind.Read,
];

const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "UPSERT",
  "REPLACE",
  "COPY",
  "TRUNCATE",
  "LOAD",
  "BULK",
]);

const READ_OPERATIONS: ReadonlySet<string> = new Set([
  "SELECT",
  "WITH",
  "SHOW",
  "FETCH",
  "READ",
]);

// The longest operation name kept, as an instrumentation may send anything.
export const MAX_OPERATION_LENGTH: number = 32;

// The most distinct operations remembered for one service and one table.
export const MAX_OPERATIONS_PER_USAGE: number = 10;

// An operation as it is stored: its first word, upper case, or null when there is none.
export function normalizeOperation(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const word: string = value.trim().split(/\s+/)[0] || "";
  const operation: string = word
    .toUpperCase()
    .replace(/[^A-Z_]/g, "")
    .slice(0, MAX_OPERATION_LENGTH);

  return operation || null;
}

// Whether an operation reads or writes the table; null for one that is neither (BEGIN, SET...).
export function getAccessKindOfOperation(
  value: unknown,
): DataAssetAccessKind | null {
  const operation: string | null = normalizeOperation(value);

  if (!operation) {
    return null;
  }

  if (WRITE_OPERATIONS.has(operation)) {
    return DataAssetAccessKind.Write;
  }

  if (READ_OPERATIONS.has(operation)) {
    return DataAssetAccessKind.Read;
  }

  return null;
}
