import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import React, { FunctionComponent, ReactElement } from "react";
import LlmConversationsView from "../../Components/LlmConversations/LlmConversationsView";
import StaleTablesForAiApps from "../../Components/DataObservability/StaleTablesForAiApps";

/*
 * The AI / LLM product's home: every conversation the project's AI had,
 * with what needs attention first.
 */
const LlmConversationsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ResellerPlanNotice project={props.currentProject} product="AI / LLM" />
    );
  }

  return (
    <div className="space-y-5">
      <StaleTablesForAiApps />
      <LlmConversationsView />
    </div>
  );
};

export default LlmConversationsPage;
