import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import OpenStackBareMetalClassesCard from "../../../Components/OpenStack/OpenStackBareMetalClassesCard";
import OpenStackBareMetalNotices from "../../../Components/OpenStack/OpenStackBareMetalNotices";
import { OpenStackBareMetalNodeList } from "../../../Components/OpenStack/OpenStackLists";

/*
 * The machines Ironic manages, for a cloud that runs it: the side menu has no such entry on a cloud
 * without it. What this can and can't see first, then what there is of each class, then each node.
 */
const OpenStackCloudBareMetalNodes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <OpenStackBareMetalNotices openStackCloudId={modelId} />
      <OpenStackBareMetalClassesCard openStackCloudId={modelId} />
      <OpenStackBareMetalNodeList openStackCloudId={modelId} />
    </Fragment>
  );
};

export default OpenStackCloudBareMetalNodes;
