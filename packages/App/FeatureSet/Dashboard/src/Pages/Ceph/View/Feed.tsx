import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import CephClusterFeed from "Common/Models/DatabaseModels/CephClusterFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const CephClusterFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<CephClusterFeed>
      modelType={CephClusterFeed}
      resourceIdColumn="cephClusterId"
      resourceId={modelId}
      eventTypeColumn="cephClusterFeedEventType"
      title="Ceph Cluster Feed"
      description="Everything that has happened to this Ceph cluster - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this Ceph cluster yet."
    />
  );
};

export default CephClusterFeedPage;
