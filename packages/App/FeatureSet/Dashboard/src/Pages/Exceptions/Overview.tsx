import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import React, { FunctionComponent, ReactElement } from "react";
import ExceptionsDashboard from "../../Components/Exceptions/ExceptionsDashboard";

const ExceptionsOverviewPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ResellerPlanNotice project={props.currentProject} product="Exceptions" />
    );
  }

  return <ExceptionsDashboard />;
};

export default ExceptionsOverviewPage;
