import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackFlavorList } from "../../../Components/OpenStack/OpenStackLists";

/*
 * A flavor's vCPUs, memory and disk are its size, what an instance of it asks for. Nothing
 * here is allocated or used, so these are the one list that says neither.
 */
const OpenStackCloudFlavors: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <OpenStackFlavorList openStackCloudId={modelId} />;
};

export default OpenStackCloudFlavors;
