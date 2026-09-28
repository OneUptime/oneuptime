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
      "<ChartGroup charts={buildCharts()} />",
    );
    const close: number = indexOfOrFail(code, "</TimeRangeZoomProvider>");
    expect(charts).toBeGreaterThan(provider);
    expect(charts).toBeLessThan(close);
    // And the charts take it: none opts out or brings its own.
    expect(code).not.toContain("disableTimeRangeZoom");
    expect(code).not.toContain("onTimeRangeSelect:");
  });

  test("with no picker of its own, it offers Reset zoom while zoomed", () => {
    expect(code).toContain(
      '{historyAvailable && zoom.isZoomed ? ( <div className="-mb-4 flex justify-end" data-testid="edge-history-zoom" > <ResetTimeRangeZoomButton /> </div>',
    );
    expect(code).toContain(
      "onDoubleClick={zoom.isZoomed ? zoom.resetZoom : undefined}",
    );
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
