import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DockerSwarmDocumentationCard from "../../Components/DockerSwarm/DocumentationCard";

const DockerSwarmDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <DockerSwarmDocumentationCard
        title="Connect a Docker Swarm Cluster"
        description="Run the OneUptime Docker Swarm agent on a manager node. Pick how you install it, then follow the steps — the cluster appears automatically once the agent connects."
      />
    </Fragment>
  );
};

export default DockerSwarmDocumentation;
