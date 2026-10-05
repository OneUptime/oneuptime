import PageComponentProps from "../../../PageComponentProps";
import ResourceAiLogsPage from "../../../../Components/ResourceAiAgent/ResourceAiLogsPage";
import { getResourceAiAgentDescriptor } from "../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The VMware vCenter's AI Logs page (AI → Logs): everything OneUptime AI did
 * on this VMware vCenter, newest first — its investigations, its fixes and
 * every command it ran here. The page itself is the generic
 * ResourceAiLogsPage.
 */
const VMwareVCenterAiLogs: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceAiLogsPage
      {...props}
      descriptor={getResourceAiAgentDescriptor(AiResourceType.VMwareVCenter)}
    />
  );
};

export default VMwareVCenterAiLogs;
