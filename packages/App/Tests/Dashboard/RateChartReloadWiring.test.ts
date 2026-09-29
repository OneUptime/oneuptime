import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 review wiring pins for the client-side rate charts that sit
 * inside EmbeddedMetricCards outside Kubernetes (Ceph, Proxmox, Docker
 * Swarm). App's jest runs in node and cannot render React, so the
 * load-bearing wiring is pinned here as comment-stripped, whitespace-squashed
 * source. What it DOES is rendered and exercised in
 * Common/Tests/App/Dashboard/{CephRateChartReload,ProxmoxRateChartReload,
 * DockerSwarmRateChartRefresh,ChartRefetchFrame}.test.tsx.
 *
 *   - A reload (a zoom, a reset, a Refresh, an auto-refresh tick) keeps the
 *     last chart on screen over the window it was fetched for; only the
 *     first load is a skeleton, at the chart's height.
 *   - The card's Refresh count is a fetch dependency, so Refresh reloads a
 *     chart on a zoomed (Custom) window, whose instants do not change.
 *   - The Ceph rate charts' headings name the drag.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readRaw(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

function readSquashed(relative: string): string {
  return readRaw(relative)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

// The slice of `source` from `from` up to (not including) the next `to`.
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

const NONCE_IMPORT: string =
  'import { useEmbeddedMetricCardRefreshNonce } from "../Metrics/EmbeddedMetricCardRefresh";';
const NONCE_READ: string =
  "const refreshNonce: number = useEmbeddedMetricCardRefreshNonce();";
const FETCH_DEPS: string =
  "}, [props.clusterName, startMs, endMs, extraAttributesKey, refreshNonce]);";

const KEPT_CHARTS: Array<[string, string]> = [
  ["CephRateChart", "Components/Ceph/CephRateChart.tsx"],
  ["ProxmoxRateChart", "Components/Proxmox/ProxmoxRateChart.tsx"],
];

const REFRESHED_CHARTS: Array<[string, string]> = [
  ...KEPT_CHARTS,
  ["DockerSwarmRateChart", "Components/DockerSwarm/DockerSwarmRateChart.tsx"],
];

describe.each(REFRESHED_CHARTS)(
  "%s reloads on its card's Refresh",
  (_name: string, file: string) => {
    const source: string = readSquashed(file);

    test("reads the card's Refresh count and fetches on it", () => {
      expect(readRaw(file)).toContain(NONCE_IMPORT);
      expect(source).toContain(NONCE_READ);
      expect(countOf(source, FETCH_DEPS)).toBe(1);
    });
  },
);

describe.each(KEPT_CHARTS)(
  "%s keeps its last chart on screen while it reloads",
  (_name: string, file: string) => {
    const source: string = readSquashed(file);

    test("a load keeps its series together with the window and the scope it was fetched for", () => {
      expect(source).toContain(
        "interface LoadedRates { scopeKey: string; series: Array<SeriesPoint>; startDate: Date; endDate: Date; }",
      );
      expect(source).toContain(
        "const [loaded, setLoaded] = useState<LoadedRates | null>(null);",
      );
      expect(source).toContain(
        "const scopeKey: string = `${props.clusterName}|${extraAttributesKey}`;",
      );
      expect(source).toContain(
        'setLoaded({ scopeKey: scopeKey, series: next, startDate: startDate, endDate: endDate, }); setError("");',
      );
      // The old per-series state (drawn over the new window) is gone.
      expect(source).not.toContain("setSeries(");
    });

    test("only a reload of the same counters keeps the last chart", () => {
      expect(source).toContain(
        "const shown: LoadedRates | null = loaded && loaded.scopeKey === scopeKey ? loaded : null;",
      );
    });

    test("only the first load is a skeleton, and it holds the chart's height", () => {
      expect(source).not.toContain("if (isLoading) {");
      expect(source).not.toContain("h-48 animate-pulse");
      expect(source).toContain(
        "const heightInPx: number = props.heightInPx ?? 300;",
      );
      const firstLoad: string = between(
        source,
        "if (!shown) {",
        "const series: Array<SeriesPoint> = shown.series;",
      );
      expect(firstLoad).toContain(
        "if (error && !isLoading) { return <ErrorMessage message={error} />; }",
      );
      expect(firstLoad).toContain(
        "return <ChartLoadingSkeleton heightInPx={heightInPx} />;",
      );
      expect(countOf(source, "<ChartLoadingSkeleton")).toBe(1);
    });

    test("the chart is drawn over the loaded window, inside the refetch frame", () => {
      const xAxis: string = between(
        source,
        "const xAxis: ChartXAxis = {",
        "};",
      );
      expect(xAxis).toContain("min: shown.startDate,");
      expect(xAxis).toContain("max: shown.endDate,");
      expect(xAxis).not.toContain("props.startDate");

      const chart: string = between(
        source,
        "<ChartRefetchFrame isRefetching={isLoading} refetchError={error}> <LineChartElement ",
        "</ChartRefetchFrame>",
      );
      expect(chart).toContain("heightInPx={heightInPx}");
    });

    test("the empty state reloads in the frame too, at the chart's height, selecting no text", () => {
      const empty: string = between(
        source,
        "if (series.length === 0) {",
        "const xAxis",
      );
      expect(empty).toContain(
        "<ChartRefetchFrame isRefetching={isLoading} refetchError={error}>",
      );
      expect(empty).toContain(
        'className="flex select-none items-center justify-center text-sm text-gray-400" style={{ height: `${heightInPx}px` }} onDoubleClick={zoom?.onTimeRangeReset}',
      );
    });
  },
);

describe("every client-side counter-rate chart component reloads on its card's Refresh", () => {
  test("each component that does its own counter-rate math reads the Refresh count", () => {
    const componentsDir: string = path.join(DASHBOARD_SRC, "Components");
    const rateCharts: Array<string> = [];

    const walk: (dir: string) => void = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (
          entry.name.endsWith(".tsx") &&
          fs.readFileSync(full, "utf8").includes("computeCounterRate(")
        ) {
          rateCharts.push(path.relative(DASHBOARD_SRC, full));
        }
      }
    };
    walk(componentsDir);

    expect(rateCharts.sort()).toEqual(
      REFRESHED_CHARTS.map((chart: [string, string]): string => {
        return path.join(...chart[1].split("/"));
      }).sort(),
    );
    for (const file of rateCharts) {
      expect([file, readSquashed(file).includes(NONCE_READ)]).toEqual([
        file,
        true,
      ]);
    }
  });
});

const HINT_IMPORT: string =
  'import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";';
const HINT: string =
  '<TimeRangeZoomHint revealOnHover={true} className="ml-auto font-normal" />';

describe.each([
  ["Ceph Overview", "Pages/Ceph/View/Index.tsx"],
  ["Ceph Insights", "Pages/Ceph/View/Insights.tsx"],
  ["Ceph pool detail", "Pages/Ceph/View/PoolDetail.tsx"],
])(
  "%s: each rate chart's heading names the drag",
  (_name: string, file: string) => {
    const source: string = readSquashed(file);

    test("every rate chart sits in a named hint group, its heading carrying the hint", () => {
      expect(readRaw(file)).toContain(HINT_IMPORT);
      expect(countOf(source, "<CephRateChart")).toBe(2);
      expect(countOf(source, HINT)).toBe(2);

      for (const title of ["Client IOPS", "Client Throughput"]) {
        const section: string = between(
          source,
          `<div className="group/zoomhint"> <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700"> ${title} <InfoTooltip`,
          "<CephRateChart",
        );
        expect([title, section.includes(`/> ${HINT} </div> `)]).toEqual([
          title,
          true,
        ]);
      }
    });
  },
);
