import PageComponentProps from "../../../../PageComponentProps";
import ResourceAiLogsPage from "../../../../../Components/ResourceAiAgent/ResourceAiLogsPage";
import useCloudAccountAiDescriptor, {
  CloudAccountAiDescriptorRead,
} from "./UseCloudAccountAiDescriptor";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A cloud account's AI Logs page (AI → Logs): every operation OneUptime AI
 * ran or proposed in the account, newest first. The page itself is the
 * generic ResourceAiLogsPage, with the account's cloud's descriptor.
 */
const CloudAccountAiLogs: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const read: CloudAccountAiDescriptorRead = useCloudAccountAiDescriptor();

  if (read.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (!read.descriptor) {
    return <ErrorMessage message={read.error || "Cloud account not found."} />;
  }

  return <ResourceAiLogsPage {...props} descriptor={read.descriptor} />;
};

export default CloudAccountAiLogs;
