import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackImageList } from "../../../Components/OpenStack/OpenStackLists";

const OpenStackCloudImages: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <OpenStackImageList openStackCloudId={modelId} />;
};

export default OpenStackCloudImages;
