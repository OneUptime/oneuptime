import PageComponentProps from "../PageComponentProps";
import MessageQueueTopologyPage from "../../Components/MessageQueue/Topology/MessageQueueTopologyPage";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Queues → Topology: how messages flow between every service and queue of
 * the project (Components/MessageQueue/Topology).
 */
const MessageQueueTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <MessageQueueTopologyPage />;
};

export default MessageQueueTopology;
