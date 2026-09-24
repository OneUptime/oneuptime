import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  describeExceptionsTile,
  describePageLoadsTile,
  describePageLoadTimeTile,
  PAGE_LOAD_SPAN_NAME,
  PageLoadTileStats,
  sumTimeSeries,
  TileText,
  TimePointLike,
} from "../../FeatureSet/Dashboard/src/Pages/Rum/View/OverviewHelpers";
import {
  RUM_METRIC_DESCRIPTIONS,
  RumMetric,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/RumMetricDescriptions";

/*
 * The RUM application overview's new page-load and exception tiles, and the
 * (i) tooltip beside every tile and chart on that page.
 *
 * Part one runs the tiles' wording decisions for real: they live in
 * OverviewHelpers.ts, which has no React import, precisely so this node
 * suite can call them (see FeatureSetImportsStayReactFree.test.ts).
 *
 * Part two pins the page's JSX wiring by reading Overview.tsx, with
 * comments stripped and whitespace squashed so a rationale comment or a
 * Prettier reflow can neither make these pass nor fail. A render of the real
 * page lives in Common/Tests/App/Dashboard/RumOverviewPage.test.tsx.
 *
 * Part three holds the tooltip texts to what the page actually computes.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const WHITESPACE: RegExp = /\s+/g;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const TILE_TITLE: RegExp = /title: "([^"]+)"/g;
const TILE_DESCRIPTION: RegExp = /description: RUM_METRIC_DESCRIPTIONS\.(\w+)/g;
const CHART_CARD: RegExp = /<ChartCard /g;
const CHART_TITLE: RegExp = /title="([^"]+)"/;
const CHART_DESCRIPTION: RegExp =
  /description=\{RUM_METRIC_DESCRIPTIONS\.(\w+)\}/;
const ANY_DESCRIPTION_REFERENCE: RegExp = /RUM_METRIC_DESCRIPTIONS\.(\w+)/g;
const HANDLER_START: RegExp = /\.(then|catch)\(/g;
const STATE_SETTER_CALL: RegExp = /\bset[A-Z]\w*\(/;
const PAGE_VIEWS: RegExp = /page views?/i;
const SENTENCE_END: RegExp = /[.!?)"']$/;
const DOUBLE_SPACE: RegExp = /\s{2,}/;
const SESSION_PAGE_SIZE: RegExp =
  /const SESSION_REPLAY_COUNT_PAGE_SIZE: number = (\d+);/;
const ERROR_RATE_THRESHOLDS: RegExp =
  /thresholds: \{ warn: (\d+), danger: (\d+) \}/;

function readSource(relativePath: string): string {
  return fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relativePath.split("/")),
    "utf8",
  );
}

function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
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

function matchesOf(source: string, pattern: RegExp): Array<string> {
  return Array.from(source.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

const OVERVIEW: string = readCode("Pages/Rum/View/Overview.tsx");
const TELEMETRY_METRICS: string = readCode(
  "Components/TelemetryResource/telemetryMetrics.ts",
);

const STATS: PageLoadTileStats = {
  count: 1234,
  errorCount: 3,
  p50DurationMs: 850,
  p95DurationMs: 2340,
};

describe("PAGE_LOAD_SPAN_NAME", () => {
  test("is the span the OpenTelemetry browser SDK records per full page load", () => {
    expect(PAGE_LOAD_SPAN_NAME).toBe("documentLoad");
  });
});

describe("describePageLoadsTile", () => {
  test("a failed lookup is unknown, never zero", () => {
    expect(
      describePageLoadsTile({ stats: null, failed: true, eventsTotal: 500 }),
    ).toEqual({ value: "—", sublabel: "could not load" });
  });

  test("a failed flag wins over stale stats", () => {
    expect(
      describePageLoadsTile({ stats: STATS, failed: true, eventsTotal: 500 }),
    ).toEqual({ value: "—", sublabel: "could not load" });
  });

  test("before any stats arrive it shows a dash, not 0", () => {
    expect(
      describePageLoadsTile({ stats: null, failed: false, eventsTotal: null }),
    ).toEqual({ value: "—", sublabel: "full page loads" });
  });

  test("no page loads while other events arrived names the missing span", () => {
    expect(
      describePageLoadsTile({
        stats: { ...STATS, count: 0, errorCount: 0 },
        failed: false,
        eventsTotal: 1,
      }),
    ).toEqual({ value: "0", sublabel: "no documentLoad spans" });
  });

  test("the missing-span hint is built from PAGE_LOAD_SPAN_NAME", () => {
    const text: TileText = describePageLoadsTile({
      stats: { ...STATS, count: 0 },
      failed: false,
      eventsTotal: 10,
    });

    expect(text.sublabel).toBe(`no ${PAGE_LOAD_SPAN_NAME} spans`);
  });

  test.each([
    ["no events either", 0],
    ["events still loading", null],
  ])(
    "no page loads and %s is a plain zero, not a missing-span hint",
    (_: string, eventsTotal: number | null) => {
      expect(
        describePageLoadsTile({
          stats: { ...STATS, count: 0, errorCount: 0 },
          failed: false,
          eventsTotal,
        }),
      ).toEqual({ value: "0", sublabel: "full page loads" });
    },
  );

  test("a negative count from a bad row is treated as none", () => {
    expect(
      describePageLoadsTile({
        stats: { ...STATS, count: -5 },
        failed: false,
        eventsTotal: 0,
      }),
    ).toEqual({ value: "0", sublabel: "full page loads" });
  });

  test("a count with no failures says 'full page loads'", () => {
    expect(
      describePageLoadsTile({
        stats: { ...STATS, count: 42, errorCount: 0 },
        failed: false,
        eventsTotal: 1000,
      }),
    ).toEqual({ value: "42", sublabel: "full page loads" });
  });

  test("failed page loads are counted in the sublabel", () => {
    expect(
      describePageLoadsTile({ stats: STATS, failed: false, eventsTotal: 5000 }),
    ).toEqual({ value: "1.2k", sublabel: "3 failed" });
  });

  test.each([
    [999, "999"],
    [1000, "1k"],
    [1500, "1.5k"],
    [45_600, "45.6k"],
    [2_000_000, "2M"],
    [2_450_000, "2.5M"],
  ])("a count of %d reads %s", (count: number, value: string) => {
    expect(
      describePageLoadsTile({
        stats: { ...STATS, count, errorCount: 0 },
        failed: false,
        eventsTotal: count,
      }).value,
    ).toBe(value);
  });

  test("a large failure count is compacted too", () => {
    expect(
      describePageLoadsTile({
        stats: { ...STATS, count: 50_000, errorCount: 1200 },
        failed: false,
        eventsTotal: 90_000,
      }).sublabel,
    ).toBe("1.2k failed");
  });

  test("does not depend on the events total once page loads exist", () => {
    const withEvents: TileText = describePageLoadsTile({
      stats: STATS,
      failed: false,
      eventsTotal: 99,
    });
    const withoutEvents: TileText = describePageLoadsTile({
      stats: STATS,
      failed: false,
      eventsTotal: null,
    });

    expect(withEvents).toEqual(withoutEvents);
  });
});

describe("describePageLoadTimeTile", () => {
  test("a failed lookup is unknown", () => {
    expect(describePageLoadTimeTile({ stats: STATS, failed: true })).toEqual({
      value: "—",
      sublabel: "could not load",
    });
  });

  test("no stats yet is 'no page loads', never '0 ms'", () => {
    expect(describePageLoadTimeTile({ stats: null, failed: false })).toEqual({
      value: "—",
      sublabel: "no page loads",
    });
  });

  test("no page loads is a dash even when the row carries a stray duration", () => {
    expect(
      describePageLoadTimeTile({
        stats: { ...STATS, count: 0, p95DurationMs: 1200, p50DurationMs: 300 },
        failed: false,
      }),
    ).toEqual({ value: "—", sublabel: "no page loads" });
  });

  test("the value is the p95 and the sublabel the median", () => {
    expect(describePageLoadTimeTile({ stats: STATS, failed: false })).toEqual({
      value: "2.34 s",
      sublabel: "median 850 ms",
    });
  });

  test("p95 and median are not swapped", () => {
    const text: TileText = describePageLoadTimeTile({
      stats: { ...STATS, p50DurationMs: 100, p95DurationMs: 900 },
      failed: false,
    });

    expect(text.value).toBe("900 ms");
    expect(text.sublabel).toBe("median 100 ms");
  });

  test.each([
    [0.5, "500 µs"],
    [9.5, "9.5 ms"],
    [120, "120 ms"],
    [999, "999 ms"],
    [1000, "1.00 s"],
    [12_345, "12.35 s"],
  ])("a p95 of %d ms reads %s", (p95: number, value: string) => {
    expect(
      describePageLoadTimeTile({
        stats: { ...STATS, p95DurationMs: p95 },
        failed: false,
      }).value,
    ).toBe(value);
  });

  test("a single page load still has a time", () => {
    expect(
      describePageLoadTimeTile({
        stats: {
          count: 1,
          errorCount: 0,
          p50DurationMs: 700,
          p95DurationMs: 700,
        },
        failed: false,
      }),
    ).toEqual({ value: "700 ms", sublabel: "median 700 ms" });
  });
});

describe("describeExceptionsTile", () => {
  test("before the lookup returns it shows a dash", () => {
    expect(describeExceptionsTile({ exceptions: null })).toEqual({
      value: "—",
      sublabel: "reported by your app",
    });
  });

  test("a failed lookup is unknown, not zero", () => {
    expect(
      describeExceptionsTile({ exceptions: { total: 0, failed: true } }),
    ).toEqual({ value: "—", sublabel: "could not load" });
  });

  test("a failed flag wins over a total", () => {
    expect(
      describeExceptionsTile({ exceptions: { total: 12, failed: true } }),
    ).toEqual({ value: "—", sublabel: "could not load" });
  });

  test("zero that is really zero shows 0", () => {
    expect(
      describeExceptionsTile({ exceptions: { total: 0, failed: false } }),
    ).toEqual({ value: "0", sublabel: "reported by your app" });
  });

  test.each([
    [17, "17"],
    [1500, "1.5k"],
    [3_200_000, "3.2M"],
  ])("a total of %d reads %s", (total: number, value: string) => {
    expect(
      describeExceptionsTile({ exceptions: { total, failed: false } }).value,
    ).toBe(value);
  });

  test("never claims a handled / unhandled split the browser cannot report", () => {
    for (const exceptions of [
      null,
      { total: 0, failed: false },
      { total: 5, failed: false },
      { total: 5, failed: true },
    ]) {
      const text: TileText = describeExceptionsTile({ exceptions });

      expect(text.sublabel).not.toMatch(/handled/i);
    }
  });
});

describe("sumTimeSeries", () => {
  const A: Date = new Date("2026-09-24T10:00:00.000Z");
  const B: Date = new Date("2026-09-24T10:05:00.000Z");
  const C: Date = new Date("2026-09-24T10:10:00.000Z");

  function plain(series: Array<TimePointLike>): Array<[string, number]> {
    return series.map((p: TimePointLike): [string, number] => {
      return [p.x.toISOString(), p.y];
    });
  }

  test("two empty series sum to an empty one", () => {
    expect(sumTimeSeries([], [])).toEqual([]);
  });

  test("one empty side returns the other, sorted", () => {
    expect(
      plain(
        sumTimeSeries(
          [
            { x: B, y: 2 },
            { x: A, y: 1 },
          ],
          [],
        ),
      ),
    ).toEqual([
      [A.toISOString(), 1],
      [B.toISOString(), 2],
    ]);
    expect(plain(sumTimeSeries([], [{ x: C, y: 7 }]))).toEqual([
      [C.toISOString(), 7],
    ]);
  });

  test("points at the same timestamp are added", () => {
    expect(
      plain(
        sumTimeSeries(
          [
            { x: A, y: 2 },
            { x: B, y: 3 },
          ],
          [
            { x: new Date(A.getTime()), y: 4 },
            { x: C, y: 5 },
          ],
        ),
      ),
    ).toEqual([
      [A.toISOString(), 6],
      [B.toISOString(), 3],
      [C.toISOString(), 5],
    ]);
  });

  test("repeated timestamps within one series are added too", () => {
    expect(
      plain(
        sumTimeSeries(
          [
            { x: A, y: 1 },
            { x: A, y: 1 },
          ],
          [{ x: A, y: 1 }],
        ),
      ),
    ).toEqual([[A.toISOString(), 3]]);
  });

  test("the result is sorted oldest first whatever the input order", () => {
    const result: Array<TimePointLike> = sumTimeSeries(
      [
        { x: C, y: 1 },
        { x: A, y: 1 },
      ],
      [{ x: B, y: 1 }],
    );

    expect(
      result.map((p: TimePointLike): number => {
        return p.x.getTime();
      }),
    ).toEqual([A.getTime(), B.getTime(), C.getTime()]);
  });

  test("invalid dates and non-finite values are skipped, not summed as NaN", () => {
    expect(
      plain(
        sumTimeSeries(
          [
            { x: new Date("not a date"), y: 5 },
            { x: A, y: Number.NaN },
            { x: A, y: 2 },
          ],
          [
            { x: B, y: Number.POSITIVE_INFINITY },
            { x: B, y: 1 },
          ],
        ),
      ),
    ).toEqual([
      [A.toISOString(), 2],
      [B.toISOString(), 1],
    ]);
  });

  test("zeros are kept as points", () => {
    expect(plain(sumTimeSeries([{ x: A, y: 0 }], [{ x: A, y: 0 }]))).toEqual([
      [A.toISOString(), 0],
    ]);
  });

  test("the inputs are left untouched", () => {
    const a: Array<TimePointLike> = [
      { x: B, y: 2 },
      { x: A, y: 1 },
    ];
    const b: Array<TimePointLike> = [{ x: A, y: 4 }];
    const before: string = JSON.stringify([a, b]);

    sumTimeSeries(a, b);

    expect(JSON.stringify([a, b])).toBe(before);
  });

  test("returns fresh Date objects, so a chart mutating one cannot corrupt the source", () => {
    const source: Array<TimePointLike> = [{ x: A, y: 1 }];
    const result: Array<TimePointLike> = sumTimeSeries(source, []);

    expect(result[0]!.x).not.toBe(A);
    expect(result[0]!.x.getTime()).toBe(A.getTime());
  });
});

describe("Overview.tsx wiring: tiles", () => {
  const tiles: string = between(
    OVERVIEW,
    "const tiles: Array<ResourceOverviewTile> = [",
    "const syncId: string",
  );

  const EXPECTED_TILES: Array<[string, RumMetric]> = [
    ["Page loads", "pageLoads"],
    ["Page load time (p95)", "pageLoadTime"],
    ["Events", "events"],
    ["Error rate", "errorRate"],
    ["Event duration (p95)", "eventDuration"],
    ["Exceptions", "exceptions"],
    ["Clients", "clients"],
    ["Sessions recorded", "sessionsRecorded"],
  ];

  test("there are exactly eight tiles, in this order", () => {
    expect(matchesOf(tiles, TILE_TITLE)).toEqual(
      EXPECTED_TILES.map(([title]: [string, RumMetric]) => {
        return title;
      }),
    );
  });

  test("every tile has a description, and only from RUM_METRIC_DESCRIPTIONS", () => {
    expect(matchesOf(tiles, TILE_DESCRIPTION)).toEqual(
      EXPECTED_TILES.map(([, key]: [string, RumMetric]) => {
        return key;
      }),
    );
    expect((tiles.match(/description:/g) || []).length).toBe(8);
  });

  test.each(EXPECTED_TILES)(
    "the %s tile is paired with RUM_METRIC_DESCRIPTIONS.%s",
    (title: string, key: RumMetric) => {
      const next: number = EXPECTED_TILES.findIndex(
        ([t]: [string, RumMetric]) => {
          return t === title;
        },
      );
      const after: string =
        next + 1 < EXPECTED_TILES.length
          ? `title: "${EXPECTED_TILES[next + 1]![0]}"`
          : "];";
      const tile: string = between(tiles, `title: "${title}"`, after);

      expect(tile).toContain(`description: RUM_METRIC_DESCRIPTIONS.${key},`);
    },
  );

  test("the page-load tiles come from the helpers and wait on the page-load loading flag", () => {
    const pageLoads: string = between(
      tiles,
      'title: "Page loads"',
      'title: "Page load time (p95)"',
    );
    const pageLoadTime: string = between(
      tiles,
      'title: "Page load time (p95)"',
      'title: "Events"',
    );

    expect(pageLoads).toContain("value: pageLoadsTile.value");
    expect(pageLoads).toContain("sublabel: pageLoadsTile.sublabel");
    expect(pageLoads).toContain("loading: pageLoadsLoading");
    expect(pageLoadTime).toContain("value: pageLoadTimeTile.value");
    expect(pageLoadTime).toContain("sublabel: pageLoadTimeTile.sublabel");
    expect(pageLoadTime).toContain("loading: pageLoadsLoading");

    expect(OVERVIEW).toContain(
      "describePageLoadsTile({ stats: pageLoadStats, failed: pageLoadStatsFailed, eventsTotal: m ? m.total : null, })",
    );
    expect(OVERVIEW).toContain(
      "describePageLoadTimeTile({ stats: pageLoadStats, failed: pageLoadStatsFailed, })",
    );
  });

  test("the exceptions tile comes from the helper and waits on the signals flag", () => {
    const exceptions: string = between(
      tiles,
      'title: "Exceptions"',
      'title: "Clients"',
    );

    expect(exceptions).toContain("value: exceptionsTile.value");
    expect(exceptions).toContain("sublabel: exceptionsTile.sublabel");
    expect(exceptions).toContain("loading: signalsLoading");
    expect(OVERVIEW).toContain(
      "describeExceptionsTile({ exceptions: signals ? signals.exceptions : null, })",
    );
  });

  test("the events tile says it counts spans", () => {
    const events: string = between(
      tiles,
      'title: "Events"',
      'title: "Error rate"',
    );

    expect(events).toContain('"spans, selected range"');
    expect(events).toContain("formatCompact(m.total)");
  });

  /*
   * fetchSpanMetrics resolves an empty result with `failed` set when its
   * aggregates fail. The three span tiles read "could not load" then, never
   * the zeros that result carries (correlation-14).
   */
  test("a failed span lookup is unknown on all three span tiles, not zero", () => {
    expect(OVERVIEW).toContain(
      "const m: SpanMetrics | null = metrics && !metrics.failed ? metrics : null;",
    );
    expect(OVERVIEW).toContain(
      "const spanLookupFailed: boolean = Boolean(metrics?.failed);",
    );

    for (const [from, to] of [
      ['title: "Events"', 'title: "Error rate"'],
      ['title: "Error rate"', 'title: "Event duration (p95)"'],
      ['title: "Event duration (p95)"', 'title: "Exceptions"'],
    ] as Array<[string, string]>) {
      const tile: string = between(tiles, from, to);

      expect(tile).toContain("spanLookupFailed");
      expect(tile).toContain('"could not load"');
    }
  });

  test("'Page views' is gone from the page - it always counted every span", () => {
    expect(OVERVIEW).not.toMatch(PAGE_VIEWS);
  });
});

describe("Overview.tsx wiring: charts and the web-vitals card", () => {
  const charts: string = between(
    OVERVIEW,
    "const charts: ReactElement = (",
    "const quickLinks:",
  );

  const EXPECTED_CHARTS: Array<[string, RumMetric]> = [
    ["Page loads", "pageLoadsChart"],
    ["Page load time (p95)", "pageLoadTimeChart"],
    ["Events", "eventsChart"],
    ["Event duration (p95)", "eventDurationChart"],
    ["Exceptions", "exceptionsChart"],
    ["Logs", "logsChart"],
  ];

  function chartBlocks(): Array<string> {
    return charts.split(CHART_CARD).slice(1);
  }

  test("there are exactly six chart cards, in this order", () => {
    expect((charts.match(CHART_CARD) || []).length).toBe(6);
    expect(
      chartBlocks().map((block: string): string => {
        return block.match(CHART_TITLE)?.[1] || "";
      }),
    ).toEqual(
      EXPECTED_CHARTS.map(([title]: [string, RumMetric]) => {
        return title;
      }),
    );
  });

  test("every chart card is paired with its own description", () => {
    expect(
      chartBlocks().map((block: string): string => {
        return block.match(CHART_DESCRIPTION)?.[1] || "(none)";
      }),
    ).toEqual(
      EXPECTED_CHARTS.map(([, key]: [string, RumMetric]) => {
        return key;
      }),
    );
  });

  test("the page-load charts read the documentLoad series, the others the all-span and signal series", () => {
    const blocks: Array<string> = chartBlocks();

    expect(blocks[0]).toContain("pageLoadMetrics?.countSeries");
    expect(blocks[0]).toContain("pageLoadMetrics?.errorSeries");
    expect(blocks[1]).toContain("pageLoadMetrics?.p95Series");
    expect(blocks[2]).toContain("m?.countSeries");
    expect(blocks[3]).toContain("m?.p95Series");
    expect(blocks[4]).toContain(
      "sumTimeSeries( signals?.exceptions.unhandledSeries ?? [], signals?.exceptions.handledSeries ?? [], )",
    );
    expect(blocks[5]).toContain("signals?.logs.countSeries");
    expect(blocks[5]).toContain("signals?.logs.errorSeries");
  });

  test("the web-vitals card gets its description", () => {
    const card: string = between(OVERVIEW, "<WebVitalsCard", "/>");

    expect(card).toContain("description={RUM_METRIC_DESCRIPTIONS.webVitals}");
  });

  test("every key of RUM_METRIC_DESCRIPTIONS is used on the page exactly once", () => {
    const used: Array<string> = matchesOf(OVERVIEW, ANY_DESCRIPTION_REFERENCE);

    expect([...used].sort()).toEqual(
      Object.keys(RUM_METRIC_DESCRIPTIONS).sort(),
    );
  });

  test("the descriptions are imported from the plain-data module, not typed inline", () => {
    expect(OVERVIEW).toContain(
      'import { RUM_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/RumMetricDescriptions";',
    );
    expect(OVERVIEW).not.toMatch(/description="[^"]{25,}"/);
  });
});

describe("Overview.tsx wiring: the SDK-missing notice", () => {
  test("names the tiles that need the SDK, including the new ones", () => {
    const alert: string = between(
      OVERVIEW,
      'strongTitle="Session replay is reporting, the RUM SDK is not"',
      "/>",
    );

    expect(alert).toContain(
      "Page loads, events, error rate, durations, exceptions and clients",
    );
    expect(alert).toContain("Session replay does not need it.");
  });
});

describe("Overview.tsx wiring: the telemetry loader", () => {
  const loader: string = between(
    OVERVIEW,
    "const loadTelemetry: (showLoading: boolean) => void = useCallback(",
    "[modelIdString, timeRangeKey],",
  );
  const guarded: string = between(
    loader,
    "if (showLoading) {",
    "const range: InBetween<Date>",
  );
  const unguarded: string = loader.replace(guarded, "");

  test("the page-load and signal loading flags are raised only when asked to show loading", () => {
    for (const setter of [
      "setMetricsLoading(true)",
      "setWebVitalsLoading(true)",
      "setPageLoadsLoading(true)",
      "setSignalsLoading(true)",
      "setSessionReplayCount(null)",
    ]) {
      expect(guarded).toContain(setter);
      expect(unguarded).not.toContain(setter);
    }
  });

  test("the loading flags start true, so a first paint never shows a false zero", () => {
    expect(OVERVIEW).toContain(
      "const [pageLoadsLoading, setPageLoadsLoading] = useState<boolean>(true);",
    );
    expect(OVERVIEW).toContain(
      "const [signalsLoading, setSignalsLoading] = useState<boolean>(true);",
    );
  });

  test("every handler that writes state first checks the response is still current", () => {
    const starts: Array<number> = Array.from(
      unguarded.matchAll(HANDLER_START),
    ).map((match: RegExpMatchArray): number => {
      return match.index as number;
    });
    let stateWriters: number = 0;

    starts.forEach((start: number, i: number) => {
      const end: number =
        i + 1 < starts.length ? starts[i + 1]! : unguarded.length;
      const handler: string = unguarded.slice(start, end);
      const setterAt: number = handler.search(STATE_SETTER_CALL);

      if (setterAt < 0) {
        return;
      }

      stateWriters += 1;
      const guardAt: number = handler.indexOf("if (!isCurrent()) { return; }");

      expect({ handler, guarded: guardAt >= 0 && guardAt < setterAt }).toEqual({
        handler,
        guarded: true,
      });
    });

    /*
     * all spans (then/catch), web vitals (then/catch), page loads
     * (then/catch), signals (then/catch), sessions (then/catch).
     */
    expect(stateWriters).toBe(10);
  });

  test("page loads are two requests for the documentLoad span, waited on together", () => {
    const pageLoads: string = between(
      loader,
      "Promise.all([ fetchSpanNameStats({",
      "fetchLogAndExceptionSignals(",
    );

    expect(pageLoads).toContain("spanName: PAGE_LOAD_SPAN_NAME");
    expect(pageLoads).toContain(
      "fetchSpanMetrics({ primaryEntityId, spanName: PAGE_LOAD_SPAN_NAME, start, end, })",
    );
    // The stats failing is caught to null so the series can still land.
    expect(pageLoads).toContain(".catch((): null => { return null; })");
    expect(pageLoads).toContain("setPageLoadStatsFailed(stats === null)");
    expect(pageLoads).toContain("setPageLoadStatsFailed(true)");
  });

  test("the all-spans request is not narrowed to page loads", () => {
    expect(loader).toContain(
      "fetchSpanMetrics({ primaryEntityId, start, end })",
    );
  });

  test("exceptions and logs come from the same primaryEntityId and window", () => {
    expect(loader).toContain(
      "fetchLogAndExceptionSignals({ primaryEntityId, start, end })",
    );
  });
});

describe("RUM_METRIC_DESCRIPTIONS say what the page computes", () => {
  const D: Record<RumMetric, string> = RUM_METRIC_DESCRIPTIONS;

  test("covers every tile, every chart and the web-vitals card - fifteen texts", () => {
    expect(Object.keys(D).sort()).toEqual(
      [
        "pageLoads",
        "pageLoadTime",
        "events",
        "errorRate",
        "eventDuration",
        "exceptions",
        "clients",
        "sessionsRecorded",
        "pageLoadsChart",
        "pageLoadTimeChart",
        "eventsChart",
        "eventDurationChart",
        "exceptionsChart",
        "logsChart",
        "webVitals",
      ].sort(),
    );
  });

  test("events: counts spans, and says it is more than pages viewed", () => {
    expect(D.events).toMatch(/\bspan/);
    expect(D.events).toMatch(/higher than the number of pages viewed/);
  });

  test("eventDuration: explains p95, and says the tile is an average of per-interval values", () => {
    expect(D.eventDuration).toMatch(/95th percentile/);
    expect(D.eventDuration).toMatch(/95%/);
    expect(D.eventDuration).toMatch(/averaged/);
    expect(D.eventDuration).toMatch(/each interval/);

    // That is what fetchSpanMetrics really does.
    expect(TELEMETRY_METRICS).toContain("p95DurationMs: meanY(p95Series)");
  });

  test("clients: not limited to the range, and not users or devices", () => {
    expect(D.clients).toMatch(/Not limited to the selected range/);
    expect(D.clients).toMatch(/not a count of users or devices/);

    // The count really ignores the range: no time filter on the query.
    const count: string = between(OVERVIEW, "ModelAPI.count({", "})");
    expect(count).toContain("query: { rumApplicationId: modelId }");
    expect(count).not.toMatch(/start|end|time/i);
  });

  test("sessionsRecorded: the '50+' cap matches the page size the tile asks for", () => {
    const pageSize: string | undefined = OVERVIEW.match(SESSION_PAGE_SIZE)?.[1];

    expect(pageSize).toBe("50");
    expect(D.sessionsRecorded).toContain(`Counting stops at ${pageSize}`);
    expect(D.sessionsRecorded).toContain(`"${pageSize}+"`);
    expect(OVERVIEW).toContain("limit: SESSION_REPLAY_COUNT_PAGE_SIZE");
  });

  test("pageLoads: names the documentLoad span, and says SPA route changes do not count", () => {
    expect(D.pageLoads).toContain(PAGE_LOAD_SPAN_NAME);
    expect(D.pageLoads).toMatch(/single-page app/);
    expect(D.pageLoadsChart).toContain(PAGE_LOAD_SPAN_NAME);
  });

  test("pageLoadTime: explains p95 and the median shown under it", () => {
    expect(D.pageLoadTime).toMatch(/p95/);
    expect(D.pageLoadTime).toMatch(/95% of page loads/);
    expect(D.pageLoadTime).toMatch(/slowest 5%/);
    expect(D.pageLoadTime).toMatch(/median/);
    expect(D.pageLoadTime).toMatch(/half were faster/);
  });

  test("webVitals: an average over the range, unlike Google's 75th percentile", () => {
    expect(D.webVitals).toMatch(/average over the selected range/);
    expect(D.webVitals).toMatch(/75th percentile/);

    // fetchWebVitals really averages.
    expect(TELEMETRY_METRICS).toContain("aggregationType: AggregationType.Avg");
  });

  test("errorRate: the colour limits it quotes are the tile's thresholds", () => {
    const errorRateTile: string = between(
      OVERVIEW,
      'title: "Error rate"',
      'title: "Event duration (p95)"',
    );
    const thresholds: RegExpMatchArray | null = errorRateTile.match(
      ERROR_RATE_THRESHOLDS,
    );

    expect(thresholds).not.toBeNull();
    expect(D.errorRate).toContain(`amber at ${thresholds![1]}%`);
    expect(D.errorRate).toContain(`red at ${thresholds![2]}%`);
  });

  test("logsChart: the error line is Error and Fatal, as the summary counts it", () => {
    expect(D.logsChart).toMatch(/Error and Fatal/);
    expect(TELEMETRY_METRICS).toContain(
      'const ERROR_LOG_SEVERITY_SET: Set<string> = new Set<string>(["Error", "Fatal"]);',
    );
  });

  test("exceptions: says the browser SDK does not send them unaided, and claims no handled split", () => {
    expect(D.exceptions).toMatch(/does not send these on its own/);
    expect(D.exceptions).not.toMatch(/unhandled|handled/i);
    expect(D.exceptionsChart).not.toMatch(/unhandled|handled/i);
  });

  test("the p95 charts explain the percentile per interval", () => {
    for (const text of [D.pageLoadTimeChart, D.eventDurationChart]) {
      expect(text).toMatch(/95th percentile/);
      expect(text).toMatch(/95% of the/);
      expect(text).toMatch(/in each interval/);
    }
  });

  test("every chart text talks about intervals, every tile text does not", () => {
    for (const key of [
      "pageLoadsChart",
      "pageLoadTimeChart",
      "eventsChart",
      "eventDurationChart",
      "exceptionsChart",
      "logsChart",
    ] as Array<RumMetric>) {
      expect(D[key]).toMatch(/each interval/);
    }

    for (const key of [
      "pageLoads",
      "pageLoadTime",
      "events",
      "errorRate",
      "exceptions",
      "clients",
      "sessionsRecorded",
    ] as Array<RumMetric>) {
      expect(D[key]).not.toMatch(/each interval/);
    }
  });

  test("every text is a short finished sentence with no stray whitespace", () => {
    for (const [key, text] of Object.entries(D)) {
      expect({ key, trimmed: text === text.trim() }).toEqual({
        key,
        trimmed: true,
      });
      expect({ key, length: text.length >= 25 && text.length <= 340 }).toEqual({
        key,
        length: true,
      });
      expect({ key, ends: SENTENCE_END.test(text) }).toEqual({
        key,
        ends: true,
      });
      expect({ key, doubleSpace: DOUBLE_SPACE.test(text) }).toEqual({
        key,
        doubleSpace: false,
      });
    }
  });

  test("no two metrics share a text", () => {
    const texts: Array<string> = Object.values(D);

    expect(new Set(texts).size).toBe(texts.length);
  });
});
