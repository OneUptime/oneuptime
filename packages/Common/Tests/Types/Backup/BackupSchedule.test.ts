import { describe, expect, test } from "@jest/globals";
import {
  AllBackupFrequencies,
  BackupFrequency,
  BackupSchedule,
  DEFAULT_BACKUP_DAY_OF_WEEK,
  DEFAULT_BACKUP_FREQUENCY,
  DEFAULT_BACKUP_RETENTION_IN_DAYS,
  DEFAULT_BACKUP_TIME_OF_DAY,
  MAX_BACKUP_RETENTION_IN_DAYS,
  MIN_BACKUP_RETENTION_IN_DAYS,
  formatBackupTimeOfDay,
  getBackupIntervalInHours,
  getBackupIntervalInMs,
  getNextBackupAt,
  isBackupDayOfWeek,
  isBackupFrequency,
  parseBackupTimeOfDay,
} from "../../../Types/Backup/BackupSchedule";

/*
 * When the instance's backups run: the arithmetic the scheduler asks after
 * every backup, in UTC, to the minute. Each case names the moment it asks
 * from and the moment it expects, so a wrong answer reads as one.
 */

function next(schedule: Partial<BackupSchedule>, after: string): string {
  return getNextBackupAt(
    {
      frequency: DEFAULT_BACKUP_FREQUENCY,
      timeOfDay: DEFAULT_BACKUP_TIME_OF_DAY,
      dayOfWeek: DEFAULT_BACKUP_DAY_OF_WEEK,
      ...schedule,
    } as BackupSchedule,
    new Date(after),
  ).toISOString();
}

describe("BackupSchedule", () => {
  test("the defaults are every day at 02:00 UTC, kept 30 days, weekly on Sunday", () => {
    expect(DEFAULT_BACKUP_FREQUENCY).toBe(BackupFrequency.Daily);
    expect(DEFAULT_BACKUP_TIME_OF_DAY).toBe("02:00");
    expect(DEFAULT_BACKUP_DAY_OF_WEEK).toBe(0);
    expect(DEFAULT_BACKUP_RETENTION_IN_DAYS).toBe(30);
    expect(MIN_BACKUP_RETENTION_IN_DAYS).toBe(1);
    expect(MAX_BACKUP_RETENTION_IN_DAYS).toBe(3650);
  });

  test("knows its five frequencies, and nothing else", () => {
    expect(AllBackupFrequencies).toEqual([
      "every-hour",
      "every-6-hours",
      "every-12-hours",
      "daily",
      "weekly",
    ]);

    for (const frequency of AllBackupFrequencies) {
      expect(isBackupFrequency(frequency)).toBe(true);
    }

    for (const value of ["hourly", "Daily", "", null, undefined, 1, {}]) {
      expect(isBackupFrequency(value)).toBe(false);
    }
  });

  describe("times of day", () => {
    test.each<[string, { hours: number; minutes: number }]>([
      ["02:00", { hours: 2, minutes: 0 }],
      ["2:00", { hours: 2, minutes: 0 }],
      ["00:00", { hours: 0, minutes: 0 }],
      ["23:59", { hours: 23, minutes: 59 }],
      [" 14:30 ", { hours: 14, minutes: 30 }],
    ])(
      "%s reads as a time",
      (text: string, expected: { hours: number; minutes: number }) => {
        expect(parseBackupTimeOfDay(text)).toEqual(expected);
      },
    );

    test.each([
      "24:00",
      "12:60",
      "7:5",
      "07:05:00",
      "0700",
      "-1:00",
      "ab:cd",
      "",
      "123:00",
      "12:5a",
    ])("%s is not a time", (text: string) => {
      expect(parseBackupTimeOfDay(text)).toBeNull();
    });

    test("anything but text is not a time", () => {
      expect(parseBackupTimeOfDay(undefined)).toBeNull();
      expect(parseBackupTimeOfDay(null)).toBeNull();
    });

    test("is written with two-digit hours and minutes", () => {
      expect(formatBackupTimeOfDay({ hours: 2, minutes: 5 })).toBe("02:05");
      expect(formatBackupTimeOfDay({ hours: 23, minutes: 0 })).toBe("23:00");
    });
  });

  test("a day of the week is a whole number from 0 (Sunday) to 6 (Saturday)", () => {
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      expect(isBackupDayOfWeek(day)).toBe(true);
    }

    for (const value of [-1, 7, 1.5, "1", null, undefined, NaN]) {
      expect(isBackupDayOfWeek(value)).toBe(false);
    }
  });

  describe("the next backup", () => {
    test.each<[string, string, string]>([
      // Daily at 02:00.
      [
        "before the time, the same day",
        "2026-10-24T01:59:00.000Z",
        "2026-10-24T02:00:00.000Z",
      ],
      [
        "exactly at the time, the next day",
        "2026-10-24T02:00:00.000Z",
        "2026-10-25T02:00:00.000Z",
      ],
      [
        "a second past the time, the next day",
        "2026-10-24T02:00:01.000Z",
        "2026-10-25T02:00:00.000Z",
      ],
      [
        "late in the day, the next day",
        "2026-10-24T23:59:59.999Z",
        "2026-10-25T02:00:00.000Z",
      ],
      [
        "across a month's end",
        "2026-10-31T03:00:00.000Z",
        "2026-11-01T02:00:00.000Z",
      ],
      [
        "across a year's end",
        "2026-12-31T22:00:00.000Z",
        "2027-01-01T02:00:00.000Z",
      ],
      [
        "across a leap day",
        "2028-02-28T05:00:00.000Z",
        "2028-02-29T02:00:00.000Z",
      ],
    ])("daily: %s", (_case: string, after: string, expected: string) => {
      expect(next({ frequency: BackupFrequency.Daily }, after)).toBe(expected);
    });

    test("daily keeps UTC across a daylight saving change in Europe and the US", () => {
      // Clocks went back in Europe on 2026-10-25 and in the US on 2026-11-01.
      expect(
        next({ frequency: BackupFrequency.Daily }, "2026-10-25T00:30:00.000Z"),
      ).toBe("2026-10-25T02:00:00.000Z");
      expect(
        next({ frequency: BackupFrequency.Daily }, "2026-11-01T02:30:00.000Z"),
      ).toBe("2026-11-02T02:00:00.000Z");
    });

    test.each<[string, string, string]>([
      [
        "at the time's minute past the hour",
        "2026-10-24T10:14:00.000Z",
        "2026-10-24T10:30:00.000Z",
      ],
      [
        "exactly at it, an hour on",
        "2026-10-24T10:30:00.000Z",
        "2026-10-24T11:30:00.000Z",
      ],
      [
        "past it, the next hour",
        "2026-10-24T10:31:00.000Z",
        "2026-10-24T11:30:00.000Z",
      ],
      [
        "before the day's anchor",
        "2026-10-24T00:10:00.000Z",
        "2026-10-24T00:30:00.000Z",
      ],
      [
        "across midnight",
        "2026-10-24T23:45:00.000Z",
        "2026-10-25T00:30:00.000Z",
      ],
    ])("every hour: %s", (_case: string, after: string, expected: string) => {
      expect(
        next(
          { frequency: BackupFrequency.EveryHour, timeOfDay: "07:30" },
          after,
        ),
      ).toBe(expected);
    });

    test.each<[string, string, string]>([
      [
        "from the time, 6 hours apart (02:00, 08:00, 14:00, 20:00)",
        "2026-10-24T09:00:00.000Z",
        "2026-10-24T14:00:00.000Z",
      ],
      [
        "before the day's first",
        "2026-10-24T01:00:00.000Z",
        "2026-10-24T02:00:00.000Z",
      ],
      [
        "exactly at one, the next",
        "2026-10-24T08:00:00.000Z",
        "2026-10-24T14:00:00.000Z",
      ],
      [
        "after the last of the day, the next day's first",
        "2026-10-24T20:00:00.000Z",
        "2026-10-25T02:00:00.000Z",
      ],
    ])(
      "every 6 hours: %s",
      (_case: string, after: string, expected: string) => {
        expect(next({ frequency: BackupFrequency.Every6Hours }, after)).toBe(
          expected,
        );
      },
    );

    test("every 6 hours counts back from a late time too (21:00: 03:00, 09:00, 15:00, 21:00)", () => {
      expect(
        next(
          { frequency: BackupFrequency.Every6Hours, timeOfDay: "21:00" },
          "2026-10-24T01:00:00.000Z",
        ),
      ).toBe("2026-10-24T03:00:00.000Z");
      expect(
        next(
          { frequency: BackupFrequency.Every6Hours, timeOfDay: "21:00" },
          "2026-10-24T16:00:00.000Z",
        ),
      ).toBe("2026-10-24T21:00:00.000Z");
    });

    test.each<[string, string, string]>([
      [
        "from the time, 12 hours apart",
        "2026-10-24T03:00:00.000Z",
        "2026-10-24T14:00:00.000Z",
      ],
      [
        "exactly at one, the next",
        "2026-10-24T14:00:00.000Z",
        "2026-10-25T02:00:00.000Z",
      ],
      [
        "before the first",
        "2026-10-24T00:00:00.000Z",
        "2026-10-24T02:00:00.000Z",
      ],
    ])(
      "every 12 hours: %s",
      (_case: string, after: string, expected: string) => {
        expect(next({ frequency: BackupFrequency.Every12Hours }, after)).toBe(
          expected,
        );
      },
    );

    test.each<[string, number, string, string]>([
      // 2026-10-24 is a Saturday.
      [
        "Sunday from Saturday",
        0,
        "2026-10-24T12:00:00.000Z",
        "2026-10-25T02:00:00.000Z",
      ],
      [
        "Saturday, later the same day",
        6,
        "2026-10-24T01:00:00.000Z",
        "2026-10-24T02:00:00.000Z",
      ],
      [
        "Saturday, at the time: a week on",
        6,
        "2026-10-24T02:00:00.000Z",
        "2026-10-31T02:00:00.000Z",
      ],
      [
        "Saturday, after the time: a week on",
        6,
        "2026-10-24T12:00:00.000Z",
        "2026-10-31T02:00:00.000Z",
      ],
      [
        "Wednesday from Saturday",
        3,
        "2026-10-24T12:00:00.000Z",
        "2026-10-28T02:00:00.000Z",
      ],
      [
        "Friday, across a month's end",
        5,
        "2026-10-31T12:00:00.000Z",
        "2026-11-06T02:00:00.000Z",
      ],
    ])(
      "weekly: %s",
      (_case: string, dayOfWeek: number, after: string, expected: string) => {
        expect(
          next({ frequency: BackupFrequency.Weekly, dayOfWeek }, after),
        ).toBe(expected);
      },
    );

    test("is always to the minute, whatever the moment asked from", () => {
      for (const frequency of AllBackupFrequencies) {
        const at: Date = getNextBackupAt(
          { frequency, timeOfDay: "05:45", dayOfWeek: 2 },
          new Date("2026-10-24T13:27:41.512Z"),
        );

        expect(at.getUTCSeconds()).toBe(0);
        expect(at.getUTCMilliseconds()).toBe(0);
        expect(at.getTime()).toBeGreaterThan(
          new Date("2026-10-24T13:27:41.512Z").getTime(),
        );
      }
    });

    test("is never further away than the frequency's interval", () => {
      const after: Date = new Date("2026-10-24T13:27:41.512Z");

      for (const frequency of AllBackupFrequencies) {
        const at: Date = getNextBackupAt(
          { frequency, timeOfDay: "13:28", dayOfWeek: 6 },
          after,
        );

        expect(at.getTime() - after.getTime()).toBeLessThanOrEqual(
          getBackupIntervalInMs(frequency),
        );
      }
    });

    test("a time that does not parse runs at the default time, so a damaged setting never stops backups", () => {
      expect(
        next(
          { frequency: BackupFrequency.Daily, timeOfDay: "25:99" },
          "2026-10-24T12:00:00.000Z",
        ),
      ).toBe("2026-10-25T02:00:00.000Z");
    });

    test("a frequency it does not know runs daily", () => {
      expect(
        next(
          { frequency: "monthly" as BackupFrequency },
          "2026-10-24T12:00:00.000Z",
        ),
      ).toBe("2026-10-25T02:00:00.000Z");
    });

    test("a weekly day it does not know is Sunday", () => {
      expect(
        next(
          { frequency: BackupFrequency.Weekly, dayOfWeek: 9 },
          "2026-10-24T12:00:00.000Z",
        ),
      ).toBe("2026-10-25T02:00:00.000Z");
    });
  });

  test("the intervals: 1, 6 and 12 hours, a day and a week", () => {
    expect(getBackupIntervalInHours(BackupFrequency.EveryHour)).toBe(1);
    expect(getBackupIntervalInHours(BackupFrequency.Every6Hours)).toBe(6);
    expect(getBackupIntervalInHours(BackupFrequency.Every12Hours)).toBe(12);
    expect(getBackupIntervalInHours(BackupFrequency.Daily)).toBeNull();
    expect(getBackupIntervalInHours(BackupFrequency.Weekly)).toBeNull();

    const hour: number = 60 * 60 * 1000;

    expect(getBackupIntervalInMs(BackupFrequency.EveryHour)).toBe(hour);
    expect(getBackupIntervalInMs(BackupFrequency.Every6Hours)).toBe(6 * hour);
    expect(getBackupIntervalInMs(BackupFrequency.Every12Hours)).toBe(12 * hour);
    expect(getBackupIntervalInMs(BackupFrequency.Daily)).toBe(24 * hour);
    expect(getBackupIntervalInMs(BackupFrequency.Weekly)).toBe(7 * 24 * hour);
  });
});
