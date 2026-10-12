import { describe, expect, test } from "@jest/globals";
import User from "../../../Models/DatabaseModels/User";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import LayerUtil from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import { TOOL_IMPORT_MAX_LAYERS_PER_SCHEDULE } from "../../../Types/ToolImport/ToolImportLimits";
import {
  buildImportedRotationRecurring,
  buildLayerFromImportedRotation,
  buildRestrictionTimes,
  doCoveragesOverlap,
  formatTimeOfDay,
  getConcurrentLayerOrder,
  getGroupScheduleName,
  getGroupSourceId,
  getNextDayOfWeek,
  getRestrictionCoverage,
  groupRotationsIntoSchedules,
  isGroupSourceIdOf,
  MINUTES_PER_WEEK,
  parseTimeOfDay,
  resolveImportedTimezone,
  toDayOfWeek,
  toEventInterval,
  toTimeOfDay,
} from "../../../Types/ToolImport/ToolImportScheduleRules";
import {
  ImportedRestriction,
  ImportedRotation,
} from "../../../Types/ToolImport/ToolImportSnapshot";
import moment from "moment-timezone";

/*
 * How a rotation of another tool becomes a OneUptime layer, and how a
 * schedule's rotations are shared among OneUptime schedules so nobody who
 * was paged together stops being paged. The last block runs the layers it
 * builds through the real on-call engine (LayerUtil): the person on call,
 * and the hours they are on call, are the ones the other tool had.
 */

function rotation(
  overrides: Partial<ImportedRotation> & { name: string },
): ImportedRotation {
  return {
    key: overrides.name,
    startsAt: "2024-02-05T06:00:00.000Z",
    intervalType: EventInterval.Week,
    intervalCount: 1,
    restriction: null,
    participantSourceIds: ["a"],
    notes: [],
    ...overrides,
  };
}

const BUSINESS_HOURS: ImportedRestriction = {
  type: "Weekly",
  windows: [
    {
      startDay: DayOfWeek.Monday,
      startTime: "09:00",
      endDay: DayOfWeek.Friday,
      endTime: "17:00",
    },
  ],
};

const AFTER_HOURS: ImportedRestriction = {
  type: "Weekly",
  windows: [
    {
      startDay: DayOfWeek.Friday,
      startTime: "17:00",
      endDay: DayOfWeek.Monday,
      endTime: "09:00",
    },
  ],
};

function countCovered(coverage: Uint8Array): number {
  let count: number = 0;

  for (const minute of coverage) {
    count += minute;
  }

  return count;
}

describe("ToolImportScheduleRules: times of day, days and zones", () => {
  test.each([
    ["09:00", 540],
    ["9:05", 545],
    ["00:00", 0],
    ["23:59", 1439],
    ["24:00", 1440],
    ["09:00:30", 540],
    [" 17:30 ", 1050],
  ] as Array<[string, number]>)(
    "%s is %i minutes",
    (text: string, minutes: number) => {
      expect(parseTimeOfDay(text)).toBe(minutes);
    },
  );

  test.each(["24:01", "25:00", "12:60", "noon", "", "-1:00"])(
    "%j is not a time",
    (text: string) => {
      expect(parseTimeOfDay(text)).toBeNull();
    },
  );

  test("times are written HH:MM, with 24:00 for the end of the day", () => {
    expect(formatTimeOfDay(0)).toBe("00:00");
    expect(formatTimeOfDay(545)).toBe("09:05");
    expect(formatTimeOfDay(1440)).toBe("24:00");
    expect(formatTimeOfDay(5000)).toBe("24:00");
  });

  test("hour and minute numbers become a time, and anything else does not", () => {
    expect(toTimeOfDay(9, 0)).toBe("09:00");
    expect(toTimeOfDay("9", "30")).toBe("09:30");
    expect(toTimeOfDay(9, undefined)).toBe("09:00");
    expect(toTimeOfDay(24, 0)).toBe("24:00");
    expect(toTimeOfDay(24, 5)).toBeNull();
    expect(toTimeOfDay(-1, 0)).toBeNull();
    expect(toTimeOfDay(9, 60)).toBeNull();
    expect(toTimeOfDay(9.5, 0)).toBeNull();
  });

  test("days are named in any case, and the day after Saturday is Sunday", () => {
    expect(toDayOfWeek("monday")).toBe(DayOfWeek.Monday);
    expect(toDayOfWeek(" Friday ")).toBe(DayOfWeek.Friday);
    expect(toDayOfWeek("funday")).toBeNull();
    expect(toDayOfWeek(3)).toBeNull();
    expect(getNextDayOfWeek(DayOfWeek.Saturday)).toBe(DayOfWeek.Sunday);
    expect(getNextDayOfWeek(DayOfWeek.Monday)).toBe(DayOfWeek.Tuesday);
  });

  test("a zone is OneUptime's name for it, legacy names included, or null", () => {
    expect(resolveImportedTimezone("Europe/London")).toBe("Europe/London");
    expect(resolveImportedTimezone("US/Pacific")).toBe("America/Los_Angeles");
    expect(resolveImportedTimezone(" asia/singapore ")).toBe("Asia/Singapore");
    expect(resolveImportedTimezone("Mars/Olympus_Mons")).toBeNull();
    expect(resolveImportedTimezone("")).toBeNull();
  });

  test("hourly, daily, weekly and monthly are the intervals a rotation turns at", () => {
    expect(toEventInterval("hourly")).toBe(EventInterval.Hour);
    expect(toEventInterval("Daily")).toBe(EventInterval.Day);
    expect(toEventInterval("weekly")).toBe(EventInterval.Week);
    // Grafana OnCall rotates monthly too; the layer engine counts months.
    expect(toEventInterval("monthly")).toBe(EventInterval.Month);
    expect(toEventInterval("yearly")).toBeNull();
    expect(toEventInterval(undefined)).toBeNull();
  });
});

describe("ToolImportScheduleRules: when a rotation is on call", () => {
  test("no restriction is the whole week", () => {
    expect(countCovered(getRestrictionCoverage(null))).toBe(MINUTES_PER_WEEK);
  });

  test("a daily window covers its hours on every day, overnight ones across midnight", () => {
    expect(
      countCovered(
        getRestrictionCoverage({
          type: "Daily",
          startTime: "09:00",
          endTime: "17:00",
        }),
      ),
    ).toBe(7 * 8 * 60);

    const overnight: Uint8Array = getRestrictionCoverage({
      type: "Daily",
      startTime: "22:00",
      endTime: "06:30",
    });

    expect(countCovered(overnight)).toBe(7 * (120 + 390));
    // Sunday 03:00 is covered by Saturday night's window.
    expect(overnight[3 * 60]).toBe(1);
    expect(overnight[12 * 60]).toBe(0);
  });

  test("a daily window that ends where it starts is the whole day", () => {
    expect(
      countCovered(
        getRestrictionCoverage({
          type: "Daily",
          startTime: "08:00",
          endTime: "08:00",
        }),
      ),
    ).toBe(MINUTES_PER_WEEK);
  });

  test("a weekly window covers from its start day and time to its end day and time, across the weekend too", () => {
    expect(countCovered(getRestrictionCoverage(BUSINESS_HOURS))).toBe(
      4 * 24 * 60 + 8 * 60,
    );
    expect(countCovered(getRestrictionCoverage(AFTER_HOURS))).toBe(
      MINUTES_PER_WEEK - (4 * 24 * 60 + 8 * 60),
    );
  });

  test("business hours and after hours never overlap; either overlaps the whole week", () => {
    const business: Uint8Array = getRestrictionCoverage(BUSINESS_HOURS);
    const after: Uint8Array = getRestrictionCoverage(AFTER_HOURS);
    const always: Uint8Array = getRestrictionCoverage(null);

    expect(doCoveragesOverlap(business, after)).toBe(false);
    expect(doCoveragesOverlap(business, always)).toBe(true);
    expect(doCoveragesOverlap(after, always)).toBe(true);
  });
});

describe("ToolImportScheduleRules: how a schedule's rotations share OneUptime schedules", () => {
  test("rotations that are never on call together are one schedule's layers", () => {
    const groups: Array<Array<ImportedRotation>> = groupRotationsIntoSchedules([
      rotation({ name: "Business", restriction: BUSINESS_HOURS }),
      rotation({ name: "After", restriction: AFTER_HOURS }),
    ]);

    expect(
      groups.map((group: Array<ImportedRotation>) => {
        return group.map((item: ImportedRotation) => {
          return item.name;
        });
      }),
    ).toEqual([["Business", "After"]]);
  });

  test("rotations on call at the same time go into schedules of their own", () => {
    const groups: Array<Array<ImportedRotation>> = groupRotationsIntoSchedules([
      rotation({ name: "Primary" }),
      rotation({ name: "Shadow" }),
    ]);

    expect(
      groups.map((group: Array<ImportedRotation>) => {
        return group.map((item: ImportedRotation) => {
          return item.name;
        });
      }),
    ).toEqual([["Primary"], ["Shadow"]]);
  });

  test("each rotation joins the first schedule it fits", () => {
    const groups: Array<Array<ImportedRotation>> = groupRotationsIntoSchedules([
      rotation({ name: "Business", restriction: BUSINESS_HOURS }),
      rotation({ name: "Always" }),
      rotation({ name: "After", restriction: AFTER_HOURS }),
    ]);

    expect(
      groups.map((group: Array<ImportedRotation>) => {
        return group.map((item: ImportedRotation) => {
          return item.name;
        });
      }),
    ).toEqual([["Business", "After"], ["Always"]]);
  });

  test("a schedule holds at most so many layers", () => {
    const hourly: Array<ImportedRotation> = [];

    for (let hour: number = 0; hour < 24; hour++) {
      hourly.push(
        rotation({
          name: `Hour ${hour}`,
          restriction: {
            type: "Daily",
            startTime: formatTimeOfDay(hour * 60),
            endTime: formatTimeOfDay(hour * 60 + 60),
          },
        }),
      );
    }

    const groups: Array<Array<ImportedRotation>> =
      groupRotationsIntoSchedules(hourly);

    expect(
      groups.map((group: Array<ImportedRotation>) => {
        return group.length;
      }),
    ).toEqual([
      TOOL_IMPORT_MAX_LAYERS_PER_SCHEDULE,
      24 - TOOL_IMPORT_MAX_LAYERS_PER_SCHEDULE,
    ]);
  });

  test("the first schedule keeps the name; the others add the rotation's", () => {
    const group: Array<ImportedRotation> = [rotation({ name: "Secondary" })];

    expect(
      getGroupScheduleName({
        scheduleName: "Platform",
        groupIndex: 0,
        group: group,
        maxLength: 100,
      }),
    ).toBe("Platform");
    expect(
      getGroupScheduleName({
        scheduleName: "Platform",
        groupIndex: 1,
        group: group,
        maxLength: 100,
      }),
    ).toBe("Platform (Secondary)");

    const long: string = getGroupScheduleName({
      scheduleName: "P".repeat(100),
      groupIndex: 2,
      group: group,
      maxLength: 100,
    });

    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.endsWith(" (Secondary)")).toBe(true);
  });

  test("each schedule is remembered by the source id, numbered after the first", () => {
    expect(getGroupSourceId("abc", 0)).toBe("abc");
    expect(getGroupSourceId("abc", 1)).toBe("abc#2");
    expect(isGroupSourceIdOf("abc", "abc")).toBe(true);
    expect(isGroupSourceIdOf("abc#2", "abc")).toBe(true);
    expect(isGroupSourceIdOf("abcd", "abc")).toBe(false);
    expect(isGroupSourceIdOf("ab#2", "abc")).toBe(false);
  });
});

describe("ToolImportScheduleRules: people on call at once from one list", () => {
  test("each turn takes the next people in the list", () => {
    const people: Array<string> = ["a", "b", "c"];

    expect(
      getConcurrentLayerOrder({ people: people, layerCount: 2, layerIndex: 0 }),
    ).toEqual(["a", "c", "b"]);
    expect(
      getConcurrentLayerOrder({ people: people, layerCount: 2, layerIndex: 1 }),
    ).toEqual(["b", "a", "c"]);
  });

  test("an even list splits into lines of its own", () => {
    const people: Array<string> = ["a", "b", "c", "d"];

    expect(
      getConcurrentLayerOrder({ people: people, layerCount: 2, layerIndex: 0 }),
    ).toEqual(["a", "c"]);
    expect(
      getConcurrentLayerOrder({ people: people, layerCount: 2, layerIndex: 1 }),
    ).toEqual(["b", "d"]);
  });

  test("more people on call at once than in the list leaves the extra lines empty", () => {
    expect(
      getConcurrentLayerOrder({ people: ["a"], layerCount: 2, layerIndex: 1 }),
    ).toEqual([]);
    expect(
      getConcurrentLayerOrder({ people: [], layerCount: 1, layerIndex: 0 }),
    ).toEqual([]);
  });

  test("one person on call at a time is the list as it is", () => {
    expect(
      getConcurrentLayerOrder({
        people: ["a", "b", "c"],
        layerCount: 1,
        layerIndex: 0,
      }),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("ToolImportScheduleRules: OneUptime's restriction times", () => {
  const REFERENCE: Date = new Date("2026-10-08T12:00:00Z");
  const ZONE: string = "Europe/Istanbul";

  function wallClock(date: Date): string {
    return moment.tz(date, ZONE).format("dddd HH:mm");
  }

  test("no restriction is none", () => {
    const times: RestrictionTimes = buildRestrictionTimes({
      restriction: null,
      timezone: ZONE,
      reference: REFERENCE,
    });

    expect(times.restictionType).toBe(RestrictionType.None);
  });

  test("a daily window's times are wall-clock times in the schedule's zone", () => {
    const times: RestrictionTimes = buildRestrictionTimes({
      restriction: { type: "Daily", startTime: "22:00", endTime: "06:30" },
      timezone: ZONE,
      reference: REFERENCE,
    });

    expect(times.restictionType).toBe(RestrictionType.Daily);
    expect(
      moment.tz(times.dayRestrictionTimes!.startTime, ZONE).format("HH:mm"),
    ).toBe("22:00");
    expect(
      moment.tz(times.dayRestrictionTimes!.endTime, ZONE).format("HH:mm"),
    ).toBe("06:30");
  });

  test("a daily window that starts where it ends is no restriction (OneUptime refuses a zero-length one)", () => {
    expect(
      buildRestrictionTimes({
        restriction: { type: "Daily", startTime: "07:00", endTime: "07:00" },
        timezone: ZONE,
        reference: REFERENCE,
      }).restictionType,
    ).toBe(RestrictionType.None);
  });

  test("a weekly window's day and time are read in the schedule's zone, as the engine reads them", () => {
    const times: RestrictionTimes = buildRestrictionTimes({
      restriction: AFTER_HOURS,
      timezone: ZONE,
      reference: REFERENCE,
    });

    expect(times.restictionType).toBe(RestrictionType.Weekly);
    expect(times.weeklyRestrictionTimes).toHaveLength(1);

    const window: (typeof times.weeklyRestrictionTimes)[number] =
      times.weeklyRestrictionTimes[0]!;

    expect(window.startDay).toBe(DayOfWeek.Friday);
    expect(window.endDay).toBe(DayOfWeek.Monday);
    expect(wallClock(window.startTime)).toBe("Friday 17:00");
    expect(wallClock(window.endTime)).toBe("Monday 09:00");
  });

  test("a weekly window ending at 24:00 ends at midnight of the next day", () => {
    const times: RestrictionTimes = buildRestrictionTimes({
      restriction: {
        type: "Weekly",
        windows: [
          {
            startDay: DayOfWeek.Saturday,
            startTime: "18:00",
            endDay: DayOfWeek.Saturday,
            endTime: "24:00",
          },
        ],
      },
      timezone: ZONE,
      reference: REFERENCE,
    });

    const window: (typeof times.weeklyRestrictionTimes)[number] =
      times.weeklyRestrictionTimes[0]!;

    expect(window.endDay).toBe(DayOfWeek.Sunday);
    expect(wallClock(window.endTime)).toBe("Sunday 00:00");
  });

  test("weekly windows that are not times are left out, and none left is no restriction", () => {
    expect(
      buildRestrictionTimes({
        restriction: {
          type: "Weekly",
          windows: [
            {
              startDay: DayOfWeek.Monday,
              startTime: "nine",
              endDay: DayOfWeek.Monday,
              endTime: "17:00",
            },
          ],
        },
        timezone: ZONE,
        reference: REFERENCE,
      }).restictionType,
    ).toBe(RestrictionType.None);
  });

  test("a rotation's interval is OneUptime's, never below one", () => {
    const recurring: Recurring = buildImportedRotationRecurring({
      intervalType: EventInterval.Day,
      intervalCount: 0,
    });

    expect(recurring.intervalType).toBe(EventInterval.Day);
    expect(recurring.intervalCount.toNumber()).toBe(1);
    expect(
      buildImportedRotationRecurring({
        intervalType: EventInterval.Hour,
        intervalCount: 12.7,
      }).intervalCount.toNumber(),
    ).toBe(12);
  });
});

describe("ToolImportScheduleRules: the layer, through the on-call engine", () => {
  const SCHEDULE_ID: ObjectID = ObjectID.generate();
  const PROJECT_ID: ObjectID = ObjectID.generate();
  const ZONE: string = "Europe/Istanbul";

  function person(id: string): User {
    const user: User = new User();
    user.id = new ObjectID(id);
    return user;
  }

  const ALICE: string = "aaaaaaaa-1111-4111-8111-111111111111";
  const BOB: string = "bbbbbbbb-2222-4222-8222-222222222222";

  function onCallAt(
    layer: OnCallDutyPolicyScheduleLayer,
    at: Date,
  ): string | null {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [person(ALICE), person(BOB)],
      startDateTimeOfLayer: layer.startsAt!,
      handOffTime: layer.handOffTime!,
      rotation: layer.rotation!,
      restrictionTimes: layer.restrictionTimes!,
      timezone: ZONE,
      calendarStartDate: new Date(at.getTime() - 1000),
      calendarEndDate: new Date(at.getTime() + 1000),
    });

    const event: CalendarEvent | undefined = events.find(
      (candidate: CalendarEvent): boolean => {
        return (
          new Date(candidate.start).getTime() <= at.getTime() &&
          new Date(candidate.end).getTime() >= at.getTime()
        );
      },
    );

    return event ? event.title : null;
  }

  test("the layer starts when the rotation started and hands off one turn later", () => {
    const layer: OnCallDutyPolicyScheduleLayer = buildLayerFromImportedRotation(
      {
        rotation: rotation({ name: "Weekly" }),
        scheduleId: SCHEDULE_ID,
        projectId: PROJECT_ID,
        name: "Weekly",
        order: 2,
        timezone: ZONE,
        reference: new Date("2026-10-08T12:00:00Z"),
      },
    );

    expect(layer.name).toBe("Weekly");
    expect(layer.order).toBe(2);
    expect(layer.onCallDutyPolicyScheduleId?.toString()).toBe(
      SCHEDULE_ID.toString(),
    );
    expect(layer.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(layer.startsAt?.toISOString()).toBe("2024-02-05T06:00:00.000Z");
    expect(layer.handOffTime?.toISOString()).toBe("2024-02-12T06:00:00.000Z");
    expect(layer.rotation?.intervalType).toBe(EventInterval.Week);
    expect(layer.restrictionTimes?.restictionType).toBe(RestrictionType.None);
  });

  test("the person on call now is the one whose turn it is in the other tool", () => {
    const layer: OnCallDutyPolicyScheduleLayer = buildLayerFromImportedRotation(
      {
        rotation: rotation({
          name: "Weekly",
          participantSourceIds: ["alice", "bob"],
        }),
        scheduleId: SCHEDULE_ID,
        projectId: PROJECT_ID,
        name: "Weekly",
        order: 1,
        timezone: ZONE,
        reference: new Date("2026-10-08T12:00:00Z"),
      },
    );

    const start: number = Date.parse("2024-02-05T06:00:00Z");
    const week: number = 7 * 24 * 60 * 60 * 1000;

    for (const at of [
      "2024-02-05T07:00:00Z",
      "2024-02-13T07:00:00Z",
      "2025-06-18T12:00:00Z",
      "2026-10-08T12:00:00Z",
    ]) {
      const turn: number = Math.floor((Date.parse(at) - start) / week);
      const expected: string = turn % 2 === 0 ? ALICE : BOB;

      expect(onCallAt(layer, new Date(at))).toBe(expected);
    }
  });

  test("a restricted layer is on call in its hours, in the schedule's zone, and nobody is outside them", () => {
    const layer: OnCallDutyPolicyScheduleLayer = buildLayerFromImportedRotation(
      {
        rotation: rotation({
          name: "Business hours",
          restriction: BUSINESS_HOURS,
        }),
        scheduleId: SCHEDULE_ID,
        projectId: PROJECT_ID,
        name: "Business hours",
        order: 1,
        timezone: ZONE,
        reference: new Date("2026-10-08T12:00:00Z"),
      },
    );

    /*
     * One window from Monday 09:00 to Friday 17:00 in Istanbul (UTC+3), as
     * Opsgenie means it: Thursday at 10:00 and at 20:00 are inside it.
     */
    expect(onCallAt(layer, new Date("2026-10-08T07:00:00Z"))).not.toBeNull();
    expect(onCallAt(layer, new Date("2026-10-08T17:00:00Z"))).not.toBeNull();
    // Friday 16:30 is inside it, Friday 17:30 and Saturday at noon are not.
    expect(onCallAt(layer, new Date("2026-10-09T13:30:00Z"))).not.toBeNull();
    expect(onCallAt(layer, new Date("2026-10-09T14:30:00Z"))).toBeNull();
    expect(onCallAt(layer, new Date("2026-10-10T09:00:00Z"))).toBeNull();
    // Monday 08:30 is before it opens, Monday 09:30 inside.
    expect(onCallAt(layer, new Date("2026-10-12T05:30:00Z"))).toBeNull();
    expect(onCallAt(layer, new Date("2026-10-12T06:30:00Z"))).not.toBeNull();
  });

  test("a daily window keeps the layer on call those hours every day, in the schedule's zone", () => {
    const layer: OnCallDutyPolicyScheduleLayer = buildLayerFromImportedRotation(
      {
        rotation: rotation({
          name: "Nights",
          restriction: { type: "Daily", startTime: "22:00", endTime: "06:30" },
        }),
        scheduleId: SCHEDULE_ID,
        projectId: PROJECT_ID,
        name: "Nights",
        order: 1,
        timezone: ZONE,
        reference: new Date("2026-10-08T12:00:00Z"),
      },
    );

    // 23:00 and 05:00 in Istanbul are night; 12:00 is not.
    expect(onCallAt(layer, new Date("2026-10-08T20:00:00Z"))).not.toBeNull();
    expect(onCallAt(layer, new Date("2026-10-09T02:00:00Z"))).not.toBeNull();
    expect(onCallAt(layer, new Date("2026-10-09T09:00:00Z"))).toBeNull();
  });
});
