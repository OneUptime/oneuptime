import IconProp from "../Icon/IconProp";
import {
  RESOURCE_FACET_CATALOG,
  ResourceFacetDefinition,
} from "../Telemetry/ResourceFacetCatalog";
import ServiceType from "../Telemetry/ServiceType";

export enum AIResourceType {
  Host = "Host",
  DockerHost = "DockerHost",
  PodmanHost = "PodmanHost",
  KubernetesCluster = "KubernetesCluster",
  DockerSwarmCluster = "DockerSwarmCluster",
  ProxmoxCluster = "ProxmoxCluster",
  VMwareVCenter = "VMwareVCenter",
  CephCluster = "CephCluster",
  ServerlessFunction = "ServerlessFunction",
  CloudResource = "CloudResource",
  IoTFleet = "IoTFleet",
  NetworkDevice = "NetworkDevice",
  DatabaseServer = "DatabaseServer",
}

export enum AIResourceSubresourceKind {
  Namespace = "Namespace",
  Pod = "Pod",
  Deployment = "Deployment",
  StatefulSet = "StatefulSet",
  DaemonSet = "DaemonSet",
  Job = "Job",
  CronJob = "CronJob",
  Node = "Node",
  Container = "Container",
  PersistentVolumeClaim = "PersistentVolumeClaim",
  PersistentVolume = "PersistentVolume",
  HorizontalPodAutoscaler = "HorizontalPodAutoscaler",
  VerticalPodAutoscaler = "VerticalPodAutoscaler",
  Service = "Service",
  Task = "Task",
  Stack = "Stack",
  Network = "Network",
  Volume = "Volume",
  Secret = "Secret",
  Config = "Config",
  Guest = "Guest",
  Storage = "Storage",
  Host = "Host",
  VirtualMachine = "VirtualMachine",
  Datastore = "Datastore",
  Cluster = "Cluster",
  Osd = "Osd",
  Pool = "Pool",
  Device = "Device",
  Process = "Process",
  WindowsService = "WindowsService",
  SystemdUnit = "SystemdUnit",
  Instance = "Instance",
  Interface = "Interface",
}

export interface AIResourceSubresource {
  kind: AIResourceSubresourceKind;
  // Child names and external IDs are not OneUptime resource UUIDs.
  key?: string | undefined;
  namespace?: string | undefined;
}

export interface AIResourceDefinition extends ResourceFacetDefinition {
  type: AIResourceType;
}

const RESOURCE_FACET_KEYS: Record<AIResourceType, string> = {
  [AIResourceType.Host]: "hostId",
  [AIResourceType.DockerHost]: "dockerHostId",
  [AIResourceType.PodmanHost]: "podmanHostId",
  [AIResourceType.KubernetesCluster]: "kubernetesClusterId",
  [AIResourceType.DockerSwarmCluster]: "dockerSwarmClusterId",
  [AIResourceType.ProxmoxCluster]: "proxmoxClusterId",
  [AIResourceType.VMwareVCenter]: "vmwareVCenterId",
  [AIResourceType.CephCluster]: "cephClusterId",
  [AIResourceType.ServerlessFunction]: "serverlessFunctionId",
  [AIResourceType.CloudResource]: "cloudResourceId",
  [AIResourceType.IoTFleet]: "iotFleetId",
  [AIResourceType.NetworkDevice]: "networkDeviceId",
  [AIResourceType.DatabaseServer]: "databaseServerId",
};

/*
 * Reuse the telemetry catalog's labels and type discriminators, including
 * IoTFleet's historical IoTDevice discriminator. Network devices have no facet.
 */
export const AI_RESOURCE_DEFINITIONS: ReadonlyArray<AIResourceDefinition> =
  Object.values(AIResourceType).map(
    (type: AIResourceType): AIResourceDefinition => {
      const facetKey: string = RESOURCE_FACET_KEYS[type];
      if (type === AIResourceType.NetworkDevice) {
        return {
          type,
          facetKey,
          serviceType: ServiceType.NetworkDevice,
          label: "Network Device",
          pluralLabel: "Network Devices",
          icon: IconProp.Server,
        };
      }

      const definition: ResourceFacetDefinition | undefined =
        RESOURCE_FACET_CATALOG.find(
          (item: ResourceFacetDefinition): boolean => {
            return item.facetKey === facetKey;
          },
        );
      if (!definition) {
        throw new Error(`Missing resource facet definition: ${type}`);
      }
      return { ...definition, type };
    },
  );

export function getAIResourceDefinition(
  type: AIResourceType,
): AIResourceDefinition {
  const definition: AIResourceDefinition | undefined =
    AI_RESOURCE_DEFINITIONS.find((item: AIResourceDefinition): boolean => {
      return item.type === type;
    });
  if (!definition) {
    throw new Error(`Unknown AI resource type: ${type}`);
  }
  return definition;
}

export function isAIResourceType(value: unknown): value is AIResourceType {
  return Object.values(AIResourceType).includes(value as AIResourceType);
}

export const AI_RESOURCE_SUBRESOURCE_KINDS: Readonly<
  Record<AIResourceType, ReadonlyArray<AIResourceSubresourceKind>>
> = {
  [AIResourceType.Host]: [
    AIResourceSubresourceKind.Process,
    AIResourceSubresourceKind.WindowsService,
    AIResourceSubresourceKind.SystemdUnit,
  ],
  [AIResourceType.DockerHost]: [AIResourceSubresourceKind.Container],
  [AIResourceType.PodmanHost]: [AIResourceSubresourceKind.Container],
  [AIResourceType.KubernetesCluster]: [
    AIResourceSubresourceKind.Namespace,
    AIResourceSubresourceKind.Pod,
    AIResourceSubresourceKind.Deployment,
    AIResourceSubresourceKind.StatefulSet,
    AIResourceSubresourceKind.DaemonSet,
    AIResourceSubresourceKind.Job,
    AIResourceSubresourceKind.CronJob,
    AIResourceSubresourceKind.Node,
    AIResourceSubresourceKind.Container,
    AIResourceSubresourceKind.PersistentVolumeClaim,
    AIResourceSubresourceKind.PersistentVolume,
    AIResourceSubresourceKind.HorizontalPodAutoscaler,
    AIResourceSubresourceKind.VerticalPodAutoscaler,
  ],
  [AIResourceType.DockerSwarmCluster]: [
    AIResourceSubresourceKind.Node,
    AIResourceSubresourceKind.Service,
    AIResourceSubresourceKind.Task,
    AIResourceSubresourceKind.Stack,
    AIResourceSubresourceKind.Network,
    AIResourceSubresourceKind.Volume,
    AIResourceSubresourceKind.Secret,
    AIResourceSubresourceKind.Config,
  ],
  [AIResourceType.ProxmoxCluster]: [
    AIResourceSubresourceKind.Node,
    AIResourceSubresourceKind.Guest,
    AIResourceSubresourceKind.Storage,
  ],
  [AIResourceType.VMwareVCenter]: [
    AIResourceSubresourceKind.Host,
    AIResourceSubresourceKind.VirtualMachine,
    AIResourceSubresourceKind.Datastore,
    AIResourceSubresourceKind.Cluster,
  ],
  [AIResourceType.CephCluster]: [
    AIResourceSubresourceKind.Osd,
    AIResourceSubresourceKind.Pool,
  ],
  [AIResourceType.IoTFleet]: [AIResourceSubresourceKind.Device],
  [AIResourceType.ServerlessFunction]: [AIResourceSubresourceKind.Instance],
  [AIResourceType.CloudResource]: [AIResourceSubresourceKind.Instance],
  [AIResourceType.NetworkDevice]: [AIResourceSubresourceKind.Interface],
  /*
   * A database's tabs (Endpoints, Metrics, Logs ...) are views of the one
   * database, never a child with its own identity.
   */
  [AIResourceType.DatabaseServer]: [],
};

export function isAIResourceSubresourceKind(
  type: AIResourceType,
  value: unknown,
): value is AIResourceSubresourceKind {
  return AI_RESOURCE_SUBRESOURCE_KINDS[type].includes(
    value as AIResourceSubresourceKind,
  );
}
