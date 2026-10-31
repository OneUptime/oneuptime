import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import MetricQueryConfigData, {
  MetricChartType,
} from "../../../Types/Metrics/MetricQueryConfigData";
import { MetricQueryFallbackHint } from "../../../Types/Metrics/MetricQueryFallback";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricQueryFallbackUtil, {
  ChartedMetricQueries,
} from "../../../Utils/Metrics/MetricQueryFallback";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * A chart query may carry a fallback: another query drawn in its place when
 * it has no data in the window (Types/Metrics/MetricQueryFallback). The
 * Kubernetes dashboard's restarts chart reads the restarts per interval that
 * newer agents send and falls back to the running count every agent sends.
 *
 * MetricQueryFallbackUtil decides which query each slot draws:
 *
 *   - main has data                  -> the main query, as fetched;
 *   - main empty, fallback has data  -> the fallback, with its hint;
 *   - both empty                     -> the main query, empty;
 *
 * and a chart without fallbacks gets back exactly what it passed in, the
 * same arrays, with no second request. The sweep at the end draws thousands
 * of charts from seededRandom and holds every one of them to those rules.
 */

const MAIN_METRIC: string = "k8s.container.restarts.increase";
const FALLBACK_METRIC: string = "k8s.container.restarts";

const HINT: MetricQueryFallbackHint = {
  text: "Older Kubernetes agents send only the running restart count.",
  linkText: "Upgrade the agent",
  linkUrl: "/docs/monitor/kubernetes-agent#upgrading",
};

function row(value: unknown, minute: number = 0): AggregatedModel {
  return {
    timestamp: new Date(Date.UTC(2026, 9, 31, 9, minute)),
    value: value as number,
  };
}

function result(...values: Array<unknown>): AggregatedResult {
  return {
    data: values.map((value: unknown, index: number): AggregatedModel => {
      return row(value, index);
    }),
  };
}

const EMPTY: AggregatedResult = { data: [] };

function query(data: {
  metricName: string;
  variable?: string | undefined;
  legend?: string | undefined;
  aggregation?: MetricsAggregationType | undefined;
  fallback?: MetricQueryConfigData | undefined;
  hint?: MetricQueryFallbackHint | undefined;
  chartType?: MetricChartType | undefined;
  overlayWithPreviousQuery?: boolean | undefined;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: data.variable,
      title: undefined,
      description: undefined,
      legend: data.legend,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName,
        aggegationType: data.aggregation ?? MetricsAggregationType.Sum,
      },
    },
    ...(data.chartType ? { chartType: data.chartType } : {}),
    ...(data.overlayWithPreviousQuery !== undefined
      ? { overlayWithPreviousQuery: data.overlayWithPreviousQuery }
      : {}),
    ...(data.fallback
      ? {
          fallback: {
            queryConfig: data.fallback,
            ...(data.hint ? { hint: data.hint } : {}),
          },
        }
      : {}),
  } as MetricQueryConfigData;
}

function restartsQuery(variable: string = "a"): MetricQueryConfigData {
  return query({
    metricName: MAIN_METRIC,
    variable: variable,
    legend: "Restarts per interval",
    fallback: query({
      metricName: FALLBACK_METRIC,
      aggregation: MetricsAggregationType.Max,
      legend: "Restart count (older agent)",
    }),
    hint: HINT,
  });
}

function metricNameOf(config: MetricQueryConfigData | undefined): string {
  return String(config?.metricQueryData.filterData.metricName ?? "");
}

describe("MetricQueryFallbackUtil.hasData", () => {
  test("a result without rows, or without a result, has no data", () => {
    expect(MetricQueryFallbackUtil.hasData(undefined)).toBe(false);
    expect(MetricQueryFallbackUtil.hasData(null)).toBe(false);
    expect(MetricQueryFallbackUtil.hasData(EMPTY)).toBe(false);
    expect(
      MetricQueryFallbackUtil.hasData({
        data: undefined,
      } as unknown as AggregatedResult),
    ).toBe(false);
  });

  test("a failed formula has no data, whatever its message", () => {
    expect(
      MetricQueryFallbackUtil.hasData({
        data: [],
        errorMessage: "Unknown variable c.",
      }),
    ).toBe(false);
  });

  test("zero is data: a quiet cluster restarts nothing, and says so", () => {
    expect(MetricQueryFallbackUtil.hasData(result(0))).toBe(true);
    expect(MetricQueryFallbackUtil.hasData(result(0, 0, 0))).toBe(true);
  });

  test("a point that cannot be drawn is not data", () => {
    expect(
      MetricQueryFallbackUtil.hasData(
        result(Number.NaN, Infinity, -Infinity, null, undefined, "", "  "),
      ),
    ).toBe(false);
    expect(MetricQueryFallbackUtil.hasData(result("three"))).toBe(false);
    expect(MetricQueryFallbackUtil.hasData(result({ value: 1 }))).toBe(false);
  });

  test("one drawable point among undrawable ones is data", () => {
    expect(MetricQueryFallbackUtil.hasData(result(Number.NaN, null, 2))).toBe(
      true,
    );
    expect(MetricQueryFallbackUtil.hasData(result("3"))).toBe(true);
    expect(MetricQueryFallbackUtil.hasData(result(-1.5))).toBe(true);
  });
});

describe("MetricQueryFallbackUtil.getFallbackQueryConfig", () => {
  test("a query without a fallback has none", () => {
    expect(
      MetricQueryFallbackUtil.getFallbackQueryConfig(
        query({ metricName: MAIN_METRIC, variable: "a" }),
      ),
    ).toBeUndefined();
    expect(
      MetricQueryFallbackUtil.getFallbackQueryConfig(undefined),
    ).toBeUndefined();
  });

  test("a fallback without a metric is no fallback", () => {
    const config: MetricQueryConfigData = query({
      metricName: MAIN_METRIC,
      variable: "a",
      fallback: query({ metricName: "" }),
    });

    expect(
      MetricQueryFallbackUtil.getFallbackQueryConfig(config),
    ).toBeUndefined();
    expect(
      MetricQueryFallbackUtil.getFallbackQueryConfig({
        ...config,
        fallback: {} as MetricQueryConfigData["fallback"],
      }),
    ).toBeUndefined();
  });

  test("is the fallback's own query, in the main query's variable", () => {
    const fallbackQuery: MetricQueryConfigData | undefined =
      MetricQueryFallbackUtil.getFallbackQueryConfig(restartsQuery("b"));

    expect(metricNameOf(fallbackQuery)).toBe(FALLBACK_METRIC);
    expect(fallbackQuery?.metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.Max,
    );
    expect(fallbackQuery?.metricAliasData).toEqual({
      metricVariable: "b",
      title: undefined,
      description: undefined,
      legend: "Restart count (older agent)",
      legendUnit: undefined,
    });
  });

  test("keeps the fallback's own variable when the main query has none", () => {
    const config: MetricQueryConfigData = query({
      metricName: MAIN_METRIC,
      fallback: query({ metricName: FALLBACK_METRIC, variable: "z" }),
    });

    expect(
      MetricQueryFallbackUtil.getFallbackQueryConfig(config)?.metricAliasData
        ?.metricVariable,
    ).toBe("z");
  });

  test("is drawn where and as the main query is, unless it says otherwise", () => {
    const inherits: MetricQueryConfigData = query({
      metricName: MAIN_METRIC,
      variable: "b",
      chartType: MetricChartType.BAR,
      overlayWithPreviousQuery: true,
      fallback: query({ metricName: FALLBACK_METRIC }),
    });

    expect(
      MetricQueryFallbackUtil.getFallbackQueryConfig(inherits)?.chartType,
    ).toBe(MetricChartType.BAR);
    expect(
      MetricQueryFallbackUtil.getFallbackQueryConfig(inherits)
        ?.overlayWithPreviousQuery,
    ).toBe(true);

    const own: MetricQueryConfigData = query({
      metricName: MAIN_METRIC,
      variable: "b",
      chartType: MetricChartType.BAR,
      overlayWithPreviousQuery: true,
      fallback: query({
        metricName: FALLBACK_METRIC,
        chartType: MetricChartType.LINE,
        overlayWithPreviousQuery: false,
      }),
    });

    expect(MetricQueryFallbackUtil.getFallbackQueryConfig(own)?.chartType).toBe(
      MetricChartType.LINE,
    );
    expect(
      MetricQueryFallbackUtil.getFallbackQueryConfig(own)
        ?.overlayWithPreviousQuery,
    ).toBe(false);
  });

  test("fallbacks do not chain", () => {
    const config: MetricQueryConfigData = query({
      metricName: MAIN_METRIC,
      variable: "a",
      fallback: query({
        metricName: FALLBACK_METRIC,
        fallback: query({ metricName: "something.else" }),
      }),
    });

    const fallbackQuery: MetricQueryConfigData | undefined =
      MetricQueryFallbackUtil.getFallbackQueryConfig(config);

    expect(metricNameOf(fallbackQuery)).toBe(FALLBACK_METRIC);
    expect(fallbackQuery).not.toHaveProperty("fallback");
    expect(
      MetricQueryFallbackUtil.getFallbackQueryConfig(fallbackQuery),
    ).toBeUndefined();
  });

  test("leaves the stored query as it was", () => {
    const config: MetricQueryConfigData = restartsQuery();
    const before: string = JSON.stringify(config);

    MetricQueryFallbackUtil.getFallbackQueryConfig(config);

    expect(JSON.stringify(config)).toBe(before);
  });
});

describe("MetricQueryFallbackUtil.getFallbackCandidates and withFallbacks", () => {
  const plain: MetricQueryConfigData = query({
    metricName: "k8s.pod.cpu.usage",
    variable: "b",
  });

  test("a slot falls back only when it has a fallback and no data", () => {
    const queries: Array<MetricQueryConfigData> = [
      restartsQuery("a"),
      plain,
      restartsQuery("c"),
    ];

    expect(
      MetricQueryFallbackUtil.getFallbackCandidates(queries, [
        EMPTY,
        EMPTY,
        result(1),
      ]),
    ).toEqual([0]);
    expect(
      MetricQueryFallbackUtil.getFallbackCandidates(queries, [
        result(0),
        EMPTY,
        EMPTY,
      ]),
    ).toEqual([2]);
    // A slot no result came back for is a slot without data.
    expect(MetricQueryFallbackUtil.getFallbackCandidates(queries, [])).toEqual([
      0, 2,
    ]);
  });

  test("hands back the very same array when no slot changes", () => {
    const queries: Array<MetricQueryConfigData> = [restartsQuery(), plain];

    expect(MetricQueryFallbackUtil.withFallbacks(queries, [])).toBe(queries);
    // Slot 1 has no fallback to draw, slot 5 does not exist.
    expect(MetricQueryFallbackUtil.withFallbacks(queries, [1, 5])).toBe(
      queries,
    );
  });

  test("replaces exactly the slots it is given", () => {
    const queries: Array<MetricQueryConfigData> = [
      restartsQuery("a"),
      plain,
      restartsQuery("c"),
    ];

    const charted: Array<MetricQueryConfigData> =
      MetricQueryFallbackUtil.withFallbacks(queries, [2]);

    expect(charted).not.toBe(queries);
    expect(charted[0]).toBe(queries[0]);
    expect(charted[1]).toBe(plain);
    expect(metricNameOf(charted[2])).toBe(FALLBACK_METRIC);
    expect(charted[2]?.metricAliasData?.metricVariable).toBe("c");
  });

  test("asks again only when some slot falls back", () => {
    const queries: Array<MetricQueryConfigData> = [restartsQuery(), plain];

    expect(
      MetricQueryFallbackUtil.getFallbackQueryConfigs(queries, [
        result(2),
        EMPTY,
      ]),
    ).toBeNull();
    expect(
      MetricQueryFallbackUtil.getFallbackQueryConfigs([plain], [EMPTY]),
    ).toBeNull();

    const again: Array<MetricQueryConfigData> | null =
      MetricQueryFallbackUtil.getFallbackQueryConfigs(queries, [EMPTY, EMPTY]);

    expect(again?.map(metricNameOf)).toEqual([
      FALLBACK_METRIC,
      "k8s.pod.cpu.usage",
    ]);
    expect(again?.[1]).toBe(plain);
  });
});

describe("MetricQueryFallbackUtil.resolve", () => {
  test("main has data: the main query, as fetched", () => {
    const queries: Array<MetricQueryConfigData> = [restartsQuery()];
    const results: Array<AggregatedResult> = [result(0, 2, 0)];

    const charted: ChartedMetricQueries = MetricQueryFallbackUtil.resolve({
      queryConfigs: queries,
      results: results,
      fallbackResults: [result(7, 7, 9)],
    });

    expect(charted.queryConfigs).toBe(queries);
    expect(charted.results).toBe(results);
    expect(charted.fallbackIndexes).toEqual([]);
  });

  test("main is empty: the fallback, its results and its slot", () => {
    const queries: Array<MetricQueryConfigData> = [restartsQuery()];
    const results: Array<AggregatedResult> = [EMPTY];
    const fallbackResults: Array<AggregatedResult> = [result(7, 7, 9)];

    const charted: ChartedMetricQueries = MetricQueryFallbackUtil.resolve({
      queryConfigs: queries,
      results: results,
      fallbackResults: fallbackResults,
    });

    expect(charted.queryConfigs.map(metricNameOf)).toEqual([FALLBACK_METRIC]);
    expect(charted.queryConfigs[0]?.metricAliasData?.legend).toBe(
      "Restart count (older agent)",
    );
    expect(charted.results).toBe(fallbackResults);
    expect(charted.fallbackIndexes).toEqual([0]);
  });

  test("both empty: the main query's own empty chart", () => {
    const queries: Array<MetricQueryConfigData> = [restartsQuery()];
    const results: Array<AggregatedResult> = [EMPTY];

    const charted: ChartedMetricQueries = MetricQueryFallbackUtil.resolve({
      queryConfigs: queries,
      results: results,
      fallbackResults: [EMPTY],
    });

    expect(charted.queryConfigs).toBe(queries);
    expect(charted.results).toBe(results);
    expect(charted.fallbackIndexes).toEqual([]);
  });

  test("without the second fetch (none made, or it failed) nothing falls back", () => {
    const queries: Array<MetricQueryConfigData> = [restartsQuery()];
    const results: Array<AggregatedResult> = [EMPTY];

    const charted: ChartedMetricQueries = MetricQueryFallbackUtil.resolve({
      queryConfigs: queries,
      results: results,
    });

    expect(charted.queryConfigs).toBe(queries);
    expect(charted.results).toBe(results);
    expect(charted.fallbackIndexes).toEqual([]);
  });

  test("each slot is decided on its own", () => {
    const queries: Array<MetricQueryConfigData> = [
      restartsQuery("a"),
      restartsQuery("b"),
      query({ metricName: "k8s.pod.cpu.usage", variable: "c" }),
    ];
    // Formulas come after the queries: their results travel with them.
    const fallbackResults: Array<AggregatedResult> = [
      result(4),
      EMPTY,
      result(0.5),
      result(8),
    ];

    const charted: ChartedMetricQueries = MetricQueryFallbackUtil.resolve({
      queryConfigs: queries,
      results: [EMPTY, EMPTY, result(0.5), result()],
      fallbackResults: fallbackResults,
    });

    expect(charted.fallbackIndexes).toEqual([0]);
    expect(charted.queryConfigs.map(metricNameOf)).toEqual([
      FALLBACK_METRIC,
      MAIN_METRIC,
      "k8s.pod.cpu.usage",
    ]);
    expect(charted.queryConfigs[1]).toBe(queries[1]);
    expect(charted.queryConfigs[2]).toBe(queries[2]);
    expect(charted.results).toBe(fallbackResults);
  });
});

describe("MetricQueryFallbackUtil.getHints", () => {
  test("names the hints of the slots drawn from their fallback, each once, in slot order", () => {
    const otherHint: MetricQueryFallbackHint = {
      text: "Older Docker agents send only the running restart count.",
    };
    const queries: Array<MetricQueryConfigData> = [
      restartsQuery("a"),
      query({
        metricName: "container.restarts.increase",
        variable: "b",
        fallback: query({ metricName: "container.restarts" }),
        hint: otherHint,
      }),
      restartsQuery("c"),
    ];

    expect(MetricQueryFallbackUtil.getHints(queries, [])).toEqual([]);
    expect(MetricQueryFallbackUtil.getHints(queries, [2, 1, 0])).toEqual([
      HINT,
      otherHint,
    ]);
    expect(MetricQueryFallbackUtil.getHints(queries, [1])).toEqual([otherHint]);
  });

  test("a fallback without a hint, or with an empty one, says nothing", () => {
    const queries: Array<MetricQueryConfigData> = [
      query({
        metricName: MAIN_METRIC,
        fallback: query({ metricName: FALLBACK_METRIC }),
      }),
      query({
        metricName: MAIN_METRIC,
        fallback: query({ metricName: FALLBACK_METRIC }),
        hint: { text: "   " },
      }),
    ];

    expect(MetricQueryFallbackUtil.getHints(queries, [0, 1])).toEqual([]);
  });
});

describe("MetricQueryFallbackUtil.getSafeLinkUrl", () => {
  test.each([
    "/docs/monitor/kubernetes-agent#upgrading",
    "/docs/telemetry/docker-host#upgrading-the-agent",
    "https://github.com/OneUptime/oneuptime/releases",
    "http://intranet.example.com/runbooks/restarts",
    "HTTPS://example.com/a",
  ])("draws %s", (url: string) => {
    expect(MetricQueryFallbackUtil.getSafeLinkUrl(url)).toBe(url);
  });

  test.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(document.cookie)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "mailto:ops@example.com",
    "//evil.example.com/docs",
    "/\\evil.example.com",
    " /docs/monitor/kubernetes-agent",
    "/docs/monitor kubernetes-agent",
    "/do\tcs",
    "/docs\n",
    "java\u0000script:alert(1)",
    "https://",
    "docs/monitor/kubernetes-agent",
    "",
  ])("refuses %j", (url: string) => {
    expect(MetricQueryFallbackUtil.getSafeLinkUrl(url)).toBeUndefined();
  });

  test("refuses no address at all, and one far longer than any docs path", () => {
    expect(MetricQueryFallbackUtil.getSafeLinkUrl(undefined)).toBeUndefined();
    expect(MetricQueryFallbackUtil.getSafeLinkUrl(null)).toBeUndefined();
    expect(
      MetricQueryFallbackUtil.getSafeLinkUrl(`/docs/${"a".repeat(5000)}`),
    ).toBeUndefined();
  });
});

describe("MetricQueryFallbackUtil.isSameFallbackIndexes", () => {
  test("compares slot by slot", () => {
    expect(MetricQueryFallbackUtil.isSameFallbackIndexes([], [])).toBe(true);
    expect(MetricQueryFallbackUtil.isSameFallbackIndexes([0, 2], [0, 2])).toBe(
      true,
    );
    expect(MetricQueryFallbackUtil.isSameFallbackIndexes([0], [])).toBe(false);
    expect(MetricQueryFallbackUtil.isSameFallbackIndexes([0, 2], [2, 0])).toBe(
      false,
    );
  });
});

/*
 * Seeded sweep: charts of one to four queries, some with a fallback (a few
 * of them without a metric, which is no fallback), each query's result and
 * its fallback's drawn from rows that are empty, undrawable (NaN, null,
 * "") or drawable (zero, numbers, numeric strings). Every chart is held to
 * the rules above, read from the inputs rather than from the helper.
 */
describe("MetricQueryFallbackUtil seeded sweep", () => {
  const SEED: number = 20261031;
  const CHARTS: number = 4000;

  const UNDRAWABLE: Array<unknown> = [Number.NaN, null, undefined, "", "n/a"];
  const DRAWABLE: Array<unknown> = [0, 1, 3, 0.25, -2, "4", "0"];

  function drawResult(random: SeededRandom): AggregatedResult {
    const shape: number = random(4);

    if (shape === 0) {
      return EMPTY;
    }

    const values: Array<unknown> = [];
    const length: number = 1 + random(5);

    for (let index: number = 0; index < length; index++) {
      values.push(UNDRAWABLE[random(UNDRAWABLE.length)]);
    }

    // Shape 1 keeps only undrawable points: rows, but no data.
    if (shape >= 2) {
      values.splice(
        random(values.length + 1),
        0,
        DRAWABLE[random(DRAWABLE.length)],
      );
    }

    return result(...values);
  }

  function isDrawable(value: unknown): boolean {
    if (typeof value === "number") {
      return Number.isFinite(value);
    }

    return (
      typeof value === "string" &&
      value.trim().length > 0 &&
      Number.isFinite(Number(value))
    );
  }

  function hasDrawablePoint(
    chartResult: AggregatedResult | undefined,
  ): boolean {
    return Boolean(
      chartResult?.data.some((point: AggregatedModel): boolean => {
        return isDrawable(point.value);
      }),
    );
  }

  test(`${CHARTS} charts follow the rules`, () => {
    const random: SeededRandom = seededRandom(SEED);
    let fellBack: number = 0;
    let keptMainWithData: number = 0;
    let keptMainBothEmpty: number = 0;
    let withoutAnyFallback: number = 0;

    for (let chart: number = 0; chart < CHARTS; chart++) {
      const queryCount: number = 1 + random(4);
      const queries: Array<MetricQueryConfigData> = [];
      const usable: Array<boolean> = [];

      for (let slot: number = 0; slot < queryCount; slot++) {
        const variable: string = String.fromCharCode(97 + slot);
        const kind: number = random(5);

        if (kind <= 1) {
          queries.push(
            query({ metricName: `plain.metric.${slot}`, variable: variable }),
          );
          usable.push(false);
        } else if (kind === 2) {
          // A fallback with no metric: no fallback.
          queries.push(
            query({
              metricName: `main.metric.${slot}`,
              variable: variable,
              fallback: query({ metricName: "" }),
              hint: HINT,
            }),
          );
          usable.push(false);
        } else {
          queries.push(
            query({
              metricName: `main.metric.${slot}`,
              variable: variable,
              legend: `Main ${slot}`,
              fallback: query({
                metricName: `fallback.metric.${slot}`,
                legend: `Fallback ${slot}`,
              }),
              hint: kind === 3 ? HINT : undefined,
            }),
          );
          usable.push(true);
        }
      }

      const formulaCount: number = random(2);
      const results: Array<AggregatedResult> = [];
      const fallbackResults: Array<AggregatedResult> = [];

      for (let slot: number = 0; slot < queryCount + formulaCount; slot++) {
        results.push(drawResult(random));
        fallbackResults.push(drawResult(random));
      }

      const before: string = JSON.stringify(queries);

      const again: Array<MetricQueryConfigData> | null =
        MetricQueryFallbackUtil.getFallbackQueryConfigs(queries, results);

      const candidates: Array<number> = [];
      for (let slot: number = 0; slot < queryCount; slot++) {
        if (usable[slot] && !hasDrawablePoint(results[slot])) {
          candidates.push(slot);
        }
      }

      // A second request only when some slot has a fallback and no data.
      expect(again === null).toBe(candidates.length === 0);

      if (again) {
        for (let slot: number = 0; slot < queryCount; slot++) {
          if (candidates.includes(slot)) {
            expect(metricNameOf(again[slot])).toBe(`fallback.metric.${slot}`);
          } else {
            expect(again[slot]).toBe(queries[slot]);
          }
        }
      }

      const charted: ChartedMetricQueries = MetricQueryFallbackUtil.resolve({
        queryConfigs: queries,
        results: results,
        fallbackResults: again ? fallbackResults : undefined,
      });

      const expectedFallbackIndexes: Array<number> = candidates.filter(
        (slot: number): boolean => {
          return hasDrawablePoint(fallbackResults[slot]);
        },
      );

      expect(charted.fallbackIndexes).toEqual(expectedFallbackIndexes);

      if (expectedFallbackIndexes.length === 0) {
        expect(charted.queryConfigs).toBe(queries);
        expect(charted.results).toBe(results);
      } else {
        expect(charted.results).toBe(fallbackResults);
      }

      for (let slot: number = 0; slot < queryCount; slot++) {
        const drawn: MetricQueryConfigData | undefined =
          charted.queryConfigs[slot];

        if (expectedFallbackIndexes.includes(slot)) {
          fellBack++;
          expect(metricNameOf(drawn)).toBe(`fallback.metric.${slot}`);
          expect(drawn?.metricAliasData?.legend).toBe(`Fallback ${slot}`);
          // In the main query's variable, and no fallback of its own.
          expect(drawn?.metricAliasData?.metricVariable).toBe(
            queries[slot]?.metricAliasData?.metricVariable,
          );
          expect(drawn).not.toHaveProperty("fallback");
        } else {
          expect(drawn).toBe(queries[slot]);

          if (usable[slot] && hasDrawablePoint(results[slot])) {
            keptMainWithData++;
          } else if (usable[slot]) {
            keptMainBothEmpty++;
          }
        }
      }

      // A hint is said only for a slot drawn from its fallback.
      const hints: Array<MetricQueryFallbackHint> =
        MetricQueryFallbackUtil.getHints(queries, charted.fallbackIndexes);
      const anyHintedFallback: boolean = expectedFallbackIndexes.some(
        (slot: number): boolean => {
          return Boolean(queries[slot]?.fallback?.hint);
        },
      );

      expect(hints).toEqual(anyHintedFallback ? [HINT] : []);

      if (!usable.includes(true)) {
        withoutAnyFallback++;
      }

      // Nothing the chart stores is changed.
      expect(JSON.stringify(queries)).toBe(before);
    }

    // The sweep reached every case it is about.
    expect(fellBack).toBeGreaterThan(100);
    expect(keptMainWithData).toBeGreaterThan(100);
    expect(keptMainBothEmpty).toBeGreaterThan(100);
    expect(withoutAnyFallback).toBeGreaterThan(100);
  });
});
