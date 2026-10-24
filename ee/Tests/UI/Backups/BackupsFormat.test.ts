import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  canRestoreBackup,
  describeBackupContents,
  describeBackupCounts,
  describeBackupSchedule,
  describeUtcHourOption,
  formatBackupDateTime,
  formatBackupDuration,
  formatBackupSize,
  formatBackupTimeAgo,
  formatBackupTimeUntil,
  getBackupRunDurationInMs,
  getBackupRunProgress,
  getBackupRunStatusColor,
  getBackupRunTotalSize,
  getLocalTimeOfUtcHour,
  getNewestSucceededBackup,
  getWeekdayName,
  isBackupAtCurrentDestination,
  isClockOnUtc,
} from "../../../AdminDashboard/Backups/BackupFormat";
import { getBackupTimeOptions } from "../../../AdminDashboard/Backups/BackupSettingsFormModal";
import { describeStepFacts } from "../../../AdminDashboard/Backups/BackupRunStepsModal";
import { describeFindResult } from "../../../AdminDashboard/Backups/BackupsView";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import {
  BackupRunKind,
  BackupRunStatus,
  BackupStep,
  BackupStepKey,
  BackupStepStatus,
} from "Common/Types/Backup/BackupRunTypes";
import { BackupFrequency } from "Common/Types/Backup/BackupSchedule";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import { FeedClock } from "Common/UI/Components/Feed/FeedTime";
import {
  createTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * How the Backups page writes what it shows (BackupFormat and the few
 * helpers beside its components): sizes, durations and times in the
 * reader's language and zone, the schedule as a sentence, what a backup
 * holds, how far a run has got, and which backups can be restored.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const ADMIN_LOCALES: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

// The Admin Dashboard's own German, as the page reads it.
function translatorFor(language: string): Translator {
  const dictionary: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(ADMIN_LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;

  return createTranslator((key: string): string | undefined => {
    const value: unknown = dictionary[key];
    return typeof value === "string" ? value : undefined;
  }, language);
}

function clock(data: Partial<FeedClock> = {}): FeedClock {
  return {
    timezone: "UTC",
    language: "en",
    use12HourClock: false,
    now: new Date("2026-10-24T12:00:00Z"),
    ...data,
  };
}

function run(fields: Partial<Record<string, unknown>>): BackupRun {
  const item: BackupRun = new BackupRun();

  for (const key of Object.keys(fields)) {
    (item as unknown as Record<string, unknown>)[key] = fields[key];
  }

  return item;
}

describe("sizes", () => {
  test.each([
    [0, "0 byte"],
    [512, "512 byte"],
    [980 * 1024, "980 kB"],
    [4.1 * 1024 ** 2, "4.1 MB"],
    [2.2 * 1024 ** 3, "2.2 GB"],
    [12.4 * 1024 ** 3, "12 GB"],
    [1.5 * 1024 ** 4, "1.5 TB"],
  ])(
    "%d bytes read as %s: one decimal under 10 of a unit",
    (bytes: number, text: string) => {
      expect(formatBackupSize(bytes, "en")).toBe(text);
    },
  );

  test("in the reader's language, and never a negative or broken number", () => {
    expect(formatBackupSize(4.1 * 1024 ** 2, "de")).toBe("4,1 MB");
    expect(formatBackupSize(-5, "en")).toBe("0 byte");
    expect(formatBackupSize(Number.NaN, "en")).toBe("0 byte");
  });
});

describe("durations", () => {
  test.each([
    [6 * 1000, "6 seconds"],
    [200, "1 second"],
    [0, "1 second"],
    [12 * 60 * 1000, "12 minutes"],
    [125 * 60 * 1000, "2 hours"],
    [3 * 86400 * 1000, "3 days"],
  ])(
    "%d ms took %s: the unit that reads best, never 0",
    (ms: number, text: string) => {
      expect(formatBackupDuration(ms, "en")).toBe(text);
    },
  );

  test("in the reader's language", () => {
    expect(formatBackupDuration(12 * 60 * 1000, "de")).toBe("12 Minuten");
  });
});

describe("times", () => {
  const backupAt: Date = new Date("2026-10-24T02:00:00Z");

  test("a backup's time is the reader's zone, language and hour cycle", () => {
    expect(
      formatBackupDateTime(backupAt, clock({ use12HourClock: true })),
    ).toBe("Oct 24, 2026, 2:00 AM");
    expect(
      formatBackupDateTime(
        backupAt,
        clock({ timezone: "Europe/Berlin", language: "de" }),
      ),
    ).toBe("24. Okt. 2026, 4:00");
    expect(formatBackupDateTime(new Date("not a date"), clock())).toBe("");
  });

  test("how long ago, and how long until", () => {
    expect(formatBackupTimeAgo(backupAt, clock())).toBe("10 hours ago");
    expect(
      formatBackupTimeUntil(new Date("2026-10-25T02:00:00Z"), clock()),
    ).toBe("in 14 hours");
    expect(
      formatBackupTimeUntil(new Date("2026-10-24T12:03:00Z"), clock()),
    ).toBe("in 3 minutes");
    expect(
      formatBackupTimeUntil(new Date("2026-10-31T12:00:00Z"), clock()),
    ).toBe("in 7 days");
    // Due already: soon, never "in -2 minutes".
    expect(
      formatBackupTimeUntil(new Date("2026-10-24T11:58:00Z"), clock()),
    ).toBe("in 1 minute");
  });

  test("the weekday names are the reader's", () => {
    expect(getWeekdayName(0, "en")).toBe("Sunday");
    expect(getWeekdayName(6, "en")).toBe("Saturday");
    expect(getWeekdayName(0, "de")).toBe("Sonntag");
  });
});

describe("the time to back up at, a UTC hour with the reader's own time beside it", () => {
  const berlinSummer: FeedClock = clock({
    timezone: "Europe/Berlin",
    now: new Date("2026-07-01T12:00:00Z"),
  });

  test("02:00 UTC is 04:00 in Berlin in summer", () => {
    expect(getLocalTimeOfUtcHour({ hour: 2, clock: berlinSummer })).toBe(
      "04:00",
    );
    expect(
      describeUtcHourOption({
        hour: 2,
        clock: berlinSummer,
        translator: ENGLISH,
      }),
    ).toBe("02:00 UTC (04:00 your time)");
  });

  test("a reader whose clock is UTC's sees the UTC time alone", () => {
    const londonWinter: FeedClock = clock({
      timezone: "Europe/London",
      now: new Date("2026-01-15T12:00:00Z"),
    });

    expect(isClockOnUtc(londonWinter)).toBe(true);
    expect(
      isClockOnUtc(clock({ timezone: "Europe/London", now: berlinSummer.now })),
    ).toBe(false);
    expect(
      describeUtcHourOption({
        hour: 2,
        clock: londonWinter,
        translator: ENGLISH,
      }),
    ).toBe("02:00 UTC");
  });

  test("the dropdown offers the 24 whole hours, and keeps a saved time that is not one", () => {
    const options: ReturnType<typeof getBackupTimeOptions> =
      getBackupTimeOptions({ translator: ENGLISH });

    expect(options).toHaveLength(24);
    expect(options[0]!.value).toBe("00:00");
    expect(options[23]!.value).toBe("23:00");

    const withSaved: ReturnType<typeof getBackupTimeOptions> =
      getBackupTimeOptions({ translator: ENGLISH, savedTimeOfDay: "02:30" });

    expect(withSaved).toHaveLength(25);
    // Between 02:00 and 03:00, where it belongs.
    expect(withSaved[3]).toEqual({ value: "02:30", label: "02:30 UTC" });
    expect(
      getBackupTimeOptions({ translator: ENGLISH, savedTimeOfDay: "04:00" }),
    ).toHaveLength(24);
  });
});

describe("the schedule, in words", () => {
  test.each([
    [
      { frequency: BackupFrequency.Daily, timeOfDay: "02:00" },
      "Every day at 02:00 UTC",
    ],
    [
      { frequency: BackupFrequency.Every6Hours, timeOfDay: "01:00" },
      "Every 6 hours at 01:00 UTC",
    ],
    [
      { frequency: BackupFrequency.Every12Hours, timeOfDay: "00:00" },
      "Every 12 hours at 00:00 UTC",
    ],
    [
      { frequency: BackupFrequency.Weekly, timeOfDay: "03:30", dayOfWeek: 0 },
      "Every Sunday at 03:30 UTC",
    ],
    [
      { frequency: BackupFrequency.EveryHour, timeOfDay: "02:00" },
      "Every hour",
    ],
    // Settings that say nothing usable read as the default.
    [{ frequency: undefined, timeOfDay: "25:99" }, "Every day at 02:00 UTC"],
  ])("%j: %s", (schedule: Record<string, unknown>, text: string) => {
    expect(
      describeBackupSchedule({
        schedule: schedule as Parameters<
          typeof describeBackupSchedule
        >[0]["schedule"],
        translator: ENGLISH,
      }),
    ).toBe(text);
  });

  test("in the reader's language, the weekday included", () => {
    const german: Translator = translatorFor("de");

    expect(
      describeBackupSchedule({
        schedule: {
          frequency: BackupFrequency.Weekly,
          timeOfDay: "03:00",
          dayOfWeek: 1,
        },
        translator: german,
      }),
    ).toContain("Montag");
    expect(
      describeBackupSchedule({
        schedule: { frequency: BackupFrequency.Daily, timeOfDay: "02:00" },
        translator: german,
      }),
    ).not.toContain("Every");
  });
});

describe("a run's status, duration and size", () => {
  test("green for a backup that succeeded, red for one that failed, yellow while it runs", () => {
    expect(getBackupRunStatusColor(BackupRunStatus.Succeeded)).toBe(Green);
    expect(getBackupRunStatusColor(BackupRunStatus.Failed)).toBe(Red);
    expect(getBackupRunStatusColor(BackupRunStatus.Running)).toBe(Yellow);
    expect(getBackupRunStatusColor(BackupRunStatus.Queued)).toBe(Yellow);
    expect(getBackupRunStatusColor(BackupRunStatus.Cancelled)).toBe(Gray500);
  });

  test("a finished run took start to finish; a running one, start to now", () => {
    const now: Date = new Date("2026-10-24T02:10:00Z");

    expect(
      getBackupRunDurationInMs(
        run({
          startedAt: new Date("2026-10-24T02:00:00Z"),
          finishedAt: new Date("2026-10-24T02:04:00Z"),
        }),
        now,
      ),
    ).toBe(4 * 60 * 1000);
    expect(
      getBackupRunDurationInMs(
        run({ startedAt: new Date("2026-10-24T02:00:00Z") }),
        now,
      ),
    ).toBe(10 * 60 * 1000);
    expect(getBackupRunDurationInMs(run({}), now)).toBeNull();
  });

  test("a backup's size is both databases'", () => {
    expect(
      getBackupRunTotalSize(
        run({ postgresSizeInBytes: 1000, clickhouseSizeInBytes: 250 }),
      ),
    ).toBe(1250);
    expect(getBackupRunTotalSize(run({ postgresSizeInBytes: 1000 }))).toBe(
      1000,
    );
  });

  test("what a backup holds, with each database's size", () => {
    expect(
      describeBackupContents({
        run: run({
          includesPostgres: true,
          includesClickhouse: true,
          postgresSizeInBytes: 4.1 * 1024 ** 2,
          clickhouseSizeInBytes: 2.2 * 1024 ** 2,
        }),
        translator: ENGLISH,
      }),
    ).toEqual([
      { title: "PostgreSQL", size: "4.1 MB" },
      { title: "ClickHouse", size: "2.2 MB" },
    ]);
    expect(
      describeBackupContents({
        run: run({ includesClickhouse: false }),
        translator: ENGLISH,
      }),
    ).toEqual([{ title: "PostgreSQL", size: "" }]);
  });
});

describe("what a PostgreSQL backup holds, for the restore dialog", () => {
  test("the records people recognise, as a list in the reader's language", () => {
    expect(
      describeBackupCounts({
        counts: { projects: 3, users: 12, monitors: 140 },
        translator: ENGLISH,
      }),
    ).toBe("3 projects, 12 users, and 140 monitors");
    expect(
      describeBackupCounts({
        counts: { projects: 1, statusPages: 1 },
        translator: ENGLISH,
      }),
    ).toBe("1 project and 1 status page");
  });

  test("nothing counted says nothing", () => {
    expect(describeBackupCounts({ counts: {}, translator: ENGLISH })).toBe("");
    expect(describeBackupCounts({ counts: null, translator: ENGLISH })).toBe(
      "",
    );
  });

  test("in German, from the Admin Dashboard's locale", () => {
    const text: string = describeBackupCounts({
      counts: { projects: 3, users: 1 },
      translator: translatorFor("de"),
    });

    expect(text).toContain("3");
    expect(text).not.toContain("projects");
    expect(text).not.toContain("user");
  });
});

describe("how far a running run has got", () => {
  function steps(...list: Array<Partial<BackupStep>>): Array<BackupStep> {
    return list as Array<BackupStep>;
  }

  test("the step it is on, counting only the steps it takes", () => {
    const progress: ReturnType<typeof getBackupRunProgress> =
      getBackupRunProgress(
        run({
          steps: steps(
            {
              key: BackupStepKey.CheckDestination,
              status: BackupStepStatus.Succeeded,
            },
            {
              key: BackupStepKey.BackUpPostgres,
              status: BackupStepStatus.Running,
              progress: { doneBytes: 50, totalBytes: 100 },
            },
            {
              key: BackupStepKey.BackUpClickhouse,
              status: BackupStepStatus.Skipped,
            },
            {
              key: BackupStepKey.VerifyBackup,
              status: BackupStepStatus.Pending,
            },
            {
              key: BackupStepKey.DeleteOldBackups,
              status: BackupStepStatus.Pending,
            },
          ),
        }),
      );

    expect(progress.total).toBe(4);
    expect(progress.number).toBe(2);
    expect(progress.step?.key).toBe(BackupStepKey.BackUpPostgres);
    // A database's size on disk says nothing of how big its dump gets.
    expect(progress.percent).toBeNull();
  });

  test("a restore's copy from the destination knows its total: a percent, never above 100", () => {
    const progress: ReturnType<typeof getBackupRunProgress> =
      getBackupRunProgress(
        run({
          steps: steps(
            {
              key: BackupStepKey.CheckBackup,
              status: BackupStepStatus.Succeeded,
            },
            {
              key: BackupStepKey.RestorePostgres,
              status: BackupStepStatus.Running,
              progress: { doneBytes: 30, totalBytes: 120 },
            },
          ),
        }),
      );

    expect(progress.percent).toBe(25);
    expect(
      getBackupRunProgress(
        run({
          steps: steps({
            key: BackupStepKey.RestorePostgres,
            status: BackupStepStatus.Running,
            progress: { doneBytes: 130, totalBytes: 120 },
          }),
        }),
      ).percent,
    ).toBe(100);
  });

  test("no steps yet: step 1 of none, nothing to show", () => {
    expect(getBackupRunProgress(run({}))).toEqual({
      total: 0,
      number: 1,
      step: undefined,
      percent: null,
    });
  });

  test("a step's facts: how long it took, what it wrote, how many files", () => {
    const now: Date = new Date("2026-10-24T02:05:00Z");

    expect(
      describeStepFacts({
        step: {
          key: BackupStepKey.BackUpPostgres,
          status: BackupStepStatus.Succeeded,
          startedAt: "2026-10-24T02:00:00Z",
          finishedAt: "2026-10-24T02:00:06Z",
          progress: { doneBytes: 4.1 * 1024 ** 2, totalBytes: 9 * 1024 ** 2 },
        },
        translator: ENGLISH,
        now,
      }),
    ).toEqual(["6 seconds", "4.1 MB"]);
    expect(
      describeStepFacts({
        step: {
          key: BackupStepKey.RestorePostgres,
          status: BackupStepStatus.Running,
          startedAt: "2026-10-24T02:03:00Z",
          progress: { doneBytes: 2 * 1024 ** 2, totalBytes: 8 * 1024 ** 2 },
        },
        translator: ENGLISH,
        now,
      }),
    ).toEqual(["2 minutes", "2 MB of 8 MB"]);
    // A dump in progress: what is written, not "of" the database's size.
    expect(
      describeStepFacts({
        step: {
          key: BackupStepKey.BackUpPostgres,
          status: BackupStepStatus.Running,
          startedAt: "2026-10-24T02:04:00Z",
          progress: { doneBytes: 2 * 1024 ** 2, totalBytes: 8 * 1024 ** 2 },
        },
        translator: ENGLISH,
        now,
      }),
    ).toEqual(["1 minute", "2 MB"]);
    expect(
      describeStepFacts({
        step: {
          key: BackupStepKey.BackUpClickhouse,
          status: BackupStepStatus.Succeeded,
          startedAt: "2026-10-24T02:01:00Z",
          finishedAt: "2026-10-24T02:03:00Z",
          progress: { doneFiles: 1 },
        },
        translator: ENGLISH,
        now,
      }),
    ).toEqual(["2 minutes", "1 file"]);
    // A skipped step took no time.
    expect(
      describeStepFacts({
        step: {
          key: BackupStepKey.BackUpClickhouse,
          status: BackupStepStatus.Skipped,
          startedAt: "2026-10-24T02:01:00Z",
          finishedAt: "2026-10-24T02:01:00Z",
        },
        translator: ENGLISH,
        now,
      }),
    ).toEqual([]);
  });
});

describe("which backups can be restored", () => {
  const FINGERPRINT: string =
    "s3-compatible:minio.acme.internal:9000/oneuptime-backups/prod/";

  test("a backup that succeeded, at the destination set now", () => {
    const backup: BackupRun = run({
      kind: BackupRunKind.Backup,
      status: BackupRunStatus.Succeeded,
      destinationFingerprint: FINGERPRINT,
    });

    expect(
      isBackupAtCurrentDestination({
        run: backup,
        currentFingerprint: FINGERPRINT,
      }),
    ).toBe(true);
    expect(
      canRestoreBackup({ run: backup, currentFingerprint: FINGERPRINT }),
    ).toBe(true);
  });

  test("never one at a previous destination, one that failed, or a restore", () => {
    expect(
      canRestoreBackup({
        run: run({
          kind: BackupRunKind.Backup,
          status: BackupRunStatus.Succeeded,
          destinationFingerprint: "s3:old-bucket/",
        }),
        currentFingerprint: FINGERPRINT,
      }),
    ).toBe(false);
    expect(
      canRestoreBackup({
        run: run({
          kind: BackupRunKind.Backup,
          status: BackupRunStatus.Failed,
          destinationFingerprint: FINGERPRINT,
        }),
        currentFingerprint: FINGERPRINT,
      }),
    ).toBe(false);
    expect(
      canRestoreBackup({
        run: run({
          kind: BackupRunKind.Restore,
          status: BackupRunStatus.Succeeded,
          destinationFingerprint: FINGERPRINT,
        }),
        currentFingerprint: FINGERPRINT,
      }),
    ).toBe(false);
    // No destination set now: nothing is where it is.
    expect(
      isBackupAtCurrentDestination({
        run: run({ destinationFingerprint: FINGERPRINT }),
        currentFingerprint: null,
      }),
    ).toBe(false);
  });

  test("the newest backup that succeeded, among the rows", () => {
    const older: BackupRun = run({
      _id: new ObjectID("11111111-1111-4111-8111-111111111111").toString(),
      kind: BackupRunKind.Backup,
      status: BackupRunStatus.Succeeded,
      startedAt: new Date("2026-10-22T02:00:00Z"),
    });
    const newer: BackupRun = run({
      _id: new ObjectID("22222222-2222-4222-8222-222222222222").toString(),
      kind: BackupRunKind.Backup,
      status: BackupRunStatus.Succeeded,
      startedAt: new Date("2026-10-23T02:00:00Z"),
    });

    expect(
      getNewestSucceededBackup([
        older,
        newer,
        run({
          kind: BackupRunKind.Backup,
          status: BackupRunStatus.Failed,
          startedAt: new Date("2026-10-24T02:00:00Z"),
        }),
        run({
          kind: BackupRunKind.Restore,
          status: BackupRunStatus.Succeeded,
          startedAt: new Date("2026-10-24T03:00:00Z"),
        }),
      ]),
    ).toBe(newer);
    expect(getNewestSucceededBackup([])).toBeNull();
  });
});

describe("what Find backups found", () => {
  test("how many are at the destination, and how many the list did not have", () => {
    expect(
      describeFindResult({
        result: { found: 3, added: 2, updated: 0, removed: 0 },
        translator: ENGLISH,
      }),
    ).toBe("Found 3 backups at the destination. 2 were new to this list.");
    expect(
      describeFindResult({
        result: { found: 1, added: 1, updated: 0, removed: 0 },
        translator: ENGLISH,
      }),
    ).toBe("Found 1 backup at the destination. 1 was new to this list.");
    expect(
      describeFindResult({
        result: { found: 4, added: 0, updated: 4, removed: 0 },
        translator: ENGLISH,
      }),
    ).toBe("Found 4 backups at the destination.");
    expect(
      describeFindResult({
        result: { found: 0, added: 0, updated: 0, removed: 0 },
        translator: ENGLISH,
      }),
    ).toBe("Found no backups at the destination.");
  });
});
