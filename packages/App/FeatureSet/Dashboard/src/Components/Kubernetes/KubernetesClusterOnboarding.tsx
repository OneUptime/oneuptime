import React, { ReactElement } from "react";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceGuideProps,
  ResourceOnboarding,
} from "../ResourceOnboarding/AddResourceGuide";
import KubernetesDocumentationCard from "./DocumentationCard";
import PageMap from "../../Utils/PageMap";
import { KUBERNETES_EXAMPLE_CLUSTER_NAME } from "../../Pages/Kubernetes/Utils/DocumentationMarkdown";

/*
 * Adding a cluster: name it, pick where it runs and a key, run helm, and
 * the guide's last step says when the agent connected. The cluster
 * registers itself under that name (findOrCreateByClusterIdentifier).
 */
const KUBERNETES_CLUSTER_ONBOARDING: ResourceOnboarding = {
  modelType: KubernetesCluster,
  addTitle: translationKey("Add Kubernetes Cluster"),
  addDescription: translationKey(
    "Install the OneUptime agent with Helm. The cluster shows up here as soon as the agent connects.",
  ),
  firstRunTitle: translationKey("Getting Started with Kubernetes Monitoring"),
  viewText: translationKey("View cluster"),
  viewPage: PageMap.KUBERNETES_CLUSTER_VIEW,
  name: {
    label: translationKey("Cluster name"),
    field: "clusterIdentifier",
    example: KUBERNETES_EXAMPLE_CLUSTER_NAME,
  },
  renderGuide: (props: ResourceGuideProps): ReactElement => {
    return (
      <KubernetesDocumentationCard
        title={props.title}
        description={props.description}
        clusterName={props.name}
        isBare={props.isBare}
        inputs={props.inputs}
        lastStep={props.lastStep}
      />
    );
  },
};

export default KUBERNETES_CLUSTER_ONBOARDING;
