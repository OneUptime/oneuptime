import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DockerDocumentationCard from "../../Components/Docker/DocumentationCard";

const DockerDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <DockerDocumentationCard
        title="Agent Installation Guide"
        description="Install the OneUptime Docker Agent to connect your Docker host. Once installed, the host will appear automatically."
      />
    </Fragment>
  );
};

export default DockerDocumentation;
