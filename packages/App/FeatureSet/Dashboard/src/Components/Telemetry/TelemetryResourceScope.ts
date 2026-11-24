import {
  SERVICE_COLOR_FIELD,
  readTelemetryScopeHeldOptions,
} from "./TelemetryServiceScope";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import Service from "Common/Models/DatabaseModels/Service";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import Includes from "Common/Types/BaseDatabase/Includes";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import {
  RESOURCE_FACET_CATALOG,
  ResourceFacetDefinition,
} from "Common/Types/Telemetry/ResourceFacetCatalog";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ENTITY_DROPDOWN_NOT_FOUND_LABEL } from "Common/UI/Components/EntityDropdown/EntityDropdownNotFound";
import { withSearchIn } from "Common/UI/Components/EntityDropdown/EntityDropdownQuery";
import { HeldValueOptions } from "Common/UI/Components/EntityDropdown/HeldValueOptions";
import { ARCHIVED_COLUMN } from "Common/Utils/ArchivableValues";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import RecordsById from "Common/UI/Utils/RecordsById";
import { useEffect, useState } from "react";

/*
 * WHAT A TELEMETRY PAGE IS SCOPED TO - SERVICES, HOSTS, CLUSTERS AND EVERY
 * OTHER RESOURCE THAT LOGS UNDER ITS OWN ID - SEARCHED ON THE SERVER AND
 * NAMED BY ITS IDS (#10921).
 *
 * Logs > Insights' "All services and hosts" offered the window's first 200
 * of each kind the logs facets listed, named from the project's first
 * 10,000 services by name: a service or a host past them could not be
 * found or picked, and one a link or a saved view scoped the page to read
 * as its bare id. Its picker is the shared EntityDropdown now, as the
 * Metrics and Traces Insights pickers are (TelemetryServiceScopePicker),
 * searching the server as it is typed in:
 *
 *   - one search over the services and every kind of resource the page
 *     offers (a host, a Kubernetes cluster, a RUM application ...), each
 *     kind by its name - and by its identifier, when it has one, as the
 *     explorers' sidebars search them - its archived records marked
 *     Archived (they keep sending telemetry), a fair share of the page for
 *     each kind that has matches, its kind named beside each record;
 *   - what a scope holds is read by its ids before the picker is drawn: a
 *     service (or another entity the logs name as their own - a RUM
 *     application - by its own table: TelemetryServiceScope), a resource of
 *     a kind by that kind's table, one gone as "No longer available", to
 *     keep or take out. The page still narrows by it, as it was saved.
 *
 * A scope's value is its kind's facet key and the record's id,
 * "<facetKey>:<id>" (Utils/LogsInsights encodeScopeSelection), so a host
 * and a service never share a value.
 */

// The facet a service (or an entity that logs under its own id) is under.
export const SERVICE_SCOPE_FACET_KEY: string = "primaryEntityId";

// How many records one search offers, of every kind together (EntityDropdown's page).
export const TELEMETRY_SCOPE_SEARCH_PAGE_SIZE: number = 50;

// The column of a search's record that names the kind it is of.
export const TELEMETRY_SCOPE_KIND_FIELD: string = "telemetryScopeKind";

export interface TelemetryScopeKind {
  facetKey: string;
  modelType: { new (): BaseModel };
  // In English, a key: drawn in the reader's words ("Host").
  label: string;
  /*
   * The column a record is also found and named by when it has no name - a
   * host's identifier - as the explorers' sidebars find it
   * (ResourceFacetResolver's listings). Null for a kind with none.
   */
  identifierField: string | null;
  // What a record of the kind must also be to be offered: a cloud environment.
  baseQuery?: Record<string, unknown> | undefined;
}

/*
 * Each resource kind's table, by its facet key: the tables the explorers'
 * sidebars list the kinds from (ResourceFacetResolver), with the same
 * identifiers.
 */
const RESOURCE_KIND_TABLES: Record<
  string,
  Omit<TelemetryScopeKind, "facetKey" | "label">
> = {
  hostId: { modelType: Host, identifierField: "hostIdentifier" },
  dockerHostId: { modelType: DockerHost, identifierField: "hostIdentifier" },
  podmanHostId: { modelType: PodmanHost, identifierField: "hostIdentifier" },
  kubernetesClusterId: {
    modelType: KubernetesCluster,
    identifierField: "clusterIdentifier",
  },
  dockerSwarmClusterId: {
    modelType: DockerSwarmCluster,
    identifierField: "swarmId",
  },
  proxmoxClusterId: { modelType: ProxmoxCluster, identifierField: null },
  openStackCloudId: { modelType: OpenStackCloud, identifierField: null },
  vmwareVCenterId: { modelType: VMwareVCenter, identifierField: null },
  cephClusterId: { modelType: CephCluster, identifierField: "fsid" },
  storageArrayId: { modelType: StorageArray, identifierField: "systemId" },
  serverlessFunctionId: {
    modelType: ServerlessFunction,
    identifierField: "functionIdentifier",
  },
  cloudResourceId: {
    modelType: CloudResource,
    identifierField: "resourceIdentifier",
    baseQuery: { cloudResourceKind: CloudResourceKind.Environment },
  },
  rumApplicationId: {
    modelType: RumApplication,
    identifierField: "appIdentifier",
  },
  iotFleetId: { modelType: IoTFleet, identifierField: null },
  databaseServerId: {
    modelType: DatabaseServer,
    identifierField: "databaseIdentifier",
  },
};

/*
 * Every kind a scope can hold, in the order a search lists them: services
 * first, then the resource kinds in the catalog's order (the order the
 * explorers' sidebars list them in).
 */
export const TELEMETRY_SCOPE_KINDS: Array<TelemetryScopeKind> = [
  {
    facetKey: SERVICE_SCOPE_FACET_KEY,
    modelType: Service,
    label: "Service",
    identifierField: null,
  },
  ...RESOURCE_FACET_CATALOG.filter(
    (definition: ResourceFacetDefinition): boolean => {
      return Boolean(RESOURCE_KIND_TABLES[definition.facetKey]);
    },
  ).map((definition: ResourceFacetDefinition): TelemetryScopeKind => {
    return {
      facetKey: definition.facetKey,
      label: definition.label,
      ...RESOURCE_KIND_TABLES[definition.facetKey]!,
    };
  }),
];

const KINDS_BY_FACET_KEY: Map<string, TelemetryScopeKind> = new Map<
  string,
  TelemetryScopeKind
>(
  TELEMETRY_SCOPE_KINDS.map(
    (kind: TelemetryScopeKind): [string, TelemetryScopeKind] => {
      return [kind.facetKey, kind];
    },
  ),
);

export const getTelemetryScopeKind: (
  facetKey: string,
) => TelemetryScopeKind | undefined = (
  facetKey: string,
): TelemetryScopeKind | undefined => {
  return KINDS_BY_FACET_KEY.get(facetKey);
};

// A scope's value: its kind's facet key, then the record's id.
export const encodeTelemetryScopeValue: (
  facetKey: string,
  id: string,
) => string = (facetKey: string, id: string): string => {
  return `${facetKey}:${id}`;
};

/*
 * A scope's value split at its FIRST colon: its facet key and its id. A
 * value with no facet key has none ("").
 */
export const decodeTelemetryScopeValue: (value: string) => {
  facetKey: string;
  id: string;
} = (value: string): { facetKey: string; id: string } => {
  const separator: number = value.indexOf(":");

  if (separator <= 0) {
    return { facetKey: "", id: value };
  }

  return {
    facetKey: value.substring(0, separator),
    id: value.substring(separator + 1),
  };
};

// The key a scope's value is known by: the whole value, lower-cased.
export const toTelemetryScopeKey: (value: string) => string = (
  value: string,
): string => {
  return value.trim().toLowerCase();
};

/*
 * The kinds a page searches, in TELEMETRY_SCOPE_KINDS' order: services
 * always, then the resource kinds asked for and the kinds the scope holds,
 * each once. A facet key that names no kind is left out.
 */
export const getTelemetryScopeSearchKinds: (data: {
  resourceFacetKeys: Array<string>;
  values: Array<string>;
}) => Array<string> = (data: {
  resourceFacetKeys: Array<string>;
  values: Array<string>;
}): Array<string> => {
  const wanted: Set<string> = new Set<string>([
    SERVICE_SCOPE_FACET_KEY,
    ...data.resourceFacetKeys,
    ...data.values.map((value: string): string => {
      return decodeTelemetryScopeValue(value).facetKey;
    }),
  ]);

  return TELEMETRY_SCOPE_KINDS.filter((kind: TelemetryScopeKind): boolean => {
    return wanted.has(kind.facetKey);
  }).map((kind: TelemetryScopeKind): string => {
    return kind.facetKey;
  });
};

/*
 * Whether a kind's records are read with their archive switch: when the
 * reader may read it - the server refuses a whole read that selects a
 * column it may not read.
 */
const readsArchiveSwitch: (kind: TelemetryScopeKind) => boolean = (
  kind: TelemetryScopeKind,
): boolean => {
  try {
    const model: BaseModel = new kind.modelType();

    return (
      model.hasColumn(ARCHIVED_COLUMN) &&
      PermissionGate.canReadColumn(model, ARCHIVED_COLUMN)
    );
  } catch {
    return false;
  }
};

// What a record of a kind is read with: its name, identifier and switch.
export const getTelemetryScopeKindSelect: (
  kind: TelemetryScopeKind,
) => Record<string, true> = (
  kind: TelemetryScopeKind,
): Record<string, true> => {
  return {
    _id: true,
    name: true,
    ...(kind.identifierField ? { [kind.identifierField]: true } : {}),
    ...(kind.modelType === Service ? { [SERVICE_COLOR_FIELD]: true } : {}),
    ...(readsArchiveSwitch(kind) ? { [ARCHIVED_COLUMN]: true } : {}),
  };
};

// A record's name: its name, else its identifier, else its id.
const getRecordName: (record: BaseModel, kind: TelemetryScopeKind) => string = (
  record: BaseModel,
  kind: TelemetryScopeKind,
): string => {
  const raw: Record<string, unknown> = record as unknown as Record<
    string,
    unknown
  >;
  const name: string = raw["name"] ? String(raw["name"]).trim() : "";

  if (name) {
    return name;
  }

  const identifier: string =
    kind.identifierField && raw[kind.identifierField]
      ? String(raw[kind.identifierField]).trim()
      : "";

  return identifier || record._id?.toString() || "";
};

/*
 * A record of a kind as the picker reads one (EntityDropdown's records are
 * models): a Service-shaped record whose id is its scope value, its name,
 * colour and archive switch, and its kind (TELEMETRY_SCOPE_KIND_FIELD).
 */
export const toTelemetryScopeRecord: (
  record: BaseModel,
  kind: TelemetryScopeKind,
) => Service = (record: BaseModel, kind: TelemetryScopeKind): Service => {
  const raw: Record<string, unknown> = record as unknown as Record<
    string,
    unknown
  >;
  const scoped: Service = new Service();
  const target: Record<string, unknown> = scoped as unknown as Record<
    string,
    unknown
  >;

  scoped._id = encodeTelemetryScopeValue(
    kind.facetKey,
    record._id?.toString() || "",
  );
  scoped.name = getRecordName(record, kind);

  if (raw[SERVICE_COLOR_FIELD]) {
    target[SERVICE_COLOR_FIELD] = raw[SERVICE_COLOR_FIELD];
  }

  if (raw[ARCHIVED_COLUMN] === true) {
    target[ARCHIVED_COLUMN] = true;
  }

  target[TELEMETRY_SCOPE_KIND_FIELD] = kind.facetKey;

  return scoped;
};

/*
 * A fair share of one page for each kind that found something: one of each
 * in turn until the page is full, so a project with thousands of services
 * still shows the hosts a search found, each kind kept in its order.
 */
export const takeFairShares: <T>(
  found: Array<Array<T>>,
  pageSize: number,
) => Array<Array<T>> = <T>(
  found: Array<Array<T>>,
  pageSize: number,
): Array<Array<T>> => {
  const taken: Array<number> = found.map((): number => {
    return 0;
  });
  let total: number = 0;
  let isTaking: boolean = true;

  while (total < pageSize && isTaking) {
    isTaking = false;

    for (let index: number = 0; index < found.length; index++) {
      if (total >= pageSize) {
        break;
      }

      if (taken[index]! < found[index]!.length) {
        taken[index] = taken[index]! + 1;
        total++;
        isTaking = true;
      }
    }
  }

  return found.map((list: Array<T>, index: number): Array<T> => {
    return list.slice(0, taken[index]);
  });
};

// The text a picker's query searches for, as typed: "" for none.
const readSearchText: (query: Record<string, unknown>) => string = (
  query: Record<string, unknown>,
): string => {
  for (const value of Object.values(query)) {
    if (value instanceof Search || value instanceof MultiSearch) {
      return String(value.value || "").trim();
    }
  }

  return "";
};

// The values a picker reads what it holds by: null when it is not that read.
const readHeldValues: (
  query: Record<string, unknown>,
) => Array<string> | null = (
  query: Record<string, unknown>,
): Array<string> | null => {
  const value: unknown = query["_id"];

  if (!(value instanceof Includes)) {
    return null;
  }

  return value.values
    .map((entry: unknown): string => {
      return String(entry);
    })
    .filter((entry: string): boolean => {
      return Boolean(entry);
    });
};

/*
 * One search over the kinds asked for, each by its name (and identifier),
 * a page of each, then a fair share of one page for each kind that found
 * something, in the kinds' order. A kind the reader may not read finds
 * nothing; the other kinds' records are still offered.
 */
export const searchTelemetryScope: (data: {
  kinds: Array<string>;
  searchText: string;
}) => Promise<{ records: Array<Service>; count: number }> = async (data: {
  kinds: Array<string>;
  searchText: string;
}): Promise<{ records: Array<Service>; count: number }> => {
  const kinds: Array<TelemetryScopeKind> = data.kinds
    .map((facetKey: string): TelemetryScopeKind | undefined => {
      return getTelemetryScopeKind(facetKey);
    })
    .filter(
      (kind: TelemetryScopeKind | undefined): kind is TelemetryScopeKind => {
        return Boolean(kind);
      },
    );

  const found: Array<{ records: Array<Service>; count: number }> =
    await Promise.all(
      kinds.map(
        async (
          kind: TelemetryScopeKind,
        ): Promise<{ records: Array<Service>; count: number }> => {
          try {
            const result: ListResult<BaseModel> =
              await ModelAPI.getList<BaseModel>({
                modelType: kind.modelType,
                query: withSearchIn(
                  { ...(kind.baseQuery || {}) },
                  kind.identifierField
                    ? ["name", kind.identifierField]
                    : ["name"],
                  data.searchText,
                ) as never,
                select: getTelemetryScopeKindSelect(kind) as never,
                sort: { name: SortOrder.Ascending } as never,
                limit: TELEMETRY_SCOPE_SEARCH_PAGE_SIZE,
                skip: 0,
              });

            return {
              records: result.data.map((record: BaseModel): Service => {
                return toTelemetryScopeRecord(record, kind);
              }),
              count: Math.max(result.count || 0, result.data.length),
            };
          } catch {
            return { records: [], count: 0 };
          }
        },
      ),
    );

  const shares: Array<Array<Service>> = takeFairShares(
    found.map((entry: { records: Array<Service>; count: number }) => {
      return entry.records;
    }),
    TELEMETRY_SCOPE_SEARCH_PAGE_SIZE,
  );

  return {
    records: shares.flat(),
    count: found.reduce(
      (sum: number, entry: { records: Array<Service>; count: number }) => {
        return sum + entry.count;
      },
      0,
    ),
  };
};

// A held value no record answers to any more.
const toNotFoundOption: (value: string) => DropdownOption = (
  value: string,
): DropdownOption => {
  return {
    value: value,
    label: ENTITY_DROPDOWN_NOT_FOUND_LABEL,
    isUserContent: false,
    isNotFound: true,
  };
};

/*
 * Each held value, named: by its lower-cased value (toTelemetryScopeKey).
 * Every value asked for is answered - by a name, or as not found.
 *
 *   - A service's: by TelemetryServiceScope, as the Metrics and Traces
 *     Insights scopes name theirs - the project's own id is "Unknown
 *     Service", another entity the logs name as their own (a RUM
 *     application) is named from its own table.
 *   - A resource kind's: read by its ids from its kind's table (RecordsById,
 *     in pages), with its archive switch.
 *   - A value of no kind: not found.
 */
export const readTelemetryResourceScopeHeldOptions: (data: {
  values: Array<string>;
  projectId: string;
}) => Promise<Map<string, DropdownOption>> = async (data: {
  values: Array<string>;
  projectId: string;
}): Promise<Map<string, DropdownOption>> => {
  const named: Map<string, DropdownOption> = new Map<string, DropdownOption>();
  const valuesByKind: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();

  for (const value of data.values) {
    const key: string = toTelemetryScopeKey(value);

    if (!key || named.has(key)) {
      continue;
    }

    const { facetKey }: { facetKey: string } = decodeTelemetryScopeValue(
      value.trim(),
    );

    if (!getTelemetryScopeKind(facetKey)) {
      named.set(key, toNotFoundOption(value.trim()));
      continue;
    }

    valuesByKind.set(facetKey, [
      ...(valuesByKind.get(facetKey) || []),
      value.trim(),
    ]);
  }

  await Promise.all(
    Array.from(valuesByKind.entries()).map(
      async ([facetKey, values]: [string, Array<string>]): Promise<void> => {
        const kind: TelemetryScopeKind = getTelemetryScopeKind(facetKey)!;
        const idOf: (value: string) => string = (value: string): string => {
          return decodeTelemetryScopeValue(value).id.trim().toLowerCase();
        };

        if (facetKey === SERVICE_SCOPE_FACET_KEY) {
          const services: Map<string, DropdownOption> =
            await readTelemetryScopeHeldOptions({
              ids: values.map(idOf),
              projectId: data.projectId,
            });

          for (const value of values) {
            const option: DropdownOption | undefined = services.get(
              idOf(value),
            );

            named.set(
              toTelemetryScopeKey(value),
              option ? { ...option, value: value } : toNotFoundOption(value),
            );
          }

          return;
        }

        const records: Array<BaseModel> = await RecordsById.read<BaseModel>({
          modelType: kind.modelType,
          ids: values.map(idOf),
          select: getTelemetryScopeKindSelect(kind) as never,
        });
        const byId: Map<string, BaseModel> = RecordsById.byValue<BaseModel>({
          records: records,
        });

        for (const value of values) {
          const record: BaseModel | undefined = byId.get(idOf(value));

          if (!record) {
            named.set(toTelemetryScopeKey(value), toNotFoundOption(value));
            continue;
          }

          const option: DropdownOption = {
            value: value,
            label: getRecordName(record, kind),
            // What its owner named it, drawn as written.
            isUserContent: true,
          };

          if (
            (record as unknown as Record<string, unknown>)[ARCHIVED_COLUMN] ===
            true
          ) {
            option.isArchived = true;
          }

          named.set(toTelemetryScopeKey(value), option);
        }
      },
    ),
  );

  return named;
};

/*
 * The picker's reads, answered over every kind it searches (searchKinds):
 * a search (the picker's query, with the text it typed) is one search of
 * each kind (searchTelemetryScope); a read of what it holds (`_id` in a
 * list of scope values) is readTelemetryResourceScopeHeldOptions' read of
 * each kind, as records - one not found is left out, and the picker says
 * it is not found. EntityDropdown is handed Service as its model, so any
 * other model is read as ModelAPI reads it.
 */
export const readTelemetryScopeChoices: (
  data: Parameters<typeof ModelAPI.getList<BaseModel>>[0],
  searchKinds: Array<string>,
) => Promise<ListResult<BaseModel>> = async (
  data: Parameters<typeof ModelAPI.getList<BaseModel>>[0],
  searchKinds: Array<string>,
): Promise<ListResult<BaseModel>> => {
  if ((data.modelType as unknown) !== Service) {
    return await ModelAPI.getList<BaseModel>(data);
  }

  const query: Record<string, unknown> = (data.query || {}) as Record<
    string,
    unknown
  >;
  const heldValues: Array<string> | null = readHeldValues(query);

  if (heldValues) {
    const named: Map<string, DropdownOption> =
      await readTelemetryResourceScopeHeldOptions({
        values: heldValues,
        projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
      });
    const records: Array<BaseModel> = [];

    for (const value of heldValues) {
      const option: DropdownOption | undefined = named.get(
        toTelemetryScopeKey(value),
      );

      if (!option || option.isNotFound) {
        continue;
      }

      const record: Service = new Service();
      const target: Record<string, unknown> = record as unknown as Record<
        string,
        unknown
      >;

      record._id = value;
      record.name = option.label;
      target[TELEMETRY_SCOPE_KIND_FIELD] =
        decodeTelemetryScopeValue(value).facetKey;

      if (option.isArchived) {
        target[ARCHIVED_COLUMN] = true;
      }

      if (option.color) {
        target[SERVICE_COLOR_FIELD] = option.color;
      }

      records.push(record);
    }

    return {
      data: records,
      count: records.length,
      skip: 0,
      limit: data.limit,
    };
  }

  const found: { records: Array<Service>; count: number } =
    await searchTelemetryScope({
      kinds: searchKinds,
      searchText: readSearchText(query),
    });

  return {
    data: found.records,
    count: found.count,
    skip: 0,
    limit: data.limit,
  };
};

/*
 * The API a scope picker hands EntityDropdown for the kinds it searches:
 * its list reads answered by readTelemetryScopeChoices, anything else as
 * the shared ModelAPI answers it - looked up when it is asked for, never
 * copied, so a test that stands in for ModelAPI is the one used.
 */
export const createTelemetryScopeChoicesAPI: (
  searchKinds: Array<string>,
) => typeof ModelAPI = (searchKinds: Array<string>): typeof ModelAPI => {
  return new Proxy({} as typeof ModelAPI, {
    get: (_target: typeof ModelAPI, property: string | symbol): unknown => {
      if (property === "getList") {
        return (
          data: Parameters<typeof ModelAPI.getList<BaseModel>>[0],
        ): Promise<ListResult<BaseModel>> => {
          return readTelemetryScopeChoices(data, searchKinds);
        };
      }

      return (ModelAPI as unknown as Record<string | symbol, unknown>)[
        property
      ];
    },
  });
};

/*
 * What a scope holds, named before its picker is drawn (the page draws a
 * placeholder until then), the way TelemetryServiceScope names a services
 * scope: read by its values once, and a pick named by the search that
 * offered it (remember), never read again.
 */
export const useTelemetryResourceScopeHeldOptions: (
  values: Array<string>,
) => HeldValueOptions = (values: Array<string>): HeldValueOptions => {
  const [options, setOptions] = useState<Map<string, DropdownOption> | null>(
    null,
  );
  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";

  const valuesKey: string = values.map(toTelemetryScopeKey).join("|");

  useEffect(() => {
    let isCurrent: boolean = true;
    const toRead: Array<string> = values.filter((value: string): boolean => {
      return !options?.has(toTelemetryScopeKey(value));
    });

    if (toRead.length === 0) {
      if (!options) {
        setOptions(new Map());
      }

      return;
    }

    // What the read names joins what is known, a pick named meanwhile kept.
    const keep: (named: Map<string, DropdownOption>) => void = (
      named: Map<string, DropdownOption>,
    ): void => {
      if (!isCurrent) {
        return;
      }

      setOptions(
        (
          current: Map<string, DropdownOption> | null,
        ): Map<string, DropdownOption> => {
          const next: Map<string, DropdownOption> = new Map(current || []);

          for (const [key, option] of named) {
            if (!next.has(key)) {
              next.set(key, option);
            }
          }

          return next;
        },
      );
    };

    readTelemetryResourceScopeHeldOptions({
      values: toRead,
      projectId: projectId,
    })
      .then(keep)
      .catch((): void => {
        /*
         * Naming them is the picker's to do then: it reads a held value by
         * its id itself, and its search must not fail with this read.
         */
        keep(new Map());
      });

    return () => {
      isCurrent = false;
    };
  }, [valuesKey, projectId]);

  return {
    options: options,
    remember: (picked: Array<DropdownOption>): void => {
      setOptions(
        (
          current: Map<string, DropdownOption> | null,
        ): Map<string, DropdownOption> => {
          const next: Map<string, DropdownOption> = new Map(current || []);

          for (const option of picked) {
            const key: string = toTelemetryScopeKey(String(option.value));

            if (!next.has(key)) {
              next.set(key, { ...option });
            }
          }

          return next;
        },
      );
    },
  };
};
