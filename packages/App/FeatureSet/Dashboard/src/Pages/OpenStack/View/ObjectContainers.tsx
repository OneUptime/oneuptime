import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackObjectContainerList } from "../../../Components/OpenStack/OpenStackLists";

/*
 * Swift's containers, as far as this credential's own project goes: it reads nothing of any other project's
 * account without ResellerAdmin, recorded, so this is never the whole cloud's, and the list says so.
 */
const OpenStackCloudObjectContainers: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <OpenStackObjectContainerList openStackCloudId={modelId} />;
};

export default OpenStackCloudObjectContainers;
