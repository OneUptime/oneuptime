import PageComponentProps from "../PageComponentProps";
import DiscoveredDevicesTable from "../../Components/NetworkDevice/DiscoveredDevices/DiscoveredDevicesTable";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Network > Topology > Discovered Devices (OneUptime issue #5775): every
 * device the project's switches, routers and network controllers have seen
 * - POS terminals, kiosks, cameras, printers - and whether OneUptime
 * monitors it. Found by name, address, MAC or vendor; added to monitoring
 * a selection at a time, through the discovery import; hidden from the
 * topology map, or shown on it again, in bulk. It used to be the Endpoints
 * table, which could only be read, classified and deleted a row at a time.
 */
const NetworkEndpoints: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <DiscoveredDevicesTable />
    </Fragment>
  );
};

export default NetworkEndpoints;
