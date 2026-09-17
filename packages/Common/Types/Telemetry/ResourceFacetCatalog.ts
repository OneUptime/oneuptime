import IconProp from "../Icon/IconProp";
import ServiceType from "./ServiceType";

/*
 * The one list of non-Service resource types the telemetry explorers
 * (Logs / Traces / Exceptions) offer as filter facets.
 *
 * Every per-resource table used to be copied by hand — the facet keys a
 * viewer requests, the sidebar titles, the ServiceType each aggregation
 * service counts, the keys the server resolves from Postgres — and the
 * copies drifted: Host / Docker / Podman / Kubernetes were wired end to
 * end while Proxmox, vCenter, Ceph, Docker Swarm, Serverless, Cloud, RUM
 * and IoT were each missing from one layer or another. Deriving those
 * tables from this catalog keeps a new resource type a one-line change.
 *
 * Kept free of React and database models so both the server and the
 * browser (and plain unit tests) can import it.
 */

export interface ResourceFacetDefinition {
  // Facet key used on the wire, in chips and in saved views.
  facetKey: string;
  /*
   * `primaryEntityType` stamped on telemetry whose primary entity is this
   * resource. IoT fleet telemetry is stamped `IoTDevice` with the fleet id
   * (there is no fleet member), and RUM applications `RealUserMonitor`.
   */
  serviceType: ServiceType;
  // Singular, title-cased label ("Kubernetes Cluster").
  label: string;
  // Plural label for sentences ("Kubernetes Clusters").
  pluralLabel: string;
  icon: IconProp;
}

export const RESOURCE_FACET_CATALOG: ReadonlyArray<ResourceFacetDefinition> = [
  {
    facetKey: "hostId",
    serviceType: ServiceType.Host,
    label: "Host",
    pluralLabel: "Hosts",
    icon: IconProp.Server,
  },
  {
    facetKey: "dockerHostId",
    serviceType: ServiceType.DockerHost,
    label: "Docker Host",
    pluralLabel: "Docker Hosts",
    icon: IconProp.Docker,
  },
  {
    facetKey: "podmanHostId",
    serviceType: ServiceType.PodmanHost,
    label: "Podman Host",
    pluralLabel: "Podman Hosts",
    icon: IconProp.Podman,
  },
  {
    facetKey: "kubernetesClusterId",
    serviceType: ServiceType.KubernetesCluster,
    label: "Kubernetes Cluster",
    pluralLabel: "Kubernetes Clusters",
    icon: IconProp.Kubernetes,
  },
  {
    facetKey: "dockerSwarmClusterId",
    serviceType: ServiceType.DockerSwarmCluster,
    label: "Docker Swarm Cluster",
    pluralLabel: "Docker Swarm Clusters",
    icon: IconProp.DockerSwarm,
  },
  {
    facetKey: "proxmoxClusterId",
    serviceType: ServiceType.ProxmoxCluster,
    label: "Proxmox Cluster",
    pluralLabel: "Proxmox Clusters",
    icon: IconProp.Proxmox,
  },
  {
    facetKey: "vmwareVCenterId",
    serviceType: ServiceType.VMwareVCenter,
    label: "vCenter",
    pluralLabel: "vCenters",
    icon: IconProp.VMware,
  },
  {
    facetKey: "cephClusterId",
    serviceType: ServiceType.CephCluster,
    label: "Ceph Cluster",
    pluralLabel: "Ceph Clusters",
    icon: IconProp.Ceph,
  },
  {
    facetKey: "serverlessFunctionId",
    serviceType: ServiceType.ServerlessFunction,
    label: "Serverless Function",
    pluralLabel: "Serverless Functions",
    icon: IconProp.Bolt,
  },
  {
    facetKey: "cloudResourceId",
    serviceType: ServiceType.CloudResource,
    label: "Cloud Resource",
    pluralLabel: "Cloud Resources",
    icon: IconProp.Cloud,
  },
  {
    facetKey: "rumApplicationId",
    serviceType: ServiceType.RealUserMonitor,
    label: "RUM Application",
    pluralLabel: "RUM Applications",
    icon: IconProp.Globe,
  },
  {
    facetKey: "iotFleetId",
    serviceType: ServiceType.IoTDevice,
    label: "IoT Fleet",
    pluralLabel: "IoT Fleets",
    icon: IconProp.IoT,
  },
];

// Catalog order — the order the sidebars list resource facets in.
export const RESOURCE_FACET_CATALOG_KEYS: ReadonlyArray<string> =
  RESOURCE_FACET_CATALOG.map((definition: ResourceFacetDefinition): string => {
    return definition.facetKey;
  });

const DEFINITIONS_BY_KEY: ReadonlyMap<string, ResourceFacetDefinition> =
  new Map<string, ResourceFacetDefinition>(
    RESOURCE_FACET_CATALOG.map(
      (
        definition: ResourceFacetDefinition,
      ): [string, ResourceFacetDefinition] => {
        return [definition.facetKey, definition];
      },
    ),
  );

export function getResourceFacetDefinition(
  facetKey: string,
): ResourceFacetDefinition | undefined {
  return DEFINITIONS_BY_KEY.get(facetKey);
}

export function isCatalogResourceFacetKey(facetKey: string): boolean {
  return DEFINITIONS_BY_KEY.has(facetKey);
}

/*
 * facetKey → ServiceType, the shape the aggregation services count
 * resource facets with (`primaryEntityType = <ServiceType>`).
 */
export function getResourceFacetServiceTypeMap(): Map<string, ServiceType> {
  return new Map<string, ServiceType>(
    RESOURCE_FACET_CATALOG.map(
      (definition: ResourceFacetDefinition): [string, ServiceType] => {
        return [definition.facetKey, definition.serviceType];
      },
    ),
  );
}

// facetKey → singular label, for chip keys and section titles.
export function getResourceFacetLabelMap(): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const definition of RESOURCE_FACET_CATALOG) {
    labels[definition.facetKey] = definition.label;
  }
  return labels;
}
