import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 wiring pins for the Topology maps' service-call drawer: its
 * history charts zoom the DRAWER's window, never the Topology page's range
 * (which drives the maps, and whose change reloads the map the drawer is
 * open on). App's node test environment cannot render React, so the
 * load-bearing wiring is pinned here as comment-stripped,
 * whitespace-squashed source; what it DOES is rendered and exercised in
 * Common/Tests/App/Dashboard/EdgeDetailPanelTimeRangeZoom.test.tsx.
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

describe("the service-call drawer keeps a zoom of its own", () => {
  const code: string = readCode("Components/Topology/EdgeDetailPanel.tsx");

  test("its window is its own zoom over the page's range, which a new page range ends", () => {
    expect(code).toContain(
      "const [zoomedTimeRange, setZoomedTimeRange] = useState<RangeStartAndEndDateTime | null>(null);",
    );
    expect(code).toContain(
      "useEffect(() => { setZoomedTimeRange(null); }, [props.timeRange]);",
    );
    expect(code).toContain(
      "const timeRange: RangeStartAndEndDateTime = zoomedTimeRange || props.timeRange;",
    );
    expect(code).toContain(
      "const zoom: TimeRangeZoom = useTimeRangeZoom({ timeRange: timeRange, onTimeRangeChange: onDrawerTimeRangeChange, });",
    );
  });

  test("the history is fetched over the drawer's window, not the page's", () => {
    expect(code).toContain(
      "return RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange); }, [timeRange]);",
    );
    expect(code).toContain(
      "}, [fromName, toName, timeRange, window, historyAvailable]);",
    );
    expect(code).not.toContain("getStartAndEndDate(props.timeRange)");
  });

  test("the drawer offers its zoom to its charts, shadowing any zoom around it", () => {
    const provider: number = indexOfOrFail(
      code,
      "<TimeRangeZoomProvider zoom={zoom}>",
    );
    const charts: number = indexOfOrFail(
      code,
      "<ChartGroup charts={buildCharts(loaded)} />",
    );
    const close: number = indexOfOrFail(code, "</TimeRangeZoomProvider>");
    expect(charts).toBeGreaterThan(provider);
    expect(charts).toBeLessThan(close);
    // And the charts take it: none opts out or brings its own.
    expect(code).not.toContain("disableTimeRangeZoom");
    expect(code).not.toContain("onTimeRangeSelect:");
  });

  test("with no picker of its own, its Reset zoom sits in the history's header, a row that is there zoomed or not", () => {
    /*
     * cc-6: it used to get a row of its own that appeared with the zoom,
     * pushing the charts down under the pointer that had just dragged them.
     */
    const history: number = indexOfOrFail(
      code,
      ') : ( <div data-testid="edge-history" aria-busy={isLoading}> <div className="flex h-7 items-center justify-between gap-2" data-testid="edge-history-header" > <h3 className="text-sm font-semibold text-gray-900"> {translateString("History") || "History"} </h3> <div className="flex items-center gap-2">',
    );
    const reset: number = indexOfOrFail(code, "<ResetTimeRangeZoomButton />");
    const body: number = indexOfOrFail(
      code,
      '<div className="mt-2 space-y-4">',
    );
    expect(reset).toBeGreaterThan(history);
    expect(reset).toBeLessThan(body);
    expect(code.split("<ResetTimeRangeZoomButton />")).toHaveLength(2);
    // Nothing is rendered only while zoomed but the button itself.
    expect(code).not.toContain("zoom.isZoomed ? ( <div");
    expect(code).not.toContain("edge-history-zoom");
    expect(code).toContain(
      'className={`text-sm text-gray-500${ zoom.isZoomed ? " select-none" : "" }`} data-testid="edge-history-empty" onDoubleClick={ zoom.isZoomed ? zoom.resetZoom : undefined }',
    );
  });

  test("a zoom's fetch keeps the last history on screen, drawn over the window it was fetched for", () => {
    expect(code).not.toContain("setResult(null)");
    expect(code).toContain(
      "window: window, precision: precision, }); } catch (err) {",
    );
    expect(code).toContain(
      "{!loaded ? ( isLoading ? ( <ComponentLoader /> ) : error ? ( <ErrorMessage message={error} /> ) : ( <></> ) ) : (",
    );
    expect(code).toContain(
      'className={isLoading ? "opacity-75 transition-opacity" : ""} data-testid="edge-history-body"',
    );
    expect(code).toContain(
      "min: axisStart, max: history.window.endValue, aggregateType: XAxisAggregateType.Sum, precision: history.precision,",
    );
    expect(code).toContain(
      "min: axisStart, max: history.window.endValue, aggregateType: XAxisAggregateType.Average, precision: history.precision,",
    );
    expect(code).not.toContain("min: window.startValue");
  });

  test("the history is fetched in buckets one step of its charts wide, the step the chart library picks for the window", () => {
    // sdn-3: a hand-kept copy of the chart's ladder drifted from it.
    expect(code).toContain(
      "function chartPrecisionForWindow(window: InBetween<Date>): XAxisPrecision { return XAxisUtil.getPrecision({ xAxisMin: window.startValue, xAxisMax: window.endValue, }); }",
    );
    expect(code).toContain(
      "function chartAlignedBucketSeconds(precision: XAxisPrecision): number { const stepSeconds: number | undefined = getChartGridStepSeconds(precision); if (stepSeconds === undefined) { return HOUR_SECONDS; } return Math.min(stepSeconds, HOUR_SECONDS); }",
    );
    expect(code).toContain(
      "const precision: XAxisPrecision = chartPrecisionForWindow(window);",
    );
    expect(code).toContain(
      "bucketSeconds: chartAlignedBucketSeconds(precision),",
    );
    expect(code).not.toContain("3 * 3600");
  });

  test("a reset hands back the page's own range, and the drawer follows the page again", () => {
    expect(code).toContain(
      "TimeRangeZoomUtil.isSameRange(next, latestPageTimeRange.current) ? null : next,",
    );
  });
});

describe("the drawer's hosts", () => {
  test.each([
    "Components/Topology/ServiceMapGraph.tsx",
    "Components/Topology/InfrastructureExplorer.tsx",
  ])(
    "%s hands the drawer the page's range, one drawer per call",
    (file: string) => {
      const code: string = readCode(file);
      const start: number = indexOfOrFail(code, "<EdgeDetailPanel");
      const drawer: string = code.slice(start, code.indexOf("/>", start));
      expect(drawer).toContain("key={");
      expect(drawer).toContain("timeRange={props.timeRange}");
    },
  );

  test("the Topology page does not zoom: its range drives the maps, not a time series", () => {
    /*
     * The maps read only the range's start ("Active in"), and changing the
     * range reloads the map, unmounting any open drawer. A page-wide zoom
     * would retime the maps from a drawer and close it; the drawer zooms
     * itself instead.
     */
    const code: string = readCode("Pages/Topology/TopologyPage.tsx");
    expect(code).not.toContain("TimeRangeZoomScope");
    expect(code).not.toContain("TimeRangeZoomProvider");
    expect(code).toContain(
      "<TelemetryTimeRangePicker value={timeRange} onChange={setTimeRange} />",
    );
  });
});
