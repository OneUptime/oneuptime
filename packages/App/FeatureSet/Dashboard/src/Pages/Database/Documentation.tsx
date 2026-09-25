import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DatabaseDocumentationCard from "../../Components/DatabaseServer/DocumentationCard";

/*
 * The product-level install guide: pick the engine, pick an ingestion key,
 * copy the agent. Databases need no agent to appear — traces and container
 * discovery create them — so the guide is about ENGINE metrics.
 */
const DatabaseDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <DatabaseDocumentationCard
        title="Database Agent Installation Guide"
        description="Databases appear on their own from your application traces and from Kubernetes, Docker and Podman. Install the OneUptime Database Agent next to a database to add its engine metrics — connections, throughput, cache hit ratio, locks and replication."
      />
    </Fragment>
  );
};

export default DatabaseDocumentation;
