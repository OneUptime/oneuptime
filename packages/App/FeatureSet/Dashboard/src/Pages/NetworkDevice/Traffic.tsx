import PageComponentProps from "../PageComponentProps";
import NetworkTrafficView from "../../Components/NetworkTraffic/NetworkTrafficView";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The whole network's traffic: every device's flow records on one page -
 * which devices carry the most, who talks to whom, what for - and every
 * address that is sending flows without being a device yet, with the one
 * click that makes it one.
 */
const NetworkTraffic: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <NetworkTrafficView scope={{ kind: "network" }} />;
};

export default NetworkTraffic;
