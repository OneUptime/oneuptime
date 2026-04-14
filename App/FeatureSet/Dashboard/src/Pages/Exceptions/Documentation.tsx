import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";
import ExceptionsNavTabs from "../../Components/Exceptions/ExceptionsNavTabs";

const ExceptionsDocumentationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ExceptionsNavTabs active="setup" />
      <TelemetryDocumentation telemetryType="exceptions" />
    </Fragment>
  );
};

export default ExceptionsDocumentationPage;
