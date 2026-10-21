import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import KubernetesDocumentationCard from "../../Components/Kubernetes/DocumentationCard";

const KubernetesDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <KubernetesDocumentationCard
        title="Connect a Kubernetes Cluster"
        description="Install the OneUptime Kubernetes agent with Helm. Pick where your cluster runs, then follow the steps — the cluster appears automatically once the agent connects."
      />
    </Fragment>
  );
};

export default KubernetesDocumentation;
