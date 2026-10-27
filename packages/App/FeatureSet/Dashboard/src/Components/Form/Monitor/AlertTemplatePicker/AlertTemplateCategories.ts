import IconProp from "Common/Types/Icon/IconProp";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import { AlertTemplateCategory } from "./AlertTemplateGroups";

/*
 * The headings each infrastructure monitor type lists its alert templates
 * under, in order: on Create Monitor's Quick Setup, and on a resource's
 * Recommendations page, which groups the same templates by the same
 * categories. `category` is the template's own value; `label` is what the
 * reader sees ("ControlPlane" is Control Plane, "PG" is Placement Groups).
 * Host, Docker and Podman have a handful of templates each and list them
 * without headings. React-free, so App tests can read it.
 */

// Docker Swarm.
export const DOCKER_SWARM_TEMPLATE_CATEGORIES: Array<AlertTemplateCategory> = [
  {
    category: "Availability",
    label: "Availability",
    icon: IconProp.Heartbeat,
  },
  {
    category: "Resource",
    label: "Resource",
    icon: IconProp.Cube,
  },
  {
    category: "Container",
    label: "Container",
    icon: IconProp.Database,
  },
];

// Kubernetes.
export const KUBERNETES_TEMPLATE_CATEGORIES: Array<AlertTemplateCategory> = [
  {
    category: "Workload",
    label: "Workload",
    icon: IconProp.Cube,
  },
  {
    category: "Node",
    label: "Node",
    icon: IconProp.Server,
  },
  {
    category: "ControlPlane",
    label: "Control Plane",
    icon: IconProp.Settings,
  },
  {
    category: "Storage",
    label: "Storage",
    icon: IconProp.Disc,
  },
  {
    category: "Scheduling",
    label: "Scheduling",
    icon: IconProp.Clock,
  },
];

/*
 * A Kubernetes cluster's Recommendations: Quick Setup's headings, then
 * Events - the cluster's warning events alert, a Logs monitor over the
 * events the agent sends (KubernetesEventAlertTemplates), which a Kubernetes
 * monitor's Quick Setup cannot build and so never lists.
 */
export const KUBERNETES_RECOMMENDATION_CATEGORIES: Array<AlertTemplateCategory> =
  [
    ...KUBERNETES_TEMPLATE_CATEGORIES,
    {
      category: "Events",
      label: "Events",
      icon: IconProp.Bell,
    },
  ];

// Proxmox.
export const PROXMOX_TEMPLATE_CATEGORIES: Array<AlertTemplateCategory> = [
  {
    category: "Availability",
    label: "Availability",
    icon: IconProp.Heartbeat,
  },
  {
    category: "Node",
    label: "Node",
    icon: IconProp.ServerStack,
  },
  {
    category: "Guest",
    label: "Guest",
    icon: IconProp.Cube,
  },
  {
    category: "Storage",
    label: "Storage",
    icon: IconProp.Database,
  },
  {
    category: "HA",
    label: "High Availability",
    icon: IconProp.Refresh,
  },
  {
    category: "Backup",
    label: "Backup",
    icon: IconProp.Archive,
  },
  {
    category: "Replication",
    label: "Replication",
    icon: IconProp.ArrowPath,
  },
];

// VMware.
export const VMWARE_TEMPLATE_CATEGORIES: Array<AlertTemplateCategory> = [
  {
    category: "Host",
    label: "ESXi Host",
    icon: IconProp.ServerStack,
  },
  {
    category: "Virtual Machine",
    label: "Virtual Machine",
    icon: IconProp.ComputerDesktop,
  },
  {
    category: "Datastore",
    label: "Datastore",
    icon: IconProp.Database,
  },
  {
    category: "Cluster",
    label: "Cluster",
    icon: IconProp.Squares,
  },
  {
    category: "Datacenter",
    label: "Datacenter",
    icon: IconProp.BuildingOffice,
  },
  {
    category: "vSAN",
    label: "vSAN",
    icon: IconProp.RectangleStack,
  },
];

// Ceph.
export const CEPH_TEMPLATE_CATEGORIES: Array<AlertTemplateCategory> = [
  {
    category: "Cluster Health",
    label: "Cluster Health",
    icon: IconProp.Activity,
  },
  {
    category: "OSD",
    label: "OSD",
    icon: IconProp.Database,
  },
  {
    category: "PG",
    label: "Placement Groups",
    icon: IconProp.SquareStack,
  },
  {
    category: "Capacity",
    label: "Capacity",
    icon: IconProp.ChartBar,
  },
];

// Storage Array.
export const STORAGE_ARRAY_TEMPLATE_CATEGORIES: Array<AlertTemplateCategory> = [
  {
    category: "Array Health",
    label: "Array Health",
    icon: IconProp.Activity,
  },
  {
    category: "Capacity",
    label: "Capacity",
    icon: IconProp.ChartBar,
  },
  {
    category: "Performance",
    label: "Performance",
    icon: IconProp.Signal,
  },
  {
    category: "Hardware",
    label: "Hardware",
    icon: IconProp.CPUChip,
  },
  {
    category: "Hosts",
    label: "Hosts",
    icon: IconProp.Server,
  },
  {
    category: "Replication",
    label: "Replication",
    icon: IconProp.Refresh,
  },
  {
    category: "File Systems",
    label: "File Systems",
    icon: IconProp.Folder,
  },
];

// IoT.
export const IOT_TEMPLATE_CATEGORIES: Array<AlertTemplateCategory> = [
  {
    category: "Availability",
    label: "Availability",
    icon: IconProp.Heartbeat,
  },
  {
    category: "Power",
    label: "Power",
    icon: IconProp.Bolt,
  },
  {
    category: "Connectivity",
    label: "Connectivity",
    icon: IconProp.Signal,
  },
  {
    category: "Environment",
    label: "Environment",
    icon: IconProp.Fire,
  },
  {
    category: "System",
    label: "System",
    icon: IconProp.CPUChip,
  },
];

export const ALERT_TEMPLATE_CATEGORIES_BY_RESOURCE_TYPE: Partial<
  Record<MonitorRecommendationResourceType, Array<AlertTemplateCategory>>
> = {
  [MonitorRecommendationResourceType.DockerSwarm]:
    DOCKER_SWARM_TEMPLATE_CATEGORIES,
  [MonitorRecommendationResourceType.Kubernetes]:
    KUBERNETES_RECOMMENDATION_CATEGORIES,
  [MonitorRecommendationResourceType.Proxmox]: PROXMOX_TEMPLATE_CATEGORIES,
  [MonitorRecommendationResourceType.VMware]: VMWARE_TEMPLATE_CATEGORIES,
  [MonitorRecommendationResourceType.Ceph]: CEPH_TEMPLATE_CATEGORIES,
  [MonitorRecommendationResourceType.StorageArray]:
    STORAGE_ARRAY_TEMPLATE_CATEGORIES,
  [MonitorRecommendationResourceType.IoTDevice]: IOT_TEMPLATE_CATEGORIES,
};

/*
 * A resource's Recommendations, in the order Quick Setup lists the same
 * templates: the headings the type names, in its order, then any other
 * category of the catalog's, in the catalog's order (never dropped). A type
 * without headings (Host, Docker, Podman, a Service) keeps the catalog's
 * order as it is.
 */
export function orderAlertTemplateCategories(
  resourceType: MonitorRecommendationResourceType,
  categories: Array<string>,
): Array<string> {
  const named: Array<AlertTemplateCategory> | undefined =
    ALERT_TEMPLATE_CATEGORIES_BY_RESOURCE_TYPE[resourceType];

  if (!named) {
    return [...categories];
  }

  const ordered: Array<string> = named
    .map((category: AlertTemplateCategory): string => {
      return category.category;
    })
    .filter((category: string): boolean => {
      return categories.includes(category);
    });

  for (const category of categories) {
    if (!ordered.includes(category)) {
      ordered.push(category);
    }
  }

  return ordered;
}

/*
 * What a resource type calls one of its template categories, or undefined
 * when it names no heading for it (the page then shows the value as it is).
 */
export function getAlertTemplateCategoryLabel(
  resourceType: MonitorRecommendationResourceType,
  category: string,
): string | undefined {
  return ALERT_TEMPLATE_CATEGORIES_BY_RESOURCE_TYPE[resourceType]?.find(
    (candidate: AlertTemplateCategory): boolean => {
      return candidate.category === category;
    },
  )?.label;
}
