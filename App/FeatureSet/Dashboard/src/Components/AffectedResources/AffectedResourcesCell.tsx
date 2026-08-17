import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Service from "Common/Models/DatabaseModels/Service";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import React, { FunctionComponent, ReactElement } from "react";
import CephClusterElement from "../Ceph/CephClusterElement";
import DockerHostElement from "../DockerHost/DockerHost";
import DockerSwarmClusterElement from "../DockerSwarm/DockerSwarmClusterElement";
import IoTFleetElement from "../IoT/IoTFleetElement";
import ProxmoxClusterElement from "../Proxmox/ProxmoxClusterElement";
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
  | { _key: string; type: "ProxmoxCluster"; model: ProxmoxCluster }
  | { _key: string; type: "CephCluster"; model: CephCluster }
  | { _key: string; type: "DockerSwarmCluster"; model: DockerSwarmCluster }
  | { _key: string; type: "IoTFleet"; model: IoTFleet }
  | { _key: string; type: "Service"; model: Service };

export interface ComponentProps {
  monitors?: Array<Monitor> | undefined;
  hosts?: Array<Host> | undefined;
  kubernetesClusters?: Array<KubernetesCluster> | undefined;
  dockerHosts?: Array<DockerHost> | undefined;
  podmanHosts?: Array<PodmanHost> | undefined;
  proxmoxClusters?: Array<ProxmoxCluster> | undefined;
  cephClusters?: Array<CephCluster> | undefined;
  dockerSwarmClusters?: Array<DockerSwarmCluster> | undefined;
  iotFleets?: Array<IoTFleet> | undefined;
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
  for (const cluster of props.proxmoxClusters || []) {
    items.push({
      _key: `ProxmoxCluster:${cluster._id ? String(cluster._id) : Math.random()}`,
      type: "ProxmoxCluster",
      model: cluster,
    });
  }
  for (const cluster of props.cephClusters || []) {
    items.push({
      _key: `CephCluster:${cluster._id ? String(cluster._id) : Math.random()}`,
      type: "CephCluster",
      model: cluster,
    });
  }
  for (const cluster of props.dockerSwarmClusters || []) {
    items.push({
      _key: `DockerSwarmCluster:${
        cluster._id ? String(cluster._id) : Math.random()
      }`,
      type: "DockerSwarmCluster",
      model: cluster,
    });
  }
  for (const fleet of props.iotFleets || []) {
    items.push({
      _key: `IoTFleet:${fleet._id ? String(fleet._id) : Math.random()}`,
      type: "IoTFleet",
      model: fleet,
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
        if (item.type === "ProxmoxCluster") {
          return (
            <ProxmoxClusterElement
              proxmoxCluster={item.model}
              showIcon={true}
              onNavigateComplete={props.onNavigateComplete}
            />
          );
        }
        if (item.type === "CephCluster") {
          return (
            <CephClusterElement
              cephCluster={item.model}
              showIcon={true}
              onNavigateComplete={props.onNavigateComplete}
            />
          );
        }
        if (item.type === "DockerSwarmCluster") {
          return (
            <DockerSwarmClusterElement
              dockerSwarmCluster={item.model}
              showIcon={true}
              onNavigateComplete={props.onNavigateComplete}
            />
          );
        }
        if (item.type === "IoTFleet") {
          return (
            <IoTFleetElement
              iotFleet={item.model}
              showIcon={true}
              onNavigateComplete={props.onNavigateComplete}
            />
          );
        }
        /*
         * Service is matched explicitly rather than left as the
         * catch-all it used to be: any type without a branch above fell
         * through to ServiceElement, so a cluster rendered as if it were
         * a service. `unhandled: never` turns "added a type to
         * ResourceItem and forgot a branch here" into a compile error
         * instead of a mislabelled row.
         */
        if (item.type === "Service") {
          return (
            <ServiceElement
              service={item.model}
              onNavigateComplete={props.onNavigateComplete}
            />
          );
        }

        const unhandled: never = item;
        return <>{String(unhandled)}</>;
      }}
    />
  );
};

export default AffectedResourcesCell;
