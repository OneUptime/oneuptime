import {
  PerformanceFinding,
  PerformanceFindingType,
} from "../../../../Types/AI/CodeFixTaskContext";
import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import { formatDurationMs } from "../SRE/ChangeImpact";
import {
  FIX_PRODUCTION_THRESHOLDS,
  FixProductionVerdict,
  HOUR_IN_MS,
  capitalize,
  describeCount,
  describeDuration,
  fitVerdict,
  formatCount,
  quoteName,
  watchedMilliseconds,
} from "./FixProductionVerdict";

/*
 * Whether a merged AI performance fix made its operation faster in
 * production - the pure decisions behind PerformanceFixWatch, so every
 * threshold is pinned by tests.
 *
 * A performance fix (FixPerformance) names one operation: the one a
 * trace-latency insight found slower, or the one a slow trace's finding
 * slows - the parent of an N+1 or of siblings that could run together, or
 * the dominant span itself. Its p99 in the week before the merge is the
 * baseline; its p99 in the deployed fix - in the deploy's version when the
 * service's telemetry reports it, else after the rollout grace - is what
 * shows whether the fix worked.
 *
 * Conservative both ways, because a p99 moves with the day's traffic: no
 * verdict before the fix has run a whole day on enough spans. Then a p99 at
 * least a fifth lower is Verified, one no lower at all is Regressed (the fix
 * did not make it faster, and the insight that asked for it reopens), and
 * anything between is watched until maxWatchDays, when it is Unverifiable:
 * too little to tell a fix from a quieter week.
 */

export const PERFORMANCE_FIX_THRESHOLDS: {
  readonly rolloutGraceMinutes: number;
  // The least time a deployed fix runs before its p99 is compared.
  readonly minWatchHours: number;
  // The longest a deployed fix is watched; after it, it is decided either way.
  readonly maxWatchDays: number;
  // The window before the merge whose p99 is the baseline.
  readonly baselineDays: number;
  // Spans each side needs before its p99 means anything.
  readonly minSpans: number;
  // How much lower the p99 must be, as a fraction, to count as faster.
  readonly minImprovement: number;
} = {
  rolloutGraceMinutes: FIX_PRODUCTION_THRESHOLDS.rolloutGraceMinutes,
  minWatchHours: 24,
  maxWatchDays: 7,
  baselineDays: 7,
  // The trace-latency insight's own floor for a baseline it trusts.
  minSpans: 100,
  minImprovement: 0.2,
};

// An operation's spans over a window, and their p99.
export interface PerformanceMeasure {
  spanCount: number;
  p99Ms: number;
}

/*
 * The operation a trace's finding slows, as its spans are named: the
 * parent an N+1 or a run of sequential siblings sits under - what the
 * pattern makes slow, and what a fix that batches or parallelizes them
 * makes fast - or the dominant span itself. Undefined when the finding
 * names none (a parent it could not see).
 */
export function operationOfFinding(
  finding: PerformanceFinding | undefined,
): string | undefined {
  if (!finding) {
    return undefined;
  }

  const name: string | undefined =
    finding.findingType === PerformanceFindingType.DominantSpan
      ? finding.implicatedSpans?.[0]?.name
      : finding.parentSpanName;

  return name && name.trim() ? name : undefined;
}

/*
 * What a summary calls the measured operation: its span name, quoted, or
 * the service's spans when it names none.
 */
export function describeOperation(data: {
  spanName?: string | undefined;
  serviceName?: string | undefined;
}): string {
  if (data.spanName) {
    return quoteName(data.spanName);
  }

  return data.serviceName
    ? `the spans of ${quoteName(data.serviceName)}`
    : "the service's spans";
}

/*
 * A baseline too thin to compare with: Unverifiable at once, before any
 * deploy - no later check can add spans to the week before the merge.
 */
export function decidePerformanceBaseline(data: {
  baseline: PerformanceMeasure;
  // describeOperation's words for what is measured.
  operationLabel: string;
}): FixProductionVerdict | null {
  if (data.baseline.spanCount >= PERFORMANCE_FIX_THRESHOLDS.minSpans) {
    return null;
  }

  return fitVerdict({
    status: FixProductionStatus.Unverifiable,
    summary: `${capitalize(data.operationLabel)} ran ${describeCount(
      data.baseline.spanCount,
    )} in the ${PERFORMANCE_FIX_THRESHOLDS.baselineDays} days before the fix merged: too few to measure its p99 against.`,
  });
}

/*
 * A deployed fix, measured: Watching until it has run minWatchHours on
 * minSpans spans; then Verified when its p99 is at least minImprovement
 * lower than the baseline's, Regressed when it is not lower at all, and
 * watched until maxWatchDays in between, when it is Unverifiable.
 */
export function decidePerformanceVerdict(data: {
  deployedAt: Date;
  now: Date;
  baseline: PerformanceMeasure;
  // The deployed fix's spans; null before they are read (too early to).
  sinceDeploy: PerformanceMeasure | null;
  // describeDeploy's words for the deploy.
  deployLabel: string;
  // describeOperation's words for what is measured.
  operationLabel: string;
}): FixProductionVerdict {
  const thresholds: typeof PERFORMANCE_FIX_THRESHOLDS =
    PERFORMANCE_FIX_THRESHOLDS;
  const watched: number = watchedMilliseconds({
    deployedAt: data.deployedAt,
    now: data.now,
    rolloutGraceMinutes: thresholds.rolloutGraceMinutes,
  });
  const isOver: boolean = watched >= thresholds.maxWatchDays * 24 * HOUR_IN_MS;

  // Worded the same on every check, so a check that learns nothing writes nothing.
  const watching: (reason: string) => FixProductionVerdict = (
    reason: string,
  ): FixProductionVerdict => {
    return fitVerdict({
      status: FixProductionStatus.Watching,
      summary: `${capitalize(data.deployLabel)} shipped the fix. The p99 of ${
        data.operationLabel
      } was ${formatDurationMs(data.baseline.p99Ms)} in the ${
        thresholds.baselineDays
      } days before it merged; ${reason}`,
    });
  };

  if (watched < thresholds.minWatchHours * HOUR_IN_MS || !data.sinceDeploy) {
    return watching("it is compared again once the fix has run for a day.");
  }

  const since: PerformanceMeasure = data.sinceDeploy;

  if (since.spanCount < thresholds.minSpans) {
    if (isOver) {
      return fitVerdict({
        status: FixProductionStatus.Unverifiable,
        summary: `${capitalize(data.operationLabel)} ran ${describeCount(
          since.spanCount,
        )} in the ${describeDuration(watched)} since ${
          data.deployLabel
        } shipped the fix: too few to measure its p99.`,
      });
    }

    return watching("it has not run often enough since to compare.");
  }

  const ratio: number =
    data.baseline.p99Ms > 0 ? since.p99Ms / data.baseline.p99Ms : 1;
  const sinceWords: string = `in the ${describeDuration(watched)} since ${
    data.deployLabel
  } shipped the fix (${formatCount(since.spanCount)} spans)`;

  if (ratio <= 1 - thresholds.minImprovement) {
    return fitVerdict({
      status: FixProductionStatus.Verified,
      summary: `The p99 of ${data.operationLabel} fell from ${formatDurationMs(
        data.baseline.p99Ms,
      )} to ${formatDurationMs(since.p99Ms)} ${sinceWords}.`,
    });
  }

  if (ratio >= 1) {
    return fitVerdict({
      status: FixProductionStatus.Regressed,
      summary: `The p99 of ${data.operationLabel} is ${formatDurationMs(
        since.p99Ms,
      )} ${sinceWords}, against ${formatDurationMs(
        data.baseline.p99Ms,
      )} in the ${
        thresholds.baselineDays
      } days before it merged, so the fix did not make it faster.`,
    });
  }

  if (isOver) {
    return fitVerdict({
      status: FixProductionStatus.Unverifiable,
      summary: `The p99 of ${data.operationLabel} fell from ${formatDurationMs(
        data.baseline.p99Ms,
      )} to ${formatDurationMs(since.p99Ms)} ${sinceWords}: ${Math.round(
        (1 - ratio) * 100,
      )}% faster, too little to tell the fix from a quieter week.`,
    });
  }

  return watching(
    `it is faster since, but not yet by ${Math.round(
      thresholds.minImprovement * 100,
    )}%.`,
  );
}
