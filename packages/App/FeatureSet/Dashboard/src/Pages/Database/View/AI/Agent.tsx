import PageComponentProps from "../../../PageComponentProps";
import ResourceAiAgentPage from "../../../../Components/ResourceAiAgent/ResourceAiAgentPage";
import { getResourceAiAgentDescriptor } from "../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The database server's AI agent page (AI → AI agent): whether OneUptime AI can
 * reach this database server through its resource AI agent, and what it may do
 * there. The page itself is the generic ResourceAiAgentPage.
 */
const DatabaseServerAiAgent: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceAiAgentPage
      {...props}
      descriptor={getResourceAiAgentDescriptor(AiResourceType.DatabaseServer)}
    />
  );
};

export default DatabaseServerAiAgent;
