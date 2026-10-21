import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import PodmanDocumentationCard from "../../Components/Podman/DocumentationCard";

const PodmanDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <PodmanDocumentationCard
        title="Connect a Podman Host"
        description="Run the OneUptime Podman agent on the host. Pick how you run it, then follow the steps — the host appears automatically once the agent connects."
      />
    </Fragment>
  );
};

export default PodmanDocumentation;
