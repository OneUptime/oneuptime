import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
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
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  return <LlmAlertsView />;
};

export default LlmAlertsPage;
