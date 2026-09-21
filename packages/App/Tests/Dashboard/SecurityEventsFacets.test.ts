import { describe, expect, test } from "@jest/globals";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  FacetConfig,
  FacetValue,
} from "Common/UI/Components/TelemetryViewer/types";
import {
  SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX,
  SECURITY_EVENT_EXCLUDE_FACET_PREFIX,
  SECURITY_EVENT_FACETS,
  SECURITY_EVENT_FACET_KEYS,
  SECURITY_EVENT_FACET_VALUE_LIMIT,
  SECURITY_EVENT_SOURCE_FACET_KEY,
  SecurityEventFacetDefinition,
  applySecurityEventFacetFiltersToQuery,
  buildSecurityEventFacetAggregateBy,
  buildSecurityEventFacetConfigs,
  buildSecurityEventFacetLinkParams,
  buildSecurityEventFacetValues,
  getSecurityEventAttributeKey,
  getSecurityEventBaseFacetKey,
  getSecurityEventFacetChipDisplayKey,
  getSecurityEventFacetChipDisplayValue,
  isSecurityEventAttributeFacetKey,
  isSecurityEventExcludeFacetKey,
  toSecurityEventExcludeFacetKey,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsFacets";
import { SECURITY_EVENT_VOLUME_COLORS } from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventVolume";

/*
 * The Security Events facet sidebar, as data.
 *
 * Everything here is pure: which dimensions the sidebar offers, how a click
 * on one becomes a predicate on the list query, and what the aggregate that
 * counts a dimension's values actually asks for. The counting is done
 * client-side through the generic /aggregate route rather than a bespoke
 * /telemetry/security-events/facets endpoint, so these are the only place
 * the contract is written down.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const WINDOW_START: Date = new Date("2026-09-17T00:00:00.000Z");
const WINDOW_END: Date = new Date("2026-09-18T00:00:00.000Z");

function baseQuery(): Query<SecurityEvent> {
  return {
    projectId: PROJECT_ID,
    time: new InBetween<Date>(WINDOW_START, WINDOW_END),
  } as Query<SecurityEvent>;
}

function filters(
  entries: Array<[string, Array<string>]>,
): Map<string, Set<string>> {
  return new Map(
    entries.map((entry: [string, Array<string>]): [string, Set<string>] => {
      return [entry[0], new Set(entry[1])];
    }),
  );
}

function applied(
  entries: Array<[string, Array<string>]>,
): Record<string, unknown> {
  return applySecurityEventFacetFiltersToQuery({
    query: baseQuery(),
    filters: filters(entries),
  }) as Record<string, unknown>;
}

function row(facetKey: string, value: unknown, count: number): AggregatedModel {
  return {
    timestamp: WINDOW_START as unknown as Date,
    value: count,
    [facetKey]: value,
  } as unknown as AggregatedModel;
}

describe("the facet catalog", () => {
  test("offers the OCSF dimensions a responder triages by, Source and Severity first", () => {
    expect(SECURITY_EVENT_FACET_KEYS).toEqual([
      "primaryEntityId",
      "severityName",
      "className",
      "categoryName",
      "activityName",
      "statusName",
      "vendorName",
      "productName",
      "ruleName",
      "principalUser",
      "principalHost",
    ]);
  });

  test("every facet key is a real SecurityEvent column", () => {
    const columns: Array<string> = new SecurityEvent().tableColumns.map(
      (column: { key: string }): string => {
        return column.key;
      },
    );

    for (const key of SECURITY_EVENT_FACET_KEYS) {
      expect(columns).toContain(key);
    }
  });

  /*
   * Grouping by an Array(String) column groups by the WHOLE array, so its
   * facet values would be "10.0.0.4, web-01, alice" rather than three
   * choices. Those dimensions are reachable from the search bar instead.
   */
  test("no array column is offered as a facet", () => {
    for (const arrayColumn of [
      "observables",
      "mitreTactics",
      "mitreTechniques",
    ]) {
      expect(SECURITY_EVENT_FACET_KEYS).not.toContain(arrayColumn);
    }
  });

  test("message is not a facet — the search bar owns free text", () => {
    expect(SECURITY_EVENT_FACET_KEYS).not.toContain("message");
  });

  test("priorities are unique and ascending in declared order", () => {
    const priorities: Array<number> = SECURITY_EVENT_FACETS.map(
      (facet: SecurityEventFacetDefinition): number => {
        return facet.priority;
      },
    );

    expect(new Set(priorities).size).toBe(priorities.length);
    expect(
      [...priorities].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(priorities);
  });

  test("each facet names itself in the singular and the plural", () => {
    for (const facet of SECURITY_EVENT_FACETS) {
      expect(facet.title.length).toBeGreaterThan(0);
      expect(facet.pluralTitle.length).toBeGreaterThan(0);
    }
  });
});

describe("buildSecurityEventFacetConfigs", () => {
  const configs: Array<FacetConfig> = buildSecurityEventFacetConfigs();

  test("emits one config per facet, in catalog order", () => {
    expect(
      configs.map((config: FacetConfig): string => {
        return config.key;
      }),
    ).toEqual([...SECURITY_EVENT_FACET_KEYS]);
  });

  test("severity carries the volume chart's colours, so a colour means one thing on the page", () => {
    const severity: FacetConfig = configs.find((config: FacetConfig) => {
      return config.key === "severityName";
    })!;

    expect(severity.valueColorMap?.[OcsfSeverity.Critical]).toBe(
      SECURITY_EVENT_VOLUME_COLORS[OcsfSeverity.Critical],
    );
    expect(severity.valueColorMap?.[OcsfSeverity.Informational]).toBe(
      SECURITY_EVENT_VOLUME_COLORS[OcsfSeverity.Informational],
    );
  });

  test("every section folds away while empty, and says so in the plural", () => {
    for (const config of configs) {
      const facet: SecurityEventFacetDefinition = SECURITY_EVENT_FACETS.find(
        (candidate: SecurityEventFacetDefinition) => {
          return candidate.key === config.key;
        },
      )!;

      expect(config.hideWhenEmpty).toBe(true);
      expect(config.emptyStateNoun).toBe(facet.pluralTitle);
    }
  });

  test("Source lists service names when they are loaded, and nothing invented when they are not", () => {
    const named: Array<FacetConfig> = buildSecurityEventFacetConfigs({
      sourceNames: { "source-1": "Google SecOps" },
    });

    const source: FacetConfig = named.find((config: FacetConfig) => {
      return config.key === SECURITY_EVENT_SOURCE_FACET_KEY;
    })!;

    expect(source.valueDisplayMap).toEqual({ "source-1": "Google SecOps" });

    const unnamed: FacetConfig = configs.find((config: FacetConfig) => {
      return config.key === SECURITY_EVENT_SOURCE_FACET_KEY;
    })!;

    expect(unnamed.valueDisplayMap).toBeUndefined();
  });
});

describe("facet key grammar", () => {
  test("an exclude key is the include key with a marker, and round-trips", () => {
    const excluded: string = toSecurityEventExcludeFacetKey("severityName");

    expect(excluded).toBe(`${SECURITY_EVENT_EXCLUDE_FACET_PREFIX}severityName`);
    expect(isSecurityEventExcludeFacetKey(excluded)).toBe(true);
    expect(getSecurityEventBaseFacetKey(excluded)).toBe("severityName");
  });

  test("marking an already-excluded key is idempotent", () => {
    const once: string = toSecurityEventExcludeFacetKey("className");

    expect(toSecurityEventExcludeFacetKey(once)).toBe(once);
  });

  test("attribute keys are recognised through the exclude marker", () => {
    const attributeKey: string = `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}threat.matched`;

    expect(isSecurityEventAttributeFacetKey(attributeKey)).toBe(true);
    expect(getSecurityEventAttributeKey(attributeKey)).toBe("threat.matched");

    const excluded: string = toSecurityEventExcludeFacetKey(attributeKey);

    expect(isSecurityEventAttributeFacetKey(excluded)).toBe(true);
    expect(getSecurityEventAttributeKey(excluded)).toBe("threat.matched");
  });

  test("a column key is not an attribute key", () => {
    expect(isSecurityEventAttributeFacetKey("severityName")).toBe(false);
  });
});

describe("chip labels", () => {
  test("a known facet reads by its title", () => {
    expect(getSecurityEventFacetChipDisplayKey("severityName")).toBe(
      "Severity",
    );
    expect(getSecurityEventFacetChipDisplayKey("ruleName")).toBe(
      "Detection Rule",
    );
    expect(
      getSecurityEventFacetChipDisplayKey(SECURITY_EVENT_SOURCE_FACET_KEY),
    ).toBe("Source");
  });

  test("an attribute chip drops the prefix", () => {
    expect(
      getSecurityEventFacetChipDisplayKey(
        `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}device.hostname`,
      ),
    ).toBe("device.hostname");
  });

  /*
   * The one mistake a filter chip must never make: reading as the opposite
   * of the filter it applies.
   */
  test("an excluded chip says it excludes", () => {
    expect(
      getSecurityEventFacetChipDisplayKey(
        toSecurityEventExcludeFacetKey("severityName"),
      ),
    ).toBe("Severity is not");
    expect(
      getSecurityEventFacetChipDisplayKey(
        toSecurityEventExcludeFacetKey(
          `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}threat.matched`,
        ),
      ),
    ).toBe("threat.matched is not");
  });

  test("an unknown key keeps its raw name rather than guessing", () => {
    expect(getSecurityEventFacetChipDisplayKey("somethingNew")).toBe(
      "somethingNew",
    );
  });

  test("only Source translates its value, and an unnamed id keeps its id", () => {
    const names: Record<string, string> = { "source-1": "Google SecOps" };

    expect(
      getSecurityEventFacetChipDisplayValue(
        SECURITY_EVENT_SOURCE_FACET_KEY,
        "source-1",
        names,
      ),
    ).toBe("Google SecOps");
    expect(
      getSecurityEventFacetChipDisplayValue(
        toSecurityEventExcludeFacetKey(SECURITY_EVENT_SOURCE_FACET_KEY),
        "source-1",
        names,
      ),
    ).toBe("Google SecOps");
    expect(
      getSecurityEventFacetChipDisplayValue(
        SECURITY_EVENT_SOURCE_FACET_KEY,
        "source-2",
        names,
      ),
    ).toBe("source-2");
    expect(
      getSecurityEventFacetChipDisplayValue("severityName", "Critical", names),
    ).toBe("Critical");
  });
});

describe("buildSecurityEventFacetAggregateBy", () => {
  const aggregate: AggregateBy<SecurityEvent> =
    buildSecurityEventFacetAggregateBy({
      query: baseQuery(),
      facetKey: "severityName",
      startDate: WINDOW_START,
      endDate: WINDOW_END,
      limit: SECURITY_EVENT_FACET_VALUE_LIMIT,
    });

  /*
   * Without Total the server buckets by time and hands back one row per
   * (bucket, value) — the caller would have to re-add them, and the limit
   * would cut buckets rather than values.
   */
  test("collapses the whole window into one row per value", () => {
    expect(aggregate.aggregationInterval).toBe(AggregationInterval.Total);
    expect(aggregate.groupBy).toEqual({ severityName: true });
  });

  test("counts rows, through a column that is never null", () => {
    expect(aggregate.aggregationType).toBe(AggregationType.Count);
    expect(aggregate.aggregateColumnName).toBe("eventUid");

    const eventUid: { required: boolean; defaultValue: unknown } | undefined =
      new SecurityEvent().tableColumns.find((column: { key: string }) => {
        return column.key === "eventUid";
      }) as unknown as { required: boolean; defaultValue: unknown } | undefined;

    expect(eventUid?.required).toBe(true);
    expect(eventUid?.defaultValue).toBe("");
  });

  /*
   * THE regression this test exists for. Under Total the select aliases the
   * aggregate back onto the column name, so ordering by `time` orders by
   * min(time) and the Top-N keeps the N values whose FIRST event is oldest —
   * the busiest principal in the window would be missing from its own facet
   * whenever it first appeared late.
   */
  test("takes the top N by COUNT, not by first-seen time", () => {
    expect(aggregate.sort).toEqual({ eventUid: SortOrder.Descending });
    expect(aggregate.limit).toBe(SECURITY_EVENT_FACET_VALUE_LIMIT);
    expect(aggregate.skip).toBe(0);
  });

  test("counts exactly the rows the list is showing", () => {
    const scoped: AggregateBy<SecurityEvent> =
      buildSecurityEventFacetAggregateBy({
        query: applySecurityEventFacetFiltersToQuery({
          query: baseQuery(),
          filters: filters([["className", ["Authentication"]]]),
        }),
        facetKey: "vendorName",
        startDate: WINDOW_START,
        endDate: WINDOW_END,
        limit: 25,
      });

    expect((scoped.query as Record<string, unknown>)["className"]).toBe(
      "Authentication",
    );
    expect((scoped.query as Record<string, unknown>)["projectId"]).toBe(
      PROJECT_ID,
    );
    expect(scoped.startTimestamp).toEqual(WINDOW_START);
    expect(scoped.endTimestamp).toEqual(WINDOW_END);
    expect(scoped.aggregationTimestampColumnName).toBe("time");
  });
});

describe("buildSecurityEventFacetValues", () => {
  test("reads the group value and its count, highest first", () => {
    expect(
      buildSecurityEventFacetValues({
        rows: [
          row("severityName", OcsfSeverity.Low, 3),
          row("severityName", OcsfSeverity.Critical, 12),
          row("severityName", OcsfSeverity.High, 7),
        ],
        facetKey: "severityName",
      }),
    ).toEqual([
      { value: OcsfSeverity.Critical, count: 12 },
      { value: OcsfSeverity.High, count: 7 },
      { value: OcsfSeverity.Low, count: 3 },
    ]);
  });

  test("ties break alphabetically, so the list does not shuffle between refreshes", () => {
    expect(
      buildSecurityEventFacetValues({
        rows: [row("vendorName", "Zscaler", 4), row("vendorName", "Acme", 4)],
        facetKey: "vendorName",
      }).map((value: FacetValue): string => {
        return value.value;
      }),
    ).toEqual(["Acme", "Zscaler"]);
  });

  /*
   * Every one of these columns defaults to '' meaning "the source did not
   * say". A facet value that filters to "said nothing" is not a choice worth
   * offering.
   */
  test("drops the empty group rather than offering a blank choice", () => {
    expect(
      buildSecurityEventFacetValues({
        rows: [row("statusName", "", 40), row("statusName", "Failure", 2)],
        facetKey: "statusName",
      }),
    ).toEqual([{ value: "Failure", count: 2 }]);
  });

  test("adds rows that normalize to the same value instead of overwriting", () => {
    expect(
      buildSecurityEventFacetValues({
        rows: [
          row("productName", "Defender", 2),
          row("productName", "Defender", 5),
        ],
        facetKey: "productName",
      }),
    ).toEqual([{ value: "Defender", count: 7 }]);
  });

  test("ignores rows with no usable group value or count", () => {
    expect(
      buildSecurityEventFacetValues({
        rows: [
          row("vendorName", null, 9),
          row("vendorName", undefined, 9),
          row("vendorName", "Acme", 0),
          row("vendorName", "Acme", Number.NaN),
          row("vendorName", "Real", 1),
        ],
        facetKey: "vendorName",
      }),
    ).toEqual([{ value: "Real", count: 1 }]);
  });

  test("numbers are read as values (a uid column groups numerically)", () => {
    expect(
      buildSecurityEventFacetValues({
        rows: [row("classUid", 3002, 5)],
        facetKey: "classUid",
      }),
    ).toEqual([{ value: "3002", count: 5 }]);
  });

  test("cuts the tail at the limit", () => {
    const rows: Array<AggregatedModel> = Array.from(
      { length: 10 },
      (_unused: unknown, index: number): AggregatedModel => {
        return row("principalUser", `user-${index}`, 100 - index);
      },
    );

    expect(
      buildSecurityEventFacetValues({
        rows,
        facetKey: "principalUser",
        limit: 3,
      }),
    ).toEqual([
      { value: "user-0", count: 100 },
      { value: "user-1", count: 99 },
      { value: "user-2", count: 98 },
    ]);
  });

  test("defaults to the sidebar's own limit", () => {
    const rows: Array<AggregatedModel> = Array.from(
      { length: SECURITY_EVENT_FACET_VALUE_LIMIT + 5 },
      (_unused: unknown, index: number): AggregatedModel => {
        return row("principalHost", `host-${index}`, index + 1);
      },
    );

    expect(
      buildSecurityEventFacetValues({ rows, facetKey: "principalHost" }),
    ).toHaveLength(SECURITY_EVENT_FACET_VALUE_LIMIT);
  });
});

describe("applySecurityEventFacetFiltersToQuery", () => {
  test("leaves the base query alone and returns a new one", () => {
    const query: Query<SecurityEvent> = baseQuery();
    const next: Query<SecurityEvent> = applySecurityEventFacetFiltersToQuery({
      query,
      filters: filters([["severityName", ["Critical"]]]),
    });

    expect(next).not.toBe(query);
    expect((query as Record<string, unknown>)["severityName"]).toBeUndefined();
    expect((next as Record<string, unknown>)["projectId"]).toBe(PROJECT_ID);
    expect((next as Record<string, unknown>)["time"]).toBeInstanceOf(InBetween);
  });

  test("one value is a plain equality, so ClickHouse keeps the column's skip index", () => {
    expect(applied([["severityName", ["Critical"]]])["severityName"]).toBe(
      "Critical",
    );
  });

  test("several values become an IN", () => {
    const includes: unknown = applied([["severityName", ["Critical", "High"]]])[
      "severityName"
    ];

    expect(includes).toBeInstanceOf(Includes);
    expect((includes as Includes).values).toEqual(["Critical", "High"]);
  });

  test("an exclusion of one value is a not-equal, of several a NOT IN", () => {
    const one: unknown = applied([
      [toSecurityEventExcludeFacetKey("severityName"), ["Informational"]],
    ])["severityName"];

    expect(one).toBeInstanceOf(NotEqual);
    expect((one as NotEqual<string>).value).toBe("Informational");

    const many: unknown = applied([
      [
        toSecurityEventExcludeFacetKey("severityName"),
        ["Informational", "Unknown"],
      ],
    ])["severityName"];

    expect(many).toBeInstanceOf(IncludesNone);
    expect((many as IncludesNone).values).toEqual(["Informational", "Unknown"]);
  });

  test("an attribute chip lands in the attributes map as an equality", () => {
    const attributes: Record<string, unknown> = applied([
      [`${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}threat.matched`, ["true"]],
    ])["attributes"] as Record<string, unknown>;

    expect(attributes).toEqual({ "threat.matched": "true" });
  });

  test("attribute chips merge instead of replacing the map", () => {
    const attributes: Record<string, unknown> = applied([
      [`${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}threat.matched`, ["true"]],
      [`${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}device.hostname`, ["web-01"]],
    ])["attributes"] as Record<string, unknown>;

    expect(Object.keys(attributes).sort()).toEqual([
      "device.hostname",
      "threat.matched",
    ]);
  });

  test("an excluded attribute chip is a not-equal on its key", () => {
    const attributes: Record<string, unknown> = applied([
      [
        toSecurityEventExcludeFacetKey(
          `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}threat.matched`,
        ),
        ["true"],
      ],
    ])["attributes"] as Record<string, unknown>;

    expect(attributes["threat.matched"]).toBeInstanceOf(NotEqual);
  });

  test("an empty selection sets no predicate at all", () => {
    const query: Record<string, unknown> = applied([
      ["severityName", []],
      ["className", [""]],
    ]);

    expect(query["severityName"]).toBeUndefined();
    expect(query["className"]).toBeUndefined();
    expect(query["attributes"]).toBeUndefined();
  });

  /*
   * A state the sidebar cannot reach on purpose (including flips an
   * exclusion and vice versa) — but a hand-edited link can. Narrowing to a
   * value is a more useful reading than a query that requires and excludes
   * the same thing and returns nothing.
   */
  test("when a column is both included and excluded, the inclusion wins", () => {
    const query: Record<string, unknown> = applied([
      [toSecurityEventExcludeFacetKey("severityName"), ["Critical"]],
      ["severityName", ["Critical"]],
    ]);

    expect(query["severityName"]).toBe("Critical");
  });

  test("the same holds whichever order the chips were written in", () => {
    const query: Record<string, unknown> = applied([
      ["severityName", ["Critical"]],
      [toSecurityEventExcludeFacetKey("severityName"), ["Critical"]],
    ]);

    expect(query["severityName"]).toBe("Critical");
  });

  test("a malformed attribute key (bare prefix) is dropped", () => {
    expect(
      applied([[SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX, ["x"]]])["attributes"],
    ).toBeUndefined();
  });
});

describe("buildSecurityEventFacetLinkParams", () => {
  test("writes the explorers' filters grammar", () => {
    const params: Dictionary<string> = buildSecurityEventFacetLinkParams([
      ["attributes.oneuptime.security_connection.id", "conn-1"],
    ]);

    expect(JSON.parse(decodeURIComponent(params["filters"]!))).toEqual([
      ["attributes.oneuptime.security_connection.id", "conn-1"],
    ]);
  });

  test("encodes once, so the reader's single decode gets the value back", () => {
    const params: Dictionary<string> = buildSecurityEventFacetLinkParams([
      ["attributes.url", "https://example.com/a?b=c&d=e"],
    ]);

    expect(JSON.parse(decodeURIComponent(params["filters"]!))).toEqual([
      ["attributes.url", "https://example.com/a?b=c&d=e"],
    ]);
  });

  test("nothing to filter on writes no param, so a link can spread it blindly", () => {
    expect(buildSecurityEventFacetLinkParams([])).toEqual({});
    expect(buildSecurityEventFacetLinkParams([["", "x"]])).toEqual({});
    expect(buildSecurityEventFacetLinkParams([["severityName", ""]])).toEqual(
      {},
    );
  });
});
