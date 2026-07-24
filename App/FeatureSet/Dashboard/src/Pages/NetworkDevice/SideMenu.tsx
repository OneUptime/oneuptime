import NetworkSideMenu from "../../Components/Network/NetworkSideMenu";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Network Devices section shares one side menu with Network Sites —
 * the whole Network area reads as a single product. See NetworkSideMenu.
 */
const NetworkDeviceSideMenu: FunctionComponent = (): ReactElement => {
  return <NetworkSideMenu />;
};

export default NetworkDeviceSideMenu;
