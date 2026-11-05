import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { OpenStackShareList } from "../../../Components/OpenStack/OpenStackLists";
import OpenStackLimitedViewNotice from "../../../Components/OpenStack/Part/OpenStackLimitedViewNotice";

/*
 * Every Manila share, in Manila's own words. A share in error stays that way until someone deals with
 * it, and one left on its way for an hour reads Stuck: Manila has no timeout of its own for that.
 */
const OpenStackCloudShares: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <OpenStackLimitedViewNotice
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.Share}
      />
      <OpenStackShareList openStackCloudId={modelId} />
    </Fragment>
  );
};

export default OpenStackCloudShares;
