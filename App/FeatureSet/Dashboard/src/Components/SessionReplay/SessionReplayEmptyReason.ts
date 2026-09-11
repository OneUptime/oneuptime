import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  RecordingHealthActionTarget,
  RecordingHealthDiagnosis,
  RecordingHealthStatus,
} from "Common/Types/Rum/SessionReplayHealth";
import {
  formatRelativeAge,
  parseHealthTimestamp,
} from "Common/Utils/Rum/SessionReplayHealth";
import { SESSION_REPLAY_LIST_SEARCH_MAX_WINDOW_DAYS } from "Common/Types/Rum/SessionReplay";
import {
  hasAnyAdvancedFilter,
  SessionReplayAdvancedFilters,
} from "./SessionReplayListFilters";

/*
 * The "why is this list empty" decision, without React.
 *
 * getEmptyReason and describeSessionReplayListError are pure and are the
 * part of the empty state a node test can exercise for real. They used to
 * live in SessionReplayEmptyState.tsx beside the view that renders them,
 * which meant importing them dragged react and Common/UI (which reads
 * `window` on load) into App's test and compile program. The view imports
 * them from here and re-exports every name, so callers are unchanged.
 */

/*
 * Why is the list empty? Seven honest answers, in strict precedence, from
 * getEmptyReason (pure). The precedence is the order a fix has to happen
 * in: a switched-off project makes every later signal moot, a spent budget
 * explains any refusal, a refusal explains a missing chunk, and only an
 * application that IS uploading can have a quiet window or an over-narrow
 * filter.
 *
 *   disabled > budget > refusing > never-installed > installed-not-uploading
 *   > no-sessions-in-range > filters-match-nothing
 *
 * Page > 1 never shows setup: an empty page 3 means the list ran out. A
 * loading list shows skeleton rows (the table's job) and an error shows
 * the error (describeSessionReplayListError), so neither reaches here.
 */

export type SessionReplayEmptyVariant =
  | "disabled"
  | "budget"
  | "refusing"
  | "never-installed"
  | "installed-not-uploading"
  | "no-sessions-in-range"
  | "filters-match-nothing"
  | "end-of-list";

export type SessionReplayEmptyAction =
  | { kind: "health"; label: string; target: RecordingHealthActionTarget }
  | { kind: "set-range"; label: string; range: RangeStartAndEndDateTime }
  | { kind: "clear-filters"; label: string }
  | { kind: "previous-page"; label: string }
  | { kind: "refresh"; label: string };

export interface SessionReplayEmptyReason {
  variant: SessionReplayEmptyVariant;
  /* Names the cause. */
  title: string;
  /* Quantifies it. */
  detail: string;
  /* At most one. */
  action: SessionReplayEmptyAction | null;
  /* The applied-filter chips with their remove buttons. */
  showChips: boolean;
}

/* The health half of the context: what the strip's poller knows. */
export interface SessionReplayEmptyHealthContext {
  status: RecordingHealthStatus | null;
  diagnosis: RecordingHealthDiagnosis;
}

export interface SessionReplayEmptyContext {
  isLoading: boolean;
  error: string;
  rowCount: number;
  page: number;
  signal: string;
  advanced: SessionReplayAdvancedFilters;
  timeRange: RangeStartAndEndDateTime;
  /* null while the health poll has not answered (or the viewer may not read it). */
  health: SessionReplayEmptyHealthContext | null;
  nowUnixMs: number;
}

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

const RANGE_WINDOW_MS: Partial<Record<TimeRange, number>> = {
  [TimeRange.PAST_FIVE_MINS]: 5 * MINUTE_MS,
  [TimeRange.PAST_FIFTEEN_MINS]: 15 * MINUTE_MS,
  [TimeRange.PAST_THIRTY_MINS]: 30 * MINUTE_MS,
  [TimeRange.PAST_ONE_HOUR]: HOUR_MS,
  [TimeRange.PAST_TWO_HOURS]: 2 * HOUR_MS,
  [TimeRange.PAST_THREE_HOURS]: 3 * HOUR_MS,
  [TimeRange.PAST_ONE_DAY]: DAY_MS,
  [TimeRange.PAST_TWO_DAYS]: 2 * DAY_MS,
  [TimeRange.PAST_ONE_WEEK]: 7 * DAY_MS,
  [TimeRange.PAST_TWO_WEEKS]: 14 * DAY_MS,
  [TimeRange.PAST_ONE_MONTH]: 30 * DAY_MS,
  [TimeRange.PAST_THREE_MONTHS]: 90 * DAY_MS,
};

const RANGE_LABELS: Partial<Record<TimeRange, string>> = {
  [TimeRange.PAST_FIVE_MINS]: "the past 5 minutes",
  [TimeRange.PAST_FIFTEEN_MINS]: "the past 15 minutes",
  [TimeRange.PAST_THIRTY_MINS]: "the past 30 minutes",
  [TimeRange.PAST_ONE_HOUR]: "the past hour",
  [TimeRange.PAST_TWO_HOURS]: "the past 2 hours",
  [TimeRange.PAST_THREE_HOURS]: "the past 3 hours",
  [TimeRange.PAST_ONE_DAY]: "the past 24 hours",
  [TimeRange.PAST_TWO_DAYS]: "the past 2 days",
  [TimeRange.PAST_ONE_WEEK]: "the past 7 days",
  [TimeRange.PAST_TWO_WEEKS]: "the past 14 days",
  [TimeRange.PAST_ONE_MONTH]: "the past month",
  [TimeRange.PAST_THREE_MONTHS]: "the past 3 months",
};

/* "the past 24 hours", "this window" for a custom range. */
export function describeTimeRange(timeRange: RangeStartAndEndDateTime): string {
  return RANGE_LABELS[timeRange.range] ?? "this window";
}

/* The window's length in ms; null when a custom range has no dates. */
export function getTimeRangeWindowMs(
  timeRange: RangeStartAndEndDateTime,
): number | null {
  if (timeRange.range === TimeRange.CUSTOM) {
    if (!timeRange.startAndEndDate) {
      return null;
    }

    return (
      timeRange.startAndEndDate.endValue.getTime() -
      timeRange.startAndEndDate.startValue.getTime()
    );
  }

  return RANGE_WINDOW_MS[timeRange.range] ?? null;
}

/*
 * The narrowest named range that would contain a session `ageMs` old, or
 * null when nothing here reaches back far enough. Only ranges wider than
 * the current one are offered; widening to what is already shown helps
 * nobody.
 */
export function pickWiderRange(
  ageMs: number | null,
  current: RangeStartAndEndDateTime,
): RangeStartAndEndDateTime | null {
  const currentWindowMs: number = getTimeRangeWindowMs(current) ?? 0;
  const candidates: Array<TimeRange> = [
    TimeRange.PAST_ONE_WEEK,
    TimeRange.PAST_ONE_MONTH,
    TimeRange.PAST_THREE_MONTHS,
  ];

  for (const candidate of candidates) {
    const windowMs: number = RANGE_WINDOW_MS[candidate] as number;

    if (windowMs <= currentWindowMs) {
      continue;
    }

    if (ageMs === null || ageMs <= windowMs) {
      return { range: candidate };
    }
  }

  return null;
}

function healthAction(
  diagnosis: RecordingHealthDiagnosis,
): SessionReplayEmptyAction | null {
  if (!diagnosis.action) {
    return null;
  }

  return {
    kind: "health",
    label: diagnosis.action.label,
    target: diagnosis.action.target,
  };
}

export function getEmptyReason(
  context: SessionReplayEmptyContext,
): SessionReplayEmptyReason | null {
  if (context.isLoading || context.error || context.rowCount > 0) {
    return null;
  }

  if (context.page > 1) {
    return {
      variant: "end-of-list",
      title: "No more sessions",
      detail: `Page ${context.page} is past the end of this list.`,
      action: { kind: "previous-page", label: "Back to the previous page" },

      showChips: false,
    };
  }

  const hasFilters: boolean =
    context.signal !== "all" || hasAnyAdvancedFilter(context.advanced);
  const rangeLabel: string = describeTimeRange(context.timeRange);
  const diagnosis: RecordingHealthDiagnosis | null =
    context.health?.status && context.health.diagnosis
      ? context.health.diagnosis
      : null;

  if (diagnosis) {
    switch (diagnosis.state) {
      case "disabled-project":
      case "disabled-app":
        return {
          variant: "disabled",
          title: diagnosis.title,
          detail: diagnosis.detail,
          action: healthAction(diagnosis),

          showChips: false,
        };
      case "budget-paused":
        return {
          variant: "budget",
          title: diagnosis.title,
          detail: diagnosis.detail,
          action: healthAction(diagnosis),

          showChips: false,
        };
      case "refusing":
        return {
          variant: "refusing",
          title: diagnosis.title,
          detail: diagnosis.detail,
          action: healthAction(diagnosis),

          showChips: false,
        };
      case "never-loaded":
        return {
          variant: "never-installed",
          title: "No recordings yet",
          detail:
            "Set up the recorder to see how visitors use your application.",
          action: healthAction(diagnosis),

          showChips: false,
        };
      case "loaded-never-uploaded":
        return {
          variant: "installed-not-uploading",
          title: diagnosis.title,
          detail: diagnosis.detail,
          action: healthAction(diagnosis),

          showChips: false,
        };
      default:
        break;
    }
  }

  if (hasFilters) {
    const quietCopy: string =
      diagnosis && diagnosis.state === "healthy-quiet"
        ? ` ${diagnosis.title}.`
        : "";

    return {
      variant: "filters-match-nothing",
      title: `No sessions match these filters in ${rangeLabel}`,
      detail: `Remove a filter, widen the range, or clear everything.${quietCopy}`,
      action: { kind: "clear-filters", label: "Clear filters" },

      showChips: true,
    };
  }

  const status: RecordingHealthStatus | null = context.health?.status ?? null;
  const lastSessionUnixMs: number | null = status
    ? parseHealthTimestamp(status.lastSessionStartedAt) ??
      parseHealthTimestamp(status.lastChunkReceivedAt)
    : null;
  const ageMs: number | null =
    lastSessionUnixMs === null ? null : context.nowUnixMs - lastSessionUnixMs;
  const windowMs: number | null = getTimeRangeWindowMs(context.timeRange);

  if (ageMs !== null && windowMs !== null && ageMs <= windowMs) {
    /*
     * The recorder reported inside this window and the list still came
     * back empty: the header row may not be visible yet (the ingest writes
     * it a few seconds after the first chunk), or the viewer's scope is
     * narrower than the application's. Never "no sessions" here.
     */
    return {
      variant: "no-sessions-in-range",
      title: `No sessions listed for ${rangeLabel} yet`,
      detail: `The recorder reported a session ${formatRelativeAge(lastSessionUnixMs as number, context.nowUnixMs)}, inside this window. The list can lag the first chunk by a few seconds; reload in a moment.`,
      action: { kind: "refresh", label: "Reload the list" },

      showChips: false,
    };
  }

  const wider: RangeStartAndEndDateTime | null = pickWiderRange(
    ageMs,
    context.timeRange,
  );
  const recentCopy: string =
    lastSessionUnixMs === null
      ? status
        ? "The recorder has never reported a session start."
        : "When the last session started is unknown until the recording health loads."
      : `The most recent started ${formatRelativeAge(lastSessionUnixMs, context.nowUnixMs)}.`;

  return {
    variant: "no-sessions-in-range",
    title: `No sessions in ${rangeLabel}`,
    detail: `${recentCopy}${
      diagnosis && diagnosis.state === "healthy"
        ? " Recording is healthy; this looks like quiet traffic."
        : ""
    }`,
    action: wider
      ? {
          kind: "set-range",
          label: `Show ${describeTimeRange(wider)}`,
          range: wider,
        }
      : null,

    showChips: false,
  };
}

/* ---- Errors ---- */

/* The two 400s the search can trip, recognised by the server's own words. */
const NARROW_RANGE_PATTERN: RegExp = /narrow the range/i;
const TIMEOUT_PATTERN: RegExp =
  /timed? ?out|timeout|exceeded.*(budget|time)|too slow/i;

export type SessionReplayListErrorKind =
  | "narrow-range"
  | "timeout"
  | "permission"
  | "plan"
  | "other";

export interface SessionReplayListErrorCopy {
  kind: SessionReplayListErrorKind;
  title: string;
  detail: string;
}

/*
 * The list request failed. The two 400s the search can trip are mapped to
 * their fix rather than to "no sessions"; a permission or plan answer
 * says which; everything else keeps the server's own sentence.
 */
export function describeSessionReplayListError(
  message: string,
  statusCode?: number | undefined,
): SessionReplayListErrorCopy {
  const text: string = message || "";

  if (NARROW_RANGE_PATTERN.test(text)) {
    return {
      kind: "narrow-range",
      title: `Search covers at most ${SESSION_REPLAY_LIST_SEARCH_MAX_WINDOW_DAYS} days at a time`,
      detail:
        "Narrow the time range to search it, or clear the search text to list sessions without searching.",
    };
  }

  if (statusCode === 504 || statusCode === 408 || TIMEOUT_PATTERN.test(text)) {
    return {
      kind: "timeout",
      title: "The search timed out",
      detail:
        "This query ran past its 30s budget. Narrow the range or add a filter (a URL prefix or a user) and try again.",
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      kind: "permission",
      title: "You cannot list session replays for this application",
      detail:
        text ||
        "Your role lacks the session replay read permission. Ask a project admin.",
    };
  }

  if (statusCode === 402) {
    return {
      kind: "plan",
      title: "Session replay is not in this project's plan",
      detail: text || "Upgrade the plan to list and watch recordings.",
    };
  }

  return {
    kind: "other",
    title: "The session list could not be loaded",
    detail:
      text ||
      "The request failed. Retry, and check the network tab if it keeps failing.",
  };
}
