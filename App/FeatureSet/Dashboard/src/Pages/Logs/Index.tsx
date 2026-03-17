import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DashboardLogsViewer from "../../Components/Logs/LogsViewer";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";

const LogsPage: FunctionComponent<PageComponentProps> = (
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
      <DashboardLogsViewer
        showFilters={true}
        serviceIds={[]}
        limit={100}
        enableRealtime={true}
        id="logs"
      />
      <TelemetryDocumentation telemetryType="logs" />
    </Fragment>
  );
};

export default LogsPage;
