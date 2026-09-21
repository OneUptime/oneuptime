import SliType from "../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../Types/ServiceLevelObjective/SloWindowType";
import {
  DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
  DEFAULT_ROLLING_WINDOW_DAYS,
} from "./SloHealth";
import { formatSloPercent } from "./SloWidgetFormat";

/**
 * Plain-language copy for the SLO overview.
 *
 * The old overview printed configuration as the raw values it is stored as
 * — "Any Monitor Down", "30 days rolling", an empty cell for the default
 * downtime statuses — which answers "what is in the column" rather than
 * "what does this SLO do". These helpers turn each setting into the sentence
 * an SRE would say, in one React-free place so the hero, the KPI strip and
 * the configuration card cannot word the same setting two ways, and so every
 * default and null is unit-tested.
 */

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

export interface SloWindowTextData {
  windowType?: SloWindowType | undefined | null;
  windowDays?: number | undefined | null;
  timezone?: string | undefined | null;
}

type GetWindowDaysFunction = (windowDays: number | undefined | null) => number;

const getWindowDays: GetWindowDaysFunction = (
  windowDays: number | undefined | null,
): number => {
  const days: number | null = toFiniteNumber(windowDays);

  // Same fallback as the worker and SloHealth: the DB default.
  return days === null || days <= 0 ? DEFAULT_ROLLING_WINDOW_DAYS : days;
};

type PluralizeFunction = (count: number, singular: string) => string;

const pluralize: PluralizeFunction = (
  count: number,
  singular: string,
): string => {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
};

/** "Rolling 30 days" / "Calendar month (Europe/Berlin)" — a chip or a row value. */
export type GetSloWindowTextFunction = (data: SloWindowTextData) => string;

export const getSloWindowText: GetSloWindowTextFunction = (
  data: SloWindowTextData,
): string => {
  if (data.windowType === SloWindowType.CalendarMonth) {
    return `Calendar month (${data.timezone || "UTC"})`;
  }

  return `Rolling ${pluralize(getWindowDays(data.windowDays), "day")}`;
};

/**
 * The same window as a phrase that completes a sentence: "measured over the
 * last 30 days" / "measured over this calendar month (UTC)".
 */
export type GetSloWindowPhraseFunction = (data: SloWindowTextData) => string;

export const getSloWindowPhrase: GetSloWindowPhraseFunction = (
  data: SloWindowTextData,
): string => {
  if (data.windowType === SloWindowType.CalendarMonth) {
    return `this calendar month (${data.timezone || "UTC"})`;
  }

  return `the last ${pluralize(getWindowDays(data.windowDays), "day")}`;
};

/** "Target 99.9%", or null when the target is unknown. */
export type GetSloTargetTextFunction = (
  targetPercentage: number | undefined | null,
) => string | null;

export const getSloTargetText: GetSloTargetTextFunction = (
  targetPercentage: number | undefined | null,
): string | null => {
  const target: string | null = formatSloPercent(targetPercentage);

  return target === null ? null : `Target ${target}`;
};

/**
 * A budget below zero is exceeded, not a useful negative percentage left.
 * Classify before rounding so even a small overage cannot read as 0%.
 * The signed value remains available to calculations and history charts.
 */
export type GetSloBudgetRemainingTextFunction = (
  percentage: number | undefined | null,
) => string | null;

export const getSloBudgetRemainingText: GetSloBudgetRemainingTextFunction = (
  percentage: number | undefined | null,
): string | null => {
  const remaining: number | null = toFiniteNumber(percentage);

  if (remaining === null) {
    return null;
  }

  if (remaining < 0) {
    return "Budget exceeded";
  }

  if (remaining === 0) {
    return "No budget left";
  }

  if (remaining < 0.1) {
    return "<0.1%";
  }

  return formatSloPercent(Math.min(remaining, 100), 1);
};

/** "No monitors" / "1 monitor" / "12 monitors". */
export type GetSloMonitorCountTextFunction = (count: number) => string;

export const getSloMonitorCountText: GetSloMonitorCountTextFunction = (
  count: number,
): string => {
  if (!isFinite(count) || count <= 0) {
    return "No monitors";
  }

  return pluralize(count, "monitor");
};

/** "When 20% or less of the error budget is left". */
export type GetSloAtRiskTextFunction = (
  atRiskThresholdPercentage: number | undefined | null,
) => string;

export const getSloAtRiskText: GetSloAtRiskTextFunction = (
  atRiskThresholdPercentage: number | undefined | null,
): string => {
  const threshold: number =
    toFiniteNumber(atRiskThresholdPercentage) ??
    DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE;

  return `When ${formatSloPercent(threshold)} or less of the error budget is left`;
};

/**
 * The statuses that count as downtime, or what an empty list means. The
 * service fills in every non-operational status on create, but an SLO saved
 * before that, or with the list cleared, falls back to the same rule in the
 * worker — so the empty case names the rule instead of rendering blank.
 */
export type GetSloDowntimeStatusesTextFunction = (
  statusNames: Array<string | undefined | null>,
) => string;

export const getSloDowntimeStatusesText: GetSloDowntimeStatusesTextFunction = (
  statusNames: Array<string | undefined | null>,
): string => {
  const names: Array<string> = statusNames
    .map((name: string | undefined | null) => {
      return (name || "").trim();
    })
    .filter((name: string) => {
      return name.length > 0;
    });

  if (names.length === 0) {
    return "Every non-operational status";
  }

  return names.join(", ");
};

export interface SloMultiMonitorModeText {
  title: string;
  description: string;
}

/**
 * What the multi-monitor mode does, in words. A null mode reads as Any
 * Monitor Down because that is the column's default and what the worker
 * applies.
 */
export type GetSloMultiMonitorModeTextFunction = (
  mode: SloMultiMonitorMode | undefined | null,
) => SloMultiMonitorModeText;

export const getSloMultiMonitorModeText: GetSloMultiMonitorModeTextFunction = (
  mode: SloMultiMonitorMode | undefined | null,
): SloMultiMonitorModeText => {
  if (mode === SloMultiMonitorMode.MonitorSecondsAverage) {
    return {
      title: "Averaged across monitors",
      description:
        "Each monitor's downtime counts on its own, so one monitor down out of four spends a quarter of the budget an outage of all four would.",
    };
  }

  return {
    title: "Down when any monitor is down",
    description:
      "A moment counts against the budget whenever at least one monitor is in a downtime status.",
  };
};

/** "Monitor uptime" / "Metric". */
export type GetSliTypeTextFunction = (
  sliType: SliType | undefined | null,
) => string;

export const getSliTypeText: GetSliTypeTextFunction = (
  sliType: SliType | undefined | null,
): string => {
  if (sliType === SliType.Metric) {
    return "Metric";
  }

  // MonitorUptime is the column default and the only type the worker evaluates.
  return "Monitor uptime";
};

export interface SloHeadlineData {
  isEnabled?: boolean | undefined | null;
  isArchived?: boolean | undefined | null;
  sloStatus?: SloStatus | undefined | null;
  lastEvaluatedAt?: Date | string | undefined | null;
  monitorCount?: number | undefined | null;
}

/**
 * The overview's one-line answer to "are we within budget?".
 *
 * Ordered like SloHealth.getSloNotice — from the condition that stops
 * measurement most completely to the budget verdicts — so an archived or
 * disabled SLO never claims a stale "Within error budget" from its last
 * evaluation.
 */
export type GetSloHeadlineFunction = (data: SloHeadlineData) => string;

export const getSloHeadline: GetSloHeadlineFunction = (
  data: SloHeadlineData,
): string => {
  if (data.isArchived === true) {
    return "Archived — not being measured";
  }

  if (data.isEnabled === false) {
    return "Disabled — not being measured";
  }

  if (data.sloStatus === SloStatus.Misconfigured) {
    return "Cannot be evaluated";
  }

  if (data.sloStatus === SloStatus.Paused) {
    return "Measurement paused";
  }

  if (!data.lastEvaluatedAt || !data.sloStatus) {
    return (toFiniteNumber(data.monitorCount) ?? 0) > 0
      ? "Waiting for the first evaluation"
      : "Waiting for monitors";
  }

  if (data.sloStatus === SloStatus.Healthy) {
    return "Within error budget";
  }

  if (data.sloStatus === SloStatus.AtRisk) {
    return "Error budget running low";
  }

  if (data.sloStatus === SloStatus.BudgetExhausted) {
    return "Error budget exhausted";
  }

  return "Status unknown";
};
