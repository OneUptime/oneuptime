import { describe, expect, test } from "@jest/globals";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import {
  CLOUD_OFF_HOURS_DEFAULT_DAYS,
  CLOUD_OFF_HOURS_DEFAULT_START,
  CLOUD_OFF_HOURS_DEFAULT_STOP,
  CLOUD_OFF_HOURS_WEEK,
  CloudOffHoursHours,
  getCloudOffHoursScheduleProblem,
  getNextCloudOffHoursChange,
  isCloudOffHoursDay,
  isKnownCloudOffHoursTimezone,
  isWithinCloudWorkingHours,
  readCloudOffHoursClock,
  readCloudOffHoursDays,
} from "../../../Types/Cloud/CloudOffHours";

/*
 * WHEN AN OFF-HOURS SCHEDULE'S RESOURCES RUN (#11010): on the zone's own
 * clock, across a change of the clocks, overnight, and never stopping on a
 * schedule whose hours do not read.
 *
 * The week of 23 March 2026: Monday the 23rd in Berlin is on CET (UTC+1);
 * the clocks go forward on Sunday the 29th, so Monday the 30th is on CEST
 * (UTC+2).
 */

const BERLIN_OFFICE: CloudOffHoursHours = {
  timezone: "Europe/Berlin",
  workingDays: [...CLOUD_OFF_HOURS_DEFAULT_DAYS],
  startTime: "08:00",
  stopTime: "19:00",
};

const at: (iso: string) => Date = (iso: string): Date => {
  return new Date(iso);
};

describe("readCloudOffHoursClock", () => {
  test("reads a 24-hour clock as minutes after midnight", () => {
    expect(readCloudOffHoursClock("00:00")).toBe(0);
    expect(readCloudOffHoursClock("08:00")).toBe(480);
    expect(readCloudOffHoursClock(" 19:30 ")).toBe(1170);
    expect(readCloudOffHoursClock("23:59")).toBe(1439);
  });

  test("refuses what is not one", () => {
    for (const value of ["8:00", "24:00", "08:60", "8am", "", "08:00:00"]) {
      expect(readCloudOffHoursClock(value)).toBeNull();
    }

    for (const value of [480, null, undefined, {}]) {
      expect(readCloudOffHoursClock(value)).toBeNull();
    }
  });
});

describe("the days and zone a schedule names", () => {
  test("reads the days it names, and the working week when it names none", () => {
    expect(
      readCloudOffHoursDays([DayOfWeek.Saturday, "Funday", DayOfWeek.Sunday]),
    ).toEqual([DayOfWeek.Saturday, DayOfWeek.Sunday]);
    expect(readCloudOffHoursDays([])).toEqual(CLOUD_OFF_HOURS_DEFAULT_DAYS);
    expect(readCloudOffHoursDays("Monday")).toEqual(
      CLOUD_OFF_HOURS_DEFAULT_DAYS,
    );
    expect(isCloudOffHoursDay("Monday")).toBe(true);
    expect(isCloudOffHoursDay("monday")).toBe(false);
  });

  test("the week reads Monday first, every day once", () => {
    expect(CLOUD_OFF_HOURS_WEEK[0]).toBe(DayOfWeek.Monday);
    expect(new Set(CLOUD_OFF_HOURS_WEEK).size).toBe(7);
    expect(CLOUD_OFF_HOURS_DEFAULT_START).toBe("08:00");
    expect(CLOUD_OFF_HOURS_DEFAULT_STOP).toBe("19:00");
  });

  test("knows a zone by its name", () => {
    expect(isKnownCloudOffHoursTimezone("Europe/Berlin")).toBe(true);
    expect(isKnownCloudOffHoursTimezone("UTC")).toBe(true);
    expect(isKnownCloudOffHoursTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isKnownCloudOffHoursTimezone(undefined)).toBe(false);
  });
});

describe("isWithinCloudWorkingHours", () => {
  test("runs from the start to the stop of a working day, on the zone's clock", () => {
    // Monday 23 March 2026, CET: 08:00 in Berlin is 07:00 UTC.
    expect(
      isWithinCloudWorkingHours(BERLIN_OFFICE, at("2026-03-23T06:59:00Z")),
    ).toBe(false);
    expect(
      isWithinCloudWorkingHours(BERLIN_OFFICE, at("2026-03-23T07:00:00Z")),
    ).toBe(true);
    expect(
      isWithinCloudWorkingHours(BERLIN_OFFICE, at("2026-03-23T17:59:00Z")),
    ).toBe(true);
    expect(
      isWithinCloudWorkingHours(BERLIN_OFFICE, at("2026-03-23T18:00:00Z")),
    ).toBe(false);
  });

  test("keeps 08:00 at 08:00 after the clocks go forward", () => {
    // Monday 30 March 2026, CEST: 08:00 in Berlin is 06:00 UTC.
    expect(
      isWithinCloudWorkingHours(BERLIN_OFFICE, at("2026-03-30T05:59:00Z")),
    ).toBe(false);
    expect(
      isWithinCloudWorkingHours(BERLIN_OFFICE, at("2026-03-30T06:00:00Z")),
    ).toBe(true);
    expect(
      isWithinCloudWorkingHours(BERLIN_OFFICE, at("2026-03-30T16:59:00Z")),
    ).toBe(true);
    expect(
      isWithinCloudWorkingHours(BERLIN_OFFICE, at("2026-03-30T17:00:00Z")),
    ).toBe(false);
  });

  test("stays stopped all day on a day that is not a working day", () => {
    // Saturday 28 and Sunday 29 March, at noon in Berlin.
    expect(
      isWithinCloudWorkingHours(BERLIN_OFFICE, at("2026-03-28T11:00:00Z")),
    ).toBe(false);
    expect(
      isWithinCloudWorkingHours(BERLIN_OFFICE, at("2026-03-29T10:00:00Z")),
    ).toBe(false);
  });

  test("reads the day in the zone, not in UTC", () => {
    const sydney: CloudOffHoursHours = {
      ...BERLIN_OFFICE,
      timezone: "Australia/Sydney",
    };

    // Sunday 22 March 23:00 UTC is Monday 10:00 in Sydney (AEDT, UTC+11).
    expect(isWithinCloudWorkingHours(sydney, at("2026-03-22T23:00:00Z"))).toBe(
      true,
    );
    // Friday 27 March 23:00 UTC is Saturday 10:00 in Sydney.
    expect(isWithinCloudWorkingHours(sydney, at("2026-03-27T23:00:00Z"))).toBe(
      false,
    );
  });

  test("hours that run overnight belong to the day they start", () => {
    const fridayNights: CloudOffHoursHours = {
      timezone: "UTC",
      workingDays: [DayOfWeek.Friday],
      startTime: "20:00",
      stopTime: "06:00",
    };

    expect(
      isWithinCloudWorkingHours(fridayNights, at("2026-03-27T02:00:00Z")),
    ).toBe(false);
    expect(
      isWithinCloudWorkingHours(fridayNights, at("2026-03-27T21:00:00Z")),
    ).toBe(true);
    // Saturday 02:00 is Friday's night.
    expect(
      isWithinCloudWorkingHours(fridayNights, at("2026-03-28T02:00:00Z")),
    ).toBe(true);
    expect(
      isWithinCloudWorkingHours(fridayNights, at("2026-03-28T06:00:00Z")),
    ).toBe(false);
    expect(
      isWithinCloudWorkingHours(fridayNights, at("2026-03-26T22:00:00Z")),
    ).toBe(false);
  });

  test("hours that do not read run all the time: a schedule never stops on a typo", () => {
    const now: Date = at("2026-03-28T03:00:00Z");

    for (const broken of [
      { ...BERLIN_OFFICE, startTime: "8am" },
      { ...BERLIN_OFFICE, stopTime: "" },
      { ...BERLIN_OFFICE, stopTime: "08:00" },
      { ...BERLIN_OFFICE, timezone: "Mars/Olympus_Mons" },
    ]) {
      expect(isWithinCloudWorkingHours(broken, now)).toBe(true);
      expect(getNextCloudOffHoursChange(broken, now)).toBeNull();
    }
  });
});

describe("getNextCloudOffHoursChange", () => {
  test("while resources run, the next change is this evening's stop", () => {
    expect(
      getNextCloudOffHoursChange(BERLIN_OFFICE, at("2026-03-23T09:00:00Z")),
    ).toEqual({ at: at("2026-03-23T18:00:00Z"), running: false });
  });

  test("on a Friday evening, the next change is Monday's start, across the clocks going forward", () => {
    // Friday 27 March 20:00 CET; Monday 30 March 08:00 CEST is 06:00 UTC.
    expect(
      getNextCloudOffHoursChange(BERLIN_OFFICE, at("2026-03-27T19:00:00Z")),
    ).toEqual({ at: at("2026-03-30T06:00:00Z"), running: true });
  });

  test("before a working day starts, the next change is its start", () => {
    expect(
      getNextCloudOffHoursChange(BERLIN_OFFICE, at("2026-03-24T05:00:00Z")),
    ).toEqual({ at: at("2026-03-24T07:00:00Z"), running: true });
  });

  test("at the very moment of a stop, the next change is the next start", () => {
    expect(
      getNextCloudOffHoursChange(BERLIN_OFFICE, at("2026-03-24T18:00:00Z")),
    ).toEqual({ at: at("2026-03-25T07:00:00Z"), running: true });
  });

  test("overnight hours stop the morning after", () => {
    const fridayNights: CloudOffHoursHours = {
      timezone: "UTC",
      workingDays: [DayOfWeek.Friday],
      startTime: "20:00",
      stopTime: "06:00",
    };

    expect(
      getNextCloudOffHoursChange(fridayNights, at("2026-03-28T02:00:00Z")),
    ).toEqual({ at: at("2026-03-28T06:00:00Z"), running: false });
    expect(
      getNextCloudOffHoursChange(fridayNights, at("2026-03-28T07:00:00Z")),
    ).toEqual({ at: at("2026-04-03T20:00:00Z"), running: true });
  });
});

describe("getCloudOffHoursScheduleProblem", () => {
  test("a schedule as the form writes it can be saved", () => {
    expect(
      getCloudOffHoursScheduleProblem({
        timezone: "Europe/Berlin",
        workingDays: [DayOfWeek.Monday, DayOfWeek.Friday],
        startTime: "08:00",
        stopTime: "19:00",
        tagKey: "Schedule",
        tagValue: "office-hours",
      }),
    ).toBeNull();
    // An update names only what it changes.
    expect(getCloudOffHoursScheduleProblem({ stopTime: "20:00" })).toBeNull();
  });

  test("refuses a zone it does not know", () => {
    expect(getCloudOffHoursScheduleProblem({ timezone: "Berlin" })).toBe(
      "Choose the time zone the working hours are in, such as Europe/Berlin.",
    );
  });

  test("refuses a time that is not on a 24-hour clock", () => {
    expect(getCloudOffHoursScheduleProblem({ startTime: "8am" })).toBe(
      "Write the start time on a 24-hour clock, such as 08:00.",
    );
    expect(getCloudOffHoursScheduleProblem({ stopTime: "7pm" })).toBe(
      "Write the stop time on a 24-hour clock, such as 19:00.",
    );
  });

  test("refuses hours that start and stop at once", () => {
    expect(
      getCloudOffHoursScheduleProblem({
        startTime: "08:00",
        stopTime: "08:00",
      }),
    ).toBe("Resources must stop at a different time than they start.");
  });

  test("refuses days that are not days of the week", () => {
    for (const workingDays of [
      [],
      "Monday",
      ["Someday"],
      new Array(8).fill(DayOfWeek.Monday),
    ]) {
      expect(getCloudOffHoursScheduleProblem({ workingDays })).toBe(
        "Pick the days resources run, from Monday to Sunday.",
      );
    }
  });

  test("refuses a tag that picks nothing, or is longer than a cloud allows", () => {
    expect(getCloudOffHoursScheduleProblem({ tagKey: "  " })).toBe(
      "Write the tag key that picks the resources, at most 128 characters.",
    );
    expect(getCloudOffHoursScheduleProblem({ tagKey: "k".repeat(129) })).toBe(
      "Write the tag key that picks the resources, at most 128 characters.",
    );
    expect(getCloudOffHoursScheduleProblem({ tagValue: "v".repeat(257) })).toBe(
      "Write the tag value that picks the resources, at most 256 characters.",
    );
  });
});
