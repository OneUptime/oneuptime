import IconProp from "Common/Types/Icon/IconProp";
import EntityType from "Common/Types/Telemetry/EntityType";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  getInventoryTypeIcon,
  getInventoryTypeLabel,
  getInventoryTypePluralLabel,
} from "../Inventory/InventoryTypeCatalog";
import { metaForEntityType } from "../Topology/TopologyMeta";

/*
 * What every kind of part on a resource topology is called, how it looks,
 * and where it sits among its siblings.
 *
 * One catalog for every product, so a host reads as a host whether it is an
 * ESXi host, a Proxmox node or the machine a Docker agent runs on, and the
 * map, the list, the legend and the search all use the same words. Names are
 * the product's own (vCenter, StatefulSet, OSD) — the words the people
 * running it use — and colours follow the families the master topology
 * already uses (VMware sky blues, Kubernetes royal blues, Proxmox oranges).
 *
 * The parts of a host are telemetry entities, so their kind is
 * `entity:<entity type>` and their words come from the Inventory catalog.
 */

export interface ResourceTopologyKindInfo {
  /* English, singular: "ESXi Host". */
  label: string;
  /* English, for a number of them: "ESXi Hosts". */
  plural: string;
  icon: IconProp;
  /* Tints the icon tile. */
  color: string;
  /* Lower first, among the parts of one parent. */
  order: number;
}

export const SECTION_KIND: string = "section";

export const ENTITY_KIND_PREFIX: string = "entity:";

export function entityKind(entityType: string): string {
  return `${ENTITY_KIND_PREFIX}${entityType}`;
}

const KINDS: Record<string, ResourceTopologyKindInfo> = {
  [SECTION_KIND]: {
    label: translationKey("Group"),
    plural: translationKey("Groups"),
    icon: IconProp.Folder,
    color: "#64748b",
    order: 900,
  },

  // VMware vSphere.
  "vmware.vcenter": {
    label: translationKey("vCenter"),
    plural: translationKey("vCenters"),
    icon: IconProp.VMware,
    color: "#0369a1",
    order: 0,
  },
  "vmware.datacenter": {
    label: translationKey("Datacenter"),
    plural: translationKey("Datacenters"),
    icon: IconProp.BuildingOffice,
    color: "#0284c7",
    order: 10,
  },
  "vmware.cluster": {
    label: translationKey("Cluster"),
    plural: translationKey("Clusters"),
    icon: IconProp.Squares,
    color: "#0ea5e9",
    order: 20,
  },
  "vmware.host": {
    label: translationKey("ESXi Host"),
    plural: translationKey("ESXi Hosts"),
    icon: IconProp.Server,
    color: "#0284c7",
    order: 30,
  },
  "vmware.vm": {
    label: translationKey("Virtual Machine"),
    plural: translationKey("Virtual Machines"),
    icon: IconProp.ComputerDesktop,
    color: "#0ea5e9",
    order: 40,
  },
  "vmware.template": {
    label: translationKey("VM Template"),
    plural: translationKey("VM Templates"),
    icon: IconProp.DocumentDuplicate,
    color: "#64748b",
    order: 45,
  },
  "vmware.datastore": {
    label: translationKey("Datastore"),
    plural: translationKey("Datastores"),
    icon: IconProp.Database,
    color: "#0891b2",
    order: 50,
  },
  "vmware.resourcepool": {
    label: translationKey("Resource Pool"),
    plural: translationKey("Resource Pools"),
    icon: IconProp.Layers,
    color: "#0e7490",
    order: 60,
  },

  // Kubernetes.
  "k8s.cluster": {
    label: translationKey("Kubernetes Cluster"),
    plural: translationKey("Kubernetes Clusters"),
    icon: IconProp.Kubernetes,
    color: "#2563eb",
    order: 0,
  },
  "k8s.node": {
    label: translationKey("Node"),
    plural: translationKey("Nodes"),
    icon: IconProp.ServerStack,
    color: "#1d4ed8",
    // After what runs, before the volumes: the machines it runs on.
    order: 55,
  },
  "k8s.namespace": {
    label: translationKey("Namespace"),
    plural: translationKey("Namespaces"),
    icon: IconProp.Folder,
    color: "#3b82f6",
    order: 20,
  },
  "k8s.deployment": {
    label: translationKey("Deployment"),
    plural: translationKey("Deployments"),
    icon: IconProp.RectangleStack,
    color: "#2563eb",
    order: 30,
  },
  "k8s.statefulset": {
    label: translationKey("StatefulSet"),
    plural: translationKey("StatefulSets"),
    icon: IconProp.SquareStack3D,
    color: "#4f46e5",
    order: 31,
  },
  "k8s.daemonset": {
    label: translationKey("DaemonSet"),
    plural: translationKey("DaemonSets"),
    icon: IconProp.SquareStack,
    color: "#4338ca",
    order: 32,
  },
  "k8s.cronjob": {
    label: translationKey("CronJob"),
    plural: translationKey("CronJobs"),
    icon: IconProp.Clock,
    color: "#7c3aed",
    order: 33,
  },
  "k8s.job": {
    label: translationKey("Job"),
    plural: translationKey("Jobs"),
    icon: IconProp.Play,
    color: "#8b5cf6",
    order: 34,
  },
  "k8s.pod": {
    label: translationKey("Pod"),
    plural: translationKey("Pods"),
    icon: IconProp.Cube,
    color: "#3b82f6",
    order: 40,
  },
  "k8s.pvc": {
    label: translationKey("PVC"),
    plural: translationKey("PVCs"),
    icon: IconProp.Disc,
    color: "#0284c7",
    order: 50,
  },
  "k8s.pv": {
    label: translationKey("PV"),
    plural: translationKey("PVs"),
    icon: IconProp.Database,
    color: "#0369a1",
    order: 60,
  },

  // Docker and Podman hosts.
  "docker.host": {
    label: translationKey("Docker Host"),
    plural: translationKey("Docker Hosts"),
    icon: IconProp.Docker,
    color: "#0d9488",
    order: 0,
  },
  "podman.host": {
    label: translationKey("Podman Host"),
    plural: translationKey("Podman Hosts"),
    icon: IconProp.Podman,
    color: "#7c3aed",
    order: 0,
  },
  "container.project": {
    label: translationKey("Compose Project"),
    plural: translationKey("Compose Projects"),
    icon: IconProp.Folder,
    color: "#0e7490",
    order: 10,
  },
  "container.container": {
    label: translationKey("Container"),
    plural: translationKey("Containers"),
    icon: IconProp.Cube,
    color: "#0891b2",
    order: 20,
  },
  "container.image": {
    label: translationKey("Image"),
    plural: translationKey("Images"),
    icon: IconProp.Disc,
    color: "#64748b",
    order: 30,
  },
  "container.network": {
    label: translationKey("Network"),
    plural: translationKey("Networks"),
    icon: IconProp.Globe,
    color: "#0f766e",
    order: 40,
  },
  "container.volume": {
    label: translationKey("Volume"),
    plural: translationKey("Volumes"),
    icon: IconProp.Database,
    color: "#475569",
    order: 50,
  },

  // Docker Swarm.
  "swarm.cluster": {
    label: translationKey("Swarm Cluster"),
    plural: translationKey("Swarm Clusters"),
    icon: IconProp.DockerSwarm,
    color: "#0e7490",
    order: 0,
  },
  "swarm.node": {
    label: translationKey("Node"),
    plural: translationKey("Nodes"),
    icon: IconProp.Server,
    color: "#0891b2",
    // After what runs, before the networks: the machines it runs on.
    order: 45,
  },
  "swarm.stack": {
    label: translationKey("Stack"),
    plural: translationKey("Stacks"),
    icon: IconProp.RectangleStack,
    color: "#0e7490",
    order: 20,
  },
  "swarm.service": {
    label: translationKey("Service"),
    plural: translationKey("Services"),
    icon: IconProp.SquareStack,
    color: "#06b6d4",
    order: 30,
  },
  "swarm.task": {
    label: translationKey("Task"),
    plural: translationKey("Tasks"),
    icon: IconProp.QueueList,
    color: "#22d3ee",
    order: 40,
  },
  "swarm.network": {
    label: translationKey("Network"),
    plural: translationKey("Networks"),
    icon: IconProp.Globe,
    color: "#0f766e",
    order: 50,
  },

  // Proxmox VE.
  "proxmox.cluster": {
    label: translationKey("Proxmox Cluster"),
    plural: translationKey("Proxmox Clusters"),
    icon: IconProp.Proxmox,
    color: "#ea580c",
    order: 0,
  },
  "proxmox.node": {
    label: translationKey("Node"),
    plural: translationKey("Nodes"),
    icon: IconProp.Server,
    color: "#f97316",
    order: 10,
  },
  "proxmox.vm": {
    label: translationKey("Virtual Machine"),
    plural: translationKey("Virtual Machines"),
    icon: IconProp.ComputerDesktop,
    color: "#fb923c",
    order: 20,
  },
  "proxmox.lxc": {
    label: translationKey("Container"),
    plural: translationKey("Containers"),
    icon: IconProp.Cube,
    color: "#f59e0b",
    order: 30,
  },
  "proxmox.storage": {
    label: translationKey("Storage"),
    plural: translationKey("Storage"),
    icon: IconProp.Database,
    color: "#c2410c",
    order: 40,
  },

  // Ceph.
  "ceph.cluster": {
    label: translationKey("Ceph Cluster"),
    plural: translationKey("Ceph Clusters"),
    icon: IconProp.Ceph,
    color: "#dc2626",
    order: 0,
  },
  "ceph.host": {
    label: translationKey("Host"),
    plural: translationKey("Hosts"),
    icon: IconProp.Server,
    color: "#b91c1c",
    order: 10,
  },
  "ceph.mon": {
    label: translationKey("Monitor"),
    plural: translationKey("Monitors"),
    icon: IconProp.Eye,
    color: "#e11d48",
    order: 20,
  },
  "ceph.mgr": {
    label: translationKey("Manager"),
    plural: translationKey("Managers"),
    icon: IconProp.Cog,
    color: "#be123c",
    order: 21,
  },
  "ceph.mds": {
    label: translationKey("Metadata Server"),
    plural: translationKey("Metadata Servers"),
    icon: IconProp.Folder,
    color: "#9f1239",
    order: 22,
  },
  "ceph.rgw": {
    label: translationKey("Object Gateway"),
    plural: translationKey("Object Gateways"),
    icon: IconProp.Globe,
    color: "#881337",
    order: 23,
  },
  "ceph.osd": {
    label: translationKey("OSD"),
    plural: translationKey("OSDs"),
    icon: IconProp.Disc,
    color: "#ef4444",
    order: 30,
  },
  "ceph.pool": {
    label: translationKey("Pool"),
    plural: translationKey("Pools"),
    icon: IconProp.Database,
    color: "#f87171",
    order: 40,
  },

  // Storage arrays (Pure Storage FlashArray and FlashBlade).
  "storage.array": {
    label: translationKey("Storage Array"),
    plural: translationKey("Storage Arrays"),
    icon: IconProp.StorageArray,
    color: "#ea580c",
    order: 0,
  },
  "storage.hostgroup": {
    label: translationKey("Host Group"),
    plural: translationKey("Host Groups"),
    icon: IconProp.Squares,
    color: "#c2410c",
    order: 10,
  },
  "storage.host": {
    label: translationKey("Host"),
    plural: translationKey("Hosts"),
    icon: IconProp.ComputerDesktop,
    color: "#ea580c",
    order: 11,
  },
  "storage.pod": {
    label: translationKey("Pod"),
    plural: translationKey("Pods"),
    icon: IconProp.RectangleStack,
    color: "#d97706",
    order: 20,
  },
  "storage.volumegroup": {
    label: translationKey("Volume Group"),
    plural: translationKey("Volume Groups"),
    icon: IconProp.RectangleStack,
    color: "#b45309",
    order: 20,
  },
  "storage.volume": {
    label: translationKey("Volume"),
    plural: translationKey("Volumes"),
    icon: IconProp.Database,
    color: "#f59e0b",
    order: 21,
  },
  "storage.filesystem": {
    label: translationKey("File System"),
    plural: translationKey("File Systems"),
    icon: IconProp.Folder,
    color: "#b45309",
    order: 30,
  },
  "storage.directory": {
    label: translationKey("Directory"),
    plural: translationKey("Directories"),
    icon: IconProp.FolderOpen,
    color: "#92400e",
    order: 31,
  },
  "storage.bucket": {
    label: translationKey("Bucket"),
    plural: translationKey("Buckets"),
    icon: IconProp.Archive,
    color: "#a16207",
    order: 32,
  },
  "storage.controller": {
    label: translationKey("Controller"),
    plural: translationKey("Controllers"),
    icon: IconProp.CPUChip,
    color: "#78716c",
    order: 40,
  },
  "storage.drive": {
    label: translationKey("Drive"),
    plural: translationKey("Drives"),
    icon: IconProp.Disc,
    color: "#57534e",
    order: 41,
  },
  "storage.port": {
    label: translationKey("Network Interface"),
    plural: translationKey("Network Interfaces"),
    icon: IconProp.Link,
    color: "#44403c",
    order: 42,
  },
  "storage.hardware": {
    label: translationKey("Hardware"),
    plural: translationKey("Hardware"),
    icon: IconProp.Wrench,
    color: "#a8a29e",
    order: 43,
  },

  /*
   * A cloud account: its regions, and its resources by the catalog's
   * category (CloudResourceCategory) - the networks first, since the rest
   * runs in them. Each card names its own type (an EC2 instance, an App
   * Service plan) under its name.
   */
  "cloud.account": {
    label: translationKey("Cloud Account"),
    plural: translationKey("Cloud Accounts"),
    icon: IconProp.Cloud,
    color: "#0284c7",
    order: 0,
  },
  "cloud.region": {
    label: translationKey("Region"),
    plural: translationKey("Regions"),
    icon: IconProp.Globe,
    color: "#0ea5e9",
    order: 5,
  },
  "cloud.networking": {
    label: translationKey("Network Resource"),
    plural: translationKey("Network Resources"),
    icon: IconProp.Link,
    color: "#0891b2",
    order: 10,
  },
  "cloud.compute": {
    label: translationKey("Compute Resource"),
    plural: translationKey("Compute Resources"),
    icon: IconProp.Server,
    color: "#2563eb",
    order: 20,
  },
  "cloud.containers": {
    label: translationKey("Container Resource"),
    plural: translationKey("Container Resources"),
    icon: IconProp.Cube,
    color: "#1d4ed8",
    order: 25,
  },
  "cloud.serverless": {
    label: translationKey("Serverless Resource"),
    plural: translationKey("Serverless Resources"),
    icon: IconProp.Bolt,
    color: "#7c3aed",
    order: 30,
  },
  "cloud.web": {
    label: translationKey("Web App"),
    plural: translationKey("Web Apps"),
    icon: IconProp.GlobeAlt,
    color: "#4f46e5",
    order: 35,
  },
  "cloud.database": {
    label: translationKey("Database"),
    plural: translationKey("Databases"),
    icon: IconProp.Database,
    color: "#0f766e",
    order: 40,
  },
  "cloud.storage": {
    label: translationKey("Storage Resource"),
    plural: translationKey("Storage Resources"),
    icon: IconProp.Archive,
    color: "#a16207",
    order: 45,
  },
  "cloud.messaging": {
    label: translationKey("Messaging Resource"),
    plural: translationKey("Messaging Resources"),
    icon: IconProp.InboxStack,
    color: "#c2410c",
    order: 50,
  },
  "cloud.integration": {
    label: translationKey("Integration Resource"),
    plural: translationKey("Integration Resources"),
    icon: IconProp.Squares,
    color: "#9333ea",
    order: 55,
  },
  "cloud.analytics": {
    label: translationKey("Analytics Resource"),
    plural: translationKey("Analytics Resources"),
    icon: IconProp.ChartBar,
    color: "#db2777",
    order: 60,
  },
  "cloud.ai": {
    label: translationKey("AI Resource"),
    plural: translationKey("AI Resources"),
    icon: IconProp.Sparkles,
    color: "#c026d3",
    order: 65,
  },
  "cloud.security": {
    label: translationKey("Security Resource"),
    plural: translationKey("Security Resources"),
    icon: IconProp.ShieldCheck,
    color: "#be123c",
    order: 70,
  },
  "cloud.monitoring": {
    label: translationKey("Monitoring Resource"),
    plural: translationKey("Monitoring Resources"),
    icon: IconProp.Eye,
    color: "#4d7c0f",
    order: 75,
  },
  "cloud.management": {
    label: translationKey("Management Resource"),
    plural: translationKey("Management Resources"),
    icon: IconProp.Cog,
    color: "#475569",
    order: 80,
  },
  "cloud.iot": {
    label: translationKey("IoT Resource"),
    plural: translationKey("IoT Resources"),
    icon: IconProp.Signal,
    color: "#15803d",
    order: 85,
  },
  "cloud.resource": {
    label: translationKey("Cloud Resource"),
    plural: translationKey("Cloud Resources"),
    icon: IconProp.SquareStack,
    color: "#64748b",
    order: 90,
  },
};

const UNKNOWN_KIND: ResourceTopologyKindInfo = {
  label: translationKey("Resource"),
  plural: translationKey("Resources"),
  icon: IconProp.Cube,
  color: "#64748b",
  order: 1000,
};

/*
 * The kinds a host's topology meets are entity types; their order puts
 * where things run before what runs there, and what runs there before what
 * it talks to.
 */
const ENTITY_KIND_ORDER: Partial<Record<string, number>> = {
  [EntityType.Host]: 0,
  [EntityType.KubernetesNode]: 5,
  [EntityType.Container]: 10,
  [EntityType.KubernetesPod]: 11,
  [EntityType.Service]: 20,
  [EntityType.Database]: 40,
  [EntityType.RemoteService]: 41,
};

export function getResourceTopologyKind(
  kind: string,
): ResourceTopologyKindInfo {
  const known: ResourceTopologyKindInfo | undefined = KINDS[kind];

  if (known) {
    return known;
  }

  if (kind.startsWith(ENTITY_KIND_PREFIX)) {
    const entityType: string = kind.substring(ENTITY_KIND_PREFIX.length);

    return {
      label: getInventoryTypeLabel(entityType),
      plural: getInventoryTypePluralLabel(entityType),
      icon: getInventoryTypeIcon(entityType),
      color: metaForEntityType(entityType).color,
      order: ENTITY_KIND_ORDER[entityType] ?? 30,
    };
  }

  return UNKNOWN_KIND;
}

/* Every kind this catalog names, for the tests and the legend. */
export function getResourceTopologyKindKeys(): Array<string> {
  return Object.keys(KINDS);
}
