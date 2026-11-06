/*
 * ONE COLUMN OF A DATA ASSET, AND HOW TWO VERSIONS OF A TABLE'S COLUMNS DIFFER.
 *
 * A data asset keeps its columns as they were at its last collection. Each
 * collection is compared with the one before: a column that appears is
 * Added, one that goes is Removed, and one whose type or nullability moves
 * is TypeChanged or NullabilityChanged. A column that goes while another of
 * the same type appears at the same position is read as Renamed: that is
 * what ALTER TABLE ... RENAME COLUMN looks like from the outside, and
 * reporting it as a drop and an add would page someone for a dropped column
 * that never was.
 *
 * Column names are compared exactly: PostgreSQL keeps "UserId" and "userid"
 * apart when they were quoted, and so does this.
 */

export interface DataAssetColumn {
  name: string;
  // The engine's own name for the type, lower case: "integer", "varchar", "timestamp with time zone".
  dataType: string;
  isNullable: boolean;
  // 1-based, as the engine numbers it.
  position: number;
}

// PostgreSQL allows 1,600 columns in a table; nothing real has more.
export const MAX_COLUMNS_PER_DATA_ASSET: number = 1600;
// Longer names than any engine allows are cut, never kept whole.
export const MAX_COLUMN_NAME_LENGTH: number = 256;
export const MAX_COLUMN_TYPE_LENGTH: number = 128;

export enum DataAssetColumnChangeKind {
  Added = "Added",
  Removed = "Removed",
  Renamed = "Renamed",
  TypeChanged = "TypeChanged",
  NullabilityChanged = "NullabilityChanged",
}

export interface DataAssetColumnChange {
  kind: DataAssetColumnChangeKind;
  // The column's name now (for Removed, the name it had).
  column: string;
  position: number;
  previousName?: string | undefined;
  previousDataType?: string | undefined;
  dataType?: string | undefined;
  previousIsNullable?: boolean | undefined;
  isNullable?: boolean | undefined;
}

/*
 * Whether a change can break whatever reads the table: a column gone, a
 * column renamed, or a type changed. A column added, or one that starts
 * allowing empty values, breaks nothing that reads it by name.
 */
export function isBreakingColumnChange(change: DataAssetColumnChange): boolean {
  switch (change.kind) {
    case DataAssetColumnChangeKind.Removed:
    case DataAssetColumnChangeKind.Renamed:
    case DataAssetColumnChangeKind.TypeChanged:
      return true;
    case DataAssetColumnChangeKind.NullabilityChanged:
      // NOT NULL to NULL: readers that assumed a value now get none.
      return change.isNullable === true;
    default:
      return false;
  }
}

function normalizeType(value: string): string {
  return value.trim().toLowerCase();
}

/*
 * Reads columns written by anyone - a probe's report, a JSON column - into
 * the shape above, dropping what is not a column and keeping at most
 * MAX_COLUMNS_PER_DATA_ASSET, in position order.
 */
export function readDataAssetColumns(value: unknown): Array<DataAssetColumn> {
  if (!Array.isArray(value)) {
    return [];
  }

  const columns: Array<DataAssetColumn> = [];
  const seen: Set<string> = new Set();

  for (const item of value as Array<unknown>) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record: Record<string, unknown> = item as Record<string, unknown>;
    const name: unknown = record["name"];

    if (typeof name !== "string" || name.length === 0) {
      continue;
    }

    const cutName: string = name.slice(0, MAX_COLUMN_NAME_LENGTH);

    if (seen.has(cutName)) {
      continue;
    }

    const position: number = Number(record["position"]);

    seen.add(cutName);
    columns.push({
      name: cutName,
      dataType: normalizeType(String(record["dataType"] ?? "")).slice(
        0,
        MAX_COLUMN_TYPE_LENGTH,
      ),
      isNullable: record["isNullable"] !== false,
      position:
        Number.isFinite(position) && position > 0
          ? Math.floor(position)
          : columns.length + 1,
    });

    if (columns.length >= MAX_COLUMNS_PER_DATA_ASSET) {
      break;
    }
  }

  return columns.sort((a: DataAssetColumn, b: DataAssetColumn) => {
    return a.position - b.position;
  });
}

export function diffDataAssetColumns(
  previous: Array<DataAssetColumn>,
  next: Array<DataAssetColumn>,
): Array<DataAssetColumnChange> {
  const previousByName: Map<string, DataAssetColumn> = new Map(
    previous.map((column: DataAssetColumn) => {
      return [column.name, column];
    }),
  );
  const nextByName: Map<string, DataAssetColumn> = new Map(
    next.map((column: DataAssetColumn) => {
      return [column.name, column];
    }),
  );

  const removed: Array<DataAssetColumn> = previous.filter(
    (column: DataAssetColumn) => {
      return !nextByName.has(column.name);
    },
  );
  const added: Array<DataAssetColumn> = next.filter(
    (column: DataAssetColumn) => {
      return !previousByName.has(column.name);
    },
  );

  const changes: Array<DataAssetColumnChange> = [];
  const renamedFrom: Set<string> = new Set();
  const renamedTo: Set<string> = new Set();

  for (const gone of removed) {
    const candidates: Array<DataAssetColumn> = added.filter(
      (column: DataAssetColumn) => {
        return (
          !renamedTo.has(column.name) &&
          column.position === gone.position &&
          normalizeType(column.dataType) === normalizeType(gone.dataType)
        );
      },
    );

    // Only an unambiguous pair is a rename.
    if (candidates.length !== 1) {
      continue;
    }

    const renamed: DataAssetColumn = candidates[0]!;

    renamedFrom.add(gone.name);
    renamedTo.add(renamed.name);
    changes.push({
      kind: DataAssetColumnChangeKind.Renamed,
      column: renamed.name,
      position: renamed.position,
      previousName: gone.name,
      dataType: renamed.dataType,
    });
  }

  for (const gone of removed) {
    if (renamedFrom.has(gone.name)) {
      continue;
    }

    changes.push({
      kind: DataAssetColumnChangeKind.Removed,
      column: gone.name,
      position: gone.position,
      previousDataType: gone.dataType,
    });
  }

  for (const column of added) {
    if (renamedTo.has(column.name)) {
      continue;
    }

    changes.push({
      kind: DataAssetColumnChangeKind.Added,
      column: column.name,
      position: column.position,
      dataType: column.dataType,
      isNullable: column.isNullable,
    });
  }

  for (const column of next) {
    const before: DataAssetColumn | undefined = previousByName.get(column.name);

    if (!before) {
      continue;
    }

    if (normalizeType(before.dataType) !== normalizeType(column.dataType)) {
      changes.push({
        kind: DataAssetColumnChangeKind.TypeChanged,
        column: column.name,
        position: column.position,
        previousDataType: before.dataType,
        dataType: column.dataType,
      });
    }

    if (before.isNullable !== column.isNullable) {
      changes.push({
        kind: DataAssetColumnChangeKind.NullabilityChanged,
        column: column.name,
        position: column.position,
        previousIsNullable: before.isNullable,
        isNullable: column.isNullable,
      });
    }
  }

  return changes.sort((a: DataAssetColumnChange, b: DataAssetColumnChange) => {
    return a.position - b.position;
  });
}
