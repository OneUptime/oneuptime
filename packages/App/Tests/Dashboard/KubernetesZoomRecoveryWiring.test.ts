import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 follow-ups on the Kubernetes pages, pinned in the source:
 *
 * - The Costs pages keep the zoom, the picker, Reset zoom and every Refresh
 *   on screen when a load fails, and the Spend card's Refresh reloads a
 *   zoomed page.
 * - The network throughput chart reloads on its card's Refresh, and keeps
 *   its last chart on screen while it reloads.
 * - The cluster Overview's name keeps its room when a zoom widens the
 *   controls beside it.
 *
 * App's node test env cannot render these pages, so the wiring is pinned
 * here with comments stripped and whitespace squashed. The behaviour is
 * rendered for real in the Common suite:
 *
 *   Common/Tests/App/Dashboard/KubernetesCostsLoadRecovery.test.tsx
 *   Common/Tests/App/Dashboard/KubernetesCostsZoomExactHours.test.tsx
 *   Common/Tests/App/Dashboard/KubernetesNetworkThroughputReload.test.tsx
 *
 * and the Overview's header in a real browser:
 *
 *   E2E/ChartTimeZoom/KubernetesOverviewHeader.spec.ts
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
// Prettier decides where a JSX tag breaks; compare without that space.
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
  return tight(source).split(tight(needle)).length - 1;
}

const OVERVIEW: string = readCode("Pages/Kubernetes/View/Index.tsx");
const CLUSTER_COSTS: string = readCode("Pages/Kubernetes/View/Costs.tsx");
const FLEET_COSTS: string = readCode("Pages/Kubernetes/Costs.tsx");
const COST_TREND_CHART: string = readCode(
  "Pages/Kubernetes/View/KubernetesCostTrendChart.tsx",
);
const NETWORK_CHART: string = readCode(
  "Pages/Kubernetes/View/KubernetesNetworkThroughputChart.tsx",
);

describe("the Costs pages keep the way back when a load fails", () => {
  const PAGES: Array<[string, string, number]> = [
    ["cluster", CLUSTER_COSTS, 2],
    ["project", FLEET_COSTS, 1],
  ];

  test.each(PAGES)(
    "the %s Costs page no longer swaps itself for a bare error",
    (_page: string, source: string) => {
      expectNoCode(source, "if (error) { return <ErrorMessage");
      expectNoCode(source, "import ErrorMessage from");
      // The zoom scope is the page's root, error or not.
      expectCode(source, "return ( <TimeRangeZoomScope");
    },
  );

  test.each(PAGES)(
    "the %s Costs page shows the error where the chart and its tables were, each with a retry",
    (_page: string, source: string, tables: number) => {
      expectCode(
        source,
        "<KubernetesCostTrendChart trend={trend} isLoading={isLoading} error={error} onRetry={reload}",
      );
      expect(
        countOf(
          source,
          "isLoading={isLoading} error={error} onRefreshClick={error ? reload : undefined}",
        ),
      ).toBe(tables);
      expectNoCode(source, 'error=""');
    },
  );

  test.each(PAGES)(
    "the %s Costs page's tiles read a dash, not the previous window's figures, after a failed load",
    (_page: string, source: string) => {
      expectCode(source, "const showFigures: boolean = !isLoading && !error;");
      expectNoCode(source, 'value={isLoading ? "—"');
      expect(countOf(source, "showFigures ? formatCost(")).toBe(3);
    },
  );

  test.each(PAGES)(
    "every Refresh on the %s Costs page - the Spend card's, the tables', the retries - reloads through one toggle",
    (_page: string, source: string) => {
      expectCode(
        source,
        "const reload: () => void = useCallback((): void => { setRefreshToggle((toggle: number) => { return toggle + 1; }); }, []);",
      );
      expectCode(
        source,
        "onTimeRangeChange={handleTimeRangeChange} startAndEndDate={startAndEndDate} onRefresh={reload} >",
      );
      expectCode(source, "onClick: reload,");
      expectCode(source, "refreshToggle]);");
    },
  );

  test("the spend chart's failed-load state takes the reset double-click, is not selectable, and offers the retry", () => {
    const errorBranch: string = between(
      COST_TREND_CHART,
      "if (props.error) {",
      "if (props.trend.length === 0) {",
    );

    expectCode(
      errorBranch,
      '<div className="select-none" onDoubleClick={pageZoom?.onTimeRangeReset} > <ErrorMessage message={props.error} onRefreshClick={props.onRetry} /> </div>',
    );
  });

  test("the spend chart's skeleton is the chart's own height", () => {
    expectCode(COST_TREND_CHART, "const CHART_HEIGHT_IN_PX: number = 300;");
    expectCode(
      COST_TREND_CHART,
      "style={{ height: `${CHART_HEIGHT_IN_PX}px` }}",
    );
    expectCode(COST_TREND_CHART, "heightInPx={CHART_HEIGHT_IN_PX}");
    expectNoCode(COST_TREND_CHART, "h-48");
  });
});

describe("the network throughput chart", () => {
  test("reloads on its card's Refresh, which a zoomed window alone cannot ask for", () => {
    expectCode(
      NETWORK_CHART,
      'import { useEmbeddedMetricCardRefreshNonce } from "../../../Components/Metrics/EmbeddedMetricCardRefresh";',
    );
    expectCode(
      NETWORK_CHART,
      "const refreshNonce: number = useEmbeddedMetricCardRefreshNonce();",
    );
    expectCode(
      NETWORK_CHART,
      "}, [props.clusterIdentifier, props.nodeName, startMs, endMs, refreshNonce]);",
    );
  });

  test("keeps the last chart on screen, on the window it was fetched for, while it reloads", () => {
    expectCode(
      NETWORK_CHART,
      "setLoaded({ scopeKey: scopeKey, series: next, startDate: new Date(startMs), endDate: new Date(endMs), });",
    );
    expectCode(NETWORK_CHART, "min: shown.startDate, max: shown.endDate,");
    // No skeleton in place of a chart that is on screen.
    expectNoCode(NETWORK_CHART, "if (isLoading) { return");
    expectNoCode(NETWORK_CHART, "h-48");
  });

  test("its first-load skeleton, and its empty state, are the chart's own height", () => {
    expectCode(
      NETWORK_CHART,
      "const heightInPx: number = props.heightInPx ?? DEFAULT_HEIGHT_IN_PX;",
    );
    expectCode(NETWORK_CHART, "const DEFAULT_HEIGHT_IN_PX: number = 300;");
    expect(
      countOf(NETWORK_CHART, "style={{ height: `${heightInPx}px` }}"),
    ).toBe(2);
    expectCode(NETWORK_CHART, "heightInPx={heightInPx}");
  });

  test("its failed-first-load and empty states take the reset double-click, and are not selectable", () => {
    expectCode(
      NETWORK_CHART,
      '<div className="select-none" onDoubleClick={zoom?.onTimeRangeReset}> <ErrorMessage message={error} /> </div>',
    );
    expectCode(
      NETWORK_CHART,
      'className="flex select-none items-center justify-center text-sm text-gray-400" style={{ height: `${heightInPx}px` }} onDoubleClick={zoom?.onTimeRangeReset} >',
    );
  });
});

describe("the cluster Overview's header", () => {
  const header: string = between(
    OVERVIEW,
    '<div className="relative px-6 py-5">',
    "{specChips.length > 0 && (",
  );

  test("the cluster's name keeps its room: its column no longer shrinks to nothing beside the controls", () => {
    expectCode(
      header,
      '<div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:justify-between"> <div className="flex items-start gap-4 md:w-full md:flex-1">',
    );
    // min-w-0 on the name's column is what let the controls squeeze it.
    expectNoCode(header, '<div className="flex items-start gap-4 min-w-0">');
    // A name longer than the whole row still truncates.
    expectCode(
      header,
      '<h1 className="text-xl font-semibold text-gray-900 truncate">',
    );
  });

  test("the controls give way instead: they take the rest of the row, wrap under the name when squeezed, and stay right-aligned", () => {
    expectCode(
      header,
      '<div className="md:ml-auto md:min-w-[min(100%,24rem)] md:max-w-max md:flex-[1000_1_0%] md:self-start md:[&>div]:justify-end"> {renderRefreshControl()} </div>',
    );
    expectNoCode(header, '<div className="flex-shrink-0 md:self-start">');
  });
});
