import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import React, { FunctionComponent, ReactElement } from "react";
import SecurityEventsSetupGuide from "../../Components/SecurityEvents/SecurityEventsSetupGuide";

const SecurityEventsDocumentationPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  /*
   * Same gate as the Events page: a reseller plan without telemetry cannot
   * ingest security events, so a guide explaining how to send them would
   * be instructions for something that gets rejected at the door.
   */
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ResellerPlanNotice
        project={props.currentProject}
        product="Security Events"
      />
    );
  }

  return <SecurityEventsSetupGuide />;
};

export default SecurityEventsDocumentationPage;
