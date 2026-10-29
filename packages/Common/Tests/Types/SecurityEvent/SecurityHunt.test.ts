import {
  DEFAULT_SECURITY_HUNT_TIME_RANGE,
  SECURITY_HUNT_MAX_CATCH_UP_IN_MINUTES,
  SECURITY_HUNT_MESSAGES,
  SECURITY_HUNT_RETRY_AFTER_FAILURE_IN_MINUTES,
  SECURITY_HUNT_RUN_DELAY_IN_SECONDS,
  SECURITY_HUNT_RUN_ERRORS,
  SECURITY_HUNT_SCHEDULES,
  SECURITY_HUNT_TIME_RANGES,
  SecurityHuntProblem,
  SecurityHuntRunWindow,
  SecurityHuntSchedule,
  areSecurityHuntFiltersEqual,
  countSecurityHuntFilterValues,
  getNextSecurityHuntRunAt,
  getSecurityHuntIntervalInMinutes,
  getSecurityHuntProblems,
  getSecurityHuntRetryAt,
  getSecurityHuntRunWindow,
  getSecurityHuntSearchStart,
  getSecurityHuntTimeRangeForLength,
  isScheduledSecurityHunt,
  isSecurityHuntSchedule,
  isSecurityHuntTimeRange,
  readSecurityHuntFilters,
  securityHuntFiltersFromMap,
  securityHuntFiltersToMap,
} from "../../../Types/SecurityEvent/SecurityHunt";
import { DETECTION_EVALUATION_DELAY_IN_SECONDS } from "../../../Types/SecurityEvent/DetectionFindingConstants";
import TimeRange from "../../../Types/Time/TimeRange";
import { describe, expect, test } from "@jest/globals";

/*
 * A HUNT'S RULES, AS THE FORM AND THE SERVER BOTH READ THEM: what it may
 * keep, how its chips are read and compared, and the windows its
 * scheduled runs read - every event once, from the moment the schedule is
 * set, never more than a day behind.
 */

const MINUTE: number = 60 * 1000;
const NOW: Date = new Date("2026-10-29T12:00:00.000Z");

function minutesBefore(date: Date, minutes: number): Date {
  return new Date(date.getTime() - minutes * MINUTE);
}

function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE);
}

describe("a hunt's schedule", () => {
  test("offers not scheduled first, then the intervals from the shortest", () => {
    expect(SECURITY_HUNT_SCHEDULES).toEqual([
      SecurityHuntSchedule.NotScheduled,
      SecurityHuntSchedule.EveryHour,
      SecurityHuntSchedule.EverySixHours,
      SecurityHuntSchedule.EveryDay,
      SecurityHuntSchedule.EveryWeek,
    ]);
    // What the database keeps and the API takes: the words the form shows.
    expect(Object.values(SecurityHuntSchedule)).toEqual([
      "Not Scheduled",
      "Every Hour",
      "Every 6 Hours",
      "Every Day",
      "Every Week",
    ]);
  });

  test("runs each schedule that many minutes apart, and a hunt opened by hand never", () => {
    expect(
      SECURITY_HUNT_SCHEDULES.map(
        (schedule: SecurityHuntSchedule): number | null => {
          return getSecurityHuntIntervalInMinutes(schedule);
        },
      ),
    ).toEqual([null, 60, 360, 1440, 10080]);
    expect(isScheduledSecurityHunt(SecurityHuntSchedule.NotScheduled)).toBe(
      false,
    );
    expect(isScheduledSecurityHunt(SecurityHuntSchedule.EveryWeek)).toBe(true);
  });

  test("reads anything else as no schedule at all", () => {
    for (const value of [
      undefined,
      null,
      "",
      "Every Minute",
      "every day",
      "Every Day ",
    ]) {
      expect([value, isSecurityHuntSchedule(value)]).toEqual([value, false]);
      expect([value, getSecurityHuntIntervalInMinutes(value)]).toEqual([
        value,
        null,
      ]);
      expect([value, isScheduledSecurityHunt(value)]).toEqual([value, false]);
    }
  });
});

describe("how far back a hunt searches when it is opened", () => {
  test("is a window that moves with the clock, a week unless chosen", () => {
    expect(DEFAULT_SECURITY_HUNT_TIME_RANGE).toBe(TimeRange.PAST_ONE_WEEK);
    expect(SECURITY_HUNT_TIME_RANGES).toContain(TimeRange.PAST_ONE_HOUR);
    expect(SECURITY_HUNT_TIME_RANGES).toContain(TimeRange.PAST_THREE_MONTHS);
    // A fixed window would open on the same past events forever.
    expect(SECURITY_HUNT_TIME_RANGES).not.toContain(TimeRange.CUSTOM);
    expect(isSecurityHuntTimeRange(TimeRange.CUSTOM)).toBe(false);
    expect(isSecurityHuntTimeRange("Past 1 Week")).toBe(true);
    expect(isSecurityHuntTimeRange("Past 2 Years")).toBe(false);
  });

  test("lists the windows from the shortest", () => {
    expect(SECURITY_HUNT_TIME_RANGES[0]).toBe(TimeRange.PAST_FIVE_MINS);
    expect(
      SECURITY_HUNT_TIME_RANGES[SECURITY_HUNT_TIME_RANGES.length - 1],
    ).toBe(TimeRange.PAST_THREE_MONTHS);
  });

  test("keeps a zoom or a typed range as the shortest moving window that holds it", () => {
    expect(getSecurityHuntTimeRangeForLength(1)).toBe(TimeRange.PAST_FIVE_MINS);
    expect(getSecurityHuntTimeRangeForLength(5)).toBe(TimeRange.PAST_FIVE_MINS);
    expect(getSecurityHuntTimeRangeForLength(6)).toBe(
      TimeRange.PAST_FIFTEEN_MINS,
    );
    expect(getSecurityHuntTimeRangeForLength(61)).toBe(
      TimeRange.PAST_TWO_HOURS,
    );
    expect(getSecurityHuntTimeRangeForLength(24 * 60)).toBe(
      TimeRange.PAST_ONE_DAY,
    );
    expect(getSecurityHuntTimeRangeForLength(3 * 24 * 60)).toBe(
      TimeRange.PAST_ONE_WEEK,
    );
    // Longer than three months: the longest there is.
    expect(getSecurityHuntTimeRangeForLength(400 * 24 * 60)).toBe(
      TimeRange.PAST_THREE_MONTHS,
    );
  });
});

describe("what is wrong with a hunt", () => {
  function problems(
    data: Parameters<typeof getSecurityHuntProblems>[0],
  ): Array<[string, string]> {
    return getSecurityHuntProblems(data).map(
      (problem: SecurityHuntProblem): [string, string] => {
        return [problem.field, problem.message];
      },
    );
  }

  test("nothing, for a name and a search", () => {
    expect(
      problems({ name: "Encoded PowerShell", searchQuery: "process:pwsh" }),
    ).toEqual([]);
  });

  test("a missing name, or one of only spaces", () => {
    for (const name of [undefined, null, "", "   "]) {
      expect(problems({ name, searchQuery: "x" })).toEqual([
        ["name", SECURITY_HUNT_MESSAGES.enterName.message],
      ]);
    }
  });

  test("a name past 100 characters, as trimmed", () => {
    expect(problems({ name: "a".repeat(100), searchQuery: "x" })).toEqual([]);
    expect(
      problems({ name: `  ${"a".repeat(100)}  `, searchQuery: "x" }),
    ).toEqual([]);
    expect(problems({ name: "a".repeat(101), searchQuery: "x" })).toEqual([
      ["name", SECURITY_HUNT_MESSAGES.nameTooLong.message],
    ]);
  });

  test("a description past 2,000 characters", () => {
    expect(
      problems({ name: "n", searchQuery: "x", description: "d".repeat(2000) }),
    ).toEqual([]);
    expect(
      problems({ name: "n", searchQuery: "x", description: "d".repeat(2001) }),
    ).toEqual([
      ["description", SECURITY_HUNT_MESSAGES.descriptionTooLong.message],
    ]);
  });

  test("no search and no chips: a hunt would find every event", () => {
    for (const searchQuery of [undefined, null, "", "   "]) {
      expect(problems({ name: "n", searchQuery })).toEqual([
        ["searchQuery", SECURITY_HUNT_MESSAGES.enterSearch.message],
      ]);
    }
  });

  test("chips alone are a search - a hunt saved from a sidebar click", () => {
    expect(
      problems({
        name: "n",
        searchQuery: "",
        filters: { severityName: ["High"] },
      }),
    ).toEqual([]);
    // A key with no values is no chip.
    expect(
      problems({ name: "n", searchQuery: "", filters: { severityName: [] } }),
    ).toEqual([["searchQuery", SECURITY_HUNT_MESSAGES.enterSearch.message]]);
  });

  test("a search past 2,000 characters, as trimmed", () => {
    expect(problems({ name: "n", searchQuery: "s".repeat(2000) })).toEqual([]);
    expect(problems({ name: "n", searchQuery: "s".repeat(2001) })).toEqual([
      ["searchQuery", SECURITY_HUNT_MESSAGES.searchTooLong.message],
    ]);
  });

  test("every problem at once, field by field", () => {
    expect(
      problems({ name: "", description: "d".repeat(2001), searchQuery: "" }),
    ).toEqual([
      ["name", SECURITY_HUNT_MESSAGES.enterName.message],
      ["description", SECURITY_HUNT_MESSAGES.descriptionTooLong.message],
      ["searchQuery", SECURITY_HUNT_MESSAGES.enterSearch.message],
    ]);
  });

  test("says each problem as a { message } the string extractor reads, in a sentence", () => {
    for (const [key, entry] of Object.entries({
      ...SECURITY_HUNT_MESSAGES,
      ...SECURITY_HUNT_RUN_ERRORS,
    })) {
      expect([key, typeof entry.message]).toEqual([key, "string"]);
      expect([key, entry.message.endsWith(".")]).toEqual([key, true]);
      expect([key, entry.message.trim()]).toEqual([key, entry.message]);
    }
    // The limits the words name are the limits kept.
    expect(SECURITY_HUNT_MESSAGES.nameTooLong.message).toContain("100");
    expect(SECURITY_HUNT_MESSAGES.searchTooLong.message).toContain("2,000");
    expect(SECURITY_HUNT_MESSAGES.tooManyHunts.message).toContain("200");
    expect(SECURITY_HUNT_MESSAGES.tooManyRecipients.message).toContain("50");
  });
});

describe("a hunt's chips", () => {
  test("are read as kept: each key's text values, once each, in the order clicked", () => {
    expect(
      readSecurityHuntFilters({
        severityName: ["High", "Critical", "High", "", 7, null],
        "!statusName": ["Success"],
        "attributes.threat.matched": ["true"],
      }),
    ).toEqual({
      severityName: ["High", "Critical"],
      "!statusName": ["Success"],
      "attributes.threat.matched": ["true"],
    });
  });

  test("leave out a key with no values, and anything not a list", () => {
    expect(
      readSecurityHuntFilters({
        severityName: [],
        className: "Process Activity",
        vendorName: { Microsoft: true },
        "": ["x"],
      }),
    ).toEqual({});
  });

  test("read as none from anything not an object of lists", () => {
    for (const value of [undefined, null, "", "severityName:High", 3, []]) {
      expect(readSecurityHuntFilters(value)).toEqual({});
    }
  });

  test("count their values in all", () => {
    expect(countSecurityHuntFilterValues(undefined)).toBe(0);
    expect(
      countSecurityHuntFilterValues({
        severityName: ["High", "Critical"],
        "!statusName": ["Success"],
      }),
    ).toBe(3);
  });

  test("go to and from the Events page's map of sets, unchanged", () => {
    const filters: { [key: string]: Array<string> } = {
      severityName: ["High", "Critical"],
      "!statusName": ["Success"],
    };
    const map: Map<string, Set<string>> = securityHuntFiltersToMap(filters);

    expect(Array.from(map.keys())).toEqual(["severityName", "!statusName"]);
    expect(Array.from(map.get("severityName") || [])).toEqual([
      "High",
      "Critical",
    ]);
    expect(securityHuntFiltersFromMap(map)).toEqual(filters);
    // A key the page emptied is no chip.
    map.set("className", new Set<string>());
    expect(securityHuntFiltersFromMap(map)).toEqual(filters);
  });

  test("are the same filters in whatever order they were clicked", () => {
    expect(
      areSecurityHuntFiltersEqual(
        { severityName: ["High", "Critical"], "!statusName": ["Success"] },
        { "!statusName": ["Success"], severityName: ["Critical", "High"] },
      ),
    ).toBe(true);
    expect(areSecurityHuntFiltersEqual(undefined, {})).toBe(true);
    expect(areSecurityHuntFiltersEqual({ a: [] }, null)).toBe(true);
  });

  test("differ by a value, a key, or a value left out rather than kept", () => {
    expect(
      areSecurityHuntFiltersEqual(
        { severityName: ["High"] },
        { severityName: ["High", "Critical"] },
      ),
    ).toBe(false);
    expect(
      areSecurityHuntFiltersEqual(
        { severityName: ["High"] },
        { className: ["High"] },
      ),
    ).toBe(false);
    expect(
      areSecurityHuntFiltersEqual(
        { statusName: ["Success"] },
        { "!statusName": ["Success"] },
      ),
    ).toBe(false);
  });
});

describe("the windows a scheduled hunt's runs read", () => {
  const delay: number = SECURITY_HUNT_RUN_DELAY_IN_SECONDS * 1000;

  test("stay as far behind the clock as detection rules do", () => {
    expect(SECURITY_HUNT_RUN_DELAY_IN_SECONDS).toBe(
      DETECTION_EVALUATION_DELAY_IN_SECONDS,
    );
    expect(getSecurityHuntSearchStart(NOW).getTime()).toBe(
      NOW.getTime() - delay,
    );
  });

  test("a run reads from a millisecond after the last one stopped to the delay before now", () => {
    const searchedUpTo: Date = minutesBefore(NOW, 62);
    const window: SecurityHuntRunWindow | null = getSecurityHuntRunWindow({
      schedule: SecurityHuntSchedule.EveryHour,
      searchedUpTo,
      now: NOW,
    });

    expect(window).toEqual({
      startTime: new Date(searchedUpTo.getTime() + 1),
      endTime: new Date(NOW.getTime() - delay),
    });
  });

  test("the next run starts where this one stopped: no event read twice, none skipped", () => {
    const first: SecurityHuntRunWindow = getSecurityHuntRunWindow({
      schedule: SecurityHuntSchedule.EveryHour,
      searchedUpTo: minutesBefore(NOW, 60),
      now: NOW,
    })!;
    const second: SecurityHuntRunWindow = getSecurityHuntRunWindow({
      schedule: SecurityHuntSchedule.EveryHour,
      searchedUpTo: first.endTime,
      now: minutesAfter(NOW, 60),
    })!;

    expect(second.startTime.getTime()).toBe(first.endTime.getTime() + 1);
    expect(second.endTime.getTime() - first.endTime.getTime()).toBe(
      60 * MINUTE,
    );
  });

  test("a hunt that has not run reads one interval back", () => {
    const window: SecurityHuntRunWindow | null = getSecurityHuntRunWindow({
      schedule: SecurityHuntSchedule.EveryDay,
      searchedUpTo: null,
      now: NOW,
    });

    expect(window!.endTime.getTime() - window!.startTime.getTime()).toBe(
      24 * 60 * MINUTE,
    );
  });

  test("after an outage, reads what came in since - at most a day more than one interval", () => {
    const window: SecurityHuntRunWindow | null = getSecurityHuntRunWindow({
      schedule: SecurityHuntSchedule.EveryHour,
      searchedUpTo: minutesBefore(NOW, 5 * 24 * 60),
      now: NOW,
    });

    expect(SECURITY_HUNT_MAX_CATCH_UP_IN_MINUTES).toBe(24 * 60);
    expect(window!.endTime.getTime() - window!.startTime.getTime()).toBe(
      (60 + 24 * 60) * MINUTE,
    );
  });

  test("a weekly hunt catches up a week and a day", () => {
    const window: SecurityHuntRunWindow | null = getSecurityHuntRunWindow({
      schedule: SecurityHuntSchedule.EveryWeek,
      searchedUpTo: minutesBefore(NOW, 30 * 24 * 60),
      now: NOW,
    });

    expect(window!.endTime.getTime() - window!.startTime.getTime()).toBe(
      (7 * 24 * 60 + 24 * 60) * MINUTE,
    );
  });

  test("nothing new to read: a schedule set a moment ago, or a clock that moved back", () => {
    expect(
      getSecurityHuntRunWindow({
        schedule: SecurityHuntSchedule.EveryHour,
        searchedUpTo: getSecurityHuntSearchStart(NOW),
        now: NOW,
      }),
    ).toBeNull();
    expect(
      getSecurityHuntRunWindow({
        schedule: SecurityHuntSchedule.EveryHour,
        searchedUpTo: minutesAfter(NOW, 10),
        now: NOW,
      }),
    ).toBeNull();
  });

  test("a hunt opened by hand has no window, and a broken date reads one interval back", () => {
    expect(
      getSecurityHuntRunWindow({
        schedule: SecurityHuntSchedule.NotScheduled,
        searchedUpTo: minutesBefore(NOW, 60),
        now: NOW,
      }),
    ).toBeNull();

    const window: SecurityHuntRunWindow | null = getSecurityHuntRunWindow({
      schedule: SecurityHuntSchedule.EveryHour,
      searchedUpTo: new Date("not a date"),
      now: NOW,
    });

    expect(window!.endTime.getTime() - window!.startTime.getTime()).toBe(
      60 * MINUTE,
    );
  });
});

describe("when a scheduled hunt runs next", () => {
  test("one interval after it was due, so a daily hunt keeps its hour", () => {
    const dueAt: Date = minutesBefore(NOW, 3);

    expect(
      getNextSecurityHuntRunAt({
        schedule: SecurityHuntSchedule.EveryDay,
        dueAt,
        now: NOW,
      }),
    ).toEqual(minutesAfter(dueAt, 24 * 60));
  });

  test("one interval from now when it ran later than that", () => {
    expect(
      getNextSecurityHuntRunAt({
        schedule: SecurityHuntSchedule.EveryHour,
        dueAt: minutesBefore(NOW, 3 * 60),
        now: NOW,
      }),
    ).toEqual(minutesAfter(NOW, 60));
    expect(
      getNextSecurityHuntRunAt({
        schedule: SecurityHuntSchedule.EveryHour,
        dueAt: null,
        now: NOW,
      }),
    ).toEqual(minutesAfter(NOW, 60));
  });

  test("never, for a hunt opened by hand", () => {
    expect(
      getNextSecurityHuntRunAt({
        schedule: SecurityHuntSchedule.NotScheduled,
        dueAt: NOW,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("a failed run is tried again within the hour, or at its next interval when sooner", () => {
    expect(SECURITY_HUNT_RETRY_AFTER_FAILURE_IN_MINUTES).toBe(60);
    expect(
      getSecurityHuntRetryAt({
        schedule: SecurityHuntSchedule.EveryWeek,
        now: NOW,
      }),
    ).toEqual(minutesAfter(NOW, 60));
    expect(
      getSecurityHuntRetryAt({
        schedule: SecurityHuntSchedule.EveryHour,
        now: NOW,
      }),
    ).toEqual(minutesAfter(NOW, 60));
    expect(
      getSecurityHuntRetryAt({
        schedule: SecurityHuntSchedule.NotScheduled,
        now: NOW,
      }),
    ).toBeNull();
  });
});
