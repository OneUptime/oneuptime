import PageComponentProps from "../../../PageComponentProps";
import ResourceAiAgentPage from "../../../../Components/ResourceAiAgent/ResourceAiAgentPage";
import { getResourceAiAgentDescriptor } from "../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The XCP-ng pool's AI agent page (AI → AI agent): whether OneUptime AI can
 * reach this XCP-ng pool through its resource AI agent, and what it may do
 * there. The page itself is the generic ResourceAiAgentPage.
 */
const XcpNgPoolAiAgent: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceAiAgentPage
      {...props}
      descriptor={getResourceAiAgentDescriptor(AiResourceType.XcpNgPool)}
    />
  );
};

export default XcpNgPoolAiAgent;
