import React from "react";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import KubernetesLogsTab from "../KubernetesLogsTab";
import KubernetesPartPods from "./KubernetesPartPods";
import { KubernetesPartState } from "../../../Pages/Kubernetes/Utils/UseKubernetesPart";
import { KubernetesPartRoutes } from "../../../Pages/Kubernetes/Utils/KubernetesPartRoutes";

/*
 * The tabs a workload's or a node's page adds beside its own: the pods it
 * runs, and the log lines of all of them - what an engineer opens after
 * "it is unhealthy" on k9s or Lens, here one click from the page. The
 * agent stamps every log line with its pod's workload and node
 * (KubernetesLogsScope), so the Logs tab reads them without naming each
 * pod, in the object's own namespace.
 */

export function getKubernetesPodsTab(data: {
  kind: string;
  part: KubernetesPartState;
  routes: KubernetesPartRoutes;
}): Tab {
  return {
    name: "Pods",
    children: (
      <KubernetesPartPods
        kind={data.kind}
        read={data.part.read}
        isLoading={data.part.isLoading}
        error={data.part.error}
        routes={data.routes}
      />
    ),
  };
}

export function getKubernetesWorkloadLogsTab(data: {
  kind: string;
  name: string;
  namespace?: string | undefined;
  clusterIdentifier: string;
  clusterName?: string | undefined;
}): Tab {
  return {
    name: "Logs",
    children: (
      <KubernetesLogsTab
        clusterIdentifier={data.clusterIdentifier}
        clusterName={data.clusterName}
        workloadKind={data.kind}
        workloadName={data.name}
        namespace={data.namespace}
      />
    ),
  };
}
