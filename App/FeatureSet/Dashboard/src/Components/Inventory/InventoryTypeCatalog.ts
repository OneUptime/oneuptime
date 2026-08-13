import EntityType from "Common/Types/Telemetry/EntityType";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * The presentation layer's vocabulary for the Inventory product.
 *
 * `EntityType` is a wire vocabulary: its values are semconv-style dotted
 * strings (`k8s.pod`, `docker.swarm.task`) chosen so they read naturally in
 * stored identity sets. They read terribly in a UI — "k8s.pod" in a table
 * cell, an unordered dropdown of 30 dotted strings, a page titled
 * `external.database`. This module is the single place that turns each of
 * them into something a human can scan: a name, a category, an icon.
 *
 * Two rules keep it honest, and the tests enforce both:
 *
 *   - Every EntityType has an entry. A type without one would fall back to
 *     its raw dotted string, which is exactly the ugliness this exists to
 *     remove — so a newly added type fails the test rather than quietly
 *     leaking into the UI.
 *   - Categories partition the vocabulary. Each type belongs to exactly one,
 *     so the Overview's category breakdown always sums to the total. A type
 *     in two categories would be double-counted; a type in none would
 *     silently vanish from the breakdown while still counting in the total.
 *
 * Lookups take `string`, not `EntityType`. Registry rows are written by the
 * server, so a dashboard running against a newer server can legitimately meet
 * a type this build has never heard of — that has to render as itself rather
 * than crash or blank.
 */

/**
 * The shelf an inventory item sits on. Categories exist for the human
 * skimming the estate ("show me the Kubernetes things"), which is a coarser
 * question than the type vocabulary answers.
 */
export enum InventoryCategory {
  Applications = "Applications",
  Compute = "Compute",
  Kubernetes = "Kubernetes",
  Clusters = "Clusters",
  Network = "Network & Devices",
  Cloud = "Cloud",
  External = "External",
}

/**
 * Display order for categories, most-common-first. The Overview breakdown and
 * the type dropdown both render in this order, so the two agree.
 */
export const INVENTORY_CATEGORY_ORDER: Array<InventoryCategory> = [
  InventoryCategory.Applications,
  InventoryCategory.Compute,
  InventoryCategory.Kubernetes,
  InventoryCategory.Clusters,
  InventoryCategory.Network,
  InventoryCategory.Cloud,
  InventoryCategory.External,
];

export interface InventoryTypeDescriptor {
  entityType: EntityType;
  /** Singular, title-cased: "Kubernetes Pod". */
  label: string;
  /** Used for headings and counts: "Kubernetes Pods". */
  pluralLabel: string;
  category: InventoryCategory;
  icon: IconProp;
  /** One line explaining what this kind of thing is. */
  description: string;
}

type CatalogEntry = Omit<InventoryTypeDescriptor, "entityType">;

/*
 * Declared as a total Record so TypeScript itself refuses a build where a new
 * EntityType has no entry. The runtime test that asserts the same thing is
 * not redundant: the catalog is also read through the string-keyed lookups
 * below, which the compiler cannot check.
 */
const CATALOG: Record<EntityType, CatalogEntry> = {
  [EntityType.Service]: {
    label: "Service",
    pluralLabel: "Services",
    category: InventoryCategory.Applications,
    icon: IconProp.SquareStack,
    description: "An application or microservice reporting telemetry.",
  },
  [EntityType.ServiceInstance]: {
    label: "Service Instance",
    pluralLabel: "Service Instances",
    category: InventoryCategory.Applications,
    icon: IconProp.Squares,
    description: "One running replica of a service.",
  },
  [EntityType.RumApplication]: {
    label: "Browser Application",
    pluralLabel: "Browser Applications",
    category: InventoryCategory.Applications,
    icon: IconProp.Globe,
    description: "A front-end app instrumented for real user monitoring.",
  },
  [EntityType.ServerlessFunction]: {
    label: "Serverless Function",
    pluralLabel: "Serverless Functions",
    category: InventoryCategory.Applications,
    icon: IconProp.Bolt,
    description: "A function-as-a-service deployment.",
  },
  [EntityType.TelemetrySdk]: {
    label: "Telemetry SDK",
    pluralLabel: "Telemetry SDKs",
    category: InventoryCategory.Applications,
    icon: IconProp.Code,
    description: "An OpenTelemetry SDK build that is sending you data.",
  },

  [EntityType.Host]: {
    label: "Host",
    pluralLabel: "Hosts",
    category: InventoryCategory.Compute,
    icon: IconProp.Server,
    description: "A physical or virtual machine.",
  },
  [EntityType.Container]: {
    label: "Container",
    pluralLabel: "Containers",
    category: InventoryCategory.Compute,
    icon: IconProp.Cube,
    description: "A running container.",
  },
  [EntityType.Process]: {
    label: "Process",
    pluralLabel: "Processes",
    category: InventoryCategory.Compute,
    icon: IconProp.CommandLine,
    description: "An operating-system process.",
  },
  [EntityType.DockerHost]: {
    label: "Docker Host",
    pluralLabel: "Docker Hosts",
    category: InventoryCategory.Compute,
    icon: IconProp.Docker,
    description: "A machine running the Docker engine.",
  },
  [EntityType.PodmanHost]: {
    label: "Podman Host",
    pluralLabel: "Podman Hosts",
    category: InventoryCategory.Compute,
    icon: IconProp.Podman,
    description: "A machine running Podman.",
  },

  [EntityType.KubernetesCluster]: {
    label: "Kubernetes Cluster",
    pluralLabel: "Kubernetes Clusters",
    category: InventoryCategory.Kubernetes,
    icon: IconProp.Kubernetes,
    description: "A Kubernetes cluster.",
  },
  [EntityType.KubernetesNamespace]: {
    label: "Kubernetes Namespace",
    pluralLabel: "Kubernetes Namespaces",
    category: InventoryCategory.Kubernetes,
    icon: IconProp.Folder,
    description: "A namespace within a Kubernetes cluster.",
  },
  [EntityType.KubernetesNode]: {
    label: "Kubernetes Node",
    pluralLabel: "Kubernetes Nodes",
    category: InventoryCategory.Kubernetes,
    icon: IconProp.ServerStack,
    description: "A worker or control-plane node in a cluster.",
  },
  [EntityType.KubernetesPod]: {
    label: "Kubernetes Pod",
    pluralLabel: "Kubernetes Pods",
    category: InventoryCategory.Kubernetes,
    icon: IconProp.Cube,
    description: "A pod scheduled on a Kubernetes node.",
  },
  [EntityType.KubernetesDeployment]: {
    label: "Kubernetes Deployment",
    pluralLabel: "Kubernetes Deployments",
    category: InventoryCategory.Kubernetes,
    icon: IconProp.RectangleStack,
    description: "A deployment managing a set of pods.",
  },

  [EntityType.ProxmoxCluster]: {
    label: "Proxmox Cluster",
    pluralLabel: "Proxmox Clusters",
    category: InventoryCategory.Clusters,
    icon: IconProp.Proxmox,
    description: "A Proxmox VE cluster.",
  },
  [EntityType.ProxmoxNode]: {
    label: "Proxmox Node",
    pluralLabel: "Proxmox Nodes",
    category: InventoryCategory.Clusters,
    icon: IconProp.Server,
    description: "A hypervisor node in a Proxmox cluster.",
  },
  [EntityType.ProxmoxGuest]: {
    label: "Proxmox Guest",
    pluralLabel: "Proxmox Guests",
    category: InventoryCategory.Clusters,
    icon: IconProp.ComputerDesktop,
    description: "A VM or container guest running on Proxmox.",
  },
  [EntityType.CephCluster]: {
    label: "Ceph Cluster",
    pluralLabel: "Ceph Clusters",
    category: InventoryCategory.Clusters,
    icon: IconProp.Ceph,
    description: "A Ceph storage cluster.",
  },
  [EntityType.DockerSwarmCluster]: {
    label: "Swarm Cluster",
    pluralLabel: "Swarm Clusters",
    category: InventoryCategory.Clusters,
    icon: IconProp.DockerSwarm,
    description: "A Docker Swarm cluster.",
  },
  [EntityType.DockerSwarmNode]: {
    label: "Swarm Node",
    pluralLabel: "Swarm Nodes",
    category: InventoryCategory.Clusters,
    icon: IconProp.Server,
    description: "A node participating in a Docker Swarm.",
  },
  [EntityType.DockerSwarmService]: {
    label: "Swarm Service",
    pluralLabel: "Swarm Services",
    category: InventoryCategory.Clusters,
    icon: IconProp.SquareStack,
    description: "A service scheduled onto a Docker Swarm.",
  },
  [EntityType.DockerSwarmTask]: {
    label: "Swarm Task",
    pluralLabel: "Swarm Tasks",
    category: InventoryCategory.Clusters,
    icon: IconProp.QueueList,
    description: "One task (container) of a Swarm service.",
  },

  [EntityType.NetworkDevice]: {
    label: "Network Device",
    pluralLabel: "Network Devices",
    category: InventoryCategory.Network,
    icon: IconProp.Signal,
    description: "A switch, router or firewall polled over SNMP.",
  },
  [EntityType.IoTDevice]: {
    label: "IoT Device",
    pluralLabel: "IoT Devices",
    category: InventoryCategory.Network,
    icon: IconProp.IoT,
    description: "A device in one of your IoT fleets.",
  },

  [EntityType.CloudResource]: {
    label: "Cloud Resource",
    pluralLabel: "Cloud Resources",
    category: InventoryCategory.Cloud,
    icon: IconProp.Cloud,
    description: "A resource discovered in a connected cloud account.",
  },

  [EntityType.ExternalService]: {
    label: "External Service",
    pluralLabel: "External Services",
    category: InventoryCategory.External,
    icon: IconProp.ExternalLink,
    description:
      "A third-party API or vendor-managed service you depend on but cannot instrument.",
  },
  [EntityType.ExternalDatabase]: {
    label: "External Database",
    pluralLabel: "External Databases",
    category: InventoryCategory.External,
    icon: IconProp.Database,
    description: "A database you depend on but do not run yourself.",
  },
  [EntityType.Appliance]: {
    label: "Appliance",
    pluralLabel: "Appliances",
    category: InventoryCategory.External,
    icon: IconProp.CPUChip,
    description: "A physical or virtual appliance that emits no telemetry.",
  },
};

/**
 * Every type this build knows how to present, in category order and then in
 * the order declared within each category. This is the order the type
 * dropdown and the Overview breakdown both render in.
 */
export const INVENTORY_TYPE_DESCRIPTORS: Array<InventoryTypeDescriptor> =
  INVENTORY_CATEGORY_ORDER.flatMap(
    (category: InventoryCategory): Array<InventoryTypeDescriptor> => {
      return Object.values(EntityType)
        .filter((entityType: EntityType): boolean => {
          return CATALOG[entityType].category === category;
        })
        .map((entityType: EntityType): InventoryTypeDescriptor => {
          return { entityType, ...CATALOG[entityType] };
        });
    },
  );

export type GetInventoryTypeDescriptorFunction = (
  entityType: string,
) => InventoryTypeDescriptor | null;

/**
 * The descriptor for a type, or `null` for one this build does not know —
 * which a dashboard running against a newer server can legitimately meet.
 * Callers that only need something renderable should use the helpers below,
 * which all degrade to the raw type string.
 */
export const getInventoryTypeDescriptor: GetInventoryTypeDescriptorFunction = (
  entityType: string,
): InventoryTypeDescriptor | null => {
  const entry: CatalogEntry | undefined = CATALOG[entityType as EntityType];

  if (!entry) {
    return null;
  }

  return { entityType: entityType as EntityType, ...entry };
};

export type InventoryTypeLabelFunction = (entityType: string) => string;

export const getInventoryTypeLabel: InventoryTypeLabelFunction = (
  entityType: string,
): string => {
  return getInventoryTypeDescriptor(entityType)?.label || entityType;
};

export const getInventoryTypePluralLabel: InventoryTypeLabelFunction = (
  entityType: string,
): string => {
  return getInventoryTypeDescriptor(entityType)?.pluralLabel || entityType;
};

export type InventoryTypeIconFunction = (entityType: string) => IconProp;

/**
 * Unknown types get the generic cube rather than no icon at all — a row with
 * a missing icon reads as a rendering bug, not as "new kind of thing".
 */
export const getInventoryTypeIcon: InventoryTypeIconFunction = (
  entityType: string,
): IconProp => {
  return getInventoryTypeDescriptor(entityType)?.icon || IconProp.Cube;
};

export type InventoryTypeCategoryFunction = (
  entityType: string,
) => InventoryCategory | null;

export const getInventoryTypeCategory: InventoryTypeCategoryFunction = (
  entityType: string,
): InventoryCategory | null => {
  return getInventoryTypeDescriptor(entityType)?.category || null;
};

export type EntityTypesInCategoryFunction = (
  category: InventoryCategory,
) => Array<EntityType>;

export const getEntityTypesInCategory: EntityTypesInCategoryFunction = (
  category: InventoryCategory,
): Array<EntityType> => {
  return INVENTORY_TYPE_DESCRIPTORS.filter(
    (descriptor: InventoryTypeDescriptor): boolean => {
      return descriptor.category === category;
    },
  ).map((descriptor: InventoryTypeDescriptor): EntityType => {
    return descriptor.entityType;
  });
};

export interface InventoryCategoryBreakdownRow {
  entityType: string;
  label: string;
  icon: IconProp;
  count: number;
}

export interface InventoryCategoryBreakdown {
  category: InventoryCategory | null;
  /** `null` category — types this build has no descriptor for. */
  label: string;
  total: number;
  rows: Array<InventoryCategoryBreakdownRow>;
}

export type BuildInventoryBreakdownFunction = (
  countsByType: Record<string, number>,
) => Array<InventoryCategoryBreakdown>;

/**
 * Fold a per-type count map into the category breakdown the Overview renders.
 *
 * Categories and types that counted zero are dropped: an estate with no
 * Kubernetes in it should not be told about five empty Kubernetes rows. Types
 * with no descriptor are collected into one trailing "Other" group rather
 * than discarded, so the breakdown's totals always add up to the count the
 * summary tile shows.
 */
export const buildInventoryBreakdown: BuildInventoryBreakdownFunction = (
  countsByType: Record<string, number>,
): Array<InventoryCategoryBreakdown> => {
  const breakdown: Array<InventoryCategoryBreakdown> = [];

  for (const category of INVENTORY_CATEGORY_ORDER) {
    const rows: Array<InventoryCategoryBreakdownRow> = [];
    let total: number = 0;

    for (const entityType of getEntityTypesInCategory(category)) {
      const count: number = countsByType[entityType] || 0;

      if (count <= 0) {
        continue;
      }

      total += count;
      rows.push({
        entityType,
        label: getInventoryTypePluralLabel(entityType),
        icon: getInventoryTypeIcon(entityType),
        count,
      });
    }

    if (rows.length === 0) {
      continue;
    }

    // Biggest first: the shape of the estate, not the order we declared it in.
    rows.sort(
      (
        a: InventoryCategoryBreakdownRow,
        b: InventoryCategoryBreakdownRow,
      ): number => {
        return b.count - a.count;
      },
    );

    breakdown.push({ category, label: category, total, rows });
  }

  const unknownRows: Array<InventoryCategoryBreakdownRow> = Object.keys(
    countsByType,
  )
    .filter((entityType: string): boolean => {
      return (
        !getInventoryTypeDescriptor(entityType) &&
        (countsByType[entityType] || 0) > 0
      );
    })
    .sort()
    .map((entityType: string): InventoryCategoryBreakdownRow => {
      return {
        entityType,
        label: entityType,
        icon: IconProp.Cube,
        count: countsByType[entityType] || 0,
      };
    });

  if (unknownRows.length > 0) {
    breakdown.push({
      category: null,
      label: "Other",
      total: unknownRows.reduce(
        (sum: number, row: InventoryCategoryBreakdownRow): number => {
          return sum + row.count;
        },
        0,
      ),
      rows: unknownRows,
    });
  }

  return breakdown;
};
