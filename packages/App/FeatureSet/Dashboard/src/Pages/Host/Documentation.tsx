import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
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
      {/* The manual guide is the next card: no topic pointing to it. */}
      <AddHostGuide hideManualInstallTopic={true} />
      <FoldedSection
        title="Install the collector yourself"
        icon={IconProp.Book}
        summary="Or install the OpenTelemetry Collector and write its config.yaml on each host yourself. Such a host shows up here once its telemetry arrives; OneUptime does not send it a config."
        isElevated={true}
        dataTestId="host-manual-guide"
      >
        <HostDocumentationCard
          title="Install the collector yourself"
          description=""
          isBare={true}
        />
      </FoldedSection>
    </Fragment>
  );
};

export default HostDocumentation;
