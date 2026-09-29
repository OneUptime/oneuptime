import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 wiring pins for services, RUM and SLOs: a drag across any
 * chart zooms whatever range that chart is drawn over, and a double-click
 * on any chart sharing that range puts the range from before the zoom back.
 *
 * App's jest runs in node and cannot render these pages, so the load-bearing
 * wiring is pinned here as comment-stripped, whitespace-squashed source
 * (prettier re-wrapping cannot fail a check, prose cannot pass one). The
 * behaviour behind each pin is rendered for real in Common/Tests/App/
 * Dashboard:
 *
 *   ServiceOverviewTimeRangeZoom.test.tsx     the Service overview
 *   RumOverviewTimeRangeZoom.test.tsx         the RUM overview
 *   SloHistoryChartsTimeRangeZoom.test.tsx    Error Budget History
 *   SloMetricsTimeRangeZoom.test.tsx          SLO / Incident / Alert metric cards
 *   SloEventMetricsBarChartZoom.test.tsx      the bar panels, through MetricCharts
 *   SloBudgetBurnDownZoom.test.tsx            the SLO overview's burn-down
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath.split("/")), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1 ")
    .replace(/\s+/g, " ");
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

// The text from `from` (inclusive) to the next `to` after it (exclusive).
function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  if (end < 0) {
    throw new Error(`Expected "${to}" after "${from}".`);
  }

  return source.slice(start, end);
}

const SCOPE_IMPORT: string =
  'import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";';

const PAGE_SCOPE_OPEN: string =
  "<TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>";

describe("Service overview (Pages/Service/View/Index.tsx)", () => {
  const code: string = readCode("Pages/Service/View/Index.tsx");

  test("zooms through the shared scope, over the page's own range state", () => {
    expect(code).toContain(SCOPE_IMPORT);
    expect(code).toContain(
      "const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(DEFAULT_RANGE);",
    );
    expect(code).toContain(PAGE_SCOPE_OPEN);
    // One scope, one range: no second copy of the range to drift.
    expect(countOf(code, "<TimeRangeZoomScope")).toBe(1);
    expect(countOf(code, "useState<RangeStartAndEndDateTime>")).toBe(1);
  });

  test("the scope wraps the whole returned tree, the hero picker and every chart and tile included", () => {
    const tree: string = between(
      code,
      `return ( ${PAGE_SCOPE_OPEN}`,
      "</TimeRangeZoomScope> ); };",
    );

    expect(tree).toMatch(
      /^return \( <TimeRangeZoomScope [^>]*> <ResourceOverview /,
    );
    expect(tree).toContain("tiles={tiles}");
    expect(tree).toContain("charts={charts}");
    expect(tree).toContain("<TelemetryTimeRangePicker value={timeRange}");
    expect(tree).toContain("<ResourceActivityCards");
    expect(code).toMatch(
      /<\/TimeRangeZoomScope> \); \}; export default ServiceView;/,
    );
  });

  test("the picker still sets the page's range itself; a pick ends a zoom by value", () => {
    expect(code).toContain(
      "onChange={(value: RangeStartAndEndDateTime): void => { setTimeRange(value); }}",
    );
  });

  test("every chart and tile is fetched from the one page range", () => {
    expect(code).toContain(
      "RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);",
    );
    expect(code).toContain(
      "fetchSpanMetrics({ primaryEntityId: modelId, start, end })",
    );
    expect(code).toContain(
      "probeRuntimeCharts({ language, primaryEntityId: modelId, start, end })",
    );
    expect(code).toContain(
      "fetchLogAndExceptionSignals({ primaryEntityId: modelId, start, end })",
    );
    expect(code).toContain("}, [service, timeRange]);");
  });

  test("every chart card is drawn over the fetched window and keeps its lines through a refresh", () => {
    const cards: Array<string> = code
      .split("<ChartCard ")
      .slice(1)
      .map((chunk: string): string => {
        return chunk.slice(0, chunk.indexOf("/>"));
      });

    // Requests, Latency, Logs, Exceptions and the runtime loop.
    expect(cards).toHaveLength(5);
    for (const card of cards) {
      expect(card).toContain("windowStart={chartWindow?.start ?? null}");
      expect(card).toContain("windowEnd={chartWindow?.end ?? null}");
      // A skeleton on every refresh tick would drop a drag in progress.
      expect(card).not.toContain("loading={metricsLoading}");
    }
    expect(code).toContain(
      "const spanChartsLoading: boolean = metricsLoading && !m;",
    );
    expect(code).toContain(
      "const signalChartsLoading: boolean = metricsLoading && !logExceptionSignals;",
    );
    expect(countOf(code, "loading={spanChartsLoading}")).toBe(2);
    expect(countOf(code, "loading={signalChartsLoading}")).toBe(2);
    expect(code).toContain(
      "loading={metricsLoading && chart.series.length === 0}",
    );
  });

  test("no chart on the page opts out of the page's zoom", () => {
    expect(code).not.toContain("disableTimeRangeZoom");
    expect(code).not.toContain("TimeRangeZoomProvider");
  });
});

describe("RUM overview (Pages/Rum/View/Overview.tsx)", () => {
  const code: string = readCode("Pages/Rum/View/Overview.tsx");

  test("zooms through the shared scope, over the page's own range state", () => {
    expect(code).toContain(SCOPE_IMPORT);
    expect(code).toContain(
      "const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(DEFAULT_RANGE);",
    );
    expect(code).toContain(PAGE_SCOPE_OPEN);
    expect(countOf(code, "<TimeRangeZoomScope")).toBe(1);
  });

  test("the scope wraps the whole returned tree: notice, hero picker, charts, tiles and both web-vitals cards", () => {
    const tree: string = between(
      code,
      `return ( ${PAGE_SCOPE_OPEN}`,
      "</TimeRangeZoomScope> ); };",
    );

    expect(tree).toContain("{showRumSdkMissingNotice && (");
    expect(tree).toContain("<ResourceOverview");
    expect(tree).toContain("tiles={tiles}");
    expect(tree).toContain("charts={charts}");
    expect(tree).toContain("<TelemetryTimeRangePicker value={timeRange}");
    expect(tree).toContain("<WebVitalsCard");
    expect(tree).toContain("<WebVitalRouteBreakdownCard");
  });

  test("the picker still sets the page's range itself", () => {
    expect(code).toContain(
      "onChange={(value: RangeStartAndEndDateTime): void => { setTimeRange(value); }}",
    );
  });

  test("every fetch, the sessions tile and its link read the one page range", () => {
    const loader: string = between(
      code,
      "const loadTelemetry:",
      "[modelIdString, timeRangeKey],",
    );

    expect(loader).toContain(
      "RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);",
    );
    for (const fetcher of [
      "fetchSpanMetrics({ primaryEntityId, start, end })",
      "fetchWebVitals({ primaryEntityId, start, end })",
      "fetchWebVitalByRoute({",
      "fetchSpanNameStats({",
      "fetchLogAndExceptionSignals({ primaryEntityId, start, end })",
      "fetchSessionReplayList({",
    ]) {
      expect({ fetcher, found: loader.includes(fetcher) }).toEqual({
        fetcher,
        found: true,
      });
    }
    // A zoomed (custom) range is part of the key, so a zoom reloads.
    expect(code).toContain(
      "timeRange.startAndEndDate?.startValue?.toISOString()",
    );
    expect(code).toContain("describeTimeRangeForTile(timeRange)");
    expect(code).toContain("buildRangedListRoute(");
  });

  test("the chart cards keep their lines through a refresh", () => {
    expect(code).not.toContain("loading={metricsLoading}");
    expect(code).not.toContain("loading={pageLoadsLoading}");
    expect(code).not.toContain("loading={signalsLoading}");
  });
});

describe("Error Budget History (Components/Slo/SloHistoryCharts.tsx)", () => {
  const code: string = readCode("Components/Slo/SloHistoryCharts.tsx");

  test("zooms the view's own range: the hook over its state and setter, offered to every chart", () => {
    expect(code).toContain(
      "const zoom: TimeRangeZoom = useTimeRangeZoom({ timeRange: timeRange, onTimeRangeChange: setTimeRange, });",
    );
    expect(code).toMatch(
      /return \( <TimeRangeZoomProvider zoom=\{zoom\}>[^]*<\/TimeRangeZoomProvider> \); \}; export default SloHistoryCharts;/,
    );
  });

  test("all three charts are inside the provider, and none opts out or brings its own handlers", () => {
    const tree: string = between(
      code,
      "return ( <TimeRangeZoomProvider zoom={zoom}>",
      "</TimeRangeZoomProvider>",
    );

    for (const series of ["sliPoints", "budgetPoints", "burnRatePoints"]) {
      expect(tree).toContain(`points: ${series},`);
    }
    const chart: string = between(code, "<LineChartElement", "/>");
    expect(chart).not.toContain("onTimeRangeSelect");
    expect(chart).not.toContain("onTimeRangeReset");
    expect(chart).not.toContain("disableTimeRangeZoom");
  });

  test("Reset zoom sits beside the range picker, which still sets the range itself", () => {
    const pickerRow: string = between(
      code,
      "<RangeStartAndEndDateView",
      "</div>",
    );

    expect(pickerRow).toContain("dashboardStartAndEndDate={timeRange}");
    expect(pickerRow).toContain("setTimeRange(newRange);");
    expect(pickerRow).toContain("<ResetTimeRangeZoomButton />");
  });

  test("each card names the gesture on hover, from the row that replaces its body margin", () => {
    expect(countOf(code, "<SloChartZoomHint />")).toBe(3);
    expect(
      countOf(
        code,
        '<Card className="group/zoomhint" bodyClassName={SLO_CHART_ZOOM_HINT_BODY_CLASS_NAME}',
      ),
    ).toBe(3);
    // Not in the header: that squeezed the description beside the picker.
    expect(code).not.toContain("TimeRangeZoomHint revealOnHover");
  });

  test("an empty chart takes the double-click while zoomed", () => {
    expect(code).toContain(
      "onDoubleClick={zoom.isZoomed ? zoom.resetZoom : undefined}",
    );
  });

  test("the fetch still follows the range, so a zoom refetches at its own bucket size", () => {
    expect(code).toContain("}, [timeRange, refreshTick]);");
    expect(code).toContain("}, [timeRange, refreshTick, sloIdString]);");
    expect(code).toContain("getSloChartAggregationInterval(spanInMinutes);");
  });
});

describe("SLO Metrics tab (Components/Slo/SloMetrics.tsx)", () => {
  const code: string = readCode("Components/Slo/SloMetrics.tsx");

  test("its cards share one zoom over the tab's one range", () => {
    expect(code).toContain(SCOPE_IMPORT);
    expect(code).toContain(
      "<TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={handleTimeRangeChange} >",
    );
    const tree: string = between(
      code,
      "<TimeRangeZoomScope",
      "</TimeRangeZoomScope>",
    );
    expect(tree).toContain("<EmbeddedMetricCard");
    // Controlled cards: that is what makes them take the tab's zoom.
    expect(tree).toContain("timeRange={timeRange}");
    expect(tree).toContain("onTimeRangeChange={handleTimeRangeChange}");
  });
});

describe("SLO Incident and Alert Metrics tabs", () => {
  test.each([
    ["Components/Slo/SloIncidentMetrics.tsx"],
    ["Components/Slo/SloAlertMetrics.tsx"],
  ])(
    "%s leaves its card uncontrolled, so the card keeps its own zoom over its own week",
    (file: string) => {
      const code: string = readCode(file);
      const card: string = between(code, "<EmbeddedMetricCard", "/>");

      expect(card).toContain(
        "defaultTimeRange={SLO_EVENT_METRICS_DEFAULT_TIME_RANGE}",
      );
      expect(card).not.toContain("timeRange={");
      expect(card).not.toContain("onTimeRangeChange=");
      expect(card).not.toContain("disableChartZoom");
    },
  );
});

describe("SLO overview burn-down (Components/Slo/SloBudgetBurnDownCard.tsx)", () => {
  const code: string = readCode("Components/Slo/SloBudgetBurnDownCard.tsx");

  test("keeps a zoom of its own, offered to the whole card - never the page's", () => {
    expect(code).toMatch(
      /return \( <TimeRangeZoomProvider zoom=\{zoom\}> <Card [^]*<\/Card> <\/TimeRangeZoomProvider> \); \};/,
    );
    expect(code).not.toContain("TimeRangeZoomScope");
    expect(code).not.toContain("useChartTimeRangeZoom");
  });

  test("a reset goes back to the LIVE compliance window, not to a snapshot of it", () => {
    expect(code).toContain(
      "const [zoomedTimeRange, setZoomedTimeRange] = useState<RangeStartAndEndDateTime | null>(null);",
    );
    expect(code).toContain(
      "timeRange: zoomedTimeRange || complianceTimeRange,",
    );
    expect(code).toContain("setZoomedTimeRange(null);");
    expect(code).not.toContain("useTimeRangeZoom(");
  });

  test("a zoom is cut to the compliance window and to now", () => {
    expect(code).toContain(
      "complianceWindowStart: complianceWindowStartRef.current, now: OneUptimeDate.getCurrentDate(),",
    );
    expect(code).toContain("getSloBurnDownZoomRange({");
  });

  test("the chart and the even-burn line are drawn over the fetched window", () => {
    expect(code).toContain("min: series.startDate,");
    expect(code).toContain("max: series.endDate,");
    expect(code).toContain("getSloIdealBurnPointsInWindow({");
    expect(code).toContain("windowStartDate: series.startDate,");
    expect(code).toContain("windowEndDate: series.endDate,");
  });

  test("the header offers Reset zoom, the body names the gesture, and an empty zoom takes the double-click", () => {
    const header: string = between(code, "rightElement={", "</div> }");

    expect(header).toContain("<ResetTimeRangeZoomButton />");
    expect(header).toContain('title="Open metrics"');
    expect(code).toContain(
      '<Card className="group/zoomhint" bodyClassName={SLO_CHART_ZOOM_HINT_BODY_CLASS_NAME}',
    );
    expect(code).toContain("<SloChartZoomHint /> {getBody()}");
    expect(code).toContain("<div onDoubleClick={resetZoom}>");
  });

  test("still polls nothing of its own", () => {
    expect(code).not.toContain("setInterval(");
  });
});

describe("the SLO chart cards' hint row (Components/Slo/SloChartZoomHint.tsx)", () => {
  const code: string = readCode("Components/Slo/SloChartZoomHint.tsx");

  test("takes the place of the card body's top margin on desktop, and is not shown on a phone", () => {
    expect(code).toContain(
      'export const SLO_CHART_ZOOM_HINT_BODY_CLASS_NAME: string = "mt-4 md:mt-0";',
    );
    expect(code).toContain(
      '<div className="max-md:hidden h-4 items-center justify-end md:flex"> <TimeRangeZoomHint revealOnHover={true} /> </div>',
    );
  });
});

describe("pages that only host these components add no range of their own", () => {
  test.each([["Pages/Slo/View/Metrics.tsx"], ["Pages/Slo/View/Charts.tsx"]])(
    "%s leaves each view's zoom to the view",
    (file: string) => {
      const code: string = readCode(file);

      expect(code).not.toContain("TimeRangeZoom");
      expect(code).not.toContain("RangeStartAndEndDateTime");
    },
  );
});
