import { describe, expect, jest, test } from "@jest/globals";

/*
 * The chip display reaches the entity name lookup, whose API module reads
 * the browser's config at load; nothing here looks a name up.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotWildcard from "Common/Types/BaseDatabase/NotWildcard";
import Search from "Common/Types/BaseDatabase/Search";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import { FacetConfig } from "Common/UI/Components/TelemetryViewer/types";
import { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import {
  TraceAttributeFilters,
  TraceExclusions,
  applyTraceExclusionsToPayload,
  applyTraceExclusionsToQuery,
  compileTraceAttributeFilters,
  getTraceChipFacetKey,
  getTraceChosenFacetKeys,
  hasTraceExclusions,
  readTraceExclusions,
} from "../../FeatureSet/Dashboard/src/Components/Traces/TracesSearchCompile";
import {
  TracesPivotScopeResult,
  buildTracesPivotScope,
} from "../../FeatureSet/Dashboard/src/Utils/TraceCorrelatedSignals";
import {
  collectTraceEntityIdsToResolve,
  resolveTraceChipDisplay,
} from "../../FeatureSet/Dashboard/src/Components/Traces/TracesEntityDisplay";

/*
 * "Is not" in the traces explorer: a facet row's minus leaves its value out,
 * as a chip keyed `!` ("Status is not Error").
 *
 * The traces chart and facet counts are read through endpoints that took
 * only values to keep (statusCodes, spanKinds, ...), so the explorer offered
 * no exclude: the list would have left a status out under a chart still
 * counting it. These pin the one reading both transports are compiled from
 * - the span list's query and the histogram / facets / analytics body - and
 * the rule they share: a column that keeps values exactly drops what is
 * left out of it, and a name kept as a substring holds both.
 */

const ATTRIBUTE_FACET_KEYS: ReadonlySet<string> = new Set<string>([
  "resource.service.instance.id",
  "resource.host.name",
]);

const CHECKOUT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BILLING_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOST_ID: string = "5f4e3d2c-1b0a-4998-8776-655443322110";

function chips(
  entries: Array<[string, string]>,
): Array<{ facetKey: string; value: string }> {
  return entries.map(
    ([facetKey, value]: [string, string]): {
      facetKey: string;
      value: string;
    } => {
      return { facetKey, value };
    },
  );
}

function read(entries: Array<[string, string]>): TraceExclusions {
  return readTraceExclusions({
    chips: chips(entries),
    attributeFacetKeys: ATTRIBUTE_FACET_KEYS,
  });
}

function onQuery(
  entries: Array<[string, string]>,
  query: Record<string, unknown> = {},
): Record<string, unknown> {
  applyTraceExclusionsToQuery(query, read(entries));

  return query;
}

function onPayload(
  entries: Array<[string, string]>,
  payload: JSONObject = {},
): JSONObject {
  applyTraceExclusionsToPayload(payload, read(entries));

  return payload;
}

describe("reading the chips that leave values out", () => {
  test("only `!` chips, columns and attributes apart, once each", () => {
    expect(
      read([
        ["statusCode", "0"],
        ["!statusCode", "2"],
        ["!statusCode", "2"],
        ["!attributes.resource.host.name", buildSearchTokenValue("web 01")],
        ["!attributeSearches.http.url", "health"],
        ["!primaryEntityId", CHECKOUT_ID],
      ]),
    ).toEqual({
      columns: { statusCode: ["2"], primaryEntityId: [CHECKOUT_ID] },
      attributeChipValues: { "resource.host.name": ['"web 01"'] },
    });
  });

  test("a facet counted without its own selection leaves its own `!` chips out", () => {
    const exclusions: TraceExclusions = readTraceExclusions({
      chips: chips([
        ["!statusCode", "2"],
        ["!kind", "SPAN_KIND_CLIENT"],
        ["!attributes.resource.host.name", "web-01"],
        ["!serviceId", CHECKOUT_ID],
      ]),
      attributeFacetKeys: ATTRIBUTE_FACET_KEYS,
      omitFacetKey: "statusCode",
    });

    expect(exclusions.columns["statusCode"]).toBeUndefined();
    expect(exclusions.columns["kind"]).toEqual(["SPAN_KIND_CLIENT"]);

    expect(
      readTraceExclusions({
        chips: chips([["!attributes.resource.host.name", "web-01"]]),
        attributeFacetKeys: ATTRIBUTE_FACET_KEYS,
        omitFacetKey: "resource.host.name",
      }).attributeChipValues,
    ).toEqual({});

    expect(
      readTraceExclusions({
        chips: chips([["!serviceId", CHECKOUT_ID]]),
        attributeFacetKeys: ATTRIBUTE_FACET_KEYS,
        omitFacetKey: "primaryEntityId",
      }).columns,
    ).toEqual({});
  });

  test("an empty reading has nothing to leave out", () => {
    expect(hasTraceExclusions(read([["statusCode", "2"]]))).toBe(false);
    expect(hasTraceExclusions(read([["!statusCode", "2"]]))).toBe(true);
  });
});

describe("the span list leaves the values out", () => {
  test("a status, written as the sidebar answers it, is a != on the stored code", () => {
    const query: Record<string, unknown> = onQuery([["!statusCode", "2"]]);

    expect(query["statusCode"]).toBeInstanceOf(NotEqual);
    expect((query["statusCode"] as NotEqual<number>).value).toBe(
      SpanStatus.Error,
    );
  });

  test("several statuses, typed or numeric, are one NOT IN of codes", () => {
    const query: Record<string, unknown> = onQuery([
      ["!statusCode", "error"],
      ["!statusCode", "0"],
    ]);

    expect(query["statusCode"]).toBeInstanceOf(IncludesNone);
    expect((query["statusCode"] as IncludesNone).values).toEqual([
      SpanStatus.Error,
      SpanStatus.Unset,
    ]);
  });

  test("a span kind is left out as the stored enum", () => {
    const query: Record<string, unknown> = onQuery([["!kind", "client"]]);

    expect((query["kind"] as NotEqual<string>).value).toBe("SPAN_KIND_CLIENT");
  });

  test("'Has exception' left out is the spans without one", () => {
    expect(onQuery([["!hasException", "true"]])["hasException"]).toBe(false);
    expect(onQuery([["!hasException", "false"]])["hasException"]).toBe(true);
    expect(
      onQuery([
        ["!hasException", "true"],
        ["!hasException", "false"],
      ])["hasException"],
    ).toBeUndefined();
  });

  test("a service left out is a != on primaryEntityId; a resource rides excludedResourceFilters", () => {
    const query: Record<string, unknown> = onQuery([
      ["!primaryEntityId", CHECKOUT_ID],
      ["!serviceId", BILLING_ID],
      ["!hostId", HOST_ID],
    ]);

    expect(query["primaryEntityId"]).toBeInstanceOf(IncludesNone);
    expect((query["primaryEntityId"] as IncludesNone).values).toEqual([
      CHECKOUT_ID,
      BILLING_ID,
    ]);
    expect(query["excludedResourceFilters"]).toEqual({ hostId: [HOST_ID] });
    expect(query["hostId"]).toBeUndefined();
  });

  test("a column that keeps values exactly drops what is left out of it", () => {
    const query: Record<string, unknown> = onQuery(
      [
        ["!statusCode", "2"],
        ["!kind", "client"],
        ["!primaryEntityId", BILLING_ID],
        ["!hasException", "true"],
      ],
      {
        statusCode: SpanStatus.Ok,
        kind: "SPAN_KIND_SERVER",
        primaryEntityId: CHECKOUT_ID,
        hasException: true,
      },
    );

    expect(query).toEqual({
      statusCode: SpanStatus.Ok,
      kind: "SPAN_KIND_SERVER",
      primaryEntityId: CHECKOUT_ID,
      hasException: true,
    });
  });

  test("a span name left out is left out exactly", () => {
    const query: Record<string, unknown> = onQuery([
      ["!name", "GET /health"],
      ["!name", "GET /ready"],
    ]);

    expect(query["name"]).toBeInstanceOf(IncludesNone);
    expect((query["name"] as IncludesNone).values).toEqual([
      "GET /health",
      "GET /ready",
    ]);
  });

  test("a name searched as a substring holds both: GET, but not GET /health", () => {
    const search: Search<string> = new Search("GET");
    const query: Record<string, unknown> = onQuery(
      [["!name", "GET /health"]],
      { name: search },
    );

    expect(Array.isArray(query["name"])).toBe(true);
    const [kept, leftOut]: Array<unknown> = query["name"] as Array<unknown>;
    expect(kept).toBe(search);
    expect(leftOut).toBeInstanceOf(NotEqual);
  });

  test("names kept exactly already leave every other name out", () => {
    const kept: Includes = new Includes(["GET /orders"]);
    const query: Record<string, unknown> = onQuery([["!name", "GET /health"]], {
      name: kept,
    });

    expect(query["name"]).toBe(kept);
  });
});

describe("the chart and the facet counts leave the same values out", () => {
  test("each facet's values left out ride their own field", () => {
    expect(
      onPayload([
        ["!statusCode", "2"],
        ["!kind", "client"],
        ["!name", "GET /health"],
        ["!primaryEntityId", CHECKOUT_ID],
        ["!hostId", HOST_ID],
        ["!hasException", "true"],
      ]),
    ).toEqual({
      excludedStatusCodes: [SpanStatus.Error],
      excludedSpanKinds: ["SPAN_KIND_CLIENT"],
      excludedSpanNames: ["GET /health"],
      excludedServiceIds: [CHECKOUT_ID],
      excludedResourceFilters: { hostId: [HOST_ID] },
      hasException: false,
    });
  });

  test("a field the request already keeps wins, as the column does in the list", () => {
    expect(
      onPayload(
        [
          ["!statusCode", "2"],
          ["!kind", "client"],
          ["!name", "GET /health"],
          ["!primaryEntityId", CHECKOUT_ID],
          ["!hasException", "true"],
        ],
        {
          statusCodes: [SpanStatus.Ok],
          spanKinds: ["SPAN_KIND_SERVER"],
          spanNames: ["GET /orders"],
          serviceIds: [BILLING_ID],
          hasException: true,
        },
      ),
    ).toEqual({
      statusCodes: [SpanStatus.Ok],
      spanKinds: ["SPAN_KIND_SERVER"],
      spanNames: ["GET /orders"],
      serviceIds: [BILLING_ID],
      hasException: true,
    });
  });

  test("a name searched as a substring keeps the name left out beside it", () => {
    expect(
      onPayload([["!name", "GET /health"]], { nameSearchText: "GET" }),
    ).toEqual({ nameSearchText: "GET", excludedSpanNames: ["GET /health"] });
  });

  test("a column the endpoints have no field for stays with the list", () => {
    expect(onPayload([["!traceId", "abc"]])).toEqual({});
    expect(onQuery([["!traceId", "abc"]])["traceId"]).toBeInstanceOf(
      NotEqual,
    );
  });
});

describe("an attribute left out", () => {
  test("is a != in the list and the same operator on the wire", () => {
    const compiled: TraceAttributeFilters = compileTraceAttributeFilters({
      chipValues: {},
      excludedChipValues: {
        "resource.host.name": [buildSearchTokenValue("web 01")],
      },
      parsed: [],
      legacyContainsChips: {},
      scope: {},
    });

    expect(compiled.queryAttributes["resource.host.name"]).toBeInstanceOf(
      NotEqual,
    );
    expect(compiled.payloadAttributes["resource.host.name"]).toEqual({
      _type: ObjectType.NotEqual,
      value: "web 01",
    });
  });

  test("several values are one NOT IN, a pattern negated as the grammar negates it", () => {
    const compiled: TraceAttributeFilters = compileTraceAttributeFilters({
      chipValues: {},
      excludedChipValues: {
        "resource.host.name": ["web-01", "web-02"],
        "http.route": ["/api/*"],
      },
      parsed: [],
      legacyContainsChips: {},
      scope: {},
    });

    expect(compiled.queryAttributes["resource.host.name"]).toBeInstanceOf(
      IncludesNone,
    );
    expect(compiled.payloadAttributes["resource.host.name"]).toEqual({
      _type: ObjectType.IncludesNone,
      value: ["web-01", "web-02"],
    });
    expect(compiled.queryAttributes["http.route"]).toBeInstanceOf(NotWildcard);
  });

  test("an attribute the chips keep values of drops what is left out of it", () => {
    const compiled: TraceAttributeFilters = compileTraceAttributeFilters({
      chipValues: { "resource.host.name": ["web-01"] },
      excludedChipValues: { "resource.host.name": ["web-02"] },
      parsed: [],
      legacyContainsChips: {},
      scope: {},
    });

    expect(compiled.queryAttributes["resource.host.name"]).toBe("web-01");
    expect(compiled.payloadAttributes["resource.host.name"]).toBe("web-01");
  });

  test("several patterns left out AND in the list; the chart, which cannot hold that, stays wider", () => {
    const compiled: TraceAttributeFilters = compileTraceAttributeFilters({
      chipValues: {},
      excludedChipValues: { "http.route": ["/api/*", "/internal/*"] },
      parsed: [],
      legacyContainsChips: {},
      scope: {},
    });

    expect(Array.isArray(compiled.queryAttributes["http.route"])).toBe(true);
    expect(compiled.payloadAttributes["http.route"]).toBeUndefined();
  });

  test("the page's own scope still owns its key outright", () => {
    const compiled: TraceAttributeFilters = compileTraceAttributeFilters({
      chipValues: {},
      excludedChipValues: { "k8s.cluster.name": ["prod"] },
      parsed: [],
      legacyContainsChips: {},
      scope: { "k8s.cluster.name": "staging" },
    });

    expect(compiled.queryAttributes["k8s.cluster.name"]).toBe("staging");
    expect(compiled.payloadAttributes["k8s.cluster.name"]).toBe("staging");
  });
});

describe("a facet with a value left out is a choice in it", () => {
  test("a `!` chip counts under its facet", () => {
    expect(getTraceChipFacetKey("!statusCode", ATTRIBUTE_FACET_KEYS)).toBe(
      "statusCode",
    );
    expect(getTraceChipFacetKey("!serviceId", ATTRIBUTE_FACET_KEYS)).toBe(
      "primaryEntityId",
    );
    expect(
      getTraceChipFacetKey(
        "!attributes.resource.host.name",
        ATTRIBUTE_FACET_KEYS,
      ),
    ).toBe("resource.host.name");
    expect(
      getTraceChipFacetKey("!attributes.http.method", ATTRIBUTE_FACET_KEYS),
    ).toBeNull();
  });

  test("so the facet is counted without it, the values beside it keeping their counts", () => {
    expect(
      getTraceChosenFacetKeys(
        [{ facetKey: "!statusCode" }, { facetKey: "!kind" }],
        ATTRIBUTE_FACET_KEYS,
      ).sort(),
    ).toEqual(["kind", "statusCode"]);
  });
});

describe("a value left out is named like the one kept, and never pivoted as kept", () => {
  const FACET_CONFIGS: Array<FacetConfig> = [
    {
      key: "statusCode",
      title: "Status",
      valueDisplayMap: { "0": "Unset", "1": "Ok", "2": "Error" },
    },
    {
      key: "primaryEntityId",
      title: "Service",
      valueDisplayMap: { [CHECKOUT_ID]: "checkout" },
    },
  ];

  test("its chip reads as its facet and value, and keeps its own key", () => {
    const resolved: ActiveFilter = resolveTraceChipDisplay(
      {
        facetKey: "!statusCode",
        value: "2",
        displayKey: "!statusCode",
        displayValue: "2",
      },
      { facetConfigs: FACET_CONFIGS, entityNames: {} },
    );

    expect(resolved).toEqual({
      facetKey: "!statusCode",
      value: "2",
      displayKey: "Status",
      displayValue: "Error",
    });

    const attribute: ActiveFilter = resolveTraceChipDisplay(
      {
        facetKey: "!attributes.resource.host.name",
        value: buildSearchTokenValue("web 01"),
        displayKey: "",
        displayValue: "",
      },
      { facetConfigs: FACET_CONFIGS, entityNames: {} },
    );

    expect(attribute.facetKey).toBe("!attributes.resource.host.name");
    expect(attribute.displayKey).toBe("resource.host.name");
    expect(attribute.displayValue).toBe("web 01");
  });

  test("a service left out is looked up and named", () => {
    expect(
      collectTraceEntityIdsToResolve({
        chips: [{ facetKey: "!primaryEntityId", value: BILLING_ID }],
      }),
    ).toEqual([BILLING_ID]);

    expect(
      resolveTraceChipDisplay(
        {
          facetKey: "!primaryEntityId",
          value: CHECKOUT_ID,
          displayKey: "Service",
          displayValue: CHECKOUT_ID,
        },
        { facetConfigs: FACET_CONFIGS, entityNames: {} },
      ).displayValue,
    ).toBe("checkout");
  });

  test("a pivot names what is left out as not carried, and carries none of it", () => {
    const result: TracesPivotScopeResult = buildTracesPivotScope({
      primaryEntityId: undefined,
      scopeAttributeFilters: undefined,
      activeFilters: [
        { facetKey: "!primaryEntityId", value: CHECKOUT_ID },
        { facetKey: "!hostId", value: HOST_ID },
        { facetKey: "!attributes.resource.host.name", value: "web-01" },
        { facetKey: "!statusCode", value: "2" },
      ],
      fieldFilters: {},
      searchAttributes: {},
      searchAttributeSearches: {},
      freeText: "",
      rootOnly: false,
      hasEntityScope: false,
      startTime: new Date("2026-08-05T11:00:00.000Z"),
      endTime: new Date("2026-08-05T12:00:00.000Z"),
    });

    expect(result.scope.serviceIds).toBeUndefined();
    expect(result.scope.resourceFacetSelections).toBeUndefined();
    expect(result.scope.attributes).toBeUndefined();
    expect(result.notCarried).toEqual(["excluded values"]);
  });
});
