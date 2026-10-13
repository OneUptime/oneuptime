import PageComponentProps from "../PageComponentProps";
import NetworkEventsView from "../../Components/NetworkEvents/NetworkEventsView";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The whole network's events: what every device reported - links, tunnels,
 * failovers, restarts, sign-ins - read out of each vendor's syslog and
 * traps into one vocabulary, with every address that sends syslog without
 * being a device yet, and the one click that makes it one.
 */
const NetworkEvents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <NetworkEventsView scope={{ kind: "network" }} />;
};

export default NetworkEvents;
