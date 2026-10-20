import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import { shortCommitSha } from "../../../../Utils/Telemetry/ChangeEventFields";

/*
 * Whether a merged AI fix fixed its exception in production - the pure
 * decisions behind FixProductionVerifier, so every threshold is pinned by
 * tests.
 *
 * A merged pull request has fixed nothing until it runs. The fix counts as
 * shipped once a recorded deploy of the exception's service contains its
 * commit, and as working once the exception has stayed away long enough to
 * mean something: long enough that, at the rate it happened before the fix,
 * it would have happened several times. One occurrence in the deployed fix
 * is a regression, however long it was quiet before.
 */

export const FIX_PRODUCTION_THRESHOLDS: {
  // Old pods can still throw for a while after a deploy starts.
  readonly rolloutGraceMinutes: number;
  // The least time a deployed fix is watched before it counts as working.
  readonly minWatchHours: number;
  // The longest a deployed fix is watched; after it, it is decided either way.
  readonly maxWatchDays: number;
  /*
   * How many occurrences the exception's rate before the fix must predict
   * for the watched time before their absence shows the fix works.
   */
  readonly minExpectedOccurrences: number;
  // How long after merging a deploy that contains the fix is waited for.
  readonly maxDeployWaitDays: number;
  // The window before the merge that measures how often the exception happened.
  readonly baselineDays: number;
} = {
  rolloutGraceMinutes: 10,
  minWatchHours: 24,
  maxWatchDays: 7,
  minExpectedOccurrences: 3,
  maxDeployWaitDays: 14,
  baselineDays: 7,
};

const HOUR_IN_MS: number = 60 * 60 * 1000;

export interface FixProductionVerdict {
  status: FixProductionStatus;
  // One or two sentences for people.
  summary: string;
}

// "version 2.3.2", "commit 1a2b3c4", or "a deploy".
export function describeDeploy(data: {
  version?: string | undefined;
  commitSha?: string | undefined;
}): string {
  if (data.version) {
    return `version ${data.version}`;
  }

  if (data.commitSha) {
    return `commit ${shortCommitSha(data.commitSha)}`;
  }

  return "a deploy";
}

// "30 minutes", "5 hours", "3 days".
export function describeDuration(milliseconds: number): string {
  const hours: number = milliseconds / HOUR_IN_MS;

  if (hours < 1) {
    const minutes: number = Math.max(1, Math.round(milliseconds / 60000));
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  if (hours < 48) {
    const wholeHours: number = Math.round(hours);
    return `${wholeHours} hour${wholeHours === 1 ? "" : "s"}`;
  }

  const days: number = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function describeCount(count: number): string {
  return count === 1 ? "once" : `${count} times`;
}

/*
 * Whether a recorded deploy contains the fix: the same commit (either may be
 * abbreviated), or - by GitHub's compare of the fix's commit with the
 * deploy's - a later one. "behind" and "diverged" deploys do not contain it.
 */
export function deployContainsFix(data: {
  deployCommitSha: string;
  fixCommitSha: string;
  // GitHub's compare status for base = the fix, head = the deploy.
  compareStatus?: string | undefined;
}): boolean {
  const deploy: string = data.deployCommitSha.trim().toLowerCase();
  const fix: string = data.fixCommitSha.trim().toLowerCase();

  if (deploy && fix && (deploy.startsWith(fix) || fix.startsWith(deploy))) {
    return true;
  }

  return data.compareStatus === "ahead" || data.compareStatus === "identical";
}

/*
 * A merged fix no recorded deploy contains yet: still waited for, or, past
 * maxDeployWaitDays, Unverifiable.
 */
export function decideDeployWait(data: {
  mergedAt: Date;
  now: Date;
}): FixProductionVerdict | null {
  const waited: number = data.now.getTime() - data.mergedAt.getTime();

  if (waited < FIX_PRODUCTION_THRESHOLDS.maxDeployWaitDays * 24 * HOUR_IN_MS) {
    return null;
  }

  return {
    status: FixProductionStatus.Unverifiable,
    summary: `No recorded deploy of the service contained the fix in the ${FIX_PRODUCTION_THRESHOLDS.maxDeployWaitDays} days after it merged. Record deploys with their commit (the oneuptime deploy command, or the vcs.ref.head.revision resource attribute) to verify fixes in production.`,
  };
}

/*
 * A deployed fix, watched: Regressed on any occurrence since it shipped,
 * Verified once its quiet time would have held minExpectedOccurrences at
 * the rate before the fix (and at least minWatchHours), Unverifiable once
 * maxWatchDays passed without that, Watching until then.
 */
export function decideWatchVerdict(data: {
  deployedAt: Date;
  now: Date;
  // Occurrences since the deploy (after the rollout grace, or in its version).
  occurrencesSinceDeploy: number;
  // Occurrences in the baselineDays before the fix merged.
  baselineOccurrences: number;
  // describeDeploy's words for the deploy.
  deployLabel: string;
}): FixProductionVerdict {
  const thresholds: typeof FIX_PRODUCTION_THRESHOLDS =
    FIX_PRODUCTION_THRESHOLDS;

  if (data.occurrencesSinceDeploy > 0) {
    return {
      status: FixProductionStatus.Regressed,
      summary: `The exception happened ${describeCount(
        data.occurrencesSinceDeploy,
      )} after ${data.deployLabel} shipped the fix, so the fix did not stop it.`,
    };
  }

  const watchStart: number =
    data.deployedAt.getTime() + thresholds.rolloutGraceMinutes * 60 * 1000;
  const watched: number = Math.max(0, data.now.getTime() - watchStart);
  const watchedHours: number = watched / HOUR_IN_MS;
  const baselinePerHour: number =
    data.baselineOccurrences / (thresholds.baselineDays * 24);
  const expected: number = baselinePerHour * watchedHours;
  const before: string = `before the fix it happened ${describeCount(
    data.baselineOccurrences,
  )} in ${thresholds.baselineDays} days`;

  if (
    watchedHours >= thresholds.minWatchHours &&
    expected >= thresholds.minExpectedOccurrences
  ) {
    return {
      status: FixProductionStatus.Verified,
      summary: `No occurrence in the ${describeDuration(
        watched,
      )} since ${data.deployLabel} shipped the fix; ${before}.`,
    };
  }

  if (watchedHours >= thresholds.maxWatchDays * 24) {
    return {
      status: FixProductionStatus.Unverifiable,
      summary: `No occurrence in the ${describeDuration(
        watched,
      )} since ${data.deployLabel} shipped the fix, but ${before}: too rare for its absence to show the fix works.`,
    };
  }

  // Worded the same on every check, so a check that learns nothing writes nothing.
  return {
    status: FixProductionStatus.Watching,
    summary: `${capitalize(
      data.deployLabel,
    )} shipped the fix, and the exception has not happened since; ${before}.`,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/*
 * What a fix pull request's row records when GitHub says it merged.
 * Only the fields that are set: written straight into the row's update.
 */
export interface FixMergedFields {
  mergedAt: Date;
  mergeCommitSha?: string;
  productionStatus?: FixProductionStatus;
  productionStatusAt?: Date;
  productionSummary?: string;
}

/*
 * The merge commit and time, and - for a fix of an exception, the one kind
 * whose effect production shows - the start of its production watch.
 */
export function fieldsWhenMerged(data: {
  mergeCommitSha?: string | undefined;
  mergedAt?: Date | undefined;
  isExceptionFix: boolean;
  now: Date;
}): FixMergedFields {
  return {
    mergedAt: data.mergedAt || data.now,
    ...(data.mergeCommitSha ? { mergeCommitSha: data.mergeCommitSha } : {}),
    ...(data.isExceptionFix
      ? {
          productionStatus: FixProductionStatus.AwaitingDeploy,
          productionStatusAt: data.now,
          productionSummary:
            "Merged. Waiting for a recorded deploy of the service that contains the fix.",
        }
      : {}),
  };
}
