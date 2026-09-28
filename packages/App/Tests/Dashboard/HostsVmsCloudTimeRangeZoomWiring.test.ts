import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 wiring pins for the Host, VMware, Proxmox, Cloud and
 * Serverless pages: drag on any chart to zoom the page, double-click any
 * chart (or Reset zoom beside the picker) to go back.
 *
 * App's jest runs in node and cannot render React, so the load-bearing
 * wiring is pinned here as whitespace-squashed source (comments stripped,
 * so a rationale comment or a Prettier reflow cannot make a test pass or
 * fail). The behaviour behind it - a drag refetching every chart, tile and
 * table for the dragged window, a double-click on another chart restoring
 * it, the stale-response guards - is covered by the RTL suites that render
 * these pages for real:
 *
 *   Common/Tests/App/Dashboard/HostPagesTimeRangeZoom.test.tsx
 *   Common/Tests/App/Dashboard/VMwarePagesTimeRangeZoom.test.tsx
 *   Common/Tests/App/Dashboard/ProxmoxPagesTimeRangeZoom.test.tsx
 *   Common/Tests/App/Dashboard/CloudServerlessTimeRangeZoom.test.tsx
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

function readRaw(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

function readSquashed(relative: string): string {
  return readRaw(relative)
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
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

// The page component's own `return (...)` - the last one in the file.
function pageReturn(source: string): string {
  const start: number = source.lastIndexOf("return ( <TimeRangeZoomScope");

  if (start < 0) {
    throw new Error("Expected the page to return its tree in a scope.");
  }

  return source.slice(start, source.indexOf("); };", start));
}

const SCOPE_IMPORT: string =
  'import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";';
const HINT_IMPORT: string =
  'import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";';
const RESET_IMPORT: string =
  'import ResetTimeRangeZoomButton from "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";';

const PAGE_SCOPE: string =
  "<TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>";
const PICKER: string =
  "<TelemetryTimeRangePicker value={timeRange} onChange={(value: RangeStartAndEndDateTime): void => { setTimeRange(value); }} />";

interface HeroPage {
  name: string;
  file: string;
}

/*
 * Pages whose picker lives in the hero (renderHero -> renderRefreshControl
 * -> AutoRefreshControl.timeRangePicker) and whose charts render below it.
 */
const HERO_PAGES: Array<HeroPage> = [
  { name: "Host overview", file: "Pages/Host/View/Overview.tsx" },
  { name: "Host process view", file: "Pages/Host/View/ProcessView.tsx" },
  {
    name: "Host Windows service view",
    file: "Pages/Host/View/ServiceView.tsx",
  },
  {
    name: "Host systemd unit view",
    file: "Pages/Host/View/SystemdUnitView.tsx",
  },
  { name: "VMware vCenter overview", file: "Pages/VMware/View/Index.tsx" },
  { name: "Proxmox cluster overview", file: "Pages/Proxmox/View/Index.tsx" },
];

describe.each(HERO_PAGES)("$name", (page: HeroPage) => {
  const source: string = readSquashed(page.file);

  test("wraps its whole returned tree in a zoom scope over its own range and setter", () => {
    expect(readRaw(page.file)).toContain(SCOPE_IMPORT);
    expect(countOf(source, "<TimeRangeZoomScope ")).toBe(1);
    expect(source).toContain(`return ( ${PAGE_SCOPE} {renderHero()}`);
    expect(source).toMatch(
      /<\/TimeRangeZoomScope> \); \}; export default \w+;/,
    );
  });

  test("keeps one range: the scope's range is the state the picker and the fetches use", () => {
    expect(countOf(source, "useState<RangeStartAndEndDateTime>")).toBe(1);
    expect(source).toContain(
      "const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(DEFAULT_TIME_RANGE);",
    );
    expect(source).toContain(
      "RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange)",
    );
  });

  test("puts the picker inside the scope, so Reset zoom can show beside it", () => {
    const hero: string = between(source, "const renderHero:", "const render");
    const refreshControl: string = between(
      source,
      "const renderRefreshControl:",
      "const render",
    );

    expect(hero).toContain("{renderRefreshControl()}");
    expect(refreshControl).toContain(`timeRangePicker={ ${PICKER} }`);
  });

  test("never hands a chart zoom handlers of its own: every chart takes the page's", () => {
    const charts: Array<string> = source.split("<LineChartElement ").slice(1);

    expect(charts.length).toBeGreaterThan(0);

    for (const chart of charts) {
      const props: string = chart.slice(0, chart.indexOf("/>"));

      expect(props).not.toContain("onTimeRangeSelect");
      expect(props).not.toContain("onTimeRangeReset");
      expect(props).not.toContain("disableTimeRangeZoom");
      expect(props).toContain("xAxis={xAxis}");
    }

    // The page zoom only reaches a time axis, and every axis here is one.
    const axisTypes: Array<string> = Array.from(
      source.matchAll(/type: XAxisType\.(\w+)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(axisTypes.length).toBeGreaterThan(0);
    expect(new Set(axisTypes)).toEqual(new Set(["Time"]));
  });
});

/*
 * A zoom and its reset are two loads in flight; the loads behind the charts
 * commit only if nothing newer has started since.
 */
describe.each([
  ["Host overview", "Pages/Host/View/Overview.tsx", "fetchSeqRef", 2],
  ["Host process view", "Pages/Host/View/ProcessView.tsx", "fetchSeqRef", 3],
  [
    "Host Windows service view",
    "Pages/Host/View/ServiceView.tsx",
    "fetchSeqRef",
    2,
  ],
  [
    "Host systemd unit view",
    "Pages/Host/View/SystemdUnitView.tsx",
    "fetchSeqRef",
    2,
  ],
  [
    "VMware vCenter overview",
    "Pages/VMware/View/Index.tsx",
    "goldenLoadSeqRef",
    1,
  ],
  [
    "Proxmox cluster overview",
    "Pages/Proxmox/View/Index.tsx",
    "goldenLoadSeqRef",
    1,
  ],
])(
  "%s drops a stale response",
  (_name: string, file: string, ref: string, awaitedChecks: number) => {
    const source: string = readSquashed(file);

    test("numbers every load and checks it is still the newest after each await", () => {
      expect(source).toContain(
        `const ${ref}: React.MutableRefObject<number> = useRef<number>(0);`,
      );
      expect(source).toContain(`const seq: number = ++${ref}.current;`);
      expect(source).toContain(`return seq !== ${ref}.current;`);
      expect(
        countOf(source, "if (isStale()) { return; }"),
      ).toBeGreaterThanOrEqual(awaitedChecks);
    });

    test("a superseded load leaves the spinner to the load that replaced it", () => {
      expect(source).toMatch(
        /if \(isStale\(\)\) \{ return; \} setIsRefreshing\(false\);|if \(!isStale\(\)\) \{ setIsRefreshing\(false\);/,
      );
    });
  },
);

describe("section hints on the pages with rows of chart cards", () => {
  test.each([
    ["Pages/Host/View/Overview.tsx", 2],
    ["Pages/Host/View/ProcessView.tsx", 1],
    ["Pages/Host/View/ServiceView.tsx", 1],
    ["Pages/Host/View/SystemdUnitView.tsx", 1],
    ["Pages/VMware/View/Index.tsx", 1],
    ["Pages/Proxmox/View/Index.tsx", 1],
  ])(
    "%s names the gesture at each chart section's heading, revealed on hover",
    (file: string, sections: number) => {
      const source: string = readSquashed(file);

      expect(readRaw(file)).toContain(HINT_IMPORT);
      expect(
        countOf(source, "<TimeRangeZoomHint revealOnHover={true} />"),
      ).toBe(sections);
      // Each hint's section is a hover group, or the hint never shows.
      expect(countOf(source, '<div className="group/zoomhint mb-6">')).toBe(
        sections,
      );
    },
  );

  test("a four-card row keeps its card headers as they were (no hint squeezed into them)", () => {
    for (const file of [
      "Pages/Host/View/Overview.tsx",
      "Pages/VMware/View/Index.tsx",
      "Pages/Proxmox/View/Index.tsx",
    ]) {
      const card: string = between(
        readSquashed(file),
        "const renderChartCard:",
        "const render",
      );

      expect(card).not.toContain("TimeRangeZoomHint");
    }
  });
});

describe("a zoom into a stretch with no samples keeps a way back where the reader looks", () => {
  test.each([
    ["Pages/Host/View/ProcessView.tsx", "No process metrics in range"],
    ["Pages/Host/View/ServiceView.tsx", "No service metrics in range"],
    ["Pages/Host/View/SystemdUnitView.tsx", "No unit metrics in range"],
  ])(
    "%s puts Reset zoom under its no-data note",
    (file: string, title: string) => {
      const note: string = between(
        readSquashed(file),
        `title="${title}"`,
        "</Card>",
      );

      expect(readRaw(file)).toContain(RESET_IMPORT);
      expect(note).toContain("<ResetTimeRangeZoomButton />");
    },
  );

  test("the Proxmox rate chart's empty state takes the double-click", () => {
    const source: string = readSquashed(
      "Components/Proxmox/ProxmoxRateChart.tsx",
    );
    const empty: string = between(
      source,
      "if (series.length === 0) {",
      "const xAxis",
    );

    expect(source).toContain(
      "const zoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();",
    );
    expect(empty).toContain("onDoubleClick={zoom?.onTimeRangeReset}");
  });

  test("the Proxmox rate chart takes the zoom of whatever owns its window", () => {
    const source: string = readSquashed(
      "Components/Proxmox/ProxmoxRateChart.tsx",
    );
    const chart: string = between(source, "<LineChartElement ", "/>");

    expect(chart).not.toContain("onTimeRangeSelect");
    expect(chart).not.toContain("disableTimeRangeZoom");
    expect(chart).toContain("xAxis={xAxis}");
    expect(source).toContain("type: XAxisType.Time,");
  });
});

describe.each([
  ["VMware Insights", "Pages/VMware/View/Insights.tsx", 7],
  ["Proxmox Insights", "Pages/Proxmox/View/Insights.tsx", 5],
])(
  "%s: cards sharing one range share one zoom",
  (_name: string, file: string, cards: number) => {
    const source: string = readSquashed(file);

    test("the scope wraps every card, over the range the cards share", () => {
      expect(readRaw(file)).toContain(SCOPE_IMPORT);
      const tree: string = pageReturn(source);

      expect(tree).toContain(
        "<TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={handleTimeRangeChange} >",
      );
      expect(countOf(tree, "<EmbeddedMetricCard ")).toBe(cards);
      expect(countOf(source, "<EmbeddedMetricCard ")).toBe(cards);
    });

    test("every card's range is the page's, so the card follows the page's zoom", () => {
      const tree: string = pageReturn(source);

      expect(countOf(tree, "timeRange={timeRange}")).toBe(cards + 1);
      expect(countOf(tree, "onTimeRangeChange={handleTimeRangeChange}")).toBe(
        cards + 1,
      );
      expect(countOf(tree, "startAndEndDate={startAndEndDate}")).toBe(cards);
    });

    test("the one setter keeps the range and the resolved window together", () => {
      expect(source).toContain(
        "const handleTimeRangeChange: ( newTimeRange: RangeStartAndEndDateTime, ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => { setTimeRange(newTimeRange); setStartAndEndDate( RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange), ); }, []);",
      );
    });
  },
);

describe("Proxmox Insights rate charts sit inside the scope", () => {
  test("the disk and network rate charts render inside the cards the scope wraps", () => {
    const tree: string = pageReturn(
      readSquashed("Pages/Proxmox/View/Insights.tsx"),
    );

    expect(countOf(tree, "<ProxmoxRateChart ")).toBe(2);
  });
});

describe.each([
  ["Cloud environment overview", "Pages/Cloud/View/Overview.tsx"],
  ["Serverless function overview", "Pages/Serverless/View/Overview.tsx"],
])("%s", (_name: string, file: string) => {
  const source: string = readSquashed(file);

  test("wraps the ResourceOverview - hero picker and charts - in a zoom scope over its own range", () => {
    expect(readRaw(file)).toContain(SCOPE_IMPORT);
    const tree: string = pageReturn(source);

    expect(tree).toContain(PAGE_SCOPE);
    expect(tree).toContain("<ResourceOverview ");
    expect(tree).toContain("charts={charts}");
    expect(tree).toContain(`timeRangePicker={ ${PICKER} }`);
    expect(countOf(source, "useState<RangeStartAndEndDateTime>")).toBe(1);
  });

  test("its charts are ChartCards, which take the page's zoom themselves", () => {
    const charts: string = between(
      source,
      "const charts: ReactElement = (",
      "const quickLinks",
    );

    expect(countOf(charts, "<ChartCard ")).toBe(2);
    expect(charts).not.toContain("onTimeRangeSelect");
  });

  test("the metrics effect drops a response the reader has moved on from", () => {
    const effect: string = between(
      source,
      "RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);",
      "useAutoRefresh({",
    );

    expect(effect).toContain("let ignore: boolean = false;");
    expect(countOf(effect, "if (ignore) { return; }")).toBeGreaterThanOrEqual(
      2,
    );
    expect(effect).toContain("return () => { ignore = true; };");
  });
});

describe("the infrastructure Metrics tab zooms itself", () => {
  test("ResourceMetricsTab leaves the range to its card, which owns the zoom and hands it to the extra charts", () => {
    const tab: string = readSquashed(
      "Components/Infrastructure/ResourceMetricsTab.tsx",
    );
    const card: string = between(tab, "<EmbeddedMetricCard", "/>");

    // Uncontrolled: no page range, so the card zooms its own window.
    expect(card).not.toContain("timeRange=");
    expect(card).toContain("renderExtraCharts={props.renderExtraCharts}");
  });

  test.each([
    "Pages/Proxmox/View/NodeDetail.tsx",
    "Pages/Proxmox/View/GuestDetail.tsx",
  ])("%s draws its rate charts from the tab's own window", (file: string) => {
    const extra: string = between(
      readSquashed(file),
      "renderExtraCharts={",
      "); }}",
    );

    expect(countOf(extra, "<ProxmoxRateChart ")).toBe(2);
    expect(countOf(extra, "startDate={dateRange.startValue}")).toBe(2);
    expect(countOf(extra, "endDate={dateRange.endValue}")).toBe(2);
  });
});

/*
 * Every page in this area that shows a time-series chart AND lets the
 * reader pick its range must zoom: a new page, or a chart added to one that
 * had none (the IoT fleet overview has tiles only), trips this.
 */
describe("no page in the area is left out", () => {
  const AREA_DIRECTORIES: Array<string> = [
    "Pages/Host",
    "Pages/VMware",
    "Pages/Proxmox",
    "Pages/Cloud",
    "Pages/Serverless",
    "Pages/IoT",
    "Pages/Inventory",
    "Components/Host",
    "Components/VMware",
    "Components/Proxmox",
    "Components/Cloud",
    "Components/IoT",
    "Components/Infrastructure",
  ];

  const CHART_TAGS: Array<string> = [
    "<LineChartElement ",
    "<AreaChartElement ",
    "<BarChartElement ",
    "<ChartCard ",
    "<EmbeddedMetricCard ",
    "<MetricView ",
  ];

  function tsxFilesUnder(relativeDirectory: string): Array<string> {
    const absolute: string = path.join(DASHBOARD_SRC, relativeDirectory);

    if (!fs.existsSync(absolute)) {
      return [];
    }

    return fs
      .readdirSync(absolute, { withFileTypes: true })
      .flatMap((entry: fs.Dirent): Array<string> => {
        const child: string = path.join(relativeDirectory, entry.name);

        if (entry.isDirectory()) {
          return tsxFilesUnder(child);
        }

        return entry.name.endsWith(".tsx") ? [child] : [];
      });
  }

  const files: Array<string> = AREA_DIRECTORIES.flatMap(tsxFilesUnder);

  test("the sweep finds the area's pages", () => {
    expect(files).toContain(path.join("Pages", "Host", "View", "Overview.tsx"));
    expect(files).toContain(path.join("Pages", "IoT", "View", "Index.tsx"));
    expect(files.length).toBeGreaterThan(50);
  });

  test("every page with a range picker and a time-series chart wraps itself in a zoom scope", () => {
    const missing: Array<string> = files.filter((file: string): boolean => {
      const source: string = readSquashed(file);
      const pickerOwner: boolean = source.includes(
        "<TelemetryTimeRangePicker ",
      );
      const charted: boolean = CHART_TAGS.some((tag: string): boolean => {
        return source.includes(tag);
      });

      return pickerOwner && charted && !source.includes("<TimeRangeZoomScope ");
    });

    expect(missing).toEqual([]);
  });

  test("every page whose cards share a controlled range wraps them in a zoom scope", () => {
    const missing: Array<string> = files.filter((file: string): boolean => {
      const source: string = readSquashed(file);

      return (
        source.includes("<EmbeddedMetricCard ") &&
        source.includes("timeRange={timeRange}") &&
        !source.includes("<TimeRangeZoomScope ")
      );
    });

    expect(missing).toEqual([]);
  });

  test("the IoT fleet overview has a picker but no chart, so there is nothing to zoom", () => {
    const source: string = readSquashed("Pages/IoT/View/Index.tsx");

    expect(source).toContain("<TelemetryTimeRangePicker ");
    for (const tag of CHART_TAGS) {
      expect(source).not.toContain(tag);
    }
  });

  test("the host flame graph is not a time series and keeps its own frame zoom", () => {
    const source: string = readSquashed("Pages/Host/View/Profiles.tsx");

    expect(source).toContain("<AggregatedFlamegraph ");
    expect(source).not.toContain("TimeRangeZoom");
  });
});
