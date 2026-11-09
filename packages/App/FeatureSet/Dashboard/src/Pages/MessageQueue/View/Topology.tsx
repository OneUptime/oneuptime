import PageComponentProps from "../../PageComponentProps";
import MessageQueueTopologyPage from "../../../Components/MessageQueue/Topology/MessageQueueTopologyPage";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A queue's Topology tab: the Queues topology focused on this queue - where
 * its messages come from and where they go next - with the way to the whole
 * project's map.
 */
const MessageQueueViewTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  return <MessageQueueTopologyPage anchorQueueId={modelId.toString()} />;
};

export default MessageQueueViewTopology;
