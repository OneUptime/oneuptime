import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { RecordingHealthDiagnosis } from "Common/Types/Rum/SessionReplayHealth";
import {
  describeHealthError,
  SessionReplayHealthError,
} from "../../../Components/SessionReplay/SessionReplayHealthError";
import {
  formatCompact,
  formatDurationMs,
} from "../../../Components/TelemetryResource/telemetryFormat";

/*
 * The pure decisions behind the RUM application overview page.
 *
 * Overview.tsx is React and pulls Common/UI/Config (which reads `window` on
 * load) through its chrome, so the page module cannot be imported by a node
 * test. These three are the parts a test should exercise for real rather
 * than read off the source, so they live here; Overview.tsx imports and
 * re-exports them.
 */

/*
 * The range a tile counted, in the tile's own words - "past 1 hour", not
 * "selected range" - so a viewer who clicks through to a list showing a
 * different default window is never told two counts for one thing without
 * being shown why (correlation-11).
 */
export function describeTimeRangeForTile(
  timeRange: RangeStartAndEndDateTime,
): string {
  if (timeRange.range === TimeRange.CUSTOM) {
    return "custom range";
  }

  return String(timeRange.range).toLowerCase();
}

/*
 * The URL grammar every telemetry explorer reads (range=<TimeRange>, plus
 * start/end for Custom), stamped onto a list route so the list can open on
 * the window the tile counted. Values are encoded because Route appends
 * them verbatim and rejects raw spaces and colons.
 */
export function buildRangedListRoute(
  listRoute: Route,
  timeRange: RangeStartAndEndDateTime,
): Route {
  const route: Route = new Route(listRoute.toString());
  const params: Record<string, string> = {
    range: encodeURIComponent(String(timeRange.range)),
  };

  if (timeRange.range === TimeRange.CUSTOM && timeRange.startAndEndDate) {
    params["start"] = encodeURIComponent(
      OneUptimeDate.toString(timeRange.startAndEndDate.startValue),
    );
    params["end"] = encodeURIComponent(
      OneUptimeDate.toString(timeRange.startAndEndDate.endValue),
    );
  }

  try {
    return route.addQueryParams(params);
  } catch {
    return listRoute;
  }
}

/*
 * The "Recording health" detail row's value, or undefined to leave the row
 * out entirely.
 *
 * A viewer without the Read Session Replay permission (or on a plan that
 * does not include replay) is shown nothing rather than a permission error
 * in a list of SDK facts - they cannot act on it here, and the settings
 * page is where that conversation belongs. Every other failure IS named,
 * because a silent row would read as "healthy".
 */
export function describeRecordingHealthRow(health: {
  isLoading: boolean;
  error: SessionReplayHealthError | null;
  diagnosis: RecordingHealthDiagnosis;
}): string | undefined {
  if (health.isLoading) {
    return "Checking…";
  }

  if (health.error) {
    if (health.error.kind === "permission" || health.error.kind === "plan") {
      return undefined;
    }

    return describeHealthError(health.error).title;
  }

  return health.diagnosis.title;
}

/*
 * The span the OpenTelemetry browser SDK's DocumentLoadInstrumentation
 * records for each full page load (its children are documentFetch and
 * resourceFetch). Route changes in a single-page app do not produce one.
 */
export const PAGE_LOAD_SPAN_NAME: string = "documentLoad";

export interface TileText {
  value: string;
  sublabel: string;
}

// The whole-range page-load statistics the two page-load tiles read.
export interface PageLoadTileStats {
  count: number;
  errorCount: number;
  p50DurationMs: number;
  p95DurationMs: number;
}

/*
 * "Page loads". A failed lookup is unknown, not zero (correlation-14). When
 * the app reports other events but no documentLoad span at all, the sublabel
 * says which span is missing: "0 page loads" on an app that simply lacks
 * DocumentLoadInstrumentation would otherwise read as "nobody visited".
 */
export function describePageLoadsTile(input: {
  stats: PageLoadTileStats | null;
  failed: boolean;
  eventsTotal: number | null;
}): TileText {
  if (input.failed) {
    return { value: "—", sublabel: "could not load" };
  }

  if (!input.stats) {
    return { value: "—", sublabel: "full page loads" };
  }

  if (input.stats.count <= 0) {
    return {
      value: "0",
      sublabel:
        input.eventsTotal !== null && input.eventsTotal > 0
          ? `no ${PAGE_LOAD_SPAN_NAME} spans`
          : "full page loads",
    };
  }

  return {
    value: formatCompact(input.stats.count),
    sublabel:
      input.stats.errorCount > 0
        ? `${formatCompact(input.stats.errorCount)} failed`
        : "full page loads",
  };
}

/*
 * "Page load time (p95)", with the median in the sublabel so the typical
 * load sits beside the slow tail. No page loads means no time - a dash, not
 * "0 ms".
 */
export function describePageLoadTimeTile(input: {
  stats: PageLoadTileStats | null;
  failed: boolean;
}): TileText {
  if (input.failed) {
    return { value: "—", sublabel: "could not load" };
  }

  if (!input.stats || input.stats.count <= 0) {
    return { value: "—", sublabel: "no page loads" };
  }

  return {
    value: formatDurationMs(input.stats.p95DurationMs),
    sublabel: `median ${formatDurationMs(input.stats.p50DurationMs)}`,
  };
}

export interface TimePointLike {
  x: Date;
  y: number;
}

/*
 * Two time series added point by point on their timestamps, sorted - the
 * handled and unhandled exception histograms drawn as one "Exceptions" line.
 */
export function sumTimeSeries(
  a: Array<TimePointLike>,
  b: Array<TimePointLike>,
): Array<TimePointLike> {
  const byTime: Map<number, number> = new Map<number, number>();

  for (const point of [...a, ...b]) {
    const ms: number = point.x.getTime();

    if (Number.isNaN(ms) || !Number.isFinite(point.y)) {
      continue;
    }

    byTime.set(ms, (byTime.get(ms) || 0) + point.y);
  }

  return Array.from(byTime.entries())
    .sort((left: [number, number], right: [number, number]): number => {
      return left[0] - right[0];
    })
    .map(([ms, y]: [number, number]): TimePointLike => {
      return { x: new Date(ms), y };
    });
}

/*
 * "Exceptions". Only the total: the histogram's handled / unhandled split
 * comes from exception.escaped, which a browser's recordException never
 * sets, so every browser exception would read as "handled".
 */
export function describeExceptionsTile(input: {
  exceptions: { total: number; failed: boolean } | null;
}): TileText {
  if (!input.exceptions) {
    return { value: "—", sublabel: "reported by your app" };
  }

  if (input.exceptions.failed) {
    return { value: "—", sublabel: "could not load" };
  }

  return {
    value: formatCompact(input.exceptions.total),
    sublabel: "reported by your app",
  };
}
