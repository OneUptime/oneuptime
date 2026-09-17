import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Wiring pins for PR B's investigation surfaces — App's node test env
 * cannot render React, so the load-bearing mounting is pinned as
 * whitespace-squashed source strings (the MetricsCrossSignalPivot.test
 * pattern). Behavior itself is covered by the RTL suites in
 * Common/Tests/App/Dashboard.
 */

function readSquashed(relative: string): string {
  return fs
    .readFileSync(path.join(__dirname, "../../..", relative), "utf8")
    .replace(/\s+/g, " ");
}

describe("investigation drawer wiring", () => {
  test("MetricCharts hosts the drawer, the bucket inspector, and the series-menu opener", () => {
    const source: string = readSquashed(
      "App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts.tsx",
    );

    expect(source).toContain("<InvestigationDrawer");
    expect(source).toContain("openBucketInspector");
    expect(source).toContain("Investigate this moment");
    expect(source).toContain('text="Investigate in panel"');
    // Bucket clicks are gated the same way the series menu is.
    expect(source).toContain("onBucketClick: showSeriesActions");
    // The inspector orders values highest-first, like the tooltip.
    expect(source).toContain("b.value - a.value");
  });

  test("the widget zoom bar and the explorer toolbar both open the drawer", () => {
    const widget: string = readSquashed(
      "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent.tsx",
    );
    expect(widget).toContain("<InvestigationDrawer");
    expect(widget).toContain("setInvestigationWindow(zoomWindow)");
    /*
     * The zoom pill only renders in the widget's standalone fallback now
     * that a drag retimes the whole dashboard (#3530), so the entry point a
     * real board actually reaches is the header button — on whatever
     * window the widget is charting.
     */
    expect(widget).toContain(
      "setInvestigationWindow(effectiveStartAndEndDate)",
    );
    expect(widget).toContain(
      'aria-label="Investigate this time window in a side panel"',
    );

    const explorer: string = readSquashed(
      "App/FeatureSet/Dashboard/src/Components/Metrics/MetricExplorer.tsx",
    );
    expect(explorer).toContain("<InvestigationDrawer");
    expect(explorer).toContain("setIsInvestigationOpen(true)");
  });

  test("annotation clicks never leak into bucket pinning", () => {
    for (const lib of [
      "Common/UI/Components/Charts/ChartLibrary/LineChart/LineChart.tsx",
      "Common/UI/Components/Charts/ChartLibrary/AreaChart/AreaChart.tsx",
    ]) {
      const source: string = readSquashed(lib);
      /*
       * Exemplars still stop propagation from the chart body. Event
       * markers and regions moved into the shared annotation layer, which
       * stops both the press and the click itself — the DOM-level proof
       * lives in Common/Tests/UI/Components/Charts/ChartAnnotationRail.test.tsx.
       */
      expect(
        source.match(/stopChartEventPropagation\(\.\.\.args\)/g)?.length,
      ).toBe(1);
      // Clicks that clear a selection never also pin.
      expect(source).toContain("onValueChange?.(null); return;");
      // The annotation layer is fed the same drag-settling guard.
      expect(source).toContain("isClickSuppressed");
    }

    /*
     * The layer is the one place all three charts get this from, so its
     * guards are asserted once, here, rather than three times over.
     */
    const layer: string = readSquashed(
      "Common/UI/Components/Charts/ChartLibrary/Annotations/ChartAnnotationLayer.tsx",
    );
    expect(layer).toContain("onMouseDown={stopPress}");
    expect(layer).toContain("if (!canClick()) { return; }");
  });
});

describe("compare-to-previous wiring", () => {
  test("the explorer toggle persists and feeds MetricView", () => {
    const explorer: string = readSquashed(
      "App/FeatureSet/Dashboard/src/Components/Metrics/MetricExplorer.tsx",
    );
    expect(explorer).toContain("metric-explorer-compare-previous");
    expect(explorer).toContain("compareWithPreviousPeriod={showCompare}");
  });

  test("MetricView's fetch snapshot includes the compare flag — toggling refetches", () => {
    const view: string = readSquashed(
      "App/FeatureSet/Dashboard/src/Components/Metrics/MetricView.tsx",
    );
    expect(view).toContain(
      "compareWithPreviousPeriod: props.compareWithPreviousPeriod === true",
    );
    // The shifted fetch is best-effort.
    expect(view).toContain("Ghosts are best-effort");
  });

  test("MetricCharts keeps ghosts out of Top-N, chips, and the inspector", () => {
    const charts: string = readSquashed(
      "App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts.tsx",
    );
    // Merge happens AFTER presentation (post-Top-N/chips)…
    expect(charts).toContain("PREVIOUS_PERIOD_SERIES_SUFFIX");
    expect(charts).toContain("let renderSeries: Array<SeriesPoint>");
    // …and the ghost x-values are shifted onto the current window's grid.
    expect(charts).toContain("point.x.getTime() + props.compareOffsetMs!");
  });
});

describe("service overview signal wiring", () => {
  test("the overview adds log + exception signal charts from the histogram endpoints", () => {
    const util: string = readSquashed(
      "App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics.ts",
    );
    expect(util).toContain("fetchLogAndExceptionSignals");
    expect(util).toContain("/telemetry/logs/histogram");
    expect(util).toContain("/telemetry/exceptions/histogram");

    const overview: string = readSquashed(
      "App/FeatureSet/Dashboard/src/Pages/Service/View/Index.tsx",
    );
    expect(overview).toContain("fetchLogAndExceptionSignals");
    expect(overview).toContain('title="Logs"');
    expect(overview).toContain('title="Exceptions"');
  });
});
