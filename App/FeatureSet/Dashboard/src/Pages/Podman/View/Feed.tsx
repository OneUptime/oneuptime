import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import PodmanHostFeed from "Common/Models/DatabaseModels/PodmanHostFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const PodmanHostFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<PodmanHostFeed>
      modelType={PodmanHostFeed}
      resourceIdColumn="podmanHostId"
      resourceId={modelId}
      eventTypeColumn="podmanHostFeedEventType"
      title="Podman Host Feed"
      description="Everything that has happened to this Podman host - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this Podman host yet."
    />
  );
};

export default PodmanHostFeedPage;
