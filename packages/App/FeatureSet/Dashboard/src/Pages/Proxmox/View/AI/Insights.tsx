import PageComponentProps from "../../../PageComponentProps";
import ResourceAiInsightsPage from "../../../../Components/ResourceAiAgent/ResourceAiInsightsPage";
import { getResourceAiAgentDescriptor } from "../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Proxmox cluster's AI Insights page (AI → Insights): what OneUptime AI
 * has learned about this Proxmox cluster from its own work there, and what
 * deserves attention. The page itself is the generic ResourceAiInsightsPage;
 * everything AI did, newest first, is AI → Logs.
 */
const ProxmoxClusterAiInsights: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceAiInsightsPage
      {...props}
      descriptor={getResourceAiAgentDescriptor(AiResourceType.ProxmoxCluster)}
    />
  );
};

export default ProxmoxClusterAiInsights;
