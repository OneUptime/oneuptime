import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";
import LogsNavTabs from "../../Components/Logs/LogsNavTabs";

const LogsDocumentationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <LogsNavTabs active="setup" />
      <TelemetryDocumentation telemetryType="logs" />
    </Fragment>
  );
};

export default LogsDocumentationPage;
