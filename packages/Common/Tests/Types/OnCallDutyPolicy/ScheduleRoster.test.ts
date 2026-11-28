import moment from "moment-timezone";
import User from "../../../Models/DatabaseModels/User";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import EventInterval from "../../../Types/Events/EventInterval";
import { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import ScheduleResolution from "../../../Types/OnCallDutyPolicy/ScheduleResolution";
import ScheduleRoster, {
  RosterShift,
  ScheduleRosterState,
} from "../../../Types/OnCallDutyPolicy/ScheduleRoster";
import ScheduleShiftUtil, {
  TimelineShift,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import { UserOverrideRecord } from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";
import {
  dailyRestriction,
  noRestriction,
  rotation,
  tzInstant,
  user,
} from "./CalendarFeedTestFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * THE ROSTER, READ FROM THE SHIFTS THE SCHEDULE TIMELINE SHOWS (#11268), AND
 * THE TURN IT IS IN (#11270).
 *
 * The customer's schedule: one layer, a weekly rotation handing off on
 * Mondays, on call from 17:00 to 07:00 - a window the engine hands out as two
 * segments, split at midnight. The "You are now on-call" email said the shift
 * ended at 11:59 PM; the timeline said 07:00 the next morning. The roster now
 * reads the timeline's shifts, so the two can never disagree: checked at
 * every hour of a fortnight, in Europe/Warsaw (the customer's) and
 * America/New_York, and on the nights the clocks change in each.
 *
 * And the turn: a person's windows of one rotation turn share it, the roster
 * keeps it through the hours between them, and a person is told once when
 * their turn starts and once when it ends - not at every window - while a
 * real hand-off (somebody else on call between, an override, a change made
 * between windows) is told as before.
 */

const WARSAW: string = "Europe/Warsaw";
const NEW_YORK: string = "America/New_York";

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

const ALICE: User = user("alice");
const BOB: User = user("bob");
const CARL: User = user("carl");

// "Thu, Nov 26, 17:00" in `tz`.
function wallClock(date: Date, tz: string): string {
  return moment.tz(date, tz).format("ddd, MMM D, HH:mm");
}

/*
 * The customer's layer, in `tz`: weekly turns from Monday `startDay`, each
 * person on call from 17:00 to 07:00.
 */
function nightsLayer(data: {
  tz: string;
  startDay: string;
  users?: Array<User>;
  layerId?: string;
  restrictionTimes?: RestrictionTimes;
}): LayerProps {
  return {
    users: data.users || [ALICE, BOB],
    startDateTimeOfLayer: tzInstant(`${data.startDay} 09:00`, data.tz),
    handOffTime: tzInstant(`${data.startDay} 09:00`, data.tz),
    rotation: rotation(EventInterval.Week, 1),
    restrictionTimes:
      data.restrictionTimes || dailyRestriction("17:00", "07:00", data.tz),
    timezone: data.tz,
    layerId: data.layerId || "nights",
  };
}

/*
 * What the roster refresh resolves at `now`: from two weeks back (two
 * rotation periods) to well past the next shift, as
 * getCurrrentUserIdAndHandoffTimeInSchedule does.
 */
function resolveAt(
  layers: Array<LayerProps>,
  now: Date,
  overrides?: Array<UserOverrideRecord>,
): { segments: Array<CalendarEvent>; windowEnd: Date } {
  const windowEnd: Date = new Date(now.getTime() + 60 * DAY_MS);

  return {
    segments: ScheduleResolution.resolve({
      layers: layers,
      calendarStartDate: new Date(now.getTime() - 14 * DAY_MS),
      calendarEndDate: windowEnd,
      overrides: overrides || [],
    }).events,
    windowEnd: windowEnd,
  };
}

function rosterAt(
  layers: Array<LayerProps>,
  now: Date,
  overrides?: Array<UserOverrideRecord>,
): ScheduleRosterState {
  const resolved: { segments: Array<CalendarEvent>; windowEnd: Date } =
    resolveAt(layers, now, overrides);

  return ScheduleRoster.getRoster({
    segments: resolved.segments,
    now: now,
    windowEnd: resolved.windowEnd,
  });
}

function describeShift(shift: RosterShift | null, tz: string): string | null {
  if (!shift) {
    return null;
  }

  return `${shift.userId}: ${wallClock(shift.start, tz)} -> ${wallClock(shift.end, tz)}`;
}

describe("REGRESSION #11268: an overnight window ends when the timeline says it does", () => {
  // The customer's: Europe/Warsaw, turns from Monday Nov 23, 2026.
  const layers: Array<LayerProps> = [
    nightsLayer({ tz: WARSAW, startDay: "2026-11-23" }),
  ];

  test("the email's moment, 17:00 on Thu Nov 26: on call until 07:00 Fri, not 11:59 PM", () => {
    const now: Date = tzInstant("2026-11-26 17:00", WARSAW);
    const roster: ScheduleRosterState = rosterAt(layers, now);

    expect(describeShift(roster.current, WARSAW)).toBe(
      "alice: Thu, Nov 26, 17:00 -> Fri, Nov 27, 07:00",
    );

    // The raw segment the roster used to read: split at midnight.
    const firstSegment: CalendarEvent = resolveAt(layers, now).segments.find(
      (segment: CalendarEvent): boolean => {
        return segment.start.getTime() === now.getTime();
      },
    )!;
    expect(moment.tz(firstSegment.end, WARSAW).format("HH:mm:ss")).toBe(
      "23:59:59",
    );

    // Next: her own next night, in the same turn.
    expect(describeShift(roster.next, WARSAW)).toBe(
      "alice: Fri, Nov 27, 17:00 -> Sat, Nov 28, 07:00",
    );
    expect(roster.next!.turnKey).toBe(roster.current!.turnKey);

    // Her turn's last window: Sunday night into Monday's hand-off.
    expect(wallClock(roster.current!.turnEndsAt!, WARSAW)).toBe(
      "Mon, Nov 30, 07:00",
    );
  });

  test("after midnight the shift still started at 17:00 - not at 00:00", () => {
    const roster: ScheduleRosterState = rosterAt(
      layers,
      tzInstant("2026-11-27 01:30", WARSAW),
    );

    expect(describeShift(roster.current, WARSAW)).toBe(
      "alice: Thu, Nov 26, 17:00 -> Fri, Nov 27, 07:00",
    );
  });

  test("between windows nobody is on call, and the next window is next", () => {
    const roster: ScheduleRosterState = rosterAt(
      layers,
      tzInstant("2026-11-27 12:00", WARSAW),
    );

    expect(roster.current).toBeNull();
    expect(describeShift(roster.next, WARSAW)).toBe(
      "alice: Fri, Nov 27, 17:00 -> Sat, Nov 28, 07:00",
    );
  });

  test("the last window of a turn: no turn end beyond it, and the next turn is someone else's", () => {
    const roster: ScheduleRosterState = rosterAt(
      layers,
      tzInstant("2026-11-29 20:00", WARSAW),
    );

    expect(describeShift(roster.current, WARSAW)).toBe(
      "alice: Sun, Nov 29, 17:00 -> Mon, Nov 30, 07:00",
    );
    expect(roster.current!.turnEndsAt).toBeNull();

    expect(describeShift(roster.next, WARSAW)).toBe(
      "bob: Mon, Nov 30, 17:00 -> Tue, Dec 1, 07:00",
    );
    expect(roster.next!.turnKey).not.toBe(roster.current!.turnKey);
    expect(wallClock(roster.next!.turnEndsAt!, WARSAW)).toBe(
      "Mon, Dec 7, 07:00",
    );
  });
});

/*
 * Every hour of a fortnight: the roster's shift is one the timeline
 * shows, covering now, and the next is the timeline's next - exactly.
 */
function sweep(layers: Array<LayerProps>, tz: string, from: string): void {
  const start: Date = tzInstant(from, tz);

  for (let step: number = 0; step < 14 * 24; step++) {
    const now: Date = new Date(start.getTime() + step * HOUR_MS);
    const resolved: { segments: Array<CalendarEvent>; windowEnd: Date } =
      resolveAt(layers, now);
    const roster: ScheduleRosterState = ScheduleRoster.getRoster({
      segments: resolved.segments,
      now: now,
      windowEnd: resolved.windowEnd,
    });
    const timeline: Array<TimelineShift> = ScheduleShiftUtil.getTimelineShifts(
      resolved.segments,
    );

    const covering: TimelineShift | undefined = timeline.find(
      (shift: TimelineShift): boolean => {
        return (
          shift.start.getTime() <= now.getTime() &&
          shift.end.getTime() > now.getTime()
        );
      },
    );

    const at: string = wallClock(now, tz);

    if (!covering) {
      expect({ at, current: roster.current }).toEqual({ at, current: null });
    } else {
      expect({
        at,
        start: roster.current?.start.toISOString(),
        end: roster.current?.end.toISOString(),
        userId: roster.current?.userId,
      }).toEqual({
        at,
        start: covering.start.toISOString(),
        end: covering.end.toISOString(),
        userId: covering.userId,
      });

      // An overnight window ends at 07:00 on the zone's clock, never at midnight.
      expect({
        at,
        end: moment.tz(roster.current!.end, tz).format("HH:mm"),
      }).toEqual({ at, end: "07:00" });
    }

    const after: number = covering ? covering.end.getTime() : now.getTime();
    const expectedNext: TimelineShift | undefined = timeline.find(
      (shift: TimelineShift): boolean => {
        return covering
          ? shift !== covering && shift.start.getTime() >= after
          : shift.start.getTime() > after;
      },
    );

    expect({
      at,
      next: roster.next ? roster.next.start.toISOString() : null,
    }).toEqual({
      at,
      next: expectedNext ? expectedNext.start.toISOString() : null,
    });
  }
}

describe("the roster is the timeline's shift at every moment, in two zones", () => {
  test("Europe/Warsaw, a fortnight from Monday Nov 23, 2026", () => {
    sweep(
      [nightsLayer({ tz: WARSAW, startDay: "2026-11-23" })],
      WARSAW,
      "2026-11-23 00:00",
    );
  });

  test("America/New_York, a fortnight from Monday Nov 23, 2026", () => {
    sweep(
      [nightsLayer({ tz: NEW_YORK, startDay: "2026-11-23" })],
      NEW_YORK,
      "2026-11-23 00:00",
    );
  });

  test("Europe/Warsaw, across both changes of the clocks in 2026", () => {
    sweep(
      [nightsLayer({ tz: WARSAW, startDay: "2026-03-23" })],
      WARSAW,
      "2026-03-23 00:00",
    );
    sweep(
      [nightsLayer({ tz: WARSAW, startDay: "2026-10-19" })],
      WARSAW,
      "2026-10-19 00:00",
    );
  });

  test("America/New_York, across both changes of the clocks in 2026", () => {
    sweep(
      [nightsLayer({ tz: NEW_YORK, startDay: "2026-03-02" })],
      NEW_YORK,
      "2026-03-02 00:00",
    );
    sweep(
      [nightsLayer({ tz: NEW_YORK, startDay: "2026-10-26" })],
      NEW_YORK,
      "2026-10-26 00:00",
    );
  });
});

describe("the nights the clocks change: 17:00 to 07:00 on the zone's clock", () => {
  const cases: Array<{
    name: string;
    tz: string;
    startDay: string;
    during: string;
    shift: string;
    hours: number;
  }> = [
    {
      name: "Warsaw springs forward (Sun Mar 29, 2026): 13 hours",
      tz: WARSAW,
      startDay: "2026-03-23",
      during: "2026-03-29 01:30",
      shift: "alice: Sat, Mar 28, 17:00 -> Sun, Mar 29, 07:00",
      hours: 13,
    },
    {
      name: "Warsaw falls back (Sun Oct 25, 2026): 15 hours",
      tz: WARSAW,
      startDay: "2026-10-19",
      during: "2026-10-25 04:00",
      shift: "alice: Sat, Oct 24, 17:00 -> Sun, Oct 25, 07:00",
      hours: 15,
    },
    {
      name: "New York springs forward (Sun Mar 8, 2026): 13 hours",
      tz: NEW_YORK,
      startDay: "2026-03-02",
      during: "2026-03-08 04:00",
      shift: "alice: Sat, Mar 7, 17:00 -> Sun, Mar 8, 07:00",
      hours: 13,
    },
    {
      name: "New York falls back (Sun Nov 1, 2026): 15 hours",
      tz: NEW_YORK,
      startDay: "2026-10-26",
      during: "2026-11-01 05:00",
      shift: "alice: Sat, Oct 31, 17:00 -> Sun, Nov 1, 07:00",
      hours: 15,
    },
  ];

  for (const testCase of cases) {
    test(testCase.name, () => {
      const roster: ScheduleRosterState = rosterAt(
        [nightsLayer({ tz: testCase.tz, startDay: testCase.startDay })],
        tzInstant(testCase.during, testCase.tz),
      );

      expect(describeShift(roster.current, testCase.tz)).toBe(testCase.shift);
      expect(
        (roster.current!.end.getTime() - roster.current!.start.getTime()) /
          HOUR_MS,
      ).toBe(testCase.hours);
    });
  }

  test("New York's hour that comes twice: the same shift either time", () => {
    const layers: Array<LayerProps> = [
      nightsLayer({ tz: NEW_YORK, startDay: "2026-10-26" }),
    ];
    // 01:30 EDT, then 01:30 EST an hour later.
    const first: Date = new Date("2026-11-01T05:30:00.000Z");
    const second: Date = new Date("2026-11-01T06:30:00.000Z");

    for (const now of [first, second]) {
      expect(describeShift(rosterAt(layers, now).current, NEW_YORK)).toBe(
        "alice: Sat, Oct 31, 17:00 -> Sun, Nov 1, 07:00",
      );
    }
  });
});

describe("the turn: which shifts are one turn of active hours", () => {
  test("a turn's windows share its turn, and the next turn does not", () => {
    const layers: Array<LayerProps> = [
      nightsLayer({ tz: WARSAW, startDay: "2026-11-23" }),
    ];
    const timeline: Array<TimelineShift> = ScheduleShiftUtil.getTimelineShifts(
      resolveAt(layers, tzInstant("2026-11-30 12:00", WARSAW)).segments,
    );

    const alices: Array<TimelineShift> = timeline.filter(
      (shift: TimelineShift): boolean => {
        return (
          shift.userId === "alice" &&
          shift.start.getTime() >=
            tzInstant("2026-11-23 00:00", WARSAW).getTime() &&
          shift.start.getTime() <
            tzInstant("2026-11-30 12:00", WARSAW).getTime()
        );
      },
    );
    const bobs: Array<TimelineShift> = timeline.filter(
      (shift: TimelineShift): boolean => {
        return (
          shift.userId === "bob" &&
          shift.start.getTime() >=
            tzInstant("2026-11-30 12:00", WARSAW).getTime() &&
          shift.start.getTime() <
            tzInstant("2026-12-07 12:00", WARSAW).getTime()
        );
      },
    );

    // Seven nights each: Monday night to the Monday morning of the hand-off.
    expect(alices).toHaveLength(7);
    expect(bobs).toHaveLength(7);
    expect(
      new Set(
        alices.map((shift: TimelineShift): string => {
          return shift.turnKey;
        }),
      ).size,
    ).toBe(1);
    expect(bobs[0]!.turnKey).not.toBe(alices[0]!.turnKey);
  });

  test("a turn of a layer with no active hours is one shift, with no turn end", () => {
    const roster: ScheduleRosterState = rosterAt(
      [
        nightsLayer({
          tz: WARSAW,
          startDay: "2026-11-23",
          restrictionTimes: noRestriction(),
        }),
      ],
      tzInstant("2026-11-26 17:00", WARSAW),
    );

    expect(describeShift(roster.current, WARSAW)).toBe(
      "alice: Mon, Nov 23, 09:00 -> Mon, Nov 30, 09:00",
    );
    expect(roster.current!.turnEndsAt).toBeNull();
    expect(describeShift(roster.next, WARSAW)).toBe(
      "bob: Mon, Nov 30, 09:00 -> Mon, Dec 7, 09:00",
    );
  });
});

describe("the turn kept between windows, and who is told", () => {
  test("getRosterTurnKey: on call, between a turn's windows, and otherwise", () => {
    expect(
      ScheduleRoster.getRosterTurnKey({
        previousTurnKey: null,
        current: { turnKey: "a" },
        next: { turnKey: "a" },
      }),
    ).toBe("a");
    expect(
      ScheduleRoster.getRosterTurnKey({
        previousTurnKey: "a",
        current: null,
        next: { turnKey: "a" },
      }),
    ).toBe("a");
    expect(
      ScheduleRoster.getRosterTurnKey({
        previousTurnKey: "a",
        current: null,
        next: { turnKey: "b" },
      }),
    ).toBeNull();
    expect(
      ScheduleRoster.getRosterTurnKey({
        previousTurnKey: "a",
        current: null,
        next: null,
      }),
    ).toBeNull();
    // Never kept: none to keep.
    expect(
      ScheduleRoster.getRosterTurnKey({
        previousTurnKey: null,
        current: null,
        next: { turnKey: "a" },
      }),
    ).toBeNull();
    // Somebody on call with no turn said keeps none.
    expect(
      ScheduleRoster.getRosterTurnKey({
        previousTurnKey: "a",
        current: { turnKey: "" },
        next: { turnKey: "a" },
      }),
    ).toBeNull();
  });

  test("isTurnResuming: only out of a gap, into the turn kept", () => {
    expect(
      ScheduleRoster.isTurnResuming({
        previousUserId: null,
        previousTurnKey: "a",
        current: { turnKey: "a" },
      }),
    ).toBe(true);
    expect(
      ScheduleRoster.isTurnResuming({
        previousUserId: "bob",
        previousTurnKey: "a",
        current: { turnKey: "a" },
      }),
    ).toBe(false);
    expect(
      ScheduleRoster.isTurnResuming({
        previousUserId: null,
        previousTurnKey: null,
        current: { turnKey: "a" },
      }),
    ).toBe(false);
    expect(
      ScheduleRoster.isTurnResuming({
        previousUserId: null,
        previousTurnKey: "a",
        current: { turnKey: "b" },
      }),
    ).toBe(false);
  });

  test("isTurnPausing: only into a gap, with the turn next", () => {
    expect(
      ScheduleRoster.isTurnPausing({
        previousUserId: "alice",
        previousTurnKey: "a",
        current: null,
        next: { turnKey: "a" },
      }),
    ).toBe(true);
    expect(
      ScheduleRoster.isTurnPausing({
        previousUserId: "alice",
        previousTurnKey: "a",
        current: { turnKey: "c" },
        next: { turnKey: "a" },
      }),
    ).toBe(false);
    expect(
      ScheduleRoster.isTurnPausing({
        previousUserId: "alice",
        previousTurnKey: "a",
        current: null,
        next: { turnKey: "b" },
      }),
    ).toBe(false);
    expect(
      ScheduleRoster.isTurnPausing({
        previousUserId: null,
        previousTurnKey: "a",
        current: null,
        next: { turnKey: "a" },
      }),
    ).toBe(false);
  });
});

/*
 * What a person hears over a stretch of time, as the roster refresh tells
 * it: woken at each hand-off the stored roster names (RefreshHandoffTime),
 * diffing the stored roster with the new one, keeping the turn as the
 * service does.
 */
interface Told {
  nowOnCall: Array<string>;
  noLongerOnCall: Array<string>;
  // Every start and end of somebody's time on call: the time logs.
  timeLogStarts: Array<string>;
  timeLogEnds: Array<string>;
}

function tellOver(data: {
  layersAt: (now: Date) => Array<LayerProps>;
  overrides?: Array<UserOverrideRecord>;
  from: Date;
  to: Date;
  tz: string;
}): Told {
  const told: Told = {
    nowOnCall: [],
    noLongerOnCall: [],
    timeLogStarts: [],
    timeLogEnds: [],
  };

  let storedUserId: string | null = null;
  let storedTurnKey: string | null = null;
  let now: Date = data.from;

  for (let guard: number = 0; guard < 1000; guard++) {
    const roster: ScheduleRosterState = rosterAt(
      data.layersAt(now),
      now,
      data.overrides,
    );
    const currentUserId: string | null = roster.current?.userId || null;

    const isResuming: boolean = ScheduleRoster.isTurnResuming({
      previousUserId: storedUserId,
      previousTurnKey: storedTurnKey,
      current: roster.current,
    });
    const isPausing: boolean = ScheduleRoster.isTurnPausing({
      previousUserId: storedUserId,
      previousTurnKey: storedTurnKey,
      current: roster.current,
      next: roster.next,
    });

    const at: string = wallClock(now, data.tz);

    if (storedUserId !== currentUserId) {
      if (storedUserId) {
        told.timeLogEnds.push(`${storedUserId} ${at}`);
        if (!isPausing) {
          told.noLongerOnCall.push(`${storedUserId} ${at}`);
        }
      }

      if (currentUserId) {
        told.timeLogStarts.push(`${currentUserId} ${at}`);
        if (!isResuming) {
          told.nowOnCall.push(`${currentUserId} ${at}`);
        }
      }
    }

    storedTurnKey = ScheduleRoster.getRosterTurnKey({
      previousTurnKey: storedTurnKey,
      current: roster.current,
      next: roster.next,
    });
    storedUserId = currentUserId;

    // The next wake-up: the shift's end, or the next shift's start.
    const wake: Date | null = roster.current
      ? roster.current.end
      : roster.next
        ? roster.next.start
        : null;

    if (!wake || wake.getTime() > data.to.getTime()) {
      break;
    }

    now = wake;
  }

  return told;
}

describe("REGRESSION #11270: told when a turn starts and ends, not at every window", () => {
  test("two weekly turns of nights: once each way per turn, a time log every night", () => {
    const layers: Array<LayerProps> = [
      nightsLayer({ tz: WARSAW, startDay: "2026-11-23" }),
    ];

    const told: Told = tellOver({
      layersAt: (): Array<LayerProps> => {
        return layers;
      },
      from: tzInstant("2026-11-23 12:00", WARSAW),
      to: tzInstant("2026-12-07 12:00", WARSAW),
      tz: WARSAW,
    });

    expect(told.nowOnCall).toEqual([
      "alice Mon, Nov 23, 17:00",
      "bob Mon, Nov 30, 17:00",
    ]);
    expect(told.noLongerOnCall).toEqual([
      "alice Mon, Nov 30, 07:00",
      "bob Mon, Dec 7, 07:00",
    ]);
    // Their time on call is still logged window by window: 7 nights each.
    expect(told.timeLogStarts).toHaveLength(14);
    expect(told.timeLogEnds).toHaveLength(14);
  });

  test("somebody else on call between two windows is a hand-off, told both ways", () => {
    // Carl covers Alice's Wednesday night: an override.
    const overrides: Array<UserOverrideRecord> = [
      {
        overrideUserId: "alice",
        routeAlertsToUserId: "carl",
        startsAt: tzInstant("2026-11-25 17:00", WARSAW),
        endsAt: tzInstant("2026-11-26 07:00", WARSAW),
      },
    ];

    const told: Told = tellOver({
      layersAt: (): Array<LayerProps> => {
        return [nightsLayer({ tz: WARSAW, startDay: "2026-11-23" })];
      },
      overrides: overrides,
      from: tzInstant("2026-11-23 12:00", WARSAW),
      to: tzInstant("2026-11-30 12:00", WARSAW),
      tz: WARSAW,
    });

    expect(told.nowOnCall).toEqual([
      "alice Mon, Nov 23, 17:00",
      "carl Wed, Nov 25, 17:00",
      // Back after Carl had the pager: told again.
      "alice Thu, Nov 26, 17:00",
    ]);
    expect(told.noLongerOnCall).toEqual([
      // Carl has her next night: no longer on call, for now.
      "alice Wed, Nov 25, 07:00",
      "carl Thu, Nov 26, 07:00",
      "alice Mon, Nov 30, 07:00",
    ]);
  });

  test("a change made between two windows that gives the next one to someone else drops the turn kept", () => {
    const before: Array<LayerProps> = [
      nightsLayer({ tz: WARSAW, startDay: "2026-11-23" }),
    ];
    // Bob is put in Alice's place, during Tuesday's gap, for the rest of her turn.
    const after: Array<LayerProps> = [
      nightsLayer({ tz: WARSAW, startDay: "2026-11-23", users: [BOB, ALICE] }),
    ];

    // Monday night: Alice's turn, kept.
    const monday: ScheduleRosterState = rosterAt(
      before,
      tzInstant("2026-11-23 17:00", WARSAW),
    );
    let storedTurnKey: string | null = ScheduleRoster.getRosterTurnKey({
      previousTurnKey: null,
      current: monday.current,
      next: monday.next,
    });

    // Tuesday 07:00: her window closes, her turn goes on: kept, untold.
    const tuesdayMorning: ScheduleRosterState = rosterAt(
      before,
      tzInstant("2026-11-24 07:00", WARSAW),
    );
    expect(
      ScheduleRoster.isTurnPausing({
        previousUserId: "alice",
        previousTurnKey: storedTurnKey,
        current: tuesdayMorning.current,
        next: tuesdayMorning.next,
      }),
    ).toBe(true);
    storedTurnKey = ScheduleRoster.getRosterTurnKey({
      previousTurnKey: storedTurnKey,
      current: tuesdayMorning.current,
      next: tuesdayMorning.next,
    });
    expect(storedTurnKey).toBe(monday.current!.turnKey);

    // Tuesday noon, the edit's refresh: the next window is Bob's. Dropped.
    const atEdit: ScheduleRosterState = rosterAt(
      after,
      tzInstant("2026-11-24 12:00", WARSAW),
    );
    expect(atEdit.current).toBeNull();
    expect(atEdit.next!.userId).toBe("bob");
    storedTurnKey = ScheduleRoster.getRosterTurnKey({
      previousTurnKey: storedTurnKey,
      current: atEdit.current,
      next: atEdit.next,
    });
    expect(storedTurnKey).toBeNull();

    /*
     * Tuesday 17:00: Bob, who was never on call before it, is told he is now
     * - though the timeline worked out again shows him on Monday night too.
     */
    const tuesdayNight: ScheduleRosterState = rosterAt(
      after,
      tzInstant("2026-11-24 17:00", WARSAW),
    );
    expect(tuesdayNight.current!.userId).toBe("bob");
    expect(
      ScheduleRoster.isTurnResuming({
        previousUserId: null,
        previousTurnKey: storedTurnKey,
        current: tuesdayNight.current,
      }),
    ).toBe(false);
  });

  test("a lower layer on call between the windows: a real hand-off each time, told as before", () => {
    const told: Told = tellOver({
      layersAt: (): Array<LayerProps> => {
        return [
          nightsLayer({ tz: WARSAW, startDay: "2026-11-23" }),
          nightsLayer({
            tz: WARSAW,
            startDay: "2026-11-23",
            users: [CARL],
            layerId: "days",
            restrictionTimes: noRestriction(),
          }),
        ];
      },
      from: tzInstant("2026-11-23 12:00", WARSAW),
      to: tzInstant("2026-11-26 12:00", WARSAW),
      tz: WARSAW,
    });

    // Alice and Carl hand the pager to each other twice a day.
    expect(told.nowOnCall).toEqual([
      "carl Mon, Nov 23, 12:00",
      "alice Mon, Nov 23, 17:00",
      "carl Tue, Nov 24, 07:00",
      "alice Tue, Nov 24, 17:00",
      "carl Wed, Nov 25, 07:00",
      "alice Wed, Nov 25, 17:00",
      "carl Thu, Nov 26, 07:00",
    ]);
  });

  test("a single person's layer of nights: told once a turn, as each turn starts", () => {
    const told: Told = tellOver({
      layersAt: (): Array<LayerProps> => {
        return [
          nightsLayer({ tz: NEW_YORK, startDay: "2026-11-23", users: [ALICE] }),
        ];
      },
      from: tzInstant("2026-11-23 12:00", NEW_YORK),
      to: tzInstant("2026-12-07 12:00", NEW_YORK),
      tz: NEW_YORK,
    });

    expect(told.nowOnCall).toEqual([
      "alice Mon, Nov 23, 17:00",
      "alice Mon, Nov 30, 17:00",
    ]);
    expect(told.noLongerOnCall).toEqual([
      "alice Mon, Nov 30, 07:00",
      "alice Mon, Dec 7, 07:00",
    ]);
  });
});
