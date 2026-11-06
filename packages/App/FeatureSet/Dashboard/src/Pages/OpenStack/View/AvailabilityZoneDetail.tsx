import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackHostGroupPage } from "../../../Components/OpenStack/Part/OpenStackHostGroups";

const OpenStackCloudAvailabilityZoneDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <OpenStackHostGroupPage kind="zone" />;
};

export default OpenStackCloudAvailabilityZoneDetail;
