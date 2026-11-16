import SliType from "Common/Types/ServiceLevelObjective/SliType";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import {
  createTranslator,
  SentenceOptions,
  Translator,
} from "Common/Types/Translator";
import { DEFAULT_ROLLING_WINDOW_DAYS } from "Common/Utils/Slo/SloHealth";
import {
  getRollingWindowFillLabel,
  SloRollingWindowFill,
} from "Common/Utils/Slo/SloProjection";
import {
  getRequestCountingWindowFill,
  isEventSliType,
} from "Common/Utils/Slo/SloRequestSli";
import SloUtil from "Common/Utils/Slo/SloUtil";
import { formatSloPercent } from "Common/Utils/Slo/SloWidgetFormat";

/*
 * A REQUEST SLO's numbers, in the reader's language: its error budget is
 * counted in requests - failed ones for Request Success, slow ones for
 * Request Latency - not in minutes, and what its counts cover is how far
 * back OneUptime has counted its services' requests, not how old it is.
 *
 * Kept beside SloOverviewTextInLanguage, and like it React-free, so the
 * Overview's tiles and the Settings page say a request SLO's budget the
 * same way, and a test can hand any locale to every sentence here. Every
 * count is written in the reader's digits and plural forms.
 */

const ENGLISH: Translator = createTranslator(undefined);

const isLatency: (sliType: SliType | string | undefined | null) => boolean = (
  sliType: SliType | string | undefined | null,
): boolean => {
  return sliType === SliType.RequestLatency;
};

// A Metric SLO's events are whatever its metric counts (#8445).
const isMetric: (sliType: SliType | string | undefined | null) => boolean = (
  sliType: SliType | string | undefined | null,
): boolean => {
  return sliType === SliType.Metric;
};

export interface SloRequestBudgetData {
  sliType: SliType | string | undefined | null;
  // SIGNED: negative once the budget is spent.
  remainingEvents: number | undefined | null;
  // The bad requests the target allows in the window.
  totalEvents: number | undefined | null;
}

// A worker column as a number: a decimal can reach the page as a string.
const toFinite: (value: number | string | undefined | null) => number | null = (
  value: number | string | undefined | null,
): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed: number = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
};

/*
 * "120 of 1,000 failed requests left" / "50 slow requests over budget":
 * the error budget tile's line for a request SLO, in place of a duration.
 * The budget is a share of a count and rarely whole, so both counts are
 * rounded to whole requests. Null before the first evaluation, so the
 * caller says "not evaluated" its own way.
 */
export const getRequestBudgetRemainingOfTotalInLanguage: (
  data: SloRequestBudgetData,
  translator?: Translator,
  options?: SentenceOptions,
) => string | null = (
  data: SloRequestBudgetData,
  translator: Translator = ENGLISH,
  options?: SentenceOptions,
): string | null => {
  const remaining: number | null = toFinite(data.remainingEvents);

  if (remaining === null) {
    return null;
  }

  // "|| 0": -0.4 rounds to -0, which a number format writes "-0".
  const roundedRemaining: number = Math.round(remaining) || 0;

  if (roundedRemaining < 0) {
    if (isMetric(data.sliType)) {
      return translator.translatePlural(
        {
          one: "{{count}} bad event over budget",
          other: "{{count}} bad events over budget",
        },
        Math.abs(roundedRemaining),
        undefined,
        options,
      );
    }

    return translator.translatePlural(
      isLatency(data.sliType)
        ? {
            one: "{{count}} slow request over budget",
            other: "{{count}} slow requests over budget",
          }
        : {
            one: "{{count}} failed request over budget",
            other: "{{count}} failed requests over budget",
          },
      Math.abs(roundedRemaining),
      undefined,
      options,
    );
  }

  const total: number = Math.max(
    0,
    Math.round(toFinite(data.totalEvents) ?? 0),
  );

  if (isMetric(data.sliType)) {
    return translator.translatePlural(
      {
        one: "{{remaining}} of {{count}} bad event left",
        other: "{{remaining}} of {{count}} bad events left",
      },
      total,
      { remaining: translator.formatNumber(roundedRemaining) },
      options,
    );
  }

  return translator.translatePlural(
    isLatency(data.sliType)
      ? {
          one: "{{remaining}} of {{count}} slow request left",
          other: "{{remaining}} of {{count}} slow requests left",
        }
      : {
          one: "{{remaining}} of {{count}} failed request left",
          other: "{{remaining}} of {{count}} failed requests left",
        },
    total,
    { remaining: translator.formatNumber(roundedRemaining) },
    options,
  );
};

/*
 * "No services" / "1 service" / "3 services": a request SLO's services, as
 * the Overview's chip counts them.
 */
export const getSloServiceCountInLanguage: (
  count: number,
  translator?: Translator,
) => string = (count: number, translator: Translator = ENGLISH): string => {
  if (!Number.isFinite(count) || count <= 0) {
    return translator.translateText("No services") || "No services";
  }

  return translator.translatePlural(
    { one: "{{count}} service", other: "{{count}} services" },
    count,
  );
};

/*
 * "0.1% of requests: 1 bad request in every 1,000" - what a request SLO's
 * objective allows, as the Settings page's Error Budget row says it. Null
 * for a target that leaves no budget.
 */
export const describeRequestErrorBudgetInLanguage: (
  data: {
    targetPercentage: number | undefined | null;
    // A Metric SLO's are events (#8445); a request SLO's, requests.
    sliType?: SliType | string | undefined | null;
  },
  translator?: Translator,
) => string | null = (
  data: {
    targetPercentage: number | undefined | null;
    sliType?: SliType | string | undefined | null;
  },
  translator: Translator = ENGLISH,
): string | null => {
  const target: number | null = toFinite(data.targetPercentage);

  if (target === null || target <= 0 || target >= 100) {
    return null;
  }

  const allowedPercentage: number = 100 - target;

  const values: { share: string; count: string } = {
    share:
      formatSloPercent(allowedPercentage, 3, translator) ??
      `${allowedPercentage}%`,
    // A count of requests, grouped as the budget tile's are: "1,000".
    count: translator.formatNumber(Math.round(100 / allowedPercentage)),
  };

  if (isMetric(data.sliType)) {
    return translator.translateTemplate(
      "{{share}} of events: 1 bad event in every {{count}}",
      values,
      { setsValuesApart: true },
    );
  }

  return translator.translateTemplate(
    "{{share}} of requests: 1 bad request in every {{count}}",
    values,
    { setsValuesApart: true },
  );
};

export interface SloRequestCountingData {
  sliType: SliType | string | undefined | null;
  windowType: SloWindowType | string | undefined | null;
  windowDays: number | undefined | null;
  timezone?: string | undefined | null;
  firstAccumulatedBucketStartAt: Date | string | undefined | null;
  lastAccumulatedBucketEndAt: Date | string | undefined | null;
}

const toDate: (value: Date | string | undefined | null) => Date | null = (
  value: Date | string | undefined | null,
): Date | null => {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
};

/*
 * The window a request SLO's counts are summed over, as the worker sums it:
 * up to the newest counted step, a rolling window of days or the calendar
 * month. Null before anything is counted.
 */
const getRequestWindow: (
  data: SloRequestCountingData,
) => { start: Date; end: Date } | null = (
  data: SloRequestCountingData,
): { start: Date; end: Date } | null => {
  const end: Date | null = toDate(data.lastAccumulatedBucketEndAt);

  if (!end) {
    return null;
  }

  if (data.windowType === SloWindowType.CalendarMonth) {
    try {
      return {
        start: SloUtil.getCalendarMonthWindow({
          timezone: data.timezone || "UTC",
          at: end,
        }).startDate,
        end: end,
      };
    } catch {
      return null;
    }
  }

  const windowDays: number =
    typeof data.windowDays === "number" && data.windowDays > 0
      ? data.windowDays
      : DEFAULT_ROLLING_WINDOW_DAYS;

  return {
    start: new Date(end.getTime() - windowDays * 24 * 60 * 60 * 1000),
    end: end,
  };
};

/*
 * How much of a request SLO's window its counts cover: the "Window 23%
 * full" chip, while OneUptime is still counting the older requests of a new
 * SLO (or of one whose services just changed). Null for any other SLO, and
 * before anything is counted.
 */
export const getRequestWindowFill: (
  data: SloRequestCountingData,
) => SloRollingWindowFill | null = (
  data: SloRequestCountingData,
): SloRollingWindowFill | null => {
  if (!isEventSliType(data.sliType)) {
    return null;
  }

  const window: { start: Date; end: Date } | null = getRequestWindow(data);

  if (!window) {
    return null;
  }

  const fraction: number | null = getRequestCountingWindowFill({
    windowStart: window.start,
    windowEnd: window.end,
    firstAccumulatedBucketStartAt: toDate(data.firstAccumulatedBucketStartAt),
  });

  if (fraction === null) {
    return null;
  }

  // Floored, so a window never reads "100% full" while it is still short.
  const percent: number = Math.floor(fraction * 100 + 1e-9);

  return {
    fraction: fraction,
    percent: percent,
    label: getRollingWindowFillLabel(percent),
    // A step short of the window is full: counting works in 5-minute steps.
    isNotYetFull: fraction < 0.99,
  };
};

/*
 * The seconds of budget a request SLO has left, as a time-based SLO would
 * have them over the same window: what the runway is projected from. A
 * budget of B% left over a window of W lasts B% * W at 1x - the same for
 * requests as for time, as long as traffic stays as steady as it was.
 */
export const getRequestBudgetRemainingSecondsEquivalent: (
  data: SloRequestCountingData & {
    targetPercentage: number | undefined | null;
    errorBudgetRemainingPercentage: number | undefined | null;
  },
) => number | null = (
  data: SloRequestCountingData & {
    targetPercentage: number | undefined | null;
    errorBudgetRemainingPercentage: number | undefined | null;
  },
): number | null => {
  const remainingPercentage: number | null = toFinite(
    data.errorBudgetRemainingPercentage,
  );
  const target: number | null = toFinite(data.targetPercentage);
  const window: { start: Date; end: Date } | null = getRequestWindow(data);
  const first: Date | null = toDate(data.firstAccumulatedBucketStartAt);

  if (
    remainingPercentage === null ||
    target === null ||
    target <= 0 ||
    target >= 100 ||
    !window ||
    !first
  ) {
    return null;
  }

  const coveredSeconds: number =
    (window.end.getTime() - Math.max(window.start.getTime(), first.getTime())) /
    1000;

  if (coveredSeconds <= 0) {
    return null;
  }

  return (remainingPercentage / 100) * (1 - target / 100) * coveredSeconds;
};
