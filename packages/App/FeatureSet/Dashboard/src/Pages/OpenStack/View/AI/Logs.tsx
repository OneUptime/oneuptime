import PageComponentProps from "../../../PageComponentProps";
import ResourceAiLogsPage from "../../../../Components/ResourceAiAgent/ResourceAiLogsPage";
import { getResourceAiAgentDescriptor } from "../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The OpenStack cloud's AI Logs page (AI → Logs): everything OneUptime AI did on
 * this cloud, newest first: its investigations and every command it ran here. The
 * page itself is the generic ResourceAiLogsPage.
 */
const OpenStackCloudAiLogs: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <ResourceAiLogsPage
      {...props}
      descriptor={getResourceAiAgentDescriptor(AiResourceType.OpenStackCloud)}
    />
  );
};

export default OpenStackCloudAiLogs;
