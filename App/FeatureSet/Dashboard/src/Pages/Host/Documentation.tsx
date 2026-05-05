import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import HostDocumentationCard from "../../Components/Host/DocumentationCard";

const HostDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <HostDocumentationCard
        title="Host Monitoring Setup Guide"
        description="Configure your OpenTelemetry Collector to forward host metrics, processes, and logs to OneUptime. Once telemetry arrives, the host will appear here automatically."
      />
    </Fragment>
  );
};

export default HostDocumentation;
