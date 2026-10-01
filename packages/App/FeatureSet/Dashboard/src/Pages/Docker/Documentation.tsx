import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DockerDocumentationCard from "../../Components/Docker/DocumentationCard";

const DockerDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <DockerDocumentationCard
        title="Connect a Docker Host"
        description="Run the OneUptime Docker agent on the host. Pick how you run it, then follow the steps — the host appears automatically once the agent connects."
      />
    </Fragment>
  );
};

export default DockerDocumentation;
