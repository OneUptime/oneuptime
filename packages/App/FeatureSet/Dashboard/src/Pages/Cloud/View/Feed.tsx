import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import CloudResourceFeed, {
  CLOUD_APP_FEED_EVENT_TYPES,
  CloudResourceFeedEventType,
} from "Common/Models/DatabaseModels/CloudResourceFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A cloud resource's feed offers every event type of the feed table but the
 * ones only an App Platforms environment has (its apps' deploys and
 * rollbacks). Exported for tests.
 */
export const CLOUD_RESOURCE_FEED_EVENT_TYPES: Array<CloudResourceFeedEventType> =
  Object.values(CloudResourceFeedEventType).filter(
    (eventType: CloudResourceFeedEventType): boolean => {
      return !CLOUD_APP_FEED_EVENT_TYPES.includes(eventType);
    },
  );

const CloudResourceFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<CloudResourceFeed>
      modelType={CloudResourceFeed}
      resourceIdColumn="cloudResourceId"
      resourceId={modelId}
      eventTypeColumn="cloudResourceFeedEventType"
      eventTypes={CLOUD_RESOURCE_FEED_EVENT_TYPES}
      title="Cloud Resource Feed"
      description="Everything that has happened to this cloud resource - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this cloud resource yet."
    />
  );
};

export default CloudResourceFeedPage;
