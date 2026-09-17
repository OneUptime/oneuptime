import PageComponentProps from "../PageComponentProps";
import NetworkTopologyExplorer from "../../Components/Topology/NetworkTopologyExplorer";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The Network Devices section's topology tab. The same view is also
 * surfaced on the Topology page's Network tab — the shared component
 * owns fetch/refresh/render; this page is just the entry point network
 * engineers expect inside their own section.
 *
 * It opens on the site hierarchy and drills into the device graph, rather
 * than drawing every device in the project at once (issue #3320). Projects
 * with no sites — or no devices attached to them — still get the flat map;
 * the explorer decides which, and the flat map stays one click away either
 * way.
 */
const NetworkDeviceTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <NetworkTopologyExplorer />
    </Fragment>
  );
};

export default NetworkDeviceTopology;
