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
      indexOfOrFail(code, "{isLoading ? <ComponentLoader />"),
    ).toBeGreaterThan(open);
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
    expect(code).toContain("onDoubleClick={zoom?.onTimeRangeReset}");
    expect(code).toContain("<FlowNoDataState timeRange={timeRange} />");
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
