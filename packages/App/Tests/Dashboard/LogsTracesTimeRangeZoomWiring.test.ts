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
 *   Common/Tests/App/Dashboard/RechartsHostsPlotCursor.test.tsx
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
const LOGS_HISTOGRAM: string =
  "Common/UI/Components/LogsViewer/components/LogsHistogram.tsx";
const TELEMETRY_HISTOGRAM: string =
  "Common/UI/Components/TelemetryViewer/components/TelemetryHistogram.tsx";
const TRACES_ANALYTICS_VIEW: string = `${DASHBOARD}/Traces/TracesAnalyticsView.tsx`;
const TRACES_VIEWER: string = `${DASHBOARD}/Traces/TracesViewer.tsx`;
const LOGS_DASHBOARD: string = `${DASHBOARD}/Logs/LogsDashboard.tsx`;
const ERROR_PATTERN_DETAIL: string = `${DASHBOARD}/Logs/ErrorPatternDetail.tsx`;
const EXCEPTION_TREND: string = `${DASHBOARD}/Exceptions/ExceptionOccurrenceTrend.tsx`;
const EXCEPTION_OCCURRENCES: string = `${DASHBOARD}/Exceptions/ExceptionOccurrences.tsx`;
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
      "const onPageTimeRangeSelect: | ((startTime: Date, endTime: Date) => void) | undefined = pageZoom?.onTimeRangeSelect;",
    );
    expect(source).toContain(
      "useHistogramRangeSelection({ onTimeRangeSelect: onPageTimeRangeSelect ? zoomToDraggedBars : undefined, onZoomOut: pageZoom?.onTimeRangeReset, })",
    );
    expect(source).toContain(
      "<Timeline points={correlation.timeline} bucketSizeInMinutes={correlation.bucketSizeInMinutes} window={patternWindow} />",
    );
    expect(source).toContain("<TimeRangeZoomHint");
  });

  test("the drawer's timeline zooms on a drag only: a click on a bar retimes nothing", () => {
    const source: string = read(ERROR_PATTERN_DETAIL);

    /*
     * The bucket width is what makes the shared hook zoom on a click, so it
     * is withheld from the hook - and added back to a real drag's end, or a
     * drag would drop its last bar.
     */
    expect(selectionHookCall(source)).not.toContain("bucketIntervalMs");
    expect(source).toContain(
      "onPageTimeRangeSelect?.( firstBucketStart, new Date(lastBucketStart.getTime() + (bucketIntervalMs || 0)), );",
    );
  });

  test("the drawer drops a correlation for a window the page has left", () => {
    const source: string = read(ERROR_PATTERN_DETAIL);

    /*
     * The drawer stays open through a zoom and its reset, each of which
     * asks for the correlation again: only the latest request may show its
     * answer or its error, or take the loader down.
     */
    expect(source).toContain(
      "const requestSequence: number = ++requestSequenceRef.current;",
    );
    expect(source).toContain(
      "if (isStale()) { return; } setCorrelation(result);",
    );
    expect(source).toContain(
      "} catch (err) { if (isStale()) { return; } setError(API.getFriendlyMessage(err as Error));",
    );
    expect(source).toContain(
      "} finally { if (!isStale()) { setIsLoading(false); } }",
    );
  });

  test("the drawer carries its own Reset zoom beside its timeline's hint", () => {
    /*
     * The wide drawer covers the page's picker and the Reset zoom beside
     * it, and a zoom made from the drawer keeps the drawer open.
     */
    expect(read(ERROR_PATTERN_DETAIL)).toContain(
      "<TimeRangeZoomHint /> <ResetTimeRangeZoomButton /> </div>",
    );
  });
});

// The options object of the one useHistogramRangeSelection call in a source.
function selectionHookCall(source: string): string {
  const start: number = source.indexOf("useHistogramRangeSelection({");
  expect(start).toBeGreaterThan(-1);
  expect(source.indexOf("useHistogramRangeSelection({", start + 1)).toBe(-1);
  return source.slice(start, source.indexOf("})", start) + 2);
}

describe("the explorers' charts and the drawer's timeline say the same thing", () => {
  test.each([
    ["the logs volume histogram", LOGS_HISTOGRAM],
    ["the telemetry volume histogram", TELEMETRY_HISTOGRAM],
  ])(
    "%s offers the click, and names the way back as a reset",
    (_name: string, file: string) => {
      const source: string = read(file);

      expect(source).toContain(
        'selection.canClickToZoom ? "Click or drag to zoom" : "Drag to zoom"',
      );
      expect(source).toContain("Double-click to reset");
      expect(source.toLowerCase()).not.toContain("zoom out");
    },
  );

  test.each([
    ["logs", LOGS_ANALYTICS_VIEW],
    ["traces", TRACES_ANALYTICS_VIEW],
  ])(
    "the %s Analytics timeseries offers the click, and names the way back as a reset",
    (_name: string, file: string) => {
      const source: string = read(file);

      expect(source).toContain(
        'selection.canClickToZoom ? "Click or drag to zoom" : "Drag to zoom"',
      );
      expect(source).toContain(
        'zoomHandlers.onTimeRangeReset ? " · double-click to reset" : ""',
      );
      expect(source.toLowerCase()).not.toContain("zoom out");
    },
  );
});

describe("the crosshair is set on the recharts root, only where a drag zooms", () => {
  test.each([
    ["the logs volume histogram", LOGS_HISTOGRAM, 1, "props.onTimeRangeSelect"],
    [
      "the telemetry volume histogram",
      TELEMETRY_HISTOGRAM,
      1,
      "props.onTimeRangeSelect",
    ],
    ["the logs Analytics timeseries", LOGS_ANALYTICS_VIEW, 2, "canZoom"],
    ["the traces Analytics timeseries", TRACES_ANALYTICS_VIEW, 3, "canZoom"],
    ["the error drawer's timeline", ERROR_PATTERN_DETAIL, 1, "pageZoom"],
  ])(
    "%s spreads it onto every one of its chart roots",
    (_name: string, file: string, roots: number, condition: string) => {
      const source: string = read(file);

      /*
       * recharts' .recharts-wrapper carries an inline `cursor: default`, so
       * only a style on the chart root itself shows over the plot. Spread,
       * so there is no style at all (not `cursor: undefined`) otherwise.
       */
      expect(source).toMatch(
        new RegExp(
          `const chartRootCursorProps: \\{ style\\?: React\\.CSSProperties \\} = ${condition.replace(
            /\./g,
            "\\.",
          )} \\? \\{ style: \\{ cursor: "crosshair" \\} \\} : \\{\\};`,
        ),
      );
      expect(count(source, "{...chartRootCursorProps}")).toBe(roots);
      expect(count(source, "onMouseDown={selection.onMouseDown}")).toBe(roots);
    },
  );

  test("the exception trend always zooms, so its chart root always has it", () => {
    expect(read(EXCEPTION_TREND)).toContain(
      'onMouseUp={selection.onMouseUp} style={{ cursor: "crosshair" }} >',
    );
  });
});

describe("Logs Analytics drops superseded responses", () => {
  test("a request sequence guards every write, the error path and the loader", () => {
    const source: string = read(LOGS_ANALYTICS_VIEW);

    expect(source).toContain(
      "const requestSequence: number = ++requestSequenceRef.current;",
    );
    // Before any setter: a stale group-by must not relabel newer rows.
    expect(source).toContain(
      'if (isStale()) { return; } const data: unknown = response.data["data"] || []; setResultGroupByFields(requestGroupBy);',
    );
    expect(source).toContain("} catch { if (isStale()) { return; }");
    expect(source).toContain(
      "} finally { if (!isStale()) { setIsLoading(false); } }",
    );
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

  test("the exception Occurrence Trend zooms on a drag only: a click on a bar is not a zoom", () => {
    const source: string = read(EXCEPTION_TREND);

    // Without the bucket width the shared hook makes a single bar no window.
    expect(selectionHookCall(source)).toBe(
      "useHistogramRangeSelection({ onTimeRangeSelect: zoomToDraggedBars, onZoomOut: zoom.isZoomed ? zoom.resetZoom : undefined, })",
    );
    // A real drag gets the width back, so it keeps its last bar.
    expect(source).toContain(
      "zoom.zoomToTimeRange( firstBucketStart, new Date(lastBucketStart.getTime() + (bucketIntervalMs || 0)), );",
    );
  });

  test("the exception Occurrences page keeps its span list mounted across a view switch", () => {
    const source: string = read(EXCEPTION_OCCURRENCES);

    expect(source).toContain(
      '<div data-testid="exception-occurrences-spans" hidden={view !== ExceptionOccurrencesView.Spans} > <TracesViewer',
    );
    expect(count(source, "<TracesViewer")).toBe(1);
    // Only the details table comes and goes with the view.
    expect(source).toContain(
      "{view === ExceptionOccurrencesView.Details ? ( <OccouranceTable",
    );
    expect(source).not.toContain("view === ExceptionOccurrencesView.Spans ? (");
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
