import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { OpenStackSubnetList } from "../../../Components/OpenStack/OpenStackLists";
import OpenStackLimitedViewNotice from "../../../Components/OpenStack/Part/OpenStackLimitedViewNotice";

const OpenStackCloudSubnets: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <OpenStackLimitedViewNotice
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.Subnet}
      />
      <OpenStackSubnetList openStackCloudId={modelId} />
    </Fragment>
  );
};

export default OpenStackCloudSubnets;
