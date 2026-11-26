import { describe, expect, test } from "@jest/globals";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  Translator,
} from "Common/Types/Translator";
import {
  MobileAppStarts,
  MobileFaultCount,
  MobileFrames,
  MobileSessions,
  emptyAppStarts,
} from "../../FeatureSet/Dashboard/src/Components/Rum/MobileOverview/MobileRumSignalData";
import {
  CRASH_FREE_THRESHOLDS,
  MobileSignalEmptyCopy,
  MobileTileText,
  OPEN_ANDROID_SETUP,
  SESSIONS_NOT_REPORTED_NOTE,
  buildMobileExceptionsRoute,
  buildMobileFrozenFramesLogsRoute,
  buildMobileTracesRoute,
  describeAppStartsTile,
  describeColdStartTile,
  describeCrashFreeTile,
  describeFaultTile,
  describeFrozenFramesTile,
  describeSessionsTile,
  formatSessionShare,
  getCrashFreeInstallsPercent,
  getCrashFreeSessionsPercent,
  getMobileSignalEmptyCopy,
  getMobileSignalEmptyState,
  withQueryParams,
} from "../../FeatureSet/Dashboard/src/Pages/Rum/View/MobileOverviewHelpers";
import { RUM_ANDROID_SETUP_DOCS_URL } from "../../FeatureSet/Dashboard/src/Components/Rum/RumSetupGuide";
import {
  TIME_RANGE_LABEL_SEPARATOR,
  getTimeRangeButtonLabel,
} from "Common/UI/Components/Date/TimeRangeLabel";

/*
 * What a mobile RUM application's Overview tiles say (#9588), in every
 * state their reads can be in, what an empty app start or frame chart says,
 * and where each tile links. MobileOverviewHelpers has no React import, so
 * all of it runs here for real; RumOverviewPage.test.tsx renders the page.
 */

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);
const PERSIAN: Translator = createTranslator(undefined, "fa");
const PAST_HOUR: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_HOUR };
const APP_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const NOW: Date = new Date("2026-11-19T10:00:00.000Z");

function sessions(
  count: number,
  spans: number = count * 10,
  failed: boolean = false,
  installs: number | null = null,
): MobileSessions {
  return { sessions: count, spans, installs, failed };
}

function fault(
  total: number,
  sessionCount: number | null,
  failed: boolean = false,
  installs: number | null = null,
): MobileFaultCount {
  return { total, series: [], sessions: sessionCount, installs, failed };
}

function appStarts(
  overrides: Partial<MobileAppStarts["byType"]>,
  total?: number,
): MobileAppStarts {
  const result: MobileAppStarts = emptyAppStarts(false);
  result.byType = { ...result.byType, ...overrides };
  result.total =
    total ??
    result.byType.cold.count +
      result.byType.warm.count +
      result.byType.hot.count;
  return result;
}

function frames(slow: number, frozen: number): MobileFrames {
  return {
    slow,
    frozen,
    slowSeries: [],
    frozenSeries: [],
    byScreen: [],
    failed: false,
    byScreenFailed: false,
  };
}

function paramsOf(route: Route): URLSearchParams {
  const text: string = route.toString();
  return new URLSearchParams(text.slice(text.indexOf("?") + 1));
}

describe("Sessions tile", () => {
  test("counts the range's sessions, and names the range it counted", () => {
    expect(
      describeSessionsTile({ sessions: sessions(1234), timeRange: PAST_HOUR }),
    ).toEqual({ value: "1.2k", sublabel: "Past 1 Hour" });
  });

  test("spans that name no session say the SDK sets no session.id, never 0", () => {
    const tile: MobileTileText = describeSessionsTile({
      sessions: sessions(0, 512),
      timeRange: PAST_HOUR,
    });

    expect(tile.value).toBeUndefined();
    expect(tile.valueNote).toBe(SESSIONS_NOT_REPORTED_NOTE);
    expect(SESSIONS_NOT_REPORTED_NOTE).toBe("No session.id");
    expect(tile.sublabel).toBe("spans name no session");
  });

  test("no spans at all in the range is a real zero", () => {
    expect(
      describeSessionsTile({ sessions: sessions(0, 0), timeRange: PAST_HOUR }),
    ).toEqual({ value: "0", sublabel: "Past 1 Hour" });
  });

  test("a failed read could not load", () => {
    expect(
      describeSessionsTile({
        sessions: sessions(0, 0, true),
        timeRange: PAST_HOUR,
      }),
    ).toEqual({ value: undefined, sublabel: "could not load" });
  });

  test("while it loads it has no figure", () => {
    expect(
      describeSessionsTile({ sessions: null, timeRange: PAST_HOUR }).value,
    ).toBeUndefined();
  });
});

describe("crash-free sessions", () => {
  test("is the share of sessions no crash ended", () => {
    expect(
      getCrashFreeSessionsPercent({
        sessions: sessions(200),
        crashes: fault(3, 2),
      }),
    ).toBe(99);
  });

  test("is 100% with no crash, whether or not the crash sessions were read", () => {
    expect(
      getCrashFreeSessionsPercent({
        sessions: sessions(50),
        crashes: fault(0, null),
      }),
    ).toBe(100);
  });

  test("never counts more crashed sessions than there are sessions", () => {
    expect(
      getCrashFreeSessionsPercent({
        sessions: sessions(4),
        crashes: fault(9, 9),
      }),
    ).toBe(0);
  });

  test.each([
    ["the sessions failed", sessions(10, 100, true), fault(1, 1)],
    ["the crashes failed", sessions(10), fault(0, 0, true)],
    ["there are no sessions", sessions(0, 0), fault(0, 0)],
    [
      "the crash sessions failed while crashes happened",
      sessions(10),
      fault(2, null),
    ],
  ])(
    "cannot be told when %s",
    (_: string, read: MobileSessions, crashes: MobileFaultCount) => {
      expect(
        getCrashFreeSessionsPercent({ sessions: read, crashes }),
      ).toBeNull();
    },
  );

  test("is written to two decimals and never rounded up to 100", () => {
    expect(formatSessionShare(100, ENGLISH)).toBe("100%");
    expect(formatSessionShare(99.996, ENGLISH)).toBe("99.99%");
    expect(formatSessionShare(99, ENGLISH)).toBe("99.00%");
    expect(formatSessionShare(-3, ENGLISH)).toBe("0.00%");
  });

  test("is written in the reader's digits", () => {
    expect(formatSessionShare(99.5, PERSIAN)).not.toContain("99");
    expect(formatSessionShare(99.5, PERSIAN)).toMatch(/[۰-۹]/);
  });

  test("the tile shows the share, its bar and the sessions a crash ended", () => {
    const tile: MobileTileText = describeCrashFreeTile({
      sessions: sessions(200),
      crashes: fault(3, 2),
    });

    expect(tile.value).toBe("99.00%");
    expect(tile.percent).toBe(99);
    expect(tile.sublabel).toBe("2 sessions crashed");
  });

  test("one session crashed reads in the singular", () => {
    expect(
      describeCrashFreeTile({ sessions: sessions(10), crashes: fault(1, 1) })
        .sublabel,
    ).toBe("1 session crashed");
  });

  test("no crash says so", () => {
    expect(
      describeCrashFreeTile({ sessions: sessions(10), crashes: fault(0, 0) }),
    ).toEqual({
      value: "100%",
      percent: 100,
      sublabel: "no session crashed",
    });
  });

  test("turns amber below 99.5% and red below 99%", () => {
    expect(CRASH_FREE_THRESHOLDS).toEqual({ warn: 99.5, danger: 99 });
  });

  test("spans that name no session say what the share needs", () => {
    expect(
      describeCrashFreeTile({
        sessions: sessions(0, 40),
        crashes: fault(0, 0),
      }),
    ).toEqual({ value: undefined, sublabel: "needs session.id" });
  });

  test("no sessions in range has no share", () => {
    expect(
      describeCrashFreeTile({ sessions: sessions(0, 0), crashes: fault(0, 0) }),
    ).toEqual({ value: undefined, sublabel: "no sessions in range" });
  });

  test("a failed read on either side could not load", () => {
    expect(
      describeCrashFreeTile({
        sessions: sessions(0, 0, true),
        crashes: fault(0, 0),
      }).sublabel,
    ).toBe("could not load");
    expect(
      describeCrashFreeTile({
        sessions: sessions(10),
        crashes: fault(0, 0, true),
      }).sublabel,
    ).toBe("could not load");
    expect(
      describeCrashFreeTile({
        sessions: sessions(10),
        crashes: fault(2, null),
      }),
    ).toEqual({ value: undefined, sublabel: "could not load" });
  });
});

/*
 * #9716: crash-free installs, a good stand-in for a phone app's users,
 * counted as crash-free sessions are - the distinct app.installation.id of
 * the app's spans, less the ones its crashes named - and drawn under the
 * sessions' share.
 */
describe("Crash-free installs", () => {
  test("is the share of installs no crash happened on", () => {
    expect(
      getCrashFreeInstallsPercent({
        sessions: sessions(200, 2000, false, 80),
        crashes: fault(3, 2, false, 2),
      }),
    ).toBe(97.5);
  });

  test("no crash in range is every install", () => {
    expect(
      getCrashFreeInstallsPercent({
        sessions: sessions(200, 2000, false, 80),
        crashes: fault(0, 0, false, 0),
      }),
    ).toBe(100);
    // Even before the installs of the crashes could be read.
    expect(
      getCrashFreeInstallsPercent({
        sessions: sessions(200, 2000, false, 80),
        crashes: fault(0, 0, false, null),
      }),
    ).toBe(100);
  });

  test("an app that names no install has no share: spans with no app.installation.id, or none counted", () => {
    for (const installs of [0, null]) {
      expect(
        getCrashFreeInstallsPercent({
          sessions: sessions(200, 2000, false, installs),
          crashes: fault(3, 2, false, 2),
        }),
      ).toBeNull();
    }
  });

  test("a crash that named no install leaves the share unknown, never better than it is", () => {
    expect(
      getCrashFreeInstallsPercent({
        sessions: sessions(200, 2000, false, 80),
        crashes: fault(3, 2, false, null),
      }),
    ).toBeNull();
  });

  test("a failed read on either side has no share", () => {
    expect(
      getCrashFreeInstallsPercent({
        sessions: sessions(200, 2000, true, 80),
        crashes: fault(3, 2, false, 2),
      }),
    ).toBeNull();
    expect(
      getCrashFreeInstallsPercent({
        sessions: sessions(200, 2000, false, 80),
        crashes: fault(3, 2, true, 2),
      }),
    ).toBeNull();
    expect(
      getCrashFreeInstallsPercent({ sessions: null, crashes: null }),
    ).toBeNull();
  });

  test("never below 0%: a crash's install the range's spans did not name counts once", () => {
    expect(
      getCrashFreeInstallsPercent({
        sessions: sessions(5, 50, false, 2),
        crashes: fault(4, 3, false, 3),
      }),
    ).toBe(0);
  });

  test("the tile draws it under the sessions' share, in the share's own format", () => {
    const tile: MobileTileText = describeCrashFreeTile({
      sessions: sessions(200, 2000, false, 80),
      crashes: fault(3, 2, false, 2),
    });

    expect(tile.value).toBe("99.00%");
    expect(tile.percent).toBe(99);
    expect(tile.sublabel).toBe("97.50% of installs crash-free");
  });

  test("no crash reads 100% of installs", () => {
    expect(
      describeCrashFreeTile({
        sessions: sessions(10, 100, false, 4),
        crashes: fault(0, 0, false, 0),
      }).sublabel,
    ).toBe("100% of installs crash-free");
  });

  test("without a share of installs the line says how many sessions crashed, as before", () => {
    expect(
      describeCrashFreeTile({
        sessions: sessions(200, 2000, false, 0),
        crashes: fault(3, 2, false, null),
      }).sublabel,
    ).toBe("2 sessions crashed");
    expect(
      describeCrashFreeTile({
        sessions: sessions(200, 2000, false, 80),
        crashes: fault(3, 2, false, null),
      }).sublabel,
    ).toBe("2 sessions crashed");
  });
});

describe("Crashes and ANRs tiles", () => {
  test("count the range's crashes, and the sessions they happened in", () => {
    expect(
      describeFaultTile({ fault: fault(12, 9), timeRange: PAST_HOUR }),
    ).toEqual({ value: "12", sublabel: "in 9 sessions" });
    expect(
      describeFaultTile({ fault: fault(1, 1), timeRange: PAST_HOUR }).sublabel,
    ).toBe("in 1 session");
  });

  test("none is a real zero over the range", () => {
    expect(
      describeFaultTile({ fault: fault(0, 0), timeRange: PAST_HOUR }),
    ).toEqual({ value: "0", sublabel: "Past 1 Hour" });
  });

  test("a count whose sessions could not be read still shows the count", () => {
    expect(
      describeFaultTile({ fault: fault(4, null), timeRange: PAST_HOUR }),
    ).toEqual({ value: "4", sublabel: "Past 1 Hour" });
  });

  test("a failed read could not load", () => {
    expect(
      describeFaultTile({ fault: fault(0, null, true), timeRange: PAST_HOUR }),
    ).toEqual({ value: undefined, sublabel: "could not load" });
  });

  test("a custom range names its window, as the range picker does (#10552)", () => {
    const custom: RangeStartAndEndDateTime = {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(
        new Date("2026-11-18T00:00:00.000Z"),
        NOW,
      ),
    };
    const sublabel: string | undefined = describeFaultTile({
      fault: fault(0, 0),
      timeRange: custom,
    }).sublabel;

    expect(sublabel).toBe(getTimeRangeButtonLabel(custom));
    // Its two ends, never English words for a window.
    expect(sublabel).toContain(TIME_RANGE_LABEL_SEPARATOR);
    expect(sublabel).not.toMatch(/custom|range/i);
  });
});

describe("App starts tile", () => {
  test("counts every start and splits it by kind", () => {
    expect(
      describeAppStartsTile({
        appStarts: appStarts({
          cold: { count: 12, p50DurationMs: 1100, p95DurationMs: 2300 },
          warm: { count: 30, p50DurationMs: 400, p95DurationMs: 900 },
        }),
      }),
    ).toEqual({ value: "42", sublabel: "cold 12, warm 30, hot 0" });
  });

  test("no start says so, as a real zero", () => {
    expect(describeAppStartsTile({ appStarts: appStarts({}) })).toEqual({
      value: "0",
      sublabel: "no app starts",
    });
  });

  test("a failed read could not load", () => {
    expect(describeAppStartsTile({ appStarts: emptyAppStarts(true) })).toEqual({
      value: undefined,
      sublabel: "could not load",
    });
  });
});

describe("Cold start (p95) tile", () => {
  test("is the cold starts' p95, with their median below", () => {
    expect(
      describeColdStartTile({
        appStarts: appStarts({
          cold: { count: 12, p50DurationMs: 1100, p95DurationMs: 2300 },
        }),
      }),
      // A figure keeps its unit on its line (a no-break space).
    ).toEqual({ value: "2.30\u00A0s", sublabel: "median 1.10\u00A0s" });
  });

  test("starts but no cold one is no time, and says why", () => {
    expect(
      describeColdStartTile({
        appStarts: appStarts({
          warm: { count: 3, p50DurationMs: 300, p95DurationMs: 500 },
        }),
      }),
    ).toEqual({ value: undefined, sublabel: "no cold starts" });
  });

  test("no start at all is no time", () => {
    expect(describeColdStartTile({ appStarts: appStarts({}) })).toEqual({
      value: undefined,
      sublabel: "no app starts",
    });
  });

  test("a failed read could not load", () => {
    expect(
      describeColdStartTile({ appStarts: emptyAppStarts(true) }).sublabel,
    ).toBe("could not load");
  });
});

describe("Frozen frames tile", () => {
  test("counts the frozen frames, with the slow ones below", () => {
    expect(describeFrozenFramesTile({ frames: frames(52, 3) })).toEqual({
      value: "3",
      sublabel: "52 slow frames",
    });
    expect(describeFrozenFramesTile({ frames: frames(1, 0) }).sublabel).toBe(
      "1 slow frame",
    );
  });

  test("none is a real zero", () => {
    expect(describeFrozenFramesTile({ frames: frames(0, 0) })).toEqual({
      value: "0",
      sublabel: "0 slow frames",
    });
  });

  test("a failed read could not load", () => {
    expect(
      describeFrozenFramesTile({
        frames: { ...frames(0, 0), failed: true },
      }),
    ).toEqual({ value: undefined, sublabel: "could not load" });
  });
});

describe("an empty app start or frame chart", () => {
  test("waits while the newest arrival is read", () => {
    expect(getMobileSignalEmptyState(null)).toBe("loading");
    expect(
      getMobileSignalEmptyCopy({
        signal: "appStarts",
        lastArrival: null,
        translator: ENGLISH,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("none in 30 days says what turns it on, with the Android Setup docs", () => {
    const copy: MobileSignalEmptyCopy | null = getMobileSignalEmptyCopy({
      signal: "appStarts",
      lastArrival: { at: null, failed: false },
      translator: ENGLISH,
      now: NOW,
    });

    expect(getMobileSignalEmptyState({ at: null, failed: false })).toBe(
      "not-reported",
    );
    expect(copy?.title).toBe("No app starts reported yet");
    expect(copy?.detail).toContain(
      "OpenTelemetry Android records an AppStart span",
    );
    expect(copy?.action).toEqual({
      label: OPEN_ANDROID_SETUP,
      url: RUM_ANDROID_SETUP_DOCS_URL,
    });
    expect(RUM_ANDROID_SETUP_DOCS_URL).toBe("/docs/rum/android-setup");
  });

  test("frames never reported say which SDK reports them", () => {
    const copy: MobileSignalEmptyCopy | null = getMobileSignalEmptyCopy({
      signal: "frames",
      lastArrival: { at: null, failed: false },
      translator: ENGLISH,
      now: NOW,
    });

    expect(copy?.title).toBe("No slow or frozen frames reported yet");
    expect(copy?.detail).toContain("16 ms or 700 ms");
    expect(copy?.action?.url).toBe(RUM_ANDROID_SETUP_DOCS_URL);
  });

  test("none in this range, but before, says when the last one was", () => {
    const copy: MobileSignalEmptyCopy | null = getMobileSignalEmptyCopy({
      signal: "appStarts",
      lastArrival: {
        at: new Date("2026-11-19T07:00:00.000Z"),
        failed: false,
      },
      translator: ENGLISH,
      now: NOW,
    });

    expect(copy?.title).toBe("No app starts in this range");
    expect(copy?.detail).toBe("The last app start was 3\u00A0hours ago.");
    expect(copy?.action).toBeUndefined();
  });

  test("no slow frame in this range is good news, and says so", () => {
    const copy: MobileSignalEmptyCopy | null = getMobileSignalEmptyCopy({
      signal: "frames",
      lastArrival: {
        at: new Date("2026-11-18T10:00:00.000Z"),
        failed: false,
      },
      translator: ENGLISH,
      now: NOW,
    });

    expect(copy?.title).toBe("No slow or frozen frames in this range");
    expect(copy?.detail).toBe(
      "Every frame drew in time. The last slow frame was reported a day ago.",
    );
  });

  test("a lookup that failed says only what is true: none in this range", () => {
    const copy: MobileSignalEmptyCopy | null = getMobileSignalEmptyCopy({
      signal: "frames",
      lastArrival: { at: null, failed: true },
      translator: ENGLISH,
      now: NOW,
    });

    expect(getMobileSignalEmptyState({ at: null, failed: true })).toBe(
      "unknown",
    );
    expect(copy).toEqual({ title: "No slow or frozen frames in this range" });
  });
});

describe("where the tiles link", () => {
  const TRACES: Route = new Route(
    "/dashboard/p1/rum/84858d6c-1111-4aaa-8bbb-000000000001/traces",
  );
  const EXCEPTIONS: Route = new Route("/dashboard/p1/exceptions/unresolved");
  const LOGS: Route = new Route("/dashboard/p1/logs");

  test("App starts opens the app's AppStart spans on the range, every span type listed", () => {
    const params: URLSearchParams = paramsOf(
      buildMobileTracesRoute({
        tracesRoute: TRACES,
        timeRange: PAST_HOUR,
        appStarts: true,
      }),
    );

    expect(params.get("range")).toBe("Past 1 Hour");
    expect(params.get("spanType")).toBe("all");
    expect(JSON.parse(params.get("filters") || "[]")).toEqual([
      ["name", "AppStart"],
    ]);
    expect(params.get("search")).toBeNull();
  });

  test("Cold start opens the cold ones", () => {
    const params: URLSearchParams = paramsOf(
      buildMobileTracesRoute({
        tracesRoute: TRACES,
        timeRange: PAST_HOUR,
        startType: "cold",
      }),
    );

    expect(JSON.parse(params.get("filters") || "[]")).toEqual([
      ["name", "AppStart"],
    ]);
    expect(params.get("search")).toBe("@start.type:cold");
  });

  test("Error rate opens the failed spans", () => {
    expect(
      JSON.parse(
        paramsOf(
          buildMobileTracesRoute({
            tracesRoute: TRACES,
            timeRange: PAST_HOUR,
            errorsOnly: true,
          }),
        ).get("filters") || "[]",
      ),
    ).toEqual([["statusCode", "2"]]);
  });

  test("Sessions, with nothing to filter, opens the spans on the range", () => {
    const route: Route = buildMobileTracesRoute({
      tracesRoute: TRACES,
      timeRange: PAST_HOUR,
    });

    expect(route.toString().startsWith(TRACES.toString())).toBe(true);
    expect(paramsOf(route).get("filters")).toBeNull();
  });

  test("a custom range carries its start and end", () => {
    const params: URLSearchParams = paramsOf(
      buildMobileTracesRoute({
        tracesRoute: TRACES,
        timeRange: {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2026-11-18T00:00:00.000Z"),
            NOW,
          ),
        },
        appStarts: true,
      }),
    );

    expect(params.get("range")).toBe("Custom");
    expect(new Date(params.get("start") || "").toISOString()).toBe(
      "2026-11-18T00:00:00.000Z",
    );
    expect(new Date(params.get("end") || "").toISOString()).toBe(
      NOW.toISOString(),
    );
  });

  test("Crashes open the app's exceptions, ANRs only the types ANR and Hang", () => {
    expect(
      JSON.parse(
        paramsOf(
          buildMobileExceptionsRoute({
            exceptionsRoute: EXCEPTIONS,
            rumApplicationId: APP_ID,
            timeRange: PAST_HOUR,
          }),
        ).get("filters") || "[]",
      ),
    ).toEqual([["rumApplicationId", APP_ID]]);

    const anrs: URLSearchParams = paramsOf(
      buildMobileExceptionsRoute({
        exceptionsRoute: EXCEPTIONS,
        rumApplicationId: APP_ID,
        timeRange: PAST_HOUR,
        anrsOnly: true,
      }),
    );

    // An iOS app's hang is its ANR (#9712): both chips, one any-of filter.
    expect(JSON.parse(anrs.get("filters") || "[]")).toEqual([
      ["rumApplicationId", APP_ID],
      ["exceptionType", "ANR"],
      ["exceptionType", "Hang"],
    ]);
    expect(anrs.get("range")).toBe("Past 1 Hour");
  });

  test("Frozen frames open the app's app.jank events at the 700 ms threshold", () => {
    const params: URLSearchParams = paramsOf(
      buildMobileFrozenFramesLogsRoute({
        logsRoute: LOGS,
        rumApplicationId: APP_ID,
        timeRange: PAST_HOUR,
      }),
    );
    const filters: Array<[string, Array<string>]> = JSON.parse(
      params.get("filters") || "[]",
    );

    expect(params.get("range")).toBe("Past 1 Hour");
    expect(filters).toContainEqual(["rumApplicationId", [APP_ID]]);
    expect(filters).toContainEqual(["attributes.event.name", ["app.jank"]]);
    expect(filters).toContainEqual(["attributes.app.jank.threshold", ["0.7"]]);
  });

  test("a value is encoded once, so the route holds no raw space or colon", () => {
    const route: Route = withQueryParams(TRACES, {
      search: "@start.type:cold",
      range: "Past 1 Hour",
    });

    expect(route.toString()).not.toMatch(/[ ]/);
    expect(route.toString()).toContain("search=%40start.type%3Acold");
  });

  test("no params is the route as it was", () => {
    expect(withQueryParams(TRACES, {}).toString()).toBe(TRACES.toString());
  });
});
