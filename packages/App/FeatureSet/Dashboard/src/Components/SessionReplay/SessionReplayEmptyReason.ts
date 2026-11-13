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
} from "Common/Utils/SessionReplay/SessionReplayHealth";
import { SESSION_REPLAY_LIST_SEARCH_MAX_WINDOW_DAYS } from "Common/Types/Rum/SessionReplay";
import {
  ComposedValue,
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  translationKey,
  Translator,
} from "Common/Types/Translator";
import {
  hasAnyAdvancedFilter,
  SessionReplayAdvancedFilters,
} from "./SessionReplayListFilters";
import Permission from "Common/Types/Permission";
import { getSessionReplayPermissionTitle } from "./SessionReplayPermissionTitle";

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
 *
 * Every sentence is in the language of the translator handed in (the
 * empty state passes useTranslator()), and in English, word for word as
 * it always was, without one. The recording health's own words - a
 * diagnosis's title, detail and action, which some answers pass on - are
 * the diagnosis's (Common/Utils/SessionReplay/SessionReplayHealth.ts), as it wrote
 * them.
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

/*
 * The window as the empty state's sentences name it. Each is a key of the
 * Dashboard's locales, and goes into those sentences as a composed value
 * (describeTimeRange with the sentence's translator), so it is in the
 * sentence's language.
 */
const RANGE_LABELS: Partial<Record<TimeRange, string>> = {
  [TimeRange.PAST_FIVE_MINS]: translationKey("the past 5 minutes"),
  [TimeRange.PAST_FIFTEEN_MINS]: translationKey("the past 15 minutes"),
  [TimeRange.PAST_THIRTY_MINS]: translationKey("the past 30 minutes"),
  [TimeRange.PAST_ONE_HOUR]: translationKey("the past hour"),
  [TimeRange.PAST_TWO_HOURS]: translationKey("the past 2 hours"),
  [TimeRange.PAST_THREE_HOURS]: translationKey("the past 3 hours"),
  [TimeRange.PAST_ONE_DAY]: translationKey("the past 24 hours"),
  [TimeRange.PAST_TWO_DAYS]: translationKey("the past 2 days"),
  [TimeRange.PAST_ONE_WEEK]: translationKey("the past 7 days"),
  [TimeRange.PAST_TWO_WEEKS]: translationKey("the past 14 days"),
  [TimeRange.PAST_ONE_MONTH]: translationKey("the past month"),
  [TimeRange.PAST_THREE_MONTHS]: translationKey("the past 3 months"),
};

const CUSTOM_RANGE_LABEL: string = translationKey("this window");

// English, word for word, for a caller that hands in no translator.
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

// A fixed sentence in the translator's language.
function translateLine(text: string, translator: Translator): string {
  return translator.translateText(text) || text;
}

/* "the past 24 hours", "this window" for a custom range. */
export function describeTimeRange(
  timeRange: RangeStartAndEndDateTime,
  translator: Translator = ENGLISH,
): string {
  return translateLine(
    RANGE_LABELS[timeRange.range] ?? CUSTOM_RANGE_LABEL,
    translator,
  );
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
  translator: Translator = ENGLISH,
): SessionReplayEmptyReason | null {
  if (context.isLoading || context.error || context.rowCount > 0) {
    return null;
  }

  if (context.page > 1) {
    return {
      variant: "end-of-list",
      title: translateLine("No more sessions", translator),
      detail: translator.translateTemplate(
        "Page {{page}} is past the end of this list.",
        { page: translator.formatNumber(context.page) },
      ),
      action: {
        kind: "previous-page",
        label: translateLine("Back to the previous page", translator),
      },

      showChips: false,
    };
  }

  const hasFilters: boolean =
    context.signal !== "all" || hasAnyAdvancedFilter(context.advanced);
  // The window, in the language of the sentence it goes into.
  const range: ComposedValue = composedValue((sentence: Translator): string => {
    return describeTimeRange(context.timeRange, sentence);
  });
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
          title: translateLine("No recordings yet", translator),
          detail: translateLine(
            "Set up the recorder to see how visitors use your application.",
            translator,
          ),
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
    /*
     * A quiet recorder says so after the advice, in the diagnosis's own
     * words: one sentence with and one without it.
     */
    const detail: string =
      diagnosis && diagnosis.state === "healthy-quiet"
        ? translator.translateTemplate(
            "Remove a filter, widen the range, or clear everything. {{health}}.",
            { health: diagnosis.title },
          )
        : translateLine(
            "Remove a filter, widen the range, or clear everything.",
            translator,
          );

    return {
      variant: "filters-match-nothing",
      title: translator.translateTemplate(
        "No sessions match these filters in {{range}}",
        { range: range },
      ),
      detail: detail,
      action: {
        kind: "clear-filters",
        label: translateLine("Clear filters", translator),
      },

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
      title: translator.translateTemplate(
        "No sessions listed for {{range}} yet",
        { range: range },
      ),
      detail: translator.translateTemplate(
        "The recorder reported a session {{age}}, inside this window. The list can lag the first chunk by a few seconds; reload in a moment.",
        {
          age: composedValue((sentence: Translator): string => {
            return formatRelativeAge(
              lastSessionUnixMs as number,
              context.nowUnixMs,
              sentence,
            );
          }),
        },
      ),
      action: {
        kind: "refresh",
        label: translateLine("Reload the list", translator),
      },

      showChips: false,
    };
  }

  const wider: RangeStartAndEndDateTime | null = pickWiderRange(
    ageMs,
    context.timeRange,
  );

  return {
    variant: "no-sessions-in-range",
    title: translator.translateTemplate("No sessions in {{range}}", {
      range: range,
    }),
    detail: describeQuietWindow(
      lastSessionUnixMs,
      status !== null,
      Boolean(diagnosis && diagnosis.state === "healthy"),
      context.nowUnixMs,
      translator,
    ),
    action: wider
      ? {
          kind: "set-range",
          label: translator.translateTemplate("Show {{range}}", {
            range: composedValue((sentence: Translator): string => {
              return describeTimeRange(wider, sentence);
            }),
          }),
          range: wider,
        }
      : null,

    showChips: false,
  };
}

/*
 * When the most recent session started, and - when the recording is
 * healthy - that this is quiet traffic: one whole sentence for each. A
 * healthy recording always has a last chunk, and so a last session, so
 * the two sentences without a time never take the note.
 */
function describeQuietWindow(
  lastSessionUnixMs: number | null,
  hasStatus: boolean,
  isHealthy: boolean,
  nowUnixMs: number,
  translator: Translator,
): string {
  if (lastSessionUnixMs === null) {
    return hasStatus
      ? translateLine(
          "The recorder has never reported a session start.",
          translator,
        )
      : translateLine(
          "When the last session started is unknown until the recording health loads.",
          translator,
        );
  }

  const age: ComposedValue = composedValue((sentence: Translator): string => {
    return formatRelativeAge(lastSessionUnixMs, nowUnixMs, sentence);
  });

  return isHealthy
    ? translator.translateTemplate(
        "The most recent started {{age}}. Recording is healthy; this looks like quiet traffic.",
        { age: age },
      )
    : translator.translateTemplate("The most recent started {{age}}.", {
        age: age,
      });
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
 * A failed list request as the server answered it. A list keeps this in
 * its state and words it (describeSessionReplayListError) where it draws
 * it, so the words follow the reader's language.
 */
export interface SessionReplayListFailure {
  message: string;
  statusCode?: number | undefined;
}

/*
 * The list request failed. The two 400s the search can trip are mapped to
 * their fix rather than to "no sessions"; a permission or plan answer
 * says which; everything else keeps the server's own sentence.
 */
export function describeSessionReplayListError(
  message: string,
  statusCode?: number | undefined,
  translator: Translator = ENGLISH,
): SessionReplayListErrorCopy {
  // The server's own sentence, as it wrote it.
  const text: string = message || "";

  if (NARROW_RANGE_PATTERN.test(text)) {
    return {
      kind: "narrow-range",
      title: translator.translatePlural(
        {
          one: "Search covers at most {{count}} day at a time",
          other: "Search covers at most {{count}} days at a time",
        },
        SESSION_REPLAY_LIST_SEARCH_MAX_WINDOW_DAYS,
      ),
      detail: translateLine(
        "Narrow the time range to search it, or clear the search text to list sessions without searching.",
        translator,
      ),
    };
  }

  if (statusCode === 504 || statusCode === 408 || TIMEOUT_PATTERN.test(text)) {
    return {
      kind: "timeout",
      title: translateLine("The search timed out", translator),
      detail: translateLine(
        "This query ran past its 30s budget. Narrow the range or add a filter (a URL prefix or a user) and try again.",
        translator,
      ),
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      kind: "permission",
      title: translateLine(
        "You cannot list session replays for this application",
        translator,
      ),
      detail:
        text ||
        translator.translateTemplate(
          'Your role lacks the "{{permission}}" permission. Ask a project admin for it.',
          {
            permission: getSessionReplayPermissionTitle(
              Permission.ReadRumSessionReplay,
            ),
          },
        ),
    };
  }

  if (statusCode === 402) {
    return {
      kind: "plan",
      title: translateLine(
        "Session replay is not in this project's plan",
        translator,
      ),
      detail:
        text ||
        translateLine(
          "Upgrade the plan to list and watch recordings.",
          translator,
        ),
    };
  }

  return {
    kind: "other",
    title: translateLine("The session list could not be loaded", translator),
    detail:
      text ||
      translateLine(
        "The request failed. Retry, and check the network tab if it keeps failing.",
        translator,
      ),
  };
}
