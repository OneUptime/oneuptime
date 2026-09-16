import AggregationInterval from "../../Types/BaseDatabase/AggregationInterval";
import SloMultiMonitorMode from "../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloWindowType from "../../Types/ServiceLevelObjective/SloWindowType";
import { formatDurationCompact } from "./SloDuration";
import { SLO_CURRENT_BURN_RATE_WINDOW_MINUTES } from "./SloEvaluation";
import {
  DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
  DEFAULT_ROLLING_WINDOW_DAYS,
  getSloBudgetTier,
  isRollingWindowNotYetFull,
  SloBudgetTier,
} from "./SloHealth";
import SloUtil, { CalendarMonthWindow } from "./SloUtil";
import { SLO_NOT_EVALUATED_TEXT } from "./SloWidgetFormat";

/**
 * "Where is this error budget heading?" — the forward-looking numbers on the
 * SLO overview, derived purely from the columns the evaluation worker
 * persists.
 *
 * The worker stores where the budget IS: remaining seconds, remaining
 * percentage and the last hour's burn rate. The on-call engineer's next
 * question is where it is GOING — how long the budget lasts at this pace,
 * whether a calendar month resets first, how full a young rolling window
 * is. None of that is persisted, and every piece has an edge that is easy
 * to get subtly wrong inline in a component: a SIGNED budget, a target that
 * leaves no budget at all, and a multi-monitor mode whose budget is summed
 * monitor-seconds rather than wall-clock seconds.
 *
 * So it lives here, React-free and unit-tested branch by branch, beside
 * SloHealth and SloDuration.
 */

const EM_DASH: string = "—";

const SECONDS_PER_DAY: number = 24 * 60 * 60;

/**
 * A runway this short is an emergency whatever the window: nobody can ship
 * a fix, get it reviewed and roll it out in less than a day.
 */
const RUNWAY_DANGER_SECONDS: number = SECONDS_PER_DAY;

/**
 * Upper bound on generated ideal-burn points. A calendar month at hourly
 * buckets is 744 points; this only guards a caller passing a tiny step.
 */
const MAX_IDEAL_BURN_POINTS: number = 2000;

/**
 * Slack for comparisons whose inputs went through `1 - target / 100`, which
 * is never exact in binary floating point (99.9% leaves 0.0010000000000000009).
 */
const FLOAT_TOLERANCE: number = 1e-9;

type ToFiniteNumberFunction = (
  value: number | undefined | null,
) => number | null;

const toFiniteNumber: ToFiniteNumberFunction = (
  value: number | undefined | null,
): number | null => {
  if (typeof value !== "number" || !isFinite(value)) {
    return null;
  }

  return value;
};

type ClampFunction = (value: number, min: number, max: number) => number;

const clamp: ClampFunction = (
  value: number,
  min: number,
  max: number,
): number => {
  return Math.min(max, Math.max(min, value));
};

/**
 * The share of time the target allows to be bad (0.001 for 99.9%), or null
 * when the target leaves no budget to reason about. The worker marks such an
 * SLO Misconfigured before any budget maths runs, so there is nothing
 * trustworthy to project either.
 */
type GetAllowedBadFractionFunction = (
  targetPercentage: number | undefined | null,
) => number | null;

const getAllowedBadFraction: GetAllowedBadFractionFunction = (
  targetPercentage: number | undefined | null,
): number | null => {
  const target: number | null = toFiniteNumber(targetPercentage);

  if (target === null || target <= 0 || target >= 100) {
    return null;
  }

  return 1 - target / 100;
};

/**
 * The rolling window length the worker would use: the SLO's own days, or
 * the DB default when the column is missing or unusable.
 */
type GetRollingWindowDaysFunction = (
  windowDays: number | undefined | null,
) => number;

const getRollingWindowDays: GetRollingWindowDaysFunction = (
  windowDays: number | undefined | null,
): number => {
  const days: number | null = toFiniteNumber(windowDays);

  if (days === null || days <= 0) {
    return DEFAULT_ROLLING_WINDOW_DAYS;
  }

  return days;
};

type PluralizeDaysFunction = (days: number) => string;

const pluralizeDays: PluralizeDaysFunction = (days: number): string => {
  return `${days} ${days === 1 ? "day" : "days"}`;
};

/**
 * The calendar month containing `now` in the SLO's timezone, through the
 * worker's own SloUtil.getCalendarMonthWindow so the overview's "resets in"
 * can never disagree with when the worker actually resets the budget.
 * Returns null for a timezone moment does not know (SloUtil throws), so the
 * caller can say less rather than guess.
 */
type GetCalendarWindowFunction = (
  timezone: string | undefined | null,
  now: Date,
) => CalendarMonthWindow | null;

const getCalendarWindow: GetCalendarWindowFunction = (
  timezone: string | undefined | null,
  now: Date,
): CalendarMonthWindow | null => {
  try {
    return SloUtil.getCalendarMonthWindow({
      timezone: timezone || undefined,
      at: now,
    });
  } catch {
    return null;
  }
};

/*
 * ---------------------------------------------------------------------------
 * Rolling window fill
 * ---------------------------------------------------------------------------
 */

export interface SloRollingWindowFillData {
  windowType?: SloWindowType | undefined | null;
  windowDays?: number | undefined | null;
  targetPercentage?: number | undefined | null;
  errorBudgetTotalSeconds?: number | undefined | null;
  multiMonitorMode?: SloMultiMonitorMode | undefined | null;
}

/**
 * How much of a rolling window's full budget exists so far, 0..1, or null
 * when the idea does not apply.
 *
 * Same maths and the same exclusions as SloHealth.isRollingWindowNotYetFull
 * (read its comment for why): `errorBudgetTotalSeconds` is prorated to the
 * data that exists, so dividing it by the full-window budget is exactly the
 * share of the window that has filled. Calendar months (budget fixed at the
 * full period from day one) and Monitor Seconds Average (budget summed
 * across monitors, so it cannot be compared with one window) are null — a
 * missing hint beats a wrong one.
 */
export type GetRollingWindowFillFractionFunction = (
  data: SloRollingWindowFillData,
) => number | null;

export const getRollingWindowFillFraction: GetRollingWindowFillFractionFunction =
  (data: SloRollingWindowFillData): number | null => {
    if (data.windowType === SloWindowType.CalendarMonth) {
      return null;
    }

    if (data.multiMonitorMode === SloMultiMonitorMode.MonitorSecondsAverage) {
      return null;
    }

    const budgetTotalSeconds: number | null = toFiniteNumber(
      data.errorBudgetTotalSeconds,
    );

    if (budgetTotalSeconds === null || budgetTotalSeconds <= 0) {
      return null;
    }

    const allowedBadFraction: number | null = getAllowedBadFraction(
      data.targetPercentage,
    );

    if (allowedBadFraction === null) {
      return null;
    }

    const windowDays: number =
      toFiniteNumber(data.windowDays) ?? DEFAULT_ROLLING_WINDOW_DAYS;

    if (windowDays <= 0) {
      return null;
    }

    const fullWindowBudgetSeconds: number =
      allowedBadFraction * windowDays * SECONDS_PER_DAY;

    return clamp(budgetTotalSeconds / fullWindowBudgetSeconds, 0, 1);
  };

export interface SloRollingWindowFill {
  /** Share of the full-window budget that exists so far, 0..1. */
  fraction: number;
  /**
   * Whole percent, FLOORED: a window must never read "100% full" while it
   * is still short of full.
   */
  percent: number;
  /** "Window 23% full", or "Window under 1% full" for a brand-new SLO. */
  label: string;
  /**
   * Exactly SloHealth.isRollingWindowNotYetFull for the same row — its 1%
   * tolerance included — so a "window filling" hint appears precisely when
   * the old "Window not yet full" banner did, and never flickers on a
   * mature SLO between evaluations.
   */
  isNotYetFull: boolean;
}

export type GetRollingWindowFillFunction = (
  data: SloRollingWindowFillData,
) => SloRollingWindowFill | null;

export const getRollingWindowFill: GetRollingWindowFillFunction = (
  data: SloRollingWindowFillData,
): SloRollingWindowFill | null => {
  const fraction: number | null = getRollingWindowFillFraction(data);

  if (fraction === null) {
    return null;
  }

  /*
   * The epsilon absorbs binary floating point: 648 / 2592 seconds is exactly
   * a quarter, but (1 - 99.9 / 100) is not exactly 0.001, and a bare floor
   * would print "24% full".
   */
  const percent: number = Math.floor(fraction * 100 + FLOAT_TOLERANCE);

  return {
    fraction: fraction,
    percent: percent,
    label: percent < 1 ? "Window under 1% full" : `Window ${percent}% full`,
    isNotYetFull: isRollingWindowNotYetFull(data),
  };
};

/*
 * ---------------------------------------------------------------------------
 * Budget runway
 * ---------------------------------------------------------------------------
 */

export enum SloBudgetRunwayKind {
  /** The worker has not produced the budget or the burn rate yet. */
  NotEvaluated = "NotEvaluated",
  /** A projection would be meaningless for this SLO — see the description. */
  NotProjected = "NotProjected",
  /** Remaining budget is zero or negative. */
  Overspent = "Overspent",
  /** Nothing bad happened in the burn-rate lookback. */
  NotBurning = "NotBurning",
  /** Calendar month: the budget resets before it would run out. */
  LastsUntilReset = "LastsUntilReset",
  /** Rolling window: at this pace the budget can never run out. */
  Sustainable = "Sustainable",
  /** The budget runs out in `runwaySeconds` at the current pace. */
  RunsOut = "RunsOut",
}

/** How worried the reader should be — the component maps it to a colour. */
export enum SloProjectionTone {
  Neutral = "Neutral",
  Good = "Good",
  Warning = "Warning",
  Danger = "Danger",
}

export interface SloBudgetRunway {
  kind: SloBudgetRunwayKind;
  tone: SloProjectionTone;
  /** The headline, e.g. "~2d 5h", "Not burning", "Lasts until reset". */
  value: string;
  /** One line of context under the headline. */
  description: string;
  /** Seconds until the budget is gone at the current pace, when projected. */
  runwaySeconds: number | null;
  /** Calendar months only: seconds until the budget resets to full. */
  secondsUntilReset: number | null;
}

export interface SloBudgetRunwayData {
  windowType?: SloWindowType | undefined | null;
  windowDays?: number | undefined | null;
  timezone?: string | undefined | null;
  targetPercentage?: number | undefined | null;
  multiMonitorMode?: SloMultiMonitorMode | undefined | null;
  errorBudgetRemainingSeconds?: number | undefined | null;
  currentBurnRate?: number | undefined | null;
  now: Date;
}

/**
 * How long the remaining error budget lasts at the current burn rate.
 *
 * Burn rate B is (bad / total) / allowed (SloUtil.computeBurnRate), so the
 * budget drains at B * allowed budget-seconds per wall-clock second and the
 * runway is `remaining / (B * allowed)`. Sanity check: a full budget of
 * allowed * W burning at exactly 1x lasts exactly W.
 *
 * Caveats handled rather than papered over:
 *
 * - Rolling windows also REGAIN budget as old downtime ages out, which the
 *   straight line ignores, so the projection is a floor. It is still exact
 *   at its most useful boundary: a runway of at least one whole window
 *   implies B <= 1, and a budget spent no faster than it regenerates can
 *   never run out — reported as Sustainable rather than as a large, falsely
 *   precise number.
 * - Calendar months reset to a full budget at the start of the next month
 *   (in the SLO's timezone), so a runway past the reset "lasts until reset".
 * - Monitor Seconds Average sums monitor-seconds across monitors, so the
 *   remaining "seconds" are not wall-clock seconds and dividing by a
 *   wall-clock rate would be wrong by the monitor count. Not projected, for
 *   the same "missing hint beats a wrong one" reason as the window fill.
 * - Every figure is labelled with the burn-rate lookback it came from.
 */
export type GetSloBudgetRunwayFunction = (
  data: SloBudgetRunwayData,
) => SloBudgetRunway;

export const getSloBudgetRunway: GetSloBudgetRunwayFunction = (
  data: SloBudgetRunwayData,
): SloBudgetRunway => {
  const remainingSeconds: number | null = toFiniteNumber(
    data.errorBudgetRemainingSeconds,
  );
  const burnRate: number | null = toFiniteNumber(data.currentBurnRate);

  if (remainingSeconds === null || burnRate === null) {
    return {
      kind: SloBudgetRunwayKind.NotEvaluated,
      tone: SloProjectionTone.Neutral,
      value: EM_DASH,
      description: SLO_NOT_EVALUATED_TEXT,
      runwaySeconds: null,
      secondsUntilReset: null,
    };
  }

  if (data.multiMonitorMode === SloMultiMonitorMode.MonitorSecondsAverage) {
    return {
      kind: SloBudgetRunwayKind.NotProjected,
      tone: SloProjectionTone.Neutral,
      value: EM_DASH,
      description: "Not projected when downtime is averaged across monitors",
      runwaySeconds: null,
      secondsUntilReset: null,
    };
  }

  const allowedBadFraction: number | null = getAllowedBadFraction(
    data.targetPercentage,
  );

  if (allowedBadFraction === null) {
    return {
      kind: SloBudgetRunwayKind.NotProjected,
      tone: SloProjectionTone.Neutral,
      value: EM_DASH,
      description: "Needs a target between 0% and 100%",
      runwaySeconds: null,
      secondsUntilReset: null,
    };
  }

  const isCalendarMonth: boolean =
    data.windowType === SloWindowType.CalendarMonth;

  const calendarWindow: CalendarMonthWindow | null = isCalendarMonth
    ? getCalendarWindow(data.timezone, data.now)
    : null;

  const secondsUntilReset: number | null = calendarWindow
    ? Math.max(
        0,
        (calendarWindow.endDate.getTime() - data.now.getTime()) / 1000,
      )
    : null;

  const resetSuffix: string =
    secondsUntilReset === null
      ? ""
      : ` · resets in ${formatDurationCompact(secondsUntilReset)}`;

  const burnRateWindowText: string = formatDurationCompact(
    SLO_CURRENT_BURN_RATE_WINDOW_MINUTES * 60,
  );

  if (remainingSeconds <= 0) {
    return {
      kind: SloBudgetRunwayKind.Overspent,
      tone: SloProjectionTone.Danger,
      value: "Overspent",
      description:
        remainingSeconds < 0
          ? `${formatDurationCompact(remainingSeconds)} over budget${resetSuffix}`
          : `Budget fully spent${resetSuffix}`,
      runwaySeconds: 0,
      secondsUntilReset: secondsUntilReset,
    };
  }

  /*
   * A negative burn rate cannot come out of SloUtil.computeBurnRate; if one
   * ever reaches the client it means "no evidence of burn", not a budget
   * that grows, so it reads the same as zero.
   */
  if (burnRate <= 0) {
    return {
      kind: SloBudgetRunwayKind.NotBurning,
      tone: SloProjectionTone.Good,
      value: "Not burning",
      description: `No budget spent in the last ${burnRateWindowText}${resetSuffix}`,
      runwaySeconds: null,
      secondsUntilReset: secondsUntilReset,
    };
  }

  const runwaySeconds: number =
    remainingSeconds / (burnRate * allowedBadFraction);

  const atBurnRateText: string = `at the burn rate of the last ${burnRateWindowText}`;

  if (secondsUntilReset !== null && runwaySeconds >= secondsUntilReset) {
    return {
      kind: SloBudgetRunwayKind.LastsUntilReset,
      tone: SloProjectionTone.Good,
      value: "Lasts until reset",
      description: `Resets in ${formatDurationCompact(secondsUntilReset)}, ${atBurnRateText}`,
      runwaySeconds: runwaySeconds,
      secondsUntilReset: secondsUntilReset,
    };
  }

  if (!isCalendarMonth) {
    const windowDays: number = getRollingWindowDays(data.windowDays);

    /*
     * Relative tolerance so a full budget burning at exactly 1x — runway ==
     * window on paper — is not reported as "~29d 23h" because of the float
     * error in the allowed fraction.
     */
    if (runwaySeconds >= windowDays * SECONDS_PER_DAY * (1 - FLOAT_TOLERANCE)) {
      return {
        kind: SloBudgetRunwayKind.Sustainable,
        tone: SloProjectionTone.Good,
        value: "Sustainable",
        description: `Outlasts the ${windowDays}-day window, ${atBurnRateText}`,
        runwaySeconds: runwaySeconds,
        secondsUntilReset: null,
      };
    }
  }

  return {
    kind: SloBudgetRunwayKind.RunsOut,
    tone:
      runwaySeconds <= RUNWAY_DANGER_SECONDS
        ? SloProjectionTone.Danger
        : SloProjectionTone.Warning,
    // formatDurationCompact floors to whole seconds; "~0s" would read as "now".
    value:
      runwaySeconds < 60
        ? "Under 1m"
        : `~${formatDurationCompact(runwaySeconds)}`,
    description: `Until exhausted, ${atBurnRateText}${resetSuffix}`,
    runwaySeconds: runwaySeconds,
    secondsUntilReset: secondsUntilReset,
  };
};

/*
 * ---------------------------------------------------------------------------
 * Budget bar geometry
 * ---------------------------------------------------------------------------
 */

export interface SloBudgetBarGeometry {
  /** False until the worker has written a remaining-budget percentage. */
  isEvaluated: boolean;
  /** Width of the fill, clamped to 0..100. Zero when not evaluated. */
  fillPercent: number;
  /** Where the at-risk tick sits along the track, clamped to 0..100. */
  markerPercent: number;
  /** The threshold the marker stands for (the SLO's own, or the default). */
  atRiskThresholdPercentage: number;
  /** Same tier as every other red/amber/green on the SLO pages. */
  tier: SloBudgetTier;
  /** Remaining budget is below zero — the fill is clamped, the text is not. */
  isOverspent: boolean;
}

/**
 * Everything the budget bar draws, from the SIGNED remaining percentage.
 *
 * The percentage is unrounded and uncapped below zero (an overspent budget
 * reads -340%), so only the drawing is clamped; the colour comes from
 * SloHealth.getSloBudgetTier with the SLO's own threshold, so the bar can
 * never be green while the status pill says At Risk.
 */
export type GetSloBudgetBarGeometryFunction = (data: {
  errorBudgetRemainingPercentage: number | undefined | null;
  atRiskThresholdPercentage?: number | undefined | null;
}) => SloBudgetBarGeometry;

export const getSloBudgetBarGeometry: GetSloBudgetBarGeometryFunction = (data: {
  errorBudgetRemainingPercentage: number | undefined | null;
  atRiskThresholdPercentage?: number | undefined | null;
}): SloBudgetBarGeometry => {
  const remaining: number | null = toFiniteNumber(
    data.errorBudgetRemainingPercentage,
  );

  const threshold: number =
    toFiniteNumber(data.atRiskThresholdPercentage) ??
    DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE;

  return {
    isEvaluated: remaining !== null,
    fillPercent: remaining === null ? 0 : clamp(remaining, 0, 100),
    markerPercent: clamp(threshold, 0, 100),
    atRiskThresholdPercentage: threshold,
    tier: getSloBudgetTier({
      errorBudgetRemainingPercentage: remaining,
      atRiskThresholdPercentage: threshold,
    }),
    isOverspent: remaining !== null && remaining < 0,
  };
};

/*
 * ---------------------------------------------------------------------------
 * SLI versus target
 * ---------------------------------------------------------------------------
 */

/**
 * SLIs are quoted to three decimals across the SLO pages — the digits past
 * the second are what separate 99.99% from 99.95%.
 */
const SLI_DELTA_DECIMALS: number = 3;

type RoundToDecimalsFunction = (value: number, decimals: number) => number;

const roundToDecimals: RoundToDecimalsFunction = (
  value: number,
  decimals: number,
): number => {
  const factor: number = Math.pow(10, decimals);

  // `+ 0` turns the -0 Math.round can produce into 0, which never prints "-0".
  return Math.round(value * factor) / factor + 0;
};

export interface SliVersusTargetData {
  currentSliPercentage: number | undefined | null;
  targetPercentage: number | undefined | null;
}

/**
 * SLI minus target in percentage points, rounded for display, or null when
 * either side is unknown.
 */
export type GetSliDeltaPercentagePointsFunction = (
  data: SliVersusTargetData,
) => number | null;

export const getSliDeltaPercentagePoints: GetSliDeltaPercentagePointsFunction =
  (data: SliVersusTargetData): number | null => {
    const sli: number | null = toFiniteNumber(data.currentSliPercentage);
    const target: number | null = toFiniteNumber(data.targetPercentage);

    if (sli === null || target === null) {
      return null;
    }

    return roundToDecimals(sli - target, SLI_DELTA_DECIMALS);
  };

/**
 * True only when both numbers are known and the SLI is strictly below the
 * target — compared UNROUNDED, like the worker's own comparisons.
 */
export type IsSliBelowTargetFunction = (data: SliVersusTargetData) => boolean;

export const isSliBelowTarget: IsSliBelowTargetFunction = (
  data: SliVersusTargetData,
): boolean => {
  const sli: number | null = toFiniteNumber(data.currentSliPercentage);
  const target: number | null = toFiniteNumber(data.targetPercentage);

  return sli !== null && target !== null && sli < target;
};

/**
 * "0.042 pp above the 99.9% target" — how far the SLI sits from its target,
 * in percentage points, which is how the gap is discussed ("we are 4 basis
 * points under"). Returns null when either number is unknown so the caller
 * phrases "not evaluated" in its own context.
 *
 * A gap that rounds to zero still says which side it is on ("Just below"),
 * because the tile colours the SLI red on the unrounded comparison and the
 * words must not contradict the colour.
 */
export type GetSliDeltaTextFunction = (
  data: SliVersusTargetData,
) => string | null;

export const getSliDeltaText: GetSliDeltaTextFunction = (
  data: SliVersusTargetData,
): string | null => {
  const delta: number | null = getSliDeltaPercentagePoints(data);

  if (delta === null) {
    return null;
  }

  const sli: number = data.currentSliPercentage as number;
  const target: number = data.targetPercentage as number;
  const targetText: string = `${roundToDecimals(target, SLI_DELTA_DECIMALS)}%`;

  if (delta === 0) {
    if (sli < target) {
      return `Just below the ${targetText} target`;
    }

    if (sli > target) {
      return `Just above the ${targetText} target`;
    }

    return `Exactly on the ${targetText} target`;
  }

  if (delta > 0) {
    return `${delta} pp above the ${targetText} target`;
  }

  return `${Math.abs(delta)} pp below the ${targetText} target`;
};

/*
 * ---------------------------------------------------------------------------
 * Burn rate rules
 * ---------------------------------------------------------------------------
 */

/**
 * The lowest usable threshold among the given burn rate rules, or null when
 * none is usable. The worker skips a rule whose threshold is missing or not
 * positive (EvaluateSlos.evaluateBurnRateRule), so those cannot be the line
 * the current burn is compared against either.
 */
export type GetLowestBurnRateThresholdFunction = (
  thresholds: Array<number | undefined | null>,
) => number | null;

export const getLowestBurnRateThreshold: GetLowestBurnRateThresholdFunction = (
  thresholds: Array<number | undefined | null>,
): number | null => {
  let lowest: number | null = null;

  for (const value of thresholds) {
    const threshold: number | null = toFiniteNumber(value);

    if (threshold === null || threshold <= 0) {
      continue;
    }

    if (lowest === null || threshold < lowest) {
      lowest = threshold;
    }
  }

  return lowest;
};

/**
 * `>=`, matching the worker, which fires a rule when the burn is "at or
 * above the threshold". False whenever either number is unknown.
 */
export type IsBurnRateAtOrAboveThresholdFunction = (data: {
  burnRate: number | undefined | null;
  threshold: number | undefined | null;
}) => boolean;

export const isBurnRateAtOrAboveThreshold: IsBurnRateAtOrAboveThresholdFunction =
  (data: {
    burnRate: number | undefined | null;
    threshold: number | undefined | null;
  }): boolean => {
    const burnRate: number | null = toFiniteNumber(data.burnRate);
    const threshold: number | null = toFiniteNumber(data.threshold);

    if (burnRate === null || threshold === null || threshold <= 0) {
      return false;
    }

    return burnRate >= threshold;
  };

/*
 * ---------------------------------------------------------------------------
 * Allowed downtime
 * ---------------------------------------------------------------------------
 */

/*
 * `1 - target / 100` is never exact in binary floating point: 99.9% of 30
 * days computes as 2591.9999999999995 seconds, and the duration formatters
 * floor, so the card read "43m 11s" for exactly 43m 12s. Rounding to the
 * microsecond removes that error without touching a genuinely fractional
 * allowance (99.999% of one day is 0.864 s).
 */
const ALLOWED_DOWNTIME_DECIMALS: number = 6;

export interface SloAllowedDowntime {
  /** Downtime the target allows over one whole window. */
  seconds: number;
  /** "per rolling 30 days" / "this calendar month". */
  periodText: string;
}

/**
 * The target restated as a duration ("43m 12s per rolling 30 days"), which
 * is how most people actually reason about 99.9%.
 *
 * Calendar months use THIS month's real length in the SLO's timezone — the
 * worker's budget denominator — so February and a DST month read their true
 * allowance. Null when the target leaves no budget, or a calendar SLO's
 * timezone is unknown.
 */
export type GetSloAllowedDowntimeFunction = (data: {
  targetPercentage: number | undefined | null;
  windowType?: SloWindowType | undefined | null;
  windowDays?: number | undefined | null;
  timezone?: string | undefined | null;
  now: Date;
}) => SloAllowedDowntime | null;

export const getSloAllowedDowntime: GetSloAllowedDowntimeFunction = (data: {
  targetPercentage: number | undefined | null;
  windowType?: SloWindowType | undefined | null;
  windowDays?: number | undefined | null;
  timezone?: string | undefined | null;
  now: Date;
}): SloAllowedDowntime | null => {
  const allowedBadFraction: number | null = getAllowedBadFraction(
    data.targetPercentage,
  );

  if (allowedBadFraction === null) {
    return null;
  }

  if (data.windowType === SloWindowType.CalendarMonth) {
    const calendarWindow: CalendarMonthWindow | null = getCalendarWindow(
      data.timezone,
      data.now,
    );

    if (!calendarWindow) {
      return null;
    }

    return {
      seconds: roundToDecimals(
        allowedBadFraction * calendarWindow.totalSecondsInFullPeriod,
        ALLOWED_DOWNTIME_DECIMALS,
      ),
      periodText: "this calendar month",
    };
  }

  const windowDays: number = getRollingWindowDays(data.windowDays);

  return {
    seconds: roundToDecimals(
      allowedBadFraction * windowDays * SECONDS_PER_DAY,
      ALLOWED_DOWNTIME_DECIMALS,
    ),
    periodText: `per rolling ${pluralizeDays(windowDays)}`,
  };
};

/*
 * ---------------------------------------------------------------------------
 * Compliance window chart range
 * ---------------------------------------------------------------------------
 */

export interface SloComplianceWindowRange {
  /** Start of the window the current budget is measured over. */
  startDate: Date;
  /** Where history can exist up to: now. */
  endDate: Date;
  /**
   * Where a chart's x-axis should end: now for a rolling window, and the
   * reset for a calendar month so the rest of the month stays visible and an
   * ideal-burn line can run all the way to zero.
   */
  axisEndDate: Date;
}

/**
 * The current compliance window — the span the numbers in the KPI strip
 * describe. A calendar month with a timezone moment does not know falls
 * back to the UTC month, so the chart still has a sensible range to show.
 */
export type GetSloComplianceWindowRangeFunction = (data: {
  windowType?: SloWindowType | undefined | null;
  windowDays?: number | undefined | null;
  timezone?: string | undefined | null;
  now: Date;
}) => SloComplianceWindowRange;

export const getSloComplianceWindowRange: GetSloComplianceWindowRangeFunction =
  (data: {
    windowType?: SloWindowType | undefined | null;
    windowDays?: number | undefined | null;
    timezone?: string | undefined | null;
    now: Date;
  }): SloComplianceWindowRange => {
    if (data.windowType === SloWindowType.CalendarMonth) {
      const calendarWindow: CalendarMonthWindow | null =
        getCalendarWindow(data.timezone, data.now) ||
        getCalendarWindow("UTC", data.now);

      if (calendarWindow) {
        return {
          startDate: calendarWindow.startDate,
          endDate: data.now,
          axisEndDate: calendarWindow.endDate,
        };
      }
    }

    const windowDays: number = getRollingWindowDays(data.windowDays);

    return {
      startDate: new Date(
        data.now.getTime() - windowDays * SECONDS_PER_DAY * 1000,
      ),
      endDate: data.now,
      axisEndDate: data.now,
    };
  };

export interface SloIdealBurnPoint {
  x: Date;
  y: number;
}

/**
 * The straight line from a full budget at the start of a calendar month to
 * an empty one at its reset: spending exactly at 1x lands on it, so a budget
 * line below it is spending too fast. (A rolling window has no such line —
 * at a steady 1x its remaining budget stays flat, never reaching zero.)
 *
 * One point per chart bucket, because the chart does not connect across
 * empty buckets: a two-point line would draw as two dots.
 */
export type GetSloIdealBurnPointsFunction = (data: {
  startDate: Date;
  endDate: Date;
  stepSeconds: number;
}) => Array<SloIdealBurnPoint>;

export const getSloIdealBurnPoints: GetSloIdealBurnPointsFunction = (data: {
  startDate: Date;
  endDate: Date;
  stepSeconds: number;
}): Array<SloIdealBurnPoint> => {
  const startTime: number = data.startDate.getTime();
  const endTime: number = data.endDate.getTime();
  const spanMs: number = endTime - startTime;

  if (!isFinite(spanMs) || spanMs <= 0) {
    return [];
  }

  const requestedStepMs: number =
    isFinite(data.stepSeconds) && data.stepSeconds > 0
      ? data.stepSeconds * 1000
      : spanMs;

  const stepMs: number = Math.max(
    requestedStepMs,
    spanMs / MAX_IDEAL_BURN_POINTS,
  );

  const points: Array<SloIdealBurnPoint> = [];

  for (let time: number = startTime; time < endTime; time += stepMs) {
    points.push({
      x: new Date(time),
      y: 100 * (1 - (time - startTime) / spanMs),
    });
  }

  points.push({ x: new Date(endTime), y: 0 });

  return points;
};

/**
 * Seconds in one chart bucket, for the intervals the SLO charts use. Null
 * for the variable-length and whole-window intervals, which have no fixed
 * step.
 */
export type GetSloChartBucketSecondsFunction = (
  interval: AggregationInterval,
) => number | null;

export const getSloChartBucketSeconds: GetSloChartBucketSecondsFunction = (
  interval: AggregationInterval,
): number | null => {
  switch (interval) {
    case AggregationInterval.Minute:
      return 60;
    case AggregationInterval.FiveMinutes:
      return 5 * 60;
    case AggregationInterval.FifteenMinutes:
      return 15 * 60;
    case AggregationInterval.ThirtyMinutes:
      return 30 * 60;
    case AggregationInterval.Hour:
      return 60 * 60;
    case AggregationInterval.Day:
      return SECONDS_PER_DAY;
    case AggregationInterval.Week:
      return 7 * SECONDS_PER_DAY;
    default:
      return null;
  }
};
