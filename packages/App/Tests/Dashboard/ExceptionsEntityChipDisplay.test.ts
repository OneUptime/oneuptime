/*
 * The exceptions explorer's chips name telemetry entities by id. The id is
 * polymorphic (Service, RUM application, host, cluster, the projectId
 * "Unknown Service" bucket, ...) while the explorer only loads Services for
 * its sidebar, so a RUM application page used to lock a chip reading
 * "Service: 84858d6c-…". These tests pin the display precedence and — just as
 * important — that nothing about the filter itself changes.
 *
 * The helper imports the shared resolver module, which imports ModelAPI; it
 * is mocked so nothing reaches the network.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import { describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  RESOURCE_FACET_CATALOG,
  RESOURCE_FACET_CATALOG_KEYS,
  ResourceFacetDefinition,
} from "Common/Types/Telemetry/ResourceFacetCatalog";
import { buildResourceFacetConfigs } from "Common/UI/Components/TelemetryViewer/ResourceFacetConfigs";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
} from "Common/UI/Components/TelemetryViewer/types";
import { TelemetryEntityNameMap } from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import {
  EXCEPTION_ENTITY_ID_FACET_KEYS,
  EXCEPTION_TYPED_RESOURCE_FACET_TYPES,
  ExceptionKnownChipIds,
  buildExceptionEntityTypeHints,
  buildExceptionFacetDisplayNames,
  buildExceptionKnownChipIds,
  collectExceptionEntityChipIds,
  getExceptionFacetIncludeDisplayValue,
  isExceptionEntityIdFacetKey,
  isExceptionNamedResourceFacetKey,
  resolveExceptionChipDisplay,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionsEntityChipDisplay";
import {
  ExceptionQueryScope,
  ExceptionScopeChip,
  buildExceptionQueryScope,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionQueryScope";

const RUM_APP_ID: string = "84858d6c-1111-4111-8111-111111111111";
const SERVICE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLUSTER_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROJECT_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UNRESOLVED_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const SERVICE_FACET: FacetConfig = {
  key: "primaryEntityId",
  title: "Service",
  valueDisplayMap: { [SERVICE_ID]: "checkout-api" },
};

const HOST_FACET: FacetConfig = {
  key: "hostId",
  title: "Host",
  valueDisplayMap: {},
};

const NAMES: TelemetryEntityNameMap = {
  [RUM_APP_ID]: {
    id: RUM_APP_ID,
    name: "checkout-web",
    entityType: ServiceType.RealUserMonitor,
    typeLabel: "RUM Application",
  },
  [SERVICE_ID]: {
    id: SERVICE_ID,
    name: "checkout-api",
    entityType: ServiceType.OpenTelemetry,
    typeLabel: "Service",
  },
  [HOST_ID]: {
    id: HOST_ID,
    name: "web-01",
    entityType: ServiceType.Host,
    typeLabel: "Host",
  },
  [PROJECT_ID]: {
    id: PROJECT_ID,
    name: "Unknown Service",
    entityType: ServiceType.Unknown,
    typeLabel: "Service",
  },
};

type ChipFunction = (
  facetKey: string,
  value: string,
  overrides?: Partial<ActiveFilter>,
) => ActiveFilter;

const chip: ChipFunction = (
  facetKey: string,
  value: string,
  overrides?: Partial<ActiveFilter>,
): ActiveFilter => {
  return {
    facetKey,
    value,
    displayKey: facetKey,
    displayValue: value,
    ...(overrides || {}),
  };
};

describe("facet key classification", () => {
  test("primaryEntityId and the legacy serviceId are polymorphic entity ids", () => {
    expect(EXCEPTION_ENTITY_ID_FACET_KEYS).toEqual([
      "primaryEntityId",
      "serviceId",
    ]);
    expect(isExceptionEntityIdFacetKey("primaryEntityId")).toBe(true);
    expect(isExceptionEntityIdFacetKey("serviceId")).toBe(true);
    expect(isExceptionEntityIdFacetKey("hostId")).toBe(false);
    expect(isExceptionEntityIdFacetKey("exceptionType")).toBe(false);
  });

  test("typed resource keys map to exactly their own table", () => {
    /*
     * Spelled out rather than rebuilt from the catalog, so a catalog edit
     * that re-points a key at the wrong table fails here. IoT fleet
     * telemetry is stamped IoTDevice, and a RUM application RealUserMonitor.
     */
    expect(EXCEPTION_TYPED_RESOURCE_FACET_TYPES).toEqual({
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

  test("REGRESSION: every resource facet the sidebar offers is a typed resource key", () => {
    /*
     * Proxmox / vCenter / Ceph / Swarm / Serverless / Cloud / RUM / IoT
     * facets are on screen now; a chip for one that is not typed here would
     * never be named and would read "proxmoxClusterId: <uuid>".
     */
    expect(Object.keys(EXCEPTION_TYPED_RESOURCE_FACET_TYPES)).toEqual([
      ...RESOURCE_FACET_CATALOG_KEYS,
    ]);
    for (const definition of RESOURCE_FACET_CATALOG) {
      expect(EXCEPTION_TYPED_RESOURCE_FACET_TYPES[definition.facetKey]).toBe(
        definition.serviceType,
      );
      expect(isExceptionNamedResourceFacetKey(definition.facetKey)).toBe(true);
      expect(isExceptionEntityIdFacetKey(definition.facetKey)).toBe(false);
    }
  });

  test("Object.prototype members are not typed resource keys", () => {
    for (const key of ["toString", "constructor", "hasOwnProperty"]) {
      expect(isExceptionNamedResourceFacetKey(key)).toBe(false);
    }
  });

  test("only id-valued facets are sent to the name resolver", () => {
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
      expect(isExceptionNamedResourceFacetKey(key)).toBe(true);
    }
    for (const key of [
      "exceptionType",
      "environment",
      "errorClass",
      "attributes.primaryEntityId",
      "",
    ]) {
      expect(isExceptionNamedResourceFacetKey(key)).toBe(false);
    }
  });
});

describe("collectExceptionEntityChipIds", () => {
  test("collects the scope id, stored-scope ids and user chip ids once, sorted", () => {
    const ids: Array<string> = collectExceptionEntityChipIds({
      scopeEntityId: RUM_APP_ID,
      chips: [
        chip("primaryEntityId", SERVICE_ID),
        chip("primaryEntityId", RUM_APP_ID),
        chip("serviceId", PROJECT_ID),
        chip("hostId", HOST_ID),
        chip("kubernetesClusterId", CLUSTER_ID),
        chip("exceptionType", "TypeError"),
        chip("environment", "production"),
        chip("attributes.http.status_code", "500"),
      ],
    });

    expect(ids).toEqual(
      [RUM_APP_ID, SERVICE_ID, PROJECT_ID, HOST_ID, CLUSTER_ID].sort(),
    );
  });

  test("is empty when nothing names an entity — no lookup is issued", () => {
    expect(
      collectExceptionEntityChipIds({
        chips: [chip("exceptionType", "TypeError")],
      }),
    ).toEqual([]);
    expect(
      collectExceptionEntityChipIds({ scopeEntityId: "", chips: [] }),
    ).toEqual([]);
  });

  test("ignores blank values and trims whitespace", () => {
    expect(
      collectExceptionEntityChipIds({
        scopeEntityId: `  ${RUM_APP_ID} `,
        chips: [chip("primaryEntityId", "   "), chip("hostId", "")],
      }),
    ).toEqual([RUM_APP_ID]);
  });

  test("is order independent, so re-created chip arrays keep a stable id set", () => {
    const a: Array<string> = collectExceptionEntityChipIds({
      chips: [chip("primaryEntityId", SERVICE_ID), chip("hostId", HOST_ID)],
    });
    const b: Array<string> = collectExceptionEntityChipIds({
      chips: [chip("hostId", HOST_ID), chip("primaryEntityId", SERVICE_ID)],
    });
    expect(a).toEqual(b);
  });

  test("accepts an ObjectID-derived scope id", () => {
    expect(
      collectExceptionEntityChipIds({
        scopeEntityId: new ObjectID(RUM_APP_ID).toString(),
        chips: [],
      }),
    ).toEqual([RUM_APP_ID]);
  });
});

describe("buildExceptionKnownChipIds", () => {
  test("indexes the ids each resource facet names from its list and the server", () => {
    const known: ExceptionKnownChipIds = buildExceptionKnownChipIds({
      facetConfigs: [
        SERVICE_FACET,
        {
          key: "hostId",
          title: "Host",
          valueDisplayMap: { [HOST_ID]: "web-01" },
        },
        {
          key: "errorClass",
          title: "Error Class",
          valueDisplayMap: { "user-error": "User error" },
        },
      ],
      facetDisplayNames: {
        primaryEntityId: { [UNRESOLVED_ID]: "service-past-the-cap" },
        kubernetesClusterId: { [CLUSTER_ID]: "prod-eu" },
      },
    });

    expect(Array.from(known["primaryEntityId"] || []).sort()).toEqual(
      [SERVICE_ID, UNRESOLVED_ID].sort(),
    );
    expect(Array.from(known["hostId"] || [])).toEqual([HOST_ID]);
    expect(Array.from(known["kubernetesClusterId"] || [])).toEqual([
      CLUSTER_ID,
    ]);
    // Non-id facets never name an entity chip.
    expect(known["errorClass"]).toBeUndefined();
  });

  test("an empty name does not count as known", () => {
    const known: ExceptionKnownChipIds = buildExceptionKnownChipIds({
      facetConfigs: [
        {
          key: "primaryEntityId",
          title: "Service",
          valueDisplayMap: { [SERVICE_ID]: "" },
        },
      ],
      facetDisplayNames: undefined,
    });
    expect(known["primaryEntityId"]).toBeUndefined();
  });
});

describe("collectExceptionEntityChipIds — ids the viewer can already name", () => {
  const KNOWN: ExceptionKnownChipIds = {
    primaryEntityId: new Set<string>([SERVICE_ID]),
    hostId: new Set<string>([HOST_ID]),
  };

  test("REGRESSION: a Service page whose Service is in the loaded list issues no lookup", () => {
    expect(
      collectExceptionEntityChipIds({
        scopeEntityId: SERVICE_ID,
        scopeEntityType: ServiceType.OpenTelemetry,
        chips: [],
        knownIds: KNOWN,
      }),
    ).toEqual([]);
    // Same without a scope type: the Service list is still what names it.
    expect(
      collectExceptionEntityChipIds({
        scopeEntityId: SERVICE_ID,
        chips: [],
        knownIds: KNOWN,
      }),
    ).toEqual([]);
  });

  test("known chip ids are dropped; unknown ones are still collected", () => {
    expect(
      collectExceptionEntityChipIds({
        chips: [
          chip("primaryEntityId", SERVICE_ID),
          chip("hostId", HOST_ID),
          chip("primaryEntityId", RUM_APP_ID),
          chip("kubernetesClusterId", CLUSTER_ID),
        ],
        knownIds: KNOWN,
      }),
    ).toEqual([RUM_APP_ID, CLUSTER_ID].sort());
  });

  test("known-ness is per facet: a Host id the Host list names still needs a name under primaryEntityId", () => {
    /*
     * The primaryEntityId chip reads its name from the Service facet only, so
     * skipping this id would leave it reading "Service: bbbbbbbb-…".
     */
    expect(
      collectExceptionEntityChipIds({
        chips: [chip("primaryEntityId", HOST_ID)],
        knownIds: KNOWN,
      }),
    ).toEqual([HOST_ID]);
    expect(
      collectExceptionEntityChipIds({
        scopeEntityId: HOST_ID,
        chips: [],
        knownIds: KNOWN,
      }),
    ).toEqual([HOST_ID]);
  });

  test("while the lists load, every id is held back", () => {
    expect(
      collectExceptionEntityChipIds({
        scopeEntityId: SERVICE_ID,
        scopeEntityType: ServiceType.OpenTelemetry,
        chips: [chip("primaryEntityId", RUM_APP_ID), chip("hostId", HOST_ID)],
        knownIds: {},
        isKnownIdsPending: true,
      }),
    ).toEqual([]);
    // An untyped scope might be a listed Service, so it waits too.
    expect(
      collectExceptionEntityChipIds({
        scopeEntityId: RUM_APP_ID,
        chips: [],
        isKnownIdsPending: true,
      }),
    ).toEqual([]);
  });

  test("a scope typed as a non-Service entity resolves promptly, even while the lists load", () => {
    for (const scopeEntityType of [
      ServiceType.RealUserMonitor,
      ServiceType.Host,
      ServiceType.KubernetesCluster,
    ]) {
      expect(
        collectExceptionEntityChipIds({
          scopeEntityId: RUM_APP_ID,
          scopeEntityType,
          chips: [chip("primaryEntityId", SERVICE_ID)],
          isKnownIdsPending: true,
        }),
      ).toEqual([RUM_APP_ID]);
    }
  });

  test("once the lists load, the held chips are released", () => {
    expect(
      collectExceptionEntityChipIds({
        scopeEntityId: RUM_APP_ID,
        scopeEntityType: ServiceType.RealUserMonitor,
        chips: [chip("primaryEntityId", UNRESOLVED_ID)],
        knownIds: KNOWN,
        isKnownIdsPending: false,
      }),
    ).toEqual([RUM_APP_ID, UNRESOLVED_ID].sort());
  });
});

describe("buildExceptionEntityTypeHints", () => {
  test("the page's scope type sends the scope id straight to its table", () => {
    expect(
      buildExceptionEntityTypeHints({
        scopeEntityId: RUM_APP_ID,
        scopeEntityType: ServiceType.RealUserMonitor,
        chips: [],
      }),
    ).toEqual({ [RUM_APP_ID]: ServiceType.RealUserMonitor });
  });

  test("without a scope type the scope id is not hinted (it may be any table)", () => {
    expect(
      buildExceptionEntityTypeHints({
        scopeEntityId: RUM_APP_ID,
        chips: [chip("primaryEntityId", SERVICE_ID)],
      }),
    ).toEqual({});
  });

  test("typed resource chips are hinted with their table; entity chips are not", () => {
    expect(
      buildExceptionEntityTypeHints({
        chips: [
          chip("hostId", HOST_ID),
          chip("dockerHostId", "docker-1"),
          chip("podmanHostId", "podman-1"),
          chip("kubernetesClusterId", CLUSTER_ID),
          chip("primaryEntityId", SERVICE_ID),
          chip("exceptionType", "TypeError"),
        ],
      }),
    ).toEqual({
      [HOST_ID]: ServiceType.Host,
      "docker-1": ServiceType.DockerHost,
      "podman-1": ServiceType.PodmanHost,
      [CLUSTER_ID]: ServiceType.KubernetesCluster,
    });
  });

  test("the page scope type wins over a chip hint for the same id", () => {
    expect(
      buildExceptionEntityTypeHints({
        scopeEntityId: HOST_ID,
        scopeEntityType: ServiceType.DockerHost,
        chips: [chip("hostId", HOST_ID)],
      }),
    ).toEqual({ [HOST_ID]: ServiceType.DockerHost });
  });
});

describe("buildExceptionFacetDisplayNames", () => {
  test("indexes server-resolved names by facet key and value", () => {
    const facetData: FacetData = {
      primaryEntityId: [
        { value: SERVICE_ID, count: 3, displayName: "checkout-api" },
        { value: PROJECT_ID, count: 1, displayName: "Unknown Service" },
        { value: UNRESOLVED_ID, count: 2 },
      ],
      exceptionType: [{ value: "TypeError", count: 4 }],
      hostId: [{ value: HOST_ID, count: 1, displayName: "  web-01 " }],
    };

    expect(buildExceptionFacetDisplayNames(facetData)).toEqual({
      primaryEntityId: {
        [SERVICE_ID]: "checkout-api",
        [PROJECT_ID]: "Unknown Service",
      },
      hostId: { [HOST_ID]: "web-01" },
    });
  });

  test("tolerates missing or empty facet data", () => {
    expect(buildExceptionFacetDisplayNames(undefined)).toEqual({});
    expect(buildExceptionFacetDisplayNames({})).toEqual({});
    expect(
      buildExceptionFacetDisplayNames({
        primaryEntityId: [{ value: SERVICE_ID, count: 1, displayName: "" }],
      }),
    ).toEqual({});
  });
});

describe("resolveExceptionChipDisplay — the locked page scope chip", () => {
  test("REGRESSION: a RUM application scope reads its type and name, not 'Service: <uuid>'", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("primaryEntityId", RUM_APP_ID, {
        displayKey: "Service",
        readOnly: true,
      }),
      config: SERVICE_FACET,
      entityNames: NAMES,
      scopeEntityId: RUM_APP_ID,
      scopeEntityType: ServiceType.RealUserMonitor,
    });

    expect(display.displayKey).toBe("RUM Application");
    expect(display.displayValue).toBe("checkout-web");
    // The filter is still the id.
    expect(display.value).toBe(RUM_APP_ID);
    expect(display.facetKey).toBe("primaryEntityId");
    expect(display.readOnly).toBe(true);
  });

  test("with a scope type the key is right immediately, before the name lands", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("primaryEntityId", RUM_APP_ID, { readOnly: true }),
      config: SERVICE_FACET,
      entityNames: {},
      scopeEntityId: RUM_APP_ID,
      scopeEntityType: ServiceType.RealUserMonitor,
    });

    expect(display.displayKey).toBe("RUM Application");
    expect(display.displayValue).toBe(RUM_APP_ID);
  });

  test("a Service page keeps 'Service' and its loaded name", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("primaryEntityId", SERVICE_ID, { readOnly: true }),
      config: SERVICE_FACET,
      entityNames: {},
      scopeEntityId: SERVICE_ID,
      scopeEntityType: ServiceType.OpenTelemetry,
    });

    expect(display.displayKey).toBe("Service");
    expect(display.displayValue).toBe("checkout-api");
  });

  test("without a scope type the key is the resolved entity's type once known", () => {
    const pending: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("primaryEntityId", RUM_APP_ID),
      config: SERVICE_FACET,
      entityNames: {},
      scopeEntityId: RUM_APP_ID,
    });
    expect(pending.displayKey).toBe("Service");
    expect(pending.displayValue).toBe(RUM_APP_ID);

    const resolved: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("primaryEntityId", RUM_APP_ID),
      config: SERVICE_FACET,
      entityNames: NAMES,
      scopeEntityId: RUM_APP_ID,
    });
    expect(resolved.displayKey).toBe("RUM Application");
    expect(resolved.displayValue).toBe("checkout-web");
  });

  test("the scope type label applies only to the scope id, not to other entity chips", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("primaryEntityId", HOST_ID),
      config: SERVICE_FACET,
      entityNames: NAMES,
      scopeEntityId: RUM_APP_ID,
      scopeEntityType: ServiceType.RealUserMonitor,
    });

    expect(display.displayKey).toBe("Host");
    expect(display.displayValue).toBe("web-01");
  });
});

describe("resolveExceptionChipDisplay — user, URL-restored and stored chips", () => {
  test("a URL-restored chip (displayKey = facetKey, displayValue = id) is renamed", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("primaryEntityId", HOST_ID),
      config: SERVICE_FACET,
      entityNames: NAMES,
    });

    expect(display.displayKey).toBe("Host");
    expect(display.displayValue).toBe("web-01");
  });

  test("the facet's own loaded Service name outranks everything", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("primaryEntityId", SERVICE_ID, {
        displayValue: "stale-name",
      }),
      config: SERVICE_FACET,
      entityNames: {
        [SERVICE_ID]: {
          id: SERVICE_ID,
          name: "resolver-name",
          entityType: ServiceType.OpenTelemetry,
          typeLabel: "Service",
        },
      },
      facetDisplayNames: { [SERVICE_ID]: "server-name" },
    });

    expect(display.displayKey).toBe("Service");
    expect(display.displayValue).toBe("checkout-api");
  });

  test("the server facet name is used before the resolver when the list missed the id", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("primaryEntityId", UNRESOLVED_ID),
      config: SERVICE_FACET,
      entityNames: {
        [UNRESOLVED_ID]: {
          id: UNRESOLVED_ID,
          name: "resolver-name",
          entityType: ServiceType.OpenTelemetry,
          typeLabel: "Service",
        },
      },
      facetDisplayNames: { [UNRESOLVED_ID]: "service-past-the-cap" },
    });

    expect(display.displayValue).toBe("service-past-the-cap");
    expect(display.displayKey).toBe("Service");
  });

  test("a name the chip was created with is kept over the resolver", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("primaryEntityId", UNRESOLVED_ID, {
        displayValue: "named-at-include",
      }),
      config: SERVICE_FACET,
      entityNames: {},
    });

    expect(display.displayValue).toBe("named-at-include");
    expect(display.displayKey).toBe("Service");
  });

  test("an unresolvable id falls back to the id under 'Service'", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("primaryEntityId", UNRESOLVED_ID),
      config: SERVICE_FACET,
      entityNames: NAMES,
    });

    expect(display.displayKey).toBe("Service");
    expect(display.displayValue).toBe(UNRESOLVED_ID);
  });

  test("the projectId bucket reads 'Service: Unknown Service'", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("primaryEntityId", PROJECT_ID),
      config: SERVICE_FACET,
      entityNames: NAMES,
    });

    expect(display.displayKey).toBe("Service");
    expect(display.displayValue).toBe("Unknown Service");
  });

  test("the legacy serviceId chip (no facet config) is named and keyed too", () => {
    const pending: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("serviceId", RUM_APP_ID),
      config: undefined,
      entityNames: {},
    });
    expect(pending.displayKey).toBe("Service");
    expect(pending.displayValue).toBe(RUM_APP_ID);

    const resolved: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("serviceId", RUM_APP_ID),
      config: undefined,
      entityNames: NAMES,
    });
    expect(resolved.displayKey).toBe("RUM Application");
    expect(resolved.displayValue).toBe("checkout-web");
    expect(resolved.facetKey).toBe("serviceId");
    expect(resolved.value).toBe(RUM_APP_ID);
  });

  test("a typed host chip keeps its facet title and gains the resolver's name", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("hostId", HOST_ID),
      config: HOST_FACET,
      entityNames: NAMES,
    });

    expect(display.displayKey).toBe("Host");
    expect(display.displayValue).toBe("web-01");
  });

  test("a typed host chip never adopts another type's label", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("hostId", RUM_APP_ID),
      config: HOST_FACET,
      entityNames: NAMES,
      scopeEntityId: RUM_APP_ID,
      scopeEntityType: ServiceType.RealUserMonitor,
    });

    expect(display.displayKey).toBe("Host");
  });
});

describe("resolveExceptionChipDisplay — non-entity chips are unchanged", () => {
  test("attribute chips show the bare attribute key", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("attributes.http.status_code", "500"),
      config: undefined,
      entityNames: NAMES,
    });

    expect(display.displayKey).toBe("http.status_code");
    expect(display.displayValue).toBe("500");
  });

  test("an attribute whose VALUE happens to be an entity id is not renamed", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("attributes.primaryEntityId", RUM_APP_ID),
      config: undefined,
      entityNames: NAMES,
    });

    expect(display.displayKey).toBe("primaryEntityId");
    expect(display.displayValue).toBe(RUM_APP_ID);
  });

  test("REGRESSION: a read-only scope attribute chip reads its friendly label, not the OTel key", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("attributes.resource.host.name", "web-01", {
        displayKey: "resource.host.name",
        readOnly: true,
      }),
      config: undefined,
      entityNames: NAMES,
    });

    expect(display.displayKey).toBe("Host");
    expect(display.displayValue).toBe("web-01");
    // The filter is untouched.
    expect(display.facetKey).toBe("attributes.resource.host.name");
    expect(display.value).toBe("web-01");
  });

  test("a read-only attribute chip with no friendly label keeps the bare key", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("attributes.http.status_code", "500", { readOnly: true }),
      config: undefined,
      entityNames: NAMES,
    });

    expect(display.displayKey).toBe("http.status_code");
  });

  test("a user-typed attribute chip keeps the literal key, even a resource one", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("attributes.resource.host.name", "web-01"),
      config: undefined,
      entityNames: NAMES,
    });

    expect(display.displayKey).toBe("resource.host.name");
  });

  test("column chips use the facet title and display map", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("errorClass", "user-error"),
      config: {
        key: "errorClass",
        title: "Error Class",
        valueDisplayMap: { "user-error": "User error" },
      },
      entityNames: NAMES,
    });

    expect(display.displayKey).toBe("Error Class");
    expect(display.displayValue).toBe("User error");
  });

  test("a chip without a config keeps what it carried", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("fingerprint", "abc", { displayKey: "Fingerprint" }),
      config: undefined,
      entityNames: NAMES,
    });

    expect(display.displayKey).toBe("Fingerprint");
    expect(display.displayValue).toBe("abc");
  });

  test("never mutates the input chip", () => {
    const input: ActiveFilter = chip("primaryEntityId", RUM_APP_ID, {
      displayKey: "Service",
    });
    const snapshot: ActiveFilter = { ...input };

    resolveExceptionChipDisplay({
      chip: input,
      config: SERVICE_FACET,
      entityNames: NAMES,
      scopeEntityId: RUM_APP_ID,
      scopeEntityType: ServiceType.RealUserMonitor,
    });

    expect(input).toEqual(snapshot);
  });
});

describe("stored incident / alert scope chips", () => {
  test("REGRESSION: a stored primaryEntityId on a RUM app renders its name, filter unchanged", () => {
    const scope: ExceptionQueryScope = buildExceptionQueryScope({
      primaryEntityId: RUM_APP_ID,
      exceptionType: "TypeError",
    });

    const entityChip: ExceptionScopeChip | undefined = scope.chips.find(
      (candidate: ExceptionScopeChip): boolean => {
        return candidate.facetKey === "primaryEntityId";
      },
    );
    expect(entityChip).toBeDefined();
    // The reader still labels the column generically and carries the id.
    expect(entityChip!.displayKey).toBe("Service");
    expect(entityChip!.displayValue).toBe(RUM_APP_ID);

    const ids: Array<string> = collectExceptionEntityChipIds({
      chips: scope.chips,
    });
    expect(ids).toEqual([RUM_APP_ID]);

    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: { ...entityChip!, readOnly: true },
      config: SERVICE_FACET,
      entityNames: NAMES,
    });
    expect(display.displayKey).toBe("RUM Application");
    expect(display.displayValue).toBe("checkout-web");

    // The instance filter the scope feeds is still the raw id.
    expect(scope.instanceScope.columnPredicates["primaryEntityId"]).toEqual([
      RUM_APP_ID,
    ]);
  });

  test("REGRESSION: a stored scope attribute chip is labelled like the logs viewer's", () => {
    const scope: ExceptionQueryScope = buildExceptionQueryScope({
      attributes: { "resource.k8s.pod.name": "checkout-7d9f" },
    });

    const attributeChip: ExceptionScopeChip | undefined = scope.chips.find(
      (candidate: ExceptionScopeChip): boolean => {
        return candidate.facetKey === "attributes.resource.k8s.pod.name";
      },
    );
    expect(attributeChip).toBeDefined();

    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: { ...attributeChip!, readOnly: true },
      config: undefined,
      entityNames: NAMES,
    });
    expect(display.displayKey).toBe("Pod");
    expect(display.displayValue).toBe("checkout-7d9f");
    // Attribute chips never reach the name resolver.
    expect(collectExceptionEntityChipIds({ chips: scope.chips })).toEqual([]);
  });

  test("stored non-entity chips are left alone", () => {
    const scope: ExceptionQueryScope = buildExceptionQueryScope({
      exceptionType: "TypeError",
    });

    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: { ...scope.chips[0]!, readOnly: true },
      config: undefined,
      entityNames: NAMES,
    });

    expect(display.displayKey).toBe("Type");
    expect(display.displayValue).toBe("TypeError");
  });
});

describe("getExceptionFacetIncludeDisplayValue", () => {
  test("prefers the facet display map", () => {
    expect(
      getExceptionFacetIncludeDisplayValue({
        value: SERVICE_ID,
        config: SERVICE_FACET,
        facetValues: [
          { value: SERVICE_ID, count: 1, displayName: "server-name" },
        ],
      }),
    ).toBe("checkout-api");
  });

  test("falls back to the server facet displayName", () => {
    expect(
      getExceptionFacetIncludeDisplayValue({
        value: UNRESOLVED_ID,
        config: SERVICE_FACET,
        facetValues: [
          { value: UNRESOLVED_ID, count: 1, displayName: "service-past-cap" },
        ],
      }),
    ).toBe("service-past-cap");
  });

  test("falls back to the raw value when nothing names it", () => {
    expect(
      getExceptionFacetIncludeDisplayValue({
        value: UNRESOLVED_ID,
        config: undefined,
        facetValues: undefined,
      }),
    ).toBe(UNRESOLVED_ID);
    expect(
      getExceptionFacetIncludeDisplayValue({
        value: UNRESOLVED_ID,
        config: SERVICE_FACET,
        facetValues: [{ value: UNRESOLVED_ID, count: 1, displayName: " " }],
      }),
    ).toBe(UNRESOLVED_ID);
  });
});

describe("every catalog resource type through the chip pipeline", () => {
  const RESOURCE_ID: string = "ffffffff-ffff-4fff-8fff-ffffffffffff";

  const RESOURCE_CONFIGS: Array<FacetConfig> = buildResourceFacetConfigs({
    basePriority: 2,
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
    "%s: a URL-restored chip is looked up in its own table and labelled with its facet title",
    (_facetKey: string, definition: ResourceFacetDefinition) => {
      const restored: ActiveFilter = chip(definition.facetKey, RESOURCE_ID);

      expect(
        collectExceptionEntityChipIds({
          chips: [restored],
          knownIds: buildExceptionKnownChipIds({
            facetConfigs: RESOURCE_CONFIGS,
            facetDisplayNames: {},
          }),
        }),
      ).toEqual([RESOURCE_ID]);

      expect(
        buildExceptionEntityTypeHints({
          chips: [restored],
        }),
      ).toEqual({ [RESOURCE_ID]: definition.serviceType });

      const config: FacetConfig | undefined = RESOURCE_CONFIGS.find(
        (candidate: FacetConfig): boolean => {
          return candidate.key === definition.facetKey;
        },
      );
      expect(config).toBeDefined();

      const display: ActiveFilter = resolveExceptionChipDisplay({
        chip: restored,
        config,
        entityNames: {
          [RESOURCE_ID]: {
            id: RESOURCE_ID,
            name: "resolved-name",
            entityType: definition.serviceType,
            typeLabel: definition.label,
          },
        },
      });

      expect(display.displayKey).toBe(definition.label);
      expect(display.displayValue).toBe("resolved-name");
      // Display only: the filter still carries the key and id it came with.
      expect(display.facetKey).toBe(definition.facetKey);
      expect(display.value).toBe(RESOURCE_ID);
    },
  );

  test("a server facet name for a new resource type means no lookup is needed", () => {
    const facetDisplayNames: Record<
      string,
      Record<string, string>
    > = buildExceptionFacetDisplayNames({
      proxmoxClusterId: [
        { value: RESOURCE_ID, count: 0, displayName: "pve-prod" },
      ],
    });

    const knownIds: ExceptionKnownChipIds = buildExceptionKnownChipIds({
      facetConfigs: RESOURCE_CONFIGS,
      facetDisplayNames,
    });

    expect(Array.from(knownIds["proxmoxClusterId"] || [])).toEqual([
      RESOURCE_ID,
    ]);
    expect(
      collectExceptionEntityChipIds({
        chips: [chip("proxmoxClusterId", RESOURCE_ID)],
        knownIds,
      }),
    ).toEqual([]);

    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("proxmoxClusterId", RESOURCE_ID),
      config: RESOURCE_CONFIGS.find((candidate: FacetConfig): boolean => {
        return candidate.key === "proxmoxClusterId";
      }),
      entityNames: undefined,
      facetDisplayNames: facetDisplayNames["proxmoxClusterId"],
    });
    expect(display.displayKey).toBe("Proxmox Cluster");
    expect(display.displayValue).toBe("pve-prod");
  });

  test("known-ness stays per facet: a vCenter name does not name the same id under iotFleetId", () => {
    const knownIds: ExceptionKnownChipIds = buildExceptionKnownChipIds({
      facetConfigs: RESOURCE_CONFIGS,
      facetDisplayNames: {
        vmwareVCenterId: { [RESOURCE_ID]: "vc-01" },
      },
    });

    expect(
      collectExceptionEntityChipIds({
        chips: [chip("iotFleetId", RESOURCE_ID)],
        knownIds,
      }),
    ).toEqual([RESOURCE_ID]);
  });

  test("without a facet config a new resource chip reads its catalog label, not the raw key", () => {
    for (const definition of RESOURCE_FACET_CATALOG) {
      const display: ActiveFilter = resolveExceptionChipDisplay({
        chip: chip(definition.facetKey, RESOURCE_ID),
        config: undefined,
        entityNames: undefined,
      });

      expect(display.displayKey).toBe(definition.label);
      expect(display.displayKey).not.toBe(definition.facetKey);
      // Nothing names the id: the id itself, never a wrong name.
      expect(display.displayValue).toBe(RESOURCE_ID);
    }
  });

  test("an IoT fleet chip never adopts the page scope's type label", () => {
    const display: ActiveFilter = resolveExceptionChipDisplay({
      chip: chip("iotFleetId", RUM_APP_ID),
      config: undefined,
      entityNames: NAMES,
      scopeEntityId: RUM_APP_ID,
      scopeEntityType: ServiceType.RealUserMonitor,
    });

    expect(display.displayKey).toBe("IoT Fleet");
  });

  test("the scope type hint still wins over a new resource chip's hint for the same id", () => {
    expect(
      buildExceptionEntityTypeHints({
        scopeEntityId: RESOURCE_ID,
        scopeEntityType: ServiceType.CephCluster,
        chips: [chip("serverlessFunctionId", RESOURCE_ID)],
      }),
    ).toEqual({ [RESOURCE_ID]: ServiceType.CephCluster });
  });

  test("the facet include uses the server displayName for a type without a preloaded list", () => {
    expect(
      getExceptionFacetIncludeDisplayValue({
        value: RESOURCE_ID,
        config: RESOURCE_CONFIGS.find((candidate: FacetConfig): boolean => {
          return candidate.key === "cloudResourceId";
        }),
        facetValues: [
          { value: RESOURCE_ID, count: 3, displayName: "  orders-bucket  " },
        ],
      }),
    ).toBe("orders-bucket");
  });
});
