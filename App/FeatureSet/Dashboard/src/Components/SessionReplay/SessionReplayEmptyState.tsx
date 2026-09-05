import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
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
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Link from "Common/UI/Components/Link/Link";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  hasAnyAdvancedFilter,
  SessionReplayAdvancedFilters,
} from "./SessionReplayListFilters";
import { SessionReplayFilterChip } from "./SessionReplayFilterFields";
import {
  getRecordingHealthActionLink,
  RecordingHealthActionLink,
} from "./RecordingHealthCard";
import useSessionReplayHealth, {
  SessionReplayHealthSnapshot,
} from "./useSessionReplayHealth";
import SessionReplaySetupGuide from "./SessionReplaySetupGuide";

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
  /* The inline setup guide, only for never-installed. */
  showSetupGuide: boolean;
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
      showSetupGuide: false,
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
          showSetupGuide: false,
          showChips: false,
        };
      case "budget-paused":
        return {
          variant: "budget",
          title: diagnosis.title,
          detail: diagnosis.detail,
          action: healthAction(diagnosis),
          showSetupGuide: false,
          showChips: false,
        };
      case "refusing":
        return {
          variant: "refusing",
          title: diagnosis.title,
          detail: diagnosis.detail,
          action: healthAction(diagnosis),
          showSetupGuide: false,
          showChips: false,
        };
      case "never-loaded":
        return {
          variant: "never-installed",
          title: "Nothing has been recorded here yet",
          detail: diagnosis.detail,
          action: null,
          showSetupGuide: true,
          showChips: false,
        };
      case "loaded-never-uploaded":
        return {
          variant: "installed-not-uploading",
          title: diagnosis.title,
          detail: diagnosis.detail,
          action: healthAction(diagnosis),
          showSetupGuide: false,
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
      showSetupGuide: false,
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
      showSetupGuide: false,
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
    showSetupGuide: false,
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

/* ---- Chips ---- */

export interface SessionReplayFilterChipListProps {
  chips: Array<SessionReplayFilterChip>;
  onRemoveChip: (field: keyof SessionReplayAdvancedFilters) => void;
}

/*
 * The applied filters as removable chips. Shared by the table's banner and
 * the filters-match-nothing empty state so the two never disagree about
 * what is applied.
 */
export const SessionReplayFilterChipList: FunctionComponent<
  SessionReplayFilterChipListProps
> = (props: SessionReplayFilterChipListProps): ReactElement => {
  return (
    <ul
      className="flex flex-wrap items-center gap-2"
      aria-label="Applied filters"
      data-testid="session-filter-chips"
    >
      {props.chips.map((chip: SessionReplayFilterChip): ReactElement => {
        return (
          <li
            key={chip.field}
            data-testid="session-filter-chip"
            data-field={chip.field}
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-1 pl-3 pr-1 text-xs text-gray-700"
          >
            <span className="font-medium">{chip.label}</span>
            <span className="text-gray-500">{chip.text}</span>
            <button
              type="button"
              className="ml-1 rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
              aria-label={`Remove ${chip.label} filter`}
              onClick={(): void => {
                props.onRemoveChip(chip.field);
              }}
            >
              <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
};

/* ---- View ---- */

export interface SessionReplayEmptyStateViewProps {
  rumApplicationId: ObjectID | string;
  reason: SessionReplayEmptyReason;
  chips: Array<SessionReplayFilterChip>;
  onRemoveChip: (field: keyof SessionReplayAdvancedFilters) => void;
  onClearFilters: () => void;
  onSetTimeRange: (range: RangeStartAndEndDateTime) => void;
  onPreviousPage: () => void;
  onRefresh: () => void;
}

const VARIANT_ICONS: Record<SessionReplayEmptyVariant, IconProp> = {
  disabled: IconProp.VideoCameraSlash,
  budget: IconProp.BoltSlash,
  refusing: IconProp.Error,
  "never-installed": IconProp.VideoCamera,
  "installed-not-uploading": IconProp.Clock,
  "no-sessions-in-range": IconProp.Clock,
  "filters-match-nothing": IconProp.Filter,
  "end-of-list": IconProp.List,
};

export const SessionReplayEmptyStateView: FunctionComponent<
  SessionReplayEmptyStateViewProps
> = (props: SessionReplayEmptyStateViewProps): ReactElement => {
  const { reason } = props;

  type RenderActionFunction = () => ReactElement | null;

  const renderAction: RenderActionFunction = (): ReactElement | null => {
    const action: SessionReplayEmptyAction | null = reason.action;

    if (!action) {
      return null;
    }

    if (action.kind === "health") {
      const link: RecordingHealthActionLink = getRecordingHealthActionLink(
        action.target,
        props.rumApplicationId,
      );

      return (
        <Link
          to={link.to}
          openInNewTab={link.openInNewTab}
          className="inline-flex items-center gap-1 rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
        >
          <span data-testid="list-empty-action">{action.label}</span>
        </Link>
      );
    }

    return (
      <Button
        title={action.label}
        dataTestId="list-empty-action"
        buttonStyle={ButtonStyleType.NORMAL}
        onClick={(): void => {
          switch (action.kind) {
            case "set-range":
              props.onSetTimeRange(action.range);
              break;
            case "clear-filters":
              props.onClearFilters();
              break;
            case "previous-page":
              props.onPreviousPage();
              break;
            case "refresh":
              props.onRefresh();
              break;
            default:
              break;
          }
        }}
      />
    );
  };

  return (
    <div
      data-testid="list-empty"
      data-variant={reason.variant}
      className="mt-2"
    >
      <span className="sr-only" data-testid="list-empty-variant">
        {reason.variant}
      </span>
      <div className="flex rounded-md border border-dashed border-gray-200 bg-white px-6 py-12">
        <div className="m-auto max-w-xl text-center">
          <Icon
            icon={VARIANT_ICONS[reason.variant]}
            className="mx-auto h-10 w-10 text-gray-400"
          />
          <h3
            className="mt-3 text-sm font-semibold text-gray-900"
            data-testid="list-empty-title"
          >
            {reason.title}
          </h3>
          <p
            className="mt-1 text-sm text-gray-500"
            data-testid="list-empty-detail"
          >
            {reason.detail}
          </p>

          {reason.showChips && props.chips.length > 0 && (
            <div
              className="mt-4 flex justify-center"
              data-testid="list-empty-chips"
            >
              <SessionReplayFilterChipList
                chips={props.chips}
                onRemoveChip={props.onRemoveChip}
              />
            </div>
          )}

          {reason.action && <div className="mt-5">{renderAction()}</div>}
        </div>
      </div>

      {reason.showSetupGuide && (
        <div className="mt-4">
          <SessionReplaySetupGuide
            rumApplicationId={new ObjectID(props.rumApplicationId.toString())}
          />
        </div>
      )}
    </div>
  );
};

/* ---- Connected ---- */

export interface SessionReplayEmptyStateProps {
  rumApplicationId: ObjectID | string;
  /* The list's own state; health and the clock are read here. */
  context: Omit<SessionReplayEmptyContext, "health" | "nowUnixMs">;
  chips: Array<SessionReplayFilterChip>;
  onRemoveChip: (field: keyof SessionReplayAdvancedFilters) => void;
  onClearFilters: () => void;
  onSetTimeRange: (range: RangeStartAndEndDateTime) => void;
  onPreviousPage: () => void;
  onRefresh: () => void;
}

/*
 * Subscribes to the same health poller the strip above the list uses, so
 * the empty answer and the strip never disagree about why.
 */
const SessionReplayEmptyState: FunctionComponent<
  SessionReplayEmptyStateProps
> = (props: SessionReplayEmptyStateProps): ReactElement => {
  const health: SessionReplayHealthSnapshot = useSessionReplayHealth(
    props.rumApplicationId,
  );

  const reason: SessionReplayEmptyReason | null = getEmptyReason({
    ...props.context,
    health: health.isLoading
      ? null
      : { status: health.status, diagnosis: health.diagnosis },
    nowUnixMs: health.nowUnixMs,
  });

  if (!reason) {
    return <></>;
  }

  return (
    <SessionReplayEmptyStateView
      rumApplicationId={props.rumApplicationId}
      reason={reason}
      chips={props.chips}
      onRemoveChip={props.onRemoveChip}
      onClearFilters={props.onClearFilters}
      onSetTimeRange={props.onSetTimeRange}
      onPreviousPage={props.onPreviousPage}
      onRefresh={props.onRefresh}
    />
  );
};

export default SessionReplayEmptyState;
