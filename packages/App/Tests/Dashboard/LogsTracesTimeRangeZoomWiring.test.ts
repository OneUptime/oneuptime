import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 wiring pins for the logs, traces, exceptions and security
 * events surfaces. App's jest runs in plain Node and cannot render React, so
 * what is pinned here is the wiring, read from the sources with comments
 * stripped and whitespace squashed (so a prettier re-wrap cannot fake a
 * failure). The behaviour behind every pin is driven in the Common RTL
 * suites:
 *
 *   Common/Tests/UI/Components/TelemetryViewer/UseViewerTimeRangeZoom.test.tsx
 *   Common/Tests/UI/Components/TelemetryViewer/TelemetryViewerZoomScope.test.tsx
 *   Common/Tests/UI/Components/LogsViewerAnalyticsZoom.test.tsx
 *   Common/Tests/UI/Components/LogsAnalyticsViewZoom.test.tsx
 *   Common/Tests/App/Dashboard/LogsExplorerTimeRangeZoom.test.tsx
 *   Common/Tests/App/Dashboard/TracesExplorerTimeRangeZoom.test.tsx
 *   Common/Tests/App/Dashboard/TracesAnalyticsViewZoom.test.tsx
 *   Common/Tests/App/Dashboard/LogsInsightsTimeRangeZoom.test.tsx
 *   Common/Tests/App/Dashboard/ExceptionOccurrenceTrendZoom.test.tsx
 *   Common/Tests/App/Dashboard/InvestigationDrawerZoom.test.tsx
 *   Common/Tests/App/Dashboard/TraceTimelineMinimapZoom.test.tsx
 */

const PACKAGES_ROOT: string = path.join(__dirname, "..", "..", "..");

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function read(relative: string): string {
  return stripComments(
    fs.readFileSync(path.join(PACKAGES_ROOT, relative), "utf8"),
  ).replace(/\s+/g, " ");
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const DASHBOARD: string = "App/FeatureSet/Dashboard/src/Components";

const TELEMETRY_VIEWER: string =
  "Common/UI/Components/TelemetryViewer/TelemetryViewer.tsx";
const LOGS_VIEWER: string = "Common/UI/Components/LogsViewer/LogsViewer.tsx";
const LOG_TIME_RANGE_PICKER: string =
  "Common/UI/Components/LogsViewer/components/LogTimeRangePicker.tsx";
const LOGS_ANALYTICS_VIEW: string =
  "Common/UI/Components/LogsViewer/components/LogsAnalyticsView.tsx";
const TRACES_ANALYTICS_VIEW: string = `${DASHBOARD}/Traces/TracesAnalyticsView.tsx`;
const TRACES_VIEWER: string = `${DASHBOARD}/Traces/TracesViewer.tsx`;
const LOGS_DASHBOARD: string = `${DASHBOARD}/Logs/LogsDashboard.tsx`;
const ERROR_PATTERN_DETAIL: string = `${DASHBOARD}/Logs/ErrorPatternDetail.tsx`;
const EXCEPTION_TREND: string = `${DASHBOARD}/Exceptions/ExceptionOccurrenceTrend.tsx`;
const INVESTIGATION_DRAWER: string = `${DASHBOARD}/Telemetry/InvestigationDrawer.tsx`;
const TRACE_MINIMAP: string = `${DASHBOARD}/Traces/TraceDetail/TraceTimelineMinimap.tsx`;

describe("the explorer shells offer one zoom to everything they render", () => {
  test.each([
    [
      "the telemetry shell (traces, exceptions, security events)",
      TELEMETRY_VIEWER,
    ],
    ["the logs viewer", LOGS_VIEWER],
  ])(
    "%s keeps its zoom with useViewerTimeRangeZoom over its host's window",
    (_name: string, file: string) => {
      const source: string = read(file);

      expect(source).toContain(
        "useViewerTimeRangeZoom({ timeRange: props.timeRange, onTimeRangeSelect: props.onHistogramTimeRangeSelect, onTimeRangeChange: props.onTimeRangeChange, })",
      );
      /*
       * The older histogram-only memory kept the pre-zoom window past a saved
       * view; the shells must not drift back to it.
       */
      expect(source).not.toContain("useHistogramZoom(");
    },
  );

  test.each([
    ["the telemetry shell", TELEMETRY_VIEWER],
    ["the logs viewer", LOGS_VIEWER],
  ])(
    "%s wraps its whole tree in the provider, and only when its host can zoom",
    (_name: string, file: string) => {
      const source: string = read(file);

      expect(source).toContain(
        "if (!viewerZoom.zoom) { return viewer; } return ( <TimeRangeZoomProvider zoom={viewerZoom.zoom}> {viewer} </TimeRangeZoomProvider> );",
      );
    },
  );

  test.each([
    ["the telemetry shell", TELEMETRY_VIEWER],
    ["the logs viewer", LOGS_VIEWER],
  ])(
    "%s hands the histogram the shared zoom's handlers",
    (_name: string, file: string) => {
      const source: string = read(file);

      expect(source).toContain(
        "onTimeRangeSelect={viewerZoom.onTimeRangeSelect} onZoomOut={viewerZoom.onZoomOut}",
      );
    },
  );

  test("the telemetry picker ends the zoom when a range is picked", () => {
    expect(read(TELEMETRY_VIEWER)).toContain(
      "onChange={viewerZoom.onTimeRangeChange || props.onTimeRangeChange}",
    );
  });

  test("the logs toolbar's picker ends the zoom when a range is picked", () => {
    expect(read(LOGS_VIEWER)).toContain(
      "onTimeRangeChange: viewerZoom.onTimeRangeChange,",
    );
  });

  test("the logs picker carries the keyboard way back out, like the telemetry one", () => {
    const source: string = read(LOG_TIME_RANGE_PICKER);

    expect(source).toContain(
      'import ResetTimeRangeZoomButton from "../../Charts/TimeRangeZoom/ResetTimeRangeZoomButton";',
    );
    expect(source).toContain("<ResetTimeRangeZoomButton />");
  });
});

describe("the Analytics timeseries are time charts over the explorer's window", () => {
  test.each([
    ["logs", 2, LOGS_ANALYTICS_VIEW],
    ["traces", 3, TRACES_ANALYTICS_VIEW],
  ])(
    "the %s view resolves its zoom for the timeseries only, and drives all %s of its charts with it",
    (_name: string, chartCount: number, file: string) => {
      const source: string = read(file);

      expect(source).toContain(
        'resolveChartTimeRangeZoom({ onTimeRangeSelect: props.onTimeRangeSelect, onTimeRangeReset: props.onTimeRangeReset, isTimeAxis: chartType === "timeseries", pageZoom: pageZoom, })',
      );
      expect(source).toContain(
        "useHistogramRangeSelection({ onTimeRangeSelect: zoomHandlers.onTimeRangeSelect, onZoomOut: zoomHandlers.onTimeRangeReset, bucketIntervalMs: timeseriesBucketMs, })",
      );
      expect(count(source, "onMouseDown={selection.onMouseDown}")).toBe(
        chartCount,
      );
      expect(count(source, "onMouseUp={selection.onMouseUp}")).toBe(chartCount);
      expect(source).toContain("onDoubleClick={selection.onDoubleClick}");
    },
  );

  test.each([
    ["logs", LOGS_ANALYTICS_VIEW],
    ["traces", TRACES_ANALYTICS_VIEW],
  ])(
    "the %s view keeps the bucket width with the rows it describes",
    (_name: string, file: string) => {
      const source: string = read(file);

      expect(source).toContain(
        "setTimeseriesBucketMs(bucketSizeInMinutes * 60 * 1000);",
      );
      // A failed fetch leaves no width behind for the next window's rows.
      expect(source).toContain("setTimeseriesBucketMs(undefined);");
    },
  );

  test("the traces Analytics view renders inside the telemetry shell, so it is inside its zoom", () => {
    const source: string = read(TRACES_VIEWER);

    expect(source).toContain(
      'mainContentOverride={ viewMode === "analytics" ? ( <TracesAnalyticsView',
    );
    expect(source).toContain(
      "onHistogramTimeRangeSelect={handleHistogramTimeRangeSelect}",
    );
  });
});

describe("Logs > Insights zooms as one page", () => {
  test("the page wraps every state in one zoom scope over its own range", () => {
    const source: string = read(LOGS_DASHBOARD);

    expect(source).toContain(
      'import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";',
    );
    expect(source).toContain(
      "<TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={handleZoomTimeRangeChange} > {headerBar} {content} {patternDrawer} </TimeRangeZoomScope>",
    );
    // Loading, error, empty and the full page all render through it.
    expect(count(source, "return renderPage(")).toBe(4);
    // The header (and the picker in it) is only ever rendered inside it.
    expect(count(source, "{headerBar}")).toBe(1);
    expect(count(source, "<ErrorPatternDetail")).toBe(1);
  });

  test("a zoom sets the page's own range, and says it was a zoom", () => {
    expect(read(LOGS_DASHBOARD)).toContain(
      "(next: RangeStartAndEndDateTime): void => { isZoomChangeRef.current = true; setTimeRange(next); }",
    );
  });

  test("the picker in the header still sets the range directly (a new starting point)", () => {
    expect(read(LOGS_DASHBOARD)).toContain(
      "<TelemetryTimeRangePicker value={timeRange} onChange={(value: RangeStartAndEndDateTime): void => { setTimeRange(value); }} />",
    );
  });

  test("the drawer stays open through a zoom and closes on any other scope change", () => {
    expect(read(LOGS_DASHBOARD)).toContain(
      "useEffect(() => { if (isZoomChangeRef.current) { isZoomChangeRef.current = false; return; } setSelectedPattern(null); }, [scope]);",
    );
  });

  test("the drawer's timeline takes the page's zoom", () => {
    const source: string = read(ERROR_PATTERN_DETAIL);

    expect(source).toContain(
      "useHistogramRangeSelection({ onTimeRangeSelect: pageZoom?.onTimeRangeSelect, onZoomOut: pageZoom?.onTimeRangeReset, bucketIntervalMs: bucketIntervalMs, })",
    );
    expect(source).toContain(
      "<Timeline points={correlation.timeline} bucketSizeInMinutes={correlation.bucketSizeInMinutes} window={patternWindow} />",
    );
    expect(source).toContain("<TimeRangeZoomHint");
  });
});

describe("charts with a window of their own zoom only themselves", () => {
  test("the exception Occurrence Trend keeps its own zoom over its preset", () => {
    const source: string = read(EXCEPTION_TREND);

    expect(source).toContain(
      "useTimeRangeZoom({ timeRange: chartRange, onTimeRangeChange: applyChartRange, })",
    );
    expect(source).toContain("<TimeRangeZoomProvider zoom={zoom}>");
    expect(source).toContain("<ResetTimeRangeZoomButton />");
    expect(source).toContain('dataKey="time"');
    expect(source).toContain("onMouseDown={selection.onMouseDown}");
    expect(source).toContain("onDoubleClick={selection.onDoubleClick}");
    // A preset pick is a new starting point.
    expect(source).toContain(
      "onChange={(key: ExceptionTrendWindowKey): void => { setZoomWindow(null); setWindowKey(key); }}",
    );
  });

  test("the investigation drawer offers its own zoom to everything in it", () => {
    const source: string = read(INVESTIGATION_DRAWER);

    expect(source).toContain("<TimeRangeZoomProvider zoom={drawerZoom}>");
    expect(source).toContain("<ResetTimeRangeZoomButton />");
    expect(source).toContain(
      "onTimeRangeSelect={zoomToTimeRange} onZoomOut={isZoomed ? resetZoom : undefined}",
    );
    expect(source).toContain("bucketIntervalMs={logBucketIntervalMs}");
    expect(source).toContain("bucketSizeInMinutes: bucketSizeInMinutes,");
  });

  test("the drawer's metric card is controlled by the drawer's window", () => {
    const source: string = read(INVESTIGATION_DRAWER);

    expect(source).toContain(
      "timeRange={cardTimeRange} onTimeRangeChange={pickTimeRange}",
    );
    // An uncontrolled card zoomed alone, leaving the rest of the drawer behind.
    expect(source).not.toContain("defaultTimeRange=");
  });

  test("the trace minimap resets on a double-click, and holds a click for it", () => {
    const source: string = read(TRACE_MINIMAP);

    expect(source).toContain("onDoubleClick={() => {");
    expect(source).toContain("props.onViewportChange(FULL_VIEWPORT);");
    expect(source).toContain("}, DOUBLE_CLICK_DISAMBIGUATION_MS);");
  });
});
