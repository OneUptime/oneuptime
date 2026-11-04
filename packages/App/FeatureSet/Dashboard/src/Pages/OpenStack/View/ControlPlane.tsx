import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import OpenStackControlPlaneCard from "../../../Components/OpenStack/OpenStackControlPlaneCard";

/*
 * What the cloud stands on, on a page of its own: the Overview's card, each dependency one
 * step from its page, whatever the Overview is showing.
 */
const OpenStackCloudControlPlane: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <OpenStackControlPlaneCard modelId={modelId} />;
};

export default OpenStackCloudControlPlane;
