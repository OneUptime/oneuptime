import { describe, expect, test } from "@jest/globals";
import User from "../../../Models/DatabaseModels/User";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import EventInterval from "../../../Types/Events/EventInterval";
import ObjectID from "../../../Types/ObjectID";
import LayerUtil from "../../../Types/OnCallDutyPolicy/Layer";
import { TOOL_IMPORT_MAX_LAYERS_PER_SCHEDULE } from "../../../Types/ToolImport/ToolImportLimits";
import {
  buildLayerFromImportedRotation,
  buildRestrictionFromDayWindows,
  getGroupScheduleName,
  getRotationPrecedence,
  getTimezoneDifference,
  groupRotationsIntoSchedules,
  shiftRestriction,
  toTurnInterval,
} from "../../../Types/ToolImport/ToolImportScheduleRules";
import {
  ImportedRestriction,
  ImportedRotation,
} from "../../../Types/ToolImport/ToolImportSnapshot";

/*
 * The rules the PagerDuty, Splunk On-Call and Grafana OnCall imports add to
 * how a rotation becomes a layer:
 *
 *  - Precedence. Where a tool's layers override one another (PagerDuty's
 *    layers, Grafana OnCall's layer priorities), the rotations of a higher
 *    precedence go above the rest in every schedule they override, and a
 *    schedule whose layers all override each other stays one schedule.
 *    Rotations of one precedence are still on call together, and split as
 *    before - and with no precedence at all, nothing changes.
 *  - Turn lengths given in seconds, windows given as "this day, from this
 *    time, for this long", and hours moved from one time zone into another.
 *
 * The last block runs two imported layers through the real on-call engine:
 * the higher one is on call wherever it has someone, as in PagerDuty.
 */

function rotation(
  overrides: Partial<ImportedRotation> & { name: string },
): ImportedRotation {
  return {
    key: overrides.name,
    startsAt: "2026-01-05T09:00:00.000Z",
    intervalType: EventInterval.Week,
    intervalCount: 1,
    restriction: null,
    participantSourceIds: ["a"],
    notes: [],
    ...overrides,
  };
}

function names(groups: Array<Array<ImportedRotation>>): Array<Array<string>> {
  return groups.map((group: Array<ImportedRotation>) => {
    return group.map((item: ImportedRotation): string => {
      return item.name;
    });
  });
}

const WEEKEND: ImportedRestriction = {
  type: "Weekly",
  windows: [
    {
      startDay: DayOfWeek.Saturday,
      startTime: "00:00",
      endDay: DayOfWeek.Monday,
      endTime: "00:00",
    },
  ],
};

const OFFICE: ImportedRestriction = {
  type: "Daily",
  startTime: "09:00",
  endTime: "17:00",
};

describe("ToolImportScheduleRules: rotations that override one another", () => {
  test("layers that override one another stay one schedule, the highest first, however they overlap", () => {
    expect(
      names(
        groupRotationsIntoSchedules([
          rotation({ name: "Weekend", restriction: WEEKEND, precedence: 3 }),
          rotation({ name: "Daily", precedence: 2 }),
          rotation({ name: "Base", precedence: 1 }),
        ]),
      ),
    ).toEqual([["Weekend", "Daily", "Base"]]);
  });

  test("the order is the precedence's, not the list's", () => {
    expect(
      names(
        groupRotationsIntoSchedules([
          rotation({ name: "Low", precedence: 1 }),
          rotation({ name: "High", precedence: 5 }),
          rotation({ name: "Middle", precedence: 3 }),
        ]),
      ),
    ).toEqual([["High", "Middle", "Low"]]);
  });

  test("rotations of one precedence that are on call together split, and the higher ones sit on top of each part", () => {
    expect(
      names(
        groupRotationsIntoSchedules([
          rotation({ name: "Office", restriction: OFFICE, precedence: 2 }),
          rotation({ name: "Pair A", precedence: 0 }),
          rotation({ name: "Pair B", precedence: 0 }),
        ]),
      ),
    ).toEqual([
      ["Office", "Pair A"],
      ["Office", "Pair B"],
    ]);
  });

  test("a precedence split in two gives its parts to the first two schedules only", () => {
    expect(
      names(
        groupRotationsIntoSchedules([
          rotation({ name: "High A", precedence: 2 }),
          rotation({ name: "High B", precedence: 2 }),
          rotation({ name: "Low A", precedence: 1 }),
          rotation({ name: "Low B", precedence: 1 }),
          rotation({ name: "Low C", precedence: 1 }),
        ]),
      ),
    ).toEqual([["High A", "Low A"], ["High B", "Low B"], ["Low C"]]);
  });

  test("rotations of one precedence that never meet share their part", () => {
    expect(
      names(
        groupRotationsIntoSchedules([
          rotation({ name: "Top", precedence: 9 }),
          rotation({ name: "Days", restriction: OFFICE, precedence: 1 }),
          rotation({
            name: "Nights",
            restriction: {
              type: "Daily",
              startTime: "17:00",
              endTime: "09:00",
            },
            precedence: 1,
          }),
        ]),
      ),
    ).toEqual([["Top", "Days", "Nights"]]);
  });

  test("with no precedence, or all the same, rotations on call together still split as before", () => {
    expect(
      names(
        groupRotationsIntoSchedules([
          rotation({ name: "Primary" }),
          rotation({ name: "Shadow" }),
        ]),
      ),
    ).toEqual([["Primary"], ["Shadow"]]);
    expect(
      names(
        groupRotationsIntoSchedules([
          rotation({ name: "Primary", precedence: 4 }),
          rotation({ name: "Shadow", precedence: 4 }),
        ]),
      ),
    ).toEqual([["Primary"], ["Shadow"]]);
    expect(groupRotationsIntoSchedules([])).toEqual([]);
  });

  test("a schedule of more layers than one may hold goes on in another", () => {
    const layers: Array<ImportedRotation> = Array.from(
      { length: TOOL_IMPORT_MAX_LAYERS_PER_SCHEDULE + 5 },
      (_: unknown, index: number): ImportedRotation => {
        return rotation({ name: `Layer ${index}`, precedence: 100 - index });
      },
    );

    expect(
      groupRotationsIntoSchedules(layers).map(
        (group: Array<ImportedRotation>) => {
          return group.length;
        },
      ),
    ).toEqual([TOOL_IMPORT_MAX_LAYERS_PER_SCHEDULE, 5]);
  });

  test("a precedence that is not a number counts as none", () => {
    expect(getRotationPrecedence(rotation({ name: "a" }))).toBe(0);
    expect(
      getRotationPrecedence(rotation({ name: "a", precedence: Number.NaN })),
    ).toBe(0);
    expect(getRotationPrecedence(rotation({ name: "a", precedence: 3 }))).toBe(
      3,
    );
  });

  test("a further schedule is named after its own rotation, never one every schedule shares", () => {
    const groups: Array<Array<ImportedRotation>> = groupRotationsIntoSchedules([
      rotation({ name: "Office", restriction: OFFICE, precedence: 2 }),
      rotation({ name: "Pair A", precedence: 0 }),
      rotation({ name: "Pair B", precedence: 0 }),
    ]);

    expect(
      getGroupScheduleName({
        scheduleName: "Platform",
        groupIndex: 1,
        group: groups[1]!,
        groups: groups,
        maxLength: 100,
      }),
    ).toBe("Platform (Pair B)");
    // Without the other groups to compare with, the first rotation names it.
    expect(
      getGroupScheduleName({
        scheduleName: "Platform",
        groupIndex: 1,
        group: groups[1]!,
        maxLength: 100,
      }),
    ).toBe("Platform (Office)");
  });
});

describe("ToolImportScheduleRules: turns in seconds, windows on days, and zones", () => {
  test.each([
    [604800, EventInterval.Week, 1, true],
    [1209600, EventInterval.Week, 2, true],
    [86400, EventInterval.Day, 1, true],
    [259200, EventInterval.Day, 3, true],
    [43200, EventInterval.Hour, 12, true],
    [3600, EventInterval.Hour, 1, true],
    [5400, EventInterval.Hour, 2, false],
    [1800, EventInterval.Hour, 1, false],
    [0, EventInterval.Hour, 1, false],
    [-60, EventInterval.Hour, 1, false],
  ] as Array<[number, EventInterval, number, boolean]>)(
    "a turn of %i seconds is %s x %i (exact: %s)",
    (
      seconds: number,
      intervalType: EventInterval,
      intervalCount: number,
      isExact: boolean,
    ) => {
      expect(toTurnInterval(seconds)).toEqual({
        intervalType: intervalType,
        intervalCount: intervalCount,
        isExact: isExact,
      });
    },
  );

  test("one window on every day is a daily restriction, overnight ones included", () => {
    const everyDay: (
      start: number,
      duration: number,
    ) => ImportedRestriction | null = (start: number, duration: number) => {
      return buildRestrictionFromDayWindows(
        [
          DayOfWeek.Sunday,
          DayOfWeek.Monday,
          DayOfWeek.Tuesday,
          DayOfWeek.Wednesday,
          DayOfWeek.Thursday,
          DayOfWeek.Friday,
          DayOfWeek.Saturday,
        ].map((day: DayOfWeek) => {
          return {
            day: day,
            startMinuteOfDay: start,
            durationMinutes: duration,
          };
        }),
      );
    };

    expect(everyDay(9 * 60, 8 * 60)).toEqual({
      type: "Daily",
      startTime: "09:00",
      endTime: "17:00",
    });
    expect(everyDay(22 * 60, 8 * 60)).toEqual({
      type: "Daily",
      startTime: "22:00",
      endTime: "06:00",
    });
    // The whole day, every day: no restriction.
    expect(everyDay(0, 24 * 60)).toBeNull();
    expect(everyDay(6 * 60, 30 * 60)).toBeNull();
  });

  test("windows on some days are weekly windows, across midnight and the end of the week", () => {
    expect(
      buildRestrictionFromDayWindows([
        {
          day: DayOfWeek.Saturday,
          startMinuteOfDay: 0,
          durationMinutes: 48 * 60,
        },
      ]),
    ).toEqual(WEEKEND);
    expect(
      buildRestrictionFromDayWindows([
        {
          day: DayOfWeek.Friday,
          startMinuteOfDay: 20 * 60,
          durationMinutes: 12 * 60,
        },
      ]),
    ).toEqual({
      type: "Weekly",
      windows: [
        {
          startDay: DayOfWeek.Friday,
          startTime: "20:00",
          endDay: DayOfWeek.Saturday,
          endTime: "08:00",
        },
      ],
    });
    // A window the length of the week leaves no hour out.
    expect(
      buildRestrictionFromDayWindows([
        {
          day: DayOfWeek.Wednesday,
          startMinuteOfDay: 9 * 60,
          durationMinutes: 7 * 24 * 60,
        },
      ]),
    ).toBeNull();
  });

  test("windows that are not windows are dropped, and with none left there is no restriction", () => {
    expect(buildRestrictionFromDayWindows([])).toBeNull();
    expect(
      buildRestrictionFromDayWindows([
        { day: DayOfWeek.Monday, startMinuteOfDay: 9 * 60, durationMinutes: 0 },
        {
          day: DayOfWeek.Monday,
          startMinuteOfDay: 24 * 60,
          durationMinutes: 60,
        },
        { day: DayOfWeek.Monday, startMinuteOfDay: -5, durationMinutes: 60 },
        {
          day: DayOfWeek.Monday,
          startMinuteOfDay: Number.NaN,
          durationMinutes: 60,
        },
      ]),
    ).toBeNull();
  });

  test("how far apart two zones are now, and whether daylight saving ever changes it", () => {
    const october: Date = new Date("2026-10-08T12:00:00Z");

    expect(
      getTimezoneDifference({
        timezone: "Europe/Berlin",
        otherTimezone: "UTC",
        at: october,
      }),
    ).toEqual({ minutes: 120, isConstant: false });
    expect(
      getTimezoneDifference({
        timezone: "Asia/Kolkata",
        otherTimezone: "UTC",
        at: october,
      }),
    ).toEqual({ minutes: 330, isConstant: true });
    expect(
      getTimezoneDifference({
        timezone: "America/New_York",
        otherTimezone: "Australia/Sydney",
        at: october,
      }),
    ).toEqual({ minutes: -900, isConstant: false });
    // Zones that change on the same dates stay the same distance apart.
    expect(
      getTimezoneDifference({
        timezone: "Europe/Paris",
        otherTimezone: "Europe/Berlin",
        at: october,
      }),
    ).toEqual({ minutes: 0, isConstant: true });
  });

  test("moving a restriction's hours into another zone moves its days with them", () => {
    expect(shiftRestriction(OFFICE, 120)).toEqual({
      type: "Daily",
      startTime: "11:00",
      endTime: "19:00",
    });
    expect(
      shiftRestriction(
        { type: "Daily", startTime: "22:00", endTime: "23:00" },
        120,
      ),
    ).toEqual({ type: "Daily", startTime: "00:00", endTime: "01:00" });
    expect(
      shiftRestriction(
        {
          type: "Weekly",
          windows: [
            {
              startDay: DayOfWeek.Monday,
              startTime: "23:00",
              endDay: DayOfWeek.Tuesday,
              endTime: "01:00",
            },
            {
              startDay: DayOfWeek.Sunday,
              startTime: "00:30",
              endDay: DayOfWeek.Sunday,
              endTime: "02:00",
            },
          ],
        },
        -60,
      ),
    ).toEqual({
      type: "Weekly",
      windows: [
        {
          startDay: DayOfWeek.Monday,
          startTime: "22:00",
          endDay: DayOfWeek.Tuesday,
          endTime: "00:00",
        },
        {
          startDay: DayOfWeek.Saturday,
          startTime: "23:30",
          endDay: DayOfWeek.Sunday,
          endTime: "01:00",
        },
      ],
    });
    expect(shiftRestriction(OFFICE, 0)).toBe(OFFICE);
    expect(shiftRestriction(null, 60)).toBeNull();
  });
});

describe("ToolImportScheduleRules: layers that override one another, through the on-call engine", () => {
  const SCHEDULE_ID: ObjectID = ObjectID.generate();
  const PROJECT_ID: ObjectID = ObjectID.generate();
  const ZONE: string = "America/New_York";
  const REFERENCE: Date = new Date("2026-10-08T12:00:00Z");

  const ALICE: string = "aaaaaaaa-1111-4111-8111-111111111111";
  const BOB: string = "bbbbbbbb-2222-4222-8222-222222222222";
  const CAROL: string = "cccccccc-3333-4333-8333-333333333333";

  function person(id: string): User {
    const user: User = new User();
    user.id = new ObjectID(id);
    return user;
  }

  function layerOf(
    item: ImportedRotation,
    order: number,
  ): OnCallDutyPolicyScheduleLayer {
    return buildLayerFromImportedRotation({
      rotation: item,
      scheduleId: SCHEDULE_ID,
      projectId: PROJECT_ID,
      name: item.name,
      order: order,
      timezone: ZONE,
      reference: REFERENCE,
    });
  }

  /*
   * PagerDuty's Primary schedule from the PagerDuty fixtures: Carol covers
   * weekends over Alice and Bob taking daily turns.
   */
  const groups: Array<Array<ImportedRotation>> = groupRotationsIntoSchedules([
    rotation({
      name: "Weekend cover",
      startsAt: "2026-01-03T05:00:00.000Z",
      restriction: WEEKEND,
      participantSourceIds: [CAROL],
      precedence: 3,
    }),
    rotation({
      name: "Layer 1",
      startsAt: "2026-01-05T14:00:00.000Z",
      intervalType: EventInterval.Day,
      participantSourceIds: [ALICE, BOB],
      precedence: 2,
    }),
  ]);

  function onCallAt(at: Date): string | null {
    const layers: Array<OnCallDutyPolicyScheduleLayer> = groups[0]!.map(
      (item: ImportedRotation, index: number) => {
        return layerOf(item, index + 1);
      },
    );

    const events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents({
      layers: layers.map(
        (layer: OnCallDutyPolicyScheduleLayer, index: number) => {
          return {
            users: groups[0]![index]!.participantSourceIds.map(person),
            startDateTimeOfLayer: layer.startsAt!,
            handOffTime: layer.handOffTime!,
            rotation: layer.rotation!,
            restrictionTimes: layer.restrictionTimes!,
            timezone: ZONE,
          };
        },
      ),
      calendarStartDate: new Date(at.getTime() - 60 * 1000),
      calendarEndDate: new Date(at.getTime() + 60 * 1000),
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

  test("it is one schedule, the weekend layer first", () => {
    expect(names(groups)).toEqual([["Weekend cover", "Layer 1"]]);
  });

  test("the weekend layer is on call over the daily one on Saturday and Sunday, and the daily one on weekdays", () => {
    // Saturday Oct 10 and Sunday Oct 11, midday in New York: Carol.
    expect(onCallAt(new Date("2026-10-10T16:00:00Z"))).toBe(CAROL);
    expect(onCallAt(new Date("2026-10-11T16:00:00Z"))).toBe(CAROL);

    // Weekdays: whoever's daily turn it is, counted from Monday Jan 5 09:00.
    const start: number = Date.parse("2026-01-05T14:00:00Z");
    const day: number = 24 * 60 * 60 * 1000;

    for (const at of ["2026-10-08T16:00:00Z", "2026-10-12T16:00:00Z"]) {
      const turn: number = Math.floor((Date.parse(at) - start) / day);

      expect(onCallAt(new Date(at))).toBe(turn % 2 === 0 ? ALICE : BOB);
    }
  });
});
