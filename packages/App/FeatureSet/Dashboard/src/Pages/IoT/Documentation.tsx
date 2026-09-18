import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import IoTDocumentationCard from "../../Components/IoT/DocumentationCard";

const IoTDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <IoTDocumentationCard
        title="Connect Your IoT Fleet"
        description="Push OpenTelemetry (OTLP) metrics from your devices or gateway to connect an IoT fleet. Once data arrives, the fleet and its devices appear automatically."
      />
    </Fragment>
  );
};

export default IoTDocumentation;
