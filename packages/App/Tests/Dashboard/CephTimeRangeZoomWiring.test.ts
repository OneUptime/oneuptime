import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 wiring pins for the Ceph cluster pages: drag across any chart
 * to zoom, double-click any chart to go back. App's node test environment
 * cannot render React, so the load-bearing wiring is pinned here as
 * comment-stripped, whitespace-squashed source; what it DOES is rendered
 * and exercised in Common/Tests/App/Dashboard/CephTimeRangeZoom.test.tsx.
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

function count(code: string, needle: string): number {
  return code.split(needle).length - 1;
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

const SCOPE_IMPORT: string =
  'import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";';

describe("Ceph cluster Overview", () => {
  const code: string = readCode("Pages/Ceph/View/Index.tsx");

  test("the page's tree is a zoom scope over the golden charts' range and its setter", () => {
    expect(code).toContain(SCOPE_IMPORT);
    const open: number = scopeOpening(
      code,
      "chartTimeRange",
      "handleChartTimeRangeChange",
    );
    expect(code.slice(open - "return ( ".length, open)).toBe("return ( ");

    const close: number = indexOfOrFail(code, "</TimeRangeZoomScope>");
    const charts: number = indexOfOrFail(code, "{renderGoldenCharts()}");
    expect(charts).toBeGreaterThan(open);
    expect(charts).toBeLessThan(close);
  });

  test("the Golden Signals card's range is the page's, so its charts zoom the page", () => {
    expect(code).toContain(
      '<EmbeddedMetricCard title="Golden Signals" description="Capacity, client I/O, and OSD latency for this cluster." queryConfigs={[capacityQuery, latencyQuery, commitLatencyQuery]} timeRange={chartTimeRange} onTimeRangeChange={handleChartTimeRangeChange} startAndEndDate={chartDateRange} >',
    );
  });

  test("both rate charts are drawn over the page's resolved window", () => {
    expect(count(code, "<CephRateChart")).toBe(2);
    expect(
      count(
        code,
        "startDate={chartDateRange.startValue} endDate={chartDateRange.endValue}",
      ),
    ).toBe(2);
  });

  test("a zoom is a pinned range the auto-refresh re-resolves (and so leaves) as is", () => {
    const fetchAll: string = code.slice(
      indexOfOrFail(code, "const fetchAll:"),
      indexOfOrFail(code, "useEffect(() => { fetchAll(true)"),
    );
    expect(fetchAll).toContain(
      "setChartDateRange( RangeStartAndEndDateTimeUtil.getStartAndEndDate(chartTimeRange), );",
    );
  });
});

describe("Ceph Insights", () => {
  const code: string = readCode("Pages/Ceph/View/Insights.tsx");

  test("the page's tree is a zoom scope over its one range and its setter", () => {
    expect(code).toContain(SCOPE_IMPORT);
    const open: number = scopeOpening(
      code,
      "timeRange",
      "handleTimeRangeChange",
    );
    expect(code.slice(open - "return ( ".length, open)).toBe("return ( ");
  });

  test("all four cards are inside the scope, each on the page's range", () => {
    const open: number = scopeOpening(
      code,
      "timeRange",
      "handleTimeRangeChange",
    );
    const close: number = indexOfOrFail(code, "</TimeRangeZoomScope>");
    const scoped: string = code.slice(open, close);

    expect(count(code, "<EmbeddedMetricCard")).toBe(4);
    expect(count(scoped, "<EmbeddedMetricCard")).toBe(4);
    expect(
      count(
        scoped,
        "timeRange={timeRange} onTimeRangeChange={handleTimeRangeChange} startAndEndDate={startAndEndDate}",
      ),
    ).toBe(4);
  });

  test("the Client I/O rate charts are drawn over the page's resolved window", () => {
    expect(count(code, "<CephRateChart")).toBe(2);
    expect(
      count(
        code,
        "startDate={startAndEndDate.startValue} endDate={startAndEndDate.endValue}",
      ),
    ).toBe(2);
  });
});

describe("Ceph pool and OSD detail Metrics tabs", () => {
  test("the pool's rate charts ride the tab card's own window, and so its zoom", () => {
    const code: string = readCode("Pages/Ceph/View/PoolDetail.tsx");

    const tab: number = indexOfOrFail(
      code,
      "<ResourceMetricsTab queryConfigs={queryConfigs} renderExtraCharts={(dateRange: InBetween<Date>): ReactElement => {",
    );
    expect(count(code.slice(tab), "<CephRateChart")).toBe(2);
    expect(
      count(
        code,
        "startDate={dateRange.startValue} endDate={dateRange.endValue}",
      ),
    ).toBe(2);
  });

  test("the OSD's charts are the tab card's", () => {
    expect(readCode("Pages/Ceph/View/OsdDetail.tsx")).toContain(
      "<ResourceMetricsTab queryConfigs={queryConfigs} />",
    );
  });
});

describe("CephRateChart", () => {
  const code: string = readCode("Components/Ceph/CephRateChart.tsx");

  test("its line chart takes the zoom of the page or card around it: no handlers of its own", () => {
    const chart: string = code.slice(
      indexOfOrFail(code, "<LineChartElement"),
      indexOfOrFail(code, "/> ); };"),
    );
    expect(chart).toContain("xAxis={xAxis}");
    expect(chart).not.toContain("onTimeRangeSelect");
    expect(chart).not.toContain("onTimeRangeReset");
    expect(chart).not.toContain("disableTimeRangeZoom");
    expect(code).toContain("type: XAxisType.Time,");
  });

  test("its empty state takes the double-click back out of a zoom", () => {
    expect(code).toContain(
      "const zoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();",
    );
    expect(code).toContain("onDoubleClick={zoom?.onTimeRangeReset}");
  });
});
