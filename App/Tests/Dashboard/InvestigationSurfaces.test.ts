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
      // exemplar + region + time-ref-line handlers all stop propagation.
      expect(
        source.match(/stopChartEventPropagation\(\.\.\.args\)/g)?.length,
      ).toBe(3);
      // Clicks that clear a selection never also pin.
      expect(source).toContain("onValueChange?.(null); return;");
    }
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
