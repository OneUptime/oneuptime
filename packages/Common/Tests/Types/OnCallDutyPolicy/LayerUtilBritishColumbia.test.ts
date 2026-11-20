import LayerUtil from "../../../Types/OnCallDutyPolicy/Layer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import User from "../../../Models/DatabaseModels/User";
import EventInterval from "../../../Types/Events/EventInterval";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import Timezone from "../../../Types/Timezone";
import { describe, expect, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * ON-CALL IN BRITISH COLUMBIA ACROSS 2026-11-01 (issue #9999).
 *
 * British Columbia stayed on UTC-7 when the rest of the Pacific zone fell
 * back on 2026-11-01 (tzdata 2026b). A schedule's layer works out its
 * rotation, its handoffs and its restriction windows in the schedule's
 * zone (LayerUtil), on moment-timezone's data. With tzdata 2024b it read
 * British Columbia as UTC-8 from 1 November, so a 09:00 handoff happened at
 * 10:00 on Vancouver's clocks and a 09:00 to 17:00 restriction ran from
 * 10:00 to 18:00.
 *
 * These walk a layer of each kind across the night of the change, in
 * America/Vancouver and in Canada/Pacific (its legacy name, which saved
 * schedules still hold), and check each handoff and each window lands on
 * the wall-clock time it was set for - and so at the same UTC time before
 * and after, since nothing moved. Los Angeles and Tijuana keep daylight
 * saving time: their handoffs stay at 09:00 local too, an hour later in
 * UTC from 1 November.
 *
 * Who is on call is read at an instant (whoIsOnCallAt), a minute either
 * side of each handoff and window edge, so the assertions hold whatever the
 * layer's events look like on the inside.
 */

const BRITISH_COLUMBIA: Array<Timezone> = [
  Timezone.AmericaVancouver,
  Timezone.CanadaPacific,
];

const STILL_ON_DAYLIGHT_SAVING: Array<Timezone> = [
  Timezone.AmericaLos_Angeles,
  Timezone.AmericaTijuana,
];

const MINUTE_MS: number = 60 * 1000;

function user(id: string): User {
  return {
    id: {
      toString: () => {
        return id;
      },
    } as unknown as User["id"],
  } as User;
}

const ALICE: User = user("alice");
const BOB: User = user("bob");
const CAROL: User = user("carol");

function rotation(
  intervalType: EventInterval,
  intervalCount: number,
): Recurring {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: intervalType,
      intervalCount: { _type: "PositiveNumber", value: intervalCount },
    },
  });
}

function noRestriction(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.None;
  restrictionTimes.dayRestrictionTimes = null;
  return restrictionTimes;
}

// The instant `wallClock` ("2026-11-02 09:00") names in `zone`.
function at(wallClock: string, zone: string): Date {
  return moment.tz(wallClock, zone).toDate();
}

// `instant` on `zone`'s clock: "2026-11-02 09:00".
function wallClockOf(instant: Date, zone: string): string {
  return moment.tz(instant, zone).format("YYYY-MM-DD HH:mm");
}

function shift(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MINUTE_MS);
}

// Who the layer has on call at `instant`, or null.
function whoIsOnCallAt(
  events: Array<CalendarEvent>,
  instant: Date,
): string | null {
  for (const event of events) {
    if (
      event.start.getTime() <= instant.getTime() &&
      instant.getTime() < event.end.getTime()
    ) {
      return event.title;
    }
  }

  return null;
}

function eventsOf(data: {
  zone: string;
  users: Array<User>;
  layerStartsAt: string;
  handOffAt?: string | undefined;
  rotation: Recurring;
  restrictionTimes?: RestrictionTimes | undefined;
  calendarFrom: string;
  calendarTo: string;
}): Array<CalendarEvent> {
  const layerStart: Date = at(data.layerStartsAt, data.zone);

  return new LayerUtil().getEvents({
    users: data.users,
    startDateTimeOfLayer: layerStart,
    handOffTime: at(data.handOffAt || data.layerStartsAt, data.zone),
    restrictionTimes: data.restrictionTimes || noRestriction(),
    rotation: data.rotation,
    timezone: data.zone,
    calendarStartDate: at(data.calendarFrom, data.zone),
    calendarEndDate: at(data.calendarTo, data.zone),
  });
}

/*
 * Who is on call a minute before and a minute after `wallClock` in `zone`:
 * a handoff at that time reads [the one handing off, the one taking over].
 */
function aroundHandoff(
  events: Array<CalendarEvent>,
  wallClock: string,
  zone: string,
): [string | null, string | null] {
  const handoff: Date = at(wallClock, zone);

  return [
    whoIsOnCallAt(events, shift(handoff, -1)),
    whoIsOnCallAt(events, shift(handoff, 1)),
  ];
}

describe.each(BRITISH_COLUMBIA)("a daily rotation in %s", (zone: Timezone) => {
  // Handing off at 09:00, from Thursday 29 October to Thursday 5 November.
  const events: Array<CalendarEvent> = eventsOf({
    zone: zone,
    users: [ALICE, BOB],
    layerStartsAt: "2026-10-29 09:00",
    rotation: rotation(EventInterval.Day, 1),
    calendarFrom: "2026-10-29 00:00",
    calendarTo: "2026-11-06 00:00",
  });

  const days: Array<[string, string, string]> = [
    // [the day, who hands off at 09:00, who takes over]
    ["2026-10-30", "alice", "bob"],
    ["2026-10-31", "bob", "alice"],
    // The night British Columbia no longer falls back.
    ["2026-11-01", "alice", "bob"],
    ["2026-11-02", "bob", "alice"],
    ["2026-11-03", "alice", "bob"],
    ["2026-11-04", "bob", "alice"],
    ["2026-11-05", "alice", "bob"],
  ];

  test.each(days)(
    "hands off at 09:00 on %s, from %s to %s",
    (day: string, handingOff: string, takingOver: string) => {
      expect(aroundHandoff(events, `${day} 09:00`, zone)).toEqual([
        handingOff,
        takingOver,
      ]);
    },
  );

  test("hands off at 16:00 UTC every day, before and after 2026-11-01: UTC-7 throughout", () => {
    for (const [day] of days) {
      expect(at(`${day} 09:00`, zone).toISOString()).toBe(
        `${day}T16:00:00.000Z`,
      );
      expect(whoIsOnCallAt(events, new Date(`${day}T15:59:00.000Z`))).not.toBe(
        whoIsOnCallAt(events, new Date(`${day}T16:01:00.000Z`)),
      );
    }
  });

  test("has nobody's turn handed off at 10:00, where tzdata 2024b put it", () => {
    for (const [day] of days.slice(2)) {
      expect(whoIsOnCallAt(events, at(`${day} 09:59`, zone))).toBe(
        whoIsOnCallAt(events, at(`${day} 10:01`, zone)),
      );
    }
  });

  test("gives the turn spanning the night of 2026-11-01 its 24 hours, not 25", () => {
    const turnStart: Date = at("2026-10-31 09:00", zone);
    const turnEnd: Date = at("2026-11-01 09:00", zone);

    expect(turnEnd.getTime() - turnStart.getTime()).toBe(24 * 60 * MINUTE_MS);
    // Alice's turn, all of it.
    for (const minutes of [
      1,
      60 * 12,
      60 * 16 + 30,
      60 * 17 + 30,
      60 * 24 - 1,
    ]) {
      expect(whoIsOnCallAt(events, shift(turnStart, minutes))).toBe("alice");
    }
  });
});

describe.each(BRITISH_COLUMBIA)(
  "a weekly rotation in %s, handing off on Mondays at 09:00",
  (zone: Timezone) => {
    const events: Array<CalendarEvent> = eventsOf({
      zone: zone,
      users: [ALICE, BOB, CAROL],
      layerStartsAt: "2026-10-26 09:00",
      rotation: rotation(EventInterval.Week, 1),
      calendarFrom: "2026-10-26 00:00",
      calendarTo: "2026-11-24 00:00",
    });

    test.each([
      ["2026-11-02", "alice", "bob"],
      ["2026-11-09", "bob", "carol"],
      ["2026-11-16", "carol", "alice"],
      ["2026-11-23", "alice", "bob"],
    ])(
      "hands off at 09:00 on Monday %s, from %s to %s",
      (day: string, handingOff: string, takingOver: string) => {
        expect(aroundHandoff(events, `${day} 09:00`, zone)).toEqual([
          handingOff,
          takingOver,
        ]);
        expect(at(`${day} 09:00`, zone).toISOString()).toBe(
          `${day}T16:00:00.000Z`,
        );
      },
    );

    test("keeps the whole week across 2026-11-01 with whoever had it", () => {
      for (const wallClock of [
        "2026-10-31 23:59",
        "2026-11-01 01:30",
        "2026-11-01 02:30",
        "2026-11-02 08:59",
      ]) {
        expect(whoIsOnCallAt(events, at(wallClock, zone))).toBe("alice");
      }
    });
  },
);

describe.each(BRITISH_COLUMBIA)(
  "a 12-hour rotation in %s, handing off at 09:00 and 21:00",
  (zone: Timezone) => {
    const events: Array<CalendarEvent> = eventsOf({
      zone: zone,
      users: [ALICE, BOB],
      layerStartsAt: "2026-10-30 09:00",
      rotation: rotation(EventInterval.Hour, 12),
      calendarFrom: "2026-10-30 00:00",
      calendarTo: "2026-11-04 00:00",
    });

    test("hands off at 09:00 and 21:00 every day across 2026-11-01, never at 08:00 or 20:00", () => {
      const handoffs: Array<string> = [];

      for (const event of events) {
        handoffs.push(wallClockOf(event.start, zone).slice(11));
      }

      expect(new Set(handoffs)).toEqual(new Set(["09:00", "21:00"]));

      for (const day of [
        "2026-10-31",
        "2026-11-01",
        "2026-11-02",
        "2026-11-03",
      ]) {
        expect(aroundHandoff(events, `${day} 09:00`, zone)).toEqual([
          "bob",
          "alice",
        ]);
        expect(aroundHandoff(events, `${day} 21:00`, zone)).toEqual([
          "alice",
          "bob",
        ]);
      }
    });
  },
);

describe.each(BRITISH_COLUMBIA)(
  "a daily restriction from 09:00 to 17:00 in %s",
  (zone: Timezone) => {
    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.restictionType = RestrictionType.Daily;
    // Set in the summer, as most schedules were: read on each day's clock.
    restrictionTimes.dayRestrictionTimes = {
      startTime: at("2026-08-03 09:00", zone),
      endTime: at("2026-08-03 17:00", zone),
    };

    const events: Array<CalendarEvent> = eventsOf({
      zone: zone,
      users: [ALICE],
      layerStartsAt: "2026-10-29 00:00",
      rotation: rotation(EventInterval.Day, 1),
      restrictionTimes: restrictionTimes,
      calendarFrom: "2026-10-29 00:00",
      calendarTo: "2026-11-06 00:00",
    });

    test.each([
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ])("covers 09:00 to 17:00 on %s, and no more", (day: string) => {
      expect(whoIsOnCallAt(events, at(`${day} 08:59`, zone))).toBeNull();
      expect(whoIsOnCallAt(events, at(`${day} 09:01`, zone))).toBe("alice");
      expect(whoIsOnCallAt(events, at(`${day} 16:59`, zone))).toBe("alice");
      expect(whoIsOnCallAt(events, at(`${day} 17:01`, zone))).toBeNull();

      // 16:00 to midnight UTC, on either side of 2026-11-01.
      expect(at(`${day} 09:00`, zone).toISOString()).toBe(
        `${day}T16:00:00.000Z`,
      );
    });

    test("leaves 17:00 to 18:00 uncovered after 2026-11-01, where tzdata 2024b ran the window to", () => {
      for (const day of ["2026-11-02", "2026-11-03", "2026-11-04"]) {
        expect(whoIsOnCallAt(events, at(`${day} 17:30`, zone))).toBeNull();
        expect(whoIsOnCallAt(events, at(`${day} 09:30`, zone))).toBe("alice");
      }
    });
  },
);

describe.each(BRITISH_COLUMBIA)(
  "a weekly restriction from Monday 09:00 to Friday 17:00 in %s",
  (zone: Timezone) => {
    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.restictionType = RestrictionType.Weekly;
    const workWeek: WeeklyResctriction = {
      startDay: DayOfWeek.Monday,
      startTime: at("2026-08-03 09:00", zone),
      endDay: DayOfWeek.Friday,
      endTime: at("2026-08-07 17:00", zone),
    };
    restrictionTimes.weeklyRestrictionTimes = [workWeek];

    const events: Array<CalendarEvent> = eventsOf({
      zone: zone,
      users: [ALICE],
      layerStartsAt: "2026-10-26 00:00",
      rotation: rotation(EventInterval.Week, 1),
      restrictionTimes: restrictionTimes,
      calendarFrom: "2026-10-26 00:00",
      calendarTo: "2026-11-14 00:00",
    });

    test.each([
      ["2026-10-26", "2026-10-30"],
      ["2026-11-02", "2026-11-06"],
      ["2026-11-09", "2026-11-13"],
    ])(
      "covers Monday %s 09:00 to Friday %s 17:00",
      (monday: string, friday: string) => {
        expect(whoIsOnCallAt(events, at(`${monday} 08:59`, zone))).toBeNull();
        expect(whoIsOnCallAt(events, at(`${monday} 09:01`, zone))).toBe(
          "alice",
        );
        expect(whoIsOnCallAt(events, at(`${friday} 16:59`, zone))).toBe(
          "alice",
        );
        expect(whoIsOnCallAt(events, at(`${friday} 17:01`, zone))).toBeNull();
      },
    );

    test("leaves the weekend of 2026-10-31 and 2026-11-01 uncovered", () => {
      for (const wallClock of [
        "2026-10-31 12:00",
        "2026-11-01 01:30",
        "2026-11-01 12:00",
      ]) {
        expect(whoIsOnCallAt(events, at(wallClock, zone))).toBeNull();
      }
    });
  },
);

describe.each(STILL_ON_DAYLIGHT_SAVING)(
  "a daily rotation in %s, which still falls back",
  (zone: Timezone) => {
    const events: Array<CalendarEvent> = eventsOf({
      zone: zone,
      users: [ALICE, BOB],
      layerStartsAt: "2026-10-29 09:00",
      rotation: rotation(EventInterval.Day, 1),
      calendarFrom: "2026-10-29 00:00",
      calendarTo: "2026-11-06 00:00",
    });

    test.each([
      ["2026-10-30", "2026-10-30T16:00:00.000Z"],
      ["2026-10-31", "2026-10-31T16:00:00.000Z"],
      // Fallen back to UTC-8: 09:00 is an hour later in UTC.
      ["2026-11-01", "2026-11-01T17:00:00.000Z"],
      ["2026-11-02", "2026-11-02T17:00:00.000Z"],
      ["2026-11-05", "2026-11-05T17:00:00.000Z"],
    ])("hands off at 09:00 on %s, which is %s", (day: string, utc: string) => {
      expect(at(`${day} 09:00`, zone).toISOString()).toBe(utc);

      const [handingOff, takingOver] = aroundHandoff(
        events,
        `${day} 09:00`,
        zone,
      );

      expect(handingOff).not.toBeNull();
      expect(takingOver).not.toBeNull();
      expect(handingOff).not.toBe(takingOver);
    });

    test("gives the turn spanning the night of 2026-11-01 its 25 hours", () => {
      const turnStart: Date = at("2026-10-31 09:00", zone);
      const turnEnd: Date = at("2026-11-01 09:00", zone);

      expect(turnEnd.getTime() - turnStart.getTime()).toBe(25 * 60 * MINUTE_MS);
      expect(whoIsOnCallAt(events, shift(turnEnd, -1))).toBe(
        whoIsOnCallAt(events, shift(turnStart, 1)),
      );
    });
  },
);

describe.each(STILL_ON_DAYLIGHT_SAVING)(
  "a daily restriction from 09:00 to 17:00 in %s, which still falls back",
  (zone: Timezone) => {
    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.restictionType = RestrictionType.Daily;
    restrictionTimes.dayRestrictionTimes = {
      startTime: at("2026-08-03 09:00", zone),
      endTime: at("2026-08-03 17:00", zone),
    };

    const events: Array<CalendarEvent> = eventsOf({
      zone: zone,
      users: [ALICE],
      layerStartsAt: "2026-10-29 00:00",
      rotation: rotation(EventInterval.Day, 1),
      restrictionTimes: restrictionTimes,
      calendarFrom: "2026-10-29 00:00",
      calendarTo: "2026-11-06 00:00",
    });

    test.each(["2026-10-30", "2026-11-01", "2026-11-03"])(
      "covers 09:00 to 17:00 on %s on its own clock",
      (day: string) => {
        expect(whoIsOnCallAt(events, at(`${day} 08:59`, zone))).toBeNull();
        expect(whoIsOnCallAt(events, at(`${day} 09:01`, zone))).toBe("alice");
        expect(whoIsOnCallAt(events, at(`${day} 16:59`, zone))).toBe("alice");
        expect(whoIsOnCallAt(events, at(`${day} 17:01`, zone))).toBeNull();
      },
    );

    test("starts the window at 16:00 UTC before 2026-11-01 and at 17:00 UTC after", () => {
      expect(whoIsOnCallAt(events, new Date("2026-10-30T16:01:00.000Z"))).toBe(
        "alice",
      );
      expect(
        whoIsOnCallAt(events, new Date("2026-11-03T16:01:00.000Z")),
      ).toBeNull();
      expect(whoIsOnCallAt(events, new Date("2026-11-03T17:01:00.000Z"))).toBe(
        "alice",
      );
    });
  },
);

/*
 * WHAT PEOPLE IN BRITISH COLUMBIA SHOULD CHECK.
 *
 * A time typed in British Columbia for a day on or after 2026-11-01 was
 * saved, with tzdata 2024b, as the UTC-8 instant it named: 09:00 as 17:00
 * UTC. Saved instants are not rewritten, so on British Columbia's real
 * clock such a time now reads an hour later than was typed - 10:00 - and
 * its handoffs follow it. Times set on a summer day (as above), or set
 * again now, are right. The release notes and the on-call docs ask people
 * there to check times set since 1 November.
 */
describe("a handoff time saved for a November day before this release", () => {
  const zone: Timezone = Timezone.AmericaVancouver;

  // What "09:00 on 2026-11-10" was saved as with tzdata 2024b: UTC-8.
  const savedWithOldData: Date = new Date("2026-11-10T17:00:00.000Z");

  test("reads 10:00 on British Columbia's clock, and hands off then", () => {
    expect(wallClockOf(savedWithOldData, zone)).toBe("2026-11-10 10:00");

    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [ALICE, BOB],
      startDateTimeOfLayer: savedWithOldData,
      handOffTime: savedWithOldData,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: zone,
      calendarStartDate: at("2026-11-10 00:00", zone),
      calendarEndDate: at("2026-11-14 00:00", zone),
    });

    expect(aroundHandoff(events, "2026-11-11 10:00", zone)).toEqual([
      "alice",
      "bob",
    ]);
    expect(whoIsOnCallAt(events, at("2026-11-11 08:59", zone))).toBe(
      whoIsOnCallAt(events, at("2026-11-11 09:01", zone)),
    );
  });

  test("set again as 09:00, it is saved as 16:00 UTC and hands off at 09:00", () => {
    const setAgain: Date = at("2026-11-10 09:00", zone);

    expect(setAgain.toISOString()).toBe("2026-11-10T16:00:00.000Z");

    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [ALICE, BOB],
      startDateTimeOfLayer: setAgain,
      handOffTime: setAgain,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: zone,
      calendarStartDate: at("2026-11-10 00:00", zone),
      calendarEndDate: at("2026-11-14 00:00", zone),
    });

    expect(aroundHandoff(events, "2026-11-11 09:00", zone)).toEqual([
      "alice",
      "bob",
    ]);
  });
});
