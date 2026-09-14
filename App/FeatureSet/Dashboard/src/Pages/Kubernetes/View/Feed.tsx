import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import KubernetesClusterFeed from "Common/Models/DatabaseModels/KubernetesClusterFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const KubernetesClusterFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<KubernetesClusterFeed>
      modelType={KubernetesClusterFeed}
      resourceIdColumn="kubernetesClusterId"
      resourceId={modelId}
      eventTypeColumn="kubernetesClusterFeedEventType"
      title="Kubernetes Cluster Feed"
      description="Everything that has happened to this Kubernetes cluster - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this Kubernetes cluster yet."
    />
  );
};

export default KubernetesClusterFeedPage;
