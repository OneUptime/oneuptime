import PageComponentProps from "../../../../PageComponentProps";
import ResourceAiAgentPage from "../../../../../Components/ResourceAiAgent/ResourceAiAgentPage";
import useCloudAccountAiDescriptor, {
  CloudAccountAiDescriptorRead,
} from "./UseCloudAccountAiDescriptor";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A cloud account's AI agent page (AI → AI agent): whether its Cloud AI
 * agent runs, how far AI may go there, Test connection, Reset agent, and
 * Change, which shows the updated setup command. The page itself is the
 * generic ResourceAiAgentPage, with the account's cloud's descriptor.
 */
const CloudAccountAiAgent: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const read: CloudAccountAiDescriptorRead = useCloudAccountAiDescriptor();

  if (read.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (!read.descriptor) {
    return <ErrorMessage message={read.error || "Cloud account not found."} />;
  }

  return (
    <ResourceAiAgentPage
      {...props}
      descriptor={read.descriptor}
      cloudAccount={read.account}
    />
  );
};

export default CloudAccountAiAgent;
