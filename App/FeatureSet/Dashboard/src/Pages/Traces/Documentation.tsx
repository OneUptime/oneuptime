import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";
import TracesNavTabs from "../../Components/Traces/TracesNavTabs";

const TracesDocumentationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <TracesNavTabs active="setup" />
      <TelemetryDocumentation telemetryType="traces" />
    </Fragment>
  );
};

export default TracesDocumentationPage;
