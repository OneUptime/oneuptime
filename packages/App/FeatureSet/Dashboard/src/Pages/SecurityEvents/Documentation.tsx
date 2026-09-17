import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { FunctionComponent, ReactElement } from "react";
import SecurityEventsSetupGuide from "../../Components/SecurityEvents/SecurityEventsSetupGuide";

const SecurityEventsDocumentationPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  /*
   * Same gate as the events tab: a reseller plan without telemetry cannot
   * ingest security events, so a guide explaining how to send them would
   * be instructions for something that gets rejected at the door.
   */
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  return <SecurityEventsSetupGuide />;
};

export default SecurityEventsDocumentationPage;
