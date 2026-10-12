import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 wiring pins for a network device's Metrics page and the
 * Traffic pages (a device's, a site's, the network's): drag across any
 * chart to zoom, double-click any chart to go back. Each page owns its
 * range. App's node test environment
 * cannot render React, so the load-bearing wiring is pinned here as
 * comment-stripped, whitespace-squashed source; what it DOES is rendered
 * and exercised in Common/Tests/App/Dashboard/NetworkDeviceTimeRangeZoom.test.tsx.
 */

function readCode(relative: string): string {
  return fs
    .readFileSync(
      path.join(__dirname, "../../FeatureSet/Dashboard/src", relative),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\{\s*\}/g, " ")
    .replace(/\s+/g, " ");
}

function indexOfOrFail(code: string, needle: string): number {
  const index: number = code.indexOf(needle);
  if (index < 0) {
    throw new Error(`Expected the source to contain "${needle}".`);
  }
  return index;
}

/*
 * Where `<TimeRangeZoomScope timeRange={...} onTimeRangeChange={...}>`
 * opens, whether Prettier kept it on one line or broke it.
 */
function scopeOpening(
  code: string,
  timeRange: string,
  onTimeRangeChange: string,
): number {
  const opening: string = `<TimeRangeZoomScope timeRange={${timeRange}} onTimeRangeChange={${onTimeRangeChange}}`;
  const index: number = code.search(
    new RegExp(`${opening.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ?>`),
  );
  if (index < 0) {
    throw new Error(`Expected the source to contain "${opening}>".`);
  }
  return index;
}

const SCOPE_IMPORT: RegExp =
  /import \{[^}]*\bTimeRangeZoomScope\b[^}]*\} from "Common\/UI\/Components\/Charts\/TimeRangeZoom\/TimeRangeZoomContext";/;
const RESET_IMPORT: string =
  'import ResetTimeRangeZoomButton from "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";';
const PICKER_AND_RESET: string =
  '<div className="flex items-center gap-2"> <RangeStartAndEndDateView dashboardStartAndEndDate={timeRange} onChange={(newRange: RangeStartAndEndDateTime) => { setTimeRange(newRange); }} /> <ResetTimeRangeZoomButton /> </div>';

describe("Network device Metrics: the health card's range is the page's", () => {
  const code: string = readCode(
    "Components/NetworkDevice/DeviceHealthCharts.tsx",
  );

  test("the Metrics page is this card", () => {
    expect(readCode("Pages/NetworkDevice/View/Metrics.tsx")).toContain(
      "<DeviceHealthCharts networkDeviceId={modelId} />",
    );
  });

  test("the card is a zoom scope over its own range and setter", () => {
    expect(code).toMatch(SCOPE_IMPORT);
    const open: number = scopeOpening(code, "timeRange", "setTimeRange");
    expect(code.slice(open - "return ( ".length, open)).toBe("return ( ");
    expect(indexOfOrFail(code, "<Card")).toBeGreaterThan(open);
  });

  test("the picker keeps setting the range directly, with Reset zoom beside it", () => {
    expect(code).toContain(RESET_IMPORT);
    expect(code).toContain(PICKER_AND_RESET);
  });

  test("the panels take the card's zoom: MetricView is handed no zoom of its own", () => {
    const view: string = code.slice(
      indexOfOrFail(code, "<MetricView"),
      indexOfOrFail(code, "</Card>"),
    );
    expect(view).not.toContain("onTimeRangeSelect");
    expect(view).not.toContain("onTimeRangeReset");
    expect(view).not.toContain("disableChartZoom");
    expect(view).not.toContain("localChartZoom");
  });

  test("both panels are drawn over the card's range, re-derived when it changes", () => {
    expect(code).toContain(
      "startAndEndDate: dateRange, queryConfigs: queryConfigs, }; }); }, [timeRange, queryConfigs]);",
    );
    expect(code).toContain(
      "RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);",
    );
  });
});

describe("Traffic pages: the traffic view's range is the page's", () => {
  const code: string = readCode(
    "Components/NetworkTraffic/NetworkTrafficView.tsx",
  );
  const chartCode: string = readCode(
    "Components/NetworkTraffic/TrafficOverTimeChart.tsx",
  );

  test("a device's, a site's and the network's Traffic pages are this view", () => {
    expect(readCode("Pages/NetworkDevice/View/Traffic.tsx")).toContain(
      'scope={{ kind: "device", networkDeviceId: modelId }}',
    );
    expect(readCode("Pages/NetworkSite/View/Traffic.tsx")).toContain(
      'scope={{ kind: "site", networkSiteId: modelId }}',
    );
    expect(readCode("Pages/NetworkDevice/Traffic.tsx")).toContain(
      '<NetworkTrafficView scope={{ kind: "network" }} />',
    );
  });

  test("the view is a zoom scope over its own range and setter, above its loader", () => {
    expect(code).toMatch(SCOPE_IMPORT);
    const open: number = scopeOpening(code, "view.range", "setRange");
    expect(code.slice(open - "return ( ".length, open)).toBe("return ( ");
    expect(
      indexOfOrFail(code, "{!loaded && isLoading ? <ComponentLoader />"),
    ).toBeGreaterThan(open);
  });

  test("a refetch keeps the last data on screen: the loader and the full error are for the first load only", () => {
    expect(code).not.toContain("{isLoading ? <ComponentLoader />");
    expect(code).toContain(
      "{!loaded && !isLoading && error ? ( <ErrorMessage message={error} /> )",
    );
    expect(code).toContain(
      '<div className={isLoading ? "opacity-75 transition-opacity" : ""} data-testid="traffic-body" >',
    );
    // Only a fetch that succeeded replaces them, with the view it was for.
    expect(code).toContain(
      "} else if (summary) { setLoaded({ summary: summary, view: requestedView }); }",
    );
  });

  test("the picker sets the range directly, with Reset zoom beside it", () => {
    expect(code).toContain(RESET_IMPORT);
    expect(code).toContain(
      '<div className="flex items-center gap-2"> <RangeStartAndEndDateView dashboardStartAndEndDate={view.range} onChange={setRange} /> <ResetTimeRangeZoomButton /> </div>',
    );
  });

  test("the traffic chart is the shared area chart on a time axis, with no zoom of its own", () => {
    expect(chartCode).toContain(
      'import AreaChartElement from "Common/UI/Components/Charts/Area/AreaChart";',
    );
    const chart: string = chartCode.slice(
      indexOfOrFail(chartCode, "<AreaChartElement"),
      indexOfOrFail(chartCode, "/> </div> </div> ); };"),
    );
    expect(chart).toContain("xAxis={xAxis}");
    expect(chart).not.toContain("onTimeRangeSelect");
    expect(chart).not.toContain("disableTimeRangeZoom");
    expect(chartCode).toContain("type: XAxisType.Time,");
    expect(chartCode).not.toContain("<svg");
  });

  test("the chart names the gesture, revealed over its section", () => {
    expect(chartCode).toContain("<TimeRangeZoomHint revealOnHover={true} />");
    expect(code).toContain(
      '<div className="group/zoomhint mt-6"> <div className="mb-1 text-sm font-medium text-gray-900"> {translator.translateText("Traffic over time")} </div> <TrafficOverTimeChart',
    );
  });

  test("everything on the page comes from one fetch over the view's range, and only the latest lands", () => {
    expect(code).toContain(
      "RangeStartAndEndDateTimeUtil.getStartAndEndDate(requestedView.range);",
    );
    expect(code).toContain("}, [scopeKey, view, refreshKey]);");
    expect(code).toContain(
      "if (fetchId !== latestFetchRef.current) { return; }",
    );
  });

  test("a zoom into a quiet stretch can be double-clicked away", () => {
    expect(code).toContain("onDoubleClick={zoom?.onTimeRangeReset}");
    expect(code).toContain('data-testid="traffic-no-data"');
    // The set-up guide reads the window the view LOADED, never the picker's.
    expect(code).toContain("shownView.range.range !== TimeRange.CUSTOM &&");
  });
});

describe("Traffic pages: the API's bucket widths, which the chart's grid is pinned to", () => {
  test("getNetworkTrafficBucketSeconds sizes buckets to ~120 per window, in whole minutes", () => {
    /*
     * The chart pins its grid to the coarsest step no wider than a bucket
     * (getTrafficAxisPrecision); Common/Tests/App/Dashboard/
     * FlowBandwidthAxisCases.tsx draws every window through this function.
     * A change here is a change to how the chart lays out its slots.
     */
    const types: string = fs
      .readFileSync(
        path.join(__dirname, "../../../Common/Types/NetFlow/NetworkTraffic.ts"),
        "utf8",
      )
      .replace(/\s+/g, " ");
    expect(types).toContain(
      "export function getNetworkTrafficBucketSeconds( windowInSeconds: number, ): number { const targetPoints: number = 120; const rawSeconds: number = Math.ceil(windowInSeconds / targetPoints); return Math.max(60, Math.ceil(rawSeconds / 60) * 60); }",
    );
    expect(types).toContain(
      "export const MAX_NETWORK_TRAFFIC_RANGE_DAYS: number = 31;",
    );
  });
});

describe("Network device latency trend: excluded", () => {
  test("the past-hour glyph beside an on-demand ping stays a fixed-window sparkline", () => {
    /*
     * A summary thumbnail with fixed "past hour" wording and a link to the
     * zoomable Metrics page; it has no range to zoom.
     */
    const code: string = readCode(
      "Components/NetworkDevice/DeviceLatencyTrend.tsx",
    );
    expect(code).toContain("<MetricSparkline");
    expect(code).not.toContain("TimeRangeZoom");
  });
});
