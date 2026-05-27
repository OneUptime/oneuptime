import KubernetesClusterElement from "./KubernetesCluster";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  kubernetesClusters: Array<KubernetesCluster>;
  onNavigateComplete?: (() => void) | undefined;
}

const KubernetesClustersElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.kubernetesClusters}
      moreText="more Kubernetes clusters"
      getEachElement={(cluster: KubernetesCluster) => {
        return (
          <KubernetesClusterElement
            kubernetesCluster={cluster}
            onNavigateComplete={props.onNavigateComplete}
          />
        );
      }}
      noItemsMessage="No Kubernetes clusters."
    />
  );
};

export default KubernetesClustersElement;
