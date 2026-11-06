import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackHostGroupList } from "../../../Components/OpenStack/Part/OpenStackHostGroups";

const OpenStackCloudAggregates: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <OpenStackHostGroupList kind="aggregate" />;
};

export default OpenStackCloudAggregates;
