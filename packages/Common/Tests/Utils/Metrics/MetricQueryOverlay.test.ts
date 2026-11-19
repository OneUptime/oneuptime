import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardChartComponent";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricQueryOverlay, {
  OverlayAxis,
  OverlayAxisReading,
  OverlayChartAxes,
  OverlayChartQueryUnit,
  OverlayUnitFit,
  OverlayUnitReading,
} from "../../../Utils/Metrics/MetricQueryOverlay";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #9961: a query after the first can be drawn on the chart of the
 * query before it ("Overlay with previous query"). MetricQueryOverlay says
 * which chart a query joins, how many charts a view draws, and how an
 * overlaid query's unit reads on the axis of the chart it joins:
 *
 *   - the same unit, no unit, or two counts: as it is;
 *   - another unit of the same kind: converted into the chart's unit;
 *   - a unit of another kind: drawn, and said to differ.
 */

function query(
  metricName: string,
  options: { overlay?: boolean; legendUnit?: string; variable?: string } = {},
): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: options.variable,
      title: undefined,
      description: undefined,
      legend: undefined,
      legendUnit: options.legendUnit,
    },
    metricQueryData: {
      filterData: {
        metricName: metricName,
        aggegationType: MetricsAggregationType.Avg,
      },
    },
    ...(options.overlay ? { overlayWithPreviousQuery: true } : {}),
  } as MetricQueryConfigData;
}

function read(
  chartUnit: string,
  queryUnit: string,
  names: { chart?: string; query?: string } = {},
): OverlayUnitReading {
  return MetricQueryOverlay.readUnit({
    chartUnit,
    chartMetricName: names.chart,
    queryUnit,
    queryMetricName: names.query,
  });
}

describe("isOverlaid: a query after the first that asks to be", () => {
  test("the first query is never overlaid, whatever it says", () => {
    expect(
      MetricQueryOverlay.isOverlaid(query("a", { overlay: true }), 0),
    ).toBe(false);
  });

  test("a later query is overlaid only when its switch is on", () => {
    expect(
      MetricQueryOverlay.isOverlaid(query("b", { overlay: true }), 1),
    ).toBe(true);
    expect(MetricQueryOverlay.isOverlaid(query("b"), 1)).toBe(false);
  });

  test("only true turns it on: a saved value of another type does not", () => {
    for (const saved of ["true", 1, "yes", {}, null]) {
      const config: MetricQueryConfigData = {
        ...query("b"),
        overlayWithPreviousQuery: saved as unknown as boolean,
      };

      expect({
        saved,
        overlaid: MetricQueryOverlay.isOverlaid(config, 1),
      }).toEqual({ saved, overlaid: false });
    }
  });

  test("no query at all is not overlaid", () => {
    expect(MetricQueryOverlay.isOverlaid(undefined, 3)).toBe(false);
  });
});

describe("getChartLeadIndex: the chart a query joins when it overlays", () => {
  test("the first query joins nothing", () => {
    expect(MetricQueryOverlay.getChartLeadIndex([query("a")], 0)).toBeNull();
  });

  test("the second query joins the first query's chart", () => {
    const queries: Array<MetricQueryConfigData> = [query("a"), query("b")];

    expect(MetricQueryOverlay.getChartLeadIndex(queries, 1)).toBe(0);
  });

  test("a chain of overlays all join the first query's chart", () => {
    const queries: Array<MetricQueryConfigData> = [
      query("a"),
      query("b", { overlay: true }),
      query("c", { overlay: true }),
      query("d", { overlay: true }),
    ];

    expect(MetricQueryOverlay.getChartLeadIndex(queries, 1)).toBe(0);
    expect(MetricQueryOverlay.getChartLeadIndex(queries, 2)).toBe(0);
    expect(MetricQueryOverlay.getChartLeadIndex(queries, 3)).toBe(0);
  });

  test("a query that does not overlay starts a chart the next ones can join", () => {
    const queries: Array<MetricQueryConfigData> = [
      query("a"),
      query("b", { overlay: true }),
      query("c"),
      query("d", { overlay: true }),
      query("e", { overlay: true }),
    ];

    expect(MetricQueryOverlay.getChartLeadIndex(queries, 2)).toBe(0);
    expect(MetricQueryOverlay.getChartLeadIndex(queries, 3)).toBe(2);
    expect(MetricQueryOverlay.getChartLeadIndex(queries, 4)).toBe(2);
  });

  test("whether the query itself overlays does not change the chart it would join", () => {
    const off: Array<MetricQueryConfigData> = [
      query("a"),
      query("b", { overlay: true }),
      query("c"),
    ];
    const on: Array<MetricQueryConfigData> = [
      query("a"),
      query("b", { overlay: true }),
      query("c", { overlay: true }),
    ];

    expect(MetricQueryOverlay.getChartLeadIndex(off, 2)).toBe(0);
    expect(MetricQueryOverlay.getChartLeadIndex(on, 2)).toBe(0);
  });

  test("a first query saved with the switch on still leads its chart", () => {
    const queries: Array<MetricQueryConfigData> = [
      query("a", { overlay: true }),
      query("b", { overlay: true }),
    ];

    expect(MetricQueryOverlay.getChartLeadIndex(queries, 1)).toBe(0);
  });

  test("an index the list does not have joins nothing", () => {
    const queries: Array<MetricQueryConfigData> = [query("a"), query("b")];

    for (const index of [-1, 2, 7, 1.5, Number.NaN]) {
      expect({
        index,
        lead: MetricQueryOverlay.getChartLeadIndex(queries, index),
      }).toEqual({ index, lead: null });
    }
  });

  test("getChartLead hands back that query itself", () => {
    const lead: MetricQueryConfigData = query("a");
    const queries: Array<MetricQueryConfigData> = [
      lead,
      query("b", { overlay: true }),
      query("c"),
    ];

    expect(MetricQueryOverlay.getChartLead(queries, 2)).toBe(lead);
    expect(MetricQueryOverlay.getChartLead(queries, 0)).toBeUndefined();
  });
});

describe("getChartCount: a chart per query not overlaid, and per formula", () => {
  test("no overlays: a chart per query, then one per formula", () => {
    expect(MetricQueryOverlay.getChartCount([query("a"), query("b")], 0)).toBe(
      2,
    );
    expect(MetricQueryOverlay.getChartCount([query("a"), query("b")], 1)).toBe(
      3,
    );
  });

  test("two queries overlaid draw one chart", () => {
    expect(
      MetricQueryOverlay.getChartCount(
        [query("a"), query("b", { overlay: true })],
        0,
      ),
    ).toBe(1);
  });

  test("three queries, the last two overlaid, draw one chart", () => {
    expect(
      MetricQueryOverlay.getChartCount(
        [
          query("a"),
          query("b", { overlay: true }),
          query("c", { overlay: true }),
        ],
        0,
      ),
    ).toBe(1);
  });

  test("a first query's switch is ignored: it still draws its chart", () => {
    expect(
      MetricQueryOverlay.getChartCount([query("a", { overlay: true })], 0),
    ).toBe(1);
  });

  test("no queries and no formulas draw nothing; a negative count is none", () => {
    expect(MetricQueryOverlay.getChartCount([], 0)).toBe(0);
    expect(MetricQueryOverlay.getChartCount([], -2)).toBe(0);
  });
});

describe("readUnit: how an overlaid query's values read on the chart's axis", () => {
  test("the same unit reads as it is", () => {
    expect(read("By", "By")).toEqual({ fit: OverlayUnitFit.Same, factor: 1 });
    expect(read("ms", "ms")).toEqual({ fit: OverlayUnitFit.Same, factor: 1 });
    expect(read("%", "%")).toEqual({ fit: OverlayUnitFit.Same, factor: 1 });
  });

  test("two spellings of one unit read as it is: B and By, % and percent", () => {
    expect(read("B", "By").fit).toBe(OverlayUnitFit.Same);
    expect(read("By", "bytes").fit).toBe(OverlayUnitFit.Same);
    expect(read("%", "percent").fit).toBe(OverlayUnitFit.Same);
    expect(read("pct", "%").fit).toBe(OverlayUnitFit.Same);
    expect(read("s", "sec").fit).toBe(OverlayUnitFit.Same);
  });

  test("no unit on either side reads as it is: there is nothing to compare", () => {
    expect(read("", "By").fit).toBe(OverlayUnitFit.Same);
    expect(read("By", "").fit).toBe(OverlayUnitFit.Same);
    expect(read("", "").fit).toBe(OverlayUnitFit.Same);
    expect(read("  ", "%").fit).toBe(OverlayUnitFit.Same);
    expect(
      MetricQueryOverlay.readUnit({ chartUnit: undefined, queryUnit: "ms" })
        .fit,
    ).toBe(OverlayUnitFit.Same);
  });

  test("two counts read as it is: requests beside errors, a bare 1 beside them", () => {
    expect(read("{requests}", "{errors}").fit).toBe(OverlayUnitFit.Same);
    expect(read("1", "{errors}", { chart: "http.requests" }).fit).toBe(
      OverlayUnitFit.Same,
    );
  });

  test("another unit of the same kind is converted into the chart's unit", () => {
    // Megabytes on a chart in gigabytes: a thousandth.
    expect(read("GB", "MB")).toEqual({
      fit: OverlayUnitFit.Converted,
      factor: 1e-3,
    });
    // Bytes on a chart in gigabytes.
    expect(read("GB", "By").factor).toBeCloseTo(1e-9, 15);
    // Seconds on a chart in milliseconds.
    expect(read("ms", "s")).toEqual({
      fit: OverlayUnitFit.Converted,
      factor: 1000,
    });
    // Mebibytes, which OpenTelemetry writes MiBy, on a chart in bytes.
    expect(read("By", "MiBy")).toEqual({
      fit: OverlayUnitFit.Converted,
      factor: 1024 * 1024,
    });
    // Megabits on a chart in bits.
    expect(read("bit", "mbit")).toEqual({
      fit: OverlayUnitFit.Converted,
      factor: 1e6,
    });
  });

  test("a 0-1 fraction and a percent convert into each other", () => {
    expect(read("%", "1", { query: "system.memory.utilization" })).toEqual({
      fit: OverlayUnitFit.Converted,
      factor: 100,
    });
    expect(read("1", "%", { chart: "system.cpu.utilization" })).toEqual({
      fit: OverlayUnitFit.Converted,
      factor: 0.01,
    });
    expect(
      read("1", "1", {
        chart: "system.cpu.utilization",
        query: "system.memory.utilization",
      }).fit,
    ).toBe(OverlayUnitFit.Same);
  });

  test("a unit of another kind cannot be read on the chart's axis", () => {
    expect(read("%", "By")).toEqual({
      fit: OverlayUnitFit.Different,
      factor: 1,
    });
    expect(read("By", "ms").fit).toBe(OverlayUnitFit.Different);
    expect(read("ms", "%").fit).toBe(OverlayUnitFit.Different);
    expect(read("By", "bit").fit).toBe(OverlayUnitFit.Different);
  });

  test("a count beside a unit cannot be read on its axis, either way round", () => {
    expect(read("By", "{requests}").fit).toBe(OverlayUnitFit.Different);
    expect(read("{requests}", "ms").fit).toBe(OverlayUnitFit.Different);
    // A bare 1 on a metric that is no fraction is a count, not a percent.
    expect(read("%", "1", { query: "http.requests" }).fit).toBe(
      OverlayUnitFit.Different,
    );
    // A fraction beside a count of the same "1" is not the same kind.
    expect(
      read("1", "1", {
        chart: "system.cpu.utilization",
        query: "http.requests",
      }).fit,
    ).toBe(OverlayUnitFit.Different);
  });

  test("a unit no family knows is the same only as written", () => {
    expect(read("req/s", "req/s").fit).toBe(OverlayUnitFit.Same);
    expect(read("Req/s", "req/s").fit).toBe(OverlayUnitFit.Same);
    expect(read("req/s", "By/s").fit).toBe(OverlayUnitFit.Different);
    expect(read("req/s", "ms").fit).toBe(OverlayUnitFit.Different);
  });

  test("toChartUnit multiplies only a converted value", () => {
    expect(MetricQueryOverlay.toChartUnit(500, read("GB", "MB"))).toBeCloseTo(
      0.5,
      12,
    );
    expect(MetricQueryOverlay.toChartUnit(0.25, read("ms", "s"))).toBe(250);
    expect(MetricQueryOverlay.toChartUnit(42, read("By", "By"))).toBe(42);
    expect(MetricQueryOverlay.toChartUnit(42, read("%", "By"))).toBe(42);
  });

  /*
   * Every pair of units, either way round: a conversion and its way back
   * multiply to one, the same pairs fit the same way both ways round, and a
   * unit always reads as it is beside itself.
   */
  test("a sweep of unit pairs reads the same either way round", () => {
    const units: Array<string> = [
      "",
      "1",
      "{requests}",
      "{errors}",
      "%",
      "percent",
      "B",
      "By",
      "KB",
      "MB",
      "GB",
      "MiBy",
      "GiBy",
      "ns",
      "µs",
      "ms",
      "s",
      "min",
      "h",
      "bit",
      "kbit",
      "req/s",
      "By/s",
    ];
    const random: SeededRandom = seededRandom(9961);

    for (let draw: number = 0; draw < 2000; draw++) {
      const a: string = units[random(units.length)]!;
      const b: string = units[random(units.length)]!;
      const forth: OverlayUnitReading = read(a, b);
      const back: OverlayUnitReading = read(b, a);

      expect({ a, b, forth: forth.fit }).toEqual({ a, b, forth: back.fit });
      expect(Number.isFinite(forth.factor) && forth.factor > 0).toBe(true);

      if (forth.fit === OverlayUnitFit.Converted) {
        expect({ a, b, product: forth.factor * back.factor }).toEqual({
          a,
          b,
          product: expect.closeTo(1, 9),
        });
      } else {
        expect({ a, b, factor: forth.factor }).toEqual({ a, b, factor: 1 });
      }

      expect({ a, self: read(a, a).fit }).toEqual({
        a,
        self: OverlayUnitFit.Same,
      });
    }
  });
});

/*
 * Issue #10042: the first overlaid query in a unit of another kind gives the
 * chart a second value axis, on its right, in its unit. Each query of a chart
 * is read against one axis: the first (its lead's unit) when it can be, else
 * the second, and a third kind of unit, which neither axis can say, against
 * the first as it is, and said.
 */
describe("readChartAxes: which axis each query of a chart is read against", () => {
  function axesOf(
    ...units: Array<string | { unit: string; metricName: string }>
  ): OverlayChartAxes {
    return MetricQueryOverlay.readChartAxes(
      units.map(
        (
          unit: string | { unit: string; metricName: string },
        ): OverlayChartQueryUnit => {
          return typeof unit === "string" ? { unit } : unit;
        },
      ),
    );
  }

  function sides(axes: OverlayChartAxes): Array<string> {
    return axes.readings.map((reading: OverlayAxisReading): string => {
      return `${reading.axis}:${reading.fit}`;
    });
  }

  test("a chart of one query has one axis, the first", () => {
    const axes: OverlayChartAxes = axesOf("%");

    expect(sides(axes)).toEqual(["First:Same"]);
    expect(axes.secondAxisLeadIndex).toBeNull();
  });

  test("no queries: no readings and no second axis", () => {
    const axes: OverlayChartAxes = axesOf();

    expect(axes.readings).toEqual([]);
    expect(axes.secondAxisLeadIndex).toBeNull();
  });

  test("units of one kind share the first axis, converted into the lead's", () => {
    const axes: OverlayChartAxes = axesOf("GB", "MB", "GB", "By");

    expect(sides(axes)).toEqual([
      "First:Same",
      "First:Converted",
      "First:Same",
      "First:Converted",
    ]);
    expect(axes.readings[1]!.factor).toBeCloseTo(0.001, 12);
    expect(axes.secondAxisLeadIndex).toBeNull();
  });

  test("bytes on a chart in percent: the bytes get the second axis, as they are", () => {
    const axes: OverlayChartAxes = axesOf("%", "By");

    expect(sides(axes)).toEqual(["First:Same", "Second:Same"]);
    expect(axes.readings[1]!.factor).toBe(1);
    expect(axes.secondAxisLeadIndex).toBe(1);
  });

  test("percent on a chart in bytes: the other way round, the percent on the right", () => {
    const axes: OverlayChartAxes = axesOf("By", "%");

    expect(sides(axes)).toEqual(["First:Same", "Second:Same"]);
    expect(axes.secondAxisLeadIndex).toBe(1);
  });

  test("later queries of the second axis's kind are converted into its unit", () => {
    const axes: OverlayChartAxes = axesOf("%", "GB", "MB", "GB");

    expect(sides(axes)).toEqual([
      "First:Same",
      "Second:Same",
      "Second:Converted",
      "Second:Same",
    ]);
    // Megabytes read on an axis in gigabytes.
    expect(axes.readings[2]!.factor).toBeCloseTo(0.001, 12);
    expect(axes.secondAxisLeadIndex).toBe(1);
  });

  test("queries of the first axis's kind stay on it after the second axis is given", () => {
    const axes: OverlayChartAxes = axesOf("ms", "By", "s", "KB");

    expect(sides(axes)).toEqual([
      "First:Same",
      "Second:Same",
      "First:Converted",
      "Second:Converted",
    ]);
    expect(axes.readings[2]!.factor).toBe(1000);
    expect(axes.readings[3]!.factor).toBe(1000);
  });

  test("a third kind of unit fits neither axis: drawn against the first, as it is", () => {
    const axes: OverlayChartAxes = axesOf("%", "By", "ms", "s");

    expect(sides(axes)).toEqual([
      "First:Same",
      "Second:Same",
      "First:Different",
      "First:Different",
    ]);
    expect(axes.readings[2]!.factor).toBe(1);
    expect(axes.readings[3]!.factor).toBe(1);
    // The second axis stays the first other kind's.
    expect(axes.secondAxisLeadIndex).toBe(1);
  });

  test("a count beside a unit: the count's chart gives the unit the second axis", () => {
    const axes: OverlayChartAxes = axesOf("{requests}", "ms", "{errors}");

    expect(sides(axes)).toEqual(["First:Same", "Second:Same", "First:Same"]);
  });

  test("no unit known reads as it is, on the first axis, whatever the lead's", () => {
    expect(sides(axesOf("%", ""))).toEqual(["First:Same", "First:Same"]);
    expect(sides(axesOf("", "By", "%"))).toEqual([
      "First:Same",
      "First:Same",
      "First:Same",
    ]);
  });

  test("a 0-1 fraction is percent, by its metric's name", () => {
    const axes: OverlayChartAxes = axesOf(
      "By",
      { unit: "1", metricName: "system.cpu.utilization" },
      "%",
    );

    expect(sides(axes)).toEqual([
      "First:Same",
      "Second:Same",
      "Second:Converted",
    ]);
    // A percent read on an axis of a 0-1 fraction.
    expect(axes.readings[2]!.factor).toBeCloseTo(0.01, 12);

    // A "1" on a metric that is no fraction is a count, read bare.
    expect(
      sides(axesOf("{requests}", { unit: "1", metricName: "http.requests" })),
    ).toEqual(["First:Same", "First:Same"]);
  });

  /*
   * Over a seeded sweep of charts of two to five queries: the lead is on
   * the first axis as it is; the second axis, when there is one, is led by
   * the first query the first axis cannot read, which is on it as it is;
   * every other query is read against its axis's lead exactly as readUnit
   * reads the pair, and a query on neither axis is one that neither lead
   * can read.
   */
  test("a sweep of charts reads each query against its axis's lead, as readUnit does", () => {
    const units: Array<string> = [
      "",
      "1",
      "{requests}",
      "%",
      "percent",
      "By",
      "MB",
      "GB",
      "ms",
      "s",
      "bit",
      "req/s",
    ];
    const random: SeededRandom = seededRandom(10042);

    for (let draw: number = 0; draw < 1500; draw++) {
      const chart: Array<string> = [];
      const size: number = 2 + random(4);

      for (let index: number = 0; index < size; index++) {
        chart.push(units[random(units.length)]!);
      }

      const axes: OverlayChartAxes = axesOf(...chart);
      const firstOtherKind: number = chart.findIndex(
        (unit: string, index: number): boolean => {
          return (
            index > 0 && read(chart[0]!, unit).fit === OverlayUnitFit.Different
          );
        },
      );

      expect({ chart, lead: axes.readings[0] }).toEqual({
        chart,
        lead: { axis: OverlayAxis.First, fit: OverlayUnitFit.Same, factor: 1 },
      });
      expect({ chart, second: axes.secondAxisLeadIndex }).toEqual({
        chart,
        second: firstOtherKind === -1 ? null : firstOtherKind,
      });

      chart.forEach((unit: string, index: number): void => {
        if (index === 0) {
          return;
        }

        const reading: OverlayAxisReading = axes.readings[index]!;
        const onFirst: OverlayUnitReading = read(chart[0]!, unit);

        if (onFirst.fit !== OverlayUnitFit.Different) {
          expect({ chart, index, reading }).toEqual({
            chart,
            index,
            reading: { ...onFirst, axis: OverlayAxis.First },
          });
          return;
        }

        const onSecond: OverlayUnitReading = read(chart[firstOtherKind]!, unit);

        expect({ chart, index, reading }).toEqual({
          chart,
          index,
          reading:
            onSecond.fit === OverlayUnitFit.Different
              ? {
                  axis: OverlayAxis.First,
                  fit: OverlayUnitFit.Different,
                  factor: 1,
                }
              : { ...onSecond, axis: OverlayAxis.Second },
        });
      });
    }
  });
});

describe("getChartQueriesBefore: the chart a query joins, as far as it", () => {
  test("the first query joins no chart", () => {
    expect(MetricQueryOverlay.getChartQueriesBefore([query("a")], 0)).toEqual(
      [],
    );
  });

  test("the second query joins the first's chart: the first alone", () => {
    const queries: Array<MetricQueryConfigData> = [query("a"), query("b")];

    expect(MetricQueryOverlay.getChartQueriesBefore(queries, 1)).toEqual([
      queries[0],
    ]);
  });

  test("a chain: the lead and every query overlaid on it before this one", () => {
    const queries: Array<MetricQueryConfigData> = [
      query("a"),
      query("b"),
      query("c", { overlay: true }),
      query("d", { overlay: true }),
      query("e", { overlay: true }),
    ];

    expect(MetricQueryOverlay.getChartQueriesBefore(queries, 4)).toEqual([
      queries[1],
      queries[2],
      queries[3],
    ]);
    expect(MetricQueryOverlay.getChartQueriesBefore(queries, 2)).toEqual([
      queries[1],
    ]);
  });

  test("an index the list does not have joins no chart", () => {
    const queries: Array<MetricQueryConfigData> = [query("a"), query("b")];

    expect(MetricQueryOverlay.getChartQueriesBefore(queries, 2)).toEqual([]);
    expect(MetricQueryOverlay.getChartQueriesBefore(queries, -1)).toEqual([]);
  });
});

/*
 * A dashboard created from a template before the switch existed draws as it
 * did: no template's Chart widget overlays a query, so each draws a chart
 * per query and per formula.
 */
describe("the dashboard templates draw a chart per query, as before", () => {
  interface TemplateChart {
    template: string;
    chart: DashboardChartComponent;
  }

  const templateCharts: Array<TemplateChart> = Object.values(
    DashboardTemplateType,
  ).flatMap((template: DashboardTemplateType): Array<TemplateChart> => {
    const config: DashboardViewConfig | null = getTemplateConfig(template);

    return (config?.components || [])
      .filter((component: DashboardBaseComponent): boolean => {
        return component.componentType === DashboardComponentType.Chart;
      })
      .map((component: DashboardBaseComponent): TemplateChart => {
        return {
          template: template,
          chart: component as unknown as DashboardChartComponent,
        };
      });
  });

  test("the templates have Chart widgets to hold to it", () => {
    expect(templateCharts.length).toBeGreaterThan(10);
  });

  test("no template's chart overlays a query", () => {
    const overlaid: Array<string> = templateCharts
      .filter((entry: TemplateChart): boolean => {
        return JSON.stringify(entry.chart.arguments).includes(
          "overlayWithPreviousQuery",
        );
      })
      .map((entry: TemplateChart): string => {
        return `${entry.template}: ${entry.chart.arguments.chartTitle || "Chart"}`;
      });

    expect(overlaid).toEqual([]);
  });

  test("each template chart draws a chart per query and per formula", () => {
    for (const entry of templateCharts) {
      const queries: Array<MetricQueryConfigData> = [
        ...(entry.chart.arguments.metricQueryConfig
          ? [entry.chart.arguments.metricQueryConfig]
          : []),
        ...(entry.chart.arguments.metricQueryConfigs || []),
      ];
      const formulas: number = (
        entry.chart.arguments.metricFormulaConfigs || []
      ).length;

      expect({
        template: entry.template,
        chart: entry.chart.arguments.chartTitle,
        charts: MetricQueryOverlay.getChartCount(queries, formulas),
      }).toEqual({
        template: entry.template,
        chart: entry.chart.arguments.chartTitle,
        charts: queries.length + formulas,
      });
    }
  });
});
