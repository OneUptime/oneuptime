import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import HostFeed from "Common/Models/DatabaseModels/HostFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const HostFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<HostFeed>
      modelType={HostFeed}
      resourceIdColumn="hostId"
      resourceId={modelId}
      eventTypeColumn="hostFeedEventType"
      title="Host Feed"
      description="Everything that has happened to this host - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this host yet."
    />
  );
};

export default HostFeedPage;
