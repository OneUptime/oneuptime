import PageComponentProps from "../PageComponentProps";
import NetworkTopologyLiveView from "../../Components/Topology/NetworkTopologyLiveView";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The Network Devices section's topology tab. The same view is also
 * surfaced on the Topology page's Network tab — the shared component
 * owns fetch/refresh/render; this page is just the entry point network
 * engineers expect inside their own section.
 */
const NetworkDeviceTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <NetworkTopologyLiveView />
    </Fragment>
  );
};

export default NetworkDeviceTopology;
