import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import MetricsViewer from "../../Components/Metrics/MetricsViewer";
import MetricsNavTabs from "../../Components/Metrics/MetricsNavTabs";

const MetricsPage: FunctionComponent<PageComponentProps> = (
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
      <MetricsNavTabs active="viewer" />
      <MetricsViewer />
    </Fragment>
  );
};

export default MetricsPage;
