import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 wiring pins for the container pages: Docker and Podman hosts,
 * their containers, and Docker Swarm clusters. App's jest runs in plain Node
 * and cannot render React, so the load-bearing wiring is pinned here at the
 * source level. The behaviour behind it is rendered for real in:
 *
 *   Common/Tests/App/Dashboard/ContainerHostOverviewTimeRangeZoom.test.tsx
 *   Common/Tests/App/Dashboard/DockerSwarmInsightsTimeRangeZoom.test.tsx
 *   Common/Tests/App/Dashboard/ContainerMetricsTimeRangeZoom.test.tsx
 *
 * Comments are stripped and whitespace squashed, so Prettier reflows and
 * rationale comments cannot make a pin pass or fail.
 */

const PAGES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
);

const WHITESPACE_PATTERN: RegExp = /\s+/g;
const BLOCK_COMMENT_PATTERN: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_PATTERN: RegExp = /(^|[^:])\/\/[^\n]*/g;
const JSX_EMPTY_EXPRESSION_PATTERN: RegExp = /\{\s*\}/g;
const LINE_CHART_PATTERN: RegExp = /<LineChartElement\b[\s\S]*?\/>/g;
const METRIC_CARD_PATTERN: RegExp = /<EmbeddedMetricCard\b[\s\S]*?\/>/g;

const SCOPE_IMPORT: string =
  'import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";';
const HINT_IMPORT: string =
  'import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";';

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(PAGES_DIR, ...relativePath.split("/")), "utf8")
    .replace(BLOCK_COMMENT_PATTERN, " ")
    .replace(LINE_COMMENT_PATTERN, "$1")
    .replace(JSX_EMPTY_EXPRESSION_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ");
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

  return source.slice(start, end + to.length);
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe.each([
  ["Docker", "DockerHostOverview"],
  ["Podman", "PodmanHostOverview"],
])(
  "%s host Overview: one zoom for the whole page",
  (runtime: string, component: string) => {
    const code: string = readCode(`${runtime}/View/Overview.tsx`);
    const scopeOpen: string =
      "<TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>";

    test("imports the shared page scope and the chart-card hint", () => {
      expect(code).toContain(SCOPE_IMPORT);
      expect(code).toContain(HINT_IMPORT);
    });

    test("the zoom runs over the page's own range state, not a copy of it", () => {
      expect(code).toContain(
        "const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(DEFAULT_TIME_RANGE);",
      );
      // One range on the page; the zoom keeps no second one.
      expect(countOf(code, "useState<RangeStartAndEndDateTime>")).toBe(1);
      expect(countOf(code, "<TimeRangeZoomScope")).toBe(1);
      expect(code).toContain(scopeOpen);
    });

    test("the scope wraps the whole page, the hero's picker included", () => {
      const tree: string = between(
        code,
        `return ( ${scopeOpen}`,
        `</TimeRangeZoomScope> ); }; export default ${component};`,
      );

      // The hero carries the picker, which shows Reset zoom while zoomed.
      expect(tree).toContain("{renderHero()}");
      expect(code).toContain("{renderRefreshControl()}");
      expect(code).toContain(
        "<TelemetryTimeRangePicker value={timeRange} onChange={(value: RangeStartAndEndDateTime): void => { setTimeRange(value); }} />",
      );

      // Everything that reads the range sits inside it too.
      for (const part of [
        "{renderSummaryCards()}",
        "{renderCharts()}",
        "{renderTopContainers()}",
      ]) {
        expect(tree).toContain(part);
      }
    });

    test("every chart takes the page's zoom: a time axis and no handlers of its own", () => {
      const charts: Array<string> = code.match(LINE_CHART_PATTERN) || [];

      // renderChartCard is the page's one chart, drawn six times.
      expect(charts).toHaveLength(1);
      for (const handler of [
        "onTimeRangeSelect",
        "onTimeRangeReset",
        "disableTimeRangeZoom",
      ]) {
        expect(charts[0]).not.toContain(handler);
      }

      const card: string = between(
        code,
        "const renderChartCard:",
        "const renderCharts:",
      );
      expect(card).toContain("type: XAxisType.Time,");
      expect(countOf(code, "renderChartCard({")).toBe(6);
    });

    test("each chart section names the gesture on hover, beside its heading", () => {
      const sections: string = between(
        code,
        "const renderCharts:",
        "const renderTopContainers:",
      );
      const hint: string =
        '<TimeRangeZoomHint revealOnHover={true} className="max-lg:hidden" />';
      const headings: Array<string> = [
        "Availability",
        "Container resource usage",
        "Network",
      ];
      // Each section, from its `group` root on: the hover reveals the hint.
      const chunks: Array<string> = sections
        .split('<div className="group mb-6">')
        .slice(1);

      expect(chunks).toHaveLength(headings.length);
      chunks.forEach((chunk: string, index: number): void => {
        // The heading row: title and subtitle on the left, the hint right.
        expect(chunk).toMatch(
          /^ <div className="mb-3 flex items-center justify-between gap-4"> <div> <h2 /,
        );
        const row: string = chunk.slice(0, chunk.indexOf(hint) + hint.length);
        expect(row).toContain(headings[index]!);
        expect(row).toContain(`</p> </div> ${hint}`);
      });

      expect(countOf(code, "<TimeRangeZoomHint")).toBe(headings.length);
    });

    test("the chart cards' own headers are left as they were", () => {
      /*
       * Four resource cards share a row; a hint in their narrow headers -
       * invisible, yet still taking its width - pushed their titles onto
       * two lines.
       */
      const card: string = between(
        code,
        "const renderChartCard:",
        "const renderCharts:",
      );

      expect(card).not.toContain("TimeRangeZoomHint");
      expect(card).not.toContain("group");
      expect(
        countOf(
          card,
          '<div className="flex items-center justify-between mb-3">',
        ),
      ).toBe(2);
    });

    test("every fetch reads the page's range, and a zoom or a reset refetches", () => {
      const fetchStats: string = between(
        code,
        "const fetchStats: PromiseVoidFunction",
        "const fetchStatsRef",
      );

      expect(fetchStats).toContain(
        "RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);",
      );
      expect(code).toContain(
        "useEffect(() => { fetchStatsRef.current().catch((err: Error) => { setStatsError(API.getFriendlyMessage(err)); }); }, [timeRange]);",
      );
    });

    test("only the latest fetch may commit, so a slow answer for the old window cannot win", () => {
      const fetchStats: string = between(
        code,
        "const fetchStats: PromiseVoidFunction",
        "const fetchStatsRef",
      );

      expect(code).toContain(
        "const fetchSeqRef: React.MutableRefObject<number> = useRef<number>(0);",
      );
      expect(fetchStats).toContain(
        "const seq: number = ++fetchSeqRef.current;",
      );
      expect(fetchStats).toContain("return seq !== fetchSeqRef.current;");
      // After the host lookup, after the metric queries, and on a failure.
      expect(countOf(fetchStats, "if (isStale()) { return; }")).toBe(3);
      expect(fetchStats).toContain(
        "if (isStale()) { return; } const getBucketTimestamp",
      );
      expect(fetchStats).toContain(
        "} catch (err) { if (isStale()) { return; } setStatsError(API.getFriendlyMessage(err)); }",
      );
    });
  },
);

describe("Docker Swarm Insights: the four cards share one zoom", () => {
  const code: string = readCode("DockerSwarm/View/Insights.tsx");
  const scopeOpen: string =
    "<TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={handleTimeRangeChange} >";

  test("the scope runs over the page's range and its change handler", () => {
    expect(code).toContain(SCOPE_IMPORT);
    expect(countOf(code, "<TimeRangeZoomScope")).toBe(1);
    expect(code).toContain(scopeOpen);
    expect(code).toContain(
      "setTimeRange(newTimeRange); setStartAndEndDate( RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange), );",
    );
  });

  test("every card sits inside the scope and follows the page's range", () => {
    const tree: string = between(
      code,
      `return ( ${scopeOpen}`,
      "</TimeRangeZoomScope> ); }; export default DockerSwarmClusterInsights;",
    );
    const cards: Array<string> = tree.match(METRIC_CARD_PATTERN) || [];

    expect(cards).toHaveLength(4);
    expect(countOf(code, "<EmbeddedMetricCard")).toBe(4);

    /*
     * A card whose range the page controls, inside the page's scope, zooms
     * the page: a drag on one card and a double-click on another work
     * together.
     */
    for (const card of cards) {
      expect(card).toContain(
        "timeRange={timeRange} onTimeRangeChange={handleTimeRangeChange} startAndEndDate={startAndEndDate}",
      );
    }
  });
});

describe.each(["Docker", "Podman"])(
  "%s pages whose one metric card owns the range",
  (runtime: string) => {
    /*
     * The card is the only time-dependent thing on these pages, so its own
     * zoom (EmbeddedMetricCard keeps one over the range it owns) is the
     * page's. A page scope here would change nothing: a card follows a
     * page's zoom only when the page also owns its range.
     */
    test.each(["Metrics.tsx", "ContainerDetail.tsx"])(
      "%s leaves the range, and so the zoom, to its card",
      (file: string) => {
        const code: string = readCode(`${runtime}/View/${file}`);
        const cards: Array<string> = code.match(METRIC_CARD_PATTERN) || [];

        expect(cards).toHaveLength(1);
        expect(cards[0]).not.toContain("timeRange=");
        expect(cards[0]).not.toContain("onTimeRangeChange=");
        expect(cards[0]).not.toContain("startAndEndDate=");
        expect(code).not.toContain("TimeRangeZoom");
      },
    );

    test("the container page's Logs tab keeps its own range", () => {
      const code: string = readCode(`${runtime}/View/ContainerDetail.tsx`);
      const logs: string = between(code, "<DashboardLogsViewer", "/>");

      expect(logs).not.toContain("timeRangeOverride");
      expect(logs).not.toContain("onTimeRangeChange");
    });
  },
);
