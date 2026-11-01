import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import CloudResourceFeed, {
  CloudResourceFeedEventType,
} from "Common/Models/DatabaseModels/CloudResourceFeed";
import {
  FeedEntryKind,
  FeedTone,
} from "Common/UI/Components/Feed/FeedEntryKind";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The kinds of the entries an environment's apps write into its feed: a
 * deploy is a rocket, a rollback a U-turn, each in the colour the server gave
 * it (CloudAppChangeRecorder: indigo and amber, as their markers are on the
 * charts). Everything else is drawn as every resource feed draws it.
 * Exported for tests.
 */
export function getEnvironmentFeedKind(
  eventType: string,
): FeedEntryKind | undefined {
  switch (eventType) {
    case CloudResourceFeedEventType.AppDeployed:
      return { icon: IconProp.RocketLaunch, tone: FeedTone.Record };
    case CloudResourceFeedEventType.AppRolledBack:
      return { icon: IconProp.ArrowUturnLeft, tone: FeedTone.Record };
    default:
      return undefined;
  }
}

/*
 * An environment's feed: how and why it was created, who owns it, and what
 * its apps changed - every deploy and rollback. Environments and cloud
 * resources keep one feed table (CloudResourceFeed), as they keep one table
 * of rows.
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
      getKind={getEnvironmentFeedKind}
      title="Environment Feed"
      description="Everything that has happened to this environment - how and why it was created, who owns it, every deploy and rollback of its apps, and every change since."
      noItemsMessage="No activity has been recorded for this environment yet."
    />
  );
};

export default AppPlatformEnvironmentFeed;
