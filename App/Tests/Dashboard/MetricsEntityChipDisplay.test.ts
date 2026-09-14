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
    ).toEqual([
      {
        facetKey: "attributes.resource.host.name",
        value: "ip-10-0-0-12",
        displayKey: "Host",
        displayValue: "web-1",
        readOnly: true,
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
  });

  test("an override for a different key is ignored", () => {
    const chips: Array<ActiveFilter> = buildMetricsLockedAttributeChips({
      attributeFilters: { a: "1" },
      attributeFilterDisplayValues: { b: "Named" },
    });
    expect(chips[0]!.displayValue).toBe("1");
  });

  test("skips empty filter values and handles no filters", () => {
    expect(
      buildMetricsLockedAttributeChips({
        attributeFilters: { a: "", b: "2" },
      }).map((chip: ActiveFilter): string => {
        return chip.facetKey;
      }),
    ).toEqual(["attributes.b"]);
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
