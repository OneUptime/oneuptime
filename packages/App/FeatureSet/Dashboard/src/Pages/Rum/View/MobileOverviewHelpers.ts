import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import OneUptimeDate from "Common/Types/Date";
import { writeFigureInLanguage } from "Common/Types/DateLanguage";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  TRACE_SPAN_TYPE_URL_PARAM,
  TraceSpanType,
} from "Common/Types/Telemetry/TraceSpanType";
import {
  APP_JANK_EVENT_NAME,
  APP_JANK_THRESHOLD_ATTRIBUTE,
  APP_START_SPAN_NAME,
  APP_START_TYPE_ATTRIBUTE,
  AppStartType,
  EVENT_NAME_ATTRIBUTE,
  FROZEN_FRAME_THRESHOLD,
} from "Common/Types/Rum/MobileAppTelemetry";
import { APP_NOT_RESPONDING_EXCEPTION_TYPES } from "Common/Utils/Telemetry/MobileAppFaults";
import { toLogsExplorerQueryParams } from "Common/Utils/Telemetry/CrossSignalScope";
import {
  composedValue,
  getGlobalTranslator,
  translatePlural,
  translateTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  formatCompact,
  formatDurationMsInLanguage,
} from "../../../Components/TelemetryResource/telemetryFormat";
import {
  MobileAppStarts,
  MobileFaultCount,
  MobileFrames,
  MobileSessions,
} from "../../../Components/Rum/MobileOverview/MobileRumSignalData";
import { RUM_ANDROID_SETUP_DOCS_URL } from "../../../Components/Rum/RumSetupGuide";
import { TileText, describeTimeRangeForTile } from "./OverviewHelpers";

/*
 * THE MOBILE APP OVERVIEW'S WORDS AND LINKS (#9588), WITHOUT REACT.
 *
 * A mobile RUM application's Overview draws what a mobile team watches
 * first - sessions, crash-free sessions, crashes, ANRs, app starts, cold
 * start time and frozen frames - in place of a browser app's page loads
 * and Web Vitals. What each tile says, in each state its reads can be in,
 * and where it links, is decided here, so a node test runs every case;
 * Overview.tsx draws it. The data is MobileRumSignalData's.
 *
 * A failed read is unknown, never zero: its tile says "could not load"
 * (correlation-14, as the browser tiles do). A signal nothing has reported
 * says what turns it on, with the Android Setup docs one click away,
 * rather than drawing an empty chart.
 */

/* ---------------------------------------------------------------- Tiles */

// "could not load", the line every tile of a failed read says.
const COULD_NOT_LOAD: string = "could not load";

/*
 * Crash-free sessions turn amber below 99.5% and red below 99%: a crash
 * in one session of a hundred is what a mobile team treats as an outage
 * (Android vitals' bad behaviour for crashes is 1.09% of daily users).
 */
export const CRASH_FREE_THRESHOLDS: { warn: number; danger: number } = {
  warn: 99.5,
  danger: 99,
};

/*
 * A share of sessions to two decimals, never rounded up to 100: "99.99%"
 * while one session in ten thousand crashed, and "100%" only with none.
 * In the reader's digits and percent sign (writeFigureInLanguage).
 */
export function formatSessionShare(
  percent: number,
  translator: Translator,
): string {
  if (percent >= 100) {
    return writeFigureInLanguage("100%", translator.language);
  }

  const floored: number = Math.floor(Math.max(0, percent) * 100) / 100;

  return writeFigureInLanguage(`${floored.toFixed(2)}%`, translator.language);
}

/*
 * The share of the range's sessions no crash ended, or null when it cannot
 * be told: the sessions are not known, or there are none, or the sessions
 * a crash ended could not be read while crashes did happen.
 */
export function getCrashFreeSessionsPercent(input: {
  sessions: MobileSessions | null;
  crashes: MobileFaultCount | null;
}): number | null {
  if (
    !input.sessions ||
    input.sessions.failed ||
    input.sessions.sessions <= 0 ||
    !input.crashes ||
    input.crashes.failed
  ) {
    return null;
  }

  if (input.crashes.total <= 0) {
    return 100;
  }

  if (input.crashes.sessions === null) {
    return null;
  }

  const crashed: number = Math.min(
    input.crashes.sessions,
    input.sessions.sessions,
  );

  return ((input.sessions.sessions - crashed) / input.sessions.sessions) * 100;
}

/*
 * The share of the range's installs no crash happened on (#9716), counted
 * as the sessions' share is: the distinct app.installation.id of the app's
 * spans, less those its crashes named. A good stand-in for its users, as
 * OpenTelemetry Android identifies none. Null when it cannot be told: the
 * spans name no install (an SDK that sets none), or a crash named none.
 */
export function getCrashFreeInstallsPercent(input: {
  sessions: MobileSessions | null;
  crashes: MobileFaultCount | null;
}): number | null {
  if (
    !input.sessions ||
    input.sessions.failed ||
    typeof input.sessions.installs !== "number" ||
    input.sessions.installs <= 0 ||
    !input.crashes ||
    input.crashes.failed
  ) {
    return null;
  }

  if (input.crashes.total <= 0) {
    return 100;
  }

  if (typeof input.crashes.installs !== "number") {
    return null;
  }

  const crashed: number = Math.min(
    input.crashes.installs,
    input.sessions.installs,
  );

  return ((input.sessions.installs - crashed) / input.sessions.installs) * 100;
}

/*
 * Words drawn in place of a figure when the app's spans carry no session
 * id at all (ResourceOverviewTile.valueNote), in the tile's own language.
 */
export const SESSIONS_NOT_REPORTED_NOTE: string =
  translationKey("No session.id");

export interface MobileTileText extends TileText {
  valueNote?: string | undefined;
  // 0-100 for the tile's bar, when it has one.
  percent?: number | null | undefined;
}

/*
 * "Sessions": the distinct session ids of the app's spans in the range.
 * Spans that name no session say so rather than reading as nobody using
 * the app: OpenTelemetry Android sets session.id on every span and log.
 */
export function describeSessionsTile(input: {
  sessions: MobileSessions | null;
  timeRange: RangeStartAndEndDateTime;
}): MobileTileText {
  if (!input.sessions) {
    return {
      value: undefined,
      sublabel: describeTimeRangeForTile(input.timeRange),
    };
  }

  if (input.sessions.failed) {
    return { value: undefined, sublabel: COULD_NOT_LOAD };
  }

  if (input.sessions.sessions <= 0 && input.sessions.spans > 0) {
    return {
      value: undefined,
      valueNote: SESSIONS_NOT_REPORTED_NOTE,
      sublabel: "spans name no session",
    };
  }

  return {
    value: formatCompact(input.sessions.sessions, getGlobalTranslator()),
    sublabel: describeTimeRangeForTile(input.timeRange),
  };
}

/*
 * "Crash-free sessions": the share of the range's sessions no crash ended.
 * Under it, the share of its installs no crash happened on, when the app
 * names its installs (#9716); else how many sessions crashed, which the
 * Crashes tile beside it says too.
 */
export function describeCrashFreeTile(input: {
  sessions: MobileSessions | null;
  crashes: MobileFaultCount | null;
}): MobileTileText {
  if (input.sessions?.failed || input.crashes?.failed) {
    return { value: undefined, sublabel: COULD_NOT_LOAD };
  }

  if (!input.sessions || !input.crashes) {
    return { value: undefined, sublabel: "of the sessions in range" };
  }

  if (input.sessions.sessions <= 0) {
    return {
      value: undefined,
      sublabel:
        input.sessions.spans > 0 ? "needs session.id" : "no sessions in range",
    };
  }

  const percent: number | null = getCrashFreeSessionsPercent(input);

  if (percent === null) {
    return { value: undefined, sublabel: COULD_NOT_LOAD };
  }

  const crashed: number =
    input.crashes.total > 0
      ? Math.min(input.crashes.sessions || 0, input.sessions.sessions)
      : 0;

  const installsPercent: number | null = getCrashFreeInstallsPercent(input);

  if (installsPercent !== null) {
    return {
      value: formatSessionShare(percent, getGlobalTranslator()),
      percent: percent,
      sublabel: translateTemplate("{{share}} of installs crash-free", {
        share: formatSessionShare(installsPercent, getGlobalTranslator()),
      }),
    };
  }

  return {
    value: formatSessionShare(percent, getGlobalTranslator()),
    percent: percent,
    sublabel:
      crashed > 0
        ? translatePlural(
            {
              one: "{{count}} session crashed",
              other: "{{count}} sessions crashed",
            },
            crashed,
            { count: formatCompact(crashed, getGlobalTranslator()) },
          )
        : "no session crashed",
  };
}

/*
 * "Crashes" and "ANRs": how many happened in the range, and in how many
 * sessions when that is known.
 */
export function describeFaultTile(input: {
  fault: MobileFaultCount | null;
  timeRange: RangeStartAndEndDateTime;
}): MobileTileText {
  if (!input.fault) {
    return {
      value: undefined,
      sublabel: describeTimeRangeForTile(input.timeRange),
    };
  }

  if (input.fault.failed) {
    return { value: undefined, sublabel: COULD_NOT_LOAD };
  }

  const value: string = formatCompact(input.fault.total, getGlobalTranslator());

  if (input.fault.total > 0 && input.fault.sessions !== null) {
    return {
      value,
      sublabel: translatePlural(
        { one: "in {{count}} session", other: "in {{count}} sessions" },
        input.fault.sessions,
        {
          count: formatCompact(input.fault.sessions, getGlobalTranslator()),
        },
      ),
    };
  }

  return { value, sublabel: describeTimeRangeForTile(input.timeRange) };
}

// "App starts": every AppStart span in the range, split by start type.
export function describeAppStartsTile(input: {
  appStarts: MobileAppStarts | null;
}): MobileTileText {
  if (!input.appStarts) {
    return { value: undefined, sublabel: "cold, warm and hot" };
  }

  if (input.appStarts.failed) {
    return { value: undefined, sublabel: COULD_NOT_LOAD };
  }

  if (input.appStarts.total <= 0) {
    return {
      value: formatCompact(0, getGlobalTranslator()),
      sublabel: "no app starts",
    };
  }

  const count: (type: AppStartType) => string = (
    type: AppStartType,
  ): string => {
    return formatCompact(
      input.appStarts!.byType[type].count,
      getGlobalTranslator(),
    );
  };

  return {
    value: formatCompact(input.appStarts.total, getGlobalTranslator()),
    sublabel: translateTemplate("cold {{cold}}, warm {{warm}}, hot {{hot}}", {
      cold: count("cold"),
      warm: count("warm"),
      hot: count("hot"),
    }),
  };
}

/*
 * "Cold start (p95)": how long the slowest 5% of cold starts took, with
 * the median below, as the page-load tile reads a browser's. No cold start
 * is no time - a dash, not "0 ms".
 */
export function describeColdStartTile(input: {
  appStarts: MobileAppStarts | null;
}): MobileTileText {
  if (!input.appStarts) {
    return { value: undefined, sublabel: "from launch to first screen" };
  }

  if (input.appStarts.failed) {
    return { value: undefined, sublabel: COULD_NOT_LOAD };
  }

  const cold: MobileAppStarts["byType"]["cold"] = input.appStarts.byType.cold;

  if (cold.count <= 0 || cold.p95DurationMs === null) {
    return {
      value: undefined,
      sublabel: input.appStarts.total > 0 ? "no cold starts" : "no app starts",
    };
  }

  const median: number | null = cold.p50DurationMs;

  return {
    value: formatDurationMsInLanguage(
      cold.p95DurationMs,
      getGlobalTranslator(),
    ),
    sublabel:
      median === null
        ? "from launch to first screen"
        : translateTemplate("median {{duration}}", {
            duration: composedValue((sentence: Translator): string => {
              return formatDurationMsInLanguage(median, sentence);
            }),
          }),
  };
}

/*
 * "Frozen frames": the frames that took longer than 700 ms to draw, with
 * the frames slower than 16 ms below (a frozen frame is one of those too).
 */
export function describeFrozenFramesTile(input: {
  frames: MobileFrames | null;
}): MobileTileText {
  if (!input.frames) {
    return { value: undefined, sublabel: "slower than 700 ms" };
  }

  if (input.frames.failed) {
    return { value: undefined, sublabel: COULD_NOT_LOAD };
  }

  return {
    value: formatCompact(input.frames.frozen, getGlobalTranslator()),
    sublabel: translatePlural(
      { one: "{{count}} slow frame", other: "{{count}} slow frames" },
      input.frames.slow,
      { count: formatCompact(input.frames.slow, getGlobalTranslator()) },
    ),
  };
}

/* ------------------------------------------------- Empty charts' words */

/*
 * Why a mobile signal's chart is empty:
 *
 *   not-reported - nothing of it in the past 30 days while the app sends
 *                  other telemetry: the SDK does not report it (only
 *                  OpenTelemetry Android sends these on its own);
 *   quiet        - it has arrived before, just not in this range;
 *   unknown      - whether it ever arrived could not be read;
 *   loading      - that read is still out.
 */
export type MobileSignalEmptyState =
  | "loading"
  | "not-reported"
  | "quiet"
  | "unknown";

export type MobileChartSignal = "appStarts" | "frames";

export interface MobileSignalEmptyCopy {
  title: string;
  detail?: string | undefined;
  // Where to turn it on: the Android Setup docs, in a new tab.
  action?: { label: string; url: string } | undefined;
}

export const OPEN_ANDROID_SETUP: string = translationKey("Open Android Setup");

/*
 * The newest arrival, read only while the range has none: null while it
 * loads, `failed` when it could not be read, `at: null` for none in the
 * past 30 days.
 */
export function getMobileSignalEmptyState(
  lastArrival: { at: Date | null; failed: boolean } | null,
): MobileSignalEmptyState {
  if (!lastArrival) {
    return "loading";
  }

  if (lastArrival.failed) {
    return "unknown";
  }

  return lastArrival.at ? "quiet" : "not-reported";
}

const EMPTY_WORDS: Readonly<
  Record<
    MobileChartSignal,
    {
      notReportedTitle: string;
      notReportedDetail: string;
      quietTitle: string;
      quietDetail: string;
    }
  >
> = {
  appStarts: {
    notReportedTitle: translationKey("No app starts reported yet"),
    notReportedDetail: translationKey(
      "OpenTelemetry Android records an AppStart span every time the app starts, whether cold, warm or hot. Another SDK sends them only if your app records a span named AppStart with start.type set.",
    ),
    quietTitle: translationKey("No app starts in this range"),
    quietDetail: translationKey("The last app start was {{time}}."),
  },
  frames: {
    notReportedTitle: translationKey("No slow or frozen frames reported yet"),
    notReportedDetail: translationKey(
      "OpenTelemetry Android reports the frames that take longer than 16 ms or 700 ms to draw, on Android 7.0 and later. Another SDK reports them only if your app sends app.jank events.",
    ),
    quietTitle: translationKey("No slow or frozen frames in this range"),
    quietDetail: translationKey(
      "Every frame drew in time. The last slow frame was reported {{time}}.",
    ),
  },
};

/*
 * What an empty app start or frame chart says, in the reader's language,
 * or null while there is nothing to say yet (the newest arrival is still
 * being read: the chart keeps its skeleton).
 */
export function getMobileSignalEmptyCopy(input: {
  signal: MobileChartSignal;
  lastArrival: { at: Date | null; failed: boolean } | null;
  translator: Translator;
  now: Date;
}): MobileSignalEmptyCopy | null {
  const words: (typeof EMPTY_WORDS)[MobileChartSignal] =
    EMPTY_WORDS[input.signal];
  const state: MobileSignalEmptyState = getMobileSignalEmptyState(
    input.lastArrival,
  );
  const translate: (text: string) => string = (text: string): string => {
    return input.translator.translateText(text) || text;
  };

  if (state === "loading") {
    return null;
  }

  if (state === "not-reported") {
    return {
      title: translate(words.notReportedTitle),
      detail: translate(words.notReportedDetail),
      action: {
        label: translate(OPEN_ANDROID_SETUP),
        url: RUM_ANDROID_SETUP_DOCS_URL,
      },
    };
  }

  if (state === "quiet" && input.lastArrival?.at) {
    return {
      title: translate(words.quietTitle),
      detail: input.translator.translateTemplate(words.quietDetail, {
        time: OneUptimeDate.fromNow(input.lastArrival.at, input.now),
      }),
    };
  }

  return { title: translate(words.quietTitle) };
}

/* ---------------------------------------------------------------- Links */

/*
 * A route with query params, each value encoded once (Route appends them
 * verbatim and refuses raw spaces and colons). The route as it was when a
 * value cannot be carried: a tile then opens the page without its filter,
 * never a broken link.
 */
export function withQueryParams(
  route: Route,
  params: Dictionary<string>,
): Route {
  const encoded: Dictionary<string> = {};

  for (const [key, value] of Object.entries(params)) {
    encoded[key] = encodeURIComponent(value).replace(/~/g, "%7E");
  }

  if (Object.keys(encoded).length === 0) {
    return route;
  }

  try {
    return new Route(route.toString()).addQueryParams(encoded);
  } catch {
    return route;
  }
}

// The explorers' range grammar: range=<TimeRange>, and start/end for Custom.
function rangeParams(timeRange: RangeStartAndEndDateTime): Dictionary<string> {
  const params: Dictionary<string> = { range: String(timeRange.range) };

  if (timeRange.range === TimeRange.CUSTOM && timeRange.startAndEndDate) {
    params["start"] = OneUptimeDate.toString(
      timeRange.startAndEndDate.startValue,
    );
    params["end"] = OneUptimeDate.toString(timeRange.startAndEndDate.endValue);
  }

  return params;
}

/*
 * The application's own Traces page on the tile's range, filtered as the
 * explorer's chips and search write it: the AppStart spans (of one start
 * type), or the failed spans. Every span type is listed, so an app start is
 * found whether or not it counts as an entry span.
 */
export function buildMobileTracesRoute(input: {
  tracesRoute: Route;
  timeRange: RangeStartAndEndDateTime;
  appStarts?: boolean | undefined;
  startType?: AppStartType | undefined;
  errorsOnly?: boolean | undefined;
}): Route {
  const filters: Array<[string, string]> = [];
  const params: Dictionary<string> = {
    ...rangeParams(input.timeRange),
    [TRACE_SPAN_TYPE_URL_PARAM]: TraceSpanType.All,
  };

  if (input.appStarts || input.startType) {
    filters.push(["name", APP_START_SPAN_NAME]);
  }

  if (input.startType) {
    params["search"] = `@${APP_START_TYPE_ATTRIBUTE}:${input.startType}`;
  }

  if (input.errorsOnly) {
    filters.push(["statusCode", "2"]);
  }

  if (filters.length > 0) {
    params["filters"] = JSON.stringify(filters);
  }

  return withQueryParams(input.tracesRoute, params);
}

/*
 * The Exceptions explorer scoped to the application on the tile's range,
 * and for the ANRs tile to the types a freeze is filed under: ANR, and an
 * iOS app's Hang.
 */
export function buildMobileExceptionsRoute(input: {
  exceptionsRoute: Route;
  rumApplicationId: string;
  timeRange: RangeStartAndEndDateTime;
  anrsOnly?: boolean | undefined;
}): Route {
  const filters: Array<[string, string]> = [
    ["rumApplicationId", input.rumApplicationId],
  ];

  if (input.anrsOnly) {
    for (const exceptionType of APP_NOT_RESPONDING_EXCEPTION_TYPES) {
      filters.push(["exceptionType", exceptionType]);
    }
  }

  return withQueryParams(input.exceptionsRoute, {
    ...rangeParams(input.timeRange),
    filters: JSON.stringify(filters),
  });
}

/*
 * The Logs explorer scoped to the application's app.jank events at the
 * frozen threshold, on the tile's range, written by the explorer's own
 * serializer so each chip means its literal value.
 */
export function buildMobileFrozenFramesLogsRoute(input: {
  logsRoute: Route;
  rumApplicationId: string;
  timeRange: RangeStartAndEndDateTime;
}): Route {
  const scope: Dictionary<string> = toLogsExplorerQueryParams({
    resourceFacetSelections: { rumApplicationId: [input.rumApplicationId] },
    attributes: {
      [EVENT_NAME_ATTRIBUTE]: APP_JANK_EVENT_NAME,
      [APP_JANK_THRESHOLD_ATTRIBUTE]: FROZEN_FRAME_THRESHOLD,
    },
  }).params;

  return withQueryParams(input.logsRoute, {
    ...rangeParams(input.timeRange),
    ...scope,
  });
}
