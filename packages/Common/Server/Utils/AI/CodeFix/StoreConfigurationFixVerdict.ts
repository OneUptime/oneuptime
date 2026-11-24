import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import {
  formatCount,
  FixProductionVerdict,
  HOUR_IN_MS,
} from "./FixProductionVerdict";

/*
 * WHETHER A FIX IN INFRASTRUCTURE CODE TOOK (#10368) - the pure decisions
 * behind StoreConfigurationFixWatch, so every threshold is pinned by tests.
 *
 * Terraform, CloudFormation or Bicep changes nothing until it is applied.
 * Once the pull request merges, the stores it is for are read again at
 * once, as Check Now reads them, and each of their issues is followed:
 *
 *   - applied: the issue resolved after the merge as its check passed;
 *   - not applied yet: it is still open;
 *   - not this fix's: a person accepted it or set it aside, it was fixed
 *     from here, its check no longer runs, its store is gone, or it
 *     resolved before the merge - none of which the pull request did.
 *
 * Every issue applied is Verified. One still open after a day is "merged,
 * not applied" - an apply is usually what is missing - said once, to the
 * stores' owners and the pull request's author, but only once a read made
 * a day after the merge found its check still failing: a store nobody has
 * read since cannot say it was not applied. Past the time a deploy is
 * waited for, it is Unverifiable: the change never took.
 */

export const STORE_CONFIGURATION_FIX_THRESHOLDS: {
  // How long after the merge a failing check is "merged, not applied".
  readonly notAppliedAfterHours: number;
  /*
   * How long a read must be old before its result is trusted: the
   * evaluation that follows a read runs within minutes.
   */
  readonly readSettleMinutes: number;
  // How long the change is waited for before it is decided either way.
  readonly maxWaitDays: number;
} = {
  notAppliedAfterHours: 24,
  readSettleMinutes: 15,
  maxWaitDays: 14,
};

// Where the fix's issues stand, as the watch counted them.
export interface StoreConfigurationFixCounts {
  // Resolved after the merge as their check passed.
  applied: number;
  // Still open.
  open: number;
  // Of the open ones, those a read a day after the merge found still failing.
  openAfterADay: number;
  // Not this fix's to prove: accepted, set aside, fixed from here, gone.
  notThisFix: number;
}

function stores(count: number): string {
  return count === 1 ? "1 store" : `${formatCount(count)} stores`;
}

// Whether a read of a store, made at `readAt`, tells how it stood a day after the merge.
export function isReadADayAfterMerge(data: {
  readAt: Date | null | undefined;
  mergedAt: Date;
  now: Date;
}): boolean {
  if (!data.readAt) {
    return false;
  }

  const readAt: number = new Date(data.readAt).getTime();

  return (
    readAt >=
      data.mergedAt.getTime() +
        STORE_CONFIGURATION_FIX_THRESHOLDS.notAppliedAfterHours * HOUR_IN_MS &&
    data.now.getTime() - readAt >=
      STORE_CONFIGURATION_FIX_THRESHOLDS.readSettleMinutes * 60 * 1000
  );
}

// Whether a day has passed since the merge.
export function isADayAfterMerge(data: { mergedAt: Date; now: Date }): boolean {
  return (
    data.now.getTime() - data.mergedAt.getTime() >=
    STORE_CONFIGURATION_FIX_THRESHOLDS.notAppliedAfterHours * HOUR_IN_MS
  );
}

/*
 * The fix's verdict from where its issues stand. Worded the same on every
 * check that learns nothing, so such a check writes nothing.
 */
export function decideStoreConfigurationVerdict(data: {
  mergedAt: Date;
  now: Date;
  counts: StoreConfigurationFixCounts;
}): FixProductionVerdict {
  const counts: StoreConfigurationFixCounts = data.counts;
  const total: number = counts.applied + counts.open;
  const waited: number = data.now.getTime() - data.mergedAt.getTime();

  if (counts.open === 0) {
    if (counts.applied > 0) {
      return {
        status: FixProductionStatus.Verified,
        summary:
          counts.applied === 1
            ? "Applied: the store, read again after the merge, passes its check."
            : `Applied: each of the ${stores(counts.applied)}, read again after the merge, passes its check.`,
      };
    }

    return {
      status: FixProductionStatus.Unverifiable,
      summary:
        "None of the issues this fix was for was left for it to fix: each was accepted, set aside, fixed from here or gone before its check passed.",
    };
  }

  if (
    waited >=
    STORE_CONFIGURATION_FIX_THRESHOLDS.maxWaitDays * 24 * HOUR_IN_MS
  ) {
    return {
      status: FixProductionStatus.Unverifiable,
      summary: `${capitalizeFirst(stores(counts.open))} of ${formatCount(total)} still failed ${counts.open === 1 ? "its" : "their"} check ${STORE_CONFIGURATION_FIX_THRESHOLDS.maxWaitDays} days after the merge: the change was never applied, or did not fix the check.`,
    };
  }

  const status: FixProductionStatus =
    counts.applied > 0
      ? FixProductionStatus.Watching
      : FixProductionStatus.AwaitingDeploy;
  const applied: string =
    counts.applied > 0
      ? ` ${capitalizeFirst(stores(counts.applied))} of ${formatCount(total)} ${counts.applied === 1 ? "passes its" : "pass their"} check now.`
      : "";

  if (counts.openAfterADay > 0) {
    return {
      status,
      summary: `Merged, not applied: a day after the merge, ${stores(counts.open)} still ${counts.open === 1 ? "fails its" : "fail their"} check when read again. An apply is usually what is missing.${applied}`,
    };
  }

  return {
    status,
    summary: `Merged. Waiting for the change to be applied: ${stores(counts.open)} still ${counts.open === 1 ? "fails its" : "fail their"} check.${applied}`,
  };
}

function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
