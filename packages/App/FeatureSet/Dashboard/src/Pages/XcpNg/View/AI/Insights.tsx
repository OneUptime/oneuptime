import PageComponentProps from "../../../PageComponentProps";
import ResourceAiInsightsPage from "../../../../Components/ResourceAiAgent/ResourceAiInsightsPage";
import { getResourceAiAgentDescriptor } from "../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The XCP-ng pool's AI Insights page (AI → Insights): what OneUptime AI
 * has learned about this XCP-ng pool from its own work there, and what
 * deserves attention. The page itself is the generic ResourceAiInsightsPage;
 * everything AI did, newest first, is AI → Logs.
 */
const XcpNgPoolAiInsights: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceAiInsightsPage
      {...props}
      descriptor={getResourceAiAgentDescriptor(AiResourceType.XcpNgPool)}
    />
  );
};

export default XcpNgPoolAiInsights;
