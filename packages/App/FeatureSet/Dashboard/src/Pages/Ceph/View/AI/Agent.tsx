import PageComponentProps from "../../../PageComponentProps";
import ResourceAiAgentPage from "../../../../Components/ResourceAiAgent/ResourceAiAgentPage";
import { getResourceAiAgentDescriptor } from "../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Ceph cluster's AI agent page (AI → AI agent): whether OneUptime AI can
 * reach this Ceph cluster through its resource AI agent, and what it may do
 * there. The page itself is the generic ResourceAiAgentPage.
 */
const CephClusterAiAgent: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceAiAgentPage
      {...props}
      descriptor={getResourceAiAgentDescriptor(AiResourceType.CephCluster)}
    />
  );
};

export default CephClusterAiAgent;
