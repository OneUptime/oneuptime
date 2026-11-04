import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackStoragePoolList } from "../../../Components/OpenStack/OpenStackLists";

const OpenStackCloudStoragePools: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <OpenStackStoragePoolList openStackCloudId={modelId} />;
};

export default OpenStackCloudStoragePools;
