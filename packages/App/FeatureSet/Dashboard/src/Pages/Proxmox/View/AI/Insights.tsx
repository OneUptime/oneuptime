import PageComponentProps from "../../../PageComponentProps";
import ResourceAiInsightsPage from "../../../../Components/ResourceAiAgent/ResourceAiInsightsPage";
import { getResourceAiAgentDescriptor } from "../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Proxmox cluster's AI Insights page (AI → Insights): what OneUptime AI
 * investigated and changed on this Proxmox cluster, and every command it ran here.
 * The page itself is the generic ResourceAiInsightsPage.
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
