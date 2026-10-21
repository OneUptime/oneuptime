import PageComponentProps from "../../../PageComponentProps";
import ResourceAiLogsPage from "../../../../Components/ResourceAiAgent/ResourceAiLogsPage";
import { getResourceAiAgentDescriptor } from "../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Docker host's AI Logs page (AI → Logs): everything OneUptime AI did on
 * this Docker host, newest first — its investigations, its fixes and every
 * command it ran here. The page itself is the generic ResourceAiLogsPage.
 */
const DockerHostAiLogs: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceAiLogsPage
      {...props}
      descriptor={getResourceAiAgentDescriptor(AiResourceType.DockerHost)}
    />
  );
};

export default DockerHostAiLogs;
