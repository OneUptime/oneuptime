import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import OpenStackCloudFeed, {
  OpenStackCloudFeedEventType,
} from "Common/Models/DatabaseModels/OpenStackCloudFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const OpenStackCloudFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<OpenStackCloudFeed>
      modelType={OpenStackCloudFeed}
      resourceIdColumn="openStackCloudId"
      resourceId={modelId}
      eventTypeColumn="openStackCloudFeedEventType"
      eventTypes={Object.values(OpenStackCloudFeedEventType)}
      title="OpenStack Cloud Feed"
      description="Everything that has happened to this OpenStack cloud - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this OpenStack cloud yet."
    />
  );
};

export default OpenStackCloudFeedPage;
