import { describe, expect, test } from "@jest/globals";
import Log from "../../../Models/AnalyticsModels/Log";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import Service from "../../../Models/DatabaseModels/Service";
import Color from "../../../Types/Color";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import {
  RESOURCE_FACET_CATALOG,
  RESOURCE_FACET_CATALOG_KEYS,
  ResourceFacetDefinition,
} from "../../../Types/Telemetry/ResourceFacetCatalog";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  ANALYTICS_DIMENSION_LABELS,
  buildEntityNameDisplayMap,
  collectAnalyticsEntityIds,
  collectLogsEntityIdsToResolve,
  enrichLogsActiveFilter,
  enrichLogsActiveFilters,
  findLoadedLogsResourceEntity,
  getAnalyticsDimensionLabel,
  getAnalyticsGroupValueLabel,
  getAnalyticsSeriesLabel,
  getFacetValueDisplayLabel,
  getLoadedLogsEntityName,
  getLogEntityDisplay,
  getServerFacetDisplayName,
  getTelemetryEntityTypeForChipKey,
  isAnalyticsEntityDimension,
  isLogsEntityIdValue,
  LOGS_RESOURCE_FACET_ENTITY_TYPES,
  LogEntityDisplay,
  LogsEntityLookupMaps,
  LoadedLogsResourceEntity,
  LogsEntityResolutionRequest,
  mergeFacetValueDisplayMap,
  PrimaryEntitySuggestions,
  resolvePrimaryEntitySuggestions,
} from "../../../UI/Components/LogsViewer/LogsEntityNames";
import { ActiveFilter } from "../../../UI/Components/LogsViewer/types";
import {
  DEFAULT_TELEMETRY_ENTITY_LABEL,
  TELEMETRY_ENTITY_RESOLUTION_ORDER,
  TELEMETRY_ENTITY_TYPES,
  TelemetryEntityNameMap,
} from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

/*
 * The shared logs viewer only preloads Services, hosts, Docker / Podman
 * hosts and Kubernetes clusters. A log's primaryEntityId is polymorphic, so
 * a RUM application's logs (primaryEntityId = RumApplication id) rendered
 * "Service: 84858d6c-…" in the chips, the raw UUID in the Service column
 * and the details header, and ids in the analytics legend / table.
 *
 * LogsEntityNames holds the rules the viewer now follows. These tests pin
 * the precedence (preloaded map > parent-supplied name > generic resolver
 * > id), which ids are sent to the resolver, and that the filter value
 * itself — the id the query uses — is never rewritten.
 */

const SERVICE_ID: string = "11111111-0000-4000-8000-000000000001";
const SERVICE_ID_NOT_LOADED: string = "11111111-0000-4000-8000-000000000009";
const RUM_ID: string = "22222222-0000-4000-8000-000000000001";
const RUM_ID_2: string = "22222222-0000-4000-8000-000000000002";
const HOST_ID: string = "33333333-0000-4000-8000-000000000001";
const HOST_ID_NOT_LOADED: string = "33333333-0000-4000-8000-000000000009";
const DOCKER_HOST_ID: string = "44444444-0000-4000-8000-000000000001";
const PODMAN_HOST_ID: string = "55555555-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "66666666-0000-4000-8000-000000000001";
const FUNCTION_ID: string = "77777777-0000-4000-8000-000000000001";
const MISSING_ID: string = "99999999-0000-4000-8000-000000000001";

const makeService: (id: string, name: string, color?: string) => Service = (
  id: string,
  name: string,
  color?: string,
): Service => {
  const service: Service = new Service();
  service.id = new ObjectID(id);
  service.name = name;
  if (color) {
    service.serviceColor = new Color(color);
  }
  return service;
};

const makeHost: (id: string, name?: string, identifier?: string) => Host = (
  id: string,
  name?: string,
  identifier?: string,
): Host => {
  const host: Host = new Host();
  host.id = new ObjectID(id);
  if (name) {
    host.name = name;
  }
  if (identifier) {
    host.hostIdentifier = identifier;
  }
  return host;
};

const makeMaps: () => LogsEntityLookupMaps = (): LogsEntityLookupMaps => {
  const dockerHost: DockerHost = new DockerHost();
  dockerHost.id = new ObjectID(DOCKER_HOST_ID);
  dockerHost.hostIdentifier = "docker-box-1";

  const podmanHost: PodmanHost = new PodmanHost();
  podmanHost.id = new ObjectID(PODMAN_HOST_ID);
  podmanHost.name = "podman-prod";

  const cluster: KubernetesCluster = new KubernetesCluster();
  cluster.id = new ObjectID(CLUSTER_ID);
  cluster.clusterIdentifier = "prod-cluster";

  const serviceMap: Dictionary<Service> = {
    [SERVICE_ID]: makeService(SERVICE_ID, "checkout-api", "#ff0000"),
  };

  return {
    serviceMap,
    hostMap: { [HOST_ID]: makeHost(HOST_ID, undefined, "ip-10-0-0-1") },
    dockerHostMap: { [DOCKER_HOST_ID]: dockerHost },
    podmanHostMap: { [PODMAN_HOST_ID]: podmanHost },
    kubernetesClusterMap: { [CLUSTER_ID]: cluster },
  };
};

const NAME_MAP: TelemetryEntityNameMap = {
  [RUM_ID]: {
    id: RUM_ID,
    name: "checkout-web",
    entityType: ServiceType.RealUserMonitor,
    typeLabel: "RUM Application",
  },
  [RUM_ID_2]: {
    id: RUM_ID_2,
    name: "marketing-site",
    entityType: ServiceType.RealUserMonitor,
    typeLabel: "RUM Application",
  },
  [SERVICE_ID_NOT_LOADED]: {
    id: SERVICE_ID_NOT_LOADED,
    name: "billing-worker",
    entityType: ServiceType.OpenTelemetry,
    typeLabel: "Service",
  },
  [HOST_ID_NOT_LOADED]: {
    id: HOST_ID_NOT_LOADED,
    name: "db-host-7",
    entityType: ServiceType.Host,
    typeLabel: "Host",
  },
  [FUNCTION_ID]: {
    id: FUNCTION_ID,
    name: "resize-images",
    entityType: ServiceType.ServerlessFunction,
    typeLabel: "Serverless Function",
  },
};

const chip: (
  facetKey: string,
  value: string,
  displayKey: string,
  displayValue?: string,
  readOnly?: boolean,
) => ActiveFilter = (
  facetKey: string,
  value: string,
  displayKey: string,
  displayValue?: string,
  readOnly?: boolean,
): ActiveFilter => {
  return {
    facetKey,
    value,
    displayKey,
    displayValue: displayValue === undefined ? value : displayValue,
    ...(readOnly ? { readOnly: true } : {}),
  };
};

const makeLog: (
  primaryEntityId?: string,
  primaryEntityType?: ServiceType,
) => Log = (primaryEntityId?: string, primaryEntityType?: ServiceType): Log => {
  const log: Log = new Log();
  log.body = "hello";
  if (primaryEntityId) {
    log.primaryEntityId = new ObjectID(primaryEntityId);
  }
  if (primaryEntityType) {
    log.primaryEntityType = primaryEntityType;
  }
  return log;
};

describe("isLogsEntityIdValue", () => {
  test("accepts UUIDs in either case and with surrounding whitespace", () => {
    expect(isLogsEntityIdValue(RUM_ID)).toBe(true);
    expect(isLogsEntityIdValue(RUM_ID.toUpperCase())).toBe(true);
    expect(isLogsEntityIdValue(`  ${RUM_ID} `)).toBe(true);
  });

  test("rejects names, empty strings and non-strings", () => {
    expect(isLogsEntityIdValue("checkout-api")).toBe(false);
    expect(isLogsEntityIdValue("")).toBe(false);
    expect(isLogsEntityIdValue(undefined)).toBe(false);
    expect(isLogsEntityIdValue(null)).toBe(false);
    expect(isLogsEntityIdValue(42)).toBe(false);
    expect(isLogsEntityIdValue({ value: RUM_ID })).toBe(false);
    expect(isLogsEntityIdValue(`${RUM_ID}-extra`)).toBe(false);
  });
});

describe("LOGS_RESOURCE_FACET_ENTITY_TYPES", () => {
  test("maps each typed resource facet to its table", () => {
    expect(LOGS_RESOURCE_FACET_ENTITY_TYPES).toEqual({
      hostId: ServiceType.Host,
      dockerHostId: ServiceType.DockerHost,
      podmanHostId: ServiceType.PodmanHost,
      kubernetesClusterId: ServiceType.KubernetesCluster,
      dockerSwarmClusterId: ServiceType.DockerSwarmCluster,
      proxmoxClusterId: ServiceType.ProxmoxCluster,
      vmwareVCenterId: ServiceType.VMwareVCenter,
      cephClusterId: ServiceType.CephCluster,
      serverlessFunctionId: ServiceType.ServerlessFunction,
      cloudResourceId: ServiceType.CloudResource,
      rumApplicationId: ServiceType.RealUserMonitor,
      iotFleetId: ServiceType.IoTDevice,
    });
  });

  test("covers exactly the resource facet catalog, in catalog order", () => {
    /*
     * Order matters: findLoadedLogsResourceEntity probes the preloaded maps
     * in this order, so the four preloaded types must stay first.
     */
    expect(Object.keys(LOGS_RESOURCE_FACET_ENTITY_TYPES)).toEqual([
      ...RESOURCE_FACET_CATALOG_KEYS,
    ]);
    expect(Object.keys(LOGS_RESOURCE_FACET_ENTITY_TYPES).slice(0, 4)).toEqual([
      "hostId",
      "dockerHostId",
      "podmanHostId",
      "kubernetesClusterId",
    ]);
  });

  test("Service facets are polymorphic and carry no table hint", () => {
    expect(LOGS_RESOURCE_FACET_ENTITY_TYPES["primaryEntityId"]).toBeUndefined();
    expect(LOGS_RESOURCE_FACET_ENTITY_TYPES["serviceId"]).toBeUndefined();
  });

  test.each(
    RESOURCE_FACET_CATALOG.map(
      (
        definition: ResourceFacetDefinition,
      ): [string, ResourceFacetDefinition] => {
        return [definition.facetKey, definition];
      },
    ),
  )(
    "%s names a table the generic resolver can read, labelled like the catalog",
    (facetKey: string, definition: ResourceFacetDefinition) => {
      const entityType: ServiceType | undefined =
        LOGS_RESOURCE_FACET_ENTITY_TYPES[facetKey];
      expect(entityType).toBe(definition.serviceType);
      expect(TELEMETRY_ENTITY_TYPES[entityType!]).toBeDefined();
      expect(TELEMETRY_ENTITY_TYPES[entityType!].modelType).toBeDefined();
      expect(
        TELEMETRY_ENTITY_TYPES[entityType!].nameFields.length,
      ).toBeGreaterThan(0);
      expect(TELEMETRY_ENTITY_TYPES[entityType!].label).toBe(definition.label);
      // An unhinted id of this type is still probed eventually.
      expect(TELEMETRY_ENTITY_RESOLUTION_ORDER).toContain(entityType);
      // The chip key the explorer gives this facet reads back as its table.
      expect(getTelemetryEntityTypeForChipKey(definition.label)).toBe(
        entityType,
      );
    },
  );
});

describe("getTelemetryEntityTypeForChipKey", () => {
  test("maps every non-default type label back to its ServiceType", () => {
    for (const type of Object.keys(
      TELEMETRY_ENTITY_TYPES,
    ) as Array<ServiceType>) {
      const label: string = TELEMETRY_ENTITY_TYPES[type].label;
      if (label === DEFAULT_TELEMETRY_ENTITY_LABEL) {
        continue;
      }
      expect(getTelemetryEntityTypeForChipKey(label)).toBe(type);
    }
    expect(getTelemetryEntityTypeForChipKey(" RUM Application ")).toBe(
      ServiceType.RealUserMonitor,
    );
  });

  test("'Service', blanks, unknown labels and undefined give no hint", () => {
    expect(getTelemetryEntityTypeForChipKey("Service")).toBeUndefined();
    expect(getTelemetryEntityTypeForChipKey("")).toBeUndefined();
    expect(getTelemetryEntityTypeForChipKey("   ")).toBeUndefined();
    expect(getTelemetryEntityTypeForChipKey("rum application")).toBeUndefined();
    expect(getTelemetryEntityTypeForChipKey("resource.host.name")).toBe(
      undefined,
    );
    expect(getTelemetryEntityTypeForChipKey(undefined)).toBeUndefined();
  });
});

describe("getLoadedLogsEntityName", () => {
  const maps: LogsEntityLookupMaps = makeMaps();

  test("names Service facets (primaryEntityId and the legacy serviceId) from serviceMap", () => {
    expect(getLoadedLogsEntityName("primaryEntityId", SERVICE_ID, maps)).toBe(
      "checkout-api",
    );
    expect(getLoadedLogsEntityName("serviceId", SERVICE_ID, maps)).toBe(
      "checkout-api",
    );
  });

  test("falls back to the machine identifier when a resource has no name", () => {
    expect(getLoadedLogsEntityName("hostId", HOST_ID, maps)).toBe(
      "ip-10-0-0-1",
    );
    expect(getLoadedLogsEntityName("dockerHostId", DOCKER_HOST_ID, maps)).toBe(
      "docker-box-1",
    );
    expect(
      getLoadedLogsEntityName("kubernetesClusterId", CLUSTER_ID, maps),
    ).toBe("prod-cluster");
  });

  test("prefers the name over the identifier", () => {
    expect(getLoadedLogsEntityName("podmanHostId", PODMAN_HOST_ID, maps)).toBe(
      "podman-prod",
    );
    const named: LogsEntityLookupMaps = {
      ...maps,
      hostMap: { [HOST_ID]: makeHost(HOST_ID, "web-1", "ip-10-0-0-1") },
    };
    expect(getLoadedLogsEntityName("hostId", HOST_ID, named)).toBe("web-1");
  });

  test("returns undefined for ids the maps do not hold, unknown keys and missing maps", () => {
    expect(
      getLoadedLogsEntityName("primaryEntityId", RUM_ID, maps),
    ).toBeUndefined();
    expect(getLoadedLogsEntityName("severityText", SERVICE_ID, maps)).toBe(
      undefined,
    );
    expect(
      getLoadedLogsEntityName("hostId", HOST_ID, { serviceMap: {} }),
    ).toBeUndefined();
  });

  test("a blank Service name does not count as a name", () => {
    const blank: LogsEntityLookupMaps = {
      serviceMap: { [SERVICE_ID]: makeService(SERVICE_ID, "   ") },
    };
    expect(
      getLoadedLogsEntityName("primaryEntityId", SERVICE_ID, blank),
    ).toBeUndefined();
  });
});

describe("findLoadedLogsResourceEntity", () => {
  const maps: LogsEntityLookupMaps = makeMaps();

  test("finds an id in each preloaded non-Service map, with its type and label", () => {
    expect(findLoadedLogsResourceEntity(HOST_ID, maps)).toEqual({
      name: "ip-10-0-0-1",
      entityType: ServiceType.Host,
      typeLabel: "Host",
    });
    expect(findLoadedLogsResourceEntity(DOCKER_HOST_ID, maps)).toEqual({
      name: "docker-box-1",
      entityType: ServiceType.DockerHost,
      typeLabel: "Docker Host",
    });
    expect(findLoadedLogsResourceEntity(PODMAN_HOST_ID, maps)).toEqual({
      name: "podman-prod",
      entityType: ServiceType.PodmanHost,
      typeLabel: "Podman Host",
    });
    expect(findLoadedLogsResourceEntity(CLUSTER_ID, maps)).toEqual({
      name: "prod-cluster",
      entityType: ServiceType.KubernetesCluster,
      typeLabel: "Kubernetes Cluster",
    });
  });

  test("prefers the name over the machine identifier", () => {
    const found: LoadedLogsResourceEntity | undefined =
      findLoadedLogsResourceEntity(HOST_ID, {
        hostMap: { [HOST_ID]: makeHost(HOST_ID, "web-1", "ip-10-0-0-1") },
      });
    expect(found?.name).toBe("web-1");
  });

  test("never reads serviceMap, and misses unknown ids, blanks and absent maps", () => {
    expect(findLoadedLogsResourceEntity(SERVICE_ID, maps)).toBeUndefined();
    expect(findLoadedLogsResourceEntity(RUM_ID, maps)).toBeUndefined();
    expect(findLoadedLogsResourceEntity("", maps)).toBeUndefined();
    expect(findLoadedLogsResourceEntity(HOST_ID, undefined)).toBeUndefined();
    expect(findLoadedLogsResourceEntity(HOST_ID, {})).toBeUndefined();
    expect(
      findLoadedLogsResourceEntity(HOST_ID, {
        hostMap: { [HOST_ID]: makeHost(HOST_ID, " ", "") },
      }),
    ).toBeUndefined();
  });
});

describe("enrichLogsActiveFilter", () => {
  const maps: LogsEntityLookupMaps = makeMaps();

  test("regression: a Service-keyed chip for a preloaded host / cluster is named from its map with its type", () => {
    const host: ActiveFilter = enrichLogsActiveFilter(
      chip("primaryEntityId", HOST_ID, "Service", HOST_ID, true),
      maps,
      {},
    );
    expect(host.displayKey).toBe("Host");
    expect(host.displayValue).toBe("ip-10-0-0-1");
    expect(host.value).toBe(HOST_ID);
    expect(host.facetKey).toBe("primaryEntityId");
    expect(host.readOnly).toBe(true);

    const cluster: ActiveFilter = enrichLogsActiveFilter(
      chip("serviceId", CLUSTER_ID, "Service"),
      maps,
      undefined,
    );
    expect(`${cluster.displayKey}: ${cluster.displayValue}`).toBe(
      "Kubernetes Cluster: prod-cluster",
    );
  });

  test("a parent-named Service-keyed chip for a preloaded host is left alone", () => {
    const incoming: ActiveFilter = chip(
      "primaryEntityId",
      HOST_ID,
      "Host",
      "web-1 (from parent)",
    );
    expect(enrichLogsActiveFilter(incoming, maps, {})).toBe(incoming);
  });

  test("regression: a RUM application scope chip reads its type and name, not 'Service: <uuid>'", () => {
    const result: ActiveFilter = enrichLogsActiveFilter(
      chip("primaryEntityId", RUM_ID, "Service", RUM_ID, true),
      maps,
      NAME_MAP,
    );
    expect(result.displayKey).toBe("RUM Application");
    expect(result.displayValue).toBe("checkout-web");
    // Display only — the filter still carries the id and stays read-only.
    expect(result.value).toBe(RUM_ID);
    expect(result.facetKey).toBe("primaryEntityId");
    expect(result.readOnly).toBe(true);
  });

  test("the legacy serviceId alias gets the same treatment", () => {
    const result: ActiveFilter = enrichLogsActiveFilter(
      chip("serviceId", RUM_ID, "Service"),
      maps,
      NAME_MAP,
    );
    expect(result.displayKey).toBe("RUM Application");
    expect(result.displayValue).toBe("checkout-web");
  });

  test("a preloaded Service name wins and the key is kept as given", () => {
    const result: ActiveFilter = enrichLogsActiveFilter(
      chip("primaryEntityId", SERVICE_ID, "Service"),
      maps,
      {
        [SERVICE_ID]: {
          id: SERVICE_ID,
          name: "stale-name",
          entityType: ServiceType.OpenTelemetry,
          typeLabel: "Service",
        },
      },
    );
    expect(result.displayKey).toBe("Service");
    expect(result.displayValue).toBe("checkout-api");
  });

  test("a preloaded Service name replaces an outdated parent label (existing behaviour)", () => {
    const result: ActiveFilter = enrichLogsActiveFilter(
      chip("primaryEntityId", SERVICE_ID, "Service", "old-name"),
      maps,
      {},
    );
    expect(result.displayValue).toBe("checkout-api");
  });

  test("does not clobber a name the parent already resolved", () => {
    const incoming: ActiveFilter = chip(
      "primaryEntityId",
      RUM_ID,
      "RUM Application",
      "checkout-web (from parent)",
      true,
    );
    const result: ActiveFilter = enrichLogsActiveFilter(incoming, maps, {
      [RUM_ID]: {
        id: RUM_ID,
        name: "something-else",
        entityType: ServiceType.RealUserMonitor,
        typeLabel: "RUM Application",
      },
    });
    expect(result).toBe(incoming);
  });

  test("keeps a parent-supplied key while the name is still unresolved", () => {
    const incoming: ActiveFilter = chip(
      "primaryEntityId",
      RUM_ID,
      "RUM Application",
    );
    const result: ActiveFilter = enrichLogsActiveFilter(incoming, maps, {});
    expect(result.displayKey).toBe("RUM Application");
    expect(result.displayValue).toBe(RUM_ID);
  });

  test("an unresolved id chip comes back unchanged", () => {
    const incoming: ActiveFilter = chip(
      "primaryEntityId",
      MISSING_ID,
      "Service",
    );
    expect(enrichLogsActiveFilter(incoming, maps, NAME_MAP)).toBe(incoming);
    expect(enrichLogsActiveFilter(incoming, maps, undefined)).toBe(incoming);
  });

  test("a Service beyond the preloaded page is named by the resolver with the key 'Service'", () => {
    const result: ActiveFilter = enrichLogsActiveFilter(
      chip("primaryEntityId", SERVICE_ID_NOT_LOADED, "Service"),
      maps,
      NAME_MAP,
    );
    expect(result.displayKey).toBe("Service");
    expect(result.displayValue).toBe("billing-worker");
  });

  test("other entity types take their own label", () => {
    const result: ActiveFilter = enrichLogsActiveFilter(
      chip("primaryEntityId", FUNCTION_ID, "Service"),
      maps,
      NAME_MAP,
    );
    expect(result.displayKey).toBe("Serverless Function");
    expect(result.displayValue).toBe("resize-images");
  });

  test("hostId chips use the host map first, then the resolver, and keep the 'Host' key", () => {
    expect(
      enrichLogsActiveFilter(chip("hostId", HOST_ID, "Host"), maps, NAME_MAP)
        .displayValue,
    ).toBe("ip-10-0-0-1");

    const resolved: ActiveFilter = enrichLogsActiveFilter(
      chip("hostId", HOST_ID_NOT_LOADED, "Host"),
      maps,
      NAME_MAP,
    );
    expect(resolved.displayKey).toBe("Host");
    expect(resolved.displayValue).toBe("db-host-7");
    expect(resolved.value).toBe(HOST_ID_NOT_LOADED);
  });

  test("docker, podman and cluster chips are named from their maps", () => {
    expect(
      enrichLogsActiveFilter(
        chip("dockerHostId", DOCKER_HOST_ID, "Docker Host"),
        maps,
        {},
      ).displayValue,
    ).toBe("docker-box-1");
    expect(
      enrichLogsActiveFilter(
        chip("podmanHostId", PODMAN_HOST_ID, "Podman Host"),
        maps,
        {},
      ).displayValue,
    ).toBe("podman-prod");
    expect(
      enrichLogsActiveFilter(
        chip("kubernetesClusterId", CLUSTER_ID, "Kubernetes Cluster"),
        maps,
        {},
      ).displayValue,
    ).toBe("prod-cluster");
  });

  test("never touches non-resource chips, even when their value is a known id", () => {
    const severity: ActiveFilter = chip("severityText", "Error", "Severity");
    const trace: ActiveFilter = chip("traceId", RUM_ID, "Trace");
    const attribute: ActiveFilter = chip(
      "attributes.resource.service.id",
      RUM_ID,
      "resource.service.id",
    );
    expect(enrichLogsActiveFilter(severity, maps, NAME_MAP)).toBe(severity);
    expect(enrichLogsActiveFilter(trace, maps, NAME_MAP)).toBe(trace);
    expect(enrichLogsActiveFilter(attribute, maps, NAME_MAP)).toBe(attribute);
  });

  test("tolerates a non-string value that reached the chip through a cast", () => {
    const odd: ActiveFilter = {
      facetKey: "primaryEntityId",
      value: { _type: "Search", value: "x" } as unknown as string,
      displayKey: "Service",
      displayValue: "x",
    };
    expect(enrichLogsActiveFilter(odd, maps, NAME_MAP)).toBe(odd);
  });

  test("enrichLogsActiveFilters maps a list and treats undefined as empty", () => {
    expect(enrichLogsActiveFilters(undefined, maps, NAME_MAP)).toEqual([]);
    const result: Array<ActiveFilter> = enrichLogsActiveFilters(
      [
        chip("primaryEntityId", SERVICE_ID, "Service"),
        chip("primaryEntityId", RUM_ID, "Service"),
        chip("severityText", "Error", "Severity"),
      ],
      maps,
      NAME_MAP,
    );
    expect(
      result.map((filter: ActiveFilter): string => {
        return `${filter.displayKey}: ${filter.displayValue}`;
      }),
    ).toEqual([
      "Service: checkout-api",
      "RUM Application: checkout-web",
      "Severity: Error",
    ]);
  });
});

describe("collectLogsEntityIdsToResolve", () => {
  const maps: LogsEntityLookupMaps = makeMaps();

  test("returns nothing when everything is already named", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      filters: [
        chip("primaryEntityId", SERVICE_ID, "Service"),
        chip("hostId", HOST_ID, "Host"),
      ],
      logs: [makeLog(SERVICE_ID)],
      maps,
    });
    expect(request).toEqual({ ids: [], typeHints: {} });
  });

  test("collects unnamed resource chips, with typed hints for typed facets", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      filters: [
        chip("primaryEntityId", RUM_ID, "Service", undefined, true),
        chip("hostId", HOST_ID_NOT_LOADED, "Host"),
        chip("severityText", "Error", "Severity"),
        chip("traceId", MISSING_ID, "Trace"),
      ],
      maps,
    });
    expect(request.ids).toEqual([RUM_ID, HOST_ID_NOT_LOADED].sort());
    expect(request.typeHints).toEqual({
      [HOST_ID_NOT_LOADED]: ServiceType.Host,
    });
  });

  test("a chip key the parent typed (e.g. 'RUM Application') becomes a type hint for the id", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      filters: [
        chip("primaryEntityId", RUM_ID, "RUM Application", RUM_ID, true),
        chip("serviceId", FUNCTION_ID, "Serverless Function"),
        chip("primaryEntityId", MISSING_ID, "Service"),
      ],
      maps,
    });
    expect(request.ids).toEqual([RUM_ID, FUNCTION_ID, MISSING_ID].sort());
    expect(request.typeHints).toEqual({
      [RUM_ID]: ServiceType.RealUserMonitor,
      [FUNCTION_ID]: ServiceType.ServerlessFunction,
    });
  });

  test("a typed resource facet keeps its own table hint whatever the chip key says", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      filters: [chip("hostId", HOST_ID_NOT_LOADED, "RUM Application")],
      maps,
    });
    expect(request.typeHints).toEqual({
      [HOST_ID_NOT_LOADED]: ServiceType.Host,
    });
  });

  test("skips chips the parent already named and non-UUID chip values", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      filters: [
        chip("primaryEntityId", RUM_ID, "RUM Application", "checkout-web"),
        chip("primaryEntityId", "checkout", "Service"),
      ],
      maps,
    });
    expect(request.ids).toEqual([]);
  });

  test("collects log primaryEntityIds missing from serviceMap, hinted by the row's primaryEntityType", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      logs: [
        makeLog(SERVICE_ID, ServiceType.OpenTelemetry),
        makeLog(RUM_ID, ServiceType.RealUserMonitor),
        makeLog(RUM_ID, ServiceType.RealUserMonitor),
        makeLog(FUNCTION_ID),
        makeLog(),
      ],
      maps,
    });
    expect(request.ids).toEqual([RUM_ID, FUNCTION_ID].sort());
    expect(request.typeHints).toEqual({
      [RUM_ID]: ServiceType.RealUserMonitor,
    });
  });

  test("ignores a primaryEntityType that is not a known ServiceType", () => {
    const log: Log = makeLog(RUM_ID);
    log.setColumnValue("primaryEntityType", "NotAType");
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      logs: [log],
      maps,
    });
    expect(request.ids).toEqual([RUM_ID]);
    expect(request.typeHints).toEqual({});
  });

  test("collects suggestion ids the server did not name", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      suggestionIds: [SERVICE_ID, RUM_ID, RUM_ID_2],
      facetData: {
        primaryEntityId: [
          { value: RUM_ID_2, count: 3, displayName: "marketing-site" },
        ],
      },
      maps,
    });
    expect(request.ids).toEqual([RUM_ID]);
  });

  test("collects sidebar resource facet values without a displayName, hinted per facet", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      facetData: {
        primaryEntityId: [
          { value: SERVICE_ID, count: 10 },
          { value: RUM_ID, count: 5 },
          { value: RUM_ID_2, count: 1, displayName: "marketing-site" },
        ],
        kubernetesClusterId: [
          { value: CLUSTER_ID, count: 2 },
          { value: MISSING_ID, count: 1, displayName: " " },
        ],
        severityText: [{ value: "Error", count: 9 }],
        "resource.host.name": [{ value: HOST_ID_NOT_LOADED, count: 1 }],
      },
      maps,
    });
    expect(request.ids).toEqual([RUM_ID, MISSING_ID].sort());
    expect(request.typeHints).toEqual({
      [MISSING_ID]: ServiceType.KubernetesCluster,
    });
  });

  test("de-duplicates across sources, sorts, and the first hint for an id wins", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      filters: [chip("hostId", HOST_ID_NOT_LOADED, "Host")],
      logs: [
        makeLog(HOST_ID_NOT_LOADED, ServiceType.DockerHost),
        makeLog(RUM_ID_2),
        makeLog(RUM_ID),
      ],
      suggestionIds: [RUM_ID],
      maps,
    });
    expect(request.ids).toEqual([HOST_ID_NOT_LOADED, RUM_ID, RUM_ID_2].sort());
    expect(request.typeHints[HOST_ID_NOT_LOADED]).toBe(ServiceType.Host);
  });

  test("regression: unhinted log rows and suggestions for preloaded hosts / clusters are not sent to the resolver", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      logs: [
        makeLog(HOST_ID),
        makeLog(DOCKER_HOST_ID),
        makeLog(CLUSTER_ID),
        makeLog(RUM_ID),
      ],
      suggestionIds: [PODMAN_HOST_ID, HOST_ID, FUNCTION_ID],
      maps,
    });
    expect(request.ids).toEqual([RUM_ID, FUNCTION_ID].sort());
    expect(request.typeHints).toEqual({});
  });

  test("Service-keyed chips for a preloaded host are named from the map, so they are not requested", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      filters: [
        chip("primaryEntityId", HOST_ID, "Service", undefined, true),
        chip("serviceId", CLUSTER_ID, "Service"),
      ],
      maps,
    });
    expect(request).toEqual({ ids: [], typeHints: {} });
  });

  test("a sidebar primaryEntityId row for a preloaded host is still requested, hinted to its own table", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      facetData: {
        primaryEntityId: [
          { value: HOST_ID, count: 3 },
          { value: CLUSTER_ID, count: 1 },
        ],
      },
      logs: [makeLog(HOST_ID)],
      maps,
    });
    expect(request.ids).toEqual([HOST_ID, CLUSTER_ID].sort());
    expect(request.typeHints).toEqual({
      [HOST_ID]: ServiceType.Host,
      [CLUSTER_ID]: ServiceType.KubernetesCluster,
    });
  });

  test("handles every input being absent", () => {
    expect(collectLogsEntityIdsToResolve({ maps: { serviceMap: {} } })).toEqual(
      { ids: [], typeHints: {} },
    );
  });
});

describe("getLogEntityDisplay", () => {
  const maps: LogsEntityLookupMaps = makeMaps();

  test("a preloaded Service keeps its name and colour and has no type label", () => {
    const display: LogEntityDisplay = getLogEntityDisplay({
      primaryEntityId: SERVICE_ID,
      serviceMap: maps.serviceMap,
      entityNameMap: NAME_MAP,
    });
    expect(display.name).toBe("checkout-api");
    expect(display.color?.toLowerCase()).toBe("#ff0000");
    expect(display.typeLabel).toBeUndefined();
  });

  test("regression: a RUM application's log shows the application name, not its UUID", () => {
    const display: LogEntityDisplay = getLogEntityDisplay({
      primaryEntityId: RUM_ID,
      serviceMap: maps.serviceMap,
      entityNameMap: NAME_MAP,
    });
    expect(display).toEqual({
      name: "checkout-web",
      color: undefined,
      typeLabel: "RUM Application",
    });
  });

  test("falls back to the id when nothing names it, and to undefined without an id", () => {
    expect(
      getLogEntityDisplay({
        primaryEntityId: MISSING_ID,
        serviceMap: maps.serviceMap,
        entityNameMap: NAME_MAP,
      }).name,
    ).toBe(MISSING_ID);
    expect(
      getLogEntityDisplay({
        primaryEntityId: RUM_ID,
        serviceMap: maps.serviceMap,
      }).name,
    ).toBe(RUM_ID);
    expect(
      getLogEntityDisplay({
        primaryEntityId: "",
        serviceMap: maps.serviceMap,
        entityNameMap: NAME_MAP,
      }),
    ).toEqual({ name: undefined, color: undefined, typeLabel: undefined });
    expect(
      getLogEntityDisplay({
        primaryEntityId: undefined,
        serviceMap: maps.serviceMap,
      }).name,
    ).toBeUndefined();
  });

  test("regression: an unhinted log of a preloaded host / cluster shows its name and type, not its UUID", () => {
    expect(
      getLogEntityDisplay({
        primaryEntityId: HOST_ID,
        serviceMap: maps.serviceMap,
        resourceMaps: maps,
        entityNameMap: {},
      }),
    ).toEqual({ name: "ip-10-0-0-1", color: undefined, typeLabel: "Host" });
    expect(
      getLogEntityDisplay({
        primaryEntityId: DOCKER_HOST_ID,
        serviceMap: maps.serviceMap,
        resourceMaps: maps,
      }),
    ).toEqual({
      name: "docker-box-1",
      color: undefined,
      typeLabel: TELEMETRY_ENTITY_TYPES[ServiceType.DockerHost].label,
    });
    expect(
      getLogEntityDisplay({
        primaryEntityId: CLUSTER_ID,
        serviceMap: maps.serviceMap,
        resourceMaps: maps,
      }).typeLabel,
    ).toBe("Kubernetes Cluster");
  });

  test("precedence: preloaded Service, then preloaded resource, then resolver, then id", () => {
    const resolverNamesHost: TelemetryEntityNameMap = {
      [HOST_ID]: {
        id: HOST_ID,
        name: "resolver-host-name",
        entityType: ServiceType.Host,
        typeLabel: "Host",
      },
    };
    expect(
      getLogEntityDisplay({
        primaryEntityId: HOST_ID,
        serviceMap: maps.serviceMap,
        resourceMaps: maps,
        entityNameMap: resolverNamesHost,
      }).name,
    ).toBe("ip-10-0-0-1");
    expect(
      getLogEntityDisplay({
        primaryEntityId: HOST_ID,
        serviceMap: maps.serviceMap,
        entityNameMap: resolverNamesHost,
      }).name,
    ).toBe("resolver-host-name");
    expect(
      getLogEntityDisplay({
        primaryEntityId: HOST_ID,
        serviceMap: { [HOST_ID]: makeService(HOST_ID, "odd-service") },
        resourceMaps: maps,
      }).name,
    ).toBe("odd-service");
    expect(
      getLogEntityDisplay({
        primaryEntityId: RUM_ID,
        serviceMap: maps.serviceMap,
        resourceMaps: maps,
        entityNameMap: NAME_MAP,
      }).name,
    ).toBe("checkout-web");
    expect(
      getLogEntityDisplay({
        primaryEntityId: MISSING_ID,
        serviceMap: maps.serviceMap,
        resourceMaps: maps,
      }),
    ).toEqual({ name: MISSING_ID, color: undefined, typeLabel: undefined });
  });

  test("a Service row without a name falls through to the resolver", () => {
    const display: LogEntityDisplay = getLogEntityDisplay({
      primaryEntityId: SERVICE_ID_NOT_LOADED,
      serviceMap: {
        [SERVICE_ID_NOT_LOADED]: makeService(SERVICE_ID_NOT_LOADED, ""),
      },
      entityNameMap: NAME_MAP,
    });
    expect(display.name).toBe("billing-worker");
    expect(display.typeLabel).toBe("Service");
  });
});

describe("server facet display names", () => {
  test("getServerFacetDisplayName accepts a real name", () => {
    expect(
      getServerFacetDisplayName({
        value: RUM_ID,
        count: 1,
        displayName: "checkout-web",
      }),
    ).toBe("checkout-web");
    expect(
      getServerFacetDisplayName({
        value: RUM_ID,
        count: 1,
        displayName: "  checkout-web ",
      }),
    ).toBe("checkout-web");
  });

  test("getServerFacetDisplayName ignores blanks, id echoes and missing values", () => {
    expect(
      getServerFacetDisplayName({ value: RUM_ID, count: 1 }),
    ).toBeUndefined();
    expect(
      getServerFacetDisplayName({ value: RUM_ID, count: 1, displayName: "" }),
    ).toBeUndefined();
    expect(
      getServerFacetDisplayName({ value: RUM_ID, count: 1, displayName: "  " }),
    ).toBeUndefined();
    expect(
      getServerFacetDisplayName({
        value: RUM_ID,
        count: 1,
        displayName: RUM_ID,
      }),
    ).toBeUndefined();
    expect(getServerFacetDisplayName(undefined)).toBeUndefined();
  });

  test("getFacetValueDisplayLabel: server name, then the display map, then undefined", () => {
    const map: Record<string, string> = { [RUM_ID]: "checkout-web" };
    expect(
      getFacetValueDisplayLabel(
        { value: RUM_ID, count: 1, displayName: "server-name" },
        map,
      ),
    ).toBe("server-name");
    expect(
      getFacetValueDisplayLabel(
        { value: RUM_ID, count: 1, displayName: RUM_ID },
        map,
      ),
    ).toBe("checkout-web");
    expect(
      getFacetValueDisplayLabel(
        { value: RUM_ID, count: 1, displayName: "" },
        map,
      ),
    ).toBe("checkout-web");
    expect(
      getFacetValueDisplayLabel({ value: RUM_ID_2, count: 1 }, map),
    ).toBeUndefined();
    expect(
      getFacetValueDisplayLabel({ value: RUM_ID, count: 1 }, undefined),
    ).toBeUndefined();
    expect(
      getFacetValueDisplayLabel({ value: RUM_ID, count: 1 }, { [RUM_ID]: " " }),
    ).toBeUndefined();
  });

  test("an id-echoing displayName does not stop the id being resolved", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      facetData: {
        primaryEntityId: [{ value: RUM_ID, count: 1, displayName: RUM_ID }],
      },
      suggestionIds: [RUM_ID_2],
      maps: { serviceMap: {} },
    });
    expect(request.ids).toEqual([RUM_ID, RUM_ID_2].sort());

    const echoedSuggestion: LogsEntityResolutionRequest =
      collectLogsEntityIdsToResolve({
        facetData: {
          primaryEntityId: [
            { value: RUM_ID_2, count: 1, displayName: RUM_ID_2 },
          ],
        },
        suggestionIds: [RUM_ID_2],
        maps: { serviceMap: {} },
      });
    expect(echoedSuggestion.ids).toEqual([RUM_ID_2]);
  });

  test("suggestion labels skip an id-echoing server displayName in favour of the resolver", () => {
    const result: PrimaryEntitySuggestions = resolvePrimaryEntitySuggestions({
      ids: [RUM_ID],
      facetValues: [{ value: RUM_ID, count: 1, displayName: RUM_ID }],
      serviceMap: {},
      entityNameMap: NAME_MAP,
    });
    expect(result.labels).toEqual(["checkout-web"]);
    expect(result.labelToId).toEqual({ "checkout-web": RUM_ID });
  });
});

describe("facet display maps", () => {
  test("buildEntityNameDisplayMap flattens a name map", () => {
    expect(buildEntityNameDisplayMap(undefined)).toEqual({});
    expect(buildEntityNameDisplayMap({ [RUM_ID]: NAME_MAP[RUM_ID]! })).toEqual({
      [RUM_ID]: "checkout-web",
    });
  });

  test("mergeFacetValueDisplayMap lets the preloaded map win over resolver names", () => {
    const merged: Record<string, string> = mergeFacetValueDisplayMap(
      { [SERVICE_ID]: "checkout-api", [RUM_ID]: "loaded-name" },
      NAME_MAP,
    );
    expect(merged[SERVICE_ID]).toBe("checkout-api");
    expect(merged[RUM_ID]).toBe("loaded-name");
    expect(merged[RUM_ID_2]).toBe("marketing-site");
    expect(mergeFacetValueDisplayMap(undefined, undefined)).toEqual({});
  });
});

describe("resolvePrimaryEntitySuggestions", () => {
  const maps: LogsEntityLookupMaps = makeMaps();

  test("labels prefer server displayName, then serviceMap, then the resolver, then the id", () => {
    const result: PrimaryEntitySuggestions = resolvePrimaryEntitySuggestions({
      ids: [SERVICE_ID, RUM_ID, RUM_ID_2, MISSING_ID],
      facetValues: [
        { value: SERVICE_ID, count: 1, displayName: "checkout-api (server)" },
        { value: RUM_ID_2, count: 1, displayName: "" },
      ],
      serviceMap: maps.serviceMap,
      entityNameMap: NAME_MAP,
    });
    expect(result.labels).toEqual([
      "checkout-api (server)",
      "checkout-web",
      "marketing-site",
      MISSING_ID,
    ]);
    expect(result.labelToId).toEqual({
      "checkout-api (server)": SERVICE_ID,
      "checkout-web": RUM_ID,
      "marketing-site": RUM_ID_2,
      [MISSING_ID]: MISSING_ID,
    });
  });

  /*
   * Every label must pick exactly its own id: the filter is built from the
   * id the picked label maps back to.
   */
  const expectRoundTrip: (
    ids: Array<string>,
    result: PrimaryEntitySuggestions,
  ) => void = (ids: Array<string>, result: PrimaryEntitySuggestions): void => {
    expect(result.labels).toHaveLength(ids.length);
    const lowerLabels: Set<string> = new Set(
      result.labels.map((label: string): string => {
        return label.toLowerCase();
      }),
    );
    expect(lowerLabels.size).toBe(ids.length);
    result.labels.forEach((label: string, index: number) => {
      expect(result.labelToId[label.toLowerCase()]).toBe(ids[index]);
    });
  };

  test("regression: same-type names that differ only in case no longer map both labels to the first id", () => {
    const ids: Array<string> = [RUM_ID, RUM_ID_2];
    const result: PrimaryEntitySuggestions = resolvePrimaryEntitySuggestions({
      ids,
      serviceMap: {},
      entityNameMap: {
        [RUM_ID]: { ...NAME_MAP[RUM_ID]!, name: "Web" },
        [RUM_ID_2]: { ...NAME_MAP[RUM_ID_2]!, name: "web" },
      },
    });
    // Same type too, so "web (RUM Application)" would still clash: ids.
    expect(result.labels).toEqual([RUM_ID, RUM_ID_2]);
    expectRoundTrip(ids, result);

    const exact: PrimaryEntitySuggestions = resolvePrimaryEntitySuggestions({
      ids,
      serviceMap: {},
      entityNameMap: {
        [RUM_ID]: { ...NAME_MAP[RUM_ID]!, name: "web" },
        [RUM_ID_2]: { ...NAME_MAP[RUM_ID_2]!, name: "web" },
      },
    });
    expect(exact.labels).toEqual([RUM_ID, RUM_ID_2]);
    expectRoundTrip(ids, exact);
  });

  test("regression: a Service and a RUM application with the same name are two suggestions, qualified by type", () => {
    const ids: Array<string> = [SERVICE_ID, RUM_ID, RUM_ID_2];
    const result: PrimaryEntitySuggestions = resolvePrimaryEntitySuggestions({
      ids,
      serviceMap: maps.serviceMap,
      entityNameMap: {
        [RUM_ID]: { ...NAME_MAP[RUM_ID]!, name: "Checkout-API" },
        [RUM_ID_2]: NAME_MAP[RUM_ID_2]!,
      },
    });
    expect(result.labels).toEqual([
      "checkout-api (Service)",
      "Checkout-API (RUM Application)",
      "marketing-site",
    ]);
    expect(result.labelToId).toEqual({
      "checkout-api (service)": SERVICE_ID,
      "checkout-api (rum application)": RUM_ID,
      "marketing-site": RUM_ID_2,
    });
    // The bare shared name is no longer claimed by either entity.
    expect(result.labelToId["checkout-api"]).toBeUndefined();
    expectRoundTrip(ids, result);
  });

  test("a preloaded host is labelled from its map and typed for a clash", () => {
    const ids: Array<string> = [HOST_ID, FUNCTION_ID];
    const result: PrimaryEntitySuggestions = resolvePrimaryEntitySuggestions({
      ids,
      serviceMap: maps.serviceMap,
      resourceMaps: maps,
      entityNameMap: {
        [FUNCTION_ID]: { ...NAME_MAP[FUNCTION_ID]!, name: "ip-10-0-0-1" },
      },
    });
    expect(result.labels).toEqual([
      "ip-10-0-0-1 (Host)",
      "ip-10-0-0-1 (Serverless Function)",
    ]);
    expectRoundTrip(ids, result);

    const alone: PrimaryEntitySuggestions = resolvePrimaryEntitySuggestions({
      ids: [HOST_ID],
      serviceMap: maps.serviceMap,
      resourceMaps: maps,
    });
    expect(alone.labels).toEqual(["ip-10-0-0-1"]);
    expect(alone.labelToId).toEqual({ "ip-10-0-0-1": HOST_ID });
  });

  test("a clash with no known type, or whose qualified label is already taken, falls back to the id", () => {
    const unknownType: Array<string> = [RUM_ID, RUM_ID_2];
    const untyped: PrimaryEntitySuggestions = resolvePrimaryEntitySuggestions({
      ids: unknownType,
      facetValues: [
        { value: RUM_ID, count: 1, displayName: "checkout" },
        { value: RUM_ID_2, count: 1, displayName: "checkout" },
      ],
      serviceMap: {},
      entityNameMap: { [RUM_ID]: NAME_MAP[RUM_ID]! },
    });
    // RUM_ID's type is known from the resolver; RUM_ID_2's is not.
    expect(untyped.labels).toEqual(["checkout (RUM Application)", RUM_ID_2]);
    expectRoundTrip(unknownType, untyped);

    const taken: Array<string> = [SERVICE_ID, RUM_ID, FUNCTION_ID];
    const result: PrimaryEntitySuggestions = resolvePrimaryEntitySuggestions({
      ids: taken,
      serviceMap: maps.serviceMap,
      entityNameMap: {
        [RUM_ID]: { ...NAME_MAP[RUM_ID]!, name: "checkout-api" },
        // Really called what the Service's qualified label would be.
        [FUNCTION_ID]: {
          ...NAME_MAP[FUNCTION_ID]!,
          name: "Checkout-API (Service)",
        },
      },
    });
    expect(result.labels).toEqual([
      SERVICE_ID,
      "checkout-api (RUM Application)",
      "Checkout-API (Service)",
    ]);
    expectRoundTrip(taken, result);
  });

  test("a repeated id yields a single suggestion", () => {
    const result: PrimaryEntitySuggestions = resolvePrimaryEntitySuggestions({
      ids: [RUM_ID, RUM_ID],
      serviceMap: {},
      entityNameMap: NAME_MAP,
    });
    expect(result.labels).toEqual(["checkout-web"]);
    expectRoundTrip([RUM_ID], result);
  });

  test("empty input gives empty output", () => {
    expect(
      resolvePrimaryEntitySuggestions({ ids: [], serviceMap: {} }),
    ).toEqual({ labels: [], labelToId: {} });
  });
});

describe("analytics helpers", () => {
  test("entity dimensions are the resource facet keys", () => {
    for (const key of [
      "primaryEntityId",
      "serviceId",
      "hostId",
      "dockerHostId",
      "podmanHostId",
      "kubernetesClusterId",
    ]) {
      expect(isAnalyticsEntityDimension(key)).toBe(true);
    }
    for (const key of ["severityText", "traceId", "spanId", "http.method"]) {
      expect(isAnalyticsEntityDimension(key)).toBe(false);
    }
  });

  test("collectAnalyticsEntityIds reads entity dimensions of grouped rows only", () => {
    const request: LogsEntityResolutionRequest = collectAnalyticsEntityIds({
      groupByFields: ["primaryEntityId", "severityText"],
      groupedRows: [
        { groupValues: { primaryEntityId: RUM_ID, severityText: "Error" } },
        {
          groupValues: {
            primaryEntityId: SERVICE_ID,
            severityText: MISSING_ID,
          },
        },
        { groupValues: { primaryEntityId: "", severityText: "Info" } },
        { groupValues: { primaryEntityId: RUM_ID, severityText: "Info" } },
      ],
    });
    expect(request.ids).toEqual([RUM_ID, SERVICE_ID].sort());
    expect(request.typeHints).toEqual({});
  });

  test("regression: collectAnalyticsEntityIds reads each grouped row by its own keys, not the last fetch's group-by", () => {
    /*
     * The table was last fetched grouped by severity, but the timeseries
     * rows still on screen (from before the chart-type switch) are grouped
     * by entity; their ids must stay requested or the legend drops to UUIDs.
     */
    const request: LogsEntityResolutionRequest = collectAnalyticsEntityIds({
      groupByFields: ["severityText"],
      groupedRows: [
        { groupValues: { primaryEntityId: RUM_ID } },
        { groupValues: { hostId: HOST_ID, severityText: "Error" } },
        { groupValues: { "http.method": RUM_ID_2 } },
        { groupValues: undefined as unknown as Record<string, string> },
      ],
    });
    expect(request.ids).toEqual([RUM_ID, HOST_ID].sort());
    expect(request.typeHints).toEqual({ [HOST_ID]: ServiceType.Host });
  });

  test("collectAnalyticsEntityIds reads top list values against the first dimension, with hints for typed keys", () => {
    const request: LogsEntityResolutionRequest = collectAnalyticsEntityIds({
      groupByFields: ["hostId"],
      topListItems: [{ value: HOST_ID }, { value: "not-an-id" }],
    });
    expect(request.ids).toEqual([HOST_ID]);
    expect(request.typeHints).toEqual({ [HOST_ID]: ServiceType.Host });

    expect(
      collectAnalyticsEntityIds({
        groupByFields: ["severityText"],
        topListItems: [{ value: RUM_ID }],
      }).ids,
    ).toEqual([]);
    expect(
      collectAnalyticsEntityIds({
        groupByFields: [],
        topListItems: [{ value: RUM_ID }],
      }).ids,
    ).toEqual([]);
  });

  test("getAnalyticsGroupValueLabel names entity values and leaves everything else alone", () => {
    expect(
      getAnalyticsGroupValueLabel("primaryEntityId", RUM_ID, NAME_MAP),
    ).toBe("checkout-web");
    expect(
      getAnalyticsGroupValueLabel("primaryEntityId", MISSING_ID, NAME_MAP),
    ).toBe(MISSING_ID);
    expect(getAnalyticsGroupValueLabel("severityText", RUM_ID, NAME_MAP)).toBe(
      RUM_ID,
    );
    expect(getAnalyticsGroupValueLabel(undefined, RUM_ID, NAME_MAP)).toBe(
      RUM_ID,
    );
    expect(getAnalyticsGroupValueLabel("primaryEntityId", "", NAME_MAP)).toBe(
      "",
    );
  });

  test("getAnalyticsDimensionLabel gives friendly headers instead of raw column names", () => {
    expect(
      getAnalyticsDimensionLabel("severityText", ["Error"], NAME_MAP),
    ).toBe("Severity");
    expect(getAnalyticsDimensionLabel("traceId", [], NAME_MAP)).toBe(
      "Trace ID",
    );
    expect(getAnalyticsDimensionLabel("http.method", ["GET"], NAME_MAP)).toBe(
      "http.method",
    );
    expect(getAnalyticsDimensionLabel("hostId", [HOST_ID], NAME_MAP)).toBe(
      "Host",
    );
    expect(ANALYTICS_DIMENSION_LABELS["primaryEntityId"]).toBe("Service");
  });

  test("getAnalyticsDimensionLabel uses the shared entity type when every value resolved to it", () => {
    expect(
      getAnalyticsDimensionLabel(
        "primaryEntityId",
        [RUM_ID, RUM_ID_2, ""],
        NAME_MAP,
      ),
    ).toBe("RUM Application");
  });

  test("getAnalyticsDimensionLabel keeps 'Service' for mixed, partly resolved or empty sets", () => {
    expect(
      getAnalyticsDimensionLabel(
        "primaryEntityId",
        [RUM_ID, SERVICE_ID_NOT_LOADED],
        NAME_MAP,
      ),
    ).toBe("Service");
    expect(
      getAnalyticsDimensionLabel(
        "primaryEntityId",
        [RUM_ID, MISSING_ID],
        NAME_MAP,
      ),
    ).toBe("Service");
    expect(getAnalyticsDimensionLabel("primaryEntityId", [], NAME_MAP)).toBe(
      "Service",
    );
    expect(
      getAnalyticsDimensionLabel("primaryEntityId", [RUM_ID], undefined),
    ).toBe("Service");
  });

  test("getAnalyticsSeriesLabel names each entity part of a joined series", () => {
    expect(
      getAnalyticsSeriesLabel(
        { primaryEntityId: RUM_ID, severityText: "Error" },
        NAME_MAP,
      ),
    ).toBe("checkout-web / Error");
    expect(getAnalyticsSeriesLabel({}, NAME_MAP)).toBe("");
  });
});

/*
 * The viewer preloads Host / Docker host / Podman host / Kubernetes cluster
 * maps only. Every other catalog resource type (Proxmox, vCenter, Ceph,
 * Docker Swarm, serverless, cloud, RUM, IoT) is on screen now as a facet and
 * a chip, so its ids must fall through to the generic resolver — hinted
 * straight to their own table — and come back as names, never raw UUIDs.
 */
describe("catalog resource types the viewer does not preload", () => {
  const maps: LogsEntityLookupMaps = makeMaps();

  const PRELOADED_KEYS: Array<string> = [
    "hostId",
    "dockerHostId",
    "podmanHostId",
    "kubernetesClusterId",
  ];

  const unpreloaded: Array<ResourceFacetDefinition> =
    RESOURCE_FACET_CATALOG.filter(
      (definition: ResourceFacetDefinition): boolean => {
        return !PRELOADED_KEYS.includes(definition.facetKey);
      },
    );

  // One distinct id and resolver answer per type.
  const idFor: (index: number) => string = (index: number): string => {
    return `abcdef${String(index).padStart(2, "0")}-0000-4000-8000-000000000001`;
  };

  const resolvedNameMap: TelemetryEntityNameMap = {};
  unpreloaded.forEach((definition: ResourceFacetDefinition, index: number) => {
    resolvedNameMap[idFor(index)] = {
      id: idFor(index),
      name: `${definition.facetKey}-name`,
      entityType: definition.serviceType,
      typeLabel: TELEMETRY_ENTITY_TYPES[definition.serviceType].label,
    };
  });

  const cases: Array<[string, ResourceFacetDefinition, string]> =
    unpreloaded.map(
      (
        definition: ResourceFacetDefinition,
        index: number,
      ): [string, ResourceFacetDefinition, string] => {
        return [definition.facetKey, definition, idFor(index)];
      },
    );

  test("are exactly the eight new catalog types", () => {
    expect(
      unpreloaded.map((definition: ResourceFacetDefinition): string => {
        return definition.facetKey;
      }),
    ).toEqual([
      "dockerSwarmClusterId",
      "proxmoxClusterId",
      "vmwareVCenterId",
      "cephClusterId",
      "serverlessFunctionId",
      "cloudResourceId",
      "rumApplicationId",
      "iotFleetId",
    ]);
  });

  test.each(cases)(
    "%s has no preloaded name, even for an id a preloaded map holds",
    (facetKey: string, _definition: ResourceFacetDefinition, id: string) => {
      expect(getLoadedLogsEntityName(facetKey, id, maps)).toBeUndefined();
      // HOST_ID is in hostMap, but a Proxmox chip is not a host chip.
      expect(getLoadedLogsEntityName(facetKey, HOST_ID, maps)).toBeUndefined();
    },
  );

  test.each(cases)(
    "a %s chip is named by the resolver and keeps its facet label as key",
    (facetKey: string, definition: ResourceFacetDefinition, id: string) => {
      const incoming: ActiveFilter = chip(facetKey, id, definition.label);
      const result: ActiveFilter = enrichLogsActiveFilter(
        incoming,
        maps,
        resolvedNameMap,
      );

      expect(result.displayKey).toBe(definition.label);
      expect(result.displayValue).toBe(`${facetKey}-name`);
      // Display only: the filter still carries the id under its own key.
      expect(result.value).toBe(id);
      expect(result.facetKey).toBe(facetKey);
    },
  );

  test.each(cases)(
    "an unresolved %s chip is left exactly as it came in",
    (facetKey: string, definition: ResourceFacetDefinition, id: string) => {
      const incoming: ActiveFilter = chip(facetKey, id, definition.label);

      expect(enrichLogsActiveFilter(incoming, maps, {})).toBe(incoming);
      expect(enrichLogsActiveFilter(incoming, maps, undefined)).toBe(incoming);
    },
  );

  test.each(cases)(
    "a parent-named %s chip is not overwritten by the resolver",
    (facetKey: string, definition: ResourceFacetDefinition, id: string) => {
      const incoming: ActiveFilter = chip(
        facetKey,
        id,
        definition.label,
        "named by the page",
      );

      expect(enrichLogsActiveFilter(incoming, maps, resolvedNameMap)).toBe(
        incoming,
      );
      expect(
        collectLogsEntityIdsToResolve({ filters: [incoming], maps }).ids,
      ).toEqual([]);
    },
  );

  test.each(cases)(
    "an unnamed %s chip is requested from its own table",
    (facetKey: string, definition: ResourceFacetDefinition, id: string) => {
      const request: LogsEntityResolutionRequest =
        collectLogsEntityIdsToResolve({
          filters: [chip(facetKey, id, definition.label)],
          maps,
        });

      expect(request).toEqual({
        ids: [id],
        typeHints: { [id]: definition.serviceType },
      });
    },
  );

  test.each(cases)(
    "the %s facet's own table wins over a misleading chip key",
    (facetKey: string, definition: ResourceFacetDefinition, id: string) => {
      const request: LogsEntityResolutionRequest =
        collectLogsEntityIdsToResolve({
          filters: [chip(facetKey, id, "Service")],
          maps,
        });

      expect(request.typeHints).toEqual({ [id]: definition.serviceType });
    },
  );

  test.each(cases)(
    "sidebar %s rows the server did not name are requested, hinted to their table",
    (facetKey: string, definition: ResourceFacetDefinition, id: string) => {
      const request: LogsEntityResolutionRequest =
        collectLogsEntityIdsToResolve({
          facetData: {
            [facetKey]: [
              { value: id, count: 0 },
              { value: MISSING_ID, count: 3, displayName: "named-by-server" },
              { value: "not-a-uuid", count: 1 },
            ],
          },
          maps,
        });

      expect(request).toEqual({
        ids: [id],
        typeHints: { [id]: definition.serviceType },
      });
    },
  );

  test("an id that echoes itself as displayName is still requested", () => {
    const id: string = idFor(0);
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      facetData: {
        proxmoxClusterId: [{ value: id, count: 2, displayName: id }],
      },
      maps,
    });

    expect(request.typeHints).toEqual({ [id]: ServiceType.ProxmoxCluster });
  });

  test("one request covers every new facet at once, each id hinted to its own table", () => {
    const facetData: Record<
      string,
      Array<{ value: string; count: number }>
    > = {};
    const expectedHints: Record<string, ServiceType> = {};

    for (const [facetKey, definition, id] of cases) {
      facetData[facetKey] = [{ value: id, count: 1 }];
      expectedHints[id] = definition.serviceType;
    }

    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      facetData,
      maps,
    });

    expect(request.ids).toEqual(
      cases
        .map((entry: [string, ResourceFacetDefinition, string]): string => {
          return entry[2];
        })
        .sort(),
    );
    expect(request.typeHints).toEqual(expectedHints);
  });

  test("an IoT fleet id is hinted IoTDevice — the type fleet telemetry is stamped with", () => {
    const id: string = idFor(7);
    expect(
      collectLogsEntityIdsToResolve({
        filters: [chip("iotFleetId", id, "IoT Fleet")],
        maps,
      }).typeHints,
    ).toEqual({ [id]: ServiceType.IoTDevice });
    expect(TELEMETRY_ENTITY_TYPES[ServiceType.IoTDevice].label).toBe(
      "IoT Fleet",
    );
  });

  test("the preloaded four still skip the resolver when their maps name them", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      filters: [
        chip("hostId", HOST_ID, "Host"),
        chip("dockerHostId", DOCKER_HOST_ID, "Docker Host"),
        chip("podmanHostId", PODMAN_HOST_ID, "Podman Host"),
        chip("kubernetesClusterId", CLUSTER_ID, "Kubernetes Cluster"),
      ],
      facetData: {
        hostId: [{ value: HOST_ID, count: 1 }],
        kubernetesClusterId: [{ value: CLUSTER_ID, count: 1 }],
      },
      maps,
    });

    expect(request).toEqual({ ids: [], typeHints: {} });
  });

  test("findLoadedLogsResourceEntity still probes the preloaded maps first, in catalog order", () => {
    const sharedId: string = HOST_ID;
    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster.id = new ObjectID(sharedId);
    cluster.name = "cluster-with-host-id";

    const found: LoadedLogsResourceEntity | undefined =
      findLoadedLogsResourceEntity(sharedId, {
        hostMap: { [sharedId]: makeHost(sharedId, "host-first") },
        kubernetesClusterMap: { [sharedId]: cluster },
      });

    expect(found).toEqual({
      name: "host-first",
      entityType: ServiceType.Host,
      typeLabel: "Host",
    });
    // A new-type id is never "found" locally; it goes to the resolver.
    expect(findLoadedLogsResourceEntity(idFor(0), maps)).toBeUndefined();
  });

  test.each(cases)(
    "analytics rows grouped by %s are requested with their table hint",
    (facetKey: string, definition: ResourceFacetDefinition, id: string) => {
      expect(isAnalyticsEntityDimension(facetKey)).toBe(true);

      const grouped: LogsEntityResolutionRequest = collectAnalyticsEntityIds({
        groupByFields: [facetKey],
        groupedRows: [{ groupValues: { [facetKey]: id } }],
      });
      expect(grouped).toEqual({
        ids: [id],
        typeHints: { [id]: definition.serviceType },
      });

      const topList: LogsEntityResolutionRequest = collectAnalyticsEntityIds({
        groupByFields: [facetKey],
        topListItems: [{ value: id }],
      });
      expect(topList.typeHints).toEqual({ [id]: definition.serviceType });

      expect(getAnalyticsGroupValueLabel(facetKey, id, resolvedNameMap)).toBe(
        `${facetKey}-name`,
      );
    },
  );
});

describe("ANALYTICS_DIMENSION_LABELS for resource facets", () => {
  test("keeps the non-resource labels", () => {
    expect(ANALYTICS_DIMENSION_LABELS).toMatchObject({
      severityText: "Severity",
      primaryEntityId: "Service",
      serviceId: "Service",
      traceId: "Trace ID",
      spanId: "Span ID",
    });
  });

  test.each(
    RESOURCE_FACET_CATALOG.map(
      (definition: ResourceFacetDefinition): [string, string] => {
        return [definition.facetKey, definition.label];
      },
    ),
  )("%s reads %p", (facetKey: string, label: string) => {
    expect(ANALYTICS_DIMENSION_LABELS[facetKey]).toBe(label);
    // A typed resource dimension keeps its own label, whatever resolved.
    expect(getAnalyticsDimensionLabel(facetKey, [RUM_ID], NAME_MAP)).toBe(
      label,
    );
    expect(getAnalyticsDimensionLabel(facetKey, [], undefined)).toBe(label);
  });
});
