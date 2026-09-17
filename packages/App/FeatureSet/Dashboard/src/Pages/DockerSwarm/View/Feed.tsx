import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import DockerSwarmClusterFeed from "Common/Models/DatabaseModels/DockerSwarmClusterFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const DockerSwarmClusterFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<DockerSwarmClusterFeed>
      modelType={DockerSwarmClusterFeed}
      resourceIdColumn="dockerSwarmClusterId"
      resourceId={modelId}
      eventTypeColumn="dockerSwarmClusterFeedEventType"
      title="Docker Swarm Cluster Feed"
      description="Everything that has happened to this Docker Swarm cluster - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this Docker Swarm cluster yet."
    />
  );
};

export default DockerSwarmClusterFeedPage;
