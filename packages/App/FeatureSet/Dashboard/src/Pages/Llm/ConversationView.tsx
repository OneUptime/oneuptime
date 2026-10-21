import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { FunctionComponent, ReactElement } from "react";
import LlmConversationView from "../../Components/LlmConversations/LlmConversationView";

/*
 * One conversation, to read or to replay. The conversation is named by the
 * page's own path (see LlmConversationRoutes), not a router param: its id is
 * the app's own string and travels as one encoded path segment.
 */
const LlmConversationViewPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  return <LlmConversationView />;
};

export default LlmConversationViewPage;
