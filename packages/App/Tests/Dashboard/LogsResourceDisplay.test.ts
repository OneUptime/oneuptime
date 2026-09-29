/*
 * Naming resources on the Logs Insights page and in its error-pattern
 * drawer. Those rows are keyed on a polymorphic `primaryEntityId`; the page
 * only loads Services, so a RUM application, host or cluster used to show
 * as a raw UUID — with the raw "RealUserMonitor" enum beside it. These tests
 * pin the fallback to the generic resolver and the enum -> label mapping.
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
import {
  RESOURCE_FACET_CATALOG,
  RESOURCE_FACET_CATALOG_KEYS,
  ResourceFacetDefinition,
} from "Common/Types/Telemetry/ResourceFacetCatalog";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  TELEMETRY_ENTITY_TYPES,
  TelemetryEntityNameMap,
} from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import {
  LOGS_SCOPE_FACET_ENTITY_TYPES,
  TOP_ERROR_PATTERN_RESOURCE_LABEL_LIMIT,
  LogsResourceRef,
  buildLogsResourceTypeHints,
  collectLogsInsightsResourceRefs,
  collectLogsResourceIds,
  decodeLogsScopeSelection,
  describeLogsResource,
  getDisplayedErrorPatternResourceIds,
  labelErrorPatternResources,
  labelLogsScopeOption,
  toServiceType,
} from "../../FeatureSet/Dashboard/src/Components/Logs/LogsResourceDisplay";

/*
 * Mirrors Utils/LogsInsights encodeScopeSelection (`<facetKey>:<id>`). Not
 * imported: that module pulls in browser-only config App's node env lacks.
 */
type EncodeScopeSelectionFunction = (facetKey: string, value: string) => string;

const encodeScopeSelection: EncodeScopeSelectionFunction = (
  facetKey: string,
  value: string,
): string => {
  return `${facetKey}:${value}`;
};

const RUM_APP_ID: string = "84858d6c-1111-4111-8111-111111111111";
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const CLUSTER_ID: string = "55555555-5555-4555-8555-555555555555";
const UNRESOLVED_ID: string = "44444444-4444-4444-8444-444444444444";

const NAME_MAP: TelemetryEntityNameMap = {
  [RUM_APP_ID]: {
    id: RUM_APP_ID,
    name: "checkout-web",
    entityType: ServiceType.RealUserMonitor,
    typeLabel: "RUM Application",
  },
  [HOST_ID]: {
    id: HOST_ID,
    name: "web-01",
    entityType: ServiceType.Host,
    typeLabel: "Host",
  },
  [CLUSTER_ID]: {
    id: CLUSTER_ID,
    name: "prod-eks",
    entityType: ServiceType.KubernetesCluster,
    typeLabel: "Kubernetes Cluster",
  },
};

describe("toServiceType", () => {
  test.each(Object.values(ServiceType))(
    "recognises %p",
    (value: ServiceType) => {
      expect(toServiceType(value)).toBe(value);
    },
  );

  test.each([undefined, null, "", "  ", "service", "Rum", "hostId"])(
    "rejects %p",
    (value: string | null | undefined) => {
      expect(toServiceType(value)).toBeUndefined();
    },
  );

  test("tolerates surrounding whitespace", () => {
    expect(toServiceType(" Host ")).toBe(ServiceType.Host);
  });
});

describe("LOGS_SCOPE_FACET_ENTITY_TYPES", () => {
  test("typed resource facets hint their table; primaryEntityId is polymorphic", () => {
    expect(LOGS_SCOPE_FACET_ENTITY_TYPES).toEqual({
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
      /*
       * IoT fleet telemetry is stamped IoTDevice with the fleet id; the
       * resolver's IoTDevice entry reads the IoTFleet table.
       */
      iotFleetId: ServiceType.IoTDevice,
      databaseServerId: ServiceType.DatabaseServer,
    });
    expect(LOGS_SCOPE_FACET_ENTITY_TYPES["primaryEntityId"]).toBeUndefined();
    expect(LOGS_SCOPE_FACET_ENTITY_TYPES["serviceId"]).toBeUndefined();
  });

  test("covers exactly the resource facet catalog, in catalog order", () => {
    expect(Object.keys(LOGS_SCOPE_FACET_ENTITY_TYPES)).toEqual([
      ...RESOURCE_FACET_CATALOG_KEYS,
    ]);
  });

  test.each(
    RESOURCE_FACET_CATALOG.map(
      (definition: ResourceFacetDefinition): [string, ServiceType, string] => {
        return [definition.facetKey, definition.serviceType, definition.label];
      },
    ),
  )(
    "%s hints %s, a table the resolver can read and label %p",
    (facetKey: string, serviceType: ServiceType, label: string) => {
      expect(LOGS_SCOPE_FACET_ENTITY_TYPES[facetKey]).toBe(serviceType);
      expect(toServiceType(serviceType)).toBe(serviceType);
      expect(TELEMETRY_ENTITY_TYPES[serviceType].modelType).toBeDefined();
      expect(TELEMETRY_ENTITY_TYPES[serviceType].label).toBe(label);
    },
  );
});

describe("collectLogsResourceIds", () => {
  test("unique, trimmed, sorted, blanks dropped", () => {
    const refs: Array<LogsResourceRef> = [
      { resourceId: HOST_ID },
      { resourceId: ` ${RUM_APP_ID} ` },
      { resourceId: HOST_ID, resourceType: "Host" },
      { resourceId: "" },
    ];

    expect(collectLogsResourceIds(refs)).toEqual([HOST_ID, RUM_APP_ID].sort());
  });

  test("ids the page can already name are not resolved again", () => {
    const refs: Array<LogsResourceRef> = [
      { resourceId: SERVICE_ID },
      { resourceId: RUM_APP_ID },
    ];

    expect(
      collectLogsResourceIds(refs, (id: string): boolean => {
        return id === SERVICE_ID;
      }),
    ).toEqual([RUM_APP_ID]);
  });

  test("nothing to collect", () => {
    expect(collectLogsResourceIds(undefined)).toEqual([]);
    expect(collectLogsResourceIds([])).toEqual([]);
  });
});

describe("buildLogsResourceTypeHints", () => {
  test("hints each id to the type the server reported", () => {
    expect(
      buildLogsResourceTypeHints([
        { resourceId: RUM_APP_ID, resourceType: "RealUserMonitor" },
        { resourceId: HOST_ID, resourceType: "Host" },
        { resourceId: SERVICE_ID },
        { resourceId: UNRESOLVED_ID, resourceType: "NotAType" },
      ]),
    ).toEqual({
      [RUM_APP_ID]: ServiceType.RealUserMonitor,
      [HOST_ID]: ServiceType.Host,
    });
  });

  test("the first reported type for an id wins", () => {
    expect(
      buildLogsResourceTypeHints([
        { resourceId: HOST_ID, resourceType: "Host" },
        { resourceId: HOST_ID, resourceType: "DockerHost" },
      ]),
    ).toEqual({ [HOST_ID]: ServiceType.Host });
  });

  test("nothing to hint is undefined, so the hook's options stay stable", () => {
    expect(buildLogsResourceTypeHints(undefined)).toBeUndefined();
    expect(buildLogsResourceTypeHints([])).toBeUndefined();
    expect(
      buildLogsResourceTypeHints([{ resourceId: SERVICE_ID }]),
    ).toBeUndefined();
    expect(
      buildLogsResourceTypeHints([{ resourceId: "", resourceType: "Host" }]),
    ).toBeUndefined();
  });
});

describe("describeLogsResource", () => {
  test("the regression: a RUM application shows its name and 'RUM Application', not the enum", () => {
    expect(
      describeLogsResource({
        resourceId: RUM_APP_ID,
        resourceType: "RealUserMonitor",
        nameMap: NAME_MAP,
      }),
    ).toEqual({ name: "checkout-web", typeLabel: "RUM Application" });
  });

  test.each([
    ["OpenTelemetry", "Service"],
    ["Host", "Host"],
    ["DockerHost", "Docker Host"],
    ["PodmanHost", "Podman Host"],
    ["KubernetesCluster", "Kubernetes Cluster"],
    ["ProxmoxCluster", "Proxmox Cluster"],
    ["CephCluster", "Ceph Cluster"],
    ["DockerSwarmCluster", "Docker Swarm Cluster"],
    ["VMwareVCenter", "vCenter"],
    ["IoTDevice", "IoT Fleet"],
    ["ServerlessFunction", "Serverless Function"],
    ["CloudResource", "Cloud Resource"],
    ["NetworkDevice", "Network Device"],
    ["RealUserMonitor", "RUM Application"],
    ["DatabaseServer", "Database"],
    ["Unknown", "Service"],
  ])(
    "server type %p is labelled %p",
    (resourceType: string, typeLabel: string) => {
      expect(
        describeLogsResource({
          resourceId: UNRESOLVED_ID,
          resourceType,
          nameMap: {},
        }).typeLabel,
      ).toBe(typeLabel);
    },
  );

  test("the page's loaded Service name wins over the resolver", () => {
    expect(
      describeLogsResource({
        resourceId: SERVICE_ID,
        resourceType: "OpenTelemetry",
        nameMap: {
          [SERVICE_ID]: {
            id: SERVICE_ID,
            name: "resolver-name",
            entityType: ServiceType.OpenTelemetry,
            typeLabel: "Service",
          },
        },
        knownName: "payments-api",
      }),
    ).toEqual({ name: "payments-api", typeLabel: "Service" });
  });

  test("no server type: the resolver's type", () => {
    expect(
      describeLogsResource({ resourceId: CLUSTER_ID, nameMap: NAME_MAP }),
    ).toEqual({ name: "prod-eks", typeLabel: "Kubernetes Cluster" });
  });

  test("unnameable: the id, and no invented type", () => {
    expect(
      describeLogsResource({ resourceId: UNRESOLVED_ID, nameMap: undefined }),
    ).toEqual({ name: UNRESOLVED_ID, typeLabel: "" });
  });

  test("an unrecognised server type is shown as-is rather than mislabelled 'Service'", () => {
    expect(
      describeLogsResource({
        resourceId: UNRESOLVED_ID,
        resourceType: "SomethingNew",
        nameMap: {},
      }).typeLabel,
    ).toBe("SomethingNew");
  });

  test("a blank known name does not shadow the resolver", () => {
    expect(
      describeLogsResource({
        resourceId: HOST_ID,
        nameMap: NAME_MAP,
        knownName: "   ",
      }).name,
    ).toBe("web-01");
  });
});

describe("decodeLogsScopeSelection", () => {
  test("round-trips the picker's <facetKey>:<id> encoding", () => {
    for (const facetKey of [
      "primaryEntityId",
      "hostId",
      "kubernetesClusterId",
    ]) {
      expect(
        decodeLogsScopeSelection(encodeScopeSelection(facetKey, HOST_ID)),
      ).toEqual({ facetKey, id: HOST_ID });
    }
  });

  test("splits on the first colon only", () => {
    expect(decodeLogsScopeSelection("hostId:a:b")).toEqual({
      facetKey: "hostId",
      id: "a:b",
    });
  });

  test("a bare value is all id", () => {
    expect(decodeLogsScopeSelection(HOST_ID)).toEqual({
      facetKey: "",
      id: HOST_ID,
    });
  });
});

describe("labelLogsScopeOption", () => {
  test("loaded Service name first", () => {
    expect(
      labelLogsScopeOption({
        id: SERVICE_ID,
        nameMap: NAME_MAP,
        knownName: "payments-api",
        facetDisplayName: "server-name",
      }),
    ).toBe("payments-api");
  });

  test("then the server's facet name", () => {
    expect(
      labelLogsScopeOption({
        id: HOST_ID,
        nameMap: NAME_MAP,
        facetDisplayName: "web-01.internal",
      }),
    ).toBe("web-01.internal");
  });

  test("a facet name that only echoes the id falls through to the resolver", () => {
    expect(
      labelLogsScopeOption({
        id: RUM_APP_ID,
        nameMap: NAME_MAP,
        facetDisplayName: RUM_APP_ID,
      }),
    ).toBe("checkout-web");
  });

  test("a selection whose option left the facet list is still named", () => {
    expect(labelLogsScopeOption({ id: CLUSTER_ID, nameMap: NAME_MAP })).toBe(
      "prod-eks",
    );
  });

  test("nothing can name it: the id", () => {
    expect(labelLogsScopeOption({ id: UNRESOLVED_ID, nameMap: {} })).toBe(
      UNRESOLVED_ID,
    );
  });
});

describe("collectLogsInsightsResourceRefs", () => {
  test("cards, unnamed facet values (typed by facet) and uncovered selections", () => {
    const refs: Array<LogsResourceRef> = collectLogsInsightsResourceRefs({
      breakdownResourceIds: [RUM_APP_ID, SERVICE_ID],
      scopeFacets: {
        primaryEntityId: [
          { value: SERVICE_ID, displayName: "payments-api" },
          { value: RUM_APP_ID, displayName: RUM_APP_ID },
        ],
        hostId: [{ value: HOST_ID, displayName: HOST_ID }],
        kubernetesClusterId: [{ value: CLUSTER_ID, displayName: "prod-eks" }],
      },
      selectedScopeValues: [
        encodeScopeSelection("primaryEntityId", SERVICE_ID),
        encodeScopeSelection("kubernetesClusterId", CLUSTER_ID),
        encodeScopeSelection("dockerHostId", UNRESOLVED_ID),
      ],
    });

    expect(refs).toEqual([
      { resourceId: RUM_APP_ID },
      { resourceId: SERVICE_ID },
      { resourceId: RUM_APP_ID, resourceType: undefined },
      { resourceId: HOST_ID, resourceType: ServiceType.Host },
      { resourceId: UNRESOLVED_ID, resourceType: ServiceType.DockerHost },
    ]);
  });

  test("feeds the hint builder: facet-typed ids go to their own table", () => {
    const refs: Array<LogsResourceRef> = collectLogsInsightsResourceRefs({
      breakdownResourceIds: [],
      scopeFacets: {
        podmanHostId: [{ value: HOST_ID, displayName: "" }],
      },
      selectedScopeValues: [],
    });

    expect(buildLogsResourceTypeHints(refs)).toEqual({
      [HOST_ID]: ServiceType.PodmanHost,
    });
  });

  test("an empty page collects nothing", () => {
    expect(
      collectLogsInsightsResourceRefs({
        breakdownResourceIds: [],
        scopeFacets: {},
        selectedScopeValues: [],
      }),
    ).toEqual([]);
  });

  test.each(
    RESOURCE_FACET_CATALOG.map(
      (definition: ResourceFacetDefinition): [string, ServiceType] => {
        return [definition.facetKey, definition.serviceType];
      },
    ),
  )(
    "an unnamed %s picker option is hinted to %s",
    (facetKey: string, serviceType: ServiceType) => {
      const refs: Array<LogsResourceRef> = collectLogsInsightsResourceRefs({
        breakdownResourceIds: [],
        scopeFacets: {
          [facetKey]: [{ value: UNRESOLVED_ID, displayName: UNRESOLVED_ID }],
        },
        selectedScopeValues: [],
      });

      expect(refs).toEqual([
        { resourceId: UNRESOLVED_ID, resourceType: serviceType },
      ]);
      expect(buildLogsResourceTypeHints(refs)).toEqual({
        [UNRESOLVED_ID]: serviceType,
      });
    },
  );

  test.each(
    RESOURCE_FACET_CATALOG.map(
      (definition: ResourceFacetDefinition): [string, ServiceType] => {
        return [definition.facetKey, definition.serviceType];
      },
    ),
  )(
    "a %s selection whose option left the list is still hinted to %s",
    (facetKey: string, serviceType: ServiceType) => {
      const refs: Array<LogsResourceRef> = collectLogsInsightsResourceRefs({
        breakdownResourceIds: [],
        scopeFacets: {},
        selectedScopeValues: [encodeScopeSelection(facetKey, UNRESOLVED_ID)],
      });

      expect(buildLogsResourceTypeHints(refs)).toEqual({
        [UNRESOLVED_ID]: serviceType,
      });
    },
  );

  test("a named new-type option is not looked up again", () => {
    const refs: Array<LogsResourceRef> = collectLogsInsightsResourceRefs({
      breakdownResourceIds: [],
      scopeFacets: {
        proxmoxClusterId: [{ value: CLUSTER_ID, displayName: "pve-lab" }],
        iotFleetId: [{ value: UNRESOLVED_ID, displayName: "" }],
      },
      selectedScopeValues: [
        encodeScopeSelection("proxmoxClusterId", CLUSTER_ID),
      ],
    });

    expect(refs).toEqual([
      { resourceId: UNRESOLVED_ID, resourceType: ServiceType.IoTDevice },
    ]);
  });
});

/*
 * "Top errors" on the Logs Insights page labelled each pattern's sources
 * from the Service list only, so a pattern seen on a RUM application read
 * "2 sources · 84858d6c-…, payments-api" while the drawer it opened named
 * both. The rows' ids are now part of the page's one name lookup.
 */
describe("Top errors resource labels", () => {
  test("a row names at most two of its resources inline", () => {
    expect(TOP_ERROR_PATTERN_RESOURCE_LABEL_LIMIT).toBe(2);
    expect(
      getDisplayedErrorPatternResourceIds([
        RUM_APP_ID,
        SERVICE_ID,
        HOST_ID,
        CLUSTER_ID,
      ]),
    ).toEqual([RUM_APP_ID, SERVICE_ID]);
    expect(getDisplayedErrorPatternResourceIds([HOST_ID])).toEqual([HOST_ID]);
    expect(getDisplayedErrorPatternResourceIds([])).toEqual([]);
    expect(getDisplayedErrorPatternResourceIds(undefined)).toEqual([]);
  });

  test("the displayed pattern ids are collected for the lookup, untyped", () => {
    const refs: Array<LogsResourceRef> = collectLogsInsightsResourceRefs({
      breakdownResourceIds: [SERVICE_ID],
      errorPatterns: [
        { resourceIds: [RUM_APP_ID, HOST_ID, CLUSTER_ID] },
        { resourceIds: [] },
        { resourceIds: [UNRESOLVED_ID] },
      ],
      scopeFacets: {},
      selectedScopeValues: [],
    });

    expect(refs).toEqual([
      { resourceId: SERVICE_ID },
      { resourceId: RUM_APP_ID },
      { resourceId: HOST_ID },
      { resourceId: UNRESOLVED_ID },
    ]);

    // The third id is never printed, so it is never looked up.
    expect(
      refs.some((ref: LogsResourceRef): boolean => {
        return ref.resourceId === CLUSTER_ID;
      }),
    ).toBe(false);

    // Deduplicated and the Service-named id skipped, as for the cards.
    expect(
      collectLogsResourceIds(
        [...refs, { resourceId: RUM_APP_ID }],
        (resourceId: string): boolean => {
          return resourceId === SERVICE_ID;
        },
      ),
    ).toEqual([HOST_ID, RUM_APP_ID, UNRESOLVED_ID].sort());
  });

  test("a pattern-only id does not become a type hint (it has no reported type)", () => {
    const refs: Array<LogsResourceRef> = collectLogsInsightsResourceRefs({
      breakdownResourceIds: [],
      errorPatterns: [{ resourceIds: [HOST_ID] }],
      scopeFacets: { hostId: [{ value: HOST_ID, displayName: HOST_ID }] },
      selectedScopeValues: [],
    });

    // The facet still types the same id.
    expect(buildLogsResourceTypeHints(refs)).toEqual({
      [HOST_ID]: ServiceType.Host,
    });
    expect(
      buildLogsResourceTypeHints(
        collectLogsInsightsResourceRefs({
          breakdownResourceIds: [],
          errorPatterns: [{ resourceIds: [RUM_APP_ID] }],
          scopeFacets: {},
          selectedScopeValues: [],
        }),
      ),
    ).toBeUndefined();
  });

  test("omitting errorPatterns keeps the previous collection", () => {
    expect(
      collectLogsInsightsResourceRefs({
        breakdownResourceIds: [HOST_ID],
        errorPatterns: undefined,
        scopeFacets: {},
        selectedScopeValues: [],
      }),
    ).toEqual([{ resourceId: HOST_ID }]);
  });

  test("labels: loaded Service first, then the resolver, then the id", () => {
    expect(
      labelErrorPatternResources({
        resourceIds: [SERVICE_ID, RUM_APP_ID],
        nameMap: NAME_MAP,
        getKnownName: (resourceId: string): string | undefined => {
          return resourceId === SERVICE_ID ? "payments-api" : undefined;
        },
      }),
    ).toEqual(["payments-api", "checkout-web"]);

    expect(
      labelErrorPatternResources({
        resourceIds: [HOST_ID, UNRESOLVED_ID, CLUSTER_ID],
        nameMap: NAME_MAP,
      }),
    ).toEqual(["web-01", UNRESOLVED_ID]);
  });

  test("the loaded Service name wins over a resolved name for the same id", () => {
    expect(
      labelErrorPatternResources({
        resourceIds: [RUM_APP_ID],
        nameMap: NAME_MAP,
        getKnownName: (): string => {
          return "  from-service-list  ";
        },
      }),
    ).toEqual(["from-service-list"]);
  });

  test("before names land (no map yet) the row still shows the ids", () => {
    expect(
      labelErrorPatternResources({
        resourceIds: [RUM_APP_ID, HOST_ID],
        nameMap: undefined,
        getKnownName: (): undefined => {
          return undefined;
        },
      }),
    ).toEqual([RUM_APP_ID, HOST_ID]);
    expect(
      labelErrorPatternResources({
        resourceIds: undefined,
        nameMap: NAME_MAP,
      }),
    ).toEqual([]);
  });
});
