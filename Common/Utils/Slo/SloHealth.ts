import SliType from "../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../Types/ServiceLevelObjective/SloWindowType";

/**
 * The "should I be worried, and about what?" layer of the SLO UI.
 *
 * Two things live here, both pure and both previously inlined (and
 * subtly wrong) in the React pages:
 *
 * 1. The remaining-budget tier that drives every red/amber/green in the
 *    SLO surfaces. The pages hardcoded `remaining <= 20`, which silently
 *    disagreed with any SLO whose `atRiskThresholdPercentage` was not the
 *    default 20 — an SLO could render green while the worker had already
 *    moved it to At Risk.
 *
 * 2. The reason an SLO is not producing numbers. `Misconfigured` and
 *    `Paused` are the two statuses that mean "we are not measuring
 *    anything", and the pages showed them as a bare grey pill with no
 *    explanation and no way to act. The reasons here mirror exactly the
 *    guard clauses in the evaluation worker (EvaluateSlos.evaluateSlo).
 *
 * Kept free of React so both the SLO pages and the dashboard SLO widget
 * can import it, and so every branch is unit-testable without a DOM.
 */

/** The DB default for `ServiceLevelObjective.atRiskThresholdPercentage`. */
export const DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE: number = 20;

/** The DB default for `ServiceLevelObjective.windowDays`. */
export const DEFAULT_ROLLING_WINDOW_DAYS: number = 30;

export enum SloBudgetTier {
  /** The worker has not evaluated this SLO yet — assert nothing. */
  Unknown = "Unknown",
  Healthy = "Healthy",
  AtRisk = "AtRisk",
  Exhausted = "Exhausted",
}

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

/**
 * Tier from the SIGNED remaining-budget percentage, using the SLO's own
 * at-risk threshold rather than a hardcoded 20.
 *
 * Boundaries match SloUtil.computeSloStatus (`<= 0` is exhausted, `<=
 * threshold` is at risk) so the colour never contradicts the status pill
 * the worker computed. The hysteresis SloUtil applies is deliberately NOT
 * reproduced here: this function colours a number the user is looking at,
 * and hysteresis depends on the previous status, which is not part of
 * "what does this number mean".
 */
export type GetSloBudgetTierFunction = (data: {
  errorBudgetRemainingPercentage: number | undefined | null;
  atRiskThresholdPercentage?: number | undefined | null;
}) => SloBudgetTier;

export const getSloBudgetTier: GetSloBudgetTierFunction = (data: {
  errorBudgetRemainingPercentage: number | undefined | null;
  atRiskThresholdPercentage?: number | undefined | null;
}): SloBudgetTier => {
  const remaining: number | null = toFiniteNumber(
    data.errorBudgetRemainingPercentage,
  );

  if (remaining === null) {
    return SloBudgetTier.Unknown;
  }

  if (remaining <= 0) {
    return SloBudgetTier.Exhausted;
  }

  const threshold: number =
    toFiniteNumber(data.atRiskThresholdPercentage) ??
    DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE;

  if (remaining <= threshold) {
    return SloBudgetTier.AtRisk;
  }

  return SloBudgetTier.Healthy;
};

export enum SloNoticeType {
  Info = "Info",
  Warning = "Warning",
  Danger = "Danger",
}

export interface SloNotice {
  type: SloNoticeType;
  title: string;
  /** One sentence of "here is what to do about it". */
  body: string;
}

/**
 * The fields a notice can be derived from. Declared structurally rather
 * than importing the database model so this stays dependency-free and
 * tests can pass plain objects.
 */
export interface SloNoticeData {
  isEnabled?: boolean | undefined | null;
  sloStatus?: SloStatus | undefined | null;
  sliType?: SliType | undefined | null;
  /** Number of monitors currently attached. */
  monitorCount?: number | undefined | null;
  /** Of the attached monitors, how many have active monitoring disabled. */
  disabledMonitorCount?: number | undefined | null;
  targetPercentage?: number | undefined | null;
  lastEvaluatedAt?: Date | string | undefined | null;
}

/**
 * The single most important thing to tell the user about this SLO right
 * now, or null when the SLO is measuring normally.
 *
 * Ordered by how completely each condition stops the SLO from producing
 * numbers, so the banner always names the root cause rather than a
 * downstream symptom: a disabled SLO is not evaluated at all, so saying
 * "no monitors attached" would send the user to fix the wrong thing.
 *
 * Every branch mirrors a guard in the evaluation worker
 * (App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts):
 *   isEnabled=false      -> the SLO is skipped entirely by getDueSlos()
 *   sliType != Uptime    -> Misconfigured (Metric SLIs are not built yet)
 *   monitorCount == 0    -> Misconfigured
 *   target outside (0,100) -> Misconfigured
 *   all monitors disabled -> Paused
 */
export type GetSloNoticeFunction = (data: SloNoticeData) => SloNotice | null;

export const getSloNotice: GetSloNoticeFunction = (
  data: SloNoticeData,
): SloNotice | null => {
  if (data.isEnabled === false) {
    return {
      type: SloNoticeType.Info,
      title: "This SLO is disabled",
      body: "It is not being evaluated and its burn rate rules will not fire alerts. Turn Enabled back on in SLO Details to resume measuring.",
    };
  }

  const monitorCount: number = toFiniteNumber(data.monitorCount) ?? 0;

  if (data.sloStatus === SloStatus.Misconfigured) {
    if (data.sliType && data.sliType !== SliType.MonitorUptime) {
      return {
        type: SloNoticeType.Warning,
        title: "This SLO cannot be evaluated",
        body: `Only "${SliType.MonitorUptime}" SLIs are supported today. Change the SLI type to Monitor Uptime and attach the monitors this objective measures.`,
      };
    }

    if (monitorCount === 0) {
      return {
        type: SloNoticeType.Warning,
        title: "No monitors attached",
        body: "An SLO measures uptime from its monitors, so it cannot be evaluated without at least one. Add monitors in SLO Details below.",
      };
    }

    const target: number | null = toFiniteNumber(data.targetPercentage);

    if (target === null || target <= 0 || target >= 100) {
      return {
        type: SloNoticeType.Warning,
        title: "The target is out of range",
        body: "A target must be greater than 0 and less than 100 — a 100% target leaves no error budget to track. Set a target such as 99.9 in SLO Details below.",
      };
    }

    return {
      type: SloNoticeType.Warning,
      title: "This SLO cannot be evaluated",
      body: "Check that it has monitors attached and a target below 100%, then wait a few minutes for the next evaluation.",
    };
  }

  if (data.sloStatus === SloStatus.Paused) {
    return {
      type: SloNoticeType.Info,
      title: "Measurement is paused",
      body: "Every monitor attached to this SLO has active monitoring disabled — by hand, by a manual incident, or by a scheduled maintenance event — so there is no signal to measure. The SLO resumes automatically when a monitor starts reporting again.",
    };
  }

  if (!data.lastEvaluatedAt) {
    return {
      type: SloNoticeType.Info,
      title: "Not evaluated yet",
      body: "OneUptime evaluates SLOs every few minutes. The first numbers will appear shortly after this SLO is created.",
    };
  }

  return null;
};

/**
 * True when a rolling-window SLO is younger than its own window, so the
 * budget it is measuring against is smaller than the full-window budget.
 *
 * The SLI denominator is clamped forward to the earliest monitor event
 * (SloUtil.computeAnyDownSli), which means `errorBudgetTotalSeconds` for a
 * young SLO is proportionally short — a 30-day SLO with a week of data
 * carries a 7-day budget. Both the SLOs Overview and the Error Budgets
 * doc promise the dashboard flags this as "window not yet full"; this is
 * the detection behind that flag.
 *
 * Two cases are excluded on purpose:
 *
 * - Calendar-month windows: their budget is fixed at the FULL period from
 *   day one (never prorated), so the concept does not apply.
 *
 * - Monitor Seconds Average: its denominator is the SUM of monitored
 *   seconds ACROSS monitors (SloUtil.computeMonitorSecondsAverageSli), so
 *   `errorBudgetTotalSeconds` scales with the monitor count and cannot be
 *   compared against a single-window budget. A five-monitor SLO with a
 *   week of data would carry 35 monitor-days against a 30-day yardstick
 *   and read as mature. Rather than guess at a monitor count the caller
 *   may not have loaded, say nothing — a missing hint beats a wrong one.
 *
 * The 1% tolerance absorbs the gap between "now" and the worker's last
 * evaluation — without it, a fully mature SLO would flicker the banner on
 * every evaluation cycle.
 */
const WINDOW_FULL_TOLERANCE_FRACTION: number = 0.99;

export type IsRollingWindowNotYetFullFunction = (data: {
  windowType?: SloWindowType | undefined | null;
  windowDays?: number | undefined | null;
  targetPercentage?: number | undefined | null;
  errorBudgetTotalSeconds?: number | undefined | null;
  multiMonitorMode?: SloMultiMonitorMode | undefined | null;
}) => boolean;

export const isRollingWindowNotYetFull: IsRollingWindowNotYetFullFunction =
  (data: {
    windowType?: SloWindowType | undefined | null;
    windowDays?: number | undefined | null;
    targetPercentage?: number | undefined | null;
    errorBudgetTotalSeconds?: number | undefined | null;
    multiMonitorMode?: SloMultiMonitorMode | undefined | null;
  }): boolean => {
    if (data.windowType === SloWindowType.CalendarMonth) {
      return false;
    }

    if (data.multiMonitorMode === SloMultiMonitorMode.MonitorSecondsAverage) {
      return false;
    }

    const budgetTotalSeconds: number | null = toFiniteNumber(
      data.errorBudgetTotalSeconds,
    );
    const target: number | null = toFiniteNumber(data.targetPercentage);

    /*
     * Not evaluated yet, or a target that would make the full-window budget
     * meaningless: the "not evaluated" notice already covers the first case,
     * and the Misconfigured notice covers the second.
     */
    if (
      budgetTotalSeconds === null ||
      budgetTotalSeconds <= 0 ||
      target === null ||
      target <= 0 ||
      target >= 100
    ) {
      return false;
    }

    const windowDays: number =
      toFiniteNumber(data.windowDays) ?? DEFAULT_ROLLING_WINDOW_DAYS;

    if (windowDays <= 0) {
      return false;
    }

    const fullWindowBudgetSeconds: number =
      (1 - target / 100) * windowDays * 24 * 60 * 60;

    return (
      budgetTotalSeconds <
      fullWindowBudgetSeconds * WINDOW_FULL_TOLERANCE_FRACTION
    );
  };
