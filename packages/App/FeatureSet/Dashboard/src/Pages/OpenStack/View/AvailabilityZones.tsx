import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackHostGroupList } from "../../../Components/OpenStack/Part/OpenStackHostGroups";

const OpenStackCloudAvailabilityZones: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <OpenStackHostGroupList kind="zone" />;
};

export default OpenStackCloudAvailabilityZones;
