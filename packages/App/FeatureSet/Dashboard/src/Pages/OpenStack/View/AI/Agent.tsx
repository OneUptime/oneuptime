import PageComponentProps from "../../../PageComponentProps";
import OpenStackRunbookTemplatesCard from "../../../../Components/OpenStack/OpenStackRunbookTemplatesCard";
import ResourceAiAgentPage from "../../../../Components/ResourceAiAgent/ResourceAiAgentPage";
import { getResourceAiAgentDescriptor } from "../../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The OpenStack cloud's AI agent page (AI → AI agent): whether OneUptime AI can
 * reach this cloud through its resource AI agent, and what it may do there. The
 * page itself is the generic ResourceAiAgentPage.
 */
const OpenStackCloudAiAgent: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ResourceAiAgentPage
        {...props}
        descriptor={getResourceAiAgentDescriptor(AiResourceType.OpenStackCloud)}
      />
      <OpenStackRunbookTemplatesCard />
    </Fragment>
  );
};

export default OpenStackCloudAiAgent;
