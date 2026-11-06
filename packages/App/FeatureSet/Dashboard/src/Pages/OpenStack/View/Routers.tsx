import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { OpenStackRouterList } from "../../../Components/OpenStack/OpenStackLists";
import OpenStackLimitedViewNotice from "../../../Components/OpenStack/Part/OpenStackLimitedViewNotice";
import useOpenStackNetworkBackend from "../../../Components/OpenStack/Part/UseOpenStackNetworkBackend";
import { OpenStackNetworkBackend } from "../Utils/OpenStackPartFacts";

/*
 * Every router, and the L3 agents that hold each one. A router whose agents are all dead
 * carries no traffic, whatever its own status says. On OVN no agent holds a router, which
 * reads Not applicable: the cloud's own agent list says which it is.
 */
const OpenStackCloudRouters: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const backend: OpenStackNetworkBackend = useOpenStackNetworkBackend(modelId);

  return (
    <Fragment>
      <OpenStackLimitedViewNotice
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.Router}
      />
      <OpenStackRouterList openStackCloudId={modelId} backend={backend} />
    </Fragment>
  );
};

export default OpenStackCloudRouters;
