import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Service from "Common/Models/DatabaseModels/Service";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import LinkedTo, {
  LinkedToMatch,
  MAX_LINKED_TO_IDS,
} from "Common/Types/BaseDatabase/LinkedTo";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import RecordsById from "Common/UI/Utils/RecordsById";
import { ARCHIVED_COLUMN } from "Common/Utils/ArchivableValues";
/*
 * Both types are pulled from the react-free modules that declare them,
 * rather than from the .tsx components that re-export them, so this
 * helper stays importable from a plain unit test.
 */
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../ResourceOwners/ResourceFacet";

/*
 * Builds a unified "Affected Resources" facet that lets the user search and
 * filter Incidents / Alerts / Scheduled Maintenance by *any* attached
 * resource type — Monitor, Service, Host, Kubernetes Cluster, Docker Host,
 * Podman Host, Proxmox / Ceph / Docker Swarm cluster, vCenter, Storage Array,
 * IoT Fleet, Database and — for Scheduled Maintenance only — Network Site,
 * and — for Incidents and Alerts only — Network Device, Cloud Resource and
 * SLO.
 *
 * The chip's value encoding is `${type}:${id}` so multiple resource types
 * can coexist in the same selection without ID collisions. Its filter is
 * one LinkedTo the list's own query carries (buildAffectedResourcesLinkedTo,
 * #11073): each type's picks under that type's relation, OR'd, answered by
 * the server - so a list filtered by a monitor pages and counts every
 * incident it touches, however many. It read each type's matching records
 * first, the first 10,000 of them, and filtered the list by their ids.
 *
 * Keep this in sync with AffectedResourcesPicker / AffectedResourcesCell:
 * adding a resource type means updating all three so picker, filter, and
 * row display stay aligned.
 */

export type AffectedResourceType =
  | "monitor"
  | "service"
  | "host"
  | "networkDevice"
  | "kubernetesCluster"
  | "dockerHost"
  | "podmanHost"
  | "proxmoxCluster"
  | "openStackCloud"
  | "vmwareVCenter"
  | "cephCluster"
  | "storageArray"
  | "dockerSwarmCluster"
  | "iotFleet"
  | "databaseServer"
  | "cloudResource"
  | "networkSite"
  | "serviceLevelObjective";

interface ResourceTypeConfig {
  label: string;
  pluralLabel: string;
  icon: IconProp;
  modelType: { new (): BaseModel };
}

const RESOURCE_TYPES: Record<AffectedResourceType, ResourceTypeConfig> = {
  monitor: {
    label: "Monitor",
    pluralLabel: "Monitors",
    icon: IconProp.AltGlobe,
    modelType: Monitor,
  },
  service: {
    label: "Service",
    pluralLabel: "Services",
    icon: IconProp.SquareStack,
    modelType: Service,
  },
  host: {
    label: "Host",
    pluralLabel: "Hosts",
    icon: IconProp.Server,
    modelType: Host,
  },
  networkDevice: {
    label: "Network Device",
    pluralLabel: "Network Devices",
    icon: IconProp.Signal,
    modelType: NetworkDevice,
  },
  kubernetesCluster: {
    label: "Kubernetes Cluster",
    pluralLabel: "Kubernetes Clusters",
    icon: IconProp.Kubernetes,
    modelType: KubernetesCluster,
  },
  dockerHost: {
    label: "Docker Host",
    pluralLabel: "Docker Hosts",
    icon: IconProp.Docker,
    modelType: DockerHost,
  },
  podmanHost: {
    label: "Podman Host",
    pluralLabel: "Podman Hosts",
    icon: IconProp.Podman,
    modelType: PodmanHost,
  },
  proxmoxCluster: {
    label: "Proxmox Cluster",
    pluralLabel: "Proxmox Clusters",
    icon: IconProp.Proxmox,
    modelType: ProxmoxCluster,
  },
  openStackCloud: {
    label: "OpenStack Cloud",
    pluralLabel: "OpenStack Clouds",
    icon: IconProp.Cloud,
    modelType: OpenStackCloud,
  },
  vmwareVCenter: {
    label: "vCenter",
    pluralLabel: "vCenters",
    icon: IconProp.VMware,
    modelType: VMwareVCenter,
  },
  cephCluster: {
    label: "Ceph Cluster",
    pluralLabel: "Ceph Clusters",
    icon: IconProp.Ceph,
    modelType: CephCluster,
  },
  storageArray: {
    label: "Storage Array",
    pluralLabel: "Storage Arrays",
    icon: IconProp.StorageArray,
    modelType: StorageArray,
  },
  dockerSwarmCluster: {
    label: "Docker Swarm Cluster",
    pluralLabel: "Docker Swarm Clusters",
    icon: IconProp.DockerSwarm,
    modelType: DockerSwarmCluster,
  },
  iotFleet: {
    label: "IoT Fleet",
    pluralLabel: "IoT Fleets",
    icon: IconProp.IoT,
    modelType: IoTFleet,
  },
  databaseServer: {
    label: "Database",
    pluralLabel: "Databases",
    icon: IconProp.Database,
    modelType: DatabaseServer,
  },
  cloudResource: {
    label: "Cloud Resource",
    pluralLabel: "Cloud Resources",
    icon: IconProp.Cloud,
    modelType: CloudResource,
  },
  networkSite: {
    label: "Network Site",
    pluralLabel: "Network Sites",
    icon: IconProp.BuildingOffice,
    modelType: NetworkSite,
  },
  serviceLevelObjective: {
    label: "SLO",
    pluralLabel: "SLOs",
    icon: IconProp.Gauge,
    modelType: ServiceLevelObjective,
  },
};

const RESOURCE_ORDER: Array<AffectedResourceType> = [
  "monitor",
  "service",
  "host",
  /*
   * Only Incident and Alert carry a networkDevices relation (issue #5341),
   * so this is opt-in (see includeNetworkDevice).
   */
  "networkDevice",
  "kubernetesCluster",
  "dockerHost",
  "podmanHost",
  "proxmoxCluster",
  "openStackCloud",
  "vmwareVCenter",
  "cephCluster",
  "storageArray",
  "dockerSwarmCluster",
  "iotFleet",
  "databaseServer",
  /*
   * Only Incident, Alert and ScheduledMaintenance carry a cloudResources
   * relation, so this is opt-in (see includeCloudResource).
   */
  "cloudResource",
  /*
   * Only ScheduledMaintenance carries a networkSites relation, so this one
   * is opt-in per table (see includeNetworkSite). Filtering Incidents by it
   * would query a column Incident does not have.
   */
  "networkSite",
  /*
   * Only Incident and Alert carry a serviceLevelObjectives relation (burn
   * rate rules link the SLO that fired), so this is opt-in too (see
   * includeServiceLevelObjective). ScheduledMaintenance has no such column.
   */
  "serviceLevelObjective",
];

/*
 * The parent relation each type filters on. Alert.monitorId is the only
 * M2O — every other relation is a true M2M. Held as an exhaustive
 * Record so adding a type to AffectedResourceType is a compile error
 * until its field is mapped; the previous if/else chain ended in a bare
 * `else` that silently filtered new types by `podmanHosts`.
 */
const RESOURCE_QUERY_FIELD: Record<
  Exclude<AffectedResourceType, "monitor">,
  string
> = {
  service: "services",
  host: "hosts",
  networkDevice: "networkDevices",
  kubernetesCluster: "kubernetesClusters",
  dockerHost: "dockerHosts",
  podmanHost: "podmanHosts",
  proxmoxCluster: "proxmoxClusters",
  openStackCloud: "openStackClouds",
  vmwareVCenter: "vmwareVCenters",
  cephCluster: "cephClusters",
  storageArray: "storageArrays",
  dockerSwarmCluster: "dockerSwarmClusters",
  iotFleet: "iotFleets",
  databaseServer: "databaseServers",
  cloudResource: "cloudResources",
  networkSite: "networkSites",
  serviceLevelObjective: "serviceLevelObjectives",
};

/*
 * Capped per type so a populous tenant (e.g. 5000 monitors) can't drown out
 * the other resource types in a single dropdown.
 */
const SEARCH_LIMIT_PER_TYPE: number = 25;

const encodeKey: (type: AffectedResourceType, id: string) => string = (
  type: AffectedResourceType,
  id: string,
): string => {
  return `${type}:${id}`;
};

const parseKey: (
  key: string,
) => { type: AffectedResourceType; id: string } | null = (
  key: string,
): { type: AffectedResourceType; id: string } | null => {
  const idx: number = key.indexOf(":");
  if (idx === -1) {
    return null;
  }
  const type: string = key.slice(0, idx);
  const id: string = key.slice(idx + 1);
  if (
    type !== "monitor" &&
    !Object.prototype.hasOwnProperty.call(RESOURCE_QUERY_FIELD, type)
  ) {
    return null;
  }
  return { type: type as AffectedResourceType, id };
};

const groupSelectionsByType: (selected: Array<string>) => {
  [type in AffectedResourceType]?: Array<string>;
} = (
  selected: Array<string>,
): { [type in AffectedResourceType]?: Array<string> } => {
  const grouped: { [type in AffectedResourceType]?: Array<string> } = {};
  for (const key of selected) {
    const parsed: { type: AffectedResourceType; id: string } | null =
      parseKey(key);
    if (!parsed) {
      continue;
    }
    if (!grouped[parsed.type]) {
      grouped[parsed.type] = [];
    }
    grouped[parsed.type]!.push(parsed.id);
  }
  return grouped;
};

interface NamedModel extends BaseModel {
  name?: string | undefined;
}

// A resource the chip names: its id, its name, whether it is archived.
interface NamedResource {
  id: string;
  name: string;
  isArchived: boolean;
}

// What a search or a read of a type selects: its name, and archived when it can be.
const getNamedSelect: <T extends BaseModel>(modelType: {
  new (): T;
}) => Select<T> = <T extends BaseModel>(modelType: {
  new (): T;
}): Select<T> => {
  return {
    _id: true,
    name: true,
    ...(new modelType().hasColumn(ARCHIVED_COLUMN)
      ? { [ARCHIVED_COLUMN]: true }
      : {}),
  } as Select<T>;
};

const toNamedResource: (record: BaseModel) => NamedResource | null = (
  record: BaseModel,
): NamedResource | null => {
  const id: string | undefined = record.id?.toString();

  if (!id) {
    return null;
  }

  return {
    id: id,
    name: (record as NamedModel).name?.toString() || `Unnamed`,
    isArchived:
      (record as unknown as Record<string, unknown>)[ARCHIVED_COLUMN] === true,
  };
};

const fetchNamedModels: <T extends BaseModel>(args: {
  modelType: { new (): T };
  projectId: ObjectID;
  searchTerm: string;
  limit: number;
}) => Promise<Array<NamedResource>> = async <T extends BaseModel>({
  modelType,
  projectId,
  searchTerm,
  limit,
}: {
  modelType: { new (): T };
  projectId: ObjectID;
  searchTerm: string;
  limit: number;
}): Promise<Array<NamedResource>> => {
  const query: Query<T> = { projectId: projectId } as Query<T>;
  if (searchTerm.trim()) {
    (query as unknown as Record<string, unknown>)["name"] = new Search(
      searchTerm.trim(),
    );
  }
  try {
    const result: ListResult<T> = await ModelAPI.getList<T>({
      modelType: modelType,
      query: query,
      limit: limit,
      skip: 0,
      select: getNamedSelect(modelType),
      sort: { name: SortOrder.Ascending } as Record<string, SortOrder>,
    });
    return result.data
      .map(toNamedResource)
      .filter((v: NamedResource | null): v is NamedResource => {
        return v !== null;
      });
  } catch {
    return [];
  }
};

/*
 * The resources a link or a saved view picked, read by their ids (each
 * once, in pages - RecordsById), under the project: every one the reader
 * may see, by its id in lower case.
 */
const resolveNamedModelsByIds: <T extends BaseModel>(args: {
  modelType: { new (): T };
  projectId: ObjectID;
  ids: Array<string>;
}) => Promise<Map<string, NamedResource>> = async <T extends BaseModel>({
  modelType,
  projectId,
  ids,
}: {
  modelType: { new (): T };
  projectId: ObjectID;
  ids: Array<string>;
}): Promise<Map<string, NamedResource>> => {
  const found: Map<string, NamedResource> = new Map<string, NamedResource>();

  if (ids.length === 0) {
    return found;
  }

  const records: Array<T> = await RecordsById.read<T>({
    modelType: modelType,
    ids: ids,
    query: { projectId: projectId } as Query<T>,
    select: getNamedSelect(modelType),
  });

  for (const record of records) {
    const named: NamedResource | null = toNamedResource(record);

    if (named) {
      found.set(named.id.toLowerCase(), named);
    }
  }

  return found;
};

// The relation a type's picks filter on, for a list whose monitors are `monitorField`.
const getRelationOf: (
  type: AffectedResourceType,
  monitorField: "monitors" | "monitorId",
) => string = (
  type: AffectedResourceType,
  monitorField: "monitors" | "monitorId",
): string => {
  return type === "monitor" ? monitorField : RESOURCE_QUERY_FIELD[type];
};

// The id no record has: picks that name nothing filter by it, and match nothing.
export const NO_RESOURCE_ID: string = "00000000-0000-0000-0000-000000000000";

/*
 * THE CHIP'S FILTER, AS THE SERVER ANSWERS IT (#11073): the picks of each
 * type under that type's relation, in one LinkedTo the list's query
 * carries - AnyOf for "is" (a record touching any of them), NoneOf for
 * "is not" (a record touching none, one touching nothing included) - or
 * null when it filters nothing.
 *
 * A pick of a type this list does not offer, or whose id is no id (a link
 * edited by hand), names nothing and is left out: under "is", picks that
 * all name nothing match nothing (NO_RESOURCE_ID), as a pick of a deleted
 * resource does; under "is not" they keep every record. Picks past the
 * most one filter names are left out, as the owner chip leaves them.
 */
export const buildAffectedResourcesLinkedTo: (data: {
  values: Array<string>;
  operator: FilterOperator;
  includedTypes: Array<AffectedResourceType>;
  monitorField: "monitors" | "monitorId";
}) => LinkedTo | null = (data: {
  values: Array<string>;
  operator: FilterOperator;
  includedTypes: Array<AffectedResourceType>;
  monitorField: "monitors" | "monitorId";
}): LinkedTo | null => {
  if (data.operator !== "is" && data.operator !== "is_not") {
    return null;
  }

  if (!data.values || data.values.length === 0) {
    return null;
  }

  const relations: Record<string, Array<string>> = {};
  const seen: Set<string> = new Set<string>();

  for (const key of data.values) {
    if (seen.size >= MAX_LINKED_TO_IDS) {
      break;
    }

    const parsed: { type: AffectedResourceType; id: string } | null =
      parseKey(key);

    if (
      !parsed ||
      !data.includedTypes.includes(parsed.type) ||
      !ObjectID.isValidUUID(parsed.id)
    ) {
      continue;
    }

    const relation: string = getRelationOf(parsed.type, data.monitorField);
    const id: string = parsed.id.toLowerCase();

    if (seen.has(`${relation}:${id}`)) {
      continue;
    }

    seen.add(`${relation}:${id}`);
    (relations[relation] = relations[relation] || []).push(id);
  }

  if (seen.size === 0) {
    const firstType: AffectedResourceType | undefined = data.includedTypes[0];

    if (data.operator === "is_not" || !firstType) {
      return null;
    }

    return new LinkedTo({
      match: LinkedToMatch.AnyOf,
      relations: {
        [getRelationOf(firstType, data.monitorField)]: [NO_RESOURCE_ID],
      },
    });
  }

  return new LinkedTo({
    match:
      data.operator === "is_not" ? LinkedToMatch.NoneOf : LinkedToMatch.AnyOf,
    relations: relations,
  });
};

export interface AffectedResourcesFacetOptions<T extends BaseModel> {
  /** The list's model (Incident, Alert, …), whose relations the chip filters. */
  parentModelType: { new (): T };
  /**
   * Field name on the parent model for the Monitor relation. Defaults to
   * "monitors" (M2M). Use "monitorId" for Alert, whose monitor relation is
   * single-valued (ManyToOne → use the FK column directly with Includes()).
   */
  monitorQueryField?: "monitors" | "monitorId" | undefined;
  /**
   * When true, omit the Monitor type from this facet. Used by tables that
   * expose a separate dedicated Monitor facet (e.g. Alerts) so monitors
   * don't appear twice in the filter bar.
   */
  excludeMonitor?: boolean | undefined;
  /**
   * Offer the Network Site type. Off by default because
   * ScheduledMaintenance is the only parent model with a `networkSites`
   * relation — offering it elsewhere would build a filter query against a
   * column that does not exist there.
   */
  includeNetworkSite?: boolean | undefined;
  /**
   * Offer the SLO type. Off by default because Incident and Alert are the
   * only parent models with a `serviceLevelObjectives` relation — offering it
   * on Scheduled Maintenance would filter on a column that does not exist.
   */
  includeServiceLevelObjective?: boolean | undefined;
  /**
   * Offer the Cloud Resource type. Off by default because Incident, Alert
   * and ScheduledMaintenance are the only parent models with a
   * `cloudResources` relation.
   */
  includeCloudResource?: boolean | undefined;
  /**
   * Offer the Network Device type. Off by default because Incident and
   * Alert are the only parent models with a `networkDevices` relation.
   */
  includeNetworkDevice?: boolean | undefined;
}

const buildAffectedResourcesFacet: <T extends BaseModel>(
  options: AffectedResourcesFacetOptions<T>,
) => ResourceFacet = <T extends BaseModel>(
  options: AffectedResourcesFacetOptions<T>,
): ResourceFacet => {
  const monitorField: "monitors" | "monitorId" =
    options.monitorQueryField || "monitors";

  const includedTypes: Array<AffectedResourceType> = RESOURCE_ORDER.filter(
    (t: AffectedResourceType): boolean => {
      if (t === "monitor") {
        return !options.excludeMonitor;
      }
      if (t === "networkSite") {
        return Boolean(options.includeNetworkSite);
      }
      if (t === "serviceLevelObjective") {
        return Boolean(options.includeServiceLevelObjective);
      }
      if (t === "cloudResource") {
        return Boolean(options.includeCloudResource);
      }
      if (t === "networkDevice") {
        return Boolean(options.includeNetworkDevice);
      }
      return true;
    },
  );

  return {
    key: "affectedResources",
    label: "Affected Resources",
    icon: IconProp.Cube,
    isMultiSelect: true,
    searchPlaceholder: "Search resources...",
    /*
     * No is_empty / is_not_empty — "no resources attached at all" isn't a
     * meaningful single-field query when 5 columns can hold a resource.
     */
    supportedOperators: ["is", "is_not"],

    loadOptions: async (
      projectId: ObjectID,
      searchTerm: string,
    ): Promise<Array<FilterChipDropdownOption>> => {
      // Fan out across the included types in parallel and group in the dropdown.
      const results: Array<Array<FilterChipDropdownOption>> = await Promise.all(
        includedTypes.map(
          async (
            type: AffectedResourceType,
          ): Promise<Array<FilterChipDropdownOption>> => {
            const config: ResourceTypeConfig = RESOURCE_TYPES[type];
            const items: Array<NamedResource> = await fetchNamedModels({
              modelType: config.modelType,
              projectId: projectId,
              searchTerm: searchTerm,
              limit: SEARCH_LIMIT_PER_TYPE,
            });
            return items.map(
              (item: NamedResource): FilterChipDropdownOption => {
                return {
                  value: encodeKey(type, item.id),
                  label: item.name,
                  icon: config.icon,
                  group: config.pluralLabel,
                  ...(item.isArchived ? { isArchived: true } : {}),
                };
              },
            );
          },
        ),
      );
      return results.flat();
    },

    /*
     * What a link or a saved view picked, read by its ids: each resource
     * found by its name (marked archived when it is), each one gone -
     * deleted, or out of the reader's reach - as "No longer available"
     * under its type, never as its key. A read that fails names nothing,
     * so the chip shows what it holds as it can rather than calling it gone.
     */
    resolveOptions: async (
      projectId: ObjectID,
      values: Array<string>,
    ): Promise<Array<FilterChipDropdownOption>> => {
      if (values.length === 0) {
        return [];
      }
      const grouped: { [type in AffectedResourceType]?: Array<string> } =
        groupSelectionsByType(values);

      const results: Array<Array<FilterChipDropdownOption>> = await Promise.all(
        includedTypes.map(
          async (
            type: AffectedResourceType,
          ): Promise<Array<FilterChipDropdownOption>> => {
            const ids: Array<string> = (grouped[type] || []).filter(
              (id: string): boolean => {
                return ObjectID.isValidUUID(id);
              },
            );
            if (ids.length === 0) {
              return [];
            }
            const config: ResourceTypeConfig = RESOURCE_TYPES[type];
            let found: Map<string, NamedResource>;

            try {
              found = await resolveNamedModelsByIds({
                modelType: config.modelType,
                projectId: projectId,
                ids: ids,
              });
            } catch {
              return [];
            }

            return ids.map((id: string): FilterChipDropdownOption => {
              const item: NamedResource | undefined = found.get(
                id.toLowerCase(),
              );

              return {
                value: encodeKey(type, id),
                label: item ? item.name : encodeKey(type, id),
                icon: config.icon,
                group: config.pluralLabel,
                ...(item ? {} : { isNotFound: true }),
                ...(item?.isArchived ? { isArchived: true } : {}),
              };
            });
          },
        ),
      );
      return results.flat();
    },

    toLinkedTo: (
      values: Array<string>,
      operator: FilterOperator,
    ): LinkedTo | null => {
      return buildAffectedResourcesLinkedTo({
        values: values,
        operator: operator,
        includedTypes: includedTypes,
        monitorField: monitorField,
      });
    },
  };
};

export default buildAffectedResourcesFacet;
