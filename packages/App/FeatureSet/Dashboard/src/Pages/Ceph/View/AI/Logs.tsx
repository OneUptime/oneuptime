import PageComponentProps from "../../../PageComponentProps";
import ResourceAiLogsPage from "../../../../Components/ResourceAiAgent/ResourceAiLogsPage";
import { getResourceAiAgentDescriptor } from "../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Ceph cluster's AI Logs page (AI → Logs): everything OneUptime AI did on
 * this Ceph cluster, newest first — its investigations, its fixes and every
 * command it ran here. The page itself is the generic ResourceAiLogsPage.
 */
const CephClusterAiLogs: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceAiLogsPage
      {...props}
      descriptor={getResourceAiAgentDescriptor(AiResourceType.CephCluster)}
    />
  );
};

export default CephClusterAiLogs;
