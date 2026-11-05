import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { OpenStackContainerClusterList } from "../../../Components/OpenStack/OpenStackLists";
import OpenStackLimitedViewNotice from "../../../Components/OpenStack/Part/OpenStackLimitedViewNotice";

/*
 * Every Kubernetes cluster Magnum built. A Magnum cluster is not one of OneUptime's Kubernetes
 * clusters, which report through their own agent: this is what Magnum says about building it.
 */
const OpenStackCloudContainerClusters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <OpenStackLimitedViewNotice
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.ContainerCluster}
      />
      <OpenStackContainerClusterList openStackCloudId={modelId} />
    </Fragment>
  );
};

export default OpenStackCloudContainerClusters;
