import Log from "../../../Models/AnalyticsModels/Log";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import Service from "../../../Models/DatabaseModels/Service";
import Dictionary from "../../../Types/Dictionary";
import {
  isResourceEntityFacetKey,
  isResourceFacetKey,
  isServiceFacetKey,
} from "../../../Types/Telemetry/ResourceEntityFacet";
import {
  getResourceFacetLabelMap,
  getResourceFacetServiceTypeMap,
} from "../../../Types/Telemetry/ResourceFacetCatalog";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  DEFAULT_TELEMETRY_ENTITY_LABEL,
  getTelemetryEntityDisplay,
  ResolvedTelemetryEntity,
  TELEMETRY_ENTITY_TYPES,
  TelemetryEntityNameMap,
} from "../../Utils/Telemetry/TelemetryEntityNames";
import { ActiveFilter, FacetData, FacetValue } from "./types";

/*
 * Display-only name resolution for the shared logs viewer.
 *
 * A log's `primaryEntityId` is polymorphic — a Service id for most rows, but
 * a RumApplication id for browser logs, a Host id for agent-ingested host
 * logs, and so on. The viewer only preloads Services / Hosts / Docker hosts /
 * Podman hosts / Kubernetes clusters, so anything else (a RUM application, a
 * serverless function, …) used to render as a raw UUID in the chips, the
 * Service column, the details header and the analytics legend.
 *
 * These helpers decide which ids still need the generic resolver
 * (TelemetryEntityNameResolver) and how its answer is folded into what the
 * user sees. They are pure so the precedence rules can be pinned without
 * rendering the viewer. Queries, URL state and saved views keep the ids.
 */

// The preloaded non-Service resource maps.
export interface LogsResourceEntityMaps {
  hostMap?: Dictionary<Host> | undefined;
  dockerHostMap?: Dictionary<DockerHost> | undefined;
  podmanHostMap?: Dictionary<PodmanHost> | undefined;
  kubernetesClusterMap?: Dictionary<KubernetesCluster> | undefined;
}

export interface LogsEntityLookupMaps extends LogsResourceEntityMaps {
  serviceMap: Dictionary<Service>;
}

export interface LogsEntityResolutionRequest {
  // Sorted, de-duplicated ids that still need the generic resolver.
  ids: Array<string>;
  // id -> table, for ids whose table the viewer already knows.
  typeHints: Record<string, ServiceType>;
}

/*
 * Non-Service resource facets name one specific table, so their ids can
 * skip the Service-first probe and go straight to it. Every catalog resource
 * type is listed — not only the four the viewer preloads — so a Proxmox
 * cluster or IoT fleet facet value / chip is still sent to its own table.
 * Catalog order is kept: findLoadedLogsResourceEntity probes the preloaded
 * maps in this order.
 */
export const LOGS_RESOURCE_FACET_ENTITY_TYPES: Record<string, ServiceType> =
  Object.fromEntries(getResourceFacetServiceTypeMap());

/*
 * Telemetry entity ids are Postgres UUIDs. A chip value that is not one (a
 * service name typed into the search bar that did not match a loaded
 * Service) would only make every entity table answer "not found", so it is
 * never sent to the resolver.
 */
const ENTITY_ID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isLogsEntityIdValue: (value: unknown) => value is string = (
  value: unknown,
): value is string => {
  return typeof value === "string" && ENTITY_ID_PATTERN.test(value.trim());
};

const nonEmpty: (value: string | null | undefined) => string | undefined = (
  value: string | null | undefined,
): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text: string = `${value}`.trim();
  return text.length > 0 ? text : undefined;
};

/*
 * The name the viewer's preloaded maps already know for a resource facet
 * value, or undefined. These win over the generic resolver: they are loaded
 * anyway and carry extras (a Service's colour) the resolver does not.
 */
export const getLoadedLogsEntityName: (
  facetKey: string,
  id: string,
  maps: LogsEntityLookupMaps,
) => string | undefined = (
  facetKey: string,
  id: string,
  maps: LogsEntityLookupMaps,
): string | undefined => {
  if (isServiceFacetKey(facetKey)) {
    return nonEmpty(maps.serviceMap[id]?.name);
  }
  if (facetKey === "hostId") {
    const host: Host | undefined = maps.hostMap?.[id];
    return nonEmpty(host?.name) || nonEmpty(host?.hostIdentifier);
  }
  if (facetKey === "dockerHostId") {
    const dockerHost: DockerHost | undefined = maps.dockerHostMap?.[id];
    return nonEmpty(dockerHost?.name) || nonEmpty(dockerHost?.hostIdentifier);
  }
  if (facetKey === "podmanHostId") {
    const podmanHost: PodmanHost | undefined = maps.podmanHostMap?.[id];
    return nonEmpty(podmanHost?.name) || nonEmpty(podmanHost?.hostIdentifier);
  }
  if (facetKey === "kubernetesClusterId") {
    const cluster: KubernetesCluster | undefined =
      maps.kubernetesClusterMap?.[id];
    return nonEmpty(cluster?.name) || nonEmpty(cluster?.clusterIdentifier);
  }
  return undefined;
};

export interface LoadedLogsResourceEntity {
  name: string;
  entityType: ServiceType;
  // e.g. "Host", "Kubernetes Cluster".
  typeLabel: string;
}

/*
 * A primaryEntityId is polymorphic: agent-ingested host / container /
 * cluster telemetry carries the Host / DockerHost / PodmanHost /
 * KubernetesCluster id. Production log rows are not guaranteed to carry
 * primaryEntityType, so the only way to tell such an id apart from a
 * Service id without a network round trip is to look it up in the
 * non-Service maps the viewer has already preloaded. Returns the name
 * (name, else the machine identifier) and the table it was found in.
 */
export const findLoadedLogsResourceEntity: (
  id: string,
  maps: LogsResourceEntityMaps | undefined,
) => LoadedLogsResourceEntity | undefined = (
  id: string,
  maps: LogsResourceEntityMaps | undefined,
): LoadedLogsResourceEntity | undefined => {
  if (!id || !maps) {
    return undefined;
  }

  for (const [facetKey, entityType] of Object.entries(
    LOGS_RESOURCE_FACET_ENTITY_TYPES,
  )) {
    const name: string | undefined = getLoadedLogsEntityName(facetKey, id, {
      ...maps,
      serviceMap: {},
    });
    if (name) {
      return {
        name,
        entityType,
        typeLabel: TELEMETRY_ENTITY_TYPES[entityType].label,
      };
    }
  }

  return undefined;
};

/*
 * A parent (the Dashboard logs explorer) may hand chips over already named
 * — e.g. "RUM Application: checkout-web". Its displayValue then differs from
 * the id and must not be overwritten with anything less specific.
 */
const hasParentResolvedDisplay: (filter: ActiveFilter) => boolean = (
  filter: ActiveFilter,
): boolean => {
  return (
    typeof filter.displayValue === "string" &&
    filter.displayValue.length > 0 &&
    filter.displayValue !== filter.value
  );
};

/*
 * Name one chip. Precedence for primaryEntityId / serviceId / hostId / … :
 *   1. the preloaded map (existing behaviour, keeps the key as given);
 *   2. a name the parent already supplied (left untouched);
 *   3. for Service-keyed chips, a preloaded host / cluster with that id —
 *      the key becomes its type ("Host");
 *   4. the generic resolver — for Service-keyed chips the key becomes the
 *      entity's type ("RUM Application"), for the typed resource facets the
 *      key ("Host") is already right and only the value changes;
 *   5. otherwise the chip is returned as it came in.
 * Non-resource chips are never touched.
 */
export const enrichLogsActiveFilter: (
  filter: ActiveFilter,
  maps: LogsEntityLookupMaps,
  entityNameMap: TelemetryEntityNameMap | undefined,
) => ActiveFilter = (
  filter: ActiveFilter,
  maps: LogsEntityLookupMaps,
  entityNameMap: TelemetryEntityNameMap | undefined,
): ActiveFilter => {
  if (
    !isResourceFacetKey(filter.facetKey) ||
    typeof filter.value !== "string"
  ) {
    return filter;
  }

  const loadedName: string | undefined = getLoadedLogsEntityName(
    filter.facetKey,
    filter.value,
    maps,
  );
  if (loadedName) {
    return { ...filter, displayValue: loadedName };
  }

  if (hasParentResolvedDisplay(filter)) {
    return filter;
  }

  /*
   * A Service-keyed chip whose id is a preloaded host / cluster is named
   * from that map, keyed by its type like a resolver answer would be. The
   * id is then never sent to the resolver (collectLogsEntityIdsToResolve
   * skips it), so this is the only place it gets named.
   */
  if (isServiceFacetKey(filter.facetKey)) {
    const loadedResource: LoadedLogsResourceEntity | undefined =
      findLoadedLogsResourceEntity(filter.value, maps);
    if (loadedResource) {
      return {
        ...filter,
        displayKey: loadedResource.typeLabel,
        displayValue: loadedResource.name,
      };
    }
  }

  const resolved: ResolvedTelemetryEntity | undefined =
    entityNameMap?.[filter.value];
  if (!resolved) {
    return filter;
  }

  if (isServiceFacetKey(filter.facetKey)) {
    const display: { key: string; value: string } = getTelemetryEntityDisplay({
      id: filter.value,
      nameMap: entityNameMap,
      fallbackKey: filter.displayKey,
    });
    return { ...filter, displayKey: display.key, displayValue: display.value };
  }

  return { ...filter, displayValue: resolved.name };
};

export const enrichLogsActiveFilters: (
  filters: Array<ActiveFilter> | undefined,
  maps: LogsEntityLookupMaps,
  entityNameMap: TelemetryEntityNameMap | undefined,
) => Array<ActiveFilter> = (
  filters: Array<ActiveFilter> | undefined,
  maps: LogsEntityLookupMaps,
  entityNameMap: TelemetryEntityNameMap | undefined,
): Array<ActiveFilter> => {
  return (filters || []).map((filter: ActiveFilter): ActiveFilter => {
    return enrichLogsActiveFilter(filter, maps, entityNameMap);
  });
};

/*
 * A parent that knows what its scope ids are (a RUM page) labels the chip
 * with the entity's type ("RUM Application") before the name has landed.
 * Reading that label back as a type hint sends the id straight to its own
 * table; unhinted, a non-Service id misses the Service probe and then fans
 * out to every other entity table. "Service" is ambiguous (a Service or the
 * project-level Unknown bucket) and is the generic default, so it is never
 * read as a hint.
 */
export const getTelemetryEntityTypeForChipKey: (
  displayKey: string | undefined,
) => ServiceType | undefined = (
  displayKey: string | undefined,
): ServiceType | undefined => {
  const label: string | undefined = nonEmpty(displayKey);
  if (!label || label === DEFAULT_TELEMETRY_ENTITY_LABEL) {
    return undefined;
  }

  const matches: Array<ServiceType> = (
    Object.keys(TELEMETRY_ENTITY_TYPES) as Array<ServiceType>
  ).filter((type: ServiceType): boolean => {
    return TELEMETRY_ENTITY_TYPES[type].label === label;
  });

  return matches.length === 1 ? matches[0] : undefined;
};

/*
 * The server's name for a facet value, or undefined. A blank displayName, or
 * one that merely echoes the value (an id the server could not name), is
 * not a name: it must neither suppress the client-side resolver nor win
 * over a name the viewer does have.
 */
export const getServerFacetDisplayName: (
  facetValue: FacetValue | undefined,
) => string | undefined = (
  facetValue: FacetValue | undefined,
): string | undefined => {
  const displayName: string | undefined = nonEmpty(facetValue?.displayName);
  if (!displayName || displayName === `${facetValue?.value ?? ""}`.trim()) {
    return undefined;
  }
  return displayName;
};

/*
 * What a sidebar facet row prints: the server's name, then the viewer's
 * display map (preloaded resources + resolver names), then undefined so the
 * row falls back to the raw value.
 */
export const getFacetValueDisplayLabel: (
  facetValue: FacetValue,
  valueDisplayMap: Record<string, string> | undefined,
) => string | undefined = (
  facetValue: FacetValue,
  valueDisplayMap: Record<string, string> | undefined,
): string | undefined => {
  return (
    getServerFacetDisplayName(facetValue) ||
    nonEmpty(valueDisplayMap?.[facetValue.value]) ||
    undefined
  );
};

const getFacetDisplayNames: (
  facetData: FacetData | undefined,
  facetKey: string,
) => Record<string, string> = (
  facetData: FacetData | undefined,
  facetKey: string,
): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const facetValue of facetData?.[facetKey] || []) {
    const displayName: string | undefined =
      getServerFacetDisplayName(facetValue);
    if (displayName) {
      map[facetValue.value] = displayName;
    }
  }
  return map;
};

/*
 * Everything the viewer shows that can name an entity by id and that the
 * preloaded maps / server / parent have not named yet, gathered into ONE
 * resolver request:
 *   - resource chips (base + user), unless already named;
 *   - the primaryEntityId of every displayed log missing from the
 *     preloaded maps (hinted by the row's primaryEntityType when the row
 *     carries it);
 *   - primaryEntityId search suggestions without a server displayName;
 *   - resource facet values in the sidebar without a server displayName.
 *
 * A Service-keyed id (chip, log row, suggestion) found in a preloaded
 * non-Service map is named from that map by enrichLogsActiveFilter /
 * getLogEntityDisplay / resolvePrimaryEntitySuggestions, so it is not
 * requested. The sidebar's primaryEntityId rows only read serviceMap and
 * the resolver, so such an id is still requested there, but hinted to the
 * table it was found in rather than probing Services and fanning out.
 */
export const collectLogsEntityIdsToResolve: (data: {
  filters?: Array<ActiveFilter> | undefined;
  logs?: Array<Log> | undefined;
  facetData?: FacetData | undefined;
  suggestionIds?: Array<string> | undefined;
  maps: LogsEntityLookupMaps;
}) => LogsEntityResolutionRequest = (data: {
  filters?: Array<ActiveFilter> | undefined;
  logs?: Array<Log> | undefined;
  facetData?: FacetData | undefined;
  suggestionIds?: Array<string> | undefined;
  maps: LogsEntityLookupMaps;
}): LogsEntityResolutionRequest => {
  const ids: Set<string> = new Set<string>();
  const typeHints: Record<string, ServiceType> = {};

  const add: (
    facetKey: string,
    rawId: unknown,
    hint?: ServiceType | string | undefined,
    loadedResourceIds?: "skip" | "hint" | undefined,
  ) => void = (
    facetKey: string,
    rawId: unknown,
    hint?: ServiceType | string | undefined,
    loadedResourceIds?: "skip" | "hint" | undefined,
  ): void => {
    if (!isLogsEntityIdValue(rawId)) {
      return;
    }
    const id: string = rawId.trim();
    if (getLoadedLogsEntityName(facetKey, id, data.maps)) {
      return;
    }
    const loadedResource: LoadedLogsResourceEntity | undefined =
      isServiceFacetKey(facetKey)
        ? findLoadedLogsResourceEntity(id, data.maps)
        : undefined;
    // Default "skip": the caller names it from the preloaded map.
    if (loadedResource && loadedResourceIds !== "hint") {
      return;
    }
    ids.add(id);
    const typeHint: ServiceType | undefined =
      LOGS_RESOURCE_FACET_ENTITY_TYPES[facetKey] ||
      loadedResource?.entityType ||
      (hint &&
      Object.prototype.hasOwnProperty.call(TELEMETRY_ENTITY_TYPES, `${hint}`)
        ? (`${hint}` as ServiceType)
        : undefined);
    if (typeHint && !typeHints[id]) {
      typeHints[id] = typeHint;
    }
  };

  for (const filter of data.filters || []) {
    if (!isResourceFacetKey(filter.facetKey)) {
      continue;
    }
    if (hasParentResolvedDisplay(filter)) {
      continue;
    }
    add(
      filter.facetKey,
      filter.value,
      getTelemetryEntityTypeForChipKey(filter.displayKey),
    );
  }

  for (const log of data.logs || []) {
    add(
      "primaryEntityId",
      log.primaryEntityId?.toString(),
      log.primaryEntityType,
    );
  }

  const serviceFacetDisplayNames: Record<string, string> = getFacetDisplayNames(
    data.facetData,
    "primaryEntityId",
  );
  for (const id of data.suggestionIds || []) {
    if (serviceFacetDisplayNames[id]) {
      continue;
    }
    add("primaryEntityId", id);
  }

  for (const [facetKey, values] of Object.entries(data.facetData || {})) {
    if (!isResourceFacetKey(facetKey)) {
      continue;
    }
    for (const facetValue of values || []) {
      if (getServerFacetDisplayName(facetValue)) {
        continue;
      }
      add(facetKey, facetValue.value, undefined, "hint");
    }
  }

  return {
    ids: Array.from(ids).sort(),
    typeHints,
  };
};

export interface LogEntityDisplay {
  // Name to render; undefined when nothing (not even an id) is known.
  name: string | undefined;
  // A real Service's colour; undefined for other entities.
  color: string | undefined;
  /*
   * Type label when the entity was named by the generic resolver (e.g.
   * "RUM Application") or a preloaded host / cluster map (e.g. "Host");
   * undefined for preloaded Services.
   */
  typeLabel: string | undefined;
}

/*
 * What a log row / details header shows for the log's primary entity:
 * a preloaded Service (name + colour) first, then a preloaded host /
 * cluster (agent-ingested telemetry is primary-keyed on it, and those ids
 * are not sent to the resolver), then the generic resolver's name, then the
 * raw id so the row is never blank.
 */
export const getLogEntityDisplay: (data: {
  primaryEntityId: string | undefined;
  serviceMap: Dictionary<Service>;
  resourceMaps?: LogsResourceEntityMaps | undefined;
  entityNameMap?: TelemetryEntityNameMap | undefined;
}) => LogEntityDisplay = (data: {
  primaryEntityId: string | undefined;
  serviceMap: Dictionary<Service>;
  resourceMaps?: LogsResourceEntityMaps | undefined;
  entityNameMap?: TelemetryEntityNameMap | undefined;
}): LogEntityDisplay => {
  const id: string = data.primaryEntityId || "";
  const service: Service | undefined = id ? data.serviceMap[id] : undefined;
  const serviceName: string | undefined = nonEmpty(service?.name);
  const color: string | undefined = service?.serviceColor
    ? service.serviceColor.toString()
    : undefined;

  if (serviceName) {
    return { name: serviceName, color, typeLabel: undefined };
  }

  const loadedResource: LoadedLogsResourceEntity | undefined =
    findLoadedLogsResourceEntity(id, data.resourceMaps);
  if (loadedResource) {
    return {
      name: loadedResource.name,
      color,
      typeLabel: loadedResource.typeLabel,
    };
  }

  const resolved: ResolvedTelemetryEntity | undefined = id
    ? data.entityNameMap?.[id]
    : undefined;
  if (resolved) {
    return { name: resolved.name, color, typeLabel: resolved.typeLabel };
  }

  return { name: id || undefined, color, typeLabel: undefined };
};

// id -> name for every entity the resolver named.
export const buildEntityNameDisplayMap: (
  entityNameMap: TelemetryEntityNameMap | undefined,
) => Record<string, string> = (
  entityNameMap: TelemetryEntityNameMap | undefined,
): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const [id, entity] of Object.entries(entityNameMap || {})) {
    if (entity?.name) {
      map[id] = entity.name;
    }
  }
  return map;
};

/*
 * Sidebar facet row labels: resolver names underneath, the preloaded map on
 * top (server displayName still wins inside FacetSection).
 */
export const mergeFacetValueDisplayMap: (
  loadedDisplayMap: Record<string, string> | undefined,
  entityNameMap: TelemetryEntityNameMap | undefined,
) => Record<string, string> = (
  loadedDisplayMap: Record<string, string> | undefined,
  entityNameMap: TelemetryEntityNameMap | undefined,
): Record<string, string> => {
  return {
    ...buildEntityNameDisplayMap(entityNameMap),
    ...(loadedDisplayMap || {}),
  };
};

export interface PrimaryEntitySuggestions {
  /*
   * Labels shown in the search bar dropdown, one per distinct id, in input
   * order. No two are equal, even ignoring case.
   */
  labels: Array<string>;
  /*
   * Lower-cased label -> id for every label, to turn a picked label back
   * into the filter id.
   */
  labelToId: Record<string, string>;
}

interface PrimaryEntitySuggestionCandidate {
  id: string;
  name: string;
  typeLabel: string | undefined;
}

/*
 * The `service:` value dropdown lists primaryEntityId ids. Show names —
 * server facet displayName first (it covers every entity type), then the
 * preloaded Service, then a preloaded host / cluster, then the generic
 * resolver, then the id — and remember how to map the picked label back
 * to the id the filter needs.
 *
 * The filter needs the id, and picking is by label, so every label must
 * name exactly one id. Names are not unique across entity types (a Service
 * and a RUM application can both be "checkout") or across case, and a
 * shared label used to silently filter by whichever id came first. Every
 * entity in a case-insensitive name clash is shown as "name (Type)"; if
 * that is still ambiguous (same type) or the type is unknown, the id itself
 * is shown. A plain typed "checkout" then misses the suggestions and falls
 * back to the preloaded Service scan, as before.
 */
export const resolvePrimaryEntitySuggestions: (data: {
  ids: Array<string>;
  facetValues?: Array<FacetValue> | undefined;
  serviceMap: Dictionary<Service>;
  resourceMaps?: LogsResourceEntityMaps | undefined;
  entityNameMap?: TelemetryEntityNameMap | undefined;
}) => PrimaryEntitySuggestions = (data: {
  ids: Array<string>;
  facetValues?: Array<FacetValue> | undefined;
  serviceMap: Dictionary<Service>;
  resourceMaps?: LogsResourceEntityMaps | undefined;
  entityNameMap?: TelemetryEntityNameMap | undefined;
}): PrimaryEntitySuggestions => {
  const displayNames: Record<string, string> = getFacetDisplayNames(
    { primaryEntityId: data.facetValues || [] },
    "primaryEntityId",
  );

  const candidates: Array<PrimaryEntitySuggestionCandidate> = [];
  const seenIds: Set<string> = new Set<string>();
  for (const id of data.ids) {
    if (!id || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    const serviceName: string | undefined = nonEmpty(data.serviceMap[id]?.name);
    const loadedResource: LoadedLogsResourceEntity | undefined = serviceName
      ? undefined
      : findLoadedLogsResourceEntity(id, data.resourceMaps);
    const resolved: ResolvedTelemetryEntity | undefined =
      data.entityNameMap?.[id];

    candidates.push({
      id,
      name:
        displayNames[id] ||
        serviceName ||
        loadedResource?.name ||
        nonEmpty(resolved?.name) ||
        id,
      typeLabel: serviceName
        ? TELEMETRY_ENTITY_TYPES[ServiceType.OpenTelemetry].label
        : loadedResource?.typeLabel || nonEmpty(resolved?.typeLabel),
    });
  }

  const countByLower: (values: Array<string>) => Map<string, number> = (
    values: Array<string>,
  ): Map<string, number> => {
    const counts: Map<string, number> = new Map<string, number>();
    for (const value of values) {
      const lower: string = value.toLowerCase();
      counts.set(lower, (counts.get(lower) || 0) + 1);
    }
    return counts;
  };

  const nameCounts: Map<string, number> = countByLower(
    candidates.map((candidate: PrimaryEntitySuggestionCandidate): string => {
      return candidate.name;
    }),
  );
  const isClashing: (candidate: PrimaryEntitySuggestionCandidate) => boolean = (
    candidate: PrimaryEntitySuggestionCandidate,
  ): boolean => {
    // An unnamed id is its own label and ids are unique.
    return (
      candidate.name !== candidate.id &&
      (nameCounts.get(candidate.name.toLowerCase()) || 0) > 1
    );
  };

  /*
   * Labels that need no qualifying are reserved first, so "checkout
   * (Service)" made up for a clash never takes the label of an entity that
   * is really called that.
   */
  const reserved: Set<string> = new Set<string>();
  for (const candidate of candidates) {
    if (!isClashing(candidate)) {
      reserved.add(candidate.name.toLowerCase());
    }
  }

  const qualifiedLabelFor: (
    candidate: PrimaryEntitySuggestionCandidate,
  ) => string | undefined = (
    candidate: PrimaryEntitySuggestionCandidate,
  ): string | undefined => {
    return candidate.typeLabel
      ? `${candidate.name} (${candidate.typeLabel})`
      : undefined;
  };

  const qualifiedCounts: Map<string, number> = countByLower(
    candidates
      .filter(isClashing)
      .map((candidate: PrimaryEntitySuggestionCandidate): string => {
        return qualifiedLabelFor(candidate) || candidate.id;
      }),
  );

  const labels: Array<string> = [];
  const labelToId: Record<string, string> = {};
  for (const candidate of candidates) {
    let label: string = candidate.name;

    if (isClashing(candidate)) {
      const qualified: string | undefined = qualifiedLabelFor(candidate);
      const lowerQualified: string = (qualified || "").toLowerCase();
      label =
        qualified &&
        !reserved.has(lowerQualified) &&
        (qualifiedCounts.get(lowerQualified) || 0) === 1
          ? qualified
          : candidate.id;
    }

    labels.push(label);
    labelToId[label.toLowerCase()] = candidate.id;
  }

  return { labels, labelToId };
};

/*
 * ---- Analytics view ----
 *
 * Group-by values for an entity dimension (primaryEntityId, or a typed
 * resource id key) are ids; the chart keeps them as series keys (two
 * entities with the same name must stay two series) and only the labels
 * change.
 */

export const ANALYTICS_DIMENSION_LABELS: Record<string, string> = {
  severityText: "Severity",
  primaryEntityId: "Service",
  serviceId: "Service",
  ...getResourceFacetLabelMap(),
  traceId: "Trace ID",
  spanId: "Span ID",
};

export const isAnalyticsEntityDimension: (key: string) => boolean = (
  key: string,
): boolean => {
  return isResourceFacetKey(key);
};

export interface AnalyticsGroupedRow {
  groupValues: Record<string, string>;
}

export interface AnalyticsTopListValue {
  value: string;
}

/*
 * Ids to name for the analytics result on screen.
 *
 * Grouped rows (timeseries / table) are read by their own groupValues keys
 * — the same keys the legend and table cells label them by. The group-by
 * of the last fetch is not a safe guide: it belongs to whichever chart type
 * fetched last, so after switching chart type the leftover rows of the
 * other type (grouped differently) had their ids dropped from the request
 * and their names fell back to UUIDs until the refetch landed.
 *
 * A top list item carries only a value, so it is read against
 * `groupByFields[0]`, the dimension its label is rendered with.
 */
export const collectAnalyticsEntityIds: (data: {
  groupByFields: Array<string>;
  groupedRows?: Array<AnalyticsGroupedRow> | undefined;
  topListItems?: Array<AnalyticsTopListValue> | undefined;
}) => LogsEntityResolutionRequest = (data: {
  groupByFields: Array<string>;
  groupedRows?: Array<AnalyticsGroupedRow> | undefined;
  topListItems?: Array<AnalyticsTopListValue> | undefined;
}): LogsEntityResolutionRequest => {
  const ids: Set<string> = new Set<string>();
  const typeHints: Record<string, ServiceType> = {};

  const add: (key: string, value: unknown) => void = (
    key: string,
    value: unknown,
  ): void => {
    if (!isAnalyticsEntityDimension(key) || !isLogsEntityIdValue(value)) {
      return;
    }
    const id: string = value.trim();
    ids.add(id);
    const hint: ServiceType | undefined = LOGS_RESOURCE_FACET_ENTITY_TYPES[key];
    if (hint && !typeHints[id]) {
      typeHints[id] = hint;
    }
  };

  for (const row of data.groupedRows || []) {
    for (const [key, value] of Object.entries(row?.groupValues || {})) {
      add(key, value);
    }
  }

  const topListKey: string | undefined = data.groupByFields[0];
  if (topListKey) {
    for (const item of data.topListItems || []) {
      add(topListKey, item.value);
    }
  }

  return { ids: Array.from(ids).sort(), typeHints };
};

// Label for one group-by value: the entity name for entity dimensions.
export const getAnalyticsGroupValueLabel: (
  key: string | undefined,
  value: string,
  entityNameMap: TelemetryEntityNameMap | undefined,
) => string = (
  key: string | undefined,
  value: string,
  entityNameMap: TelemetryEntityNameMap | undefined,
): string => {
  if (!key || !isAnalyticsEntityDimension(key) || !value) {
    return value;
  }
  return entityNameMap?.[value]?.name || value;
};

/*
 * Column header for a group-by dimension. Entity dimensions use the type of
 * the values when they all resolved to the same one (a RUM application's
 * logs grouped by entity read "RUM Application"); a mixed or unresolved set
 * keeps the generic label. Other known dimensions get their friendly label;
 * attribute keys stay as typed.
 */
export const getAnalyticsDimensionLabel: (
  key: string,
  values: Array<string>,
  entityNameMap: TelemetryEntityNameMap | undefined,
) => string = (
  key: string,
  values: Array<string>,
  entityNameMap: TelemetryEntityNameMap | undefined,
): string => {
  const fallback: string = ANALYTICS_DIMENSION_LABELS[key] || key;

  if (!isAnalyticsEntityDimension(key) || isResourceEntityFacetKey(key)) {
    return fallback;
  }

  const nonEmptyValues: Array<string> = values.filter((value: string) => {
    return Boolean(value);
  });
  if (nonEmptyValues.length === 0) {
    return fallback;
  }

  const labels: Set<string> = new Set<string>();
  for (const value of nonEmptyValues) {
    const resolved: ResolvedTelemetryEntity | undefined =
      entityNameMap?.[value];
    if (!resolved) {
      return fallback;
    }
    labels.add(resolved.typeLabel);
  }

  return labels.size === 1 ? Array.from(labels)[0]! : fallback;
};

/*
 * Legend / tooltip label for a timeseries series. The series key joins the
 * row's group values with " / " (see pivotTimeseriesData); the label joins
 * the same values after naming them.
 */
export const getAnalyticsSeriesLabel: (
  groupValues: Record<string, string>,
  entityNameMap: TelemetryEntityNameMap | undefined,
) => string = (
  groupValues: Record<string, string>,
  entityNameMap: TelemetryEntityNameMap | undefined,
): string => {
  return Object.entries(groupValues)
    .map(([key, value]: [string, string]): string => {
      return getAnalyticsGroupValueLabel(key, value, entityNameMap);
    })
    .join(" / ");
};
