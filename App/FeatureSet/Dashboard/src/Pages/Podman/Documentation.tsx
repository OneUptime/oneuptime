import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import PodmanDocumentationCard from "../../Components/Podman/DocumentationCard";

const PodmanDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <PodmanDocumentationCard
        title="Agent Installation Guide"
        description="Install the OneUptime Podman Agent to connect your Podman host. Once installed, the host will appear automatically."
      />
    </Fragment>
  );
};

export default PodmanDocumentation;
