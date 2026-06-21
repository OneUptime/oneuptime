import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Service from "Common/Models/DatabaseModels/Service";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import React, { FunctionComponent, ReactElement } from "react";
import DockerHostElement from "../DockerHost/DockerHost";
import PodmanHostElement from "../PodmanHost/PodmanHost";
import HostElement from "../Host/Host";
import KubernetesClusterElement from "../KubernetesCluster/KubernetesCluster";
import MonitorElement from "../Monitor/Monitor";
import ServiceElement from "../Service/ServiceElement";

/*
 * Compact table-cell version of AffectedResourcesDisplay. Flattens
 * monitors/hosts/k8s/docker/services into a single list rendered through
 * TableColumnListComponent (first 3 visible, rest behind a "N more
 * resources" button) so list-page rows stay short. Each row shows the
 * resource's type icon (Server / Globe / Kubernetes / Docker / Service)
 * so the user can still tell types apart at a glance.
 *
 * Keep this in sync with AffectedResourcesPicker: if a new resource type is
 * added there, mirror it here so the picker, detail display, and table
 * column all stay aligned.
 */

type ResourceItem =
  | { _key: string; type: "Monitor"; model: Monitor }
  | { _key: string; type: "Host"; model: Host }
  | { _key: string; type: "KubernetesCluster"; model: KubernetesCluster }
  | { _key: string; type: "DockerHost"; model: DockerHost }
  | { _key: string; type: "PodmanHost"; model: PodmanHost }
  | { _key: string; type: "Service"; model: Service };

export interface ComponentProps {
  monitors?: Array<Monitor> | undefined;
  hosts?: Array<Host> | undefined;
  kubernetesClusters?: Array<KubernetesCluster> | undefined;
  dockerHosts?: Array<DockerHost> | undefined;
  podmanHosts?: Array<PodmanHost> | undefined;
  services?: Array<Service> | undefined;
  noItemsMessage?: string | undefined;
  onNavigateComplete?: (() => void) | undefined;
}

const AffectedResourcesCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const items: Array<ResourceItem> = [];

  for (const monitor of props.monitors || []) {
    items.push({
      _key: `Monitor:${monitor._id ? String(monitor._id) : Math.random()}`,
      type: "Monitor",
      model: monitor,
    });
  }
  for (const host of props.hosts || []) {
    items.push({
      _key: `Host:${host._id ? String(host._id) : Math.random()}`,
      type: "Host",
      model: host,
    });
  }
  for (const cluster of props.kubernetesClusters || []) {
    items.push({
      _key: `KubernetesCluster:${
        cluster._id ? String(cluster._id) : Math.random()
      }`,
      type: "KubernetesCluster",
      model: cluster,
    });
  }
  for (const dockerHost of props.dockerHosts || []) {
    items.push({
      _key: `DockerHost:${
        dockerHost._id ? String(dockerHost._id) : Math.random()
      }`,
      type: "DockerHost",
      model: dockerHost,
    });
  }
  for (const podmanHost of props.podmanHosts || []) {
    items.push({
      _key: `PodmanHost:${
        podmanHost._id ? String(podmanHost._id) : Math.random()
      }`,
      type: "PodmanHost",
      model: podmanHost,
    });
  }
  for (const service of props.services || []) {
    items.push({
      _key: `Service:${service._id ? String(service._id) : Math.random()}`,
      type: "Service",
      model: service,
    });
  }

  return (
    <TableColumnListComponent<ResourceItem>
      items={items}
      moreText="more resources"
      noItemsMessage={props.noItemsMessage || "No resources."}
      getEachElement={(item: ResourceItem): ReactElement => {
        if (item.type === "Monitor") {
          return (
            <MonitorElement
              monitor={item.model}
              showIcon={true}
              onNavigateComplete={props.onNavigateComplete}
            />
          );
        }
        if (item.type === "Host") {
          return (
            <HostElement
              host={item.model}
              showIcon={true}
              onNavigateComplete={props.onNavigateComplete}
            />
          );
        }
        if (item.type === "KubernetesCluster") {
          return (
            <KubernetesClusterElement
              kubernetesCluster={item.model}
              showIcon={true}
              onNavigateComplete={props.onNavigateComplete}
            />
          );
        }
        if (item.type === "DockerHost") {
          return (
            <DockerHostElement
              dockerHost={item.model}
              showIcon={true}
              onNavigateComplete={props.onNavigateComplete}
            />
          );
        }
        if (item.type === "PodmanHost") {
          return (
            <PodmanHostElement
              podmanHost={item.model}
              showIcon={true}
              onNavigateComplete={props.onNavigateComplete}
            />
          );
        }
        return (
          <ServiceElement
            service={item.model}
            onNavigateComplete={props.onNavigateComplete}
          />
        );
      }}
    />
  );
};

export default AffectedResourcesCell;
