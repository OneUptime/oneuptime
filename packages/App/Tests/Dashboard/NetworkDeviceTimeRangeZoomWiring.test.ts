import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 wiring pins for a network device's Metrics and Traffic pages:
 * drag across any chart to zoom, double-click any chart to go back. Each
 * page is one card that owns the page's range. App's node test environment
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

describe("Network device Traffic: the top-talkers card's range is the page's", () => {
  const code: string = readCode("Components/NetworkDevice/FlowTopTalkers.tsx");

  test("the Traffic page is this card", () => {
    expect(readCode("Pages/NetworkDevice/View/Traffic.tsx")).toContain(
      "<FlowTopTalkers networkDeviceId={modelId} />",
    );
  });

  test("the card is a zoom scope over its own range and setter, above its loader", () => {
    expect(code).toMatch(SCOPE_IMPORT);
    const open: number = scopeOpening(code, "timeRange", "setTimeRange");
    expect(code.slice(open - "return ( ".length, open)).toBe("return ( ");
    expect(
      indexOfOrFail(code, "{!loaded && isLoading ? <ComponentLoader />"),
    ).toBeGreaterThan(open);
  });

  test("a refetch keeps the last data on screen: the loader and the full error are for the first load only", () => {
    // sdn-2: every zoom and reset used to swap the whole body for a loader.
    expect(code).not.toContain("{isLoading ? <ComponentLoader />");
    expect(code).toContain(
      "{!loaded && !isLoading && error ? ( <ErrorMessage message={error} /> )",
    );
    // Once loaded, the figures stay, dimmed, with a note that they refresh.
    expect(code).toContain(
      '<div className={isLoading ? "opacity-75 transition-opacity" : ""} data-testid="flow-top-talkers-body" > {loaded.data.totalFlows > 0 ? ( <FlowTopTalkersFigures data={loaded.data} /> ) : ( <FlowNoDataState timeRange={loaded.timeRange} /> )}',
    );
    // Only a fetch that succeeded replaces them, with the range it was for.
    expect(code).toContain(
      "} else if (result) { setLoaded({ data: result, timeRange: timeRange }); }",
    );
  });

  test("the picker keeps setting the range directly, with Reset zoom beside it", () => {
    expect(code).toContain(RESET_IMPORT);
    expect(code).toContain(PICKER_AND_RESET);
  });

  test("the bandwidth chart is the shared area chart on a time axis, not a hand-drawn SVG", () => {
    expect(code).toContain(
      'import AreaChartElement from "Common/UI/Components/Charts/Area/AreaChart";',
    );
    const chart: string = code.slice(
      indexOfOrFail(code, "<AreaChartElement"),
      indexOfOrFail(code, 'colors={["indigo"]} />'),
    );
    expect(chart).toContain("xAxis={xAxis}");
    // It takes the card's zoom; it has none of its own.
    expect(chart).not.toContain("onTimeRangeSelect");
    expect(chart).not.toContain("disableTimeRangeZoom");
    expect(code).toContain("type: XAxisType.Time,");
    expect(code).not.toContain("<svg");
    expect(code).not.toContain("<polyline");
  });

  test("the chart names the gesture, revealed over its section", () => {
    expect(code).toContain(
      '<TimeRangeZoomHint revealOnHover={true} className="ml-auto" />',
    );
    expect(code).toContain(
      '<div className="group/zoomhint mb-6"> <FlowSectionTitle title="Bandwidth Over Time"',
    );
  });

  test("everything on the card comes from one fetch over the card's range", () => {
    expect(code).toContain(
      "RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);",
    );
    expect(code).toContain("}, [props.networkDeviceId, timeRange]);");
    // And only the latest fetch lands, so a quick zoom-and-back cannot race.
    expect(code).toContain(
      "if (fetchId !== latestFetchRef.current) { return; }",
    );
  });

  test("a zoom into a quiet stretch can be double-clicked away", () => {
    expect(code).toContain(
      "const onTimeRangeReset: (() => void) | undefined = zoom?.onTimeRangeReset;",
    );
    expect(code).toContain(
      'data-testid="flow-no-data" onDoubleClick={onTimeRangeReset} >',
    );
    // The empty state reads the window the card LOADED, not the picker's.
    expect(code).toContain("<FlowNoDataState timeRange={loaded.timeRange} />");
  });

  test("a zoom into a quiet stretch says so, and keeps the NetFlow setup steps for a preset window", () => {
    // sdn-6
    expect(code).toContain(
      '{props.timeRange.range === TimeRange.CUSTOM ? ( <div className="text-center max-w-md"> <div className="text-sm font-medium text-gray-900"> {translator.translateText("No flows in the selected time range.")} </div>',
    );
    expect(code).toContain("No flow data yet.");
    expect(code).toContain("PROBE_NETFLOW_RECEIVER_ENABLED=true");
  });
});

describe("Network device Traffic: the API's bucket widths, which the chart tests mirror", () => {
  test("pickBucketSeconds still sizes buckets to ~120 per window, in whole minutes", () => {
    /*
     * Common/Tests/App/Dashboard/FlowBandwidthAxisCases.tsx restates this
     * formula to build API responses for every window; if it changes, that
     * mirror must change with it.
     */
    const server: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "../../FeatureSet/BaseAPI/API/NetworkDeviceFlow.ts",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");
    expect(server).toContain(
      "export function pickBucketSeconds(windowInSeconds: number): number { const targetPoints: number = 120; const rawSeconds: number = Math.ceil(windowInSeconds / targetPoints); return Math.max(60, Math.ceil(rawSeconds / 60) * 60); }",
    );
    expect(server).toContain("const MAX_RANGE_DAYS: number = 31;");
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
