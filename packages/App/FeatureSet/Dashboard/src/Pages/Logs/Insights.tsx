import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import React, { FunctionComponent, ReactElement } from "react";
import LogsDashboard from "../../Components/Logs/LogsDashboard";

const LogsInsightsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return <ResellerPlanNotice project={props.currentProject} product="Logs" />;
  }

  return <LogsDashboard />;
};

export default LogsInsightsPage;
