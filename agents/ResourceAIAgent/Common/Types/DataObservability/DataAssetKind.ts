/*
 * WHAT KIND OF THING A DATA ASSET IS.
 *
 * A data asset is one named thing inside a data store that holds or serves
 * rows: a table, a view, a materialized view, a partitioned table (its
 * partitions are not assets of their own), or a foreign table. Views hold no
 * rows of their own, so they have no size, and their freshness is their
 * sources' freshness; tables carry all three of row count, size and last
 * change.
 */
enum DataAssetKind {
  Table = "Table",
  View = "View",
  MaterializedView = "Materialized View",
  PartitionedTable = "Partitioned Table",
  ForeignTable = "Foreign Table",
  // A path in a bucket, watched like a table: its objects are its rows (StoragePaths).
  StoragePath = "Storage Path",
}

export default DataAssetKind;

/*
 * Whether this kind counts as a watched table on the bill. A view holds no rows
 * and has no size of its own, so it is free: everything else holds data.
 */
export function isBilledAsWatchedTable(
  kind: DataAssetKind | undefined | null,
): boolean {
  return kind !== DataAssetKind.View;
}

export const DATA_ASSET_KINDS: ReadonlyArray<DataAssetKind> = [
  DataAssetKind.Table,
  DataAssetKind.View,
  DataAssetKind.MaterializedView,
  DataAssetKind.PartitionedTable,
  DataAssetKind.ForeignTable,
  DataAssetKind.StoragePath,
];

export function isDataAssetKind(value: unknown): value is DataAssetKind {
  return (
    typeof value === "string" &&
    (DATA_ASSET_KINDS as ReadonlyArray<string>).includes(value)
  );
}

// Whether rows are kept in the asset itself, so its row count and size mean something.
export function doesDataAssetKindHoldRows(kind: DataAssetKind): boolean {
  return kind !== DataAssetKind.View && kind !== DataAssetKind.ForeignTable;
}
