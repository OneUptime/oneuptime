import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 wiring pins for the Kubernetes pages: a drag across any chart
 * narrows the whole page to the window dragged out, and a double-click on
 * any chart (or Reset zoom beside the picker) puts back the range from
 * before the first zoom.
 *
 * App's node test env cannot render these pages, so what each page must be
 * wired to is pinned here, in the source, with comments stripped and
 * whitespace squashed so reflowing and rationale comments cannot make a
 * test pass or fail. The behaviour behind the wiring is rendered for real
 * in the Common suite:
 *
 *   Common/Tests/App/Dashboard/KubernetesClusterOverviewZoom.test.tsx
 *   Common/Tests/App/Dashboard/KubernetesClusterPagesZoom.test.tsx
 *   Common/Tests/App/Dashboard/KubernetesCostsZoom.test.tsx
 *   Common/Tests/App/Dashboard/KubernetesResourceMetricsTabZoom.test.tsx
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;
/*
 * Prettier decides where a JSX tag breaks (`timeRange={x} >` or
 * `timeRange={x}>`), so code is compared with the space around brackets,
 * parens, commas and semicolons removed on both sides.
 */
const BRACKET_SPACE: RegExp = /\s*([{}()[\],;])\s*/g;

function tight(text: string): string {
  return text.replace(BRACKET_SPACE, "$1");
}

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath.split("/")), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

function expectCode(source: string, snippet: string): void {
  expect(tight(source)).toContain(tight(snippet));
}

function expectNoCode(source: string, snippet: string): void {
  expect(tight(source)).not.toContain(tight(snippet));
}

function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  if (end < 0) {
    throw new Error(`Expected "${to}" after "${from}".`);
  }

  return source.slice(start, end);
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const SCOPE_IMPORT: string =
  'import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";';
const HINT_IMPORT: string =
  'import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";';

const OVERVIEW: string = readCode("Pages/Kubernetes/View/Index.tsx");
const INSIGHTS: string = readCode("Pages/Kubernetes/View/Insights.tsx");
const CONTROL_PLANE: string = readCode(
  "Pages/Kubernetes/View/ControlPlane.tsx",
);
const SERVICE_MESH: string = readCode("Pages/Kubernetes/View/ServiceMesh.tsx");
const CLUSTER_COSTS: string = readCode("Pages/Kubernetes/View/Costs.tsx");
const FLEET_COSTS: string = readCode("Pages/Kubernetes/Costs.tsx");
const COST_TREND_CHART: string = readCode(
  "Pages/Kubernetes/View/KubernetesCostTrendChart.tsx",
);
const COST_UTILS: string = readCode(
  "Pages/Kubernetes/Utils/KubernetesCostUtils.ts",
);
const NETWORK_CHART: string = readCode(
  "Pages/Kubernetes/View/KubernetesNetworkThroughputChart.tsx",
);
const NODE_DETAIL: string = readCode("Pages/Kubernetes/View/NodeDetail.tsx");
const RESOURCE_METRICS_TAB: string = readCode(
  "Components/Infrastructure/ResourceMetricsTab.tsx",
);
const KUBERNETES_METRICS_TAB: string = readCode(
  "Components/Kubernetes/KubernetesMetricsTab.tsx",
);

describe("cluster Overview: the page in the issue", () => {
  const PAGE_RETURN: string = between(
    OVERVIEW,
    "return ( <TimeRangeZoomScope",
    "export default KubernetesClusterOverview;",
  );

  test("wraps its whole tree in a zoom scope over its own range state and setter", () => {
    expectCode(OVERVIEW, SCOPE_IMPORT);
    expectCode(
      OVERVIEW,
      "const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(DEFAULT_TIME_RANGE);",
    );
    expectCode(
      OVERVIEW,
      "return ( <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}> {renderHero()}",
    );
    expectCode(PAGE_RETURN, "</TimeRangeZoomScope> ); };");
    // One range on the page: the zoom keeps no copy of its own.
    expect(countOf(OVERVIEW, "useState<RangeStartAndEndDateTime>")).toBe(1);
  });

  test("the picker is inside the scope - in the hero - on the page's own setter", () => {
    const refreshControl: string = between(
      OVERVIEW,
      "const renderRefreshControl:",
      "const renderGoldenMetrics:",
    );
    const hero: string = between(
      OVERVIEW,
      "const renderHero:",
      "return ( <TimeRangeZoomScope",
    );

    expectCode(
      refreshControl,
      "timeRangePicker={ <TelemetryTimeRangePicker value={timeRange} onChange={(value: RangeStartAndEndDateTime): void => { setTimeRange(value); }} /> }",
    );
    expectCode(hero, "{renderRefreshControl()}");
  });

  test("the golden charts and tiles render inside the scope", () => {
    expectCode(PAGE_RETURN, "{renderGoldenMetrics()}");
    expectCode(PAGE_RETURN, "{renderGoldenCharts()}");
  });

  test("the chart card hands its line chart no zoom of its own, so the chart takes the page's", () => {
    const card: string = between(
      OVERVIEW,
      "export const ClusterChartCard:",
      "export function titleWithTooltip(",
    );
    const chart: string = between(card, "<LineChartElement", "/>");

    expectNoCode(chart, "onTimeRangeSelect");
    expectNoCode(chart, "onTimeRangeReset");
    expectNoCode(chart, "disableTimeRangeZoom");
    expectCode(card, "type: XAxisType.Time,");
  });

  test("the chart card names the drag on hover, clear of its header, in both branches", () => {
    const card: string = between(
      OVERVIEW,
      "export const ClusterChartCard:",
      "export function titleWithTooltip(",
    );
    const header: string = between(
      card,
      "const header: ReactElement =",
      "if (!props.chartWindow)",
    );

    expectCode(OVERVIEW, HINT_IMPORT);
    expectCode(
      header,
      '<TimeRangeZoomHint revealOnHover={true} className="pointer-events-none absolute right-0 top-full leading-3" />',
    );
    expectCode(header, '<div className="relative flex items-center');
    // The skeleton and the chart both reveal it on hover of the card.
    expect(countOf(card, 'className="group rounded-xl')).toBe(2);
  });

  test("a change of range - a zoom, a reset, a pick - reloads every golden chart and tile for it", () => {
    const golden: string = between(
      OVERVIEW,
      "const loadGoldenMetrics:",
      "const loadGoldenMetricsRef:",
    );

    expectCode(
      OVERVIEW,
      "useEffect(() => { if (cluster?.clusterIdentifier) { void loadGoldenMetricsRef.current(cluster.clusterIdentifier); } }, [timeRange]);",
    );
    expectCode(
      golden,
      "RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);",
    );
    expectCode(golden, "setChartWindow({ start: startDate, end: endDate });");
    expectCode(golden, "setAvailabilityPct(availability.uptimePercent);");
    expectCode(golden, "setGoldenStats({");
  });

  test("only the newest golden load paints: a zoom, its reset and a refresh can race", () => {
    const golden: string = between(
      OVERVIEW,
      "const loadGoldenMetrics:",
      "const loadGoldenMetricsRef:",
    );

    expectCode(
      OVERVIEW,
      "const goldenLoadSequenceRef: React.MutableRefObject<number> = useRef<number>(0);",
    );
    expectCode(golden, "goldenLoadSequenceRef.current += 1;");
    expectCode(
      golden,
      "return loadSequence !== goldenLoadSequenceRef.current;",
    );
    // Checked once every answer is in, before anything is painted...
    expectCode(
      golden,
      "const allocatable: NodeAllocatableCpu = await allocatablePromise; if (isSuperseded()) { return; }",
    );
    // ...before an error is shown, and before the spinners are cleared.
    expectCode(
      golden,
      "} catch (err) { if (isSuperseded()) { return; } setGoldenError(",
    );
    expectCode(
      golden,
      "} finally { if (!isSuperseded()) { setIsRefreshing(false); setIsGoldenLoading(false); } }",
    );
  });

  test("allocatable CPU is never read over less than five minutes, so a narrow zoom keeps its CPU chart", () => {
    const golden: string = between(
      OVERVIEW,
      "const loadGoldenMetrics:",
      "const loadGoldenMetricsRef:",
    );

    expectCode(
      OVERVIEW,
      "const ALLOCATABLE_CPU_MIN_LOOKBACK_MINUTES: number = 5;",
    );
    expectCode(
      golden,
      "const allocatableLookbackStart: Date = OneUptimeDate.addRemoveMinutes( endDate, -ALLOCATABLE_CPU_MIN_LOOKBACK_MINUTES, );",
    );
    expectCode(
      golden,
      "startDate: allocatableLookbackStart.getTime() < startDate.getTime() ? allocatableLookbackStart : startDate,",
    );
  });

  test("the 'now' snapshots - inventory, top consumers, warnings - stay off the range, zoomed or not", () => {
    for (const [from, to] of [
      ["const loadSummary:", "const loadTopPods:"],
      ["const loadTopPods:", "const loadWarnings:"],
      ["const loadWarnings:", "const goldenLoadSequenceRef:"],
    ] as Array<[string, string]>) {
      expect({
        loader: from,
        readsRange: between(OVERVIEW, from, to).includes("timeRange"),
      }).toEqual({
        loader: from,
        readsRange: false,
      });
    }
  });
});

describe("Insights, Control Plane and Service Mesh: one zoom for every card", () => {
  const PAGES: Array<[string, string, number]> = [
    ["Insights", INSIGHTS, 3],
    ["Control Plane", CONTROL_PLANE, 6],
    ["Service Mesh", SERVICE_MESH, 8],
  ];

  test.each(PAGES)(
    "%s wraps its tree in a zoom scope over its range and change handler",
    (_page: string, source: string) => {
      expectCode(source, SCOPE_IMPORT);
      expectCode(
        source,
        "return ( <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={handleTimeRangeChange} >",
      );
      expectCode(source, "</TimeRangeZoomScope> ); };");
      expect(countOf(source, "useState<RangeStartAndEndDateTime>")).toBe(1);
    },
  );

  test.each(PAGES)(
    "every %s card is inside the scope and hands its range to the page",
    (_page: string, source: string, cards: number) => {
      const scoped: string = between(
        source,
        "<TimeRangeZoomScope",
        "</TimeRangeZoomScope>",
      );
      const tabsOrCards: string = source.includes("const tabs: Array<Tab>")
        ? between(source, "const tabs: Array<Tab>", "<TimeRangeZoomScope")
        : scoped;

      // Control Plane and Service Mesh build their cards into the tabs...
      if (source.includes("const tabs: Array<Tab>")) {
        expectCode(scoped, "<Tabs tabs={tabs}");
      }

      // ...and every card is controlled by the page's one range.
      expect(countOf(tabsOrCards, "<EmbeddedMetricCard")).toBe(cards);
      expect(
        countOf(
          tight(tabsOrCards),
          tight(
            "timeRange={timeRange} onTimeRangeChange={handleTimeRangeChange} startAndEndDate={startAndEndDate}",
          ),
        ),
      ).toBe(cards);
    },
  );

  test("the Insights network chart sits in its card, taking the page's zoom, with a hint row above it", () => {
    const networkCard: string = between(
      INSIGHTS,
      '"Network", KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.networkThroughput,',
      "</EmbeddedMetricCard>",
    );
    const chart: string = between(
      networkCard,
      "<KubernetesNetworkThroughputChart",
      "/>",
    );

    expectCode(INSIGHTS, HINT_IMPORT);
    expectCode(
      networkCard,
      '<div className="group"> <div className="mb-1 flex justify-end"> <TimeRangeZoomHint revealOnHover={true} className="leading-3" /> </div> <KubernetesNetworkThroughputChart',
    );
    expectNoCode(chart, "onTimeRangeSelect");
    expectCode(
      chart,
      "startDate={startAndEndDate.startValue} endDate={startAndEndDate.endValue}",
    );
  });
});

describe("the Costs pages: the spend chart zooms the page", () => {
  const PAGES: Array<[string, string, string]> = [
    ["cluster", CLUSTER_COSTS, "./KubernetesCostTrendChart"],
    ["project", FLEET_COSTS, "./View/KubernetesCostTrendChart"],
  ];

  test.each(PAGES)(
    "the %s Costs page wraps its tree - card, tiles, tables - in a zoom scope over its range",
    (_page: string, source: string) => {
      expectCode(source, SCOPE_IMPORT);
      expectCode(
        source,
        "return ( <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={handleTimeRangeChange} > <EmbeddedMetricCard",
      );
      expectCode(source, "</Card> </TimeRangeZoomScope> ); };");
      expect(countOf(source, "useState<RangeStartAndEndDateTime>")).toBe(1);
    },
  );

  test.each(PAGES)(
    "the %s Costs page draws its spend chart through the shared zooming chart, on the page's window",
    (_page: string, source: string, importPath: string) => {
      expectCode(
        source,
        `import KubernetesCostTrendChart from "${importPath}";`,
      );
      expectCode(
        source,
        "<KubernetesCostTrendChart trend={trend} isLoading={isLoading} startAndEndDate={startAndEndDate}",
      );
      // The old inline chart is gone, so there is one chart to keep right.
      expectNoCode(source, "<LineChartElement");
    },
  );

  test("the spend chart zooms through the page's zoom, widened to at least an hour", () => {
    expectCode(
      COST_TREND_CHART,
      "const pageZoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();",
    );
    expectCode(
      COST_TREND_CHART,
      "const zoomWindow: CostZoomWindow = widenCostZoomWindow({ startTime: startTime, endTime: endTime, windowStart: props.startAndEndDate.startValue, windowEnd: props.startAndEndDate.endValue, }); pageZoom.onTimeRangeSelect(zoomWindow.startTime, zoomWindow.endTime);",
    );
    expectCode(
      COST_TREND_CHART,
      "onTimeRangeSelect={onTimeRangeSelect} onTimeRangeReset={pageZoom?.onTimeRangeReset}",
    );
    expectCode(
      COST_UTILS,
      "export const MIN_COST_ZOOM_SPAN_IN_MS: number = 60 * 60 * 1000;",
    );
  });

  test("the spend chart's empty state takes the double-click, and a hint names the drag", () => {
    expectCode(
      COST_TREND_CHART,
      "<div onDoubleClick={pageZoom?.onTimeRangeReset}> <ErrorMessage message={noCostDataMessage} /> </div>",
    );
    const chartReturn: string = between(
      COST_TREND_CHART,
      'return ( <div className="group">',
      "export default KubernetesCostTrendChart;",
    );

    expectCode(
      chartReturn,
      '<div className="mb-1 flex justify-end"> <TimeRangeZoomHint revealOnHover={true} className="leading-3" /> </div> {getContent()}',
    );
    expectCode(COST_TREND_CHART, "type: XAxisType.Time,");
  });
});

describe("resource detail Metrics tabs: the tab's card keeps the zoom", () => {
  test("the metrics tab is a card that owns its range, so it keeps the zoom itself", () => {
    expectCode(
      KUBERNETES_METRICS_TAB,
      'export { default } from "../Infrastructure/ResourceMetricsTab";',
    );
    expectCode(
      RESOURCE_METRICS_TAB,
      "<EmbeddedMetricCard hideCard={true} queryConfigs={props.queryConfigs} renderExtraCharts={props.renderExtraCharts} />",
    );
    // No range from the page: the card is uncontrolled, and zooms its own.
    expectNoCode(RESOURCE_METRICS_TAB, "timeRange=");
    expectNoCode(RESOURCE_METRICS_TAB, "onTimeRangeChange=");
  });

  test("the node's network chart is drawn inside the tab's card, which hands it the zoom, with the hint in its header", () => {
    const extra: string = between(
      NODE_DETAIL,
      "renderExtraCharts={(dateRange: InBetween<Date>): ReactElement => {",
      "</Card>",
    );

    expectCode(NODE_DETAIL, HINT_IMPORT);
    expectCode(extra, '<div className="group mt-4">');
    expectCode(
      extra,
      '<TimeRangeZoomHint revealOnHover={true} className="ml-auto font-normal" />',
    );
    expectCode(
      extra,
      "startDate={dateRange.startValue} endDate={dateRange.endValue}",
    );
  });

  test("the network chart takes its host's zoom, and its empty state takes the double-click", () => {
    const chart: string = between(NETWORK_CHART, "<LineChartElement", "/>");

    expectNoCode(chart, "onTimeRangeSelect");
    expectNoCode(chart, "disableTimeRangeZoom");
    expectCode(
      NETWORK_CHART,
      "const zoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();",
    );
    expectCode(
      NETWORK_CHART,
      "onDoubleClick={zoom?.onTimeRangeReset} > No network traffic reported for the selected time range.",
    );
  });
});

describe("Kubernetes pages whose charts are zoomed elsewhere", () => {
  test.each([
    ["the cluster Logs page", "Pages/Kubernetes/View/Logs.tsx"],
    ["the cluster Traces page", "Pages/Kubernetes/View/Traces.tsx"],
    ["the cluster Metrics page", "Pages/Kubernetes/View/Metrics.tsx"],
    [
      "the pod and container Logs tab",
      "Components/Kubernetes/KubernetesLogsTab.tsx",
    ],
  ])(
    "%s adds no zoom scope: its viewer owns the range and the zoom",
    (_page: string, relativePath: string) => {
      expect(readCode(relativePath)).not.toContain("TimeRangeZoomScope");
    },
  );
});
