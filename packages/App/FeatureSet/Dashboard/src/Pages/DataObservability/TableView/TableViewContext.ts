import DataAsset from "Common/Models/DatabaseModels/DataAsset";
import ObjectID from "Common/Types/ObjectID";
import { useOutletContext, useParams } from "react-router-dom";

/*
 * What every page of a table shares: the table as its layout read it, and a
 * way to read it again after a change. The layout reads it once, so the
 * Overview, Columns and Settings agree without each fetching it.
 */

// The columns the layout reads for every page.
export const TABLE_VIEW_SELECT: {
  _id: true;
  assetKey: true;
  name: true;
  schemaName: true;
  assetKind: true;
  dataStoreId: true;
  dataStoreName: true;
  dataStoreKind: true;
  description: true;
  columns: true;
  columnCount: true;
  rowCount: true;
  sizeInBytes: true;
  lastChangedAt: true;
  updateIntervalInSeconds: true;
  lastCollectedAt: true;
  firstSeenAt: true;
  isDropped: true;
  droppedAt: true;
} = {
  _id: true,
  assetKey: true,
  name: true,
  schemaName: true,
  assetKind: true,
  dataStoreId: true,
  dataStoreName: true,
  dataStoreKind: true,
  description: true,
  columns: true,
  columnCount: true,
  rowCount: true,
  sizeInBytes: true,
  lastChangedAt: true,
  updateIntervalInSeconds: true,
  lastCollectedAt: true,
  firstSeenAt: true,
  isDropped: true,
  droppedAt: true,
};

export interface TableViewOutletContext {
  dataAssetId: ObjectID;
  // As the layout read it: null while it is read, or when it could not be.
  dataAsset: DataAsset | null;
  refresh: () => void;
}

/*
 * The table the layout read. A page rendered outside the layout (a test)
 * reads the table's id from the address, and no table.
 */
export function useTableViewContext(): TableViewOutletContext {
  const context: TableViewOutletContext | undefined | null = useOutletContext<
    TableViewOutletContext | undefined | null
  >();
  const { id } = useParams();

  if (context) {
    return context;
  }

  return {
    dataAssetId: new ObjectID(id || ""),
    dataAsset: null,
    refresh: (): void => {},
  };
}
