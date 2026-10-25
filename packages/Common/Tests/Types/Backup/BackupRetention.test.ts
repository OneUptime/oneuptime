import { describe, expect, test } from "@jest/globals";
import {
  BackupRetentionCandidate,
  BackupRetentionDecision,
  getBackupRetentionCutoff,
  selectBackupsToDelete,
} from "../../../Types/Backup/BackupRetention";
import {
  BackupRunKind,
  BackupRunStatus,
} from "../../../Types/Backup/BackupRunTypes";

/*
 * "Keep backups for N days": which backups the scheduler deletes after a
 * backup. Everything older than N days goes, oldest first - except the
 * newest backup that succeeded, a backup still being made, and one a
 * restore is reading.
 */

const NOW: Date = new Date("2026-10-24T02:30:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function backup(
  id: string,
  startedAt: Date,
  status: BackupRunStatus = BackupRunStatus.Succeeded,
  kind: BackupRunKind = BackupRunKind.Backup,
): BackupRetentionCandidate {
  return { id, startedAt, status, kind };
}

function decide(
  backups: Array<BackupRetentionCandidate>,
  retentionInDays: number,
  protectedIds?: Array<string>,
): BackupRetentionDecision {
  return selectBackupsToDelete({
    backups,
    retentionInDays,
    now: NOW,
    protectedIds,
  });
}

describe("selectBackupsToDelete", () => {
  test("deletes every backup older than the retention, oldest first, and keeps the rest", () => {
    const decision: BackupRetentionDecision = decide(
      [
        backup("day-1", daysAgo(1)),
        backup("day-45", daysAgo(45)),
        backup("day-31", daysAgo(31)),
        backup("day-29", daysAgo(29)),
        backup("day-60", daysAgo(60)),
      ],
      30,
    );

    expect(decision.deleteIds).toEqual(["day-60", "day-45", "day-31"]);
    expect(decision.keptNewestSucceededId).toBeNull();
  });

  test("a backup exactly as old as the retention is kept; a millisecond older goes", () => {
    const exactly: Date = daysAgo(30);

    expect(
      decide([backup("new", daysAgo(0)), backup("exactly", exactly)], 30)
        .deleteIds,
    ).toEqual([]);

    expect(
      decide(
        [
          backup("new", daysAgo(0)),
          backup("older", new Date(exactly.getTime() - 1)),
        ],
        30,
      ).deleteIds,
    ).toEqual(["older"]);
  });

  test("keeps the newest backup that succeeded however old it is, so backups that stopped never leave none", () => {
    const decision: BackupRetentionDecision = decide(
      [
        backup("oldest", daysAgo(90)),
        backup("newest-good", daysAgo(40)),
        backup("failed-later", daysAgo(35), BackupRunStatus.Failed),
      ],
      30,
    );

    expect(decision.deleteIds).toEqual(["oldest", "failed-later"]);
    expect(decision.keptNewestSucceededId).toBe("newest-good");
  });

  test("a failed backup never counts as the newest that succeeded", () => {
    const decision: BackupRetentionDecision = decide(
      [
        backup("good", daysAgo(50)),
        backup("failed", daysAgo(2), BackupRunStatus.Failed),
        backup("cancelled", daysAgo(1), BackupRunStatus.Cancelled),
      ],
      30,
    );

    expect(decision.deleteIds).toEqual([]);
    expect(decision.keptNewestSucceededId).toBe("good");
  });

  test("failed and cancelled backups older than the retention go too", () => {
    expect(
      decide(
        [
          backup("good", daysAgo(1)),
          backup("failed", daysAgo(10), BackupRunStatus.Failed),
          backup("cancelled", daysAgo(11), BackupRunStatus.Cancelled),
        ],
        7,
      ).deleteIds,
    ).toEqual(["cancelled", "failed"]);
  });

  test("never deletes a backup still queued or running, however old", () => {
    expect(
      decide(
        [
          backup("good", daysAgo(1)),
          backup("queued", daysAgo(40), BackupRunStatus.Queued),
          backup("running", daysAgo(40), BackupRunStatus.Running),
        ],
        30,
      ).deleteIds,
    ).toEqual([]);
  });

  test("never deletes a backup a restore is reading", () => {
    expect(
      decide(
        [
          backup("good", daysAgo(1)),
          backup("being-restored", daysAgo(40)),
          backup("old", daysAgo(41)),
        ],
        30,
        ["being-restored"],
      ).deleteIds,
    ).toEqual(["old"]);
  });

  test("leaves restores alone: they are not backups", () => {
    expect(
      decide(
        [
          backup("good", daysAgo(1)),
          backup(
            "restore",
            daysAgo(400),
            BackupRunStatus.Succeeded,
            BackupRunKind.Restore,
          ),
        ],
        30,
      ).deleteIds,
    ).toEqual([]);
  });

  test("a restore never counts as the newest backup that succeeded", () => {
    const decision: BackupRetentionDecision = decide(
      [
        backup("good", daysAgo(40)),
        backup(
          "restore",
          daysAgo(1),
          BackupRunStatus.Succeeded,
          BackupRunKind.Restore,
        ),
      ],
      30,
    );

    expect(decision.deleteIds).toEqual([]);
    expect(decision.keptNewestSucceededId).toBe("good");
  });

  test("a backup with no date is left alone", () => {
    expect(
      decide(
        [backup("good", daysAgo(1)), backup("no-date", new Date(Number.NaN))],
        30,
      ).deleteIds,
    ).toEqual([]);
  });

  test("a retention of one day keeps one day", () => {
    expect(
      decide(
        [
          backup("now", daysAgo(0)),
          backup("23-hours", new Date(NOW.getTime() - 23 * 60 * 60 * 1000)),
          backup("25-hours", new Date(NOW.getTime() - 25 * 60 * 60 * 1000)),
        ],
        1,
      ).deleteIds,
    ).toEqual(["25-hours"]);
  });

  test.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "a retention of %s reads as one day, never as none",
    (retentionInDays: number) => {
      expect(
        getBackupRetentionCutoff({ retentionInDays, now: NOW }).toISOString(),
      ).toBe(daysAgo(1).toISOString());
    },
  );

  test("a retention in parts of a day counts whole days", () => {
    expect(
      getBackupRetentionCutoff({
        retentionInDays: 7.9,
        now: NOW,
      }).toISOString(),
    ).toBe(daysAgo(7).toISOString());
  });

  test("with no backups there is nothing to delete", () => {
    expect(decide([], 30)).toEqual({
      deleteIds: [],
      keptNewestSucceededId: null,
    });
  });

  test("ten years of daily backups, kept for a year: 3,284 go and the year stays", () => {
    const backups: Array<BackupRetentionCandidate> = [];

    for (let day: number = 0; day < 3650; day++) {
      backups.push(backup(`day-${day}`, daysAgo(day)));
    }

    const decision: BackupRetentionDecision = decide(backups, 365);

    expect(decision.deleteIds).toHaveLength(3650 - 366);
    expect(decision.deleteIds[0]).toBe("day-3649");
    expect(decision.deleteIds).not.toContain("day-365");
    expect(decision.deleteIds).toContain("day-366");
  });
});
