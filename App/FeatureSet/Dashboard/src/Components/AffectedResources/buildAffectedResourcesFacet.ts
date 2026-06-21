import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Service from "Common/Models/DatabaseModels/Service";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { FilterChipDropdownOption } from "../ResourceOwners/FilterChipDropdown";
import { ResourceFacet } from "../ResourceOwners/useResourceOwners";

/*
 * Builds a unified "Affected Resources" facet that lets the user search and
 * filter Incidents / Alerts / Scheduled Maintenance by *any* attached
 * resource type — Monitor, Service, Host, Kubernetes Cluster, Docker Host.
 *
 * The chip's value encoding is `${type}:${id}` so multiple resource types
 * can coexist in the same selection without ID collisions. The hook's
 * `computeMatchingResourceIds` resolver groups selections by type, queries
 * the parent model with the appropriate Includes() per field, and returns
 * the union of matching parent IDs.
 *
 * Keep this in sync with AffectedResourcesPicker / AffectedResourcesCell:
 * adding a resource type means updating all three so picker, filter, and
 * row display stay aligned.
 */

type AffectedResourceType =
  | "monitor"
  | "service"
  | "host"
  | "kubernetesCluster"
  | "dockerHost"
  | "podmanHost";

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
};

const RESOURCE_ORDER: Array<AffectedResourceType> = [
  "monitor",
  "service",
  "host",
  "kubernetesCluster",
  "dockerHost",
  "podmanHost",
];

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
    type !== "service" &&
    type !== "host" &&
    type !== "kubernetesCluster" &&
    type !== "dockerHost" &&
    type !== "podmanHost"
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

const fetchNamedModels: <T extends BaseModel>(args: {
  modelType: { new (): T };
  projectId: ObjectID;
  searchTerm: string;
  limit: number;
}) => Promise<Array<{ id: string; name: string }>> = async <
  T extends BaseModel,
>({
  modelType,
  projectId,
  searchTerm,
  limit,
}: {
  modelType: { new (): T };
  projectId: ObjectID;
  searchTerm: string;
  limit: number;
}): Promise<Array<{ id: string; name: string }>> => {
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
      select: { _id: true, name: true } as Record<string, true>,
      sort: { name: SortOrder.Ascending } as Record<string, SortOrder>,
    });
    return result.data
      .map((m: T) => {
        const named: NamedModel = m as unknown as NamedModel;
        const id: string | undefined = m.id?.toString();
        const name: string | undefined = named.name?.toString();
        if (!id) {
          return null;
        }
        return { id: id, name: name || `Unnamed` };
      })
      .filter(
        (
          v: { id: string; name: string } | null,
        ): v is { id: string; name: string } => {
          return v !== null;
        },
      );
  } catch {
    return [];
  }
};

const resolveNamedModelsByIds: <T extends BaseModel>(args: {
  modelType: { new (): T };
  projectId: ObjectID;
  ids: Array<string>;
}) => Promise<Array<{ id: string; name: string }>> = async <
  T extends BaseModel,
>({
  modelType,
  projectId,
  ids,
}: {
  modelType: { new (): T };
  projectId: ObjectID;
  ids: Array<string>;
}): Promise<Array<{ id: string; name: string }>> => {
  if (ids.length === 0) {
    return [];
  }
  try {
    const result: ListResult<T> = await ModelAPI.getList<T>({
      modelType: modelType,
      query: {
        projectId: projectId,
        _id: new Includes(ids),
      } as Query<T>,
      limit: ids.length,
      skip: 0,
      select: { _id: true, name: true } as Record<string, true>,
      sort: {},
    });
    return result.data
      .map((m: T) => {
        const named: NamedModel = m as unknown as NamedModel;
        const id: string | undefined = m.id?.toString();
        const name: string | undefined = named.name?.toString();
        if (!id) {
          return null;
        }
        return { id: id, name: name || `Unnamed` };
      })
      .filter(
        (
          v: { id: string; name: string } | null,
        ): v is { id: string; name: string } => {
          return v !== null;
        },
      );
  } catch {
    return [];
  }
};

export interface AffectedResourcesFacetOptions<T extends BaseModel> {
  /** Parent model class to query for matching IDs (Incident, Alert, …). */
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
}

const buildAffectedResourcesFacet: <T extends BaseModel>(
  options: AffectedResourcesFacetOptions<T>,
) => ResourceFacet = <T extends BaseModel>(
  options: AffectedResourcesFacetOptions<T>,
): ResourceFacet => {
  const monitorField: "monitors" | "monitorId" =
    options.monitorQueryField || "monitors";

  const includedTypes: Array<AffectedResourceType> = options.excludeMonitor
    ? RESOURCE_ORDER.filter((t: AffectedResourceType): boolean => {
        return t !== "monitor";
      })
    : RESOURCE_ORDER;

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
            const items: Array<{ id: string; name: string }> =
              await fetchNamedModels({
                modelType: config.modelType,
                projectId: projectId,
                searchTerm: searchTerm,
                limit: SEARCH_LIMIT_PER_TYPE,
              });
            return items.map(
              (item: {
                id: string;
                name: string;
              }): FilterChipDropdownOption => {
                return {
                  value: encodeKey(type, item.id),
                  label: item.name,
                  icon: config.icon,
                  group: config.pluralLabel,
                };
              },
            );
          },
        ),
      );
      return results.flat();
    },

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
            const ids: Array<string> | undefined = grouped[type];
            if (!ids || ids.length === 0) {
              return [];
            }
            const config: ResourceTypeConfig = RESOURCE_TYPES[type];
            const items: Array<{ id: string; name: string }> =
              await resolveNamedModelsByIds({
                modelType: config.modelType,
                projectId: projectId,
                ids: ids,
              });
            return items.map(
              (item: {
                id: string;
                name: string;
              }): FilterChipDropdownOption => {
                return {
                  value: encodeKey(type, item.id),
                  label: item.name,
                  icon: config.icon,
                  group: config.pluralLabel,
                };
              },
            );
          },
        ),
      );
      return results.flat();
    },

    computeMatchingResourceIds: async (
      projectId: ObjectID,
      values: Array<string>,
    ): Promise<Array<string>> => {
      if (values.length === 0) {
        return [];
      }
      const grouped: { [type in AffectedResourceType]?: Array<string> } =
        groupSelectionsByType(values);

      /*
       * One query per resource type, each fetching parent IDs with that
       * type's relation Includes(...). Sequential would be 5x slower; the
       * parallel fan-out is the main reason this lives in a helper.
       */
      const queries: Array<Promise<Array<string>>> = [];

      for (const type of includedTypes) {
        const ids: Array<string> | undefined = grouped[type];
        if (!ids || ids.length === 0) {
          continue;
        }

        /*
         * Map resource type → parent field name. Alert.monitorId is the
         * only M2O — every other relation is a true M2M.
         */
        let field: string;
        if (type === "monitor") {
          field = monitorField;
        } else if (type === "service") {
          field = "services";
        } else if (type === "host") {
          field = "hosts";
        } else if (type === "kubernetesCluster") {
          field = "kubernetesClusters";
        } else if (type === "dockerHost") {
          field = "dockerHosts";
        } else {
          field = "podmanHosts";
        }

        const objectIds: Array<ObjectID> = ids.map((id: string) => {
          return new ObjectID(id);
        });

        const q: Query<T> = {
          projectId: projectId,
          [field]: new Includes(objectIds),
        } as unknown as Query<T>;

        queries.push(
          ModelAPI.getList<T>({
            modelType: options.parentModelType,
            query: q,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { _id: true } as Record<string, true>,
            sort: {},
          })
            .then((result: ListResult<T>): Array<string> => {
              return result.data
                .map((row: T): string | undefined => {
                  return row.id?.toString();
                })
                .filter((id: string | undefined): id is string => {
                  return Boolean(id);
                });
            })
            .catch((): Array<string> => {
              return [];
            }),
        );
      }

      const perTypeResults: Array<Array<string>> = await Promise.all(queries);
      const union: Set<string> = new Set();
      for (const list of perTypeResults) {
        for (const id of list) {
          union.add(id);
        }
      }
      return Array.from(union);
    },
  };
};

export default buildAffectedResourcesFacet;
