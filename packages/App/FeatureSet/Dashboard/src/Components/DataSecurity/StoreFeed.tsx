import ResourceFeed from "../ResourceFeed/ResourceFeed";
import { getDataStoreFeedKind } from "./StoreFeedKind";
import DataStoreFeed, {
  DataStoreFeedEventType,
} from "Common/Models/DatabaseModels/DataStoreFeed";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  dataStoreId: ObjectID;
}

/*
 * A data store's timeline: when it was found or added, the changes people
 * made to it, its owners and the rules that set them, when discovery stopped
 * or started seeing it again, and every response action that closed its
 * exposure - with who did what. Written by OneUptime as it happens; nobody
 * edits an entry.
 */
const StoreFeed: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ResourceFeed<DataStoreFeed>
      modelType={DataStoreFeed}
      resourceIdColumn="dataStoreId"
      resourceId={props.dataStoreId}
      eventTypeColumn="dataStoreFeedEventType"
      eventTypes={Object.values(DataStoreFeedEventType)}
      title="Timeline"
      description="Everything that happened to this data store: when it was found, changes to its settings and owners, and what was done to close its exposure."
      noItemsMessage="Nothing has happened on this data store yet."
      getKind={getDataStoreFeedKind}
    />
  );
};

export default StoreFeed;
