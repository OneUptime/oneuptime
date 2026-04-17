import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ExceptionsDashboard from "../../Components/Exceptions/ExceptionsDashboard";
import ExceptionsNavTabs from "../../Components/Exceptions/ExceptionsNavTabs";

const ExceptionsOverviewPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  return (
    <Fragment>
      <ExceptionsNavTabs active="overview" />
      <ExceptionsDashboard />
    </Fragment>
  );
};

export default ExceptionsOverviewPage;
