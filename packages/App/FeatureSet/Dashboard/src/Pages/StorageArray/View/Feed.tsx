import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import StorageArrayFeed, {
  StorageArrayFeedEventType,
} from "Common/Models/DatabaseModels/StorageArrayFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const StorageArrayFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<StorageArrayFeed>
      modelType={StorageArrayFeed}
      resourceIdColumn="storageArrayId"
      resourceId={modelId}
      eventTypeColumn="storageArrayFeedEventType"
      eventTypes={Object.values(StorageArrayFeedEventType)}
      title="Storage Array Feed"
      description="Everything that has happened to this storage array - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this storage array yet."
    />
  );
};

export default StorageArrayFeedPage;
