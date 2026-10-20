import { describe, expect, test } from "@jest/globals";
import {
  FIX_PRODUCTION_THRESHOLDS,
  FixMergedFields,
  FixProductionVerdict,
  decideDeployWait,
  decideWatchVerdict,
  deployContainsFix,
  describeDeploy,
  describeDuration,
  fieldsWhenMerged,
} from "../../../../../Server/Utils/AI/CodeFix/FixProductionVerdict";
import FixProductionStatus, {
  FixProductionStatusHelper,
} from "../../../../../Types/AI/FixProductionStatus";

/*
 * Merged is not fixed. These pin when a merged AI fix counts as shipped
 * (a recorded deploy contains its commit), as working (the exception stayed
 * away long enough to mean something at its rate before the fix), as not
 * working (one occurrence in the deployed fix), and as impossible to tell.
 */

const HOUR: number = 60 * 60 * 1000;
const DEPLOYED_AT: Date = new Date("2026-10-20T10:00:00.000Z");
const GRACE: number = FIX_PRODUCTION_THRESHOLDS.rolloutGraceMinutes * 60 * 1000;
const FIX_SHA: string = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";

// `hours` of watched time after the rollout grace.
function watched(hours: number): Date {
  return new Date(DEPLOYED_AT.getTime() + GRACE + hours * HOUR);
}

function watch(data: {
  now: Date;
  occurrencesSinceDeploy?: number;
  baselineOccurrences: number;
}): FixProductionVerdict {
  return decideWatchVerdict({
    deployedAt: DEPLOYED_AT,
    now: data.now,
    occurrencesSinceDeploy: data.occurrencesSinceDeploy || 0,
    baselineOccurrences: data.baselineOccurrences,
    deployLabel: "version 2.3.2",
  });
}

describe("thresholds", () => {
  test("are pinned", () => {
    expect(FIX_PRODUCTION_THRESHOLDS).toEqual({
      rolloutGraceMinutes: 10,
      minWatchHours: 24,
      maxWatchDays: 7,
      minExpectedOccurrences: 3,
      maxDeployWaitDays: 14,
      baselineDays: 7,
    });
  });
});

describe("FixProductionStatus", () => {
  test("Verified, Regressed and Unverifiable are final; waiting and watching are not", () => {
    expect(
      Object.values(FixProductionStatus).filter(
        (status: FixProductionStatus) => {
          return FixProductionStatusHelper.isFinal(status);
        },
      ),
    ).toEqual([
      FixProductionStatus.Verified,
      FixProductionStatus.Regressed,
      FixProductionStatus.Unverifiable,
    ]);
    expect(FixProductionStatusHelper.isFinal(undefined)).toBe(false);
  });

  test("a stored value this server does not know is no status", () => {
    expect(FixProductionStatusHelper.fromDatabaseValue("Verified")).toBe(
      FixProductionStatus.Verified,
    );
    for (const value of ["verified", "Fixed", "", null, undefined, 3, {}]) {
      expect(
        FixProductionStatusHelper.fromDatabaseValue(value),
      ).toBeUndefined();
    }
  });

  test("the stored strings are a wire contract", () => {
    expect(Object.values(FixProductionStatus)).toEqual([
      "AwaitingDeploy",
      "Watching",
      "Verified",
      "Regressed",
      "Unverifiable",
    ]);
  });
});

describe("describing a deploy and a duration", () => {
  test("by its version, else its commit", () => {
    expect(describeDeploy({ version: "2.3.2", commitSha: FIX_SHA })).toBe(
      "version 2.3.2",
    );
    expect(describeDeploy({ commitSha: FIX_SHA })).toBe("commit 1a2b3c4");
    expect(describeDeploy({})).toBe("a deploy");
  });

  test("in minutes, hours or days", () => {
    expect(describeDuration(0)).toBe("1 minute");
    expect(describeDuration(25 * 60 * 1000)).toBe("25 minutes");
    expect(describeDuration(HOUR)).toBe("1 hour");
    expect(describeDuration(26 * HOUR)).toBe("26 hours");
    expect(describeDuration(72 * HOUR)).toBe("3 days");
  });
});

describe("whether a deploy contains the fix", () => {
  test("the same commit does, however abbreviated or written", () => {
    expect(
      deployContainsFix({ deployCommitSha: FIX_SHA, fixCommitSha: FIX_SHA }),
    ).toBe(true);
    expect(
      deployContainsFix({
        deployCommitSha: FIX_SHA.slice(0, 7),
        fixCommitSha: FIX_SHA,
      }),
    ).toBe(true);
    expect(
      deployContainsFix({
        deployCommitSha: FIX_SHA.toUpperCase(),
        fixCommitSha: FIX_SHA.slice(0, 10),
      }),
    ).toBe(true);
  });

  test("a later commit does, by GitHub's compare of the fix with it", () => {
    for (const compareStatus of ["ahead", "identical"]) {
      expect(
        deployContainsFix({
          deployCommitSha: "ffffffffffff",
          fixCommitSha: FIX_SHA,
          compareStatus,
        }),
      ).toBe(true);
    }
  });

  test("an older or unrelated commit does not, nor one GitHub could not compare", () => {
    for (const compareStatus of ["behind", "diverged", "", undefined]) {
      expect(
        deployContainsFix({
          deployCommitSha: "ffffffffffff",
          fixCommitSha: FIX_SHA,
          compareStatus,
        }),
      ).toBe(false);
    }
    expect(
      deployContainsFix({ deployCommitSha: "", fixCommitSha: FIX_SHA }),
    ).toBe(false);
  });
});

describe("waiting for the deploy that ships the fix", () => {
  const MERGED_AT: Date = new Date("2026-10-01T10:00:00.000Z");

  test("is waited for until the wait is over", () => {
    expect(
      decideDeployWait({
        mergedAt: MERGED_AT,
        now: new Date(
          MERGED_AT.getTime() +
            FIX_PRODUCTION_THRESHOLDS.maxDeployWaitDays * 24 * HOUR -
            1,
        ),
      }),
    ).toBeNull();
  });

  test("a fix no recorded deploy contained in time cannot be verified, and says how to make it so", () => {
    expect(
      decideDeployWait({
        mergedAt: MERGED_AT,
        now: new Date(
          MERGED_AT.getTime() +
            FIX_PRODUCTION_THRESHOLDS.maxDeployWaitDays * 24 * HOUR,
        ),
      }),
    ).toEqual({
      status: FixProductionStatus.Unverifiable,
      summary:
        "No recorded deploy of the service contained the fix in the 14 days after it merged. Record deploys with their commit (the oneuptime deploy command, or the vcs.ref.head.revision resource attribute) to verify fixes in production.",
    });
  });
});

describe("watching a deployed fix", () => {
  test("one occurrence in it is a regression, however soon", () => {
    expect(
      watch({
        now: new Date(DEPLOYED_AT.getTime() + 60 * 1000),
        occurrencesSinceDeploy: 1,
        baselineOccurrences: 500,
      }),
    ).toEqual({
      status: FixProductionStatus.Regressed,
      summary:
        "The exception happened once after version 2.3.2 shipped the fix, so the fix did not stop it.",
    });
    expect(
      watch({
        now: watched(100),
        occurrencesSinceDeploy: 12,
        baselineOccurrences: 0,
      }).summary,
    ).toBe(
      "The exception happened 12 times after version 2.3.2 shipped the fix, so the fix did not stop it.",
    );
  });

  test("a frequent exception gone for a day is fixed", () => {
    // 21 in 7 days is 3 a day: a quiet day would have held 3.
    expect(watch({ now: watched(24), baselineOccurrences: 21 })).toEqual({
      status: FixProductionStatus.Verified,
      summary:
        "No occurrence in the 24 hours since version 2.3.2 shipped the fix; before the fix it happened 21 times in 7 days.",
    });
  });

  test("never in less than a day, however frequent it was", () => {
    expect(
      watch({ now: watched(23.9), baselineOccurrences: 10_000 }).status,
    ).toBe(FixProductionStatus.Watching);
  });

  test("the rollout grace is not watched time", () => {
    // A day after the deploy is ten minutes short of a watched day.
    expect(
      watch({
        now: new Date(DEPLOYED_AT.getTime() + 24 * HOUR),
        baselineOccurrences: 10_000,
      }).status,
    ).toBe(FixProductionStatus.Watching);
  });

  test("a rarer exception is watched until its absence would have held three", () => {
    // 14 in 7 days is 2 a day: three expected after 36 hours.
    expect(watch({ now: watched(35), baselineOccurrences: 14 }).status).toBe(
      FixProductionStatus.Watching,
    );
    expect(watch({ now: watched(36), baselineOccurrences: 14 }).status).toBe(
      FixProductionStatus.Verified,
    );
  });

  test("an exception too rare to tell is not verified, and says why", () => {
    const maxHours: number = FIX_PRODUCTION_THRESHOLDS.maxWatchDays * 24;

    expect(
      watch({ now: watched(maxHours - 1), baselineOccurrences: 2 }).status,
    ).toBe(FixProductionStatus.Watching);
    expect(watch({ now: watched(maxHours), baselineOccurrences: 2 })).toEqual({
      status: FixProductionStatus.Unverifiable,
      summary:
        "No occurrence in the 7 days since version 2.3.2 shipped the fix, but before the fix it happened 2 times in 7 days: too rare for its absence to show the fix works.",
    });
    expect(
      watch({ now: watched(maxHours), baselineOccurrences: 0 }).status,
    ).toBe(FixProductionStatus.Unverifiable);
  });

  test("while watching, says so in words that do not change from check to check", () => {
    const early: FixProductionVerdict = watch({
      now: watched(2),
      baselineOccurrences: 1,
    });
    const later: FixProductionVerdict = watch({
      now: watched(40),
      baselineOccurrences: 1,
    });

    expect(early).toEqual({
      status: FixProductionStatus.Watching,
      summary:
        "Version 2.3.2 shipped the fix, and the exception has not happened since; before the fix it happened once in 7 days.",
    });
    expect(later).toEqual(early);
  });
});

describe("what a merged fix records", () => {
  const NOW: Date = new Date("2026-10-20T10:00:00.000Z");
  const MERGED_AT: Date = new Date("2026-10-20T09:58:00.000Z");

  test("a fix of an exception: its merge, and the start of its watch", () => {
    expect(
      fieldsWhenMerged({
        mergeCommitSha: FIX_SHA,
        mergedAt: MERGED_AT,
        isExceptionFix: true,
        now: NOW,
      }),
    ).toEqual({
      mergedAt: MERGED_AT,
      mergeCommitSha: FIX_SHA,
      productionStatus: FixProductionStatus.AwaitingDeploy,
      productionStatusAt: NOW,
      productionSummary:
        "Merged. Waiting for a recorded deploy of the service that contains the fix.",
    });
  });

  test("any other fix: only its merge, which production says nothing about", () => {
    const fields: FixMergedFields = fieldsWhenMerged({
      mergeCommitSha: FIX_SHA,
      mergedAt: MERGED_AT,
      isExceptionFix: false,
      now: NOW,
    });

    expect(fields).toEqual({ mergedAt: MERGED_AT, mergeCommitSha: FIX_SHA });
  });

  test("without GitHub's time or commit: now, and no commit", () => {
    expect(fieldsWhenMerged({ isExceptionFix: false, now: NOW })).toEqual({
      mergedAt: NOW,
    });
  });
});
