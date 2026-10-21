import type { DashboardPageContext, SuggestedQuestion } from "./PageContext";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import RouteParams from "../../Utils/RouteParams";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import AIChatPageContextType from "Common/Types/AI/AIChatPageContext";
import {
  AIResourceSubresource,
  AIResourceDefinition,
  AIResourceSubresourceKind,
  AIResourceType,
  getAIResourceDefinition,
} from "Common/Types/AI/AIResourceContext";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import {
  getGlobalTranslator,
  TemplateValues,
  translatableTerm,
  TranslatableTerm,
  translateTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

type NamedResource = BaseModel & { name?: string | undefined };

interface SubresourcePageDefinition {
  kind: AIResourceSubresourceKind;
  collectionPage: PageMap;
  detailPage?: PageMap | undefined;
}

interface ResourcePageDefinition {
  listPage: PageMap;
  detailPage: PageMap;
  modelType: { new (): NamedResource };
  noun: string;
  subresources: Array<SubresourcePageDefinition>;
}

/*
 * The shared resource catalog owns wire identifiers and labels. This table
 * adds only the dashboard's routes and models; child IDs remain separate
 * from the parent's UUID because most child routes use external names.
 */
const RESOURCE_PAGES: Record<AIResourceType, ResourcePageDefinition> = {
  [AIResourceType.Host]: {
    listPage: PageMap.HOSTS,
    detailPage: PageMap.HOST_VIEW,
    modelType: Host,
    noun: translationKey("host"),
    subresources: [
      {
        kind: AIResourceSubresourceKind.Process,
        collectionPage: PageMap.HOST_VIEW_PROCESSES,
        detailPage: PageMap.HOST_VIEW_PROCESS_VIEW,
      },
      {
        kind: AIResourceSubresourceKind.WindowsService,
        collectionPage: PageMap.HOST_VIEW_SERVICES,
        detailPage: PageMap.HOST_VIEW_SERVICE_VIEW,
      },
      {
        kind: AIResourceSubresourceKind.SystemdUnit,
        collectionPage: PageMap.HOST_VIEW_SYSTEMD_UNITS,
        detailPage: PageMap.HOST_VIEW_SYSTEMD_UNIT_VIEW,
      },
    ],
  },
  [AIResourceType.DockerHost]: {
    listPage: PageMap.DOCKER_HOSTS,
    detailPage: PageMap.DOCKER_HOST_VIEW,
    modelType: DockerHost,
    noun: translationKey("Docker host"),
    subresources: [
      {
        kind: AIResourceSubresourceKind.Container,
        collectionPage: PageMap.DOCKER_HOST_VIEW_CONTAINERS,
        detailPage: PageMap.DOCKER_HOST_VIEW_CONTAINER_DETAIL,
      },
    ],
  },
  [AIResourceType.PodmanHost]: {
    listPage: PageMap.PODMAN_HOSTS,
    detailPage: PageMap.PODMAN_HOST_VIEW,
    modelType: PodmanHost,
    noun: translationKey("Podman host"),
    subresources: [
      {
        kind: AIResourceSubresourceKind.Container,
        collectionPage: PageMap.PODMAN_HOST_VIEW_CONTAINERS,
        detailPage: PageMap.PODMAN_HOST_VIEW_CONTAINER_DETAIL,
      },
    ],
  },
  [AIResourceType.KubernetesCluster]: {
    listPage: PageMap.KUBERNETES_CLUSTERS,
    detailPage: PageMap.KUBERNETES_CLUSTER_VIEW,
    modelType: KubernetesCluster,
    noun: translationKey("Kubernetes cluster"),
    subresources: [
      {
        kind: AIResourceSubresourceKind.Namespace,
        collectionPage: PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACES,
        detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACE_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Pod,
        collectionPage: PageMap.KUBERNETES_CLUSTER_VIEW_PODS,
        detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Deployment,
        collectionPage: PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTS,
        detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENT_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.StatefulSet,
        collectionPage: PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSETS,
        detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSET_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.DaemonSet,
        collectionPage: PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSETS,
        detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSET_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Job,
        collectionPage: PageMap.KUBERNETES_CLUSTER_VIEW_JOBS,
        detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_JOB_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.CronJob,
        collectionPage: PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOBS,
        detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOB_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Node,
        collectionPage: PageMap.KUBERNETES_CLUSTER_VIEW_NODES,
        detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Container,
        collectionPage: PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINERS,
        detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINER_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.PersistentVolumeClaim,
        collectionPage: PageMap.KUBERNETES_CLUSTER_VIEW_PVCS,
        detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_PVC_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.PersistentVolume,
        collectionPage: PageMap.KUBERNETES_CLUSTER_VIEW_PVS,
        detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_PV_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.HorizontalPodAutoscaler,
        collectionPage: PageMap.KUBERNETES_CLUSTER_VIEW_HPAS,
        detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_HPA_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.VerticalPodAutoscaler,
        collectionPage: PageMap.KUBERNETES_CLUSTER_VIEW_VPAS,
        detailPage: PageMap.KUBERNETES_CLUSTER_VIEW_VPA_DETAIL,
      },
    ],
  },
  [AIResourceType.DockerSwarmCluster]: {
    listPage: PageMap.DOCKER_SWARM_CLUSTERS,
    detailPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW,
    modelType: DockerSwarmCluster,
    noun: translationKey("Docker Swarm cluster"),
    subresources: [
      {
        kind: AIResourceSubresourceKind.Node,
        collectionPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODES,
        detailPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODE_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Service,
        collectionPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICES,
        detailPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICE_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Task,
        collectionPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASKS,
        detailPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASK_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Stack,
        collectionPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_STACKS,
      },
      {
        kind: AIResourceSubresourceKind.Network,
        collectionPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_NETWORKS,
      },
      {
        kind: AIResourceSubresourceKind.Secret,
        collectionPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_SECRETS,
      },
      {
        kind: AIResourceSubresourceKind.Config,
        collectionPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_CONFIGS,
      },
      {
        kind: AIResourceSubresourceKind.Volume,
        collectionPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_VOLUMES,
      },
    ],
  },
  [AIResourceType.ProxmoxCluster]: {
    listPage: PageMap.PROXMOX_CLUSTERS,
    detailPage: PageMap.PROXMOX_CLUSTER_VIEW,
    modelType: ProxmoxCluster,
    noun: translationKey("Proxmox cluster"),
    subresources: [
      {
        kind: AIResourceSubresourceKind.Node,
        collectionPage: PageMap.PROXMOX_CLUSTER_VIEW_NODES,
        detailPage: PageMap.PROXMOX_CLUSTER_VIEW_NODE_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Guest,
        collectionPage: PageMap.PROXMOX_CLUSTER_VIEW_GUESTS,
        detailPage: PageMap.PROXMOX_CLUSTER_VIEW_GUEST_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Storage,
        collectionPage: PageMap.PROXMOX_CLUSTER_VIEW_STORAGE,
        detailPage: PageMap.PROXMOX_CLUSTER_VIEW_STORAGE_DETAIL,
      },
    ],
  },
  [AIResourceType.VMwareVCenter]: {
    listPage: PageMap.VMWARE_VCENTERS,
    detailPage: PageMap.VMWARE_VCENTER_VIEW,
    modelType: VMwareVCenter,
    noun: translationKey("vCenter"),
    subresources: [
      {
        kind: AIResourceSubresourceKind.Host,
        collectionPage: PageMap.VMWARE_VCENTER_VIEW_HOSTS,
        detailPage: PageMap.VMWARE_VCENTER_VIEW_HOST_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.VirtualMachine,
        collectionPage: PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINES,
        detailPage: PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Datastore,
        collectionPage: PageMap.VMWARE_VCENTER_VIEW_DATASTORES,
        detailPage: PageMap.VMWARE_VCENTER_VIEW_DATASTORE_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Cluster,
        collectionPage: PageMap.VMWARE_VCENTER_VIEW_CLUSTERS,
        detailPage: PageMap.VMWARE_VCENTER_VIEW_CLUSTER_DETAIL,
      },
    ],
  },
  [AIResourceType.CephCluster]: {
    listPage: PageMap.CEPH_CLUSTERS,
    detailPage: PageMap.CEPH_CLUSTER_VIEW,
    modelType: CephCluster,
    noun: translationKey("Ceph cluster"),
    subresources: [
      {
        kind: AIResourceSubresourceKind.Osd,
        collectionPage: PageMap.CEPH_CLUSTER_VIEW_OSDS,
        detailPage: PageMap.CEPH_CLUSTER_VIEW_OSD_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Pool,
        collectionPage: PageMap.CEPH_CLUSTER_VIEW_POOLS,
        detailPage: PageMap.CEPH_CLUSTER_VIEW_POOL_DETAIL,
      },
    ],
  },
  /*
   * Pods are listed on the array's Replication page, and hardware
   * components, drives and controllers on its Hardware page; neither has a
   * page per object, nor do directories.
   */
  [AIResourceType.StorageArray]: {
    listPage: PageMap.STORAGE_ARRAYS,
    detailPage: PageMap.STORAGE_ARRAY_VIEW,
    modelType: StorageArray,
    noun: translationKey("storage array"),
    subresources: [
      {
        kind: AIResourceSubresourceKind.Volume,
        collectionPage: PageMap.STORAGE_ARRAY_VIEW_VOLUMES,
        detailPage: PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Host,
        collectionPage: PageMap.STORAGE_ARRAY_VIEW_HOSTS,
        detailPage: PageMap.STORAGE_ARRAY_VIEW_HOST_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Pod,
        collectionPage: PageMap.STORAGE_ARRAY_VIEW_REPLICATION,
      },
      {
        kind: AIResourceSubresourceKind.Hardware,
        collectionPage: PageMap.STORAGE_ARRAY_VIEW_HARDWARE,
      },
      {
        kind: AIResourceSubresourceKind.Directory,
        collectionPage: PageMap.STORAGE_ARRAY_VIEW_DIRECTORIES,
      },
      {
        kind: AIResourceSubresourceKind.FileSystem,
        collectionPage: PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEMS,
        detailPage: PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Bucket,
        collectionPage: PageMap.STORAGE_ARRAY_VIEW_BUCKETS,
        detailPage: PageMap.STORAGE_ARRAY_VIEW_BUCKET_DETAIL,
      },
    ],
  },
  [AIResourceType.ServerlessFunction]: {
    listPage: PageMap.SERVERLESS_FUNCTIONS,
    detailPage: PageMap.SERVERLESS_FUNCTION_VIEW,
    modelType: ServerlessFunction,
    noun: translationKey("serverless function"),
    subresources: [
      {
        kind: AIResourceSubresourceKind.Instance,
        collectionPage: PageMap.SERVERLESS_FUNCTION_VIEW_INSTANCES,
      },
    ],
  },
  [AIResourceType.CloudResource]: {
    listPage: PageMap.CLOUD_RESOURCES,
    detailPage: PageMap.CLOUD_RESOURCE_VIEW,
    modelType: CloudResource,
    noun: translationKey("cloud environment"),
    subresources: [
      {
        kind: AIResourceSubresourceKind.Instance,
        collectionPage: PageMap.CLOUD_RESOURCE_VIEW_INSTANCES,
      },
    ],
  },
  [AIResourceType.IoTFleet]: {
    listPage: PageMap.IOT_FLEETS,
    detailPage: PageMap.IOT_FLEET_VIEW,
    modelType: IoTFleet,
    noun: translationKey("IoT fleet"),
    subresources: [
      {
        kind: AIResourceSubresourceKind.Device,
        collectionPage: PageMap.IOT_FLEET_VIEW_DEVICES,
        detailPage: PageMap.IOT_FLEET_VIEW_DEVICE_DETAIL,
      },
      {
        kind: AIResourceSubresourceKind.Device,
        collectionPage: PageMap.IOT_FLEET_VIEW_DEVICE_REGISTRY,
      },
    ],
  },
  [AIResourceType.NetworkDevice]: {
    listPage: PageMap.NETWORK_DEVICES,
    detailPage: PageMap.NETWORK_DEVICE_VIEW,
    modelType: NetworkDevice,
    noun: translationKey("network device"),
    subresources: [
      {
        kind: AIResourceSubresourceKind.Interface,
        collectionPage: PageMap.NETWORK_DEVICE_VIEW_INTERFACES,
      },
    ],
  },
  // A database's tabs are all views of the one database: no child identity.
  [AIResourceType.DatabaseServer]: {
    listPage: PageMap.DATABASE_SERVERS,
    detailPage: PageMap.DATABASE_SERVER_VIEW,
    modelType: DatabaseServer,
    noun: translationKey("database"),
    subresources: [],
  },
};

/*
 * What a child resource is called in a sentence. English keys: they are
 * sent to the server as they are, and put into a translated sentence as a
 * term.
 */
const SUBRESOURCE_LABELS: Record<AIResourceSubresourceKind, string> = {
  [AIResourceSubresourceKind.Namespace]: translationKey("namespace"),
  [AIResourceSubresourceKind.Pod]: translationKey("pod"),
  [AIResourceSubresourceKind.Deployment]: translationKey("deployment"),
  [AIResourceSubresourceKind.StatefulSet]: translationKey("StatefulSet"),
  [AIResourceSubresourceKind.DaemonSet]: translationKey("DaemonSet"),
  [AIResourceSubresourceKind.Job]: translationKey("job"),
  [AIResourceSubresourceKind.CronJob]: translationKey("CronJob"),
  [AIResourceSubresourceKind.Node]: translationKey("node"),
  [AIResourceSubresourceKind.Container]: translationKey("container"),
  [AIResourceSubresourceKind.PersistentVolumeClaim]: translationKey(
    "persistent volume claim",
  ),
  [AIResourceSubresourceKind.PersistentVolume]:
    translationKey("persistent volume"),
  [AIResourceSubresourceKind.HorizontalPodAutoscaler]: translationKey(
    "horizontal pod autoscaler",
  ),
  [AIResourceSubresourceKind.VerticalPodAutoscaler]: translationKey(
    "vertical pod autoscaler",
  ),
  [AIResourceSubresourceKind.Service]: translationKey("service"),
  [AIResourceSubresourceKind.Task]: translationKey("task"),
  [AIResourceSubresourceKind.Stack]: translationKey("stack"),
  [AIResourceSubresourceKind.Network]: translationKey("network"),
  [AIResourceSubresourceKind.Volume]: translationKey("volume"),
  [AIResourceSubresourceKind.Secret]: translationKey("secret"),
  [AIResourceSubresourceKind.Config]: translationKey("config"),
  [AIResourceSubresourceKind.Guest]: translationKey("guest"),
  [AIResourceSubresourceKind.Storage]: translationKey("storage"),
  [AIResourceSubresourceKind.Host]: translationKey("host"),
  [AIResourceSubresourceKind.VirtualMachine]: translationKey("virtual machine"),
  [AIResourceSubresourceKind.Datastore]: translationKey("datastore"),
  [AIResourceSubresourceKind.Cluster]: translationKey("cluster"),
  [AIResourceSubresourceKind.Osd]: translationKey("OSD"),
  [AIResourceSubresourceKind.Pool]: translationKey("pool"),
  [AIResourceSubresourceKind.Hardware]: translationKey("hardware component"),
  [AIResourceSubresourceKind.Directory]: translationKey("directory"),
  [AIResourceSubresourceKind.FileSystem]: translationKey("file system"),
  [AIResourceSubresourceKind.Bucket]: translationKey("bucket"),
  [AIResourceSubresourceKind.Device]: translationKey("device"),
  [AIResourceSubresourceKind.Process]: translationKey("process"),
  [AIResourceSubresourceKind.WindowsService]: translationKey("Windows service"),
  [AIResourceSubresourceKind.SystemdUnit]: translationKey("systemd unit"),
  [AIResourceSubresourceKind.Instance]: translationKey("instance"),
  [AIResourceSubresourceKind.Interface]: translationKey("interface"),
};

function subresourceLabel(kind: AIResourceSubresourceKind): string {
  return (
    SUBRESOURCE_LABELS[kind] ||
    String(kind)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
  );
}

function decodeExternalKey(rawKey: string): string | undefined {
  try {
    const key: string = decodeURIComponent(rawKey);
    /*
     * Keep identity intact: reject malformed/control-bearing names rather
     * than normalizing them into a different resource. Decode exactly once.
     */
    // eslint-disable-next-line no-control-regex
    const controlCharacters: RegExp = /[\u0000-\u001F\u007F]/;
    if (
      !key ||
      key.length > 512 ||
      key.trim() !== key ||
      key === "." ||
      key === ".." ||
      controlCharacters.test(key)
    ) {
      return undefined;
    }
    return key;
  } catch {
    return undefined;
  }
}

function detectSubresource(
  definition: ResourcePageDefinition,
): AIResourceSubresource | undefined {
  for (const child of definition.subresources) {
    const detailRoute: Route | undefined = child.detailPage
      ? RouteMap[child.detailPage]
      : undefined;
    if (detailRoute && Navigation.isStartWith(detailRoute)) {
      const rawKey: string | null = Navigation.getParamByName(
        RouteParams.SubModelID,
        detailRoute,
      );
      const key: string | undefined = rawKey
        ? decodeExternalKey(rawKey)
        : undefined;
      /*
       * Kubernetes detail routes do not include namespace. Never fabricate
       * it from another segment or infer it from a potentially reused name.
       */
      return key ? { kind: child.kind, key } : undefined;
    }
    const collectionRoute: Route | undefined = RouteMap[child.collectionPage];
    if (collectionRoute && Navigation.isStartWith(collectionRoute)) {
      return { kind: child.kind };
    }
  }
  return undefined;
}

export default class ResourcePageContextUtil {
  public static getRoute(
    resourceType: AIResourceType,
    resourceId?: string,
  ): Route | undefined {
    const page: ResourcePageDefinition | undefined =
      RESOURCE_PAGES[resourceType];
    if (
      !page ||
      (resourceId !== undefined && !ObjectID.isValidUUID(resourceId))
    ) {
      return undefined;
    }
    const route: Route | undefined =
      RouteMap[resourceId ? page.detailPage : page.listPage];
    return route
      ? RouteUtil.populateRouteParams(
          route,
          resourceId ? { modelId: resourceId } : undefined,
        )
      : undefined;
  }

  public static detect(): DashboardPageContext | null {
    for (const resourceType of Object.values(AIResourceType)) {
      const page: ResourcePageDefinition = RESOURCE_PAGES[resourceType];
      const definition: AIResourceDefinition =
        getAIResourceDefinition(resourceType);
      const listRoute: Route | undefined = RouteMap[page.listPage];
      if (!definition || !listRoute || !Navigation.isStartWith(listRoute)) {
        continue;
      }
      const detailRoute: Route | undefined = RouteMap[page.detailPage];
      const entityId: string | null =
        detailRoute && Navigation.isStartWith(detailRoute)
          ? Navigation.getParamByName(RouteParams.ModelID, detailRoute)
          : null;
      if (!entityId || !ObjectID.isValidUUID(entityId)) {
        return {
          type: AIChatPageContextType.ResourcesList,
          resourceType,
          noun: definition.pluralLabel,
          chipLabel: definition.pluralLabel,
          icon: definition.icon,
          isEntity: false,
        };
      }
      const subresource: AIResourceSubresource | undefined =
        detectSubresource(page);
      const noun: string = subresource?.key
        ? subresourceLabel(subresource.kind)
        : page.noun;
      return {
        type: AIChatPageContextType.Resource,
        resourceType,
        entityId,
        ...(subresource ? { subresource } : {}),
        noun,
        chipLabel: translateTemplate("This {{noun}}", {
          noun: translatableTerm(noun, { inSentence: true }),
        }),
        icon: definition.icon,
        isEntity: true,
      };
    }
    return null;
  }

  public static async resolveTitle(
    context: DashboardPageContext,
  ): Promise<string | null> {
    if (
      !context.resourceType ||
      !context.entityId ||
      !ObjectID.isValidUUID(context.entityId)
    ) {
      return null;
    }
    const page: ResourcePageDefinition | undefined =
      RESOURCE_PAGES[context.resourceType];
    if (!page) {
      return null;
    }
    const item: NamedResource | null = await ModelAPI.getItem<NamedResource>({
      modelType: page.modelType,
      id: new ObjectID(context.entityId),
      select: { name: true },
    });
    if (!item?.name) {
      return null;
    }
    if (context.subresource?.key) {
      return `${item.name} / ${subresourceLabel(context.subresource.kind)}: ${context.subresource.key}`;
    }
    return item.name;
  }

  /*
   * Each question names the resource on the page, so it is built here in
   * the reader's language; the titles are English keys the view translates.
   */
  public static getSuggestions(
    context: DashboardPageContext,
    translator: Translator = getGlobalTranslator(),
  ): Array<SuggestedQuestion> {
    const page: ResourcePageDefinition | undefined = context.resourceType
      ? RESOURCE_PAGES[context.resourceType]
      : undefined;
    if (!page || !context.resourceType) {
      return [];
    }
    const definition: AIResourceDefinition = getAIResourceDefinition(
      context.resourceType,
    );
    if (context.type === AIChatPageContextType.ResourcesList) {
      const resources: TemplateValues = {
        resources: translatableTerm(definition.pluralLabel, {
          inSentence: true,
        }),
      };

      return [
        {
          icon: IconProp.Search,
          title: "Resource overview",
          question: translator.translateTemplate(
            "List my {{resources}} and summarize their recorded metadata. Which resources need a closer look?",
            resources,
          ),
        },
        {
          icon: IconProp.Heartbeat,
          title: "Connection health",
          question: translator.translateTemplate(
            "Check connection status and last telemetry times for my {{resources}}, where available. Which resources have stopped reporting?",
            resources,
          ),
        },
        {
          icon: IconProp.ChartBar,
          title: "Metric trends",
          question: translator.translateTemplate(
            "Find available metrics for my {{resources}} and compare relevant trends over the last 24 hours.",
            resources,
          ),
        },
        {
          icon: IconProp.Error,
          title: "Recent errors",
          question: translator.translateTemplate(
            "Summarize log severity, trace errors and operation latency for my {{resources}} over the last 6 hours. Identify affected resources and explain any gaps in telemetry.",
            resources,
          ),
        },
      ];
    }
    const parent: TranslatableTerm = translatableTerm(page.noun, {
      inSentence: true,
    });
    if (context.subresource) {
      return [
        {
          icon: IconProp.Search,
          title: "Understand this view",
          question: translator.translateTemplate(
            "Explain the {{child}} context on this page and inspect its parent {{parent}}. Verify the child identity before attributing findings to it; state any missing namespace or identity information.",
            {
              child: translatableTerm(
                subresourceLabel(context.subresource.kind),
                { inSentence: true },
              ),
              parent: parent,
            },
          ),
        },
        {
          icon: IconProp.ChartBar,
          title: "Parent metric trends",
          question: translator.translateTemplate(
            "Find available metrics for the parent {{parent}} and chart relevant trends over the last 24 hours. Clearly distinguish parent-level findings from evidence for the child resource on this page.",
            { parent: parent },
          ),
        },
        {
          icon: IconProp.Error,
          title: "Parent resource errors",
          question: translator.translateTemplate(
            "Summarize log severity, trace errors and operation latency for the parent {{parent}} over the last 6 hours. Explain whether the evidence identifies the child resource on this page and do not assume a missing namespace.",
            { parent: parent },
          ),
        },
      ];
    }
    return [
      {
        icon: IconProp.Search,
        title: "Resource overview",
        question: translator.translateTemplate(
          "Summarize this {{resource}}'s recorded metadata and available telemetry. What needs a closer look?",
          { resource: parent },
        ),
      },
      {
        icon: IconProp.Heartbeat,
        title: "Connection health",
        question: translator.translateTemplate(
          "Check this {{resource}}'s connection status and when it last sent telemetry, where available. Is data arriving?",
          { resource: parent },
        ),
      },
      {
        icon: IconProp.ChartBar,
        title: "Metric trends",
        question: translator.translateTemplate(
          "Find available metrics for this {{resource}} and chart relevant trends over the last 24 hours. Identify changes that need attention.",
          { resource: parent },
        ),
      },
      {
        icon: IconProp.Error,
        title: "Recent errors",
        question: translator.translateTemplate(
          "Summarize log severity, trace errors and operation latency for this {{resource}} over the last 6 hours. Explain any gaps in available telemetry.",
          { resource: parent },
        ),
      },
    ];
  }
}
