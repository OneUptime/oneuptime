import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import TimeRangeZoomUtil from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomUtil";
import {
  HistogramSelectionWindow,
  getHistogramSelectionWindow,
} from "Common/UI/Components/Charts/Utils/HistogramSelection";
import DashboardTimeRangeZoomUtil, {
  DashboardTimeRangeZoomState,
} from "Common/Utils/Dashboard/DashboardTimeRangeZoom";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "Zooming Into a Time Range" docs, and the dashboard authoring page's
 * section on zooming, against the product (issue #4105).
 *
 * Markdown is not compiled, so nothing else notices when a page drifts from
 * what the charts do. The page once said a plain click never zooms while the
 * explorers' volume charts zoomed on one, quoted "Drag to zoom" where those
 * charts said "Click or drag to zoom", and promised every hint would wait to
 * be pointed at. So the checks here hold the page to two kinds of evidence:
 *
 *   - the words a reader meets on screen, read out of the components that
 *     render them (hints, the reset button, the picker's presets), in both
 *     directions: every hint the charts show is quoted, and the page quotes
 *     no hint the charts do not show;
 *   - the zoom rules themselves, run for real where they are pure functions
 *     (where a zoom ends, what a click on one bar selects, the dashboard's
 *     zoom and reset), and, where a rule lives in wiring, the code that wires
 *     it (which charts hand the selection hook a bucket width, which pages
 *     wrap a zoom scope).
 *
 * App's jest runs in node and cannot render React. The promises that need a
 * rendered page - one reset climbs all the way out, any chart resets the
 * zoom, picking a range starts over, a plain click on a line chart is not a
 * zoom while a click on a volume-chart bar is, the hints the charts render -
 * are checked against the same page in Common's
 * Tests/UI/Components/Charts/TimeRangeZoom/ZoomDocsPromises.test.tsx. The
 * panels that stay on now while a zoom retimes the rest are pinned on the
 * Kubernetes cluster overview by Common's
 * Tests/App/Dashboard/KubernetesClusterOverviewZoom.test.tsx.
 */

// The packages/ folder: every path below is relative to it.
const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);
const ZOOM_PAGE: string = "telemetry/charts-and-time-ranges";
const ZOOM_URL: string = `/docs/${ZOOM_PAGE}`;
const DASHBOARD_PAGE: string = "dashboards/authoring";

const DASHBOARD_SRC: string = "App/FeatureSet/Dashboard/src";
const PUBLIC_DASHBOARD_SRC: string = "App/FeatureSet/PublicDashboard/src";
const COMMON_UI: string = "Common/UI";

const MINUTE_MS: number = 60 * 1000;
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

/*
 * Hoisted rather than written inline in the `.test()` calls below: eslint's
 * wrap-regex and prettier disagree about parentheses around a regex literal
 * that a method is called on.
 */
// A pointer gesture...
const POINTER_GESTURE_PATTERN: RegExp = /\b(?:click|drag)\b/i;
// ...and what it does to the zoom.
const ZOOM_EFFECT_PATTERN: RegExp =
  /\bto (?:zoom|reset)\b|\bzoom (?:out|in)\b/i;
const SOURCE_FILE_PATTERN: RegExp = /\.tsx?$/;
const DECLARATION_FILE_PATTERN: RegExp = /\.d\.ts$/;
// A zoom provider handed a zoom, rather than one withdrawing it (null).
const PROVIDED_ZOOM_PATTERN: RegExp =
  /<TimeRangeZoomProvider zoom=\{(?!null\})/;
// What a component uses to take part in the time-range zoom.
const TIME_RANGE_ZOOM_WIRING_PATTERN: RegExp =
  /TimeRangeZoom|onTimeRangeSelect|onTimeRangeReset|useHistogramRangeSelection|onZoomOut/;

function readPage(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, "en", `${page}.md`), "utf8");
}

/*
 * The page as a reader takes it in: a phrase the markdown wraps over two
 * lines still reads as one.
 */
function readProse(page: string): string {
  return readPage(page).replace(/\s+/g, " ");
}

// One "## " section of a page, as prose, up to the next "## " heading.
function readSection(page: string, heading: string): string {
  const prose: string = readProse(page);
  const start: number = prose.indexOf(`## ${heading}`);
  if (start < 0) {
    throw new Error(`${page} has no "## ${heading}" section`);
  }
  const next: number = prose.indexOf("## ", start + heading.length + 3);
  return next < 0 ? prose.slice(start) : prose.slice(start, next);
}

// Every **bold** phrase of a page: how it quotes what is on screen.
function boldPhrases(page: string): Array<string> {
  return Array.from(
    readProse(page).matchAll(/\*\*([^*]+)\*\*/g),
    (match: RegExpMatchArray): string => {
      return match[1]!.trim();
    },
  );
}

function readSource(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_ROOT, relative), "utf8");
}

/*
 * A source with its comments removed and its whitespace squashed: what the
 * component does rather than what its comments say, independent of how
 * prettier wraps it. A // inside a string (a URL) is left alone.
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function unique(values: Array<string>): Array<string> {
  return Array.from(new Set(values));
}

// The text a component can put on screen: its strings and its JSX text.
function literalTexts(code: string): Array<string> {
  const texts: Array<string> = [];
  for (const pattern of [/"([^"]*)"/g, /`([^`]*)`/g, />([^<>{}]*)</g]) {
    for (const match of code.matchAll(pattern)) {
      texts.push(match[1] || "");
    }
  }
  return texts;
}

/*
 * Whether a phrase tells the reader how to zoom or how to get back: it
 * names a pointer gesture and what it does to the zoom.
 */
function isZoomGestureHint(phrase: string): boolean {
  return (
    POINTER_GESTURE_PATTERN.test(phrase) && ZOOM_EFFECT_PATTERN.test(phrase)
  );
}

/*
 * The zoom hints a component can show. " · " joins two of them into one
 * line ("Drag to zoom · double-click to reset"), so each part is a hint of
 * its own, and a part built from a shared constant (`${...} · ...`) leaves
 * only its literal half, which the constant's own file accounts for.
 */
function zoomHintsIn(relative: string): Array<string> {
  return unique(
    literalTexts(readCode(relative))
      .flatMap((text: string): Array<string> => {
        return text.split("·");
      })
      .map((part: string): string => {
        return part.trim();
      })
      .filter((part: string): boolean => {
        return !part.includes("${") && isZoomGestureHint(part);
      }),
  );
}

function allNavLinks(): Array<NavLink> {
  return DocsNav.flatMap((group: NavGroup): Array<NavLink> => {
    return group.links;
  });
}

function sourceFilesUnder(relativeDir: string): Array<string> {
  const files: Array<string> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(path.join(PACKAGES_ROOT, dir), {
      withFileTypes: true,
    })) {
      const relative: string = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "build") {
          walk(relative);
        }
      } else if (
        SOURCE_FILE_PATTERN.test(entry.name) &&
        !DECLARATION_FILE_PATTERN.test(entry.name)
      ) {
        files.push(relative);
      }
    }
  };
  walk(relativeDir);
  return files;
}

function productSourceFiles(): Array<string> {
  return [
    ...sourceFilesUnder(COMMON_UI),
    ...sourceFilesUnder(DASHBOARD_SRC),
    ...sourceFilesUnder(PUBLIC_DASHBOARD_SRC),
  ];
}

/*
 * The options object a component hands the shared histogram selection
 * hook: the text between `useHistogramRangeSelection({` and its closing
 * brace.
 */
function histogramSelectionOptionsIn(relative: string): string {
  const code: string = readCode(relative);
  const call: string = "useHistogramRangeSelection({";
  const start: number = code.indexOf(call);
  if (start < 0) {
    throw new Error(`${relative} does not call ${call}`);
  }
  let depth: number = 0;
  for (
    let index: number = start + call.length - 1;
    index < code.length;
    index++
  ) {
    if (code[index] === "{") {
      depth++;
    } else if (code[index] === "}") {
      depth--;
      if (depth === 0) {
        return code.slice(start + call.length, index);
      }
    }
  }
  throw new Error(`${relative}: unbalanced ${call}`);
}

// Whether a component owns a zoom the charts below it take part in.
function wrapsAZoomScope(code: string): boolean {
  return (
    code.includes("<TimeRangeZoomScope") || PROVIDED_ZOOM_PATTERN.test(code)
  );
}

function customRange(start: Date, end: Date): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(start, end),
  };
}

function windowOf(range: RangeStartAndEndDateTime): string {
  const window: InBetween<Date> =
    RangeStartAndEndDateTimeUtil.getStartAndEndDate(range);
  return `${window.startValue.toISOString()}/${window.endValue.toISOString()}`;
}

function minutesBefore(date: Date, minutes: number): Date {
  return new Date(date.getTime() - minutes * MINUTE_MS);
}

/*
 * Every component that words a time-range zoom hint of its own. A new
 * wording belongs on the page; see "quotes every zoom hint the charts show".
 */
const HINT_SOURCES: Array<string> = [
  `${COMMON_UI}/Components/Charts/TimeRangeZoom/TimeRangeZoomHint.tsx`,
  `${COMMON_UI}/Components/Charts/ChartGroup/ChartGroup.tsx`,
  `${COMMON_UI}/Components/LogsViewer/components/LogsHistogram.tsx`,
  `${COMMON_UI}/Components/TelemetryViewer/components/TelemetryHistogram.tsx`,
  `${COMMON_UI}/Components/LogsViewer/components/LogsAnalyticsView.tsx`,
  `${DASHBOARD_SRC}/Components/Traces/TracesAnalyticsView.tsx`,
  `${DASHBOARD_SRC}/Components/Dashboard/Components/DashboardWidgetZoomHint.tsx`,
];

/*
 * Whether a component takes part in the time-range zoom at all. Zoom
 * wording elsewhere - a flame graph zooming into a frame, a map zooming on
 * scroll - is not about a page's time range, and the page says nothing
 * about it.
 */
function takesPartInTimeRangeZoom(code: string): boolean {
  return TIME_RANGE_ZOOM_WIRING_PATTERN.test(code);
}

/*
 * The charts built on the shared histogram selection hook. It zooms into a
 * single bar on a click exactly when it is handed the bucket width, so
 * whether a host hands it over decides what a click on its bars does.
 */
const CLICK_TO_ZOOM_HOSTS: Array<string> = [
  `${COMMON_UI}/Components/LogsViewer/components/LogsHistogram.tsx`,
  `${COMMON_UI}/Components/TelemetryViewer/components/TelemetryHistogram.tsx`,
  `${COMMON_UI}/Components/LogsViewer/components/LogsAnalyticsView.tsx`,
  `${DASHBOARD_SRC}/Components/Traces/TracesAnalyticsView.tsx`,
];

const DRAG_ONLY_HOSTS: Array<string> = [
  `${DASHBOARD_SRC}/Components/Logs/ErrorPatternDetail.tsx`,
  `${DASHBOARD_SRC}/Components/Exceptions/ExceptionOccurrenceTrend.tsx`,
  `${DASHBOARD_SRC}/Components/Dashboard/Utils/UseDashboardHistogramZoom.ts`,
];

interface ZoomSurface {
  // How the page names the surface.
  phrase: string;
  // The components that make it zoom.
  sources: Array<string>;
}

// Everything "## Where it works" says a drag retimes.
const PAGE_ZOOM_SURFACES: Array<ZoomSurface> = [
  {
    phrase: "Kubernetes clusters",
    sources: [
      `${DASHBOARD_SRC}/Pages/Kubernetes/View/Index.tsx`,
      `${DASHBOARD_SRC}/Pages/Kubernetes/View/Insights.tsx`,
    ],
  },
  {
    phrase: "Docker",
    sources: [`${DASHBOARD_SRC}/Pages/Docker/View/Overview.tsx`],
  },
  {
    phrase: "Podman and Docker Swarm hosts",
    sources: [
      `${DASHBOARD_SRC}/Pages/Podman/View/Overview.tsx`,
      `${DASHBOARD_SRC}/Pages/DockerSwarm/View/Insights.tsx`,
    ],
  },
  {
    phrase: "hosts and their processes, services and systemd units",
    sources: [
      `${DASHBOARD_SRC}/Pages/Host/View/Overview.tsx`,
      `${DASHBOARD_SRC}/Pages/Host/View/ProcessView.tsx`,
      `${DASHBOARD_SRC}/Pages/Host/View/ServiceView.tsx`,
      `${DASHBOARD_SRC}/Pages/Host/View/SystemdUnitView.tsx`,
    ],
  },
  {
    phrase: "VMware",
    sources: [
      `${DASHBOARD_SRC}/Pages/VMware/View/Index.tsx`,
      `${DASHBOARD_SRC}/Pages/VMware/View/Insights.tsx`,
    ],
  },
  {
    phrase: "Proxmox",
    sources: [
      `${DASHBOARD_SRC}/Pages/Proxmox/View/Index.tsx`,
      `${DASHBOARD_SRC}/Pages/Proxmox/View/Insights.tsx`,
    ],
  },
  {
    phrase: "Ceph",
    sources: [
      `${DASHBOARD_SRC}/Pages/Ceph/View/Index.tsx`,
      `${DASHBOARD_SRC}/Pages/Ceph/View/Insights.tsx`,
    ],
  },
  {
    phrase: "databases",
    sources: [`${DASHBOARD_SRC}/Pages/Database/View/Overview.tsx`],
  },
  {
    phrase: "cloud resources",
    sources: [`${DASHBOARD_SRC}/Pages/Cloud/View/Overview.tsx`],
  },
  {
    phrase: "serverless functions",
    sources: [`${DASHBOARD_SRC}/Pages/Serverless/View/Overview.tsx`],
  },
  {
    phrase: "services and RUM applications",
    sources: [
      `${DASHBOARD_SRC}/Pages/Service/View/Index.tsx`,
      `${DASHBOARD_SRC}/Pages/Rum/View/Overview.tsx`,
    ],
  },
  {
    phrase: "network devices' metrics and traffic",
    sources: [
      `${DASHBOARD_SRC}/Components/NetworkDevice/DeviceHealthCharts.tsx`,
      `${DASHBOARD_SRC}/Components/NetworkDevice/FlowTopTalkers.tsx`,
    ],
  },
  {
    phrase: "metric cards",
    sources: [`${DASHBOARD_SRC}/Components/Metrics/EmbeddedMetricCard.tsx`],
  },
  {
    phrase: "a monitor's metrics",
    sources: [`${DASHBOARD_SRC}/Components/Monitor/MonitorMetrics.tsx`],
  },
  {
    phrase: "the metric explorer",
    sources: [`${DASHBOARD_SRC}/Components/Metrics/MetricExplorer.tsx`],
  },
  {
    phrase: "SLO history charts",
    sources: [`${DASHBOARD_SRC}/Components/Slo/SloHistoryCharts.tsx`],
  },
  {
    phrase: "Logs Insights",
    sources: [`${DASHBOARD_SRC}/Components/Logs/LogsDashboard.tsx`],
  },
  {
    phrase:
      "log, trace, exception and security-event volume charts, and the log and trace analytics charts, which retime the explorer they belong to",
    sources: [
      `${COMMON_UI}/Components/LogsViewer/LogsViewer.tsx`,
      `${COMMON_UI}/Components/TelemetryViewer/TelemetryViewer.tsx`,
    ],
  },
];

// Everything the page says zooms only a window of its own.
const OWN_WINDOW_SURFACES: Array<ZoomSurface> = [
  {
    phrase: "a metric preview in a monitor's form",
    sources: [
      `${DASHBOARD_SRC}/Components/Monitor/MonitorSteps/MonitorStepMetricPreview.tsx`,
      `${DASHBOARD_SRC}/Components/Form/Monitor/MetricMonitor/MetricMonitorStepForm.tsx`,
    ],
  },
  {
    phrase: "an exception's Occurrence Trend",
    sources: [
      `${DASHBOARD_SRC}/Components/Exceptions/ExceptionOccurrenceTrend.tsx`,
    ],
  },
  {
    phrase: "a chart opened in a pop-up or in the Investigate panel",
    sources: [
      `${DASHBOARD_SRC}/Components/DatabaseServer/DatabaseMetricChartModal.tsx`,
      `${DASHBOARD_SRC}/Components/Telemetry/InvestigationDrawer.tsx`,
    ],
  },
  {
    phrase: "charts in AI chat answers",
    sources: [`${DASHBOARD_SRC}/Components/AIChat/Widgets/ChartWidget.tsx`],
  },
];

// Everything "## Charts that don't zoom" lists.
const NON_ZOOMING_CHARTS: Array<ZoomSurface> = [
  {
    phrase: "uptime history strips (one bar per day)",
    sources: [`${COMMON_UI}/Components/MonitorGraphs/Uptime.tsx`],
  },
  {
    phrase: "the small trend sparklines in metric lists",
    sources: [
      `${DASHBOARD_SRC}/Components/Metrics/MetricSparkline.tsx`,
      `${COMMON_UI}/Components/Charts/ChartLibrary/SparkChart/SparkChart.tsx`,
    ],
  },
  {
    phrase: "a network device's round-trip time over the past hour",
    sources: [
      `${DASHBOARD_SRC}/Components/NetworkDevice/DeviceLatencyTrend.tsx`,
    ],
  },
];

describe("Zooming Into a Time Range docs: where the page lives", () => {
  it("is in the Telemetry nav, right after the search syntax", () => {
    const telemetry: NavGroup | undefined = DocsNav.find(
      (group: NavGroup): boolean => {
        return group.title === "Telemetry";
      },
    );
    expect(telemetry).toBeDefined();

    const urls: Array<string> = telemetry!.links.map(
      (link: NavLink): string => {
        return link.url;
      },
    );
    expect(urls).toContain(ZOOM_URL);
    expect(urls.indexOf(ZOOM_URL)).toBe(
      urls.indexOf("/docs/telemetry/search-syntax") + 1,
    );
  });

  it("is listed exactly once", () => {
    expect(
      allNavLinks().filter((link: NavLink): boolean => {
        return link.url === ZOOM_URL;
      }),
    ).toHaveLength(1);
  });

  it("links only to docs pages that exist", () => {
    for (const page of [ZOOM_PAGE, DASHBOARD_PAGE]) {
      const links: Array<string> = Array.from(
        readPage(page).matchAll(/\]\((\/docs\/[^)#]+)\)/g),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );

      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        const file: string = path.join(
          CONTENT_DIR,
          "en",
          `${link.replace("/docs/", "")}.md`,
        );
        expect(fs.existsSync(file)).toBe(true);
      }
    }
  });
});

describe("Zooming Into a Time Range docs: the words a reader meets on screen", () => {
  it("names the reset button the way the button reads and announces itself", () => {
    const button: string = readCode(
      `${COMMON_UI}/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton.tsx`,
    );

    expect(button).toContain('aria-label="Reset zoom"');
    // The visible label, after the icon.
    expect(button).toMatch(/\/> Reset zoom <\/button>/);

    expect(readProse(ZOOM_PAGE)).toContain(
      "a **Reset zoom** button appears next to the page's time-range picker",
    );
    expect(readProse(DASHBOARD_PAGE)).toContain(
      "A **Reset zoom** button appears next to the time-range picker",
    );
  });

  it("finds the hints it checks in the components that render them", () => {
    const hintsBySource: Record<string, Array<string>> = {};
    for (const source of HINT_SOURCES) {
      hintsBySource[source] = zoomHintsIn(source);
    }

    // Guards the extraction itself: these are the words on screen today.
    expect(hintsBySource[HINT_SOURCES[0]!]).toEqual([
      "Drag to zoom",
      "Double-click to reset",
    ]);
    expect(hintsBySource[HINT_SOURCES[1]!]).toEqual(
      expect.arrayContaining(["Drag to zoom", "double-click to reset"]),
    );
    for (const histogram of [HINT_SOURCES[2]!, HINT_SOURCES[3]!]) {
      expect(hintsBySource[histogram]).toEqual(
        expect.arrayContaining([
          "Click or drag to zoom",
          "Drag to zoom",
          "Double-click to reset",
        ]),
      );
    }
    for (const analytics of [HINT_SOURCES[4]!, HINT_SOURCES[5]!]) {
      expect(hintsBySource[analytics]).toEqual(
        expect.arrayContaining([
          "Click or drag to zoom",
          "Drag to zoom",
          "double-click to reset",
        ]),
      );
    }
    expect(hintsBySource[HINT_SOURCES[6]!]).toEqual(["double-click to reset"]);
  });

  it("quotes every zoom hint the charts show", () => {
    const quoted: Array<string> = boldPhrases(ZOOM_PAGE).map(
      (phrase: string): string => {
        return phrase.toLowerCase();
      },
    );

    const missing: Array<string> = unique(
      HINT_SOURCES.flatMap((source: string): Array<string> => {
        return zoomHintsIn(source).filter((hint: string): boolean => {
          return !quoted.includes(hint.toLowerCase());
        });
      }),
    );

    expect(missing).toEqual([]);
  });

  it("quotes no zoom hint the charts do not show", () => {
    const shown: Array<string> = HINT_SOURCES.flatMap(
      (source: string): Array<string> => {
        return zoomHintsIn(source).map((hint: string): string => {
          return hint.toLowerCase();
        });
      },
    );

    const invented: Array<string> = boldPhrases(ZOOM_PAGE).filter(
      (phrase: string): boolean => {
        return (
          isZoomGestureHint(phrase) && !shown.includes(phrase.toLowerCase())
        );
      },
    );

    expect(invented).toEqual([]);
  });

  it("has checked every component that words a time-range zoom hint", () => {
    for (const source of HINT_SOURCES) {
      expect(takesPartInTimeRangeZoom(readCode(source))).toBe(true);
    }

    const unchecked: Array<string> = productSourceFiles().filter(
      (file: string): boolean => {
        return (
          !HINT_SOURCES.includes(file) &&
          takesPartInTimeRangeZoom(readCode(file)) &&
          zoomHintsIn(file).length > 0
        );
      },
    );

    /*
     * A zoomable chart with wording of its own: quote it on the page (or
     * reuse TimeRangeZoomHint's words), then list it in HINT_SOURCES.
     */
    expect(unchecked).toEqual([]);
  });

  it("says which charts always name the gesture and which only on pointing", () => {
    const hintCode: string = readCode(HINT_SOURCES[0]!);
    const chartGroupCode: string = readCode(HINT_SOURCES[1]!);
    const prose: string = readProse(ZOOM_PAGE);

    // A card's hint can hide until pointed at, or tabbed into.
    expect(hintCode).toContain("group-hover/zoomhint:opacity-100");
    expect(hintCode).toContain(
      "group-has-[:focus-visible]/zoomhint:opacity-100",
    );
    // The metric charts' header hint cannot: it is never transparent.
    expect(chartGroupCode).not.toContain("opacity-0");

    expect(prose).toContain(
      "Metric cards, the metric explorer and the explorers' volume charts always show the hint.",
    );
    expect(prose).toContain(
      "it appears only while you point at the card or tab into it.",
    );
    // Not the old promise that every hint waits to be pointed at.
    expect(prose).not.toContain("hint appears on a chart when you point at it");
  });

  it("names the presets the way the time-range picker labels them", () => {
    const picker: string = readCode(
      `${COMMON_UI}/Components/Date/TimeRangePickerDropdown.tsx`,
    );
    const presets: Array<string> = Array.from(
      readProse(ZOOM_PAGE).matchAll(/"(Past [^"]+)"/g),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(presets.length).toBeGreaterThan(0);
    for (const preset of presets) {
      expect(picker).toContain(`label: "${preset}"`);
    }
  });
});

describe("Zooming Into a Time Range docs: what a click does", () => {
  it("a click on one bar is a window only when the chart knows how wide a bar is", () => {
    const bar: string = "2026-09-28 11:00:00";

    // What a click on one bar selects, with the bucket width handed over...
    const clicked: HistogramSelectionWindow | null =
      getHistogramSelectionWindow({
        fromBucket: bar,
        toBucket: bar,
        bucketIntervalMs: 5 * MINUTE_MS,
      });
    expect(clicked).not.toBeNull();
    expect(clicked!.endTime.getTime() - clicked!.startTime.getTime()).toBe(
      5 * MINUTE_MS,
    );

    // ...and without it: nothing, so the click is not a zoom.
    expect(
      getHistogramSelectionWindow({ fromBucket: bar, toBucket: bar }),
    ).toBeNull();

    // A drag across bars is a window either way.
    expect(
      getHistogramSelectionWindow({
        fromBucket: bar,
        toBucket: "2026-09-28 11:10:00",
      }),
    ).not.toBeNull();
  });

  it("the explorers' volume charts and the analytics charts hand the bucket width over and say so", () => {
    for (const host of CLICK_TO_ZOOM_HOSTS) {
      expect(histogramSelectionOptionsIn(host)).toMatch(/\bbucketIntervalMs:/);
      expect(readCode(host)).toContain(
        'selection.canClickToZoom ? "Click or drag to zoom" : "Drag to zoom"',
      );
    }

    // The explorers draw those volume charts with the width they bucketed by.
    expect(
      readCode(`${COMMON_UI}/Components/LogsViewer/LogsViewer.tsx`),
    ).toContain("bucketIntervalMs={props.histogramBucketIntervalMs}");
    expect(
      readCode(`${COMMON_UI}/Components/TelemetryViewer/TelemetryViewer.tsx`),
    ).toContain("bucketIntervalMs={props.histogramBucketIntervalMs}");
    for (const explorer of [
      `${DASHBOARD_SRC}/Components/Logs/LogsViewer.tsx`,
      `${DASHBOARD_SRC}/Components/Traces/TracesViewer.tsx`,
      `${DASHBOARD_SRC}/Components/Exceptions/ExceptionsViewer.tsx`,
      `${DASHBOARD_SRC}/Components/SecurityEvents/SecurityEventsViewer.tsx`,
    ]) {
      expect(readCode(explorer)).toContain("histogramBucketIntervalMs=");
    }

    const prose: string = readProse(ZOOM_PAGE);
    expect(prose).toContain(
      "**On the explorers' volume charts, a click on one bar zooms into that bar.**",
    );
    expect(prose).toContain(
      "The volume charts of the log, trace, exception and security-event explorers, and the log and trace analytics charts, zoom into the bars you drag across, or into the single bar you click.",
    );
    expect(prose).toContain("These charts say **Click or drag to zoom**.");
  });

  it("the error-pattern timeline, the Occurrence Trend and the dashboard histograms withhold it, so a click there is no zoom", () => {
    for (const host of DRAG_ONLY_HOSTS) {
      expect(histogramSelectionOptionsIn(host)).not.toContain(
        "bucketIntervalMs",
      );
    }

    const prose: string = readProse(ZOOM_PAGE);
    expect(prose).toContain(
      "**On line, area and bar charts, a plain click is not a zoom.**",
    );
    expect(prose).toContain("monitors and every chart on a dashboard.");
    expect(prose).toContain(
      "The error-pattern timeline in Logs Insights and an exception's Occurrence Trend also zoom on a drag only.",
    );
  });

  it("knows how a click behaves on every chart built on the histogram selection hook", () => {
    const hosts: Array<string> = productSourceFiles().filter(
      (file: string): boolean => {
        return readCode(file).includes("useHistogramRangeSelection({");
      },
    );

    /*
     * A new chart on the hook: decide whether a click on one of its bars
     * zooms, say so on the page, then list it above.
     */
    expect(hosts.sort()).toEqual(
      [...CLICK_TO_ZOOM_HOSTS, ...DRAG_ONLY_HOSTS].sort(),
    );
  });

  it("no longer says, for every chart, that a plain click is not a zoom", () => {
    expect(readProse(ZOOM_PAGE)).not.toContain(
      "**A plain click is not a zoom.**",
    );
  });

  it("says a click on a zoomed chart's plot waits, so the double-click can be told apart", () => {
    /*
     * Each chart holds its plot clicks back exactly while it offers the
     * reset, which a page offers only while it is zoomed (see
     * TimeRangeZoomProvider). The wait itself is rendered in Common's
     * ZoomDocsPromises.test.tsx.
     */
    for (const chart of ["LineChart", "AreaChart", "BarChart"]) {
      expect(
        readCode(
          `${COMMON_UI}/Components/Charts/ChartLibrary/${chart}/${chart}.tsx`,
        ),
      ).toContain("useDeferredChartClick( Boolean(onTimeRangeReset), )");
    }
    expect(
      readCode(
        `${COMMON_UI}/Components/Charts/TimeRangeZoom/TimeRangeZoomContext.tsx`,
      ),
    ).toContain("onTimeRangeReset: isZoomed ? resetZoom : undefined");

    expect(readProse(ZOOM_PAGE)).toContain(
      "While a zoom is active, a click on a chart's plot takes effect a moment later, so that it can be told apart from the double-click that resets.",
    );
  });

  it("says a double-click resets a zoom while the charts are still loading, as every chart's double-click does (issue #4116)", () => {
    /*
     * Right after a zoom the charts refetch, and new data landing during a
     * double-click used to cost it the browser's dblclick. Both selection
     * hooks reset from the double-click's second press instead (see
     * useDoubleClickReset), and the loaders and empty boxes that stand in
     * for a chart while its window loads, or holds nothing, take the
     * double-click too. The gestures themselves are rendered in Common's
     * DoubleClickReset, HistogramRangeSelectionDataChange and
     * ViewerDoubleClickResetUnderDataChange tests.
     */
    for (const hook of [
      `${COMMON_UI}/Components/Charts/Utils/useHistogramRangeSelection.ts`,
      `${COMMON_UI}/Components/Charts/ChartLibrary/Utils/UseChartRangeSelection.ts`,
    ]) {
      expect(readCode(hook)).toContain("useDoubleClickReset(");
    }

    for (const placeholderHost of [
      `${COMMON_UI}/Components/TelemetryViewer/components/TelemetryHistogram.tsx`,
      `${COMMON_UI}/Components/LogsViewer/components/LogsHistogram.tsx`,
      `${COMMON_UI}/Components/LogsViewer/components/LogsAnalyticsView.tsx`,
      `${DASHBOARD_SRC}/Components/Traces/TracesAnalyticsView.tsx`,
      `${DASHBOARD_SRC}/Components/Exceptions/ExceptionOccurrenceTrend.tsx`,
    ]) {
      const code: string = readCode(placeholderHost);
      const loader: number = code.indexOf("<ComponentLoader />");

      // The loader's own box, the markup just before it, takes the double-click.
      expect(loader).toBeGreaterThan(-1);
      expect(code.slice(Math.max(0, loader - 400), loader)).toContain(
        "selection.onDoubleClick",
      );
    }

    expect(readProse(ZOOM_PAGE)).toContain(
      "**You don't have to wait for the charts to load to go back.** Right after a zoom, while the charts are still fetching the window you dragged out, or when that window turns out to be empty, a double-click on a chart resets the zoom straight away.",
    );
  });
});

describe("Zooming Into a Time Range docs: the zoom rules, run for real", () => {
  beforeEach(() => {
    /*
     * Only Date needs faking; the sinon backend jest 28 uses cannot hijack
     * the read-only `performance` global on current Node, so leave the
     * timer/callback APIs alone.
     */
    jest.useFakeTimers({
      doNotFake: [
        "performance",
        "hrtime",
        "queueMicrotask",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ],
    });
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("a zoom never runs past now", () => {
    // A drag onto the newest bar, which is still filling up until 12:05.
    const zoomed: RangeStartAndEndDateTime | null =
      TimeRangeZoomUtil.getZoomedRange({
        startTime: minutesBefore(NOW, 10),
        endTime: new Date(NOW.getTime() + 5 * MINUTE_MS),
        currentRange: { range: TimeRange.PAST_ONE_HOUR },
      });

    expect(zoomed).not.toBeNull();
    expect(windowOf(zoomed!)).toBe(
      `${minutesBefore(NOW, 10).toISOString()}/${NOW.toISOString()}`,
    );

    expect(readProse(ZOOM_PAGE)).toContain(
      "**A zoom never runs past now.** The newest bucket of a chart is usually still filling up; a drag that ends on it is cut at the current time.",
    );
  });

  it("a zoomed window is fixed while a preset rolls forward", () => {
    const zoomed: RangeStartAndEndDateTime | null =
      TimeRangeZoomUtil.getZoomedRange({
        startTime: minutesBefore(NOW, 20),
        endTime: minutesBefore(NOW, 10),
        currentRange: { range: TimeRange.PAST_THIRTY_MINS },
      });
    const preset: RangeStartAndEndDateTime = {
      range: TimeRange.PAST_THIRTY_MINS,
    };

    expect(zoomed!.range).toBe(TimeRange.CUSTOM);
    const zoomedBefore: string = windowOf(zoomed!);
    const presetBefore: string = windowOf(preset);

    // An auto-refresh tick ten minutes later.
    jest.setSystemTime(new Date(NOW.getTime() + 10 * MINUTE_MS));

    expect(windowOf(zoomed!)).toBe(zoomedBefore);
    expect(windowOf(preset)).not.toBe(presetBefore);

    expect(readProse(ZOOM_PAGE)).toContain(
      '**A zoomed window is fixed.** "Past 30 Minutes" rolls forward with the clock; a zoom is a fixed window, so it stops rolling while auto-refresh is on.',
    );
  });

  it("a press that never leaves its bucket is no window to zoom to", () => {
    expect(
      TimeRangeZoomUtil.getZoomedRange({
        startTime: minutesBefore(NOW, 5),
        endTime: minutesBefore(NOW, 5),
        currentRange: { range: TimeRange.PAST_ONE_HOUR },
      }),
    ).toBeNull();

    expect(readProse(ZOOM_PAGE)).toContain(
      "Only a drag across buckets zooms, so clicking a point, a bar or a legend entry keeps doing what it did before.",
    );
  });

  it("a zoom hands the page a custom range, the same kind of range a custom pick in the picker does", () => {
    const start: Date = minutesBefore(NOW, 40);
    const end: Date = minutesBefore(NOW, 25);
    const zoomed: RangeStartAndEndDateTime | null =
      TimeRangeZoomUtil.getZoomedRange({
        startTime: start,
        endTime: end,
        currentRange: { range: TimeRange.PAST_ONE_HOUR },
      });

    expect(TimeRangeZoomUtil.isSameRange(zoomed, customRange(start, end))).toBe(
      true,
    );

    // The zoom goes through the page's own range setter, as the picker does.
    expect(
      readCode(
        `${COMMON_UI}/Components/Charts/TimeRangeZoom/TimeRangeZoomContext.tsx`,
      ),
    ).toContain(
      "useTimeRangeZoom({ timeRange: props.timeRange, onTimeRangeChange: props.onTimeRangeChange, })",
    );

    const prose: string = readProse(ZOOM_PAGE);
    expect(prose).toContain(
      "The page's time range moves to the window you dragged out, exactly as if you had picked it in the time-range picker.",
    );
    expect(prose).toContain(
      "Every chart, and every tile or table worked out from the page's time range, re-queries for it, so you read one moment across all of them.",
    );
  });

  it("on a dashboard: one reset undoes every drill-in, and a reset with nothing to undo does nothing", () => {
    const pastHour: RangeStartAndEndDateTime = {
      range: TimeRange.PAST_ONE_HOUR,
    };
    const initial: DashboardTimeRangeZoomState =
      DashboardTimeRangeZoomUtil.getInitialState(pastHour);

    // A stray double-click on a board that is not zoomed.
    expect(DashboardTimeRangeZoomUtil.resetZoom(initial)).toBe(initial);

    const once: DashboardTimeRangeZoomState =
      DashboardTimeRangeZoomUtil.zoomToWindow(
        initial,
        minutesBefore(NOW, 40),
        minutesBefore(NOW, 20),
      );
    const twice: DashboardTimeRangeZoomState =
      DashboardTimeRangeZoomUtil.zoomToWindow(
        once,
        minutesBefore(NOW, 35),
        minutesBefore(NOW, 30),
      );

    expect(twice.current.range).toBe(TimeRange.CUSTOM);
    expect(DashboardTimeRangeZoomUtil.resetZoom(twice).current).toBe(pastHour);

    // A range picked in the picker is a new starting point.
    const picked: DashboardTimeRangeZoomState =
      DashboardTimeRangeZoomUtil.selectRange(twice, {
        range: TimeRange.PAST_ONE_DAY,
      });
    expect(DashboardTimeRangeZoomUtil.isZoomed(picked)).toBe(false);

    const prose: string = readProse(DASHBOARD_PAGE);
    expect(prose).toContain(
      "**Double-click any chart** to undo it: the dashboard goes back to the range it had before you started zooming, however many times you drilled in.",
    );
    expect(prose).toContain(
      "double-clicking a dashboard that isn't zoomed does nothing.",
    );
    expect(prose).toContain("A zoomed window is a fixed one");
  });

  it("on a dashboard, too, a zoom never runs past now", () => {
    const zoomed: DashboardTimeRangeZoomState =
      DashboardTimeRangeZoomUtil.zoomToWindow(
        DashboardTimeRangeZoomUtil.getInitialState({
          range: TimeRange.PAST_ONE_HOUR,
        }),
        minutesBefore(NOW, 10),
        new Date(NOW.getTime() + 5 * MINUTE_MS),
      );

    expect(windowOf(zoomed.current)).toBe(
      `${minutesBefore(NOW, 10).toISOString()}/${NOW.toISOString()}`,
    );

    // The rule the product-wide page states holds on the board as well.
    expect(readProse(ZOOM_PAGE)).toContain("**A zoom never runs past now.**");
    expect(readProse(DASHBOARD_PAGE)).toContain(
      "The same gestures work on the charts throughout OneUptime",
    );
  });
});

describe("Zooming Into a Time Range docs: what zooms, and how far", () => {
  it("every surface listed under Where it works wraps a zoom its charts take part in", () => {
    const section: string = readSection(ZOOM_PAGE, "Where it works");

    for (const surface of PAGE_ZOOM_SURFACES) {
      expect(section).toContain(surface.phrase);
      for (const source of surface.sources) {
        expect({
          source,
          wrapsAZoomScope: wrapsAZoomScope(readCode(source)),
        }).toEqual({
          source,
          wrapsAZoomScope: true,
        });
      }
    }
  });

  it("network devices' Metrics and Traffic pages are the ones that zoom", () => {
    expect(
      readCode(`${DASHBOARD_SRC}/Pages/NetworkDevice/View/Metrics.tsx`),
    ).toContain("<DeviceHealthCharts");
    expect(
      readCode(`${DASHBOARD_SRC}/Pages/NetworkDevice/View/Traffic.tsx`),
    ).toContain("<FlowTopTalkers");

    expect(readSection(ZOOM_PAGE, "Where it works")).toContain(
      "- network devices' metrics and traffic;",
    );
  });

  it("dashboards zoom through the board's own range, in both dashboard shells", () => {
    for (const shell of [
      `${DASHBOARD_SRC}/Components/Dashboard/DashboardView.tsx`,
      `${PUBLIC_DASHBOARD_SRC}/Pages/DashboardView/DashboardViewPage.tsx`,
    ]) {
      expect(readCode(shell)).toContain("useDashboardTimeRangeZoom(");
    }

    expect(readSection(ZOOM_PAGE, "Where it works")).toContain(
      "[dashboards](/docs/dashboards/authoring), where a drag retimes the whole dashboard.",
    );
  });

  it("Logs Insights' error drawer offers its own way back, as the page says", () => {
    const drawer: string = readCode(
      `${DASHBOARD_SRC}/Components/Logs/ErrorPatternDetail.tsx`,
    );

    expect(drawer).toContain('title="When it happened"');
    expect(drawer).toContain("<ResetTimeRangeZoomButton />");

    expect(readSection(ZOOM_PAGE, "Where it works")).toContain(
      'Logs Insights, including the "When it happened" timeline of an error pattern, whose panel has its own **Reset zoom** because it covers the page\'s picker;',
    );
  });

  it("charts with a window of their own zoom that window, not the page", () => {
    const section: string = readSection(ZOOM_PAGE, "Where it works");

    for (const surface of OWN_WINDOW_SURFACES) {
      expect(section).toContain(surface.phrase);
      for (const source of surface.sources) {
        /*
         * A panel, card, pop-up or preview that offers its charts a zoom
         * of its own (or MetricView's display-only one) is the window they
         * zoom: none of these is a page.
         */
        const code: string = readCode(source);
        expect({
          source,
          ownsItsWindow:
            wrapsAZoomScope(code) || code.includes("localChartZoom={true}"),
        }).toEqual({ source, ownsItsWindow: true });
      }
    }

    /*
     * Page text only: the snapshot's zoom lives in the incident, alert and
     * episode pages and is exercised by Common's
     * EventOverviewTelemetrySnapshotZoom, TelemetrySnapshotPanelTimeRangeZoom,
     * SnapshotExplorerPrimaryZoom and EventOverviewSnapshotExplorerZoom
     * suites (a metric primary, and a log, trace or exception primary).
     */
    expect(section).toContain(
      "The telemetry snapshot on an incident, alert or episode page has a window of its own too. A drag on its chart (the metric chart, or the log, trace or exception volume chart when that is what the snapshot shows) zooms the whole snapshot, so its Metrics, Logs, Traces and Exceptions tabs all show the slice you dragged out. **Reset zoom** beside the snapshot's badge, or a double-click on that chart, puts the snapshot window back.",
    );
  });

  it("the charts listed as not zooming never take a zoom", () => {
    const section: string = readSection(ZOOM_PAGE, "Charts that don't zoom");

    for (const chart of NON_ZOOMING_CHARTS) {
      expect(section).toContain(chart.phrase);
      for (const source of chart.sources) {
        const code: string = readCode(source);
        for (const zoomWiring of [
          "TimeRangeZoom",
          "onTimeRangeSelect",
          "onTimeRangeReset",
        ]) {
          expect({
            source,
            zoomWiring,
            found: code.includes(zoomWiring),
          }).toEqual({ source, zoomWiring, found: false });
        }
      }
    }
  });

  it("the device round-trip sparkline keeps to the past hour and links to charts that zoom", () => {
    const sparkline: string = readCode(
      `${DASHBOARD_SRC}/Components/NetworkDevice/DeviceLatencyTrend.tsx`,
    );

    expect(sparkline).toContain("range: TimeRange.PAST_ONE_HOUR");
    expect(sparkline).toContain('"Round-trip time, past hour"');
    expect(sparkline).toContain('"Open metrics"');
    expect(sparkline).toContain("PageMap.NETWORK_DEVICE_VIEW_METRICS");
    // That page is the device's Metrics page, whose charts zoom.
    expect(
      wrapsAZoomScope(
        readCode(
          `${DASHBOARD_SRC}/Components/NetworkDevice/DeviceHealthCharts.tsx`,
        ),
      ),
    ).toBe(true);

    expect(readSection(ZOOM_PAGE, "Charts that don't zoom")).toContain(
      "small sparklines with a fixed window of their own, such as a network device's round-trip time over the past hour — its **Open metrics** link leads to charts you can zoom.",
    );
  });

  it("says a zoom moves the page's range, and which panels stay on now", () => {
    const prose: string = readProse(ZOOM_PAGE);

    // Not the old promise that everything on the page follows a zoom.
    expect(prose).not.toContain(
      "every chart, table and summary on the page re-queries",
    );
    expect(prose).toContain(
      "Panels that show the current state stay on now, just as they do when you pick a range yourself: inventory counts, health, top resource consumers, recent warnings, open incidents and alerts, and a dashboard's live lists.",
    );
  });
});

describe("Dashboard authoring docs on zooming", () => {
  it("no longer claims bar charts cannot start a zoom", () => {
    const page: string = readPage(DASHBOARD_PAGE);

    expect(page).not.toContain("Bar charts can't originate a zoom");
    expect(page).toContain("Bar charts zoom the same way");
  });

  it("points at the product-wide zoom page", () => {
    expect(readPage(DASHBOARD_PAGE)).toContain(`(${ZOOM_URL})`);
  });

  it("says a zoom moves the board's range the way the picker does, and live lists stay on now", () => {
    const prose: string = readProse(DASHBOARD_PAGE);

    expect(prose).not.toContain("every other panel re-queries alongside it");
    expect(prose).toContain(
      "moves to that window, just as if you had picked it in the time-range picker — every widget that uses the time range re-queries alongside it",
    );
    expect(prose).toContain(
      "Live lists keep showing what's happening now, as they always do.",
    );
  });

  it("says only a drag zooms a dashboard, which is how its bar histograms are wired", () => {
    expect(
      histogramSelectionOptionsIn(
        `${DASHBOARD_SRC}/Components/Dashboard/Utils/UseDashboardHistogramZoom.ts`,
      ),
    ).not.toContain("bucketIntervalMs");

    expect(readProse(DASHBOARD_PAGE)).toContain(
      "Only a drag zooms: a plain click on a chart never retimes the dashboard.",
    );
  });
});
