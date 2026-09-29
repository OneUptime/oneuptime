import PageComponentProps from "../../../PageComponentProps";
import ResourceAiInsightsPage from "../../../../Components/ResourceAiAgent/ResourceAiInsightsPage";
import { getResourceAiAgentDescriptor } from "../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The VMware vCenter's AI Insights page (AI → Insights): what OneUptime AI
 * investigated and changed on this VMware vCenter, and every command it ran here.
 * The page itself is the generic ResourceAiInsightsPage.
 */
const VMwareVCenterAiInsights: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceAiInsightsPage
      {...props}
      descriptor={getResourceAiAgentDescriptor(AiResourceType.VMwareVCenter)}
    />
  );
};

export default VMwareVCenterAiInsights;
