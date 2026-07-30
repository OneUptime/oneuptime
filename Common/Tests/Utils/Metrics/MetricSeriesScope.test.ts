import IsNull from "../../../Types/BaseDatabase/IsNull";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import {
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
  detectOperatorFromValue,
  getOperatorOption,
} from "../../../UI/Components/Dictionary/DictionaryFilterOperator";
import MetricSeriesScope, {
  MetricSeriesFilterValue,
} from "../../../Utils/Metrics/MetricSeriesScope";
import { describe, expect, test } from "@jest/globals";

/*
 * A metric monitor grouped by an attribute (host.name, pod, device) opens
 * ONE incident per breaching group, but every one of those incidents
 * stores the SAME monitor-wide query configs. Charting them verbatim shows
 * every group — so an incident about prod-01 renders a wall of unrelated
 * hosts, and once the Top-N cap trims the result the breaching host can be
 * missing from its own incident page entirely.
 *
 * MetricSeriesScope narrows those configs back to the incident's own
 * series using the labels recorded on the incident. These tests lock the
 * three properties the fix depends on:
 *
 *   1. PER-QUERY intersection. The monitor worker groups every query by
 *      the UNION of group-by keys across all queries, so seriesLabels
 *      routinely carries keys a given query never grouped by. Filtering a
 *      query on a dimension it did not group by would narrow the chart to
 *      something the monitor never evaluated.
 *   2. Faithful value translation. "" means "the attribute was absent on
 *      this series" — that is the IsEmpty operator, not an equality
 *      against the empty string (which the chart's filter sanitizer drops
 *      on the floor, silently un-scoping the chart).
 *   3. Identity preservation. React hosts call this on every load; handing
 *      back a fresh-but-equal object where nothing changed would churn
 *      state and refetch.
 */

interface QueryConfigFixture {
  id?: string | undefined;
  groupByAttributeKeys?: Array<string> | undefined;
  attributes?: Dictionary<unknown> | undefined;
  metricName?: string | undefined;
  topN?: number | undefined;
}

function buildQueryConfig(
  fixture: QueryConfigFixture = {},
): MetricQueryConfigData {
  return {
    id: fixture.id || "query-id-1",
    metricAliasData: {
      metricVariable: "a",
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: fixture.metricName || "system.cpu.utilization",
        aggegationType: "Avg",
        ...(fixture.attributes ? { attributes: fixture.attributes } : {}),
      },
      ...(fixture.groupByAttributeKeys
        ? { groupByAttributeKeys: fixture.groupByAttributeKeys }
        : {}),
      ...(fixture.topN === undefined ? {} : { topN: fixture.topN }),
    },
  } as unknown as MetricQueryConfigData;
}

function getAttributes(
  queryConfig: MetricQueryConfigData | undefined,
): Dictionary<unknown> {
  return (
    queryConfig?.metricQueryData?.filterData as Dictionary<unknown> | undefined
  )?.["attributes"] as Dictionary<unknown> | undefined as Dictionary<unknown>;
}

describe("MetricSeriesScope.hasSeriesLabels", () => {
  test("is false for undefined, null and the empty object", () => {
    expect(MetricSeriesScope.hasSeriesLabels(undefined)).toBe(false);
    expect(MetricSeriesScope.hasSeriesLabels(null)).toBe(false);
    expect(MetricSeriesScope.hasSeriesLabels({})).toBe(false);
  });

  test("is true as soon as there is one label", () => {
    expect(MetricSeriesScope.hasSeriesLabels({ "host.name": "prod-01" })).toBe(
      true,
    );
    // Even an unset value still identifies a series.
    expect(MetricSeriesScope.hasSeriesLabels({ "host.name": "" })).toBe(true);
  });
});

describe("MetricSeriesScope.getSeriesFilterAttributesForQuery", () => {
  test("returns nothing when the incident carries no series labels", () => {
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["host.name"],
    });

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: undefined,
      }),
    ).toEqual({});
    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: null,
      }),
    ).toEqual({});
    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: {},
      }),
    ).toEqual({});
  });

  test("returns nothing for a missing query config", () => {
    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig: undefined,
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toEqual({});
    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig: null,
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toEqual({});
  });

  test("returns nothing when the query is not grouped at all", () => {
    /*
     * An ungrouped query already renders a single line — narrowing it
     * would change what the monitor evaluated.
     */
    const queryConfig: MetricQueryConfigData = buildQueryConfig({});

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toEqual({});
  });

  test("maps a grouped key to an exact-equality string filter", () => {
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["host.name"],
    });

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toEqual({ "host.name": "prod-01" });
  });

  test("maps every grouped key when the series is multi-dimensional", () => {
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["host.name", "service.name"],
    });

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { "host.name": "prod-01", "service.name": "api" },
      }),
    ).toEqual({ "host.name": "prod-01", "service.name": "api" });
  });

  test("ignores label keys this query did not group by", () => {
    /*
     * The monitor worker groups EVERY query by the union of group-by keys
     * across all queries, so seriesLabels carries keys a given query never
     * asked for. Filtering on them would scope the chart to something the
     * monitor never evaluated.
     */
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["host.name"],
    });

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: {
          "host.name": "prod-01",
          "k8s.pod.name": "checkout-abc",
        },
      }),
    ).toEqual({ "host.name": "prod-01" });
  });

  test("ignores grouped keys the incident's series says nothing about", () => {
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["host.name", "service.name"],
    });

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toEqual({ "host.name": "prod-01" });
  });

  test("translates an empty label value into the IsEmpty operator", () => {
    /*
     * "" is what the series builder writes when the attribute is missing
     * on the sample. An equality filter on "" is dropped by the chart's
     * sanitizer, which would silently un-scope the chart; IsNull compiles
     * to "key absent OR value empty", which is exactly the series.
     */
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["host.name"],
    });

    const filters: Dictionary<MetricSeriesFilterValue> =
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { "host.name": "" },
      });

    expect(Object.keys(filters)).toEqual(["host.name"]);
    expect(filters["host.name"]).toBeInstanceOf(IsNull);
  });

  test("treats null and an explicitly-undefined label value as IsEmpty", () => {
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["host.name"],
    });

    const withNull: Dictionary<MetricSeriesFilterValue> =
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { "host.name": null } as unknown as JSONObject,
      });
    expect(withNull["host.name"]).toBeInstanceOf(IsNull);

    const withUndefined: Dictionary<MetricSeriesFilterValue> =
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { "host.name": undefined } as unknown as JSONObject,
      });
    expect(withUndefined["host.name"]).toBeInstanceOf(IsNull);
  });

  test("skips whitespace-only values rather than pretending they are unset", () => {
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["host.name"],
    });

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { "host.name": "   " },
      }),
    ).toEqual({});
  });

  test("preserves surrounding whitespace and case on real values", () => {
    /*
     * Attributes are matched byte-exactly against the analytics store, so
     * trimming or lower-casing here would silently chart nothing.
     */
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["host.name"],
    });

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { "host.name": " PROD-01 " },
      }),
    ).toEqual({ "host.name": " PROD-01 " });
  });

  test("stringifies numeric and boolean label values", () => {
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["http.status_code", "is.canary"],
    });

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { "http.status_code": 200, "is.canary": false },
      }),
    ).toEqual({ "http.status_code": "200", "is.canary": "false" });
  });

  test("keeps the zero value — it is a real label, not an empty one", () => {
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["pool_id"],
    });

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { pool_id: 0 },
      }),
    ).toEqual({ pool_id: "0" });
  });

  test("skips non-finite numbers", () => {
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["weird"],
    });

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { weird: Number.NaN },
      }),
    ).toEqual({});
    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { weird: Number.POSITIVE_INFINITY },
      }),
    ).toEqual({});
  });

  test("skips array and object label values", () => {
    /*
     * Metric attributes are a Map(String, String); String([1,2]) or
     * "[object Object]" would compile to a predicate matching nothing,
     * which is worse than leaving the chart un-narrowed.
     */
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["tags", "meta", "when"],
    });

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: {
          tags: ["a", "b"],
          meta: { nested: true },
          when: new Date("2024-01-01T00:00:00.000Z"),
        } as unknown as JSONObject,
      }),
    ).toEqual({});
  });

  test("keeps dotted and resource-prefixed keys verbatim", () => {
    /*
     * The `resource.` prefix is applied at INGEST, so the group-by
     * dropdown, the stored query config and seriesLabels all agree on the
     * literal key. Adding or stripping it here would address a different
     * map entry and match nothing.
     */
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["resource.k8s.node.name", "container.name"],
    });

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: {
          "resource.k8s.node.name": "ip-10-0-1-7",
          "container.name": "api.1.xyz",
        },
      }),
    ).toEqual({
      "resource.k8s.node.name": "ip-10-0-1-7",
      "container.name": "api.1.xyz",
    });
  });

  test("does not treat a bare key as the resource-prefixed one", () => {
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["resource.host.name"],
    });

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toEqual({});
  });

  test("ignores blank group-by keys and collapses duplicates", () => {
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["", "host.name", "host.name"],
    });

    const filters: Dictionary<MetricSeriesFilterValue> =
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { "host.name": "prod-01", "": "ignored" },
      });

    expect(filters).toEqual({ "host.name": "prod-01" });
    expect(Object.keys(filters)).toHaveLength(1);
  });

  test("does not pick up inherited prototype keys as labels", () => {
    const queryConfig: MetricQueryConfigData = buildQueryConfig({
      groupByAttributeKeys: ["toString", "constructor"],
    });

    expect(
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig,
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toEqual({});
  });
});

describe("MetricSeriesScope.scopeQueryConfigsToSeries — identity", () => {
  test("hands back the very same array when there are no series labels", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({ groupByAttributeKeys: ["host.name"] }),
    ];

    expect(
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs,
        seriesLabels: undefined,
      }),
    ).toBe(queryConfigs);
    expect(
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs,
        seriesLabels: {},
      }),
    ).toBe(queryConfigs);
  });

  test("hands back the very same array when nothing could be narrowed", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({ groupByAttributeKeys: ["host.name"] }),
    ];

    expect(
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs,
        seriesLabels: { "k8s.pod.name": "checkout-abc" },
      }),
    ).toBe(queryConfigs);
  });

  test("tolerates a missing or empty query config list", () => {
    expect(
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs: undefined,
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toEqual([]);
    expect(
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs: null,
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toEqual([]);
    expect(
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs: [],
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toEqual([]);
  });
});

describe("MetricSeriesScope.scopeQueryConfigsToSeries — narrowing", () => {
  test("pushes the series onto the query's attribute filter", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({ groupByAttributeKeys: ["host.name"] }),
    ];

    const scoped: Array<MetricQueryConfigData> =
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs,
        seriesLabels: { "host.name": "prod-01" },
      });

    expect(scoped).not.toBe(queryConfigs);
    expect(getAttributes(scoped[0])).toEqual({ "host.name": "prod-01" });
  });

  test("keeps the group-by so the surviving series is still named", () => {
    /*
     * Dropping groupByAttributeKeys would collapse the legend to a bare
     * metric name — the chart would be correct but would no longer say
     * WHICH host it is showing.
     */
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({ groupByAttributeKeys: ["host.name"] }),
    ];

    const scoped: Array<MetricQueryConfigData> =
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs,
        seriesLabels: { "host.name": "prod-01" },
      });

    expect(scoped[0]?.metricQueryData.groupByAttributeKeys).toEqual([
      "host.name",
    ]);
  });

  test("merges with — and wins over — filters the monitor already carried", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({
        groupByAttributeKeys: ["host.name"],
        attributes: {
          "deployment.environment": "production",
          "host.name": "prod-99",
        },
      }),
    ];

    const scoped: Array<MetricQueryConfigData> =
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs,
        seriesLabels: { "host.name": "prod-01" },
      });

    expect(getAttributes(scoped[0])).toEqual({
      "deployment.environment": "production",
      "host.name": "prod-01",
    });
  });

  test("never mutates the query configs it was handed", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({
        groupByAttributeKeys: ["host.name"],
        attributes: { "deployment.environment": "production" },
      }),
    ];
    const snapshot: string = JSON.stringify(queryConfigs);

    MetricSeriesScope.scopeQueryConfigsToSeries({
      queryConfigs,
      seriesLabels: { "host.name": "prod-01" },
    });

    expect(JSON.stringify(queryConfigs)).toBe(snapshot);
    expect(getAttributes(queryConfigs[0])).toEqual({
      "deployment.environment": "production",
    });
  });

  test("narrows each query by its OWN group-by only", () => {
    /*
     * The realistic shape: the worker groups both queries by the union
     * {host.name, k8s.pod.name}, so the incident carries both keys — but
     * the chart splits each query by only the keys that query configured.
     */
    const hostQuery: MetricQueryConfigData = buildQueryConfig({
      id: "host-query",
      groupByAttributeKeys: ["host.name"],
    });
    const podQuery: MetricQueryConfigData = buildQueryConfig({
      id: "pod-query",
      groupByAttributeKeys: ["k8s.pod.name"],
    });

    const scoped: Array<MetricQueryConfigData> =
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs: [hostQuery, podQuery],
        seriesLabels: {
          "host.name": "prod-01",
          "k8s.pod.name": "checkout-abc",
        },
      });

    expect(getAttributes(scoped[0])).toEqual({ "host.name": "prod-01" });
    expect(getAttributes(scoped[1])).toEqual({
      "k8s.pod.name": "checkout-abc",
    });
  });

  test("passes ungrouped queries through untouched, by identity", () => {
    const groupedQuery: MetricQueryConfigData = buildQueryConfig({
      id: "grouped",
      groupByAttributeKeys: ["host.name"],
    });
    const ungroupedQuery: MetricQueryConfigData = buildQueryConfig({
      id: "ungrouped",
    });

    const scoped: Array<MetricQueryConfigData> =
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs: [groupedQuery, ungroupedQuery],
        seriesLabels: { "host.name": "prod-01" },
      });

    expect(scoped[0]).not.toBe(groupedQuery);
    expect(scoped[1]).toBe(ungroupedQuery);
  });

  test("preserves everything else on the query config", () => {
    const original: MetricQueryConfigData = buildQueryConfig({
      id: "keep-me",
      groupByAttributeKeys: ["host.name"],
      topN: 25,
    });
    original.chartType = undefined;
    original.color = "#6366f1";
    original.transformAsRate = true;
    original.getSeries = () => {
      return { title: "custom" };
    };

    const scoped: Array<MetricQueryConfigData> =
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs: [original],
        seriesLabels: { "host.name": "prod-01" },
      });

    const result: MetricQueryConfigData | undefined = scoped[0];

    expect(result?.id).toBe("keep-me");
    expect(result?.color).toBe("#6366f1");
    expect(result?.transformAsRate).toBe(true);
    expect(result?.getSeries).toBe(original.getSeries);
    expect(result?.metricAliasData?.metricVariable).toBe("a");
    expect(result?.metricQueryData.topN).toBe(25);
    expect(
      (result?.metricQueryData.filterData as Dictionary<unknown>)["metricName"],
    ).toBe("system.cpu.utilization");
    expect(
      (result?.metricQueryData.filterData as Dictionary<unknown>)[
        "aggegationType"
      ],
    ).toBe("Avg");
  });

  test("creates the attributes bag when the query had no filters", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({ groupByAttributeKeys: ["host.name"] }),
    ];

    expect(getAttributes(queryConfigs[0])).toBeUndefined();

    const scoped: Array<MetricQueryConfigData> =
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs,
        seriesLabels: { "host.name": "prod-01" },
      });

    expect(getAttributes(scoped[0])).toEqual({ "host.name": "prod-01" });
  });

  test("survives a query config whose filterData is missing entirely", () => {
    /*
     * Query configs arrive from stored JSON (monitor steps, telemetryQuery
     * on the incident) — a hand-edited or legacy shape must not throw and
     * blank the whole page.
     */
    const malformed: MetricQueryConfigData = {
      metricQueryData: {
        groupByAttributeKeys: ["host.name"],
      },
    } as unknown as MetricQueryConfigData;

    const scoped: Array<MetricQueryConfigData> =
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs: [malformed],
        seriesLabels: { "host.name": "prod-01" },
      });

    expect(getAttributes(scoped[0])).toEqual({ "host.name": "prod-01" });
  });

  test("scopes a multi-key series across a multi-key query", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({
        groupByAttributeKeys: ["resource.host.name", "disk.device"],
      }),
    ];

    const scoped: Array<MetricQueryConfigData> =
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs,
        seriesLabels: {
          "resource.host.name": "prod-01",
          "disk.device": "/dev/sda1",
        },
      });

    expect(getAttributes(scoped[0])).toEqual({
      "resource.host.name": "prod-01",
      "disk.device": "/dev/sda1",
    });
  });

  test("still narrows on the keys it can when one label is unusable", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({
        groupByAttributeKeys: ["host.name", "tags"],
      }),
    ];

    const scoped: Array<MetricQueryConfigData> =
      MetricSeriesScope.scopeQueryConfigsToSeries({
        queryConfigs,
        seriesLabels: {
          "host.name": "prod-01",
          tags: ["a", "b"],
        } as unknown as JSONObject,
      });

    expect(getAttributes(scoped[0])).toEqual({ "host.name": "prod-01" });
  });
});

describe("MetricSeriesScope.scopeMetricViewDataToSeries", () => {
  function buildMetricViewData(
    queryConfigs: Array<MetricQueryConfigData>,
  ): MetricViewData {
    return {
      startAndEndDate: null,
      rangeToken: "Past 1 Hour",
      queryConfigs: queryConfigs,
      formulaConfigs: [
        {
          metricAliasData: {
            metricVariable: "b",
            title: "",
            description: "",
            legend: "",
            legendUnit: "",
          },
          metricFormulaData: { metricFormula: "a * 2" },
        },
      ],
    } as unknown as MetricViewData;
  }

  test("passes null and undefined straight through", () => {
    expect(
      MetricSeriesScope.scopeMetricViewDataToSeries({
        metricViewData: null,
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toBeNull();
    expect(
      MetricSeriesScope.scopeMetricViewDataToSeries({
        metricViewData: undefined,
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toBeUndefined();
  });

  test("hands back the same object when nothing narrows", () => {
    const metricViewData: MetricViewData = buildMetricViewData([
      buildQueryConfig({ groupByAttributeKeys: ["host.name"] }),
    ]);

    expect(
      MetricSeriesScope.scopeMetricViewDataToSeries({
        metricViewData,
        seriesLabels: undefined,
      }),
    ).toBe(metricViewData);
    expect(
      MetricSeriesScope.scopeMetricViewDataToSeries({
        metricViewData,
        seriesLabels: { "k8s.pod.name": "checkout-abc" },
      }),
    ).toBe(metricViewData);
  });

  test("narrows the query configs and keeps the rest of the view", () => {
    const metricViewData: MetricViewData = buildMetricViewData([
      buildQueryConfig({ groupByAttributeKeys: ["host.name"] }),
    ]);

    const scoped: MetricViewData | null | undefined =
      MetricSeriesScope.scopeMetricViewDataToSeries({
        metricViewData,
        seriesLabels: { "host.name": "prod-01" },
      });

    expect(scoped).not.toBe(metricViewData);
    expect(getAttributes(scoped?.queryConfigs[0])).toEqual({
      "host.name": "prod-01",
    });
    expect(scoped?.rangeToken).toBe("Past 1 Hour");
    expect(scoped?.formulaConfigs).toBe(metricViewData.formulaConfigs);
    expect(scoped?.startAndEndDate).toBeNull();
  });

  test("never mutates the view data it was handed", () => {
    const metricViewData: MetricViewData = buildMetricViewData([
      buildQueryConfig({ groupByAttributeKeys: ["host.name"] }),
    ]);
    const snapshot: string = JSON.stringify(metricViewData);

    MetricSeriesScope.scopeMetricViewDataToSeries({
      metricViewData,
      seriesLabels: { "host.name": "prod-01" },
    });

    expect(JSON.stringify(metricViewData)).toBe(snapshot);
  });

  test("keeps identity — and the shape — when queryConfigs is missing", () => {
    /*
     * queryConfigs is non-optional on the type, but this arrives from
     * stored JSON. Rewriting a missing list into [] would both break the
     * identity contract on every load and change the shape the host reads.
     */
    const metricViewData: MetricViewData = {
      startAndEndDate: null,
      formulaConfigs: [],
    } as unknown as MetricViewData;

    const scoped: MetricViewData | null | undefined =
      MetricSeriesScope.scopeMetricViewDataToSeries({
        metricViewData,
        seriesLabels: { "host.name": "prod-01" },
      });

    expect(scoped).toBe(metricViewData);
    expect(scoped?.queryConfigs).toBeUndefined();
  });

  test("keeps identity when the query config list is empty", () => {
    const metricViewData: MetricViewData = buildMetricViewData([]);

    expect(
      MetricSeriesScope.scopeMetricViewDataToSeries({
        metricViewData,
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toBe(metricViewData);
  });
});

/*
 * The card subtitle ("scoped to the affected series (...)") is a claim
 * about the chart below it. It therefore has to describe the narrowing
 * that was APPLIED, never the raw labels — a summary that outruns the
 * filter would have the UI vouch for a chart still showing every series,
 * which is worse than the bug this class fixes. The final block below
 * pins that as an invariant rather than case by case.
 */
describe("MetricSeriesScope.getAppliedSeriesLabelSummary", () => {
  test("is empty when there is no series", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({ groupByAttributeKeys: ["host.name"] }),
    ];

    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs,
        seriesLabels: undefined,
      }),
    ).toBe("");
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs,
        seriesLabels: null,
      }),
    ).toBe("");
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs,
        seriesLabels: {},
      }),
    ).toBe("");
  });

  test("is empty when there are no query configs", () => {
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs: undefined,
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toBe("");
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs: [],
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toBe("");
  });

  test("renders the one label that was applied", () => {
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs: [
          buildQueryConfig({ groupByAttributeKeys: ["host.name"] }),
        ],
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toBe("host.name = prod-01");
  });

  test("joins several applied labels in group-by order", () => {
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs: [
          buildQueryConfig({
            groupByAttributeKeys: ["host.name", "disk.device"],
          }),
        ],
        seriesLabels: {
          "disk.device": "/dev/sda1",
          "host.name": "prod-01",
        },
      }),
    ).toBe("host.name = prod-01, disk.device = /dev/sda1");
  });

  test("unions across queries without repeating a shared key", () => {
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs: [
          buildQueryConfig({
            id: "a",
            groupByAttributeKeys: ["host.name"],
          }),
          buildQueryConfig({
            id: "b",
            groupByAttributeKeys: ["host.name", "k8s.pod.name"],
          }),
        ],
        seriesLabels: {
          "host.name": "prod-01",
          "k8s.pod.name": "checkout-abc",
        },
      }),
    ).toBe("host.name = prod-01, k8s.pod.name = checkout-abc");
  });

  test("renders an applied unset label as (unset), matching the chart legend", () => {
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs: [
          buildQueryConfig({ groupByAttributeKeys: ["host.name"] }),
        ],
        seriesLabels: { "host.name": "" },
      }),
    ).toBe("host.name = (unset)");
    expect(MetricSeriesScope.UnsetLabelDisplayValue).toBe("(unset)");
  });

  test("stringifies applied numeric and boolean labels", () => {
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs: [
          buildQueryConfig({
            groupByAttributeKeys: ["http.status_code", "is.canary"],
          }),
        ],
        seriesLabels: { "http.status_code": 500, "is.canary": false },
      }),
    ).toBe("http.status_code = 500, is.canary = false");
  });

  test("says nothing about labels the queries never grouped by", () => {
    /*
     * Incoming-request monitors write seriesLabels keyed by a payload
     * field name. Those narrow nothing, so the card must not claim they
     * did.
     */
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs: [
          buildQueryConfig({ groupByAttributeKeys: ["host.name"] }),
        ],
        seriesLabels: { alertname: "HighCPU" },
      }),
    ).toBe("");
  });

  test("says nothing about labels whose value cannot be filtered on", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({
        groupByAttributeKeys: ["tags", "meta", "host.name"],
      }),
    ];

    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs,
        seriesLabels: {
          tags: ["a", "b"],
          meta: { nested: true },
          "host.name": "   ",
        } as unknown as JSONObject,
      }),
    ).toBe("");
  });

  test("reports only the part it could apply on a mixed series", () => {
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs: [
          buildQueryConfig({
            groupByAttributeKeys: ["host.name", "tags"],
          }),
        ],
        seriesLabels: {
          "host.name": "prod-01",
          tags: ["a", "b"],
        } as unknown as JSONObject,
      }),
    ).toBe("host.name = prod-01");
  });

  test("says nothing about an ungrouped query", () => {
    expect(
      MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs: [buildQueryConfig({})],
        seriesLabels: { "host.name": "prod-01" },
      }),
    ).toBe("");
  });
});

/*
 * The invariant the card subtitle rests on, stated once and checked
 * across a matrix of realistic inputs: the summary is non-empty EXACTLY
 * when the query configs were actually narrowed. Any future value rule
 * added to one side and not the other fails here.
 */
describe("MetricSeriesScope — the summary never outruns the narrowing", () => {
  interface ScopeCase {
    name: string;
    groupByAttributeKeys: Array<string>;
    seriesLabels: JSONObject | undefined;
  }

  const cases: Array<ScopeCase> = [
    {
      name: "no labels at all",
      groupByAttributeKeys: ["host.name"],
      seriesLabels: undefined,
    },
    {
      name: "plain matching label",
      groupByAttributeKeys: ["host.name"],
      seriesLabels: { "host.name": "prod-01" },
    },
    {
      name: "unset label",
      groupByAttributeKeys: ["host.name"],
      seriesLabels: { "host.name": "" },
    },
    {
      name: "whitespace-only label",
      groupByAttributeKeys: ["host.name"],
      seriesLabels: { "host.name": "   " },
    },
    {
      name: "array label",
      groupByAttributeKeys: ["tags"],
      seriesLabels: { tags: ["a", "b"] } as unknown as JSONObject,
    },
    {
      name: "object label",
      groupByAttributeKeys: ["meta"],
      seriesLabels: { meta: { a: 1 } } as unknown as JSONObject,
    },
    {
      name: "empty array label",
      groupByAttributeKeys: ["tags"],
      seriesLabels: { tags: [] } as unknown as JSONObject,
    },
    {
      name: "non-finite numeric label",
      groupByAttributeKeys: ["weird"],
      seriesLabels: { weird: Number.NaN },
    },
    {
      name: "zero label",
      groupByAttributeKeys: ["pool_id"],
      seriesLabels: { pool_id: 0 },
    },
    {
      name: "label for a dimension the query never grouped by",
      groupByAttributeKeys: ["host.name"],
      seriesLabels: { alertname: "HighCPU" },
    },
    {
      name: "ungrouped query",
      groupByAttributeKeys: [],
      seriesLabels: { "host.name": "prod-01" },
    },
    {
      name: "one usable label among unusable ones",
      groupByAttributeKeys: ["host.name", "tags"],
      seriesLabels: {
        "host.name": "prod-01",
        tags: ["a", "b"],
      } as unknown as JSONObject,
    },
  ];

  for (const scopeCase of cases) {
    test(`summary and narrowing agree — ${scopeCase.name}`, () => {
      const queryConfigs: Array<MetricQueryConfigData> = [
        buildQueryConfig({
          groupByAttributeKeys: scopeCase.groupByAttributeKeys,
        }),
      ];

      const scoped: Array<MetricQueryConfigData> =
        MetricSeriesScope.scopeQueryConfigsToSeries({
          queryConfigs,
          seriesLabels: scopeCase.seriesLabels,
        });

      const didNarrow: boolean = scoped !== queryConfigs;

      const summary: string = MetricSeriesScope.getAppliedSeriesLabelSummary({
        queryConfigs,
        seriesLabels: scopeCase.seriesLabels,
      });

      expect(summary !== "").toBe(didNarrow);
    });
  }
});

/*
 * The narrowed filters only reach ClickHouse if they survive the chart's
 * own filter sanitizer, which classifies each value through
 * detectOperatorFromValue/getOperatorOption. These pin that contract from
 * this side: a plain string must read as "equals" with a non-blank value,
 * and IsNull must read as "is empty" — the one operator the sanitizer
 * keeps despite having no value text.
 */
describe("MetricSeriesScope — the filters it emits survive the chart's sanitizer", () => {
  test("a string label reads as an equals filter with a non-blank value", () => {
    const filters: Dictionary<MetricSeriesFilterValue> =
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig: buildQueryConfig({
          groupByAttributeKeys: ["host.name"],
        }),
        seriesLabels: { "host.name": "prod-01" },
      });

    const detected: { operator: DictionaryFilterOperator; rawValue: string } =
      detectOperatorFromValue(filters["host.name"]);

    expect(detected.operator).toBe(DictionaryFilterOperator.EqualTo);
    expect(detected.rawValue.trim()).not.toBe("");
  });

  test("an unset label reads as is-empty, which needs no value text", () => {
    const filters: Dictionary<MetricSeriesFilterValue> =
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig: buildQueryConfig({
          groupByAttributeKeys: ["host.name"],
        }),
        seriesLabels: { "host.name": "" },
      });

    const detected: { operator: DictionaryFilterOperator; rawValue: string } =
      detectOperatorFromValue(filters["host.name"]);
    const option: DictionaryFilterOperatorOption = getOperatorOption(
      detected.operator,
    );

    expect(detected.operator).toBe(DictionaryFilterOperator.IsEmpty);
    /*
     * hidesValueInput is precisely what stops the sanitizer from dropping
     * an operator whose rawValue is blank. Without it this filter would be
     * silently discarded and the chart would show every series again.
     */
    expect(option.hidesValueInput).toBe(true);
  });

  test("the emitted IsNull serializes to the shape the API rehydrates", () => {
    const filters: Dictionary<MetricSeriesFilterValue> =
      MetricSeriesScope.getSeriesFilterAttributesForQuery({
        queryConfig: buildQueryConfig({
          groupByAttributeKeys: ["host.name"],
        }),
        seriesLabels: { "host.name": "" },
      });

    expect(JSON.parse(JSON.stringify(filters))).toEqual({
      "host.name": { _type: "IsNull", value: null },
    });
  });
});
