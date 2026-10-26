import { ResourceShowcase } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcase";
import HOST_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Host/HostShowcase";
import KUBERNETES_CLUSTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesClusterShowcase";
import DOCKER_HOST_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Docker/DockerHostShowcase";
import PODMAN_HOST_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Podman/PodmanHostShowcase";
import DOCKER_SWARM_CLUSTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/DockerSwarm/DockerSwarmClusterShowcase";
import PROXMOX_CLUSTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Proxmox/ProxmoxClusterShowcase";
import VMWARE_VCENTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareVCenterShowcase";
import CEPH_CLUSTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Ceph/CephClusterShowcase";
import STORAGE_ARRAY_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/StorageArray/StorageArrayShowcase";
import IOT_FLEET_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/IoT/IoTFleetShowcase";
import DATABASE_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseShowcase";
import MESSAGE_QUEUE_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueShowcase";
import SERVERLESS_FUNCTION_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Serverless/ServerlessFunctionShowcase";
import CLOUD_ENVIRONMENT_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudEnvironmentShowcase";
import RUM_APPLICATION_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumApplicationShowcase";

/*
 * Every resource list's showcase (Components/ResourceShowcase): what its
 * empty list shows under the table. With the module it is written in and
 * the page that shows it, Dashboard-relative, for the tests that read them.
 */

export interface ResourceShowcaseCase {
  label: string;
  // The constant the page hands ResourceShowcaseCard.
  constant: string;
  module: string;
  page: string;
  showcase: ResourceShowcase;
}

export const RESOURCE_SHOWCASE_CASES: Array<ResourceShowcaseCase> = [
  {
    label: "Hosts",
    constant: "HOST_SHOWCASE",
    module: "Components/Host/HostShowcase.ts",
    page: "Pages/Host/Hosts.tsx",
    showcase: HOST_SHOWCASE,
  },
  {
    label: "Kubernetes clusters",
    constant: "KUBERNETES_CLUSTER_SHOWCASE",
    module: "Components/Kubernetes/KubernetesClusterShowcase.ts",
    page: "Pages/Kubernetes/Clusters.tsx",
    showcase: KUBERNETES_CLUSTER_SHOWCASE,
  },
  {
    label: "Docker hosts",
    constant: "DOCKER_HOST_SHOWCASE",
    module: "Components/Docker/DockerHostShowcase.ts",
    page: "Pages/Docker/Hosts.tsx",
    showcase: DOCKER_HOST_SHOWCASE,
  },
  {
    label: "Podman hosts",
    constant: "PODMAN_HOST_SHOWCASE",
    module: "Components/Podman/PodmanHostShowcase.ts",
    page: "Pages/Podman/Hosts.tsx",
    showcase: PODMAN_HOST_SHOWCASE,
  },
  {
    label: "Docker Swarm clusters",
    constant: "DOCKER_SWARM_CLUSTER_SHOWCASE",
    module: "Components/DockerSwarm/DockerSwarmClusterShowcase.ts",
    page: "Pages/DockerSwarm/Clusters.tsx",
    showcase: DOCKER_SWARM_CLUSTER_SHOWCASE,
  },
  {
    label: "Proxmox clusters",
    constant: "PROXMOX_CLUSTER_SHOWCASE",
    module: "Components/Proxmox/ProxmoxClusterShowcase.ts",
    page: "Pages/Proxmox/Clusters.tsx",
    showcase: PROXMOX_CLUSTER_SHOWCASE,
  },
  {
    label: "vCenters",
    constant: "VMWARE_VCENTER_SHOWCASE",
    module: "Components/VMware/VMwareVCenterShowcase.ts",
    page: "Pages/VMware/VCenters.tsx",
    showcase: VMWARE_VCENTER_SHOWCASE,
  },
  {
    label: "Ceph clusters",
    constant: "CEPH_CLUSTER_SHOWCASE",
    module: "Components/Ceph/CephClusterShowcase.ts",
    page: "Pages/Ceph/Clusters.tsx",
    showcase: CEPH_CLUSTER_SHOWCASE,
  },
  {
    label: "Storage arrays",
    constant: "STORAGE_ARRAY_SHOWCASE",
    module: "Components/StorageArray/StorageArrayShowcase.ts",
    page: "Pages/StorageArray/StorageArrays.tsx",
    showcase: STORAGE_ARRAY_SHOWCASE,
  },
  {
    label: "IoT fleets",
    constant: "IOT_FLEET_SHOWCASE",
    module: "Components/IoT/IoTFleetShowcase.ts",
    page: "Pages/IoT/Fleets.tsx",
    showcase: IOT_FLEET_SHOWCASE,
  },
  {
    label: "Databases",
    constant: "DATABASE_SHOWCASE",
    module: "Components/DatabaseServer/DatabaseShowcase.ts",
    page: "Pages/Database/Databases.tsx",
    showcase: DATABASE_SHOWCASE,
  },
  {
    label: "Queues",
    constant: "MESSAGE_QUEUE_SHOWCASE",
    module: "Components/MessageQueue/MessageQueueShowcase.ts",
    page: "Pages/MessageQueue/MessageQueues.tsx",
    showcase: MESSAGE_QUEUE_SHOWCASE,
  },
  {
    label: "Serverless functions",
    constant: "SERVERLESS_FUNCTION_SHOWCASE",
    module: "Components/Serverless/ServerlessFunctionShowcase.ts",
    page: "Pages/Serverless/ServerlessFunctions.tsx",
    showcase: SERVERLESS_FUNCTION_SHOWCASE,
  },
  {
    label: "Cloud environments",
    constant: "CLOUD_ENVIRONMENT_SHOWCASE",
    module: "Components/Cloud/CloudEnvironmentShowcase.ts",
    page: "Pages/Cloud/CloudResources.tsx",
    showcase: CLOUD_ENVIRONMENT_SHOWCASE,
  },
  {
    label: "RUM applications",
    constant: "RUM_APPLICATION_SHOWCASE",
    module: "Components/Rum/RumApplicationShowcase.ts",
    page: "Pages/Rum/RumApplications.tsx",
    showcase: RUM_APPLICATION_SHOWCASE,
  },
];
