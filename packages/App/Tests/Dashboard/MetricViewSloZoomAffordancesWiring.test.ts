import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 wiring pins for where a chart's zoom affordances sit and what
 * they promise: MetricView's own "Reset zoom", the bucket inspector a chart
 * click opens, and the TelemetryResource ChartCard's hint and empty box.
 * (The SLO cards' hint rows are pinned in ApmSloTimeRangeZoomWiring.)
 *
 * App's jest runs in node and cannot render these, so the load-bearing
 * wiring is pinned as comment-stripped, whitespace-squashed source. The
 * behaviour behind each pin is rendered for real in Common/Tests/App/
 * Dashboard:
 *
 *   MetricViewOwnZoomResetPlacement.test.tsx       MetricView's own Reset
 *   MetricViewFirstResultLands.test.tsx            its first results
 *   MetricChartsBucketInspectorDoubleClick.test.tsx the bucket inspector
 *   ChartCardZoomAffordances.test.tsx               ChartCard
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath.split("/")), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1 ")
    .replace(/\s+/g, " ");
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

// The text from `from` (inclusive) to the next `to` after it (exclusive).
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

describe("MetricView's own Reset zoom (Components/Metrics/MetricView.tsx)", () => {
  const code: string = readCode("Components/Metrics/MetricView.tsx");

  test("only MetricView can switch it on: the flag is on the body's internal props, not the public ones", () => {
    expect(code).toContain(
      "interface MetricViewBodyInternalProps extends MetricViewBodyProps { showOwnZoomReset?: boolean | undefined; }",
    );
    expect(between(code, "interface MetricViewBodyProps {", "}")).not.toContain(
      "showOwnZoomReset",
    );
    expect(code).toContain(
      "export interface ComponentProps extends MetricViewBodyProps {",
    );
    expect(code).toContain(
      "const MetricViewBody: FunctionComponent<MetricViewBodyInternalProps> = ( props: MetricViewBodyInternalProps, ): ReactElement => {",
    );
  });

  test("it is switched on only where the view keeps the zoom itself, and no row is added above the view for it", () => {
    const renderWithOwnZoom: string = between(
      code,
      "const renderWithOwnZoom: RenderOwnZoomFunction",
      "if (props.localChartZoom) {",
    );

    expect(renderWithOwnZoom).toContain(
      "<TimeRangeZoomProvider zoom={zoom}> <MetricViewBody {...bodyProps} onTimeRangeSelect={zoom.zoomToTimeRange} onTimeRangeReset={zoom.isZoomed ? zoom.resetZoom : undefined} showOwnZoomReset={true} /> </TimeRangeZoomProvider>",
    );
    expect(renderWithOwnZoom).not.toContain("ResetTimeRangeZoomButton");
    expect(code).not.toContain('<div className="mb-2 flex justify-end">');

    // The other three bodies (no zoom, the host's, the page's) never get it.
    expect(countOf(code, "<MetricViewBody ")).toBe(4);
    expect(countOf(code, "showOwnZoomReset={true}")).toBe(1);
    expect(code).toContain("return renderWithOwnZoom(localZoom, {");
    expect(code).toContain("return renderWithOwnZoom(ownZoom, props);");
  });

  test("with the query builder shown, it ends the Charts heading row, keeping that row's height and none of its capitals", () => {
    const headingRow: string = between(
      code,
      '<div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400"> <span>Charts</span>',
      "{metricResultsError && (",
    );

    expect(headingRow).toContain(
      '{props.showOwnZoomReset ? ( <ResetTimeRangeZoomButton className="ml-auto -my-1 normal-case tracking-normal" /> ) : ( <></> )}',
    );
  });

  test("without the builder, it floats on the first chart's top border with the refetch indicator, out of the flow", () => {
    expect(code).toContain(
      "const floatsOwnZoomReset: boolean = Boolean( props.showOwnZoomReset && props.hideQueryElements, );",
    );

    const floating: string = between(
      code,
      "{floatsOwnZoomReset ? (",
      "<div className={`${ props.hideCardInCharts",
    );
    expect(floating).toContain('data-testid="metric-view-own-zoom-controls"');
    expect(floating).toContain(
      'className={`pointer-events-none absolute right-2 z-10 flex -translate-y-1/2 items-center gap-2 ${ props.hideCardInCharts ? "top-[17px]" : "top-0" }`}',
    );
    expect(floating).toContain(
      '{isMetricResultsLoading ? ( getRefreshingIndicator("bg-white py-0.5") ) : ( <></> )}',
    );
    expect(floating).toContain(
      '<ResetTimeRangeZoomButton className="pointer-events-auto rounded-full border border-gray-200 bg-white px-2.5 !py-0.5 shadow-sm" />',
    );
    // Everywhere else the refetch indicator keeps its corner.
    expect(floating).toContain(
      ') : isMetricResultsLoading ? ( getRefreshingIndicator( "absolute right-2 top-2 z-10 bg-white/90 py-1", ) ) : ( <></> )}',
    );
  });
});

describe("MetricView's first results (Components/Metrics/MetricView.tsx)", () => {
  const code: string = readCode("Components/Metrics/MetricView.tsx");

  test("the fetch once the catalog is in runs only if none has started: it reads the first render's data", () => {
    const loadMetricTypes: string = between(
      code,
      "const loadMetricTypes: PromiseVoidFunction",
      "const loadTelemetryAttributesForMetric",
    );

    expect(loadMetricTypes).toContain(
      "if (props.data && fetchSeqRef.current === 0) { fetchAggregatedResults().catch(",
    );
    // Every fetch claims a token first, so a started one is always seen.
    expect(code).toContain("const fetchSeq: number = ++fetchSeqRef.current;");
  });
});

describe("the bucket inspector (Components/Metrics/MetricCharts.tsx)", () => {
  const code: string = readCode("Components/Metrics/MetricCharts.tsx");

  test("each opening starts a new click sequence: the inspector has not been pressed yet", () => {
    expect(code).toContain(
      "const bucketInspectorPressedRef: React.MutableRefObject<boolean> = useRef<boolean>(false);",
    );
    expect(
      between(
        code,
        "const openBucketInspector:",
        "setIsBucketInspectorVisible(true);",
      ),
    ).toContain(
      "bucketInspectorPressedRef.current = false; setBucketInspector({",
    );
  });

  test("until pressed afresh it ignores the rest of the double-click that opened it: no word selected, no button pressed", () => {
    const inspector: string = between(
      code,
      'role="dialog" aria-label={`Values at',
      "Investigate this moment",
    );

    expect(inspector).toContain(
      "onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => { if (event.detail <= 1) { bucketInspectorPressedRef.current = true; return; } if (!bucketInspectorPressedRef.current) { event.preventDefault(); } }}",
    );
    expect(inspector).toContain(
      "onClickCapture={(event: React.MouseEvent<HTMLDivElement>) => { if (event.detail > 1 && !bucketInspectorPressedRef.current) { event.preventDefault(); event.stopPropagation(); } }}",
    );
  });

  test("its chrome is not selectable; the window, the series names and the values are", () => {
    const inspector: string = between(
      code,
      'role="dialog" aria-label={`Values at',
      "Investigate this moment",
    );

    expect(inspector).toContain(
      'className="fixed z-50 w-[300px] select-none rounded-lg bg-white shadow-xl ring-1 ring-gray-200 focus:outline-none"',
    );
    expect(inspector).toContain(
      '<p className="mt-0.5 select-text text-[11px] tabular-nums text-gray-500">',
    );
    expect(inspector).toContain(
      '<span className="min-w-0 flex-1 select-text truncate text-xs text-gray-700"> <span className="mr-1.5 select-none tabular-nums text-gray-400"> {index + 1}. </span> {entry.name} </span>',
    );
    expect(inspector).toContain(
      '<span className="shrink-0 select-text text-xs font-medium tabular-nums text-gray-900"> {bucketInspector.formatValue(entry.value)} </span>',
    );
    expect(countOf(inspector, "select-text")).toBe(3);
  });
});

describe("the trend card (Components/TelemetryResource/ChartCard.tsx)", () => {
  const code: string = readCode("Components/TelemetryResource/ChartCard.tsx");

  test("the header names a gesture only where the body takes one", () => {
    expect(code).toContain(
      "const isSkeletonShown: boolean = Boolean( props.loading || !props.windowStart || !props.windowEnd, );",
    );
    expect(code).toContain(
      "const emptyStateReset: (() => void) | undefined = pageZoom?.onTimeRangeReset;",
    );
    expect(code).toContain(
      "const isZoomHintShown: boolean = !isSkeletonShown && (hasData || Boolean(emptyStateReset));",
    );
    expect(code).toContain(
      "{isZoomHintShown ? <TimeRangeZoomHint revealOnHover={true} /> : <></>}",
    );
    expect(countOf(code, "<TimeRangeZoomHint")).toBe(1);
  });

  test("the empty box takes the reset double-click, and its text is not selectable while it does", () => {
    const emptyBox: string = between(code, "if (!hasData) {", "const xAxis");

    expect(emptyBox).toContain(
      'className={`flex h-44 items-center justify-center rounded-md bg-gray-50 text-sm text-gray-400${ emptyStateReset ? " select-none" : "" }`}',
    );
    expect(emptyBox).toContain("onDoubleClick={emptyStateReset}");
  });
});
