import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackSubnetList } from "../../../Components/OpenStack/OpenStackLists";

const OpenStackCloudSubnets: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <OpenStackSubnetList openStackCloudId={modelId} />;
};

export default OpenStackCloudSubnets;
