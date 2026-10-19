/*
 * AI SRE - did a change hurt its service? Pure on purpose: the numbers are
 * read elsewhere (RecentChangesContext), and every threshold is pinned by
 * tests.
 *
 * A change is a suspect when its service got measurably worse right after
 * it: more of its spans failing, a slower p99, more exceptions, or
 * exception types first seen in the version it shipped. The thresholds are
 * conservative and fixed, like the AI Insights detectors': a suspect means
 * something moved, not that a number wiggled. This is decided here, by the
 * server, from numbers - never from what a pipeline wrote in a change's
 * title, nor from what the model says - because which change OneUptime
 * calls a suspect must not be steerable by text in telemetry.
 */

export const CHANGE_IMPACT_THRESHOLDS: {
  // Spans each window needs before its error rate or p99 means anything.
  readonly minSpansPerWindow: number;
  // The error rate after must be at least this many times the rate before...
  readonly errorRateRatio: number;
  // ...and at least this many percentage points higher...
  readonly errorRateMinIncreasePoints: number;
  // ...over at least this many failed spans.
  readonly minErrorsAfter: number;
  // The p99 after must be at least this many times the p99 before...
  readonly p99Ratio: number;
  // ...and at least this many milliseconds slower.
  readonly p99MinIncreaseMs: number;
  // Exceptions per minute after must be at least this many times before...
  readonly exceptionRateRatio: number;
  // ...over at least this many exceptions.
  readonly minExceptionsAfter: number;
  // A new exception type counts once it has occurred this often.
  readonly minNewExceptionOccurrences: number;
  // An "after" window shorter than this says nothing yet.
  readonly minAfterWindowMinutes: number;
} = {
  minSpansPerWindow: 50,
  errorRateRatio: 2,
  errorRateMinIncreasePoints: 1,
  minErrorsAfter: 10,
  p99Ratio: 1.5,
  p99MinIncreaseMs: 100,
  exceptionRateRatio: 3,
  minExceptionsAfter: 10,
  minNewExceptionOccurrences: 3,
  minAfterWindowMinutes: 2,
};

// A service's telemetry over one window.
export interface ChangeWindowStats {
  durationMinutes: number;
  spanCount: number;
  errorSpanCount: number;
  p99Ms: number;
  exceptionCount: number;
}

// An exception type first seen in the version a change shipped.
export interface NewExceptionType {
  exceptionType: string;
  message: string;
  occurrenceCount: number;
}

export enum ChangeImpactVerdict {
  // The service got measurably worse right after the change.
  Suspect = "suspect",
  // Its telemetry was read, and nothing moved.
  NoStep = "no-step",
  // There was too little telemetry, or too little time, to tell.
  Unknown = "unknown",
}

export interface ChangeImpact {
  verdict: ChangeImpactVerdict;
  // What moved, in words, when the verdict is Suspect.
  reasons: Array<string>;
  before?: ChangeWindowStats | undefined;
  after?: ChangeWindowStats | undefined;
  newExceptionTypes: Array<NewExceptionType>;
}

// "6.4%", "0.25%": a rate with the precision a reader needs.
export function formatRate(rate: number): string {
  const percent: number = rate * 100;

  if (percent === 0) {
    return "0%";
  }

  if (percent < 1) {
    return `${percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
  }

  return `${percent.toFixed(1).replace(/\.0$/, "")}%`;
}

// "210 ms", "1.9 s".
export function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }

  return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")} s`;
}

// "0.5/min", "12/min".
export function formatPerMinute(perMinute: number): string {
  if (perMinute >= 10 || Number.isInteger(perMinute)) {
    return `${Math.round(perMinute)}/min`;
  }

  return `${perMinute.toFixed(1).replace(/\.0$/, "")}/min`;
}

function hasSpans(stats: ChangeWindowStats): boolean {
  return stats.spanCount >= CHANGE_IMPACT_THRESHOLDS.minSpansPerWindow;
}

function perMinute(count: number, durationMinutes: number): number {
  return durationMinutes > 0 ? count / durationMinutes : 0;
}

/*
 * Whether the service got worse right after the change, and how. `before`
 * and `after` are the windows on either side of the change; either may be
 * missing when it could not be read.
 */
export function assessChangeImpact(data: {
  before?: ChangeWindowStats | undefined;
  after?: ChangeWindowStats | undefined;
  newExceptionTypes?: Array<NewExceptionType> | undefined;
  // The version the change shipped, for "first seen in <version>".
  version?: string | undefined;
}): ChangeImpact {
  const thresholds: typeof CHANGE_IMPACT_THRESHOLDS = CHANGE_IMPACT_THRESHOLDS;
  const reasons: Array<string> = [];
  const newExceptionTypes: Array<NewExceptionType> = (
    data.newExceptionTypes || []
  ).filter((exception: NewExceptionType): boolean => {
    return exception.occurrenceCount >= thresholds.minNewExceptionOccurrences;
  });

  const { before, after } = data;

  if (
    before &&
    after &&
    after.durationMinutes >= thresholds.minAfterWindowMinutes
  ) {
    if (hasSpans(before) && hasSpans(after)) {
      const rateBefore: number = before.errorSpanCount / before.spanCount;
      const rateAfter: number = after.errorSpanCount / after.spanCount;

      if (
        after.errorSpanCount >= thresholds.minErrorsAfter &&
        rateAfter >= rateBefore * thresholds.errorRateRatio &&
        (rateAfter - rateBefore) * 100 >= thresholds.errorRateMinIncreasePoints
      ) {
        reasons.push(
          `span error rate ${formatRate(rateBefore)} → ${formatRate(rateAfter)}`,
        );
      }

      if (
        after.p99Ms >= before.p99Ms * thresholds.p99Ratio &&
        after.p99Ms - before.p99Ms >= thresholds.p99MinIncreaseMs
      ) {
        reasons.push(
          `p99 latency ${formatDurationMs(before.p99Ms)} → ${formatDurationMs(after.p99Ms)}`,
        );
      }
    }

    const exceptionsBefore: number = perMinute(
      before.exceptionCount,
      before.durationMinutes,
    );
    const exceptionsAfter: number = perMinute(
      after.exceptionCount,
      after.durationMinutes,
    );

    if (
      after.exceptionCount >= thresholds.minExceptionsAfter &&
      exceptionsAfter >= exceptionsBefore * thresholds.exceptionRateRatio &&
      exceptionsAfter > exceptionsBefore
    ) {
      reasons.push(
        `exceptions ${formatPerMinute(exceptionsBefore)} → ${formatPerMinute(exceptionsAfter)}`,
      );
    }
  }

  if (newExceptionTypes.length > 0) {
    const names: string = newExceptionTypes
      .slice(0, 3)
      .map((exception: NewExceptionType): string => {
        return `${exception.exceptionType || "Exception"} (x${exception.occurrenceCount})`;
      })
      .join(", ");

    reasons.push(
      `${newExceptionTypes.length} exception type${
        newExceptionTypes.length === 1 ? "" : "s"
      } first seen in ${data.version || "this version"}: ${names}`,
    );
  }

  if (reasons.length > 0) {
    return {
      verdict: ChangeImpactVerdict.Suspect,
      reasons,
      before,
      after,
      newExceptionTypes,
    };
  }

  const sawTelemetry: boolean = Boolean(
    before &&
      after &&
      after.durationMinutes >= thresholds.minAfterWindowMinutes &&
      ((hasSpans(before) && hasSpans(after)) ||
        before.exceptionCount + after.exceptionCount > 0),
  );

  return {
    verdict: sawTelemetry
      ? ChangeImpactVerdict.NoStep
      : ChangeImpactVerdict.Unknown,
    reasons: [],
    before,
    after,
    newExceptionTypes,
  };
}
