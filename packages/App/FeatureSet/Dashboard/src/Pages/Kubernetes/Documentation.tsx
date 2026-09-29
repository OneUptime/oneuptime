import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import KubernetesDocumentationCard from "../../Components/Kubernetes/DocumentationCard";

const KubernetesDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <KubernetesDocumentationCard
        clusterName="my-cluster"
        title="Agent Installation Guide"
        description="Install the OneUptime Kubernetes Agent using Helm to connect your cluster. Once installed, the cluster will appear automatically."
      />
    </Fragment>
  );
};

export default KubernetesDocumentation;
