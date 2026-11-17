import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
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
      <ResellerPlanNotice project={props.currentProject} product="AI / LLM" />
    );
  }

  return <LlmConversationView />;
};

export default LlmConversationViewPage;
