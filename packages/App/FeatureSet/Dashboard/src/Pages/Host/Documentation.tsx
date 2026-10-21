import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import AddHostGuide from "../../Components/HostCollector/AddHostGuide";
import HostDocumentationCard from "../../Components/Host/DocumentationCard";

/*
 * How to add hosts: the one command OneUptime's default is, then the manual
 * guide for a collector you install and configure yourself.
 */
const HostDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <AddHostGuide />
      <HostDocumentationCard
        title="Install the collector yourself"
        description="Or install the OpenTelemetry Collector and write its config.yaml on each host yourself. Such a host shows up here once its telemetry arrives; OneUptime does not send it a config."
      />
    </Fragment>
  );
};

export default HostDocumentation;
