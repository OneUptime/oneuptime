import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import ProxmoxClusterFeed from "Common/Models/DatabaseModels/ProxmoxClusterFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const ProxmoxClusterFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<ProxmoxClusterFeed>
      modelType={ProxmoxClusterFeed}
      resourceIdColumn="proxmoxClusterId"
      resourceId={modelId}
      eventTypeColumn="proxmoxClusterFeedEventType"
      title="Proxmox Cluster Feed"
      description="Everything that has happened to this Proxmox cluster - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this Proxmox cluster yet."
    />
  );
};

export default ProxmoxClusterFeedPage;
