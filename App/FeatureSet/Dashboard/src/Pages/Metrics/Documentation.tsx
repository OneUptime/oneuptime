import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";
import MetricsNavTabs from "../../Components/Metrics/MetricsNavTabs";

const MetricsDocumentationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <MetricsNavTabs active="setup" />
      <TelemetryDocumentation telemetryType="metrics" />
    </Fragment>
  );
};

export default MetricsDocumentationPage;
