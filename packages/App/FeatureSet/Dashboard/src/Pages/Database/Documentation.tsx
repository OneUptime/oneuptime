import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import DatabaseDocumentationCard from "../../Components/DatabaseServer/DocumentationCard";

/*
 * The product-level install guide: pick the engine, pick an ingestion key,
 * copy the agent. Databases need no agent to appear — traces and container
 * discovery create them — so the guide is about ENGINE metrics. What those
 * are depends on the engine (Memcached has no locks or replication), so the
 * guide says it per engine rather than here.
 */
const DatabaseDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <DatabaseDocumentationCard
        title="Connect Database Engine Metrics"
        description="Databases appear on their own from your application traces and from Kubernetes, Docker and Podman. Install the OneUptime Database Agent next to a database to add its engine metrics: pick the engine, then follow the steps."
      />
    </Fragment>
  );
};

export default DatabaseDocumentation;
