import PageComponentProps from "../../../PageComponentProps";
import ResourceAiLogsPage from "../../../../Components/ResourceAiAgent/ResourceAiLogsPage";
import { getResourceAiAgentDescriptor } from "../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Proxmox cluster's AI Logs page (AI → Logs): everything OneUptime AI did
 * on this Proxmox cluster, newest first — its investigations, its fixes and
 * every command it ran here. The page itself is the generic
 * ResourceAiLogsPage.
 */
const ProxmoxClusterAiLogs: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceAiLogsPage
      {...props}
      descriptor={getResourceAiAgentDescriptor(AiResourceType.ProxmoxCluster)}
    />
  );
};

export default ProxmoxClusterAiLogs;
