import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackInstanceList } from "../../../Components/OpenStack/OpenStackLists";

/*
 * Every instance of the cloud, a page at a time, filtered and sorted on the server: a large
 * cloud holds hundreds of thousands of them.
 */
const OpenStackCloudInstances: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <OpenStackInstanceList openStackCloudId={modelId} />;
};

export default OpenStackCloudInstances;
