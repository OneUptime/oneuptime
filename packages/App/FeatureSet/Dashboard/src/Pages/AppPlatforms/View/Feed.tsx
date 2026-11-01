import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import CloudResourceFeed, {
  CloudResourceFeedEventType,
} from "Common/Models/DatabaseModels/CloudResourceFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * An environment's feed. Environments and cloud resources keep one feed
 * table (CloudResourceFeed), as they keep one table of rows.
 */
const AppPlatformEnvironmentFeed: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<CloudResourceFeed>
      modelType={CloudResourceFeed}
      resourceIdColumn="cloudResourceId"
      resourceId={modelId}
      eventTypeColumn="cloudResourceFeedEventType"
      eventTypes={Object.values(CloudResourceFeedEventType)}
      title="Environment Feed"
      description="Everything that has happened to this environment - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this environment yet."
    />
  );
};

export default AppPlatformEnvironmentFeed;
