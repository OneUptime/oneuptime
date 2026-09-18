import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import DockerHostFeed from "Common/Models/DatabaseModels/DockerHostFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const DockerHostFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<DockerHostFeed>
      modelType={DockerHostFeed}
      resourceIdColumn="dockerHostId"
      resourceId={modelId}
      eventTypeColumn="dockerHostFeedEventType"
      title="Docker Host Feed"
      description="Everything that has happened to this Docker host - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this Docker host yet."
    />
  );
};

export default DockerHostFeedPage;
