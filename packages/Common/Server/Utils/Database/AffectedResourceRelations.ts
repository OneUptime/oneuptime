import CephClusterService from "../../Services/CephClusterService";
import DatabaseServerService from "../../Services/DatabaseServerService";
import DockerHostService from "../../Services/DockerHostService";
import DockerResourceService from "../../Services/DockerResourceService";
import DockerSwarmClusterService from "../../Services/DockerSwarmClusterService";
import HostService from "../../Services/HostService";
import IoTFleetService from "../../Services/IoTFleetService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import KubernetesContainerService from "../../Services/KubernetesContainerService";
import KubernetesResourceService from "../../Services/KubernetesResourceService";
import NetworkSiteService from "../../Services/NetworkSiteService";
import PodmanHostService from "../../Services/PodmanHostService";
import PodmanResourceService from "../../Services/PodmanResourceService";
import ProxmoxClusterService from "../../Services/ProxmoxClusterService";
import ServiceService from "../../Services/ServiceService";
import VMwareVCenterService from "../../Services/VMwareVCenterService";
import { ProjectScopedRelation } from "./ProjectScopedReferenceValidator";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * The affected-resource lists that alerts, incidents, scheduled maintenance
 * events and their templates carry — the hosts, clusters, container hosts,
 * services and so on that the dashboard's resource picker edits and the
 * monitor workers fill in. Each id becomes a join row, and each join row puts
 * the record on that resource's Activity tab and badge count and lets this
 * project's views, which read the relation as root, show that resource's
 * name. So every id must belong to the record's own project; each of those
 * services runs these through the same check as its other relation lists.
 *
 * Not every model carries every list (only scheduled maintenance events have
 * network sites; templates have five of these), so only the lists `model`
 * has are returned: a list the model lacks cannot be in its payload, and
 * reading it back on update would select a relation the model does not have.
 *
 * Built per call rather than at module load: these services sit in an
 * import graph that loops back to the callers, and a module-level table
 * would capture whichever of them had not finished loading yet as
 * undefined.
 */
export function getAffectedResourceRelations(
  model: DatabaseBaseModel,
): Array<ProjectScopedRelation> {
  return getAllAffectedResourceRelations().filter(
    (relation: ProjectScopedRelation) => {
      return model.hasColumn(relation.column);
    },
  );
}

function getAllAffectedResourceRelations(): Array<ProjectScopedRelation> {
  return [
    {
      column: "hosts",
      modelName: "Host",
      service: HostService,
    },
    {
      column: "kubernetesClusters",
      modelName: "Kubernetes Cluster",
      service: KubernetesClusterService,
    },
    {
      column: "kubernetesResources",
      modelName: "Kubernetes Resource",
      service: KubernetesResourceService,
    },
    {
      column: "kubernetesContainers",
      modelName: "Kubernetes Container",
      service: KubernetesContainerService,
    },
    {
      column: "dockerHosts",
      modelName: "Docker Host",
      service: DockerHostService,
    },
    {
      column: "podmanHosts",
      modelName: "Podman Host",
      service: PodmanHostService,
    },
    {
      column: "proxmoxClusters",
      modelName: "Proxmox Cluster",
      service: ProxmoxClusterService,
    },
    {
      column: "vmwareVCenters",
      modelName: "VMware vCenter",
      service: VMwareVCenterService,
    },
    {
      column: "iotFleets",
      modelName: "IoT Fleet",
      service: IoTFleetService,
    },
    {
      column: "networkSites",
      modelName: "Network Site",
      service: NetworkSiteService,
    },
    {
      column: "dockerSwarmClusters",
      modelName: "Docker Swarm Cluster",
      service: DockerSwarmClusterService,
    },
    {
      column: "cephClusters",
      modelName: "Ceph Cluster",
      service: CephClusterService,
    },
    {
      column: "databaseServers",
      modelName: "Database",
      service: DatabaseServerService,
    },
    {
      column: "dockerResources",
      modelName: "Docker Resource",
      service: DockerResourceService,
    },
    {
      column: "podmanResources",
      modelName: "Podman Resource",
      service: PodmanResourceService,
    },
    {
      column: "services",
      modelName: "Service",
      service: ServiceService,
    },
  ];
}
