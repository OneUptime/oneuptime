import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 wiring pins for the Metrics area: every chart and histogram
 * that plots over time lets a drag zoom the page it is on, and a
 * double-click put the page back.
 *
 * App's jest runs in plain Node and cannot render React, so the wiring is
 * pinned here as comment-stripped, whitespace-squashed source (the
 * DashboardTimeRangeZoomWiring / ExplorerTimeRangePickerWiring pattern).
 * The behaviour behind it is rendered for real in Common's suites:
 *
 *   Common/Tests/App/Dashboard/MetricExplorerTimeRangeZoom.test.tsx
 *   Common/Tests/App/Dashboard/MetricRowSparklineTimeRangeZoom.test.tsx
 *   Common/Tests/App/Dashboard/MetricViewTimeRangeZoom.test.tsx
 */

const PACKAGES_DIR: string = path.join(__dirname, "../../..");

const METRICS_DIR: string = "App/FeatureSet/Dashboard/src/Components/Metrics";

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readCode(relative: string): string {
  return stripComments(
    fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8"),
  ).replace(/\s+/g, " ");
}

const EXPLORER: string = readCode(`${METRICS_DIR}/MetricExplorer.tsx`);

const SCOPE_OPEN: string =
  "<TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={handleTimeRangePicked} >";
const SCOPE_CLOSE: string = "</TimeRangeZoomScope>";

// The JSX of one self-closing element, from its tag to its "/>".
function elementSource(code: string, tag: string): string {
  const start: number = code.indexOf(`<${tag} `);
  expect(start).toBeGreaterThan(-1);
  const end: number = code.indexOf("/>", start);
  expect(end).toBeGreaterThan(start);
  return code.slice(start, end + 2);
}

describe("the metric explorer zooms as one page", () => {
  test("its whole tree sits in one TimeRangeZoomScope over the explorer's own range and handler", () => {
    expect(EXPLORER).toContain(
      'import { TimeRangeZoomProvider, TimeRangeZoomScope, } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";',
    );

    // Opened as the very thing the component returns, closed at its end.
    expect(EXPLORER).toContain(`return ( ${SCOPE_OPEN} <div>`);
    expect(EXPLORER).toContain(`</div> ${SCOPE_CLOSE} ); };`);
    expect(EXPLORER.split("<TimeRangeZoomScope").length - 1).toBe(1);
  });

  test("the range the scope zooms is derived from metricViewData, not a second copy of it", () => {
    /*
     * The window lives in metricViewData (and the URL and saved views that
     * mirror it). A parallel range state would drift from it, and the zoom
     * would then compare against a window the charts are not showing.
     */
    expect(EXPLORER).toContain(
      "const timeRange: RangeStartAndEndDateTime = MetricViewTimeRange.fromData(metricViewData);",
    );
    expect(EXPLORER).not.toContain("useState<RangeStartAndEndDateTime>");
  });

  test("the picker is inside the scope, on the same range and handler, so it can offer Reset zoom", () => {
    const open: number = EXPLORER.indexOf(SCOPE_OPEN);
    const close: number = EXPLORER.indexOf(SCOPE_CLOSE);
    const picker: number = EXPLORER.indexOf(
      "<TelemetryTimeRangePicker value={timeRange} onChange={handleTimeRangePicked} />",
    );

    expect(open).toBeGreaterThan(-1);
    expect(picker).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(picker);
  });

  test("the picker's handler writes over the latest state, since a zoom and a reset go through it too", () => {
    const handlerStart: number = EXPLORER.indexOf(
      "const handleTimeRangePicked: (value: RangeStartAndEndDateTime) => void = useCallback(",
    );
    expect(handlerStart).toBeGreaterThan(-1);

    const handler: string = EXPLORER.slice(
      handlerStart,
      EXPLORER.indexOf("}, []);", handlerStart),
    );
    expect(
      handler.match(
        /setMetricViewData\(\(previous: MetricViewData\): MetricViewData => \{/g,
      )?.length,
    ).toBe(2);
    // A preset keeps rolling: it is re-resolved against now, token kept.
    expect(handler).toContain("resolveRangeToken(rangeToken)");
    expect(handler).toContain("rangeToken: rangeToken,");
    // A custom window (a zoom) is pinned: no token.
    expect(handler).toContain("rangeToken: undefined,");
  });

  test("MetricView takes the explorer's zoom: inside the scope, with no zoom of its own", () => {
    const open: number = EXPLORER.indexOf(SCOPE_OPEN);
    const close: number = EXPLORER.indexOf(SCOPE_CLOSE);
    const view: number = EXPLORER.indexOf("<MetricView ");
    expect(view).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(view);

    /*
     * Any of these would make MetricView zoom something other than the
     * explorer (its own handlers, a display-only window, or nothing), and
     * the picker's Reset zoom would stop meaning the charts' zoom.
     */
    const metricView: string = elementSource(EXPLORER, "MetricView");
    expect(metricView).toContain("data={metricViewData}");
    expect(metricView).not.toContain("onTimeRangeSelect=");
    expect(metricView).not.toContain("onTimeRangeReset=");
    expect(metricView).not.toContain("disableChartZoom");
    expect(metricView).not.toContain("localChartZoom");
  });

  test("the investigation drawer is kept out of the explorer's zoom", () => {
    /*
     * The drawer keeps windows of its own. Under the explorer's zoom, the
     * pickers in its traces and exceptions tabs would offer the explorer's
     * "Reset zoom", which retimes the explorer behind the drawer and
     * nothing in it.
     */
    expect(EXPLORER).toContain(
      "<TimeRangeZoomProvider zoom={null}> <InvestigationDrawer",
    );
    expect(EXPLORER.split("<TimeRangeZoomProvider").length - 1).toBe(1);
    expect(EXPLORER.split("<InvestigationDrawer").length - 1).toBe(1);
  });

  test("the window everything else follows is still metricViewData", () => {
    // Event markers, the drawer, Copy Link and Add to dashboard.
    expect(EXPLORER).toContain("window: metricViewData.startAndEndDate,");
    expect(EXPLORER).toContain("window={metricViewData.startAndEndDate}");
    expect(EXPLORER).toContain(
      "textToBeCopied={ExplorerLink.buildExplorerUrl( metricViewData, ).toString()}",
    );
    expect(EXPLORER).toContain(
      "<AddToDashboardModal metricViewData={metricViewData}",
    );
    // A pinned (zoomed) window survives auto-refresh; a preset re-anchors.
    expect(EXPLORER).toContain(
      "if (!previous.rangeToken) { return previous; } return { ...previous, startAndEndDate: resolveRangeToken(previous.rangeToken), };",
    );
  });

  test("the Metric Explorer page renders the explorer that owns the scope", () => {
    const page: string = readCode(
      "App/FeatureSet/Dashboard/src/Pages/Metrics/View/Index.tsx",
    );
    expect(page).toContain(
      'import MetricExplorer from "../../../Components/Metrics/MetricExplorer";',
    );
    expect(page).toContain("<MetricExplorer />");
  });
});

describe("what the Metrics area leaves out of the zoom, on purpose", () => {
  test("metric list rows: the sparkline sits inside the row's own button and has no drag", () => {
    /*
     * The list's only time charts are 160x40 row thumbnails inside a
     * button that opens the metric in the explorer, where the zoom lives.
     * A drag there would fight the row's click. See
     * MetricRowSparklineTimeRangeZoom.test.tsx for the rendered proof.
     */
    const viewer: string = readCode(`${METRICS_DIR}/MetricsViewer.tsx`);
    expect(viewer).toContain("showHistogram={false}");
    expect(viewer).toContain("<MetricRow");
    expect(viewer).not.toContain("TimeRangeZoom");

    const row: string = readCode(`${METRICS_DIR}/MetricRow.tsx`);
    expect(row).toContain("<MetricSparkline");
    expect(row).toContain("onClick={props.onClick}");
    expect(row).not.toContain("TimeRangeZoom");

    const sparkline: string = readCode(`${METRICS_DIR}/MetricSparkline.tsx`);
    expect(sparkline).toContain("<SparkAreaChart");
    expect(sparkline).not.toContain("TimeRangeZoom");
    expect(sparkline).not.toContain("onTimeRangeSelect");
    expect(sparkline).not.toContain("onDoubleClick");
  });

  test("Metrics insights has no time-series chart to zoom", () => {
    /*
     * Its bars are shares of a count (metric categories, each service's
     * metric count), not values over time. A chart plotted over time added
     * here must join the page's range with a TimeRangeZoomScope.
     */
    const insights: string = readCode(`${METRICS_DIR}/MetricsDashboard.tsx`);
    expect(insights).not.toMatch(/from "Common\/UI\/Components\/Charts\//);
    expect(insights).not.toContain("ChartGroup");
    expect(insights).not.toContain("MetricView");
    expect(insights).not.toContain("TimeRangeZoomScope");
  });
});
