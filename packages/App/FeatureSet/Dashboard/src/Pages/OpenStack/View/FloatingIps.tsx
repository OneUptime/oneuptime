import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { OpenStackFloatingIpList } from "../../../Components/OpenStack/OpenStackLists";
import OpenStackLimitedViewNotice from "../../../Components/OpenStack/Part/OpenStackLimitedViewNotice";

const OpenStackCloudFloatingIps: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <OpenStackLimitedViewNotice
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.FloatingIp}
      />
      <OpenStackFloatingIpList openStackCloudId={modelId} />
    </Fragment>
  );
};

export default OpenStackCloudFloatingIps;
