/*
 * A span's `primaryEntityId` is polymorphic — a RUM application's spans carry
 * the RumApplication id, agent host spans the Host id — but the traces
 * explorer only ever loaded Services. So on a RUM application's traces tab
 * the locked chip read "Service: 84858d6c-…", every row read "unknown
 * service", and the analytics "Service" split was a legend of UUIDs.
 *
 * TracesEntityDisplay is the renderer-free half of the fix. These tests pin
 * the display rules one by one AND the invariant that matters most: a chip's
 * facetKey / value — what the query, the URL and saved views are built
 * from — never change. Only displayKey / displayValue do.
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
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import Service from "Common/Models/DatabaseModels/Service";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
} from "Common/UI/Components/TelemetryViewer/types";
import TelemetryEntityNameResolver, {
  ResolvedTelemetryEntity,
  TelemetryEntityNameMap,
} from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import {
  SpanQueryScope,
  SpanScopeChip,
  buildSpanQueryScope,
} from "../../FeatureSet/Dashboard/src/Utils/SpanQueryScope";
import { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
import { parseTraceSearch } from "../../FeatureSet/Dashboard/src/Components/Traces/TracesSearchCompile";
import {
  LOCKED_FILTER_SOURCE_PAGE,
  LOCKED_FILTER_SOURCE_STORED_QUERY,
  buildLockedScopeCopyText,
  describeLockedEntityKeyFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";
import { LockedEntityKeyDisplayMap } from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  AttributeEntityScope,
  TRACE_ANALYTICS_EMPTY_GROUP_LABEL,
  TRACE_ENTITY_FACET_KEYS,
  TRACE_PRIMARY_ENTITY_FACET_KEY,
  UNKNOWN_SPAN_ENTITY_NAME,
  buildFacetDisplayNames,
  buildLockedAttributeChip,
  buildTraceEntityTypeHints,
  buildTracesLockedEntityKeyChips,
  describeStoredQueryChip,
  entityScopeForAttributeKey,
  collectTraceAnalyticsEntityIds,
  collectTraceEntityIdsToResolve,
  formatTraceAnalyticsGroupValue,
  getSpanEntity,
  getSpanEntityDisplay,
  getTraceEntityChipDisplay,
  getReadOnlyAttributeChipDisplayKey,
  getTraceAnalyticsGroupIdentityKey,
  getTraceAnalyticsGroupTypeLabel,
  getTraceEntityOptionLabel,
  buildTraceAnalyticsGroupLabels,
  buildTraceAnalyticsValueLabels,
  pivotTraceAnalyticsTimeseries,
  TraceAnalyticsPivotedRow,
  isResolvableEntityId,
  isTraceEntityFacetKey,
  resolveTraceChipDisplay,
} from "../../FeatureSet/Dashboard/src/Components/Traces/TracesEntityDisplay";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  ATTRIBUTE_DISPLAY_NAMES,
  getAttributeDisplayName,
} from "../../FeatureSet/Dashboard/src/Components/Logs/LogsAttributeFilterChips";
import { beforeEach, describe, expect, test } from "@jest/globals";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const RUM_ID: string = "84858d6c-3333-4333-8333-333333333333";
const HOST_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_ID: string = "55555555-5555-4555-8555-555555555555";

const RUM_ENTITY: ResolvedTelemetryEntity = {
  id: RUM_ID,
  name: "checkout-web",
  entityType: ServiceType.RealUserMonitor,
  typeLabel: "RUM Application",
};

const HOST_ENTITY: ResolvedTelemetryEntity = {
  id: HOST_ID,
  name: "ip-10-0-0-12",
  entityType: ServiceType.Host,
  typeLabel: "Host",
};

const SERVICE_ENTITY: ResolvedTelemetryEntity = {
  id: SERVICE_ID,
  name: "checkout-api",
  entityType: ServiceType.OpenTelemetry,
  typeLabel: "Service",
};

const UNKNOWN_ENTITY: ResolvedTelemetryEntity = {
  id: PROJECT_ID,
  name: "Unknown Service",
  entityType: ServiceType.Unknown,
  typeLabel: "Service",
};

/*
 * The shape TracesViewer builds: the Services facet (names from the loaded
 * Service list), the Status facet, the Has Exception facet, Span Name.
 */
const SERVICE_NAME_MAP: Record<string, string> = {
  [SERVICE_ID]: "checkout-api",
};

const FACET_CONFIGS: Array<FacetConfig> = [
  {
    key: "primaryEntityId",
    title: "Service",
    valueDisplayMap: SERVICE_NAME_MAP,
    priority: 1,
    serverSearchable: true,
  },
  {
    key: "statusCode",
    title: "Status",
    valueDisplayMap: { "0": "Unset", "1": "Ok", "2": "Error" },
    priority: 6,
  },
  {
    key: "hasException",
    title: "Has Exception",
    valueDisplayMap: { true: "Has exception" },
    priority: 6.7,
  },
  { key: "name", title: "Span Name", priority: 7.5 },
];

function chip(
  facetKey: string,
  value: string,
  overrides: Partial<ActiveFilter> = {},
): ActiveFilter {
  return {
    facetKey,
    value,
    displayKey: facetKey,
    displayValue: value,
    ...overrides,
  };
}

function nameMap(
  ...entities: Array<ResolvedTelemetryEntity>
): TelemetryEntityNameMap {
  const map: TelemetryEntityNameMap = {};
  for (const entity of entities) {
    map[entity.id] = entity;
  }
  return map;
}

describe("entity facet keys", () => {
  test("primaryEntityId and the legacy serviceId alias both name an entity", () => {
    expect(TRACE_PRIMARY_ENTITY_FACET_KEY).toBe("primaryEntityId");
    expect(Array.from(TRACE_ENTITY_FACET_KEYS).sort()).toEqual([
      "primaryEntityId",
      "serviceId",
    ]);
    expect(isTraceEntityFacetKey("primaryEntityId")).toBe(true);
    expect(isTraceEntityFacetKey("serviceId")).toBe(true);
  });

  test.each([
    "hostId",
    "statusCode",
    "attributes.primaryEntityId",
    "entityKeys",
    "PrimaryEntityId",
    "",
  ])("%s is not an entity chip", (facetKey: string) => {
    expect(isTraceEntityFacetKey(facetKey)).toBe(false);
  });

  test("only UUID-shaped values are looked up", () => {
    expect(isResolvableEntityId(RUM_ID)).toBe(true);
    expect(isResolvableEntityId(PROJECT_ID)).toBe(true);
    expect(isResolvableEntityId("")).toBe(false);
    // What a user typed after `service:`.
    expect(isResolvableEntityId("api")).toBe(false);
    // A name the analytics endpoint already swapped in for a Service id.
    expect(isResolvableEntityId("checkout-api")).toBe(false);
  });
});

describe("buildFacetDisplayNames", () => {
  test("indexes server displayNames by facet and value, skipping unnamed values", () => {
    const facetData: FacetData = {
      primaryEntityId: [
        { value: SERVICE_ID, count: 3, displayName: "checkout-api" },
        { value: RUM_ID, count: 1 },
      ],
      statusCode: [{ value: "2", count: 4 }],
    };

    expect(buildFacetDisplayNames(facetData)).toEqual({
      primaryEntityId: { [SERVICE_ID]: "checkout-api" },
    });
  });

  test("tolerates no facet data at all", () => {
    expect(buildFacetDisplayNames(undefined)).toEqual({});
    expect(buildFacetDisplayNames({})).toEqual({});
  });
});

describe("buildTraceEntityTypeHints", () => {
  test("hints the scope id to the table the host declared", () => {
    expect(
      buildTraceEntityTypeHints(
        new ObjectID(RUM_ID),
        ServiceType.RealUserMonitor,
      ),
    ).toEqual({ [RUM_ID]: ServiceType.RealUserMonitor });
  });

  test("no hint without both an id and a declared type", () => {
    expect(buildTraceEntityTypeHints(RUM_ID, undefined)).toEqual({});
    expect(
      buildTraceEntityTypeHints(undefined, ServiceType.RealUserMonitor),
    ).toEqual({});
    expect(buildTraceEntityTypeHints("  ", ServiceType.Host)).toEqual({});
  });
});

describe("collectTraceEntityIdsToResolve", () => {
  test("collects the value of every entity chip, sorted and de-duplicated", () => {
    expect(
      collectTraceEntityIdsToResolve({
        chips: [
          chip("primaryEntityId", RUM_ID),
          chip("serviceId", HOST_ID),
          chip("primaryEntityId", RUM_ID),
        ],
      }),
    ).toEqual([HOST_ID, RUM_ID].sort());
  });

  test("ignores chips on other columns even when their value is a UUID", () => {
    expect(
      collectTraceEntityIdsToResolve({
        chips: [
          chip("hostId", HOST_ID),
          chip("traceId", OTHER_ID),
          chip(`attributes.resource.service.id`, RUM_ID),
        ],
      }),
    ).toEqual([]);
  });

  test("skips ids an existing name source already covers", () => {
    expect(
      collectTraceEntityIdsToResolve({
        chips: [
          chip("primaryEntityId", SERVICE_ID),
          chip("primaryEntityId", OTHER_ID),
          chip("primaryEntityId", RUM_ID),
        ],
        knownNames: [SERVICE_NAME_MAP, { [OTHER_ID]: "billing" }, undefined],
      }),
    ).toEqual([RUM_ID]);
  });

  test("skips typed non-id values", () => {
    expect(
      collectTraceEntityIdsToResolve({
        chips: [chip("primaryEntityId", "api")],
      }),
    ).toEqual([]);
  });

  test("span ids are only included once the Service list has landed", () => {
    const spanEntityIds: Array<ObjectID | string | null | undefined> = [
      new ObjectID(HOST_ID),
      SERVICE_ID,
      null,
      undefined,
      "",
      HOST_ID,
    ];

    expect(
      collectTraceEntityIdsToResolve({
        chips: [chip("primaryEntityId", RUM_ID)],
        spanEntityIds,
        knownNames: [SERVICE_NAME_MAP],
        includeSpanEntityIds: false,
      }),
    ).toEqual([RUM_ID]);

    expect(
      collectTraceEntityIdsToResolve({
        chips: [chip("primaryEntityId", RUM_ID)],
        spanEntityIds,
        knownNames: [SERVICE_NAME_MAP],
        includeSpanEntityIds: true,
      }),
    ).toEqual([HOST_ID, RUM_ID].sort());
  });

  test("includes the stored-query scope's entity chips", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      primaryEntityId: RUM_ID,
      traceId: OTHER_ID,
    });

    expect(
      collectTraceEntityIdsToResolve({
        chips: scope.chips as Array<SpanScopeChip>,
      }),
    ).toEqual([RUM_ID]);
  });
});

describe("getTraceEntityChipDisplay", () => {
  test("a declared scope type labels the chip before the name resolves", () => {
    expect(
      getTraceEntityChipDisplay({
        id: RUM_ID,
        facetTitle: "Service",
        fallbackValue: RUM_ID,
        entityNames: {},
        scopeEntityId: RUM_ID,
        scopeEntityType: ServiceType.RealUserMonitor,
      }),
    ).toEqual({ key: "RUM Application", value: RUM_ID });
  });

  test("and names it once it does", () => {
    expect(
      getTraceEntityChipDisplay({
        id: RUM_ID,
        facetTitle: "Service",
        fallbackValue: RUM_ID,
        entityNames: nameMap(RUM_ENTITY),
        scopeEntityId: RUM_ID,
        scopeEntityType: ServiceType.RealUserMonitor,
      }),
    ).toEqual({ key: "RUM Application", value: "checkout-web" });
  });

  test("without a declared type the resolved entity's type labels the chip", () => {
    expect(
      getTraceEntityChipDisplay({
        id: HOST_ID,
        facetTitle: "Service",
        entityNames: nameMap(HOST_ENTITY),
      }),
    ).toEqual({ key: "Host", value: "ip-10-0-0-12" });
  });

  test("unresolved and undeclared keeps the facet title and the id", () => {
    expect(
      getTraceEntityChipDisplay({
        id: OTHER_ID,
        facetTitle: "Service",
        entityNames: nameMap(RUM_ENTITY),
      }),
    ).toEqual({ key: "Service", value: OTHER_ID });

    expect(
      getTraceEntityChipDisplay({
        id: OTHER_ID,
        entityNames: undefined,
      }),
    ).toEqual({ key: "Service", value: OTHER_ID });
  });

  test("an existing name source keeps precedence over the resolver", () => {
    expect(
      getTraceEntityChipDisplay({
        id: SERVICE_ID,
        knownName: "checkout-api (loaded)",
        facetTitle: "Service",
        entityNames: nameMap({ ...SERVICE_ENTITY, name: "resolved" }),
      }),
    ).toEqual({ key: "Service", value: "checkout-api (loaded)" });
  });

  test("the declared type only applies to the scope id itself", () => {
    expect(
      getTraceEntityChipDisplay({
        id: SERVICE_ID,
        knownName: "checkout-api",
        facetTitle: "Service",
        entityNames: {},
        scopeEntityId: RUM_ID,
        scopeEntityType: ServiceType.RealUserMonitor,
      }),
    ).toEqual({ key: "Service", value: "checkout-api" });
  });

  test("a seeded display value beats the bare id while nothing resolves", () => {
    expect(
      getTraceEntityChipDisplay({
        id: SERVICE_ID,
        facetTitle: "Service",
        fallbackValue: "checkout-api",
        entityNames: {},
      }),
    ).toEqual({ key: "Service", value: "checkout-api" });
  });

  test("the project-id bucket reads as Unknown Service", () => {
    expect(
      getTraceEntityChipDisplay({
        id: PROJECT_ID,
        facetTitle: "Service",
        entityNames: nameMap(UNKNOWN_ENTITY),
      }),
    ).toEqual({ key: "Service", value: "Unknown Service" });
  });
});

describe("resolveTraceChipDisplay", () => {
  test("REGRESSION: a RUM application's locked chip no longer reads 'Service: <uuid>'", () => {
    const locked: ActiveFilter = chip("primaryEntityId", RUM_ID, {
      displayKey: "Service",
      readOnly: true,
    });

    const beforeLookup: ActiveFilter = resolveTraceChipDisplay(locked, {
      facetConfigs: FACET_CONFIGS,
      entityNames: {},
      scopeEntityId: RUM_ID,
      scopeEntityType: ServiceType.RealUserMonitor,
    });
    expect(beforeLookup.displayKey).toBe("RUM Application");

    const afterLookup: ActiveFilter = resolveTraceChipDisplay(locked, {
      facetConfigs: FACET_CONFIGS,
      entityNames: nameMap(RUM_ENTITY),
      scopeEntityId: RUM_ID,
      scopeEntityType: ServiceType.RealUserMonitor,
    });
    expect(afterLookup).toEqual({
      facetKey: "primaryEntityId",
      value: RUM_ID,
      displayKey: "RUM Application",
      displayValue: "checkout-web",
      readOnly: true,
    });
    expect(
      `${afterLookup.displayKey}: ${afterLookup.displayValue}`,
    ).not.toContain(RUM_ID);
  });

  test("a Service page is unchanged: 'Service: <service name>'", () => {
    const resolved: ActiveFilter = resolveTraceChipDisplay(
      chip("primaryEntityId", SERVICE_ID, { readOnly: true }),
      {
        facetConfigs: FACET_CONFIGS,
        entityNames: {},
        scopeEntityId: SERVICE_ID,
      },
    );

    expect(resolved.displayKey).toBe("Service");
    expect(resolved.displayValue).toBe("checkout-api");
  });

  test("a Service page that declares OpenTelemetry still reads 'Service'", () => {
    const resolved: ActiveFilter = resolveTraceChipDisplay(
      chip("primaryEntityId", SERVICE_ID),
      {
        facetConfigs: FACET_CONFIGS,
        scopeEntityId: SERVICE_ID,
        scopeEntityType: ServiceType.OpenTelemetry,
      },
    );

    expect(resolved.displayKey).toBe("Service");
    expect(resolved.displayValue).toBe("checkout-api");
  });

  test("a URL- or saved-view-restored chip for a host entity is named", () => {
    const restored: ActiveFilter = chip("primaryEntityId", HOST_ID);

    expect(
      resolveTraceChipDisplay(restored, {
        facetConfigs: FACET_CONFIGS,
        entityNames: nameMap(HOST_ENTITY),
      }),
    ).toMatchObject({ displayKey: "Host", displayValue: "ip-10-0-0-12" });
  });

  test("the legacy serviceId alias is named through the Services facet", () => {
    expect(
      resolveTraceChipDisplay(chip("serviceId", SERVICE_ID), {
        facetConfigs: FACET_CONFIGS,
      }),
    ).toMatchObject({
      facetKey: "serviceId",
      value: SERVICE_ID,
      displayKey: "Service",
      displayValue: "checkout-api",
    });

    expect(
      resolveTraceChipDisplay(chip("serviceId", RUM_ID), {
        facetConfigs: FACET_CONFIGS,
        entityNames: nameMap(RUM_ENTITY),
      }),
    ).toMatchObject({
      facetKey: "serviceId",
      displayKey: "RUM Application",
      displayValue: "checkout-web",
    });
  });

  test("the server facet displayName is used when the Service list lacks the row", () => {
    expect(
      resolveTraceChipDisplay(chip("primaryEntityId", OTHER_ID), {
        facetConfigs: FACET_CONFIGS,
        facetDisplayNames: { primaryEntityId: { [OTHER_ID]: "billing" } },
        entityNames: {},
      }),
    ).toMatchObject({ displayKey: "Service", displayValue: "billing" });
  });

  test("an unnamed, unresolved entity chip still shows its id rather than nothing", () => {
    expect(
      resolveTraceChipDisplay(chip("primaryEntityId", OTHER_ID), {
        facetConfigs: FACET_CONFIGS,
      }),
    ).toMatchObject({ displayKey: "Service", displayValue: OTHER_ID });
  });

  test("attribute chips show the attribute key and the decoded token", () => {
    const token: string = buildSearchTokenValue("/api/*");

    expect(
      resolveTraceChipDisplay(chip("attributes.http.route", token), {
        facetConfigs: FACET_CONFIGS,
        entityNames: nameMap(RUM_ENTITY),
      }),
    ).toEqual({
      facetKey: "attributes.http.route",
      value: token,
      displayKey: "http.route",
      displayValue: "/api/*",
    });
  });

  test("legacy contains chips read as ~value", () => {
    expect(
      resolveTraceChipDisplay(chip("attributeSearches.url.host", "starship"), {
        facetConfigs: FACET_CONFIGS,
      }),
    ).toMatchObject({ displayKey: "url.host", displayValue: "~starship" });
  });

  test("columns with a facet config keep their facet title and value labels", () => {
    expect(
      resolveTraceChipDisplay(chip("statusCode", "2"), {
        facetConfigs: FACET_CONFIGS,
      }),
    ).toMatchObject({ displayKey: "Status", displayValue: "Error" });
  });

  test("a chip without a facet config keeps its seeded key instead of the raw column", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      entityKeys: ["k8s.pod:checkout-abc"],
      traceId: OTHER_ID,
      hasException: false,
    });

    const displayed: Array<ActiveFilter> = (
      scope.chips as Array<SpanScopeChip>
    ).map((scopeChip: SpanScopeChip): ActiveFilter => {
      return resolveTraceChipDisplay(
        { ...scopeChip, readOnly: true },
        { facetConfigs: FACET_CONFIGS },
      );
    });

    expect(
      displayed.map((filter: ActiveFilter): [string, string] => {
        return [filter.displayKey, filter.displayValue];
      }),
    ).toEqual([
      ["Resource", "k8s.pod:checkout-abc"],
      ["Trace", OTHER_ID],
      ["Has Exception", "No"],
    ]);
  });

  test("a URL-restored chip with no config and no seed falls back to its column", () => {
    expect(
      resolveTraceChipDisplay(
        {
          facetKey: "traceId",
          value: OTHER_ID,
          displayKey: "",
          displayValue: "",
        },
        { facetConfigs: FACET_CONFIGS },
      ),
    ).toMatchObject({ displayKey: "traceId", displayValue: OTHER_ID });
  });

  test("the stored-query scope's primaryEntityId chip is named too", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      primaryEntityId: RUM_ID,
    });
    const scopeChip: SpanScopeChip = scope.chips[0]!;

    expect(scopeChip.displayKey).toBe("Service");

    expect(
      resolveTraceChipDisplay(
        { ...scopeChip, readOnly: true },
        { facetConfigs: FACET_CONFIGS, entityNames: nameMap(RUM_ENTITY) },
      ),
    ).toMatchObject({
      displayKey: "RUM Application",
      displayValue: "checkout-web",
    });
  });

  test("INVARIANT: facetKey, value and readOnly never change — filtering is untouched", () => {
    const chips: Array<ActiveFilter> = [
      chip("primaryEntityId", RUM_ID, { readOnly: true }),
      chip("serviceId", HOST_ID),
      chip("primaryEntityId", SERVICE_ID),
      chip("attributes.http.route", buildSearchTokenValue("/a b")),
      chip("attributeSearches.url.host", "x"),
      chip("statusCode", "2"),
      chip("entityKeys", "service:checkout", { displayKey: "Resource" }),
    ];

    for (const original of chips) {
      const resolved: ActiveFilter = resolveTraceChipDisplay(original, {
        facetConfigs: FACET_CONFIGS,
        facetDisplayNames: { primaryEntityId: { [OTHER_ID]: "billing" } },
        entityNames: nameMap(RUM_ENTITY, HOST_ENTITY, SERVICE_ENTITY),
        scopeEntityId: RUM_ID,
        scopeEntityType: ServiceType.RealUserMonitor,
      });

      expect(resolved.facetKey).toBe(original.facetKey);
      expect(resolved.value).toBe(original.value);
      expect(resolved.readOnly).toBe(original.readOnly);
    }
  });
});

describe("entityScopeForAttributeKey", () => {
  const hostScope: AttributeEntityScope = {
    entityKeys: ["3f9a1b2c4d5e6f70"],
    attributeKey: "resource.host.name",
    attributeValue: "web-01",
  };

  test("hands the scope to the chip whose attribute it names", () => {
    expect(entityScopeForAttributeKey(hostScope, "resource.host.name")).toBe(
      hostScope,
    );
  });

  test("withholds it from every other chip — a Docker host's runtime chip is not the host's entity", () => {
    expect(
      entityScopeForAttributeKey(hostScope, "resource.container.runtime"),
    ).toBeUndefined();
  });

  test("a page without an entity scope attaches nothing", () => {
    expect(
      entityScopeForAttributeKey(undefined, "resource.host.name"),
    ).toBeUndefined();
  });
});

describe("buildLockedAttributeChip", () => {
  test("is label only — the explanation is the viewer's to attach, so this module never loads the explorer link builder", () => {
    /*
     * Utils/LockedTelemetryScopeLink reaches Common/UI/Config through
     * RouteMap, and that reads `window` at load. This suite runs in plain
     * Node; the builder staying label-only (the viewer attaches the detail
     * next to the entity scope it alone knows) keeps this module free of it.
     */
    expect(
      buildLockedAttributeChip({
        key: "resource.k8s.cluster.name",
        value: "prod-eu-1-7f3a",
      }).lockedDetail,
    ).toBeUndefined();
  });

  test("shows the host's friendly name while filtering by the identifier", () => {
    expect(
      buildLockedAttributeChip({
        key: "resource.k8s.cluster.name",
        value: "prod-eu-1-7f3a",
        displayKeys: { "resource.k8s.cluster.name": "Cluster" },
        displayValues: { "resource.k8s.cluster.name": "Production EU" },
      }),
    ).toEqual({
      facetKey: "attributes.resource.k8s.cluster.name",
      value: "prod-eu-1-7f3a",
      displayKey: "Cluster",
      displayValue: "Production EU",
      readOnly: true,
    });
  });

  test("without overrides a known resource key gets the Logs tab's friendly label", () => {
    expect(
      buildLockedAttributeChip({
        key: "resource.host.name",
        value: "ip-10-0-0-12",
      }),
    ).toEqual({
      facetKey: "attributes.resource.host.name",
      value: "ip-10-0-0-12",
      displayKey: "Host",
      displayValue: "ip-10-0-0-12",
      readOnly: true,
    });
  });

  test("an unmapped key without overrides still shows the key itself", () => {
    expect(
      buildLockedAttributeChip({
        key: "deployment.environment",
        value: "prod",
      }),
    ).toMatchObject({
      facetKey: "attributes.deployment.environment",
      displayKey: "deployment.environment",
      displayValue: "prod",
    });
  });

  test("an override for another key, or an empty override, does not apply", () => {
    expect(
      buildLockedAttributeChip({
        key: "resource.host.name",
        value: "ip-10-0-0-12",
        displayKeys: { "resource.host.name": "  " },
        displayValues: { "resource.k8s.cluster.name": "Production EU" },
      }),
    ).toMatchObject({
      displayKey: "Host",
      displayValue: "ip-10-0-0-12",
    });

    expect(
      buildLockedAttributeChip({
        key: "deployment.environment",
        value: "prod",
        displayKeys: { "resource.host.name": "Machine" },
      }),
    ).toMatchObject({ displayKey: "deployment.environment" });
  });

  test("an explicit display key beats the shared friendly label", () => {
    expect(
      buildLockedAttributeChip({
        key: "resource.host.name",
        value: "ip-10-0-0-12",
        displayKeys: { "resource.host.name": "Machine" },
      }).displayKey,
    ).toBe("Machine");
  });
});

describe("read-only attribute chip keys", () => {
  test("REGRESSION: an incident / alert stored-query attribute chip reads like the Logs tab", () => {
    /*
     * Typed as a JSON object: inferring Query<Span> for a nested attributes
     * literal is too deep for the compiler.
     */
    const storedQuery: JSONObject = {
      attributes: {
        "resource.k8s.cluster.name": "prod-eu-1",
        "deployment.environment": "prod",
      },
    };
    const scope: SpanQueryScope = buildSpanQueryScope(storedQuery);

    const displayed: Array<ActiveFilter> = (
      scope.chips as Array<SpanScopeChip>
    ).map((scopeChip: SpanScopeChip): ActiveFilter => {
      return resolveTraceChipDisplay(
        { ...scopeChip, readOnly: true },
        { facetConfigs: FACET_CONFIGS },
      );
    });

    expect(
      displayed.map((filter: ActiveFilter): [string, string, string] => {
        return [filter.facetKey, filter.displayKey, filter.value];
      }),
    ).toEqual([
      [
        "attributes.resource.k8s.cluster.name",
        getAttributeDisplayName("resource.k8s.cluster.name"),
        "prod-eu-1",
      ],
      ["attributes.deployment.environment", "deployment.environment", "prod"],
    ]);
    expect(displayed[0]!.displayKey).toBe("Cluster");
    expect(displayed[0]!.displayKey).toBe(
      ATTRIBUTE_DISPLAY_NAMES["resource.k8s.cluster.name"],
    );
  });

  test("a user-added attribute chip keeps its literal key", () => {
    expect(
      resolveTraceChipDisplay(
        chip("attributes.resource.k8s.cluster.name", "x"),
        {
          facetConfigs: FACET_CONFIGS,
        },
      ),
    ).toMatchObject({
      displayKey: "resource.k8s.cluster.name",
      displayValue: "x",
    });
  });

  test("a read-only chip seeded with an explicit label keeps it", () => {
    expect(
      resolveTraceChipDisplay(
        chip("attributes.resource.k8s.cluster.name", "prod-eu-1", {
          displayKey: "Production Cluster",
          readOnly: true,
        }),
        { facetConfigs: FACET_CONFIGS },
      ).displayKey,
    ).toBe("Production Cluster");

    // Re-resolving an already-labelled chip is a no-op.
    const once: ActiveFilter = resolveTraceChipDisplay(
      chip("attributes.resource.host.name", "web-01", { readOnly: true }),
      { facetConfigs: FACET_CONFIGS },
    );
    expect(once.displayKey).toBe("Host");
    expect(
      resolveTraceChipDisplay(once, { facetConfigs: FACET_CONFIGS }),
    ).toEqual(once);
  });

  test("the helper: explicit label, then the shared map, then the key", () => {
    expect(
      getReadOnlyAttributeChipDisplayKey({
        attributeKey: "resource.faas.name",
      }),
    ).toBe("Function");
    expect(
      getReadOnlyAttributeChipDisplayKey({
        attributeKey: "resource.faas.name",
        seededDisplayKey: "resource.faas.name",
      }),
    ).toBe("Function");
    expect(
      getReadOnlyAttributeChipDisplayKey({
        attributeKey: "resource.faas.name",
        seededDisplayKey: "attributes.resource.faas.name",
      }),
    ).toBe("Function");
    expect(
      getReadOnlyAttributeChipDisplayKey({
        attributeKey: "resource.faas.name",
        seededDisplayKey: "Lambda",
      }),
    ).toBe("Lambda");
    expect(
      getReadOnlyAttributeChipDisplayKey({ attributeKey: "http.route" }),
    ).toBe("http.route");
  });

  test("the value, facetKey and readOnly are untouched", () => {
    const original: ActiveFilter = chip(
      "attributes.resource.k8s.cluster.name",
      buildSearchTokenValue("prod eu"),
      { readOnly: true },
    );
    const resolved: ActiveFilter = resolveTraceChipDisplay(original, {
      facetConfigs: FACET_CONFIGS,
    });

    expect(resolved.facetKey).toBe(original.facetKey);
    expect(resolved.value).toBe(original.value);
    expect(resolved.readOnly).toBe(true);
    expect(resolved.displayValue).toBe("prod eu");
  });
});

describe("span row entity", () => {
  function service(name: string | undefined, color?: string): Service {
    const model: Service = new Service();
    model.id = new ObjectID(SERVICE_ID);
    if (name !== undefined) {
      model.name = name;
    }
    if (color) {
      model.serviceColor = new Color(color);
    }
    return model;
  }

  test("a loaded Service keeps its name and color", () => {
    expect(
      getSpanEntityDisplay({ service: service("checkout-api", "#ff0000") }),
    ).toEqual({
      name: "checkout-api",
      typeLabel: "Service",
      color: "#ff0000",
    });
  });

  test("REGRESSION: a RUM application's span no longer reads 'unknown service'", () => {
    expect(getSpanEntityDisplay({ entity: RUM_ENTITY })).toEqual({
      name: "checkout-web",
      typeLabel: "RUM Application",
    });
  });

  test("nothing known still reads 'unknown service'", () => {
    expect(UNKNOWN_SPAN_ENTITY_NAME).toBe("unknown service");
    expect(getSpanEntityDisplay({})).toEqual({
      name: "unknown service",
      typeLabel: "Service",
    });
    expect(
      getSpanEntityDisplay({ entity: { ...RUM_ENTITY, name: "" } }),
    ).toEqual({ name: "unknown service", typeLabel: "Service" });
  });

  test("a Service with no name falls back like before", () => {
    expect(getSpanEntityDisplay({ service: service(undefined) }).name).toBe(
      "unknown service",
    );
  });

  test("getSpanEntity hands a row its Service, or else its resolved entity — never both", () => {
    const serviceById: Record<string, Service> = {
      [SERVICE_ID]: service("checkout-api"),
    };
    const entityNames: TelemetryEntityNameMap = nameMap(
      RUM_ENTITY,
      SERVICE_ENTITY,
    );

    const serviceRow: ReturnType<typeof getSpanEntity> = getSpanEntity({
      spanEntityId: new ObjectID(SERVICE_ID),
      serviceById,
      entityNames,
    });
    expect(serviceRow.service).toBe(serviceById[SERVICE_ID]);
    expect(serviceRow.entity).toBeUndefined();

    expect(
      getSpanEntity({ spanEntityId: RUM_ID, serviceById, entityNames }),
    ).toEqual({ entity: RUM_ENTITY });

    expect(
      getSpanEntity({ spanEntityId: OTHER_ID, serviceById, entityNames }),
    ).toEqual({});

    expect(
      getSpanEntity({ spanEntityId: undefined, serviceById, entityNames }),
    ).toEqual({});
  });
});

describe("analytics split-by labels", () => {
  test("a Service id the server did not name uses the loaded Service name", () => {
    expect(
      formatTraceAnalyticsGroupValue({
        key: "primaryEntityId",
        raw: SERVICE_ID,
        serviceNameMap: SERVICE_NAME_MAP,
        entityNames: {},
      }),
    ).toBe("checkout-api");
  });

  test("REGRESSION: a RUM application id reads as its name, not a UUID", () => {
    expect(
      formatTraceAnalyticsGroupValue({
        key: "primaryEntityId",
        raw: RUM_ID,
        serviceNameMap: SERVICE_NAME_MAP,
        entityNames: nameMap(RUM_ENTITY),
      }),
    ).toBe("checkout-web");
  });

  test("an unresolved id, or a name the server swapped in, is shown as-is", () => {
    expect(
      formatTraceAnalyticsGroupValue({
        key: "primaryEntityId",
        raw: OTHER_ID,
        serviceNameMap: SERVICE_NAME_MAP,
      }),
    ).toBe(OTHER_ID);
    expect(
      formatTraceAnalyticsGroupValue({
        key: "primaryEntityId",
        raw: "checkout-api",
        serviceNameMap: {},
      }),
    ).toBe("checkout-api");
  });

  test("status, kind, empty and other dimensions keep their labels", () => {
    const base: { serviceNameMap: Record<string, string> } = {
      serviceNameMap: SERVICE_NAME_MAP,
    };

    expect(
      formatTraceAnalyticsGroupValue({ ...base, key: "statusCode", raw: "2" }),
    ).toBe("Error");
    expect(
      formatTraceAnalyticsGroupValue({ ...base, key: "statusCode", raw: "9" }),
    ).toBe("9");
    expect(
      formatTraceAnalyticsGroupValue({
        ...base,
        key: "kind",
        raw: "SPAN_KIND_SERVER",
      }),
    ).toBe("Server");
    expect(
      formatTraceAnalyticsGroupValue({ ...base, key: "name", raw: "" }),
    ).toBe(TRACE_ANALYTICS_EMPTY_GROUP_LABEL);
    // A span name that happens to be a Service id is not renamed.
    expect(
      formatTraceAnalyticsGroupValue({
        ...base,
        key: "name",
        raw: SERVICE_ID,
        entityNames: nameMap(SERVICE_ENTITY),
      }),
    ).toBe(SERVICE_ID);
  });

  test("collects unnamed entity ids from rows and an entity-split top list", () => {
    expect(
      collectTraceAnalyticsEntityIds({
        rows: [
          { groupValues: { primaryEntityId: RUM_ID, name: OTHER_ID } },
          { groupValues: { primaryEntityId: SERVICE_ID } },
          { groupValues: { primaryEntityId: "checkout-api" } },
          { groupValues: undefined },
        ],
        topList: [{ value: HOST_ID }, { value: RUM_ID }],
        topListGroupKey: "primaryEntityId",
        serviceNameMap: SERVICE_NAME_MAP,
      }),
    ).toEqual([HOST_ID, RUM_ID].sort());
  });

  test("a top list split by something else is not looked up", () => {
    expect(
      collectTraceAnalyticsEntityIds({
        rows: [],
        topList: [{ value: HOST_ID }],
        topListGroupKey: "name",
        serviceNameMap: {},
      }),
    ).toEqual([]);
  });
});

describe("analytics series identity", () => {
  const SECOND_HOST_ID: string = "66666666-6666-4666-8666-666666666666";
  const SECOND_HOST_ENTITY: ResolvedTelemetryEntity = {
    ...HOST_ENTITY,
    id: SECOND_HOST_ID,
  };
  // A RUM application that shares its name with a Service.
  const RUM_CHECKOUT: ResolvedTelemetryEntity = {
    ...RUM_ENTITY,
    name: "checkout",
  };

  test("REGRESSION: a Service and a RUM application with the same name stay two series", () => {
    const pivot: ReturnType<typeof pivotTraceAnalyticsTimeseries> =
      pivotTraceAnalyticsTimeseries({
        rows: [
          // The server already swapped the Service id for its name.
          {
            time: "t1",
            value: 5,
            groupValues: { primaryEntityId: "checkout" },
          },
          { time: "t1", value: 7, groupValues: { primaryEntityId: RUM_ID } },
          {
            time: "t2",
            value: 1,
            groupValues: { primaryEntityId: "checkout" },
          },
          { time: "t2", value: 2, groupValues: { primaryEntityId: RUM_ID } },
        ],
        serviceNameMap: {},
        entityNames: nameMap(RUM_CHECKOUT),
        metricLabel: "Request Count",
      });

    expect(pivot.seriesKeys).toEqual([
      "checkout (Service)",
      "checkout (RUM Application)",
    ]);
    expect(pivot.pivotedData).toEqual([
      { time: "t1", "checkout (Service)": 5, "checkout (RUM Application)": 7 },
      { time: "t2", "checkout (Service)": 1, "checkout (RUM Application)": 2 },
    ]);
  });

  test("REGRESSION: two hosts with the same name get a short id and keep their own values", () => {
    const pivot: ReturnType<typeof pivotTraceAnalyticsTimeseries> =
      pivotTraceAnalyticsTimeseries({
        rows: [
          { time: "t1", value: 3, groupValues: { primaryEntityId: HOST_ID } },
          {
            time: "t1",
            value: 4,
            groupValues: { primaryEntityId: SECOND_HOST_ID },
          },
        ],
        serviceNameMap: {},
        entityNames: nameMap(HOST_ENTITY, SECOND_HOST_ENTITY),
        metricLabel: "Request Count",
      });

    expect(pivot.seriesKeys).toEqual([
      "ip-10-0-0-12 (Host · 44444444)",
      "ip-10-0-0-12 (Host · 66666666)",
    ]);
    expect(pivot.pivotedData).toEqual([
      {
        time: "t1",
        "ip-10-0-0-12 (Host · 44444444)": 3,
        "ip-10-0-0-12 (Host · 66666666)": 4,
      },
    ]);
    // Unique labels: the legend's React keys and the chart dataKeys cannot clash.
    expect(new Set(pivot.seriesKeys).size).toBe(pivot.seriesKeys.length);
  });

  test("names that do not clash are left alone", () => {
    const pivot: ReturnType<typeof pivotTraceAnalyticsTimeseries> =
      pivotTraceAnalyticsTimeseries({
        rows: [
          {
            time: "t1",
            value: 1,
            groupValues: { primaryEntityId: SERVICE_ID },
          },
          { time: "t1", value: 2, groupValues: { primaryEntityId: RUM_ID } },
          { time: "t1", value: 3, groupValues: { primaryEntityId: OTHER_ID } },
        ],
        serviceNameMap: SERVICE_NAME_MAP,
        entityNames: nameMap(RUM_ENTITY),
        metricLabel: "Request Count",
      });

    expect(pivot.seriesKeys).toEqual([
      "checkout-api",
      "checkout-web",
      OTHER_ID,
    ]);
  });

  test("an unsplit timeseries is one series named after the metric", () => {
    const pivot: ReturnType<typeof pivotTraceAnalyticsTimeseries> =
      pivotTraceAnalyticsTimeseries({
        rows: [
          { time: "t1", value: 1, groupValues: {} },
          { time: "t2", value: 2, groupValues: {} },
        ],
        serviceNameMap: {},
        metricLabel: "P90 Response Time",
      });

    expect(pivot.seriesKeys).toEqual(["P90 Response Time"]);
    expect(pivot.pivotedData).toEqual([
      { time: "t1", "P90 Response Time": 1 },
      { time: "t2", "P90 Response Time": 2 },
    ]);
  });

  test("multi-dimension groups only widen the entity part, and only when they clash", () => {
    const pivot: ReturnType<typeof pivotTraceAnalyticsTimeseries> =
      pivotTraceAnalyticsTimeseries({
        rows: [
          {
            time: "t1",
            value: 1,
            groupValues: { name: "GET /", primaryEntityId: "checkout" },
          },
          {
            time: "t1",
            value: 2,
            groupValues: { name: "GET /", primaryEntityId: RUM_ID },
          },
          {
            time: "t1",
            value: 3,
            groupValues: { name: "POST /", primaryEntityId: RUM_ID },
          },
        ],
        serviceNameMap: {},
        entityNames: nameMap(RUM_CHECKOUT),
        metricLabel: "Request Count",
      });

    expect(pivot.seriesKeys).toEqual([
      "GET / / checkout (Service)",
      "GET / / checkout (RUM Application)",
      "POST / / checkout",
    ]);
    expect(pivot.pivotedData[0]).toEqual({
      time: "t1",
      "GET / / checkout (Service)": 1,
      "GET / / checkout (RUM Application)": 2,
      "POST / / checkout": 3,
    });
  });

  test("identity ignores dimension order but not values", () => {
    expect(
      getTraceAnalyticsGroupIdentityKey({ name: "a", primaryEntityId: RUM_ID }),
    ).toBe(
      getTraceAnalyticsGroupIdentityKey({ primaryEntityId: RUM_ID, name: "a" }),
    );
    expect(getTraceAnalyticsGroupIdentityKey({ name: "a" })).not.toBe(
      getTraceAnalyticsGroupIdentityKey({ name: "b" }),
    );
    expect(getTraceAnalyticsGroupIdentityKey(undefined)).toBe(
      getTraceAnalyticsGroupIdentityKey({}),
    );
  });

  test("clashes nothing can explain are numbered, and 'time' never overwrites the bucket", () => {
    const pivot: ReturnType<typeof pivotTraceAnalyticsTimeseries> =
      pivotTraceAnalyticsTimeseries({
        rows: [
          { time: "t1", value: 1, groupValues: { name: "" } },
          {
            time: "t1",
            value: 2,
            groupValues: { name: TRACE_ANALYTICS_EMPTY_GROUP_LABEL },
          },
          { time: "t1", value: 3, groupValues: { name: "time" } },
        ],
        serviceNameMap: {},
        metricLabel: "Request Count",
      });

    expect(pivot.seriesKeys).toEqual(["(empty)", "(empty) #2", "time #2"]);
    const row: TraceAnalyticsPivotedRow = pivot.pivotedData[0]!;
    expect(row.time).toBe("t1");
    expect(row["(empty)"]).toBe(1);
    expect(row["(empty) #2"]).toBe(2);
    expect(row["time #2"]).toBe(3);
  });

  test("numbering never lands on a label another group already has", () => {
    const labels: Map<string, string> = buildTraceAnalyticsGroupLabels({
      groups: [{ name: "x" }, { name: "x #2" }, { kind: "x" }],
      serviceNameMap: {},
    });

    expect(Array.from(labels.values())).toEqual(["x", "x #2", "x #3"]);
  });

  test("an unresolved id is never qualified — it is already unique", () => {
    expect(
      getTraceAnalyticsGroupTypeLabel({
        key: "primaryEntityId",
        raw: OTHER_ID,
        serviceNameMap: {},
      }),
    ).toBeUndefined();
    expect(
      getTraceAnalyticsGroupTypeLabel({
        key: "primaryEntityId",
        raw: SERVICE_ID,
        serviceNameMap: SERVICE_NAME_MAP,
      }),
    ).toBe("Service");
    expect(
      getTraceAnalyticsGroupTypeLabel({
        key: "serviceId",
        raw: HOST_ID,
        serviceNameMap: {},
        entityNames: nameMap(HOST_ENTITY),
      }),
    ).toBe("Host");
    expect(
      getTraceAnalyticsGroupTypeLabel({
        key: "primaryEntityId",
        raw: "checkout",
        serviceNameMap: {},
      }),
    ).toBe("Service");
    expect(
      getTraceAnalyticsGroupTypeLabel({
        key: "name",
        raw: "checkout",
        serviceNameMap: {},
      }),
    ).toBeUndefined();
  });

  test("top list / table column labels are unique per raw value too", () => {
    const labels: Map<string, string> = buildTraceAnalyticsValueLabels({
      key: "primaryEntityId",
      values: ["checkout", RUM_ID, HOST_ID, "checkout", ""],
      serviceNameMap: {},
      entityNames: nameMap(RUM_CHECKOUT, HOST_ENTITY),
    });

    expect(labels.get("checkout")).toBe("checkout (Service)");
    expect(labels.get(RUM_ID)).toBe("checkout (RUM Application)");
    expect(labels.get(HOST_ID)).toBe("ip-10-0-0-12");
    expect(labels.get("")).toBe(TRACE_ANALYTICS_EMPTY_GROUP_LABEL);
    expect(labels.size).toBe(4);
  });

  test("a non-entity column is labelled like before", () => {
    const labels: Map<string, string> = buildTraceAnalyticsValueLabels({
      key: "statusCode",
      values: ["2", "1", "2"],
      serviceNameMap: {},
    });

    expect(Array.from(labels.entries())).toEqual([
      ["2", "Error"],
      ["1", "Ok"],
    ]);
  });
});

describe("getTraceEntityOptionLabel", () => {
  test("known label, then resolved name, then fallback, then id", () => {
    const entityNames: TelemetryEntityNameMap = nameMap(RUM_ENTITY);

    expect(
      getTraceEntityOptionLabel({
        id: SERVICE_ID,
        knownLabel: "checkout-api",
        entityNames,
      }),
    ).toBe("checkout-api");
    expect(getTraceEntityOptionLabel({ id: RUM_ID, entityNames })).toBe(
      "checkout-web",
    );
    expect(
      getTraceEntityOptionLabel({
        id: OTHER_ID,
        entityNames,
        fallback: "Unknown",
      }),
    ).toBe("Unknown");
    expect(getTraceEntityOptionLabel({ id: OTHER_ID })).toBe(OTHER_ID);
  });
});

describe("end to end with the real resolver", () => {
  beforeEach(() => {
    getListMock.mockReset();
    TelemetryEntityNameResolver.clearCache();
  });

  test("a hinted RUM scope id is resolved in one request and names the locked chip", async () => {
    getListMock.mockImplementation(
      async (args: { modelType: unknown }): Promise<unknown> => {
        if (args.modelType === RumApplication) {
          const app: RumApplication = new RumApplication();
          app.id = new ObjectID(RUM_ID);
          app.name = "checkout-web";
          return { data: [app], count: 1 };
        }
        return { data: [], count: 0 };
      },
    );

    const ids: Array<string> = collectTraceEntityIdsToResolve({
      chips: [chip("primaryEntityId", RUM_ID)],
      knownNames: [SERVICE_NAME_MAP],
    });

    const entityNames: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids,
        projectId: PROJECT_ID,
        typeHints: buildTraceEntityTypeHints(
          RUM_ID,
          ServiceType.RealUserMonitor,
        ),
      });

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(
      (getListMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(RumApplication);

    expect(
      resolveTraceChipDisplay(
        chip("primaryEntityId", RUM_ID, { displayKey: "Service" }),
        {
          facetConfigs: FACET_CONFIGS,
          entityNames,
          scopeEntityId: RUM_ID,
          scopeEntityType: ServiceType.RealUserMonitor,
        },
      ),
    ).toMatchObject({
      displayKey: "RUM Application",
      displayValue: "checkout-web",
    });
  });

  test("a resolver failure leaves the chip on its fallback rather than throwing", async () => {
    getListMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("forbidden");
    });

    const entityNames: TelemetryEntityNameMap =
      await TelemetryEntityNameResolver.resolve({
        ids: [RUM_ID],
        projectId: PROJECT_ID,
        typeHints: buildTraceEntityTypeHints(
          RUM_ID,
          ServiceType.RealUserMonitor,
        ),
      });

    expect(
      resolveTraceChipDisplay(chip("primaryEntityId", RUM_ID), {
        facetConfigs: FACET_CONFIGS,
        entityNames,
        scopeEntityId: RUM_ID,
        scopeEntityType: ServiceType.RealUserMonitor,
      }),
    ).toMatchObject({ displayKey: "RUM Application", displayValue: RUM_ID });
  });
});

describe("describeStoredQueryChip", () => {
  function storedChip(overrides: Partial<ActiveFilter>): ActiveFilter {
    return {
      facetKey: "statusCode",
      value: "2",
      displayKey: "Status",
      displayValue: "Error",
      readOnly: true,
      ...overrides,
    };
  }

  test("trace and span chips get the id describers under the stored-query source", () => {
    const trace: LockedFilterDetail = describeStoredQueryChip(
      storedChip({ facetKey: "traceId", value: "t-1", displayKey: "Trace" }),
    );
    expect(trace.source).toBe(LOCKED_FILTER_SOURCE_STORED_QUERY);
    expect(trace.predicates[0]!.expression).toBe('traceId = "t-1"');
    expect(trace.searchToken).toBe("trace:t-1");

    const span: LockedFilterDetail = describeStoredQueryChip(
      storedChip({ facetKey: "spanId", value: "s-1", displayKey: "Span" }),
    );
    expect(span.source).toBe(LOCKED_FILTER_SOURCE_STORED_QUERY);
    expect(span.searchToken).toBe("span:s-1");
  });

  test("entity chips are explained by entity id with the RESOLVED label, never the 'Service' seed", () => {
    const detail: LockedFilterDetail = describeStoredQueryChip(
      storedChip({
        facetKey: "primaryEntityId",
        value: "651a000000000000000000aa",
        displayKey: "RUM Application",
        displayValue: "checkout-web",
      }),
    );

    expect(detail.source).toBe(LOCKED_FILTER_SOURCE_STORED_QUERY);
    expect(detail.summary).toBe(
      "Only traces emitted by this RUM Application are shown.",
    );
    expect(detail.searchToken).toBe("service:651a000000000000000000aa");
    expect(detail.source).not.toBe(LOCKED_FILTER_SOURCE_PAGE);

    // The pre-rename alias is an entity chip too.
    expect(
      describeStoredQueryChip(
        storedChip({
          facetKey: "serviceId",
          value: "651a000000000000000000aa",
        }),
      ).searchToken,
    ).toBe("service:651a000000000000000000aa");
  });

  test("a status chip is explained as its predicate and spelled with the status token", () => {
    const detail: LockedFilterDetail = describeStoredQueryChip(storedChip({}));

    expect(detail.source).toBe(LOCKED_FILTER_SOURCE_STORED_QUERY);
    expect(detail.predicates).toEqual([
      { label: "Status", expression: 'statusCode = "2"' },
    ]);
    expect(detail.searchToken).toBe("status:2");
  });

  test("a single stored span name is a substring match — and the tooltip says so — only when the scope says the column took that path", () => {
    const substring: LockedFilterDetail = describeStoredQueryChip(
      storedChip({ facetKey: "name", value: "checkout", displayKey: "Name" }),
      { substringColumns: new Set<string>(["name"]) },
    );
    expect(substring.predicates[0]!.expression).toBe(
      'name contains "checkout"',
    );
    expect(substring.searchToken).toBe("name:checkout");

    const exact: LockedFilterDetail = describeStoredQueryChip(
      storedChip({ facetKey: "name", value: "checkout", displayKey: "Name" }),
      { substringColumns: new Set<string>(["statusMessage"]) },
    );
    expect(exact.predicates[0]!.expression).toBe('name = "checkout"');

    const noContext: LockedFilterDetail = describeStoredQueryChip(
      storedChip({ facetKey: "name", value: "checkout", displayKey: "Name" }),
    );
    expect(noContext.predicates[0]!.expression).toBe('name = "checkout"');
  });

  test("an entity-keys chip can neither be copied nor carried, and is told so", () => {
    const detail: LockedFilterDetail = describeStoredQueryChip(
      storedChip({
        facetKey: "entityKeys",
        value: "3f9a1b2c4d5e6f70",
        displayKey: "Resource",
        displayValue: "3f9a1b2c4d5e6f70",
      }),
    );

    expect(detail.predicates[0]!.expression).toBe(
      "entityKeys has 3f9a1b2c4d5e6f70",
    );
    expect(detail.searchToken).toBeUndefined();
    expect(detail.searchTokenUnavailableReason).toBe(
      "This filter cannot be copied or carried to the explorer.",
    );
  });
});

describe("stored-query search tokens round-trip through the traces search parser", () => {
  /*
   * The tokens the tooltip offers for a stored query's span columns must
   * land on the same column, with the same value, when pasted into the
   * traces search bar — that is what the traces query builder compiles.
   */
  test.each([
    ["status:2", "statusCode", "2"],
    ["kind:SPAN_KIND_SERVER", "kind", "SPAN_KIND_SERVER"],
    ["hasexception:true", "hasException", "true"],
    ["name:checkout", "name", "checkout"],
    ['name:"POST /checkout submit"', "name", "POST /checkout submit"],
    ["statusmessage:boom", "statusMessage", "boom"],
  ])("%s", (token: string, column: string, value: string) => {
    const parsed: ReturnType<typeof parseTraceSearch> = parseTraceSearch(token);

    expect(parsed.fieldFilters[column]).toEqual([value]);
    expect(parsed.freeText).toBe("");
    expect(parsed.attributeFilters).toEqual([]);
  });
});

/*
 * An Inventory item's Traces tab narrows the list by
 * `hasAny(entityKeys, [item key])`. With no attribute counterpart, the chip
 * bar above that filtered list used to be empty. These pin the chips that now
 * explain it: their exact wording, the fallbacks when the page cannot name
 * the item, and the rule that one key never renders twice when a stored span
 * query pins it too. The viewer's wiring is pinned in
 * TracesLockedScopeWiring.test.ts, and Copy filter / Open in Traces for these
 * chips in TracesEntityKeyLockedScope.test.ts. The explanation's wording is
 * owned by LockedTelemetryScope.test.ts: a chip's detail is compared to the
 * describer here, with the traces sentence spelled out.
 */

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const NODE_KEY: string = "9c8b7a6d5e4f3021";
const CLUSTER_KEY: string = "0a1b2c3d4e5f6a7b";

const POD_DISPLAYS: LockedEntityKeyDisplayMap = {
  [POD_KEY]: { displayKey: "Kubernetes Pod", displayValue: "checkout-7d9f" },
};

const CANNOT_TRAVEL: string =
  "This filter cannot be copied or carried to the explorer.";

function entityKeyValues(chips: Array<ActiveFilter>): Array<string> {
  return chips
    .filter((candidate: ActiveFilter): boolean => {
      return candidate.facetKey === "entityKeys";
    })
    .map((candidate: ActiveFilter): string => {
      return candidate.value;
    });
}

describe("buildTracesLockedEntityKeyChips", () => {
  test("REGRESSION: an Inventory item's Traces tab gets a locked chip naming the item", () => {
    expect(
      buildTracesLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        displays: POD_DISPLAYS,
      }),
    ).toEqual([
      {
        facetKey: "entityKeys",
        value: POD_KEY,
        displayKey: "Kubernetes Pod",
        displayValue: "checkout-7d9f",
        readOnly: true,
        lockedDetail: describeLockedEntityKeyFilter({
          rows: "traces",
          entityKey: POD_KEY,
          entityKeys: [POD_KEY],
          entityTypeLabel: "Kubernetes Pod",
        }),
      },
    ]);
    expect(
      buildTracesLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        displays: POD_DISPLAYS,
      })[0]!.lockedDetail!.summary,
    ).toBe("Only traces linked to this Kubernetes Pod are shown.");
  });

  test.each([
    ["no display map", undefined],
    ["an empty display map", {}],
  ])(
    "with %s the chip still shows, as 'Resource: <key>'",
    (_label: string, displays: LockedEntityKeyDisplayMap | undefined) => {
      /*
       * The bug was a filtered list under an empty chip bar. A page that
       * cannot name the entity still has to say the list is narrowed.
       */
      const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        displays,
      });

      expect(chips).toHaveLength(1);
      expect(chips[0]!.facetKey).toBe("entityKeys");
      expect(chips[0]!.value).toBe(POD_KEY);
      expect(chips[0]!.displayKey).toBe("Resource");
      expect(chips[0]!.displayValue).toBe(POD_KEY);
      expect(chips[0]!.readOnly).toBe(true);
      expect(chips[0]!.lockedDetail).toEqual(
        describeLockedEntityKeyFilter({ rows: "traces", entityKey: POD_KEY }),
      );
      expect(chips[0]!.lockedDetail!.summary).toBe(
        "Only traces linked to this resource are shown.",
      );
    },
  );

  test.each([
    ["empty strings", { displayKey: "", displayValue: "" }],
    ["whitespace only", { displayKey: "   ", displayValue: "\t\n " }],
  ])(
    "a display entry of %s falls back exactly like no entry",
    (_label: string, display: { displayKey: string; displayValue: string }) => {
      const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        displays: { [POD_KEY]: display },
      });

      expect(chips).toHaveLength(1);
      expect(chips[0]!.displayKey).toBe("Resource");
      expect(chips[0]!.displayValue).toBe(POD_KEY);
      expect(chips[0]!.lockedDetail!.summary).toBe(
        "Only traces linked to this resource are shown.",
      );
    },
  );

  test("a named type without a name shows the type and the key", () => {
    const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      displays: {
        [POD_KEY]: { displayKey: "Kubernetes Pod", displayValue: "  " },
      },
    });

    expect(chips[0]!.displayKey).toBe("Kubernetes Pod");
    expect(chips[0]!.displayValue).toBe(POD_KEY);
    expect(chips[0]!.lockedDetail!.summary).toBe(
      "Only traces linked to this Kubernetes Pod are shown.",
    );
  });

  test("a name without a type reads 'Resource: <name>'", () => {
    const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      displays: {
        [POD_KEY]: { displayKey: "", displayValue: "checkout-7d9f" },
      },
    });

    expect(chips[0]!.displayKey).toBe("Resource");
    expect(chips[0]!.displayValue).toBe("checkout-7d9f");
    expect(chips[0]!.lockedDetail!.summary).toBe(
      "Only traces linked to this resource are shown.",
    );
  });

  test("the page's display text is trimmed", () => {
    const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      displays: {
        [POD_KEY]: {
          displayKey: "  Kubernetes Pod ",
          displayValue: " checkout-7d9f\n",
        },
      },
    });

    expect(chips[0]!.displayKey).toBe("Kubernetes Pod");
    expect(chips[0]!.displayValue).toBe("checkout-7d9f");
    expect(chips[0]!.lockedDetail!.summary).toBe(
      "Only traces linked to this Kubernetes Pod are shown.",
    );
  });

  test("a key the display map does not name reads 'Resource' while the named key keeps its name, and each says the other widens it", () => {
    const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY, NODE_KEY],
      displays: POD_DISPLAYS,
    });

    expect(
      chips.map((candidate: ActiveFilter): [string, string, string] => {
        return [candidate.value, candidate.displayKey, candidate.displayValue];
      }),
    ).toEqual([
      [POD_KEY, "Kubernetes Pod", "checkout-7d9f"],
      [NODE_KEY, "Resource", NODE_KEY],
    ]);

    // `hasAny` WIDENS with every key: neither chip may read like an AND.
    expect(chips[0]!.lockedDetail!.summary).toBe(
      "Traces linked to this Kubernetes Pod are shown, along with traces linked to the 1 other resource this page pins.",
    );
    expect(chips[0]!.lockedDetail).toEqual(
      describeLockedEntityKeyFilter({
        rows: "traces",
        entityKey: POD_KEY,
        entityKeys: [POD_KEY, NODE_KEY],
        entityTypeLabel: "Kubernetes Pod",
      }),
    );

    expect(chips[1]!.lockedDetail!.summary).toBe(
      "Traces linked to this resource are shown, along with traces linked to the 1 other resource this page pins.",
    );
    expect(chips[1]!.lockedDetail).toEqual(
      describeLockedEntityKeyFilter({
        rows: "traces",
        entityKey: NODE_KEY,
        entityKeys: [POD_KEY, NODE_KEY],
      }),
    );
  });

  test("three keys: every chip counts the other two", () => {
    const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY, NODE_KEY, CLUSTER_KEY],
    });

    expect(entityKeyValues(chips)).toEqual([POD_KEY, NODE_KEY, CLUSTER_KEY]);
    expect(chips[1]!.lockedDetail!.summary).toBe(
      "Traces linked to this resource are shown, along with traces linked to the 2 other resources this page pins.",
    );
    expect(chips[1]!.lockedDetail!.predicates[0]!.expression).toBe(
      `entityKeys has any of ${NODE_KEY}, ${POD_KEY}, ${CLUSTER_KEY}`,
    );
  });

  test("blank, whitespace-padded and repeated keys collapse to one chip per key, in first-seen order", () => {
    const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [" ", POD_KEY, "", ` ${POD_KEY} `, NODE_KEY, POD_KEY],
      displays: POD_DISPLAYS,
    });

    expect(entityKeyValues(chips)).toEqual([POD_KEY, NODE_KEY]);
    // The padded duplicate is not counted as another resource.
    expect(chips[0]!.lockedDetail!.summary).toBe(
      "Traces linked to this Kubernetes Pod are shown, along with traces linked to the 1 other resource this page pins.",
    );
  });

  test.each([
    ["undefined", undefined],
    ["an empty list", []],
    ["only blank keys", ["", "   "]],
  ])(
    "an entity-key filter of %s yields no chip",
    (_label: string, entityKeysFilter: Array<string> | undefined) => {
      expect(
        buildTracesLockedEntityKeyChips({
          entityKeysFilter,
          displays: POD_DISPLAYS,
        }),
      ).toEqual([]);
    },
  );

  test("no page key, no chip, even when the stored query pins keys and the page passed names", () => {
    /*
     * The stored query's keys already have their own chips (the viewer's
     * stored-query loop); this builder only explains the page's filter.
     */
    expect(
      buildTracesLockedEntityKeyChips({
        entityKeysFilter: undefined,
        displays: POD_DISPLAYS,
        storedQueryEntityKeys: [POD_KEY, NODE_KEY],
        lockedChips: [],
      }),
    ).toEqual([]);
  });

  test("INVARIANT: every chip is read-only, on the entityKeys column, with the raw key as its value", () => {
    /*
     * facetKey / value are what a chip bar keys its pills by. Read-only is
     * what keeps the remove button off. A display name in `value` would make
     * the chip claim a different filter from the one the query applies.
     */
    const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY, NODE_KEY],
      displays: POD_DISPLAYS,
    });

    for (const candidate of chips) {
      expect(candidate.readOnly).toBe(true);
      expect(candidate.facetKey).toBe("entityKeys");
    }

    expect(
      chips.map((candidate: ActiveFilter): string => {
        return candidate.value;
      }),
    ).toEqual([POD_KEY, NODE_KEY]);
  });

  test("no chip carries a search token, so Copy filter gets nothing from an entity-key scope", () => {
    const chips: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY, NODE_KEY],
      displays: POD_DISPLAYS,
    });

    for (const candidate of chips) {
      expect(Object.keys(candidate.lockedDetail!)).not.toContain("searchToken");
      expect(candidate.lockedDetail!.searchTokenUnavailableReason).toBe(
        CANNOT_TRAVEL,
      );
    }

    expect(buildLockedScopeCopyText("traces", chips)).toBe("");
  });
});

describe("buildTracesLockedEntityKeyChips next to a stored span query", () => {
  /*
   * What the viewer's stored-query loop decides, rebuilt from the same
   * helpers: a column the user filtered themselves withholds the scope's
   * chip; every other chip is resolved, then described. TracesViewer hands
   * the entity-key builder exactly these chips (`lockedChips: base`).
   */
  function storedQueryChips(
    scope: SpanQueryScope,
    userFilteredFacetKeys: ReadonlySet<string> = new Set<string>(),
  ): Array<ActiveFilter> {
    const built: Array<ActiveFilter> = [];

    for (const scopeChip of scope.chips as Array<SpanScopeChip>) {
      if (userFilteredFacetKeys.has(scopeChip.facetKey)) {
        continue;
      }

      const resolved: ActiveFilter = resolveTraceChipDisplay(
        { ...scopeChip, readOnly: true },
        { facetConfigs: FACET_CONFIGS },
      );

      built.push({
        ...resolved,
        lockedDetail: describeStoredQueryChip(resolved),
      });
    }

    return built;
  }

  test("a key both the page and the stored query pin renders ONCE, as the stored query's chip", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      entityKeys: [POD_KEY],
    });
    const stored: Array<ActiveFilter> = storedQueryChips(scope);

    const page: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      displays: POD_DISPLAYS,
      storedQueryEntityKeys: scope.entityKeys,
      lockedChips: stored,
    });

    expect(page).toEqual([]);

    const bar: Array<ActiveFilter> = [...stored, ...page];

    expect(entityKeyValues(bar)).toEqual([POD_KEY]);
    expect(bar[0]!.displayKey).toBe("Resource");
    expect(bar[0]!.lockedDetail!.source).toBe(
      "Pinned by the stored query this view was opened with",
    );
  });

  test("a page key the stored query does not pin keeps its chip, and counts the stored key as widening it", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      entityKeys: [NODE_KEY],
    });
    const stored: Array<ActiveFilter> = storedQueryChips(scope);

    const page: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      displays: POD_DISPLAYS,
      storedQueryEntityKeys: scope.entityKeys,
      lockedChips: stored,
    });

    expect(page).toHaveLength(1);
    expect(page[0]!.value).toBe(POD_KEY);
    expect(page[0]!.displayKey).toBe("Kubernetes Pod");
    expect(page[0]!.displayValue).toBe("checkout-7d9f");
    expect(page[0]!.lockedDetail!.source).toBe("Pinned by this page");
    expect(page[0]!.lockedDetail!.summary).toBe(
      "Traces linked to this Kubernetes Pod are shown, along with traces linked to the 1 other resource this page pins.",
    );
    expect(page[0]!.lockedDetail).toEqual(
      describeLockedEntityKeyFilter({
        rows: "traces",
        entityKey: POD_KEY,
        entityKeys: [POD_KEY, NODE_KEY],
        entityTypeLabel: "Kubernetes Pod",
      }),
    );

    // One pill per key: the stored query's, then the page's.
    expect(entityKeyValues([...stored, ...page])).toEqual([NODE_KEY, POD_KEY]);
  });

  test("a stored chip the viewer withheld does not take the page's key off screen, because the query still applies it", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      entityKeys: [POD_KEY],
    });
    const stored: Array<ActiveFilter> = storedQueryChips(
      scope,
      new Set<string>(["entityKeys"]),
    );

    expect(stored).toEqual([]);

    const page: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      displays: POD_DISPLAYS,
      storedQueryEntityKeys: scope.entityKeys,
      lockedChips: stored,
    });

    expect(entityKeyValues(page)).toEqual([POD_KEY]);
    expect(page[0]!.displayKey).toBe("Kubernetes Pod");
    expect(page[0]!.lockedDetail!.summary).toBe(
      "Only traces linked to this Kubernetes Pod are shown.",
    );
  });

  test("a key only the stored query pins never gets a 'Pinned by this page' chip, even when its own chip was withheld", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      entityKeys: [NODE_KEY],
    });
    const stored: Array<ActiveFilter> = storedQueryChips(
      scope,
      new Set<string>(["entityKeys"]),
    );

    const page: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      displays: POD_DISPLAYS,
      storedQueryEntityKeys: scope.entityKeys,
      lockedChips: stored,
    });

    expect(entityKeyValues(page)).toEqual([POD_KEY]);
    expect(page[0]!.lockedDetail!.summary).toBe(
      "Traces linked to this Kubernetes Pod are shown, along with traces linked to the 1 other resource this page pins.",
    );
  });

  test("overlapping page and stored keys: only the page's own keys the stored chips do not show get a chip, each counting every key the query ORs", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({
      entityKeys: [NODE_KEY, CLUSTER_KEY],
    });
    const stored: Array<ActiveFilter> = storedQueryChips(scope);

    const page: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY, NODE_KEY],
      displays: POD_DISPLAYS,
      storedQueryEntityKeys: scope.entityKeys,
      lockedChips: stored,
    });

    expect(entityKeyValues(page)).toEqual([POD_KEY]);
    expect(page[0]!.lockedDetail!.summary).toBe(
      "Traces linked to this Kubernetes Pod are shown, along with traces linked to the 2 other resources this page pins.",
    );
    expect(page[0]!.lockedDetail!.predicates[0]!.expression).toBe(
      `entityKeys has any of ${POD_KEY}, ${NODE_KEY}, ${CLUSTER_KEY}`,
    );
    expect(entityKeyValues([...stored, ...page])).toEqual([
      NODE_KEY,
      CLUSTER_KEY,
      POD_KEY,
    ]);
  });

  test("a stored chip on another column is not an entity-key chip, even with the same value", () => {
    const page: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      lockedChips: [chip("traceId", POD_KEY, { readOnly: true })],
    });

    expect(entityKeyValues(page)).toEqual([POD_KEY]);
  });

  test("a shown key is matched after trimming", () => {
    expect(
      buildTracesLockedEntityKeyChips({
        entityKeysFilter: [POD_KEY],
        lockedChips: [chip("entityKeys", ` ${POD_KEY} `, { readOnly: true })],
      }),
    ).toEqual([]);
  });

  test("the stored query's other chips leave the page's chip alone and keep their own wording", () => {
    const scope: SpanQueryScope = buildSpanQueryScope({ traceId: OTHER_ID });
    const stored: Array<ActiveFilter> = storedQueryChips(scope);

    const page: Array<ActiveFilter> = buildTracesLockedEntityKeyChips({
      entityKeysFilter: [POD_KEY],
      displays: POD_DISPLAYS,
      storedQueryEntityKeys: scope.entityKeys,
      lockedChips: stored,
    });

    const bar: Array<ActiveFilter> = [...stored, ...page];

    expect(
      bar.map((candidate: ActiveFilter): string => {
        return `${candidate.facetKey}=${candidate.value}`;
      }),
    ).toEqual([`traceId=${OTHER_ID}`, `entityKeys=${POD_KEY}`]);
    expect(bar[0]!.lockedDetail!.summary).toBe(
      "Only traces that belong to this trace are shown.",
    );
    expect(bar[1]!.lockedDetail!.summary).toBe(
      "Only traces linked to this Kubernetes Pod are shown.",
    );
  });

  test("INVARIANT: never touches its inputs; the viewer passes the chip array it is still building", () => {
    const entityKeysFilter: Array<string> = Object.freeze([
      POD_KEY,
      NODE_KEY,
    ]) as Array<string>;
    const storedQueryEntityKeys: Array<string> = Object.freeze([
      NODE_KEY,
    ]) as Array<string>;
    const lockedChips: Array<ActiveFilter> = Object.freeze([
      Object.freeze(chip("entityKeys", NODE_KEY, { readOnly: true })),
    ]) as Array<ActiveFilter>;
    const displays: LockedEntityKeyDisplayMap = Object.freeze({
      [POD_KEY]: Object.freeze({
        displayKey: "Kubernetes Pod",
        displayValue: "checkout-7d9f",
      }),
    });

    const before: string = JSON.stringify({
      entityKeysFilter,
      storedQueryEntityKeys,
      lockedChips,
      displays,
    });

    expect(
      entityKeyValues(
        buildTracesLockedEntityKeyChips({
          entityKeysFilter,
          displays,
          storedQueryEntityKeys,
          lockedChips,
        }),
      ),
    ).toEqual([POD_KEY]);

    expect(
      JSON.stringify({
        entityKeysFilter,
        storedQueryEntityKeys,
        lockedChips,
        displays,
      }),
    ).toBe(before);
  });
});

describe("REGRESSION: a Kubernetes / Host page's entityScope adds no entity-key chip", () => {
  test("a cluster page's locked chips are its attribute chip alone", () => {
    /*
     * The cluster page passes attributeFilters + entityScope and no
     * entityKeysFilter: its attribute chip ("Cluster: prod") already explains
     * the entity scope. The viewer hands the entity-key builder
     * `props.entityKeysFilter` and nothing from `props.entityScope`, pinned
     * in TracesLockedScopeWiring.test.ts; this is what that bar then holds.
     */
    const clusterScope: AttributeEntityScope = {
      entityKeys: [CLUSTER_KEY],
      attributeKey: "resource.k8s.cluster.name",
      attributeValue: "prod-eu-1-7f3a",
    };

    const bar: Array<ActiveFilter> = [
      ...buildTracesLockedEntityKeyChips({
        entityKeysFilter: undefined,
        displays: undefined,
        storedQueryEntityKeys: buildSpanQueryScope(undefined).entityKeys,
        lockedChips: [],
      }),
      buildLockedAttributeChip({
        key: clusterScope.attributeKey,
        value: clusterScope.attributeValue,
        displayKeys: { "resource.k8s.cluster.name": "Cluster" },
        displayValues: { "resource.k8s.cluster.name": "prod" },
      }),
    ];

    expect(bar).toHaveLength(1);
    expect(entityKeyValues(bar)).toEqual([]);
    expect(bar[0]!.displayKey).toBe("Cluster");
    expect(bar[0]!.displayValue).toBe("prod");
  });
});
