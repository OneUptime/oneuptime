import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import {
  APP_JANK_EVENT_NAME,
  APP_JANK_FRAME_COUNT_ATTRIBUTE,
  APP_JANK_THRESHOLD_ATTRIBUTE,
  APP_SCREEN_NAME_ATTRIBUTE,
  APP_START_SPAN_NAME,
  APP_START_TYPE_ATTRIBUTE,
  APP_START_TYPES,
  AppStartType,
  EVENT_NAME_ATTRIBUTE,
  FROZEN_FRAME_THRESHOLD,
  SLOW_FRAME_THRESHOLD,
} from "Common/Types/Rum/MobileAppTelemetry";
import { APP_NOT_RESPONDING_EXCEPTION_TYPES } from "Common/Utils/Telemetry/MobileAppFaults";
import { parseBucketTimeMs } from "../../TelemetryResource/telemetryFormat";

/*
 * WHAT A MOBILE RUM APPLICATION'S OVERVIEW READS (#9588), WITHOUT THE NETWORK.
 *
 * The request each read sends, and how its answer is folded into what the
 * tiles and charts draw: React-free and API-free, so a node test runs every
 * fold for real. MobileRumSignalReads sends the requests.
 *
 *   - App starts: the AppStart spans, split by start.type - the whole
 *     range's count and percentiles per type (one table read), and a count
 *     and a p95 per interval per type (two timeseries reads).
 *   - Sessions: the distinct session ids of the app's spans, and their
 *     distinct app.installation.id, beside the spans read (POST
 *     /telemetry/traces/session-count).
 *   - Crashes and ANRs: the exception histogram twice - unhandled with the
 *     types ANR and Hang left out (a crash, as MobileAppFaults files one),
 *     and those two types alone (an Android ANR, an iOS hang) - and the
 *     sessions and installs each happened in.
 *   - Slow and frozen frames: app.jank.frame_count added up per threshold
 *     and interval (one event stands for several frames), and per screen.
 *
 * A read that fails is marked failed and folds to zeros, so a tile says
 * "could not load" rather than a confident 0.
 */

export interface TimePoint {
  x: Date;
  y: number;
}

export interface MobileSignalScope {
  primaryEntityId: ObjectID;
  start: Date;
  end: Date;
}

/*
 * The screens the frame breakdown lists: the ten with the most frozen
 * frames, then slow ones. The read asks for more rows than that, as each
 * screen has a row per threshold.
 */
export const FRAMES_BY_SCREEN_LIMIT: number = 10;
export const FRAMES_BY_SCREEN_READ_LIMIT: number = 100;

// How far back an empty chart looks for the signal having ever arrived.
export const MOBILE_SIGNAL_LOOKBACK_DAYS: number = 30;

function windowOf(scope: MobileSignalScope): JSONObject {
  return {
    startTime: scope.start.toISOString(),
    endTime: scope.end.toISOString(),
    serviceIds: [scope.primaryEntityId.toString()],
  };
}

/* ------------------------------------------------------------ Requests */

// The whole range's AppStart statistics, one row per start type.
export function buildAppStartTableBody(scope: MobileSignalScope): JSONObject {
  return {
    ...windowOf(scope),
    chartType: "table",
    metric: "count",
    groupBy: [APP_START_TYPE_ATTRIBUTE],
    spanNames: [APP_START_SPAN_NAME],
    limit: 10,
  };
}

// AppStart spans per interval and start type: a count, or the p95 duration.
export function buildAppStartSeriesBody(
  scope: MobileSignalScope,
  metric: "count" | "p95Duration",
): JSONObject {
  return {
    ...windowOf(scope),
    chartType: "timeseries",
    metric: metric,
    groupBy: [APP_START_TYPE_ATTRIBUTE],
    spanNames: [APP_START_SPAN_NAME],
    limit: 10,
  };
}

// The installs too (#9716): the distinct app.installation.id of the spans.
export function buildSessionCountBody(scope: MobileSignalScope): JSONObject {
  return { ...windowOf(scope), countInstalls: true };
}

/*
 * The sessions a crash or a freeze happened in, and the installs: the
 * exception histogram's filters, with the installs asked for.
 */
export function buildFaultSessionCountBody(filterBody: JSONObject): JSONObject {
  return { ...filterBody, countInstalls: true };
}

/*
 * A crash: an unhandled exception that is not a freeze. Since #9533 a crash
 * event becomes an unhandled exception (MobileAppFaults), and so does an
 * ANR, under the type ANR, and an iOS hang, under the type Hang.
 */
export function buildCrashFilterBody(scope: MobileSignalScope): JSONObject {
  return {
    ...windowOf(scope),
    escaped: true,
    excludedExceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
  };
}

// A freeze: an Android ANR or an iOS hang.
export function buildAnrFilterBody(scope: MobileSignalScope): JSONObject {
  return {
    ...windowOf(scope),
    exceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
  };
}

// The frames of the app.jank events, added up per interval and threshold.
export function buildFrameSeriesBody(scope: MobileSignalScope): JSONObject {
  return {
    ...windowOf(scope),
    chartType: "timeseries",
    aggregation: "sum",
    aggregationField: APP_JANK_FRAME_COUNT_ATTRIBUTE,
    groupBy: [APP_JANK_THRESHOLD_ATTRIBUTE],
    attributes: { [EVENT_NAME_ATTRIBUTE]: APP_JANK_EVENT_NAME },
  };
}

// The same frames per screen and threshold, the busiest first.
export function buildFramesByScreenBody(scope: MobileSignalScope): JSONObject {
  return {
    ...windowOf(scope),
    chartType: "table",
    aggregation: "sum",
    aggregationField: APP_JANK_FRAME_COUNT_ATTRIBUTE,
    groupBy: [APP_SCREEN_NAME_ATTRIBUTE, APP_JANK_THRESHOLD_ATTRIBUTE],
    attributes: { [EVENT_NAME_ATTRIBUTE]: APP_JANK_EVENT_NAME },
    limit: FRAMES_BY_SCREEN_READ_LIMIT,
  };
}

/* ------------------------------------------------------------- Answers */

function toNumber(value: unknown): number {
  const parsed: number = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function rowsOf(data: unknown): Array<JSONObject> {
  return Array.isArray(data)
    ? (data as Array<unknown>).filter((row: unknown): row is JSONObject => {
        return Boolean(row) && typeof row === "object" && !Array.isArray(row);
      })
    : [];
}

function groupValue(row: JSONObject, key: string): string {
  const groupValues: unknown = row["groupValues"];

  if (!groupValues || typeof groupValues !== "object") {
    return "";
  }

  const value: unknown = (groupValues as Record<string, unknown>)[key];

  return typeof value === "string" ? value.trim() : "";
}

function toSortedSeries(byTime: Map<number, number>): Array<TimePoint> {
  return Array.from(byTime.entries())
    .sort((left: [number, number], right: [number, number]): number => {
      return left[0] - right[0];
    })
    .map(([ms, y]: [number, number]): TimePoint => {
      return { x: new Date(ms), y };
    });
}

function addPoint(
  byTime: Map<number, number>,
  time: unknown,
  value: number,
): void {
  const ms: number | null = parseBucketTimeMs(time);

  if (ms === null) {
    return;
  }

  byTime.set(ms, (byTime.get(ms) || 0) + value);
}

function readStartType(value: string): AppStartType | null {
  const type: string = value.toLowerCase();

  return (APP_START_TYPES as ReadonlyArray<string>).includes(type)
    ? (type as AppStartType)
    : null;
}

export interface AppStartTypeStats {
  count: number;
  // null while there is no start of this type to time.
  p50DurationMs: number | null;
  p95DurationMs: number | null;
}

export interface MobileAppStarts {
  // Every AppStart span with a start type, whichever type.
  total: number;
  byType: Record<AppStartType, AppStartTypeStats>;
  countSeries: Record<AppStartType, Array<TimePoint>>;
  p95Series: Record<AppStartType, Array<TimePoint>>;
  failed: boolean;
}

function emptyByType<T>(make: () => T): Record<AppStartType, T> {
  return {
    cold: make(),
    warm: make(),
    hot: make(),
  };
}

export function emptyAppStarts(failed: boolean): MobileAppStarts {
  return {
    total: 0,
    byType: emptyByType<AppStartTypeStats>((): AppStartTypeStats => {
      return { count: 0, p50DurationMs: null, p95DurationMs: null };
    }),
    countSeries: emptyByType<Array<TimePoint>>((): Array<TimePoint> => {
      return [];
    }),
    p95Series: emptyByType<Array<TimePoint>>((): Array<TimePoint> => {
      return [];
    }),
    failed,
  };
}

/*
 * The trace analytics answers folded per start type. A start type the SDK
 * does not use (a custom one) still counts towards the total, and has no
 * line of its own.
 */
export function summarizeAppStarts(input: {
  tableRows: unknown;
  countRows: unknown;
  p95Rows: unknown;
}): MobileAppStarts {
  const result: MobileAppStarts = emptyAppStarts(false);

  for (const row of rowsOf(input.tableRows)) {
    const count: number = toNumber(row["count"]);

    if (count <= 0) {
      continue;
    }

    result.total += count;

    const type: AppStartType | null = readStartType(
      groupValue(row, APP_START_TYPE_ATTRIBUTE),
    );

    if (!type) {
      continue;
    }

    result.byType[type] = {
      count: result.byType[type].count + count,
      p50DurationMs: toNumber(row["p50DurationMs"]),
      p95DurationMs: toNumber(row["p95DurationMs"]),
    };
  }

  const fold: (rows: unknown) => Record<AppStartType, Array<TimePoint>> = (
    rows: unknown,
  ): Record<AppStartType, Array<TimePoint>> => {
    const byType: Record<AppStartType, Map<number, number>> = emptyByType<
      Map<number, number>
    >((): Map<number, number> => {
      return new Map<number, number>();
    });

    for (const row of rowsOf(rows)) {
      const type: AppStartType | null = readStartType(
        groupValue(row, APP_START_TYPE_ATTRIBUTE),
      );

      if (type) {
        addPoint(byType[type], row["time"], toNumber(row["value"]));
      }
    }

    return {
      cold: toSortedSeries(byType.cold),
      warm: toSortedSeries(byType.warm),
      hot: toSortedSeries(byType.hot),
    };
  };

  result.countSeries = fold(input.countRows);
  result.p95Series = fold(input.p95Rows);

  return result;
}

export interface MobileSessions {
  // Distinct session ids of the app's spans in the range.
  sessions: number;
  // Every span read: spans and no sessions mean no session.id is set.
  spans: number;
  /*
   * Distinct app.installation.id of the app's spans in the range; null
   * when the answer did not say. Spans and no installs mean the SDK sets
   * none, as opentelemetry-swift's releases do not.
   */
  installs: number | null;
  failed: boolean;
}

function readAnswer(data: unknown): JSONObject {
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as JSONObject)
    : {};
}

// A count the answer may leave out: null when it does.
function readOptionalCount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const count: number = Number(value);

  return Number.isFinite(count) ? count : null;
}

export function readSessionCount(data: unknown): MobileSessions {
  const answer: JSONObject = readAnswer(data);

  return {
    sessions: toNumber(answer["sessions"]),
    spans: toNumber(answer["spans"]),
    installs: readOptionalCount(answer["installs"]),
    failed: false,
  };
}

export interface MobileFaultCount {
  total: number;
  series: Array<TimePoint>;
  // The sessions it happened in; null when that read failed.
  sessions: number | null;
  /*
   * The installs it happened on; null when that read failed, or when an
   * occurrence named no install (one stored before installs were kept, or
   * from an SDK that sets none), so their number cannot be told.
   */
  installs: number | null;
  failed: boolean;
}

export interface MobileFaults {
  crashes: MobileFaultCount;
  anrs: MobileFaultCount;
}

// An exception histogram's buckets, every series together, per interval.
export function summarizeFaultBuckets(buckets: unknown): {
  total: number;
  series: Array<TimePoint>;
} {
  const byTime: Map<number, number> = new Map<number, number>();
  let total: number = 0;

  for (const bucket of rowsOf(buckets)) {
    const count: number = toNumber(bucket["count"]);

    if (count <= 0) {
      continue;
    }

    total += count;
    addPoint(byTime, bucket["time"], count);
  }

  return { total, series: toSortedSeries(byTime) };
}

// The sessions an exception session-count answer names.
export function readFaultSessions(data: unknown): number {
  return toNumber(readAnswer(data)["sessions"]);
}

/*
 * The installs an exception session-count answer names, or null when it
 * cannot be told: the answer did not count them, or an occurrence named no
 * install.
 */
export function readFaultInstalls(data: unknown): number | null {
  const answer: JSONObject = readAnswer(data);
  const installs: number | null = readOptionalCount(answer["installs"]);
  const withInstall: number | null = readOptionalCount(
    answer["occurrencesWithInstall"],
  );

  if (installs === null || withInstall === null) {
    return null;
  }

  return withInstall < toNumber(answer["occurrences"]) ? null : installs;
}

export interface ScreenFrames {
  screen: string;
  // Frames slower than 16 ms; a frozen frame is one of them too.
  slow: number;
  // Frames slower than 700 ms.
  frozen: number;
}

export interface MobileFrames {
  slow: number;
  frozen: number;
  slowSeries: Array<TimePoint>;
  frozenSeries: Array<TimePoint>;
  byScreen: Array<ScreenFrames>;
  failed: boolean;
  byScreenFailed: boolean;
}

export function emptyFrames(failed: boolean): MobileFrames {
  return {
    slow: 0,
    frozen: 0,
    slowSeries: [],
    frozenSeries: [],
    byScreen: [],
    failed,
    byScreenFailed: failed,
  };
}

/*
 * Which of the two thresholds a value names, read as a number so "0.70" is
 * the frozen threshold too; null for any other threshold.
 */
export function readFrameThreshold(value: string): "slow" | "frozen" | null {
  const threshold: number = Number(value);

  if (!Number.isFinite(threshold) || value.trim().length === 0) {
    return null;
  }

  if (Math.abs(threshold - Number(FROZEN_FRAME_THRESHOLD)) < 1e-9) {
    return "frozen";
  }

  if (Math.abs(threshold - Number(SLOW_FRAME_THRESHOLD)) < 1e-9) {
    return "slow";
  }

  return null;
}

// The frame totals and lines from the per-interval sums.
export function summarizeFrameSeries(rows: unknown): {
  slow: number;
  frozen: number;
  slowSeries: Array<TimePoint>;
  frozenSeries: Array<TimePoint>;
} {
  const slowByTime: Map<number, number> = new Map<number, number>();
  const frozenByTime: Map<number, number> = new Map<number, number>();
  let slow: number = 0;
  let frozen: number = 0;

  for (const row of rowsOf(rows)) {
    const frames: number = toNumber(row["count"]);

    if (frames <= 0) {
      continue;
    }

    const threshold: "slow" | "frozen" | null = readFrameThreshold(
      groupValue(row, APP_JANK_THRESHOLD_ATTRIBUTE),
    );

    if (threshold === "slow") {
      slow += frames;
      addPoint(slowByTime, row["time"], frames);
    } else if (threshold === "frozen") {
      frozen += frames;
      addPoint(frozenByTime, row["time"], frames);
    }
  }

  return {
    slow,
    frozen,
    slowSeries: toSortedSeries(slowByTime),
    frozenSeries: toSortedSeries(frozenByTime),
  };
}

/*
 * The screens with the most frozen frames, then the most slow ones, at most
 * `limit`. A row with no screen name is no screen and is left out.
 */
export function summarizeFramesByScreen(
  rows: unknown,
  limit: number = FRAMES_BY_SCREEN_LIMIT,
): Array<ScreenFrames> {
  const byScreen: Map<string, ScreenFrames> = new Map<string, ScreenFrames>();

  for (const row of rowsOf(rows)) {
    const screen: string = groupValue(row, APP_SCREEN_NAME_ATTRIBUTE);
    const frames: number = toNumber(row["count"]);
    const threshold: "slow" | "frozen" | null = readFrameThreshold(
      groupValue(row, APP_JANK_THRESHOLD_ATTRIBUTE),
    );

    if (!screen || frames <= 0 || !threshold) {
      continue;
    }

    const entry: ScreenFrames = byScreen.get(screen) || {
      screen,
      slow: 0,
      frozen: 0,
    };

    entry[threshold] += frames;
    byScreen.set(screen, entry);
  }

  return Array.from(byScreen.values())
    .sort((left: ScreenFrames, right: ScreenFrames): number => {
      return (
        right.frozen - left.frozen ||
        right.slow - left.slow ||
        left.screen.localeCompare(right.screen)
      );
    })
    .slice(0, Math.max(0, limit));
}
