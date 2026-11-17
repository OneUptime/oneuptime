import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import React, { FunctionComponent, ReactElement } from "react";
import LlmAlertsView from "../../Components/LlmAlerts/LlmAlertsView";

/*
 * Being told when the AI answers badly: the project's AI / LLM monitors,
 * and one-click starting points for the alerts most AI apps want.
 */
const LlmAlertsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ResellerPlanNotice project={props.currentProject} product="AI / LLM" />
    );
  }

  return <LlmAlertsView />;
};

export default LlmAlertsPage;
