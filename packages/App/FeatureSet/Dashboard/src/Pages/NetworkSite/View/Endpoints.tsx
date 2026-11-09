import PageComponentProps from "../../PageComponentProps";
import DiscoveredDevicesTable from "../../../Components/NetworkDevice/DiscoveredDevices/DiscoveredDevicesTable";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The devices this site's switches, routers and network controllers have
 * seen: the Discovered Devices list (issue #5775) narrowed to the site.
 */
const NetworkSiteEndpoints: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <DiscoveredDevicesTable siteId={modelId.toString()} />
    </Fragment>
  );
};

export default NetworkSiteEndpoints;
