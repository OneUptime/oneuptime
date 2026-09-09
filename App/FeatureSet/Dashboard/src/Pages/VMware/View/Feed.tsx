import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import VMwareVCenterFeed from "Common/Models/DatabaseModels/VMwareVCenterFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const VMwareVCenterFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<VMwareVCenterFeed>
      modelType={VMwareVCenterFeed}
      resourceIdColumn="vmwareVCenterId"
      resourceId={modelId}
      eventTypeColumn="vmwareVCenterFeedEventType"
      title="vCenter Feed"
      description="Everything that has happened to this vCenter - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this vCenter yet."
    />
  );
};

export default VMwareVCenterFeedPage;
