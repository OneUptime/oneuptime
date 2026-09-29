import NetworkSideMenu from "../../Components/Network/NetworkSideMenu";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Network Sites section shares one side menu with Network Devices —
 * the whole Network area reads as a single product. See NetworkSideMenu,
 * which also carries the getNetworkMapRootRoute wiring for the Network
 * Map entry (NetworkSitePageInvariants.test.ts pins it there).
 */
const NetworkSiteSideMenu: FunctionComponent = (): ReactElement => {
  return <NetworkSideMenu />;
};

export default NetworkSiteSideMenu;
