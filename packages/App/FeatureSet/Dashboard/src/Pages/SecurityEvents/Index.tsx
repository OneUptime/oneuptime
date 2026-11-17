import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import React, { FunctionComponent, ReactElement } from "react";
import SecurityEventsViewer from "../../Components/SecurityEvents/SecurityEventsViewer";

const SecurityEventsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
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

  return <SecurityEventsViewer />;
};

export default SecurityEventsPage;
