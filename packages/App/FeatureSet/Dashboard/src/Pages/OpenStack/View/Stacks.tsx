import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { OpenStackStackList } from "../../../Components/OpenStack/OpenStackLists";
import OpenStackLimitedViewNotice from "../../../Components/OpenStack/Part/OpenStackLimitedViewNotice";

/*
 * Every Heat stack, in Heat's own words. A stack in a failed state stays that way until someone
 * updates or deletes it, and one left in progress past Heat's own timeout reads Stuck.
 */
const OpenStackCloudStacks: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <OpenStackLimitedViewNotice
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.Stack}
      />
      <OpenStackStackList openStackCloudId={modelId} />
    </Fragment>
  );
};

export default OpenStackCloudStacks;
