import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import React, { FunctionComponent, ReactElement } from "react";
import DashboardLogsViewer from "../../Components/Logs/LogsViewer";

const Services: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage error="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  return (
    <DashboardLogsViewer
      showFilters={true}
      telemetryServiceIds={[]}
      enableRealtime={false}
      id="logs"
    />
  );
};

export default Services;
