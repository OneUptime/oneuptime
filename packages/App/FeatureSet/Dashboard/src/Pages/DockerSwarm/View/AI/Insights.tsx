import PageComponentProps from "../../../PageComponentProps";
import ResourceAiInsightsPage from "../../../../Components/ResourceAiAgent/ResourceAiInsightsPage";
import { getResourceAiAgentDescriptor } from "../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Docker Swarm cluster's AI Insights page (AI → Insights): what OneUptime AI
 * investigated and changed on this Docker Swarm cluster, and every command it ran here.
 * The page itself is the generic ResourceAiInsightsPage.
 */
const DockerSwarmClusterAiInsights: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceAiInsightsPage
      {...props}
      descriptor={getResourceAiAgentDescriptor(
        AiResourceType.DockerSwarmCluster,
      )}
    />
  );
};

export default DockerSwarmClusterAiInsights;
