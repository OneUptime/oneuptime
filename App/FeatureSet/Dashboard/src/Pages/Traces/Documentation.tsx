import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";

const TracesDocumentationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return <TelemetryDocumentation telemetryType="traces" />;
};

export default TracesDocumentationPage;
