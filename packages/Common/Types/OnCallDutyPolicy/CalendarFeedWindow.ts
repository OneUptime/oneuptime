/*
 * Window and cost constants for the on-call calendar feeds.
 *
 * These are deliberately constants rather than environment variables: they
 * bound how much work one feed fetch can cause and how large a body a
 * calendar client has to swallow, and an operator tuning them per install
 * would only move the failure elsewhere (Google skips events in very large
 * feeds; Proton rejects oversized feeds outright).
 */

// Furthest a feed may look ahead, in days.
export const MAX_FUTURE_DAYS: number = 180;

// Shortest look-ahead a subscriber may pick, in days.
export const MIN_FUTURE_DAYS: number = 7;

// Look-ahead used when a feed row has no explicit setting.
export const DEFAULT_FUTURE_DAYS: number = 90;

// Furthest a feed may look back, in days. History is opt-in beyond 2 days.
export const MAX_PAST_DAYS: number = 60;

// Look-back used when a feed row has no explicit setting.
export const DEFAULT_PAST_DAYS: number = 2;

/*
 * Hard cap on VEVENTs in one feed. When a feed would exceed it, futureDays is
 * shrunk until it fits (see OnCallCalendarFeedUtil.shrinkWindowToFit).
 */
export const MAX_EVENTS: number = 5000;

// Hard cap on "No coverage" events per feed (oldest first).
export const MAX_GAP_EVENTS: number = 100;

// A rotated-out token keeps serving an EMPTY calendar for this long.
export const PREVIOUS_TOKEN_GRACE_DAYS: number = 30;

// Rendered body cache TTL, in seconds (also the Cache-Control max-age).
export const BODY_CACHE_TTL_SECONDS: number = 300;

// Schedule-level materialized-shift cache TTL, in seconds.
export const SCHEDULE_CACHE_TTL_SECONDS: number = 3600;

// Maximum concurrent uncached renders per process.
export const RENDER_CONCURRENCY: number = 4;

/*
 * Per-layer rotation-period budget for feed rendering (LayerUtil's
 * maxSimulationIterations). Well above any realistic schedule age at hourly
 * granularity, far below the engine's 5,000,000 ceiling.
 */
export const FEED_SIMULATION_ITERATION_CAP: number = 200000;

const MILLISECONDS_PER_DAY: number = 24 * 60 * 60 * 1000;

export interface FeedWindow {
  // 00:00 UTC of (now - pastDays).
  feedStart: Date;
  // 00:00 UTC of (now + futureDays + 1), i.e. the exclusive end of the last day.
  feedEnd: Date;
}

export default class CalendarFeedWindow {
  /*
   * Coerce a stored / user-supplied pastDays value into the allowed range.
   * Anything that is not a finite number falls back to the default rather
   * than to 0, so a missing column never silently hides the current shift.
   */
  public static clampPastDays(value: unknown): number {
    const parsed: number = CalendarFeedWindow.toFiniteInteger(value);

    if (Number.isNaN(parsed)) {
      return DEFAULT_PAST_DAYS;
    }

    return Math.min(MAX_PAST_DAYS, Math.max(0, parsed));
  }

  public static clampFutureDays(value: unknown): number {
    const parsed: number = CalendarFeedWindow.toFiniteInteger(value);

    if (Number.isNaN(parsed)) {
      return DEFAULT_FUTURE_DAYS;
    }

    return Math.min(MAX_FUTURE_DAYS, Math.max(MIN_FUTURE_DAYS, parsed));
  }

  /*
   * The feed window for a fetch at `now`. Both edges sit on UTC midnights so
   * every fetch inside the same UTC day produces the same window — which is
   * what makes the rendered body cacheable across polls.
   */
  public static computeFeedWindow(data: {
    now: Date;
    pastDays: number;
    futureDays: number;
  }): FeedWindow {
    const pastDays: number = CalendarFeedWindow.clampPastDays(data.pastDays);
    const futureDays: number = CalendarFeedWindow.clampFutureDays(
      data.futureDays,
    );

    const todayUtc: number = CalendarFeedWindow.startOfUtcDay(data.now);

    return {
      feedStart: new Date(todayUtc - pastDays * MILLISECONDS_PER_DAY),
      feedEnd: new Date(todayUtc + (futureDays + 1) * MILLISECONDS_PER_DAY),
    };
  }

  // 00:00:00.000 UTC of the day containing `date`, as epoch milliseconds.
  public static startOfUtcDay(date: Date): number {
    return Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    );
  }

  // "YYYY-MM-DD" of the UTC day containing `date`, for cache keys.
  public static getUtcDayBucket(date: Date): string {
    return new Date(CalendarFeedWindow.startOfUtcDay(date))
      .toISOString()
      .slice(0, 10);
  }

  private static toFiniteInteger(value: unknown): number {
    if (typeof value === "number") {
      return Number.isFinite(value) ? Math.floor(value) : Number.NaN;
    }

    if (typeof value === "string" && value.trim() !== "") {
      const parsed: number = Number(value);
      return Number.isFinite(parsed) ? Math.floor(parsed) : Number.NaN;
    }

    return Number.NaN;
  }
}
