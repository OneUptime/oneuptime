/*
 * The metrics explorer's chips name the entity the list is scoped to. That
 * entity id is polymorphic — a RUM application page passes its
 * RumApplication id, a host page its Host id — and the chips used to resolve
 * it against the Service table only, so a RUM page's Metrics tab read
 * "Service: 84858d6c-…". These tests pin the display rules (name + type key
 * for every entity chip, existing name sources first) and that the filter
 * values themselves never change.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import TelemetryEntityNameResolver, {
  TelemetryEntityNameMap,
} from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
} from "Common/UI/Components/TelemetryViewer/types";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import Service from "Common/Models/DatabaseModels/Service";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import {
  RESOURCE_FACET_CATALOG,
  RESOURCE_FACET_CATALOG_KEYS,
  ResourceFacetDefinition,
} from "Common/Types/Telemetry/ResourceFacetCatalog";
import {
  METRICS_POLYMORPHIC_ENTITY_FACET_KEYS,
  METRICS_TYPED_ENTITY_FACET_KEYS,
  MetricsEntityLookup,
  buildMetricsActiveFilterChips,
  buildMetricsIncludedFacetChip,
  buildMetricsLockedAttributeChips,
  buildMetricsLockedScopeChips,
  collectMetricsEntityLookup,
  getFacetValueDisplayName,
  getMetricsAppliedEntityFilterIds,
  getMetricsScopeFallbackLabel,
  getMetricsTypedEntityFacetType,
  getMetricsUnnamedScopeIds,
  isMetricsEntityFacetKey,
  isMetricsPolymorphicEntityFacetKey,
  resolveMetricsChipDisplay,
} from "../../FeatureSet/Dashboard/src/Utils/MetricsEntityChipDisplay";
import {
  ENTITY_KEY_NO_ATTRIBUTES_REASON,
  METRICS_SERVICE_NO_SYNTAX_REASON,
  describeLockedEntityKeyFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";
import {
  LockedEntityKeyDisplay,
  LockedEntityKeyDisplayMap,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import { buildInventoryEntityKeyDisplays } from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryTelemetryScope";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  SERVICE_FACET_KEYS,
  RESOURCE_ENTITY_FACET_KEYS,
} from "Common/Types/Telemetry/ResourceEntityFacet";
import {
  TelemetryScopeSelection,
  splitTelemetryScopeFilters,
} from "../../FeatureSet/Dashboard/src/Utils/TelemetryTabScope";
import { beforeEach, describe, expect, test } from "@jest/globals";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const RUM_APP_ID: string = "84858d6c-2222-4222-8222-222222222222";
const SERVICE_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_SERVICE_ID: string = "44444444-4444-4444-8444-444444444444";
const HOST_ID: string = "55555555-5555-4555-8555-555555555555";
const CLUSTER_ID: string = "66666666-6666-4666-8666-666666666666";
const DOCKER_HOST_ID: string = "77777777-7777-4777-8777-777777777777";
const PODMAN_HOST_ID: string = "88888888-8888-4888-8888-888888888888";
const PROXMOX_CLUSTER_ID: string = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const IOT_FLEET_ID: string = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const SERVICE_FACET_CONFIG: FacetConfig = {
  key: "primaryEntityId",
  title: "Service",
  valueDisplayMap: { [SERVICE_ID]: "checkout-api" },
  priority: 1,
  serverSearchable: true,
};

type EntityFunction = (
  id: string,
  name: string,
  entityType: ServiceType,
  typeLabel: string,
) => TelemetryEntityNameMap;

const entity: EntityFunction = (
  id: string,
  name: string,
  entityType: ServiceType,
  typeLabel: string,
): TelemetryEntityNameMap => {
  return { [id]: { id, name, entityType, typeLabel } };
};

const RUM_NAME_MAP: TelemetryEntityNameMap = entity(
  RUM_APP_ID,
  "checkout-web",
  ServiceType.RealUserMonitor,
  "RUM Application",
);

type UrlChipFunction = (facetKey: string, value: string) => ActiveFilter;

// A chip as readInitialUrlState / applySavedViewState build it.
const restoredChip: UrlChipFunction = (
  facetKey: string,
  value: string,
): ActiveFilter => {
  return { facetKey, value, displayKey: facetKey, displayValue: value };
};

describe("entity facet key registry", () => {
  test("primaryEntityId and its legacy alias serviceId are polymorphic", () => {
    expect(METRICS_POLYMORPHIC_ENTITY_FACET_KEYS).toEqual([
      "primaryEntityId",
      "serviceId",
    ]);
    expect(isMetricsPolymorphicEntityFacetKey("primaryEntityId")).toBe(true);
    expect(isMetricsPolymorphicEntityFacetKey("serviceId")).toBe(true);
    expect(isMetricsPolymorphicEntityFacetKey("hostId")).toBe(false);
    expect(isMetricsPolymorphicEntityFacetKey("attributes.serviceId")).toBe(
      false,
    );
  });

  test("each resource-id key maps to its own table", () => {
    /*
     * Spelled out rather than rebuilt from the catalog, so a catalog edit
     * that re-points a key at the wrong table fails here. IoT fleet
     * telemetry is stamped IoTDevice, and a RUM application RealUserMonitor.
     */
    expect(METRICS_TYPED_ENTITY_FACET_KEYS).toEqual({
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
      databaseServerId: ServiceType.DatabaseServer,
    });
    expect(getMetricsTypedEntityFacetType("hostId")).toBe(ServiceType.Host);
    expect(getMetricsTypedEntityFacetType("primaryEntityId")).toBeUndefined();
    // Object.prototype members are not facet keys.
    expect(getMetricsTypedEntityFacetType("toString")).toBeUndefined();
    expect(getMetricsTypedEntityFacetType("constructor")).toBeUndefined();
  });

  test("REGRESSION: every resource facet another explorer offers is a typed key here", () => {
    /*
     * A Traces / Logs / Exceptions link can now carry a Proxmox, vCenter,
     * Ceph, Swarm, Serverless, Cloud, RUM or IoT chip; untyped, it would read
     * "proxmoxClusterId: <uuid>" in the Metrics chip bar.
     */
    expect(Object.keys(METRICS_TYPED_ENTITY_FACET_KEYS)).toEqual([
      ...RESOURCE_FACET_CATALOG_KEYS,
    ]);
    for (const definition of RESOURCE_FACET_CATALOG) {
      expect(getMetricsTypedEntityFacetType(definition.facetKey)).toBe(
        definition.serviceType,
      );
      expect(isMetricsPolymorphicEntityFacetKey(definition.facetKey)).toBe(
        false,
      );
    }
  });

  test("isMetricsEntityFacetKey covers both groups and nothing else", () => {
    for (const key of [
      "primaryEntityId",
      "serviceId",
      "hostId",
      "dockerHostId",
      "podmanHostId",
      "kubernetesClusterId",
      "dockerSwarmClusterId",
      "proxmoxClusterId",
      "vmwareVCenterId",
      "cephClusterId",
      "serverlessFunctionId",
      "cloudResourceId",
      "rumApplicationId",
      "iotFleetId",
      "databaseServerId",
    ]) {
      expect(isMetricsEntityFacetKey(key)).toBe(true);
    }
    for (const key of ["name", "attributes.host.name", "severityText", ""]) {
      expect(isMetricsEntityFacetKey(key)).toBe(false);
    }
  });
});

describe("collectMetricsEntityLookup", () => {
  test("hints the page's scope ids with the page's scope type", () => {
    const lookup: MetricsEntityLookup = collectMetricsEntityLookup({
      scopeIds: [new ObjectID(RUM_APP_ID)],
      scopeEntityType: ServiceType.RealUserMonitor,
      filters: [],
    });
    expect(lookup).toEqual({
      ids: [RUM_APP_ID],
      typeHints: { [RUM_APP_ID]: ServiceType.RealUserMonitor },
    });
  });

  test("leaves scope ids unhinted when the page does not say what they are", () => {
    const lookup: MetricsEntityLookup = collectMetricsEntityLookup({
      scopeIds: [new ObjectID(SERVICE_ID)],
      scopeEntityType: undefined,
      filters: [],
    });
    expect(lookup).toEqual({ ids: [SERVICE_ID], typeHints: {} });
  });

  test("collects primaryEntityId and serviceId chips without a hint", () => {
    const lookup: MetricsEntityLookup = collectMetricsEntityLookup({
      scopeIds: undefined,
      scopeEntityType: undefined,
      filters: [
        restoredChip("primaryEntityId", SERVICE_ID),
        restoredChip("serviceId", RUM_APP_ID),
      ],
    });
    expect(lookup.ids).toEqual([SERVICE_ID, RUM_APP_ID].sort());
    expect(lookup.typeHints).toEqual({});
  });

  test("hints resource-id chips to their table", () => {
    const lookup: MetricsEntityLookup = collectMetricsEntityLookup({
      scopeIds: [],
      scopeEntityType: undefined,
      filters: [
        restoredChip("hostId", HOST_ID),
        restoredChip("dockerHostId", DOCKER_HOST_ID),
        restoredChip("podmanHostId", PODMAN_HOST_ID),
        restoredChip("kubernetesClusterId", CLUSTER_ID),
      ],
    });
    expect(lookup.ids).toEqual(
      [HOST_ID, DOCKER_HOST_ID, PODMAN_HOST_ID, CLUSTER_ID].sort(),
    );
    expect(lookup.typeHints).toEqual({
      [HOST_ID]: ServiceType.Host,
      [DOCKER_HOST_ID]: ServiceType.DockerHost,
      [PODMAN_HOST_ID]: ServiceType.PodmanHost,
      [CLUSTER_ID]: ServiceType.KubernetesCluster,
    });
  });

  test("ignores attribute and unrelated chips", () => {
    const lookup: MetricsEntityLookup = collectMetricsEntityLookup({
      scopeIds: undefined,
      scopeEntityType: undefined,
      filters: [
        restoredChip("attributes.primaryEntityId", SERVICE_ID),
        restoredChip("attributes.host.name", "web-1"),
        restoredChip("name", HOST_ID),
      ],
    });
    expect(lookup).toEqual({ ids: [], typeHints: {} });
  });

  test("de-duplicates and sorts so identical sets produce one lookup key", () => {
    const lookup: MetricsEntityLookup = collectMetricsEntityLookup({
      scopeIds: [new ObjectID(SERVICE_ID), SERVICE_ID],
      scopeEntityType: undefined,
      filters: [
        restoredChip("primaryEntityId", OTHER_SERVICE_ID),
        restoredChip("primaryEntityId", SERVICE_ID),
        restoredChip("serviceId", ` ${OTHER_SERVICE_ID} `),
      ],
    });
    expect(lookup.ids).toEqual([SERVICE_ID, OTHER_SERVICE_ID].sort());
  });

  test("skips values that are not UUIDs so one bad link cannot fail the batch", () => {
    const lookup: MetricsEntityLookup = collectMetricsEntityLookup({
      scopeIds: [""],
      scopeEntityType: ServiceType.Host,
      filters: [
        restoredChip("primaryEntityId", "not-an-id"),
        restoredChip("hostId", "web-1"),
        restoredChip("primaryEntityId", ""),
        restoredChip("primaryEntityId", SERVICE_ID),
      ],
    });
    expect(lookup).toEqual({ ids: [SERVICE_ID], typeHints: {} });
  });

  test("the page's scope hint wins over a chip's key for the same id", () => {
    const lookup: MetricsEntityLookup = collectMetricsEntityLookup({
      scopeIds: [HOST_ID],
      scopeEntityType: ServiceType.DockerHost,
      filters: [restoredChip("hostId", HOST_ID)],
    });
    expect(lookup.typeHints).toEqual({ [HOST_ID]: ServiceType.DockerHost });
  });

  test("handles every input being absent", () => {
    expect(
      collectMetricsEntityLookup({
        scopeIds: undefined,
        scopeEntityType: undefined,
        filters: undefined,
      }),
    ).toEqual({ ids: [], typeHints: {} });
  });
});

describe("getFacetValueDisplayName", () => {
  const facetData: FacetData = {
    primaryEntityId: [
      { value: SERVICE_ID, count: 3, displayName: "  checkout-api  " },
      { value: OTHER_SERVICE_ID, count: 1 },
      { value: RUM_APP_ID, count: 2, displayName: "   " },
    ],
  };

  test("returns the server-resolved name, trimmed", () => {
    expect(
      getFacetValueDisplayName({
        facetData,
        facetKey: "primaryEntityId",
        value: SERVICE_ID,
      }),
    ).toBe("checkout-api");
  });

  test("returns undefined when the server sent no usable name", () => {
    expect(
      getFacetValueDisplayName({
        facetData,
        facetKey: "primaryEntityId",
        value: OTHER_SERVICE_ID,
      }),
    ).toBeUndefined();
    expect(
      getFacetValueDisplayName({
        facetData,
        facetKey: "primaryEntityId",
        value: RUM_APP_ID,
      }),
    ).toBeUndefined();
  });

  test("returns undefined for unknown facets, values and missing data", () => {
    expect(
      getFacetValueDisplayName({
        facetData,
        facetKey: "hostId",
        value: SERVICE_ID,
      }),
    ).toBeUndefined();
    expect(
      getFacetValueDisplayName({
        facetData,
        facetKey: "primaryEntityId",
        value: HOST_ID,
      }),
    ).toBeUndefined();
    expect(
      getFacetValueDisplayName({
        facetData: undefined,
        facetKey: "primaryEntityId",
        value: SERVICE_ID,
      }),
    ).toBeUndefined();
  });
});

describe("buildMetricsIncludedFacetChip", () => {
  test("prefers the loaded service list's name", () => {
    expect(
      buildMetricsIncludedFacetChip({
        facetKey: "primaryEntityId",
        value: SERVICE_ID,
        facetConfigs: [SERVICE_FACET_CONFIG],
        facetData: {
          primaryEntityId: [
            { value: SERVICE_ID, count: 1, displayName: "server-name" },
          ],
        },
      }),
    ).toEqual({
      facetKey: "primaryEntityId",
      value: SERVICE_ID,
      displayKey: "Service",
      displayValue: "checkout-api",
    });
  });

  test("keeps the facet endpoint's display name when the list does not cover the value", () => {
    expect(
      buildMetricsIncludedFacetChip({
        facetKey: "primaryEntityId",
        value: OTHER_SERVICE_ID,
        facetConfigs: [SERVICE_FACET_CONFIG],
        facetData: {
          primaryEntityId: [
            { value: OTHER_SERVICE_ID, count: 1, displayName: "billing" },
          ],
        },
      }),
    ).toEqual({
      facetKey: "primaryEntityId",
      value: OTHER_SERVICE_ID,
      displayKey: "Service",
      displayValue: "billing",
    });
  });

  test("falls back to the raw value when nothing names it", () => {
    const chip: ActiveFilter = buildMetricsIncludedFacetChip({
      facetKey: "primaryEntityId",
      value: OTHER_SERVICE_ID,
      facetConfigs: [SERVICE_FACET_CONFIG],
      facetData: {},
    });
    expect(chip.displayValue).toBe(OTHER_SERVICE_ID);
    expect(chip.value).toBe(OTHER_SERVICE_ID);
  });

  test("an attribute chip displays its bare attribute key", () => {
    expect(
      buildMetricsIncludedFacetChip({
        facetKey: "attributes.container.name",
        value: "postgres",
        facetConfigs: [SERVICE_FACET_CONFIG],
        facetData: undefined,
      }),
    ).toEqual({
      facetKey: "attributes.container.name",
      value: "postgres",
      displayKey: "container.name",
      displayValue: "postgres",
    });
  });

  test("an unconfigured facet keeps its key", () => {
    const chip: ActiveFilter = buildMetricsIncludedFacetChip({
      facetKey: "somethingElse",
      value: "x",
      facetConfigs: undefined,
      facetData: undefined,
    });
    expect(chip.displayKey).toBe("somethingElse");
    expect(chip.displayValue).toBe("x");
  });
});

describe("resolveMetricsChipDisplay — entity id chips", () => {
  test("regression: a RUM application chip shows its name and type, not Service: <uuid>", () => {
    const chip: ActiveFilter = resolveMetricsChipDisplay({
      chip: restoredChip("primaryEntityId", RUM_APP_ID),
      facetConfigs: [],
      nameMap: RUM_NAME_MAP,
    });
    expect(chip.displayKey).toBe("RUM Application");
    expect(chip.displayValue).toBe("checkout-web");
    expect(chip.displayValue).not.toContain(RUM_APP_ID);
    // Display only: the filter value is still the id.
    expect(chip.value).toBe(RUM_APP_ID);
    expect(chip.facetKey).toBe("primaryEntityId");
  });

  test("a URL-restored chip never shows the raw facet key, even before names load", () => {
    const chip: ActiveFilter = resolveMetricsChipDisplay({
      chip: restoredChip("primaryEntityId", RUM_APP_ID),
      facetConfigs: [],
      nameMap: {},
    });
    expect(chip.displayKey).toBe("Service");
    expect(chip.displayValue).toBe(RUM_APP_ID);
  });

  test("the legacy serviceId alias resolves the same way", () => {
    const chip: ActiveFilter = resolveMetricsChipDisplay({
      chip: restoredChip("serviceId", RUM_APP_ID),
      facetConfigs: [],
      nameMap: RUM_NAME_MAP,
    });
    expect(chip.displayKey).toBe("RUM Application");
    expect(chip.displayValue).toBe("checkout-web");
    expect(chip.facetKey).toBe("serviceId");
  });

  test("the loaded service list keeps precedence over the resolver", () => {
    const chip: ActiveFilter = resolveMetricsChipDisplay({
      chip: restoredChip("primaryEntityId", SERVICE_ID),
      facetConfigs: [SERVICE_FACET_CONFIG],
      nameMap: entity(
        SERVICE_ID,
        "resolver-name",
        ServiceType.OpenTelemetry,
        "Service",
      ),
    });
    expect(chip.displayKey).toBe("Service");
    expect(chip.displayValue).toBe("checkout-api");
  });

  test("the serviceId alias borrows the primaryEntityId facet's service names", () => {
    const chip: ActiveFilter = resolveMetricsChipDisplay({
      chip: restoredChip("serviceId", SERVICE_ID),
      facetConfigs: [SERVICE_FACET_CONFIG],
      nameMap: {},
    });
    expect(chip.displayKey).toBe("Service");
    expect(chip.displayValue).toBe("checkout-api");
    expect(chip.facetKey).toBe("serviceId");
  });

  test("a stored facet display name keeps precedence over the resolver", () => {
    const chip: ActiveFilter = resolveMetricsChipDisplay({
      chip: {
        facetKey: "primaryEntityId",
        value: OTHER_SERVICE_ID,
        displayKey: "Service",
        displayValue: "billing",
      },
      facetConfigs: [SERVICE_FACET_CONFIG],
      nameMap: entity(
        OTHER_SERVICE_ID,
        "resolver-name",
        ServiceType.OpenTelemetry,
        "Service",
      ),
    });
    expect(chip.displayValue).toBe("billing");
  });

  test("the resolver covers ids the service list does not", () => {
    const chip: ActiveFilter = resolveMetricsChipDisplay({
      chip: restoredChip("primaryEntityId", HOST_ID),
      facetConfigs: [SERVICE_FACET_CONFIG],
      nameMap: entity(HOST_ID, "web-1", ServiceType.Host, "Host"),
    });
    expect(chip.displayKey).toBe("Host");
    expect(chip.displayValue).toBe("web-1");
  });

  test("the projectId bucket reads Service: Unknown Service", () => {
    const chip: ActiveFilter = resolveMetricsChipDisplay({
      chip: restoredChip("primaryEntityId", PROJECT_ID),
      facetConfigs: [],
      nameMap: entity(
        PROJECT_ID,
        "Unknown Service",
        ServiceType.Unknown,
        "Service",
      ),
    });
    expect(chip.displayKey).toBe("Service");
    expect(chip.displayValue).toBe("Unknown Service");
  });

  test("a locked scope chip takes the page's type label before the name resolves", () => {
    const chip: ActiveFilter = resolveMetricsChipDisplay({
      chip: {
        facetKey: "primaryEntityId",
        value: RUM_APP_ID,
        displayKey: "Service",
        displayValue: RUM_APP_ID,
        readOnly: true,
      },
      facetConfigs: [],
      nameMap: {},
      scopeEntityType: ServiceType.RealUserMonitor,
    });
    expect(chip.displayKey).toBe("RUM Application");
    expect(chip.displayValue).toBe(RUM_APP_ID);
    expect(chip.readOnly).toBe(true);
  });

  test("a locked scope chip's type label wins over what the resolver found", () => {
    const chip: ActiveFilter = resolveMetricsChipDisplay({
      chip: restoredChip("primaryEntityId", HOST_ID),
      facetConfigs: [],
      nameMap: entity(HOST_ID, "web-1", ServiceType.Host, "Host"),
      scopeEntityType: ServiceType.DockerHost,
    });
    expect(chip.displayKey).toBe("Docker Host");
    expect(chip.displayValue).toBe("web-1");
  });
});

describe("resolveMetricsChipDisplay — resource id chips", () => {
  test.each([
    ["hostId", HOST_ID, ServiceType.Host, "Host"],
    ["dockerHostId", DOCKER_HOST_ID, ServiceType.DockerHost, "Docker Host"],
    ["podmanHostId", PODMAN_HOST_ID, ServiceType.PodmanHost, "Podman Host"],
    [
      "kubernetesClusterId",
      CLUSTER_ID,
      ServiceType.KubernetesCluster,
      "Kubernetes Cluster",
    ],
  ])(
    "%s shows a friendly key and the resolved name",
    (facetKey: string, id: string, type: ServiceType, label: string) => {
      const unresolved: ActiveFilter = resolveMetricsChipDisplay({
        chip: restoredChip(facetKey, id),
        facetConfigs: [],
        nameMap: {},
      });
      expect(unresolved.displayKey).toBe(label);
      expect(unresolved.displayKey).not.toBe(facetKey);
      expect(unresolved.displayValue).toBe(id);

      const resolved: ActiveFilter = resolveMetricsChipDisplay({
        chip: restoredChip(facetKey, id),
        facetConfigs: [],
        nameMap: entity(id, "friendly-name", type, label),
      });
      expect(resolved.displayKey).toBe(label);
      expect(resolved.displayValue).toBe("friendly-name");
      expect(resolved.value).toBe(id);
      expect(resolved.facetKey).toBe(facetKey);
    },
  );
});

describe("resolveMetricsChipDisplay — every catalog resource type", () => {
  const RESOURCE_ID: string = "99999999-9999-4999-8999-999999999999";

  test.each(
    RESOURCE_FACET_CATALOG.map(
      (
        definition: ResourceFacetDefinition,
      ): [string, ResourceFacetDefinition] => {
        return [definition.facetKey, definition];
      },
    ),
  )(
    "%s reads its catalog label, is hinted to its table, and is never applied to the list",
    (facetKey: string, definition: ResourceFacetDefinition) => {
      const chip: ActiveFilter = restoredChip(facetKey, RESOURCE_ID);

      const lookup: MetricsEntityLookup = collectMetricsEntityLookup({
        scopeIds: undefined,
        scopeEntityType: undefined,
        filters: [chip],
      });
      expect(lookup).toEqual({
        ids: [RESOURCE_ID],
        typeHints: { [RESOURCE_ID]: definition.serviceType },
      });

      const unresolved: ActiveFilter = resolveMetricsChipDisplay({
        chip,
        facetConfigs: [],
        nameMap: {},
      });
      expect(unresolved.displayKey).toBe(definition.label);
      expect(unresolved.displayValue).toBe(RESOURCE_ID);

      const resolved: ActiveFilter = resolveMetricsChipDisplay({
        chip,
        facetConfigs: [],
        nameMap: entity(
          RESOURCE_ID,
          "friendly-name",
          definition.serviceType,
          definition.label,
        ),
      });
      expect(resolved).toEqual({
        facetKey,
        value: RESOURCE_ID,
        displayKey: definition.label,
        displayValue: "friendly-name",
      });

      // Metrics has no filter path for it: labelled, never applied.
      expect(getMetricsAppliedEntityFilterIds([chip])).toEqual([]);
    },
  );
});

describe("resolveMetricsChipDisplay — other chips are unchanged", () => {
  test("an attribute chip shows the typed value, not its grammar escaping", () => {
    const escaped: ActiveFilter = resolveMetricsChipDisplay({
      chip: restoredChip("attributes.http.method", "(GET OR POST)"),
      facetConfigs: [],
      nameMap: {},
    });
    expect(escaped.displayKey).toBe("http.method");
    expect(escaped.displayValue).toBe("GET OR POST");
    expect(escaped.value).toBe("(GET OR POST)");

    const plain: ActiveFilter = resolveMetricsChipDisplay({
      chip: restoredChip("attributes.container.name", "postgres"),
      facetConfigs: [],
      nameMap: {},
    });
    expect(plain.displayValue).toBe("postgres");
  });

  test("an attribute chip whose value is an entity id is not renamed", () => {
    const chip: ActiveFilter = resolveMetricsChipDisplay({
      chip: restoredChip("attributes.primaryEntityId", RUM_APP_ID),
      facetConfigs: [],
      nameMap: RUM_NAME_MAP,
    });
    expect(chip.displayKey).toBe("primaryEntityId");
    expect(chip.displayValue).toBe(RUM_APP_ID);
  });

  test("a configured non-entity facet uses its title and value map", () => {
    const chip: ActiveFilter = resolveMetricsChipDisplay({
      chip: restoredChip("unit", "ms"),
      facetConfigs: [
        { key: "unit", title: "Unit", valueDisplayMap: { ms: "Milliseconds" } },
      ],
      nameMap: {},
    });
    expect(chip.displayKey).toBe("Unit");
    expect(chip.displayValue).toBe("Milliseconds");
  });

  test("an unconfigured non-entity facet keeps what it carried", () => {
    const chip: ActiveFilter = resolveMetricsChipDisplay({
      chip: {
        facetKey: "unit",
        value: "ms",
        displayKey: "Unit",
        displayValue: "millis",
      },
      facetConfigs: [],
      nameMap: {},
    });
    expect(chip.displayKey).toBe("Unit");
    expect(chip.displayValue).toBe("millis");
  });
});

describe("buildMetricsLockedAttributeChips", () => {
  test("applies display-only key and value overrides", () => {
    expect(
      buildMetricsLockedAttributeChips({
        attributeFilters: { "resource.host.name": "ip-10-0-0-12" },
        attributeFilterDisplayKeys: { "resource.host.name": "Host" },
        attributeFilterDisplayValues: { "resource.host.name": "web-1" },
      }),
    ).toMatchObject([
      {
        facetKey: "attributes.resource.host.name",
        value: "ip-10-0-0-12",
        displayKey: "Host",
        displayValue: "web-1",
        readOnly: true,
        lockedDetail: { searchToken: "@resource.host.name:ip-10-0-0-12" },
      },
    ]);
  });

  test("falls back to the raw key and value without overrides", () => {
    expect(
      buildMetricsLockedAttributeChips({
        attributeFilters: { "resource.service.name": "api" },
      }),
    ).toEqual([
      {
        facetKey: "attributes.resource.service.name",
        value: "api",
        displayKey: "resource.service.name",
        displayValue: "api",
        readOnly: true,
        lockedDetail: { searchToken: "@resource.service.name:api" },
      },
    ]);
  });

  test("an empty override does not blank the chip", () => {
    const chips: Array<ActiveFilter> = buildMetricsLockedAttributeChips({
      attributeFilters: { "k8s.cluster.name": "prod" },
      attributeFilterDisplayKeys: { "k8s.cluster.name": "" },
      attributeFilterDisplayValues: { "k8s.cluster.name": "" },
    });
    expect(chips[0]!.displayKey).toBe("k8s.cluster.name");
    expect(chips[0]!.displayValue).toBe("prod");
    expect(chips[0]!.lockedDetail).toEqual({
      searchToken: "@k8s.cluster.name:prod",
    });
  });

  test("an override for a different key is ignored", () => {
    const chips: Array<ActiveFilter> = buildMetricsLockedAttributeChips({
      attributeFilters: { a: "1" },
      attributeFilterDisplayValues: { b: "Named" },
    });
    expect(chips[0]!.displayValue).toBe("1");
    expect(chips[0]!.lockedDetail).toEqual({ searchToken: "@a:1" });
  });

  test("skips empty filter values and handles no filters", () => {
    expect(
      buildMetricsLockedAttributeChips({
        attributeFilters: { a: "", b: "2" },
      }).map((chip: ActiveFilter): [string, LockedFilterDetail | undefined] => {
        return [chip.facetKey, chip.lockedDetail];
      }),
    ).toEqual([["attributes.b", { searchToken: "@b:2" }]]);
    expect(
      buildMetricsLockedAttributeChips({ attributeFilters: undefined }),
    ).toEqual([]);
  });
});

describe("buildMetricsLockedScopeChips", () => {
  test("RUM page: key is RUM Application from the first render, value the name once resolved", () => {
    const before: Array<ActiveFilter> = buildMetricsLockedScopeChips({
      scopeIds: [new ObjectID(RUM_APP_ID)],
      scopeEntityType: ServiceType.RealUserMonitor,
      facetConfigs: [],
      nameMap: {},
    });
    expect(before).toEqual([
      {
        facetKey: "primaryEntityId",
        value: RUM_APP_ID,
        displayKey: "RUM Application",
        displayValue: RUM_APP_ID,
        readOnly: true,
        lockedDetail: {
          searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON,
        },
      },
    ]);

    const after: Array<ActiveFilter> = buildMetricsLockedScopeChips({
      scopeIds: [new ObjectID(RUM_APP_ID)],
      scopeEntityType: ServiceType.RealUserMonitor,
      facetConfigs: [],
      nameMap: RUM_NAME_MAP,
    });
    expect(after[0]!.displayKey).toBe("RUM Application");
    expect(after[0]!.displayValue).toBe("checkout-web");
  });

  test("Service page behaviour is unchanged: key stays Service", () => {
    const serviceNames: TelemetryEntityNameMap = entity(
      SERVICE_ID,
      "checkout-api",
      ServiceType.OpenTelemetry,
      "Service",
    );
    for (const scopeEntityType of [undefined, ServiceType.OpenTelemetry]) {
      const unresolved: Array<ActiveFilter> = buildMetricsLockedScopeChips({
        scopeIds: [new ObjectID(SERVICE_ID)],
        scopeEntityType,
        facetConfigs: [],
        nameMap: {},
      });
      expect(unresolved[0]!.displayKey).toBe("Service");

      const resolved: Array<ActiveFilter> = buildMetricsLockedScopeChips({
        scopeIds: [new ObjectID(SERVICE_ID)],
        scopeEntityType,
        facetConfigs: [],
        nameMap: serviceNames,
      });
      expect(resolved[0]!.displayKey).toBe("Service");
      expect(resolved[0]!.displayValue).toBe("checkout-api");
      expect(resolved[0]!.lockedDetail).toEqual({
        searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON,
      });
    }
  });

  test("without a scope type the resolved entity's type labels the chip", () => {
    const chips: Array<ActiveFilter> = buildMetricsLockedScopeChips({
      scopeIds: [RUM_APP_ID],
      scopeEntityType: undefined,
      facetConfigs: [],
      nameMap: RUM_NAME_MAP,
    });
    expect(chips[0]!.displayKey).toBe("RUM Application");
    expect(chips[0]!.displayValue).toBe("checkout-web");
  });

  test("one chip per scope id, each read-only, skipping empty ids", () => {
    const chips: Array<ActiveFilter> = buildMetricsLockedScopeChips({
      scopeIds: [SERVICE_ID, "", OTHER_SERVICE_ID],
      scopeEntityType: undefined,
      facetConfigs: [],
      nameMap: {},
    });
    expect(
      chips.map((chip: ActiveFilter): string => {
        return chip.value;
      }),
    ).toEqual([SERVICE_ID, OTHER_SERVICE_ID]);
    for (const chip of chips) {
      expect(chip.readOnly).toBe(true);
      expect(chip.lockedDetail).toEqual({
        searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON,
      });
    }
  });
});

describe("buildMetricsActiveFilterChips", () => {
  test("orders locked scope, locked attributes, then the user's chips", () => {
    const chips: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: [new ObjectID(RUM_APP_ID)],
      scopeEntityType: ServiceType.RealUserMonitor,
      attributeFilters: { "resource.host.name": "ip-10-0-0-12" },
      attributeFilterDisplayKeys: { "resource.host.name": "Host" },
      attributeFilterDisplayValues: { "resource.host.name": "web-1" },
      activeFilters: [
        restoredChip("hostId", HOST_ID),
        restoredChip("attributes.container.name", "postgres"),
      ],
      facetConfigs: [],
      nameMap: {
        ...RUM_NAME_MAP,
        ...entity(HOST_ID, "web-1", ServiceType.Host, "Host"),
      },
    });

    expect(
      chips.map((chip: ActiveFilter): [string, string, boolean] => {
        return [chip.displayKey, chip.displayValue, Boolean(chip.readOnly)];
      }),
    ).toEqual([
      ["RUM Application", "checkout-web", true],
      ["Host", "web-1", true],
      ["Host", "web-1", false],
      ["container.name", "postgres", false],
    ]);

    // Filter semantics are untouched — ids and raw values only.
    expect(
      chips.map((chip: ActiveFilter): [string, string] => {
        return [chip.facetKey, chip.value];
      }),
    ).toEqual([
      ["primaryEntityId", RUM_APP_ID],
      ["attributes.resource.host.name", "ip-10-0-0-12"],
      ["hostId", HOST_ID],
      ["attributes.container.name", "postgres"],
    ]);

    // Only the locked chips carry a search syntax, or the reason for none.
    expect(
      chips.map((chip: ActiveFilter): LockedFilterDetail | undefined => {
        return chip.lockedDetail;
      }),
    ).toEqual([
      { searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON },
      { searchToken: "@resource.host.name:ip-10-0-0-12" },
      undefined,
      undefined,
    ]);
  });

  test("no chip ever displays a raw entity id key or a UUID once names resolve", () => {
    const chips: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: [new ObjectID(RUM_APP_ID)],
      scopeEntityType: ServiceType.RealUserMonitor,
      attributeFilters: undefined,
      activeFilters: [
        restoredChip("primaryEntityId", HOST_ID),
        restoredChip("serviceId", SERVICE_ID),
        restoredChip("kubernetesClusterId", CLUSTER_ID),
      ],
      facetConfigs: [SERVICE_FACET_CONFIG],
      nameMap: {
        ...RUM_NAME_MAP,
        ...entity(HOST_ID, "web-1", ServiceType.Host, "Host"),
        ...entity(
          CLUSTER_ID,
          "prod-eks",
          ServiceType.KubernetesCluster,
          "Kubernetes Cluster",
        ),
      },
    });
    const uuidPattern: RegExp =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const chip of chips) {
      expect(isMetricsEntityFacetKey(chip.displayKey)).toBe(false);
      expect(chip.displayValue).not.toMatch(uuidPattern);
    }
    // The locked scope chip's reason is unchanged by its resolved name.
    expect(chips[0]!.lockedDetail).toEqual({
      searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON,
    });
  });

  test("does not mutate the chips held in state", () => {
    const stateChip: ActiveFilter = restoredChip("primaryEntityId", RUM_APP_ID);
    buildMetricsActiveFilterChips({
      scopeIds: undefined,
      scopeEntityType: undefined,
      attributeFilters: undefined,
      activeFilters: [stateChip],
      facetConfigs: [],
      nameMap: RUM_NAME_MAP,
    });
    expect(stateChip).toEqual(restoredChip("primaryEntityId", RUM_APP_ID));
  });

  test("an unscoped explorer with nothing selected shows no chips", () => {
    expect(
      buildMetricsActiveFilterChips({
        scopeIds: undefined,
        scopeEntityType: undefined,
        attributeFilters: undefined,
        activeFilters: [],
        facetConfigs: [SERVICE_FACET_CONFIG],
        nameMap: {},
      }),
    ).toEqual([]);
  });
});

/*
 * Each locked chip carries the search syntax that reproduces it on the main
 * Metrics page, or the reason it has none. The tokens and reasons themselves
 * are owned by LockedTelemetryScope.test.ts; these pin that the metrics
 * builders attach the right one to the right chip, and that a chip's display
 * text never leaks into its syntax.
 */
describe("locked metrics chips carry their search syntax", () => {
  type DetailOfFunction = (
    chip: ActiveFilter | undefined,
  ) => LockedFilterDetail;

  const detailOf: DetailOfFunction = (
    chip: ActiveFilter | undefined,
  ): LockedFilterDetail => {
    expect(chip).toBeDefined();
    expect(chip!.lockedDetail).toBeDefined();

    return chip!.lockedDetail as LockedFilterDetail;
  };

  test("an attribute chip carries the metrics search token for its attribute", () => {
    const chips: Array<ActiveFilter> = buildMetricsLockedAttributeChips({
      attributeFilters: { "resource.host.name": "ip-10-0-0-12" },
      attributeFilterDisplayKeys: { "resource.host.name": "Host" },
      attributeFilterDisplayValues: { "resource.host.name": "web-1" },
    });

    const detail: LockedFilterDetail = detailOf(chips[0]);

    expect(detail).toEqual({ searchToken: "@resource.host.name:ip-10-0-0-12" });
    expect(detail.searchToken).toBe("@resource.host.name:ip-10-0-0-12");
    expect(detail.searchTokenUnavailableReason).toBeUndefined();
  });

  test("each attribute chip carries the token for its own key and value only", () => {
    const chips: Array<ActiveFilter> = buildMetricsLockedAttributeChips({
      attributeFilters: {
        "resource.k8s.cluster.name": "prod-eks-01",
        "resource.container.runtime": "docker",
      },
    });

    expect(
      chips.map((chip: ActiveFilter): [string, LockedFilterDetail] => {
        return [chip.facetKey, detailOf(chip)];
      }),
    ).toEqual([
      [
        "attributes.resource.k8s.cluster.name",
        { searchToken: "@resource.k8s.cluster.name:prod-eks-01" },
      ],
      [
        "attributes.resource.container.runtime",
        { searchToken: "@resource.container.runtime:docker" },
      ],
    ]);
  });

  test("the display overrides never leak into the search token — it spells the filter, not the label", () => {
    const chips: Array<ActiveFilter> = buildMetricsLockedAttributeChips({
      attributeFilters: { "resource.k8s.cluster.name": "prod-eks-01" },
      attributeFilterDisplayKeys: { "resource.k8s.cluster.name": "Cluster" },
      attributeFilterDisplayValues: {
        "resource.k8s.cluster.name": "production",
      },
    });

    const detail: LockedFilterDetail = detailOf(chips[0]);
    expect(detail).toEqual({
      searchToken: "@resource.k8s.cluster.name:prod-eks-01",
    });
    expect(detail.searchToken).toBe("@resource.k8s.cluster.name:prod-eks-01");
    expect(chips[0]!.displayKey).toBe("Cluster");
    expect(chips[0]!.displayValue).toBe("production");
  });

  test("buildMetricsActiveFilterChips gives the locked attribute chip its token and the user's chip none", () => {
    const chips: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: undefined,
      scopeEntityType: undefined,
      attributeFilters: { "resource.k8s.cluster.name": "prod-eks-01" },
      activeFilters: [restoredChip("attributes.container.name", "postgres")],
      facetConfigs: [],
      nameMap: {},
    });

    expect(detailOf(chips[0])).toEqual({
      searchToken: "@resource.k8s.cluster.name:prod-eks-01",
    });
    // The user's own chip is not a locked one and carries no detail.
    expect(chips[1]!.lockedDetail).toBeUndefined();
  });

  test("a scope chip offers no metrics search token, with the metrics-specific reason, before and after its name resolves", () => {
    const before: Array<ActiveFilter> = buildMetricsLockedScopeChips({
      scopeIds: [new ObjectID(RUM_APP_ID)],
      scopeEntityType: ServiceType.RealUserMonitor,
      facetConfigs: [],
      nameMap: {},
    });

    const unresolved: LockedFilterDetail = detailOf(before[0]);
    expect(unresolved).toEqual({
      searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON,
    });
    // The Metrics search bar matches services by NAME, so no token is offered.
    expect(unresolved.searchToken).toBeUndefined();
    expect(unresolved.searchTokenUnavailableReason).toBe(
      METRICS_SERVICE_NO_SYNTAX_REASON,
    );

    const after: Array<ActiveFilter> = buildMetricsLockedScopeChips({
      scopeIds: [new ObjectID(RUM_APP_ID)],
      scopeEntityType: ServiceType.RealUserMonitor,
      facetConfigs: [],
      nameMap: RUM_NAME_MAP,
    });

    // A resolved name is display only: it is not spelled as a token either.
    expect(detailOf(after[0])).toEqual({
      searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON,
    });
    expect(after[0]!.displayValue).toBe("checkout-web");
  });

  test("a scope chip without a scope type gets the same reason, whatever type it resolves to", () => {
    const chips: Array<ActiveFilter> = buildMetricsLockedScopeChips({
      scopeIds: [RUM_APP_ID],
      scopeEntityType: undefined,
      facetConfigs: [],
      nameMap: RUM_NAME_MAP,
    });

    expect(chips[0]!.displayKey).toBe("RUM Application");
    expect(detailOf(chips[0])).toEqual({
      searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON,
    });

    const serviceChips: Array<ActiveFilter> = buildMetricsLockedScopeChips({
      scopeIds: [SERVICE_ID],
      scopeEntityType: undefined,
      facetConfigs: [],
      nameMap: {},
    });

    expect(serviceChips[0]!.displayKey).toBe("Service");
    expect(detailOf(serviceChips[0])).toEqual({
      searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON,
    });
  });

  test("an attribute key the Metrics search bar cannot type gets the unsafe-key reason, beside a key it can", () => {
    const chips: Array<ActiveFilter> = buildMetricsLockedAttributeChips({
      attributeFilters: { "a:b": "x", "@k": "y", "host name": "web-01" },
    });

    expect(
      chips.map((chip: ActiveFilter): [string, LockedFilterDetail] => {
        return [chip.facetKey, detailOf(chip)];
      }),
    ).toEqual([
      [
        "attributes.a:b",
        {
          searchTokenUnavailableReason:
            "This attribute key cannot be typed into the search bar.",
        },
      ],
      [
        "attributes.@k",
        {
          searchTokenUnavailableReason:
            "This attribute key cannot be typed into the search bar.",
        },
      ],
      [
        "attributes.host name",
        {
          searchTokenUnavailableReason:
            "This attribute key cannot be typed into the search bar.",
        },
      ],
    ]);

    for (const chip of chips) {
      expect(chip.lockedDetail).not.toHaveProperty("searchToken");
    }

    // A safe key on the same page keeps its token.
    expect(
      detailOf(
        buildMetricsLockedAttributeChips({
          attributeFilters: { "a:b": "x", "resource.host.name": "web-01" },
        })[1],
      ),
    ).toStrictEqual({ searchToken: "@resource.host.name:web-01" });
  });

  test("an attribute value the grammar reads specially is quoted or escaped in the metrics token", () => {
    const chips: Array<ActiveFilter> = buildMetricsLockedAttributeChips({
      attributeFilters: {
        "resource.host.name": "web 01",
        "http.route": "/api/*",
        "service.version": "-1.5",
      },
    });

    expect(
      chips.map((chip: ActiveFilter): LockedFilterDetail => {
        return detailOf(chip);
      }),
    ).toEqual([
      { searchToken: '@resource.host.name:"web 01"' },
      { searchToken: "@http.route:/api/\\*" },
      { searchToken: "@service.version:\\-1.5" },
    ]);
  });

  test("a scope chip gets the metrics service reason for any id — a UUID, a legacy id or a name-like value", () => {
    const chips: Array<ActiveFilter> = buildMetricsLockedScopeChips({
      scopeIds: [SERVICE_ID, "651a000000000000000000aa", "checkout-api"],
      scopeEntityType: undefined,
      facetConfigs: [SERVICE_FACET_CONFIG],
      nameMap: {},
    });

    expect(
      chips.map((chip: ActiveFilter): LockedFilterDetail => {
        return detailOf(chip);
      }),
    ).toEqual([
      { searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON },
      { searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON },
      { searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON },
    ]);

    for (const chip of chips) {
      expect(chip.lockedDetail).not.toHaveProperty("searchToken");
    }
  });

  test("every locked chip carries its search syntax or reason and no user chip does", () => {
    const chips: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: [new ObjectID(RUM_APP_ID)],
      scopeEntityType: ServiceType.RealUserMonitor,
      attributeFilters: { "resource.host.name": "ip-10-0-0-12" },
      activeFilters: [
        restoredChip("hostId", HOST_ID),
        restoredChip("attributes.container.name", "postgres"),
      ],
      facetConfigs: [],
      nameMap: RUM_NAME_MAP,
    });

    expect(
      chips.map(
        (chip: ActiveFilter): [boolean, LockedFilterDetail | undefined] => {
          return [Boolean(chip.readOnly), chip.lockedDetail];
        },
      ),
    ).toEqual([
      [
        true,
        { searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON },
      ],
      [true, { searchToken: "@resource.host.name:ip-10-0-0-12" }],
      [false, undefined],
      [false, undefined],
    ]);
  });
});

describe("getMetricsScopeFallbackLabel", () => {
  test("names a resolved entity and falls back to the id", () => {
    expect(
      getMetricsScopeFallbackLabel({ id: RUM_APP_ID, nameMap: RUM_NAME_MAP }),
    ).toBe("checkout-web");
    expect(getMetricsScopeFallbackLabel({ id: HOST_ID, nameMap: {} })).toBe(
      HOST_ID,
    );
    expect(
      getMetricsScopeFallbackLabel({ id: HOST_ID, nameMap: undefined }),
    ).toBe(HOST_ID);
  });
});

/*
 * End to end without React: gather the chips' ids, resolve them through the
 * real resolver (ModelAPI mocked), and render the chips.
 */
describe("chips resolved through TelemetryEntityNameResolver", () => {
  interface Row {
    id: ObjectID;
    [field: string]: unknown;
  }

  const TABLES: Array<[unknown, Array<Row>]> = [
    [RumApplication, [{ id: new ObjectID(RUM_APP_ID), name: "checkout-web" }]],
    [Service, [{ id: new ObjectID(SERVICE_ID), name: "checkout-api" }]],
    [Host, [{ id: new ObjectID(HOST_ID), name: "web-1" }]],
    [
      KubernetesCluster,
      [
        {
          id: new ObjectID(CLUSTER_ID),
          name: "",
          clusterIdentifier: "prod-eks",
        },
      ],
    ],
    [
      ProxmoxCluster,
      [{ id: new ObjectID(PROXMOX_CLUSTER_ID), name: "pve-prod" }],
    ],
    [IoTFleet, [{ id: new ObjectID(IOT_FLEET_ID), name: "warehouse-sensors" }]],
  ];

  beforeEach(() => {
    TelemetryEntityNameResolver.clearCache();
    getListMock.mockReset();
    getListMock.mockImplementation((args: unknown) => {
      const request: {
        modelType: unknown;
        query: { _id: { values: Array<string> } };
      } = args as {
        modelType: unknown;
        query: { _id: { values: Array<string> } };
      };
      const requested: Array<string> = (request.query._id.values || []).map(
        (value: unknown): string => {
          return `${value}`;
        },
      );
      const table: [unknown, Array<Row>] | undefined = TABLES.find(
        (entry: [unknown, Array<Row>]): boolean => {
          return entry[0] === request.modelType;
        },
      );
      const rows: Array<Row> = (table ? table[1] : []).filter(
        (row: Row): boolean => {
          return requested.includes(row.id.toString());
        },
      );
      return Promise.resolve({ data: rows, count: rows.length });
    });
  });

  test("a RUM page's scope id is looked up in the RUM table only", async () => {
    const lookup: MetricsEntityLookup = collectMetricsEntityLookup({
      scopeIds: [new ObjectID(RUM_APP_ID)],
      scopeEntityType: ServiceType.RealUserMonitor,
      filters: [],
    });
    const nameMap: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: lookup.ids,
        projectId: PROJECT_ID,
        typeHints: lookup.typeHints,
      });

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(
      (getListMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(RumApplication);

    const chips: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: [new ObjectID(RUM_APP_ID)],
      scopeEntityType: ServiceType.RealUserMonitor,
      attributeFilters: undefined,
      activeFilters: [],
      facetConfigs: [],
      nameMap,
    });
    expect(chips).toEqual([
      {
        facetKey: "primaryEntityId",
        value: RUM_APP_ID,
        displayKey: "RUM Application",
        displayValue: "checkout-web",
        readOnly: true,
        lockedDetail: {
          searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON,
        },
      },
    ]);
  });

  test("restored chips of every kind resolve to names in one pass", async () => {
    const activeFilters: Array<ActiveFilter> = [
      restoredChip("primaryEntityId", SERVICE_ID),
      restoredChip("serviceId", RUM_APP_ID),
      restoredChip("hostId", HOST_ID),
      restoredChip("kubernetesClusterId", CLUSTER_ID),
      restoredChip("primaryEntityId", PROJECT_ID),
    ];
    const lookup: MetricsEntityLookup = collectMetricsEntityLookup({
      scopeIds: undefined,
      scopeEntityType: undefined,
      filters: activeFilters,
    });
    const nameMap: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: lookup.ids,
        projectId: PROJECT_ID,
        typeHints: lookup.typeHints,
      });

    const chips: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: undefined,
      scopeEntityType: undefined,
      attributeFilters: undefined,
      activeFilters,
      facetConfigs: [],
      nameMap,
    });

    expect(
      chips.map((chip: ActiveFilter): [string, string] => {
        return [chip.displayKey, chip.displayValue];
      }),
    ).toEqual([
      ["Service", "checkout-api"],
      ["RUM Application", "checkout-web"],
      ["Host", "web-1"],
      ["Kubernetes Cluster", "prod-eks"],
      ["Service", "Unknown Service"],
    ]);
  });

  test("chips for the newly offered resource types go straight to their own tables", async () => {
    const activeFilters: Array<ActiveFilter> = [
      restoredChip("proxmoxClusterId", PROXMOX_CLUSTER_ID),
      restoredChip("iotFleetId", IOT_FLEET_ID),
    ];
    const lookup: MetricsEntityLookup = collectMetricsEntityLookup({
      scopeIds: undefined,
      scopeEntityType: undefined,
      filters: activeFilters,
    });
    const nameMap: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: lookup.ids,
        projectId: PROJECT_ID,
        typeHints: lookup.typeHints,
      });

    // Hinted: no Service probe, no fall-through across every table.
    const queried: Array<unknown> = getListMock.mock.calls.map(
      (call: Array<unknown>): unknown => {
        return (call[0] as { modelType: unknown }).modelType;
      },
    );
    expect(queried).toHaveLength(2);
    expect(queried).toEqual(expect.arrayContaining([ProxmoxCluster, IoTFleet]));

    const chips: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: undefined,
      scopeEntityType: undefined,
      attributeFilters: undefined,
      activeFilters,
      facetConfigs: [],
      nameMap,
    });

    expect(
      chips.map((chip: ActiveFilter): [string, string] => {
        return [chip.displayKey, chip.displayValue];
      }),
    ).toEqual([
      ["Proxmox Cluster", "pve-prod"],
      ["IoT Fleet", "warehouse-sensors"],
    ]);
  });

  test("a table the user cannot read leaves only its chips on the id", async () => {
    getListMock.mockImplementation((args: unknown) => {
      const request: { modelType: unknown } = args as { modelType: unknown };
      if (request.modelType === Host) {
        return Promise.reject(new Error("forbidden"));
      }
      if (request.modelType === RumApplication) {
        return Promise.resolve({
          data: [{ id: new ObjectID(RUM_APP_ID), name: "checkout-web" }],
          count: 1,
        });
      }
      return Promise.resolve({ data: [], count: 0 });
    });

    const activeFilters: Array<ActiveFilter> = [
      restoredChip("hostId", HOST_ID),
      restoredChip("primaryEntityId", RUM_APP_ID),
    ];
    const lookup: MetricsEntityLookup = collectMetricsEntityLookup({
      scopeIds: undefined,
      scopeEntityType: undefined,
      filters: activeFilters,
    });
    const nameMap: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: lookup.ids,
        projectId: PROJECT_ID,
        typeHints: lookup.typeHints,
      });
    const chips: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: undefined,
      scopeEntityType: undefined,
      attributeFilters: undefined,
      activeFilters,
      facetConfigs: [],
      nameMap,
    });

    expect(chips[0]).toMatchObject({
      displayKey: "Host",
      displayValue: HOST_ID,
    });
    expect(chips[1]).toMatchObject({
      displayKey: "RUM Application",
      displayValue: "checkout-web",
    });
  });
});

describe("getMetricsAppliedEntityFilterIds (the metric list's entity filter)", () => {
  /*
   * A restored `serviceId` chip is labelled exactly like an applied
   * `primaryEntityId` filter, so it has to filter the list too — it used to
   * be shown and silently ignored.
   */
  test("applies the legacy serviceId alias the same as primaryEntityId", () => {
    expect(
      getMetricsAppliedEntityFilterIds([restoredChip("serviceId", SERVICE_ID)]),
    ).toEqual([SERVICE_ID]);
    expect(
      getMetricsAppliedEntityFilterIds([
        restoredChip("primaryEntityId", SERVICE_ID),
      ]),
    ).toEqual([SERVICE_ID]);
    expect(
      getMetricsAppliedEntityFilterIds([
        restoredChip("primaryEntityId", SERVICE_ID),
        restoredChip("serviceId", OTHER_SERVICE_ID),
      ]),
    ).toEqual([SERVICE_ID, OTHER_SERVICE_ID]);
  });

  test("passes the id through untouched, never the display name", () => {
    const ids: Array<string> = getMetricsAppliedEntityFilterIds([
      {
        facetKey: "serviceId",
        value: RUM_APP_ID,
        displayKey: "RUM Application",
        displayValue: "checkout-web",
      },
    ]);
    expect(ids).toEqual([RUM_APP_ID]);
  });

  test("does not apply typed resource keys, attribute chips or other facets", () => {
    expect(
      getMetricsAppliedEntityFilterIds([
        restoredChip("hostId", HOST_ID),
        restoredChip("dockerHostId", DOCKER_HOST_ID),
        restoredChip("podmanHostId", PODMAN_HOST_ID),
        restoredChip("kubernetesClusterId", CLUSTER_ID),
        restoredChip("attributes.serviceId", SERVICE_ID),
        restoredChip("attributes.primaryEntityId", SERVICE_ID),
        restoredChip("name", "http.server.duration"),
      ]),
    ).toEqual([]);
  });

  test("drops blanks and repeats, keeps first-seen order", () => {
    expect(
      getMetricsAppliedEntityFilterIds([
        restoredChip("serviceId", ""),
        restoredChip("primaryEntityId", "   "),
        restoredChip("serviceId", OTHER_SERVICE_ID),
        restoredChip("primaryEntityId", SERVICE_ID),
        restoredChip("primaryEntityId", OTHER_SERVICE_ID),
      ]),
    ).toEqual([OTHER_SERVICE_ID, SERVICE_ID]);
    expect(getMetricsAppliedEntityFilterIds(undefined)).toEqual([]);
    expect(getMetricsAppliedEntityFilterIds([])).toEqual([]);
  });

  test("a non-UUID value is still applied, exactly as a primaryEntityId chip always was", () => {
    /*
     * The chip is still on screen, so dropping it from the query would show a
     * filter the list ignores; the value is sent as-is instead.
     */
    expect(
      getMetricsAppliedEntityFilterIds([
        restoredChip("serviceId", "not-an-id"),
      ]),
    ).toEqual(["not-an-id"]);
  });

  test("agrees with the shared service facet keys the other explorers apply", () => {
    for (const key of SERVICE_FACET_KEYS) {
      expect(
        getMetricsAppliedEntityFilterIds([restoredChip(key, SERVICE_ID)]),
      ).toEqual([SERVICE_ID]);
    }
    for (const key of RESOURCE_ENTITY_FACET_KEYS) {
      expect(
        getMetricsAppliedEntityFilterIds([restoredChip(key, HOST_ID)]),
      ).toEqual([]);
    }
    // The shared resource list is the whole catalog, not the original four.
    expect([...RESOURCE_ENTITY_FACET_KEYS]).toEqual(
      expect.arrayContaining([...RESOURCE_FACET_CATALOG_KEYS]),
    );
  });

  test("the Viewer applies the same service ids the Metrics Insights tab applies", () => {
    const chips: Array<ActiveFilter> = [
      restoredChip("serviceId", SERVICE_ID),
      restoredChip("primaryEntityId", RUM_APP_ID),
      restoredChip("hostId", HOST_ID),
    ];
    const insights: TelemetryScopeSelection = splitTelemetryScopeFilters(
      chips.map((chip: ActiveFilter): [string, Array<string>] => {
        return [chip.facetKey, [chip.value]];
      }),
      { supportsResourceEntityFacets: false },
    );
    expect(getMetricsAppliedEntityFilterIds(chips)).toEqual(
      insights.serviceIds,
    );
  });

  test("every chip labelled as an entity filter is one the list applies", () => {
    const activeFilters: Array<ActiveFilter> = [
      restoredChip("serviceId", RUM_APP_ID),
      restoredChip("primaryEntityId", SERVICE_ID),
    ];
    const chips: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: undefined,
      scopeEntityType: undefined,
      attributeFilters: undefined,
      activeFilters,
      facetConfigs: [SERVICE_FACET_CONFIG],
      nameMap: RUM_NAME_MAP,
    });
    expect(chips[0]).toMatchObject({
      facetKey: "serviceId",
      displayKey: "RUM Application",
      displayValue: "checkout-web",
    });
    const applied: Array<string> = getMetricsAppliedEntityFilterIds(chips);
    for (const chip of chips) {
      expect(applied).toContain(chip.value);
    }
  });
});

describe("getMetricsUnnamedScopeIds (Insights scope pill lookups)", () => {
  test("skips ids the loaded service list already names", () => {
    expect(
      getMetricsUnnamedScopeIds({
        selectedIds: [SERVICE_ID, RUM_APP_ID, HOST_ID],
        knownIds: [SERVICE_ID, OTHER_SERVICE_ID],
      }),
    ).toEqual([RUM_APP_ID, HOST_ID]);
  });

  test("skips non-UUID values and blanks", () => {
    expect(
      getMetricsUnnamedScopeIds({
        selectedIds: ["not-an-id", "", "  ", RUM_APP_ID, "12345"],
        knownIds: [],
      }),
    ).toEqual([RUM_APP_ID]);
  });

  test("resolves every selected UUID while the service list has not loaded", () => {
    expect(
      getMetricsUnnamedScopeIds({
        selectedIds: [SERVICE_ID, RUM_APP_ID],
        knownIds: undefined,
      }),
    ).toEqual([SERVICE_ID, RUM_APP_ID]);
  });

  test("returns nothing when every selection is named, and de-duplicates", () => {
    expect(
      getMetricsUnnamedScopeIds({
        selectedIds: [SERVICE_ID, SERVICE_ID],
        knownIds: [SERVICE_ID],
      }),
    ).toEqual([]);
    expect(
      getMetricsUnnamedScopeIds({
        selectedIds: [RUM_APP_ID, ` ${RUM_APP_ID} `],
        knownIds: [],
      }),
    ).toEqual([RUM_APP_ID]);
    expect(
      getMetricsUnnamedScopeIds({ selectedIds: undefined, knownIds: [] }),
    ).toEqual([]);
  });

  test("a covered id keeps its option label; an uncovered one gets the resolved name", () => {
    const unnamed: Array<string> = getMetricsUnnamedScopeIds({
      selectedIds: [SERVICE_ID, RUM_APP_ID],
      knownIds: [SERVICE_ID],
    });
    expect(unnamed).toEqual([RUM_APP_ID]);
    expect(
      getMetricsScopeFallbackLabel({ id: RUM_APP_ID, nameMap: RUM_NAME_MAP }),
    ).toBe("checkout-web");
  });
});

/*
 * An Inventory item's Metrics page scopes the list by entity-key membership
 * (`hasAny(entityKeys, [item key])`) and by nothing else, and the chip bar
 * used to show nothing at all: a filtered list that looked like the whole
 * project. These pin the locked chip the builder now adds for
 * `entityKeysFilter` — how it reads with and without the page's names, where
 * it sits among the other chips, and the search syntax it carries (spelled
 * with the item's identifying resource attributes, or the reason there is
 * none) — and that a Kubernetes / host page, whose attribute chip already
 * stands for its entity scope, never grows a second chip. Which token or
 * reason each kind of rows gets is owned by LockedTelemetryScope.test.ts; the
 * exact metrics token or reason each chip here carries is spelled out.
 */
describe("buildMetricsActiveFilterChips — the entity-key scope (Inventory item pages)", () => {
  const POD_KEY: string = "3f9a1b2c4d5e6f70";
  const OTHER_KEY: string = "aaaaaaaaaaaaaaaa";
  const THIRD_KEY: string = "bbbbbbbbbbbbbbbb";

  const POD_DISPLAYS: LockedEntityKeyDisplayMap = {
    [POD_KEY]: { displayKey: "Kubernetes Pod", displayValue: "checkout-7d9f" },
  };

  // The resource attributes that identify the pod, as an Inventory page knows them.
  const POD_SEARCH_ATTRIBUTES: Record<string, string> = {
    "k8s.cluster.name": "prod",
    "k8s.namespace.name": "shop",
    "k8s.pod.name": "checkout-7d9f",
  };

  const POD_SEARCH_TOKEN: string =
    "@resource.k8s.cluster.name:prod @resource.k8s.namespace.name:shop @resource.k8s.pod.name:checkout-7d9f";

  const POD_DISPLAYS_WITH_ATTRIBUTES: LockedEntityKeyDisplayMap = {
    [POD_KEY]: {
      displayKey: "Kubernetes Pod",
      displayValue: "checkout-7d9f",
      searchAttributes: POD_SEARCH_ATTRIBUTES,
    },
  };

  // What an entity-key chip carries when its page named no attributes for it.
  const NO_ATTRIBUTES_DETAIL: LockedFilterDetail = {
    searchTokenUnavailableReason: ENTITY_KEY_NO_ATTRIBUTES_REASON,
  };

  type ChipRow = [string, string, string, string, boolean];

  type RowsOfFunction = (chips: Array<ActiveFilter>) => Array<ChipRow>;

  // facetKey, value, displayKey, displayValue, locked — what the bar renders.
  const rowsOf: RowsOfFunction = (
    chips: Array<ActiveFilter>,
  ): Array<ChipRow> => {
    return chips.map((chip: ActiveFilter): ChipRow => {
      return [
        chip.facetKey,
        chip.value,
        chip.displayKey,
        chip.displayValue,
        Boolean(chip.readOnly),
      ];
    });
  };

  type DetailOfFunction = (
    chip: ActiveFilter | undefined,
  ) => LockedFilterDetail;

  const detailOf: DetailOfFunction = (
    chip: ActiveFilter | undefined,
  ): LockedFilterDetail => {
    expect(chip).toBeDefined();
    expect(chip!.lockedDetail).toBeDefined();

    return chip!.lockedDetail as LockedFilterDetail;
  };

  type DetailsOfFunction = (
    chips: Array<ActiveFilter>,
  ) => Array<LockedFilterDetail | undefined>;

  // Each chip's detail as it is, undefined for a chip that carries none.
  const detailsOf: DetailsOfFunction = (
    chips: Array<ActiveFilter>,
  ): Array<LockedFilterDetail | undefined> => {
    return chips.map((chip: ActiveFilter): LockedFilterDetail | undefined => {
      return chip.lockedDetail;
    });
  };

  type ChipInput = Parameters<typeof buildMetricsActiveFilterChips>[0];

  interface InventoryChipsInput {
    entityKeysFilter?: ReadonlyArray<string> | undefined;
    entityKeyDisplays?: LockedEntityKeyDisplayMap | undefined;
    activeFilters?: Array<ActiveFilter> | undefined;
  }

  type InventoryChipsFunction = (
    input: InventoryChipsInput,
  ) => Array<ActiveFilter>;

  /*
   * The Inventory page's shape: the entity-key scope and nothing else. The
   * viewer counts that scope as scoped (isScoped, pinned in
   * MetricsLockedScopeWiring.test.ts), so it hands the builder no facet
   * configs, exactly as on the page.
   */
  const inventoryChips: InventoryChipsFunction = (
    input: InventoryChipsInput,
  ): Array<ActiveFilter> => {
    return buildMetricsActiveFilterChips({
      scopeIds: undefined,
      scopeEntityType: undefined,
      attributeFilters: undefined,
      entityKeysFilter: input.entityKeysFilter,
      entityKeyDisplays: input.entityKeyDisplays,
      activeFilters: input.activeFilters || [],
      facetConfigs: [],
      nameMap: {},
    });
  };

  test("reads as the page names the item, keeps the raw key as the filter value, and has no search syntax without the item's attributes", () => {
    const chips: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter: [POD_KEY],
      entityKeyDisplays: POD_DISPLAYS,
    });

    expect(chips).toEqual([
      {
        facetKey: "entityKeys",
        value: POD_KEY,
        displayKey: "Kubernetes Pod",
        displayValue: "checkout-7d9f",
        readOnly: true,
        lockedDetail: {
          searchTokenUnavailableReason: ENTITY_KEY_NO_ATTRIBUTES_REASON,
        },
      },
    ]);
    // The builder's detail is the describer's for metrics rows.
    expect(detailOf(chips[0])).toEqual(
      describeLockedEntityKeyFilter({ rows: "metrics" }),
    );
    expect(detailOf(chips[0]).searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );
    /*
     * No search grammar has an entity-key token, and this display map names
     * no identifying attributes to spell one with, so none is offered.
     */
    expect(detailOf(chips[0]).searchToken).toBeUndefined();
  });

  test("with the item's identifying attributes, the chip reads the same and its search syntax is spelled with them", () => {
    const chips: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter: [POD_KEY],
      entityKeyDisplays: POD_DISPLAYS_WITH_ATTRIBUTES,
    });

    expect(rowsOf(chips)).toEqual([
      ["entityKeys", POD_KEY, "Kubernetes Pod", "checkout-7d9f", true],
    ]);
    expect(detailOf(chips[0])).toEqual({ searchToken: POD_SEARCH_TOKEN });
    expect(detailOf(chips[0])).toEqual(
      describeLockedEntityKeyFilter({
        rows: "metrics",
        searchAttributes: POD_SEARCH_ATTRIBUTES,
      }),
    );
    // Never with the key, which no search bar understands.
    expect(detailOf(chips[0]).searchToken).not.toContain(POD_KEY);
  });

  test("REGRESSION: without a display map the chip still renders, as Resource: <key>", () => {
    /*
     * The bug was a filtered list under an empty chip bar. A page that does
     * not name its entity must still get the pill, just in plainer words.
     */
    const displayMaps: Array<LockedEntityKeyDisplayMap | undefined> = [
      undefined,
      {},
    ];

    for (const entityKeyDisplays of displayMaps) {
      const chips: Array<ActiveFilter> = inventoryChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays,
      });

      expect(rowsOf(chips)).toEqual([
        ["entityKeys", POD_KEY, "Resource", POD_KEY, true],
      ]);
      expect(detailOf(chips[0])).toEqual(NO_ATTRIBUTES_DETAIL);
    }
  });

  test("a blank or whitespace display falls back field by field, and what it keeps is trimmed", () => {
    const cases: Array<{
      display: LockedEntityKeyDisplay;
      row: ChipRow;
      detail: LockedFilterDetail;
    }> = [
      {
        display: { displayKey: "", displayValue: "" },
        row: ["entityKeys", POD_KEY, "Resource", POD_KEY, true],
        detail: NO_ATTRIBUTES_DETAIL,
      },
      {
        display: { displayKey: "   ", displayValue: "\t \n" },
        row: ["entityKeys", POD_KEY, "Resource", POD_KEY, true],
        detail: NO_ATTRIBUTES_DETAIL,
      },
      {
        display: { displayKey: "  Kubernetes Pod  ", displayValue: "   " },
        row: ["entityKeys", POD_KEY, "Kubernetes Pod", POD_KEY, true],
        detail: NO_ATTRIBUTES_DETAIL,
      },
      {
        display: { displayKey: " ", displayValue: "  checkout-7d9f  " },
        row: ["entityKeys", POD_KEY, "Resource", "checkout-7d9f", true],
        detail: NO_ATTRIBUTES_DETAIL,
      },
      {
        // The default word spelled out by the page reads the same as none.
        display: { displayKey: "Resource", displayValue: "checkout-7d9f" },
        row: ["entityKeys", POD_KEY, "Resource", "checkout-7d9f", true],
        detail: NO_ATTRIBUTES_DETAIL,
      },
      {
        // Whatever arrives at runtime, a non-string is not a name.
        display: {
          displayKey: undefined as unknown as string,
          displayValue: 42 as unknown as string,
        },
        row: ["entityKeys", POD_KEY, "Resource", POD_KEY, true],
        detail: NO_ATTRIBUTES_DETAIL,
      },
      {
        // Blank names do not discard the attributes the syntax is spelled with.
        display: {
          displayKey: " ",
          displayValue: "",
          searchAttributes: POD_SEARCH_ATTRIBUTES,
        },
        row: ["entityKeys", POD_KEY, "Resource", POD_KEY, true],
        detail: { searchToken: POD_SEARCH_TOKEN },
      },
    ];

    for (const testCase of cases) {
      const chips: Array<ActiveFilter> = inventoryChips({
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: { [POD_KEY]: testCase.display },
      });

      expect(rowsOf(chips)).toEqual([testCase.row]);
      expect(detailOf(chips[0])).toEqual(testCase.detail);
    }
  });

  test("a display map that does not name this key falls back to the key, and lends it no other key's attributes", () => {
    const chips: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter: [OTHER_KEY],
      entityKeyDisplays: POD_DISPLAYS_WITH_ATTRIBUTES,
    });

    expect(rowsOf(chips)).toEqual([
      ["entityKeys", OTHER_KEY, "Resource", OTHER_KEY, true],
    ]);
    expect(detailOf(chips[0])).toEqual(NO_ATTRIBUTES_DETAIL);
  });

  test("one chip per key in the page's order, each carrying the search syntax of its own entity only", () => {
    const chips: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter: [POD_KEY, OTHER_KEY],
      entityKeyDisplays: POD_DISPLAYS_WITH_ATTRIBUTES,
    });

    expect(rowsOf(chips)).toEqual([
      ["entityKeys", POD_KEY, "Kubernetes Pod", "checkout-7d9f", true],
      ["entityKeys", OTHER_KEY, "Resource", OTHER_KEY, true],
    ]);

    /*
     * Each chip's syntax reproduces its own entity: the pod's attributes are
     * never spelled on the chip of the other key, which the page did not
     * name.
     */
    expect(detailsOf(chips)).toEqual([
      { searchToken: POD_SEARCH_TOKEN },
      NO_ATTRIBUTES_DETAIL,
    ]);

    const three: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter: [POD_KEY, OTHER_KEY, THIRD_KEY],
    });

    expect(rowsOf(three)).toEqual([
      ["entityKeys", POD_KEY, "Resource", POD_KEY, true],
      ["entityKeys", OTHER_KEY, "Resource", OTHER_KEY, true],
      ["entityKeys", THIRD_KEY, "Resource", THIRD_KEY, true],
    ]);
    expect(detailsOf(three)).toEqual([
      NO_ATTRIBUTES_DETAIL,
      NO_ATTRIBUTES_DETAIL,
      NO_ATTRIBUTES_DETAIL,
    ]);
  });

  test("blank and repeated keys are dropped before chips are built, and a padded key still finds its attributes", () => {
    const chips: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter: ["", "   ", `  ${POD_KEY}  `, POD_KEY, "\t"],
      entityKeyDisplays: POD_DISPLAYS_WITH_ATTRIBUTES,
    });

    expect(rowsOf(chips)).toEqual([
      ["entityKeys", POD_KEY, "Kubernetes Pod", "checkout-7d9f", true],
    ]);
    expect(detailsOf(chips)).toEqual([{ searchToken: POD_SEARCH_TOKEN }]);

    const repeated: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter: [POD_KEY, OTHER_KEY, POD_KEY, ` ${OTHER_KEY}`],
    });

    expect(rowsOf(repeated)).toEqual([
      ["entityKeys", POD_KEY, "Resource", POD_KEY, true],
      ["entityKeys", OTHER_KEY, "Resource", OTHER_KEY, true],
    ]);
    expect(detailsOf(repeated)).toEqual([
      NO_ATTRIBUTES_DETAIL,
      NO_ATTRIBUTES_DETAIL,
    ]);
  });

  test("no entity key, no entity-key chip — even when the page hands over a display map", () => {
    const filters: Array<ReadonlyArray<string> | undefined> = [
      undefined,
      [],
      ["", "  ", "\n"],
    ];

    for (const entityKeysFilter of filters) {
      expect(
        inventoryChips({ entityKeysFilter, entityKeyDisplays: POD_DISPLAYS }),
      ).toEqual([]);
    }
  });

  test("orders the locked entity-id scope, the locked entity-key scope, the locked attributes, then the user's chips", () => {
    const chips: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: [new ObjectID(RUM_APP_ID)],
      scopeEntityType: ServiceType.RealUserMonitor,
      attributeFilters: { "resource.host.name": "ip-10-0-0-12" },
      attributeFilterDisplayKeys: { "resource.host.name": "Host" },
      attributeFilterDisplayValues: { "resource.host.name": "web-1" },
      entityKeysFilter: [POD_KEY, OTHER_KEY],
      entityKeyDisplays: POD_DISPLAYS,
      activeFilters: [
        restoredChip("hostId", HOST_ID),
        restoredChip("attributes.container.name", "postgres"),
      ],
      facetConfigs: [],
      nameMap: {
        ...RUM_NAME_MAP,
        ...entity(HOST_ID, "web-1", ServiceType.Host, "Host"),
      },
    });

    expect(rowsOf(chips)).toEqual([
      ["primaryEntityId", RUM_APP_ID, "RUM Application", "checkout-web", true],
      ["entityKeys", POD_KEY, "Kubernetes Pod", "checkout-7d9f", true],
      ["entityKeys", OTHER_KEY, "Resource", OTHER_KEY, true],
      ["attributes.resource.host.name", "ip-10-0-0-12", "Host", "web-1", true],
      ["hostId", HOST_ID, "Host", "web-1", false],
      [
        "attributes.container.name",
        "postgres",
        "container.name",
        "postgres",
        false,
      ],
    ]);
    expect(detailsOf(chips)).toEqual([
      { searchTokenUnavailableReason: METRICS_SERVICE_NO_SYNTAX_REASON },
      NO_ATTRIBUTES_DETAIL,
      NO_ATTRIBUTES_DETAIL,
      { searchToken: "@resource.host.name:ip-10-0-0-12" },
      undefined,
      undefined,
    ]);
  });

  test("a user chip on the same column is neither merged into the locked chip nor hidden by it", () => {
    /*
     * A hand-edited link can restore an `entityKeys` chip. Nothing dedupes
     * the two: the chip bar keys locked pills `readonly:<facet>:<value>` and
     * the user's `<facet>:<value>`, and the list query never reads chips.
     */
    const chips: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter: [POD_KEY],
      entityKeyDisplays: POD_DISPLAYS,
      activeFilters: [restoredChip("entityKeys", POD_KEY)],
    });

    expect(rowsOf(chips)).toEqual([
      ["entityKeys", POD_KEY, "Kubernetes Pod", "checkout-7d9f", true],
      ["entityKeys", POD_KEY, "entityKeys", POD_KEY, false],
    ]);
    expect(detailOf(chips[0])).toEqual(NO_ATTRIBUTES_DETAIL);
    expect(chips[1]!.lockedDetail).toBeUndefined();
  });

  test("REGRESSION: a Kubernetes cluster page grows no entity-key chip — its attribute chip already stands for the scope", () => {
    /*
     * The page's entityScope still narrows the metric list, but it never
     * reaches the chip builder: the cluster's attribute chip is its pill.
     */
    const clusterPage: ChipInput = {
      scopeIds: undefined,
      scopeEntityType: undefined,
      attributeFilters: { "resource.k8s.cluster.name": "prod-eks-01" },
      attributeFilterDisplayKeys: { "resource.k8s.cluster.name": "Cluster" },
      attributeFilterDisplayValues: {
        "resource.k8s.cluster.name": "production",
      },
      activeFilters: [],
      facetConfigs: [],
      nameMap: {},
    };

    const chips: Array<ActiveFilter> =
      buildMetricsActiveFilterChips(clusterPage);

    expect(rowsOf(chips)).toEqual([
      [
        "attributes.resource.k8s.cluster.name",
        "prod-eks-01",
        "Cluster",
        "production",
        true,
      ],
    ]);
    expect(detailOf(chips[0])).toEqual({
      searchToken: "@resource.k8s.cluster.name:prod-eks-01",
    });

    // Every existing page passes neither new input: nothing changes for them.
    expect(
      buildMetricsActiveFilterChips({
        ...clusterPage,
        entityKeysFilter: undefined,
        entityKeyDisplays: undefined,
      }),
    ).toEqual(chips);

    // Naming the cluster's entity key creates nothing: only entityKeysFilter does.
    expect(
      buildMetricsActiveFilterChips({
        ...clusterPage,
        entityKeyDisplays: {
          [POD_KEY]: {
            displayKey: "Kubernetes Cluster",
            displayValue: "production",
          },
        },
      }),
    ).toEqual(chips);
  });

  test("every entity-key chip is locked, and none offers a search token without the entity's identifying attributes", () => {
    const chips: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter: [POD_KEY, OTHER_KEY],
      entityKeyDisplays: POD_DISPLAYS,
    });

    expect(chips).toHaveLength(2);

    for (const chip of chips) {
      expect(chip.facetKey).toBe("entityKeys");
      expect(chip.readOnly).toBe(true);

      const detail: LockedFilterDetail = detailOf(chip);

      expect(detail).toEqual(NO_ATTRIBUTES_DETAIL);
      expect(detail.searchToken).toBeUndefined();
      expect(detail.searchTokenUnavailableReason).toBe(
        ENTITY_KEY_NO_ATTRIBUTES_REASON,
      );
    }

    /*
     * Each locked chip carries its own search syntax. Beside a locked
     * attribute, the attribute chip keeps its token while the entity-key
     * chip, named without attributes, still has none.
     */
    const withAttribute: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: undefined,
      scopeEntityType: undefined,
      attributeFilters: { "resource.host.name": "ip-10-0-0-12" },
      entityKeysFilter: [POD_KEY],
      entityKeyDisplays: POD_DISPLAYS,
      activeFilters: [],
      facetConfigs: [],
      nameMap: {},
    });

    type TokenRow = [string, string | undefined, string | undefined];

    type TokenRowsOfFunction = (
      rowChips: Array<ActiveFilter>,
    ) => Array<TokenRow>;

    const tokenRowsOf: TokenRowsOfFunction = (
      rowChips: Array<ActiveFilter>,
    ): Array<TokenRow> => {
      return rowChips.map((chip: ActiveFilter): TokenRow => {
        return [
          chip.facetKey,
          detailOf(chip).searchToken,
          detailOf(chip).searchTokenUnavailableReason,
        ];
      });
    };

    expect(tokenRowsOf(withAttribute)).toEqual([
      ["entityKeys", undefined, ENTITY_KEY_NO_ATTRIBUTES_REASON],
      [
        "attributes.resource.host.name",
        "@resource.host.name:ip-10-0-0-12",
        undefined,
      ],
    ]);

    /*
     * Named with its attributes, the entity-key chip beside the attribute
     * chip carries its own token, and neither borrows the other's.
     */
    const withEntityAttributes: Array<ActiveFilter> =
      buildMetricsActiveFilterChips({
        scopeIds: undefined,
        scopeEntityType: undefined,
        attributeFilters: { "resource.host.name": "ip-10-0-0-12" },
        entityKeysFilter: [POD_KEY],
        entityKeyDisplays: POD_DISPLAYS_WITH_ATTRIBUTES,
        activeFilters: [],
        facetConfigs: [],
        nameMap: {},
      });

    expect(tokenRowsOf(withEntityAttributes)).toEqual([
      ["entityKeys", POD_SEARCH_TOKEN, undefined],
      [
        "attributes.resource.host.name",
        "@resource.host.name:ip-10-0-0-12",
        undefined,
      ],
    ]);
  });

  test("does not mutate the page's entity keys or display map", () => {
    const entityKeysFilter: ReadonlyArray<string> = Object.freeze([
      ` ${POD_KEY} `,
      POD_KEY,
      "",
    ]);
    const entityKeyDisplays: LockedEntityKeyDisplayMap = Object.freeze({
      [POD_KEY]: Object.freeze({
        displayKey: " Kubernetes Pod ",
        displayValue: " checkout-7d9f ",
      }),
    });

    const chips: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter,
      entityKeyDisplays,
    });

    expect(rowsOf(chips)).toEqual([
      ["entityKeys", POD_KEY, "Kubernetes Pod", "checkout-7d9f", true],
    ]);
    expect(detailOf(chips[0])).toEqual(NO_ATTRIBUTES_DETAIL);
    expect(entityKeysFilter).toEqual([` ${POD_KEY} `, POD_KEY, ""]);
    expect(entityKeyDisplays).toEqual({
      [POD_KEY]: {
        displayKey: " Kubernetes Pod ",
        displayValue: " checkout-7d9f ",
      },
    });
  });

  test("the Inventory page's own display map names the chip by the item's type and name", () => {
    const named: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter: [POD_KEY],
      entityKeyDisplays: buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
        entityType: EntityType.KubernetesPod,
        displayName: "checkout-7d9f",
      }),
    });

    expect(rowsOf(named)).toEqual([
      ["entityKeys", POD_KEY, "Kubernetes Pod", "checkout-7d9f", true],
    ]);
    // An item whose identifying attributes were not loaded has no syntax.
    expect(detailOf(named[0])).toEqual(NO_ATTRIBUTES_DETAIL);
    expect(detailOf(named[0]).searchToken).toBeUndefined();
    expect(detailOf(named[0]).searchTokenUnavailableReason).toBe(
      ENTITY_KEY_NO_ATTRIBUTES_REASON,
    );

    /*
     * With them, the metrics chip reads the same and its search syntax is
     * spelled with those attributes, never with the key.
     */
    const withAttributes: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter: [POD_KEY],
      entityKeyDisplays: buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
        entityType: EntityType.KubernetesPod,
        displayName: "checkout-7d9f",
        identifyingAttributes: {
          "k8s.cluster.name": "prod",
          "k8s.namespace.name": "shop",
          "k8s.pod.name": "checkout-7d9f",
        },
      }),
    });

    expect(rowsOf(withAttributes)).toEqual(rowsOf(named));
    expect(detailOf(withAttributes[0])).toEqual({
      searchToken: POD_SEARCH_TOKEN,
    });
    expect(detailOf(withAttributes[0]).searchToken).toBe(
      "@resource.k8s.cluster.name:prod @resource.k8s.namespace.name:shop @resource.k8s.pod.name:checkout-7d9f",
    );
    expect(
      detailOf(withAttributes[0]).searchTokenUnavailableReason,
    ).toBeUndefined();
    expect(detailOf(withAttributes[0]).searchToken).not.toContain(POD_KEY);

    // An unnamed item reads as its key, still under its type.
    const unnamed: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter: [POD_KEY],
      entityKeyDisplays: buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
        entityType: EntityType.KubernetesPod,
        displayName: "   ",
      }),
    });

    expect(rowsOf(unnamed)).toEqual([
      ["entityKeys", POD_KEY, "Kubernetes Pod", POD_KEY, true],
    ]);
    expect(detailOf(unnamed[0])).toEqual(NO_ATTRIBUTES_DETAIL);

    // An untyped item is an Inventory Item in the chip; its syntax is unchanged.
    const untyped: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter: [POD_KEY],
      entityKeyDisplays: buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
        displayName: "checkout-7d9f",
      }),
    });

    expect(rowsOf(untyped)).toEqual([
      ["entityKeys", POD_KEY, "Inventory Item", "checkout-7d9f", true],
    ]);
    expect(detailOf(untyped[0])).toEqual(NO_ATTRIBUTES_DETAIL);

    /*
     * The page filters by the item's key as stored and keys the map by the
     * same value; both sides trim, so a padded key is still named.
     */
    const padded: Array<ActiveFilter> = inventoryChips({
      entityKeysFilter: [` ${POD_KEY} `],
      entityKeyDisplays: buildInventoryEntityKeyDisplays({
        entityKey: ` ${POD_KEY} `,
        entityType: EntityType.KubernetesPod,
        displayName: "checkout-7d9f",
      }),
    });

    expect(rowsOf(padded)).toEqual([
      ["entityKeys", POD_KEY, "Kubernetes Pod", "checkout-7d9f", true],
    ]);
    expect(detailOf(padded[0])).toEqual(NO_ATTRIBUTES_DETAIL);
  });
});
