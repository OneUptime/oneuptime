import PageComponentProps from "../PageComponentProps";
import NetworkTopologyView from "../../Components/NetworkDevice/NetworkTopologyView";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The Network Devices section's topology tab. The same view is also
 * surfaced on the Topology page's Network tab — the shared component
 * owns fetch/render; this page is just the entry point network
 * engineers expect inside their own section.
 */
const NetworkDeviceTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <NetworkTopologyView />
    </Fragment>
  );
};

export default NetworkDeviceTopology;
