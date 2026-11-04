import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackHostGroupPage } from "../../../Components/OpenStack/Part/OpenStackHostGroups";

const OpenStackCloudAggregateDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <OpenStackHostGroupPage kind="aggregate" />;
};

export default OpenStackCloudAggregateDetail;
