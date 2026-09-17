import OneUptimeDate from "Common/Types/Date";

/*
 * Timing for a scheduled maintenance event: which part of its window it is
 * in, what the header's duration pill should say, and when that answer next
 * changes on its own. Everything here is a pure function of its inputs -
 * "now" included - so the header can re-evaluate it on a timer and the rules
 * can be tested without a clock.
 */

// How often a mounted header re-reads the clock.
export const SCHEDULED_MAINTENANCE_TIMING_REFRESH_INTERVAL_IN_MS: number =
  30 * 1000;

// Never re-evaluate in a tighter loop than this.
export const SCHEDULED_MAINTENANCE_TIMING_MIN_REFRESH_DELAY_IN_MS: number = 1000;

/*
 * The workers move an event to Ongoing at startsAt and to Ended at endsAt,
 * once a minute. Right after either boundary an event can therefore sit in
 * its old state for a minute or so with nothing wrong, so the overdue warning
 * only appears once a boundary has been missed for longer than this.
 */
export const SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS: number =
  2 * 60 * 1000;

/*
 * For this long after a missed boundary the header re-reads the state
 * timeline on every tick, so the worker's transition shows up without a
 * reload. After that the event is genuinely stuck and polling would only
 * cost requests.
 */
export const SCHEDULED_MAINTENANCE_STATE_RECHECK_WINDOW_IN_MS: number =
  5 * 60 * 1000;

// Minimum gap between two of those re-reads (the timeline was just loaded, say).
export const SCHEDULED_MAINTENANCE_STATE_RECHECK_MIN_INTERVAL_IN_MS: number =
  15 * 1000;

export enum ScheduledMaintenanceStateKind {
  Scheduled = "scheduled",
  Ongoing = "ongoing",
  Ended = "ended",
  Unknown = "unknown",
}

export enum ScheduledMaintenancePhase {
  // Waiting for startsAt.
  Scheduled = "scheduled",
  // startsAt has passed but the event is still in a scheduled state.
  StartOverdue = "overdue-start",
  // In progress, within its planned window.
  Ongoing = "ongoing",
  // In progress past endsAt.
  EndOverdue = "overdue-end",
  Ended = "ended",
  // The current state could not be classified (no timeline yet, say).
  Unknown = "unknown",
}

export const SCHEDULED_MAINTENANCE_DURATION_PREFIX: {
  startsIn: string;
  startOverdueBy: string;
  inProgressFor: string;
  overrunningBy: string;
  completedIn: string;
} = {
  startsIn: "Starts in",
  startOverdueBy: "Start overdue by",
  inProgressFor: "In progress for",
  overrunningBy: "Overrunning by",
  completedIn: "Completed in",
};

// The flags a ScheduledMaintenanceState carries, as plain data.
export interface ScheduledMaintenanceStateFlags {
  id: string;
  isScheduledState?: boolean | undefined;
  isOngoingState?: boolean | undefined;
  isEndedState?: boolean | undefined;
  isResolvedState?: boolean | undefined;
}

export interface ScheduledMaintenanceTimelineEntry {
  stateId?: string | undefined;
  startsAt?: Date | string | null | undefined;
}

export type DateInput = Date | string | null | undefined;

export interface ScheduledMaintenanceTimingInput {
  stateKind: ScheduledMaintenanceStateKind;
  startsAt?: DateInput;
  endsAt?: DateInput;
  // When the event first entered its ongoing state (from the state timeline).
  startedAt?: DateInput;
  // When the event last entered its ended state (from the state timeline).
  completedAt?: DateInput;
  now: Date;
}

export interface ScheduledMaintenanceTiming {
  phase: ScheduledMaintenancePhase;
  /*
   * The duration pill: "<durationPrefix> <duration between
   * durationStartsAt and durationEndsAt>". All three are set together or not
   * at all. Live phases end at `now`, so the caller has to re-evaluate on a
   * timer to keep the text moving.
   */
  durationPrefix?: string | undefined;
  durationStartsAt?: Date | undefined;
  durationEndsAt?: Date | undefined;
  // The boundary that was missed, for the two overdue phases.
  overdueSince?: Date | undefined;
  // True once an overdue phase has outlasted the grace period.
  isOverdue: boolean;
  // The next instant at which this result changes just because time passes.
  nextChangeAt?: Date | undefined;
}

export const toValidDate: (value: DateInput) => Date | undefined = (
  value: DateInput,
): Date | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  let date: Date | undefined = undefined;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "string") {
    if (!value.trim()) {
      return undefined;
    }

    try {
      date = OneUptimeDate.fromString(value);
    } catch {
      return undefined;
    }
  }

  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return undefined;
  }

  return date;
};

/*
 * Classifies the current state. Ended wins over everything, then Scheduled,
 * then Ongoing - the same precedence the header's actions have always used.
 * Custom states count by their position: one ordered before the first
 * ongoing state is still waiting to start, one after it (a "Verifying" step,
 * say) is still in progress.
 */
export const getScheduledMaintenanceStateKind: (data: {
  states: Array<ScheduledMaintenanceStateFlags>;
  currentStateId: string | undefined;
}) => ScheduledMaintenanceStateKind = (data: {
  states: Array<ScheduledMaintenanceStateFlags>;
  currentStateId: string | undefined;
}): ScheduledMaintenanceStateKind => {
  if (!data.currentStateId) {
    return ScheduledMaintenanceStateKind.Unknown;
  }

  const currentStateIndex: number = data.states.findIndex(
    (state: ScheduledMaintenanceStateFlags): boolean => {
      return state.id === data.currentStateId;
    },
  );

  const currentState: ScheduledMaintenanceStateFlags | undefined =
    data.states[currentStateIndex];

  if (!currentState) {
    return ScheduledMaintenanceStateKind.Unknown;
  }

  if (currentState.isEndedState || currentState.isResolvedState) {
    return ScheduledMaintenanceStateKind.Ended;
  }

  const ongoingStateIndex: number = data.states.findIndex(
    (state: ScheduledMaintenanceStateFlags): boolean => {
      return Boolean(state.isOngoingState);
    },
  );

  if (
    currentState.isScheduledState ||
    (ongoingStateIndex >= 0 && currentStateIndex < ongoingStateIndex)
  ) {
    return ScheduledMaintenanceStateKind.Scheduled;
  }

  if (
    currentState.isOngoingState ||
    (ongoingStateIndex >= 0 && currentStateIndex > ongoingStateIndex)
  ) {
    return ScheduledMaintenanceStateKind.Ongoing;
  }

  return ScheduledMaintenanceStateKind.Unknown;
};

/*
 * The first or last timeline entry into `stateId`, by date. Timelines can
 * arrive in any order and entries without a valid date are ignored.
 */
export const getTimelineDateForState: (data: {
  timelines: Array<ScheduledMaintenanceTimelineEntry>;
  stateId: string | undefined;
  pick: "first" | "last";
}) => Date | undefined = (data: {
  timelines: Array<ScheduledMaintenanceTimelineEntry>;
  stateId: string | undefined;
  pick: "first" | "last";
}): Date | undefined => {
  if (!data.stateId) {
    return undefined;
  }

  let picked: Date | undefined = undefined;

  for (const timeline of data.timelines) {
    if (timeline.stateId !== data.stateId) {
      continue;
    }

    const startsAt: Date | undefined = toValidDate(timeline.startsAt);

    if (!startsAt) {
      continue;
    }

    if (
      !picked ||
      (data.pick === "first" && startsAt.getTime() < picked.getTime()) ||
      (data.pick === "last" && startsAt.getTime() >= picked.getTime())
    ) {
      picked = startsAt;
    }
  }

  return picked;
};

/*
 * The state id of the most recent timeline entry - the event's current
 * state. Entries with the same date keep their list order.
 */
export const getCurrentTimelineStateId: (
  timelines: Array<ScheduledMaintenanceTimelineEntry>,
) => string | undefined = (
  timelines: Array<ScheduledMaintenanceTimelineEntry>,
): string | undefined => {
  let current: ScheduledMaintenanceTimelineEntry | undefined = undefined;
  let currentTime: number | undefined = undefined;

  for (const timeline of timelines) {
    const startsAt: Date | undefined = toValidDate(timeline.startsAt);

    if (!startsAt) {
      // Undated entries are only trusted when nothing dated exists.
      if (currentTime === undefined) {
        current = timeline;
      }
      continue;
    }

    if (currentTime === undefined || startsAt.getTime() >= currentTime) {
      current = timeline;
      currentTime = startsAt.getTime();
    }
  }

  return current?.stateId;
};

type OverdueTimingFunction = (data: {
  phase: ScheduledMaintenancePhase;
  prefix: string;
  boundary: Date;
  now: Date;
}) => ScheduledMaintenanceTiming;

const getOverdueTiming: OverdueTimingFunction = (data: {
  phase: ScheduledMaintenancePhase;
  prefix: string;
  boundary: Date;
  now: Date;
}): ScheduledMaintenanceTiming => {
  const graceEndsAt: Date = new Date(
    data.boundary.getTime() + SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS,
  );
  const isOverdue: boolean = data.now.getTime() >= graceEndsAt.getTime();

  return {
    phase: data.phase,
    durationPrefix: data.prefix,
    durationStartsAt: data.boundary,
    durationEndsAt: data.now,
    overdueSince: data.boundary,
    isOverdue: isOverdue,
    nextChangeAt: isOverdue ? undefined : graceEndsAt,
  };
};

export const getScheduledMaintenanceTiming: (
  input: ScheduledMaintenanceTimingInput,
) => ScheduledMaintenanceTiming = (
  input: ScheduledMaintenanceTimingInput,
): ScheduledMaintenanceTiming => {
  const now: Date = input.now;
  const startsAt: Date | undefined = toValidDate(input.startsAt);
  const endsAt: Date | undefined = toValidDate(input.endsAt);
  const startedAt: Date | undefined = toValidDate(input.startedAt);
  const completedAt: Date | undefined = toValidDate(input.completedAt);

  if (input.stateKind === ScheduledMaintenanceStateKind.Ended) {
    /*
     * Measured from when the work actually began, falling back to the
     * planned start when the event skipped its ongoing state. An event
     * ended before it ever started (cancelled early) has no duration.
     */
    const windowStartedAt: Date | undefined = startedAt || startsAt;
    const windowEndedAt: Date | undefined = completedAt || endsAt;

    if (
      windowStartedAt &&
      windowEndedAt &&
      windowEndedAt.getTime() >= windowStartedAt.getTime()
    ) {
      return {
        phase: ScheduledMaintenancePhase.Ended,
        durationPrefix: SCHEDULED_MAINTENANCE_DURATION_PREFIX.completedIn,
        durationStartsAt: windowStartedAt,
        durationEndsAt: windowEndedAt,
        isOverdue: false,
      };
    }

    return {
      phase: ScheduledMaintenancePhase.Ended,
      isOverdue: false,
    };
  }

  if (input.stateKind === ScheduledMaintenanceStateKind.Scheduled) {
    if (!startsAt) {
      return {
        phase: ScheduledMaintenancePhase.Scheduled,
        isOverdue: false,
      };
    }

    if (now.getTime() < startsAt.getTime()) {
      return {
        phase: ScheduledMaintenancePhase.Scheduled,
        durationPrefix: SCHEDULED_MAINTENANCE_DURATION_PREFIX.startsIn,
        durationStartsAt: now,
        durationEndsAt: startsAt,
        isOverdue: false,
        nextChangeAt: startsAt,
      };
    }

    return getOverdueTiming({
      phase: ScheduledMaintenancePhase.StartOverdue,
      prefix: SCHEDULED_MAINTENANCE_DURATION_PREFIX.startOverdueBy,
      boundary: startsAt,
      now: now,
    });
  }

  if (input.stateKind === ScheduledMaintenanceStateKind.Ongoing) {
    if (endsAt && now.getTime() >= endsAt.getTime()) {
      return getOverdueTiming({
        phase: ScheduledMaintenancePhase.EndOverdue,
        prefix: SCHEDULED_MAINTENANCE_DURATION_PREFIX.overrunningBy,
        boundary: endsAt,
        now: now,
      });
    }

    const nextChangeAt: Date | undefined = endsAt;
    const inProgressSince: Date | undefined = startedAt || startsAt;

    // A start in the future (clock skew, an early manual start) has no honest duration yet.
    if (!inProgressSince || inProgressSince.getTime() > now.getTime()) {
      return {
        phase: ScheduledMaintenancePhase.Ongoing,
        isOverdue: false,
        nextChangeAt: nextChangeAt,
      };
    }

    return {
      phase: ScheduledMaintenancePhase.Ongoing,
      durationPrefix: SCHEDULED_MAINTENANCE_DURATION_PREFIX.inProgressFor,
      durationStartsAt: inProgressSince,
      durationEndsAt: now,
      isOverdue: false,
      nextChangeAt: nextChangeAt,
    };
  }

  return {
    phase: ScheduledMaintenancePhase.Unknown,
    isOverdue: false,
  };
};

/*
 * Whether the result can change as time passes, i.e. whether a mounted
 * header needs a clock at all. An ended event, or one with no usable dates,
 * reads the same forever.
 */
export const isScheduledMaintenanceTimingLive: (
  timing: ScheduledMaintenanceTiming,
) => boolean = (timing: ScheduledMaintenanceTiming): boolean => {
  if (
    timing.phase === ScheduledMaintenancePhase.Ended ||
    timing.phase === ScheduledMaintenancePhase.Unknown
  ) {
    return false;
  }

  return Boolean(timing.durationPrefix) || Boolean(timing.nextChangeAt);
};

/*
 * How long to wait before re-evaluating: the regular interval, or sooner
 * when the phase is about to change, but never in a tight loop.
 */
export const getScheduledMaintenanceTimingRefreshDelayInMs: (
  timing: ScheduledMaintenanceTiming,
  now: Date,
) => number = (timing: ScheduledMaintenanceTiming, now: Date): number => {
  let delay: number = SCHEDULED_MAINTENANCE_TIMING_REFRESH_INTERVAL_IN_MS;

  if (timing.nextChangeAt) {
    const untilChange: number = timing.nextChangeAt.getTime() - now.getTime();

    if (untilChange > 0) {
      delay = Math.min(delay, untilChange);
    }
  }

  return Math.max(SCHEDULED_MAINTENANCE_TIMING_MIN_REFRESH_DELAY_IN_MS, delay);
};

/*
 * Whether the header should re-read the state timeline: only while a
 * boundary has recently been missed, which is almost always the worker not
 * having run yet rather than a stuck event.
 */
export const shouldRecheckScheduledMaintenanceState: (
  timing: ScheduledMaintenanceTiming,
  now: Date,
) => boolean = (timing: ScheduledMaintenanceTiming, now: Date): boolean => {
  if (
    timing.phase !== ScheduledMaintenancePhase.StartOverdue &&
    timing.phase !== ScheduledMaintenancePhase.EndOverdue
  ) {
    return false;
  }

  if (!timing.overdueSince) {
    return false;
  }

  const sinceBoundary: number = now.getTime() - timing.overdueSince.getTime();

  return (
    sinceBoundary >= 0 &&
    sinceBoundary <= SCHEDULED_MAINTENANCE_STATE_RECHECK_WINDOW_IN_MS
  );
};

type PluraliseFunction = (count: number, unit: string) => string;

const pluralise: PluraliseFunction = (count: number, unit: string): string => {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
};

/*
 * A short relative time for the stat bar: "in 2 hours", "3 days ago",
 * "in less than a minute". Minutes are floored so "in 1 minute" never
 * overstates how long is left; hours and days are rounded. Returns "" for
 * a missing or invalid date.
 */
export const formatScheduledMaintenanceRelativeTime: (
  value: DateInput,
  now: Date,
) => string = (value: DateInput, now: Date): string => {
  const date: Date | undefined = toValidDate(value);

  if (!date) {
    return "";
  }

  const differenceInMs: number = date.getTime() - now.getTime();
  const isFuture: boolean = differenceInMs > 0;
  const minutes: number = Math.floor(Math.abs(differenceInMs) / (60 * 1000));

  let amount: string = "";

  if (minutes < 1) {
    amount = "less than a minute";
  } else if (minutes < 60) {
    amount = pluralise(minutes, "minute");
  } else {
    const hours: number = Math.round(minutes / 60);

    if (hours < 24) {
      amount = pluralise(hours, "hour");
    } else {
      amount = pluralise(Math.round(minutes / (24 * 60)), "day");
    }
  }

  return isFuture ? `in ${amount}` : `${amount} ago`;
};
