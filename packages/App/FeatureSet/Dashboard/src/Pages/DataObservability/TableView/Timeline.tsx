import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import { useTableViewContext } from "./TableViewContext";
import DataAssetFeed, {
  DataAssetFeedEventType,
} from "Common/Models/DatabaseModels/DataAssetFeed";
import IconProp from "Common/Types/Icon/IconProp";
import {
  FeedEntryKind,
  FeedTone,
} from "Common/UI/Components/Feed/FeedEntryKind";
import React, { FunctionComponent, ReactElement } from "react";

// How each entry of a table's timeline looks: a drop in red, a restore in green.
export function getDataAssetFeedKind(
  eventType: string,
): FeedEntryKind | undefined {
  switch (eventType) {
    case DataAssetFeedEventType.AssetDiscovered:
      return { icon: IconProp.TableCells, tone: FeedTone.Info };
    case DataAssetFeedEventType.AssetDropped:
    case DataAssetFeedEventType.ColumnRemoved:
      return { icon: IconProp.Trash, tone: FeedTone.Danger };
    case DataAssetFeedEventType.AssetRestored:
    case DataAssetFeedEventType.ColumnAdded:
      return { icon: IconProp.CheckCircle, tone: FeedTone.Success };
    case DataAssetFeedEventType.ColumnRenamed:
    case DataAssetFeedEventType.ColumnTypeChanged:
    case DataAssetFeedEventType.ColumnNullabilityChanged:
      return { icon: IconProp.ViewColumns, tone: FeedTone.Warning };
    default:
      return undefined;
  }
}

// Everything that happened to the table: found, columns changed, dropped, restored.
const TableTimelinePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { dataAssetId } = useTableViewContext();

  return (
    <ResourceFeed<DataAssetFeed>
      modelType={DataAssetFeed}
      resourceIdColumn="dataAssetId"
      resourceId={dataAssetId}
      eventTypeColumn="dataAssetFeedEventType"
      eventTypes={Object.values(DataAssetFeedEventType)}
      title="Timeline"
      description="Everything that happened to this table: when it was found, every column added, removed, renamed or retyped, and when it was dropped or came back."
      noItemsMessage="Nothing has happened to this table yet."
      getKind={getDataAssetFeedKind}
    />
  );
};

export default TableTimelinePage;
