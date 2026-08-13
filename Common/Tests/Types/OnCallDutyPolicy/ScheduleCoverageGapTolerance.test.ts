import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import ScheduleShiftUtil, {
  CoverageGap,
  CurrentAndNextShift,
  OnCallShift,
  ScheduleCoverageState,
  ScheduleCoverageStatus,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import User from "../../../Models/DatabaseModels/User";

/*
 * Pins the contiguity / gap tolerance of the coverage detector, which was
 * lowered from 90 seconds to 5 seconds.
 *
 * At 90s the detector silently swallowed genuine sub-minute coverage holes: two
 * layers whose active hours were misaligned by a minute reported FULL coverage,
 * so the one screen that should have warned "nobody is on call" showed nothing.
 * The tolerance only exists to absorb the on-call engine's own artifacts, which
 * are exactly one second wide (LayerUtil advances segments with
 * addRemoveSeconds(end, 1) and the multi-layer priority merge leaves seams of
 * the same +/-1s magnitude). These tests fence the tolerance in from both
 * sides: over-tightening below the 1s artifact would flood the UI with phantom
 * gaps, and loosening it back towards a minute would re-hide real holes.
 */

// Build a CalendarEvent the way LayerUtil emits one: user id in `title`.
const event: (userId: string, start: Date, end: Date) => CalendarEvent = (
  userId: string,
  start: Date,
  end: Date,
): CalendarEvent => {
  return {
    id: 0,
    title: userId,
    allDay: false,
    start,
    end,
  };
};

const at: (iso: string) => Date = (iso: string): Date => {
  return OneUptimeDate.fromString(iso);
};

const mkShift: (userId: string, start: Date, end: Date) => OnCallShift = (
  userId: string,
  start: Date,
  end: Date,
): OnCallShift => {
  return {
    userId,
    start,
    end,
    coverageSeconds: OneUptimeDate.getDifferenceInSeconds(end, start),
  };
};

const user: (id: string) => User = (id: string): User => {
  return {
    id: {
      toString: (): string => {
        return id;
      },
    } as any,
  } as User;
};

const noRestriction: () => RestrictionTimes = (): RestrictionTimes => {
  const restriction: RestrictionTimes = new RestrictionTimes();
  restriction.restictionType = RestrictionType.None;
  restriction.dayRestrictionTimes = null;
  return restriction;
};

const dailyRotation: () => Recurring = (): Recurring => {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: EventInterval.Day,
      intervalCount: { _type: "PositiveNumber", value: 1 },
    },
  } as any);
};

// A one-day summary window with the handover sitting in the middle of it.
const WINDOW_START: Date = at("2024-01-01T09:00:00Z");
const HANDOVER: Date = at("2024-01-01T17:00:00Z");
const WINDOW_END: Date = at("2024-01-02T09:00:00Z");

/*
 * Two shifts belonging to DIFFERENT users, separated by a hole of exactly
 * `holeSeconds`. Different users matter: same-user segments can be collapsed by
 * the grouper, whereas a hole between two people is the misconfiguration this
 * detector exists to surface.
 */
const shiftsWithHoleOf: (holeSeconds: number) => Array<OnCallShift> = (
  holeSeconds: number,
): Array<OnCallShift> => {
  return [
    mkShift("alice", WINDOW_START, HANDOVER),
    mkShift(
      "bob",
      OneUptimeDate.addRemoveSeconds(HANDOVER, holeSeconds),
      WINDOW_END,
    ),
  ];
};

const eventsWithHoleOf: (
  userId: string,
  holeSeconds: number,
) => Array<CalendarEvent> = (
  userId: string,
  holeSeconds: number,
): Array<CalendarEvent> => {
  return [
    event(userId, WINDOW_START, HANDOVER),
    event(
      userId,
      OneUptimeDate.addRemoveSeconds(HANDOVER, holeSeconds),
      WINDOW_END,
    ),
  ];
};

describe("Schedule coverage gap tolerance", () => {
  describe("engine artifacts stay invisible", () => {
    test("a one-second seam between two different users is not a gap", () => {
      /*
       * This is the exact artifact the tolerance exists for: the multi-layer
       * priority merge hands over from one user to the next with a 1s seam.
       * Tightening the tolerance below this would paint a phantom gap at every
       * single handover in the schedule.
       */
      const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
        shiftsWithHoleOf(1),
        WINDOW_START,
        WINDOW_END,
      );

      expect(gaps).toEqual([]);
    });

    test("a one-second seam between the same user merges into one shift", () => {
      /*
       * LayerUtil splits one rotation turn into several segments joined by
       * addRemoveSeconds(end, 1). If these did not merge, a single overnight
       * turn would render as a stack of near-identical rows.
       */
      const shifts: Array<OnCallShift> =
        ScheduleShiftUtil.groupEventsIntoShifts(eventsWithHoleOf("alice", 1));

      expect(shifts).toHaveLength(1);
      expect(shifts[0]!.userId).toBe("alice");
      expect(shifts[0]!.start).toEqual(WINDOW_START);
      expect(shifts[0]!.end).toEqual(WINDOW_END);
    });

    test("real LayerUtil rotation output produces no phantom gaps", () => {
      /*
       * Guards the tolerance against the engine it has to tolerate, rather than
       * against a hand-written approximation of it: if LayerUtil's segment
       * seams ever widen past the tolerance, this fails instead of the UI
       * quietly filling with gaps nobody scheduled.
       */
      const layerStart: Date = at("2026-01-01T00:00:00Z");
      const calendarEnd: Date = OneUptimeDate.addRemoveDays(layerStart, 5);

      const layer: LayerProps = {
        users: [user("alice"), user("bob")],
        startDateTimeOfLayer: layerStart,
        handOffTime: OneUptimeDate.addRemoveHours(layerStart, 12),
        restrictionTimes: noRestriction(),
        rotation: dailyRotation(),
      };

      const events: Array<CalendarEvent> = new LayerUtil().getEvents({
        ...layer,
        calendarStartDate: layerStart,
        calendarEndDate: calendarEnd,
      });

      const shifts: Array<OnCallShift> =
        ScheduleShiftUtil.groupEventsIntoShifts(events);

      // A 24/7 rotation with two users must alternate, not collapse into one shift.
      expect(shifts.length).toBeGreaterThan(1);

      const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
        shifts,
        layerStart,
        shifts[shifts.length - 1]!.end,
      );

      expect(gaps).toEqual([]);
    });
  });

  describe("genuine sub-minute holes are reported again", () => {
    test("a 60-second hole between two different users is a gap", () => {
      /*
       * The regression this whole change is about: two layers misaligned by one
       * minute. At the old 90s tolerance this reported perfect coverage.
       */
      const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
        shiftsWithHoleOf(60),
        WINDOW_START,
        WINDOW_END,
      );

      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.start).toEqual(HANDOVER);
      expect(gaps[0]!.end).toEqual(at("2024-01-01T17:01:00Z"));
    });

    test("getCoverageState still bills the 60-second hole while somebody is on call now", () => {
      /*
       * A schedule can be Covered at this instant and still be broken later in
       * the day. The status must not be allowed to mask the upcoming hole, which
       * is what a caller renders the warning from.
       */
      const state: ScheduleCoverageState = ScheduleShiftUtil.getCoverageState({
        layerCount: 2,
        assignedUserCount: 2,
        shifts: shiftsWithHoleOf(60),
        now: WINDOW_START,
        windowEnd: WINDOW_END,
      });

      expect(state.status).toBe(ScheduleCoverageStatus.Covered);
      expect(state.current?.userId).toBe("alice");
      expect(state.gaps).toHaveLength(1);
      expect(state.uncoveredSeconds).toBe(60);
      expect(state.coverageRatio).toBeCloseTo((86400 - 60) / 86400, 10);
    });

    test("a same-user hole wider than the tolerance stays two separate shifts", () => {
      /*
       * The tolerance drives merging as well as gap reporting. At 90s a
       * one-minute hole inside one person's coverage was absorbed into a single
       * shift, so the summary claimed continuous cover that did not exist.
       */
      const shifts: Array<OnCallShift> =
        ScheduleShiftUtil.groupEventsIntoShifts(eventsWithHoleOf("alice", 60));

      expect(shifts).toHaveLength(2);

      const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
        shifts,
        WINDOW_START,
        WINDOW_END,
      );

      expect(gaps).toHaveLength(1);
    });
  });

  describe("boundary sweep on the gap threshold", () => {
    /*
     * Determined by reading the implementation and confirmed by running:
     * getCoverageGaps reports a hole when
     *   getDifferenceInSeconds(end, start) > minimumGapSeconds
     * with minimumGapSeconds defaulting to the 5s contiguity tolerance. The
     * comparison is STRICTLY greater-than, so the smallest reported hole is 6s
     * and a hole of exactly 5s is still absorbed. All instants here are whole
     * seconds, so moment's truncation towards zero and the absolute value that
     * getDifferenceInSeconds returns never come into play; the boundary is
     * exactly 5 -> silent, 6 -> reported.
     *
     * The 89/90/91 rows are the old tolerance: every one of them must now be
     * reported, which is precisely what regressed before.
     */
    const cases: Array<{ holeSeconds: number; isReported: boolean }> = [
      { holeSeconds: 4, isReported: false },
      { holeSeconds: 5, isReported: false },
      { holeSeconds: 6, isReported: true },
      { holeSeconds: 89, isReported: true },
      { holeSeconds: 90, isReported: true },
      { holeSeconds: 91, isReported: true },
    ];

    for (const testCase of cases) {
      test(`a ${testCase.holeSeconds}s hole is ${
        testCase.isReported ? "reported" : "absorbed"
      }`, () => {
        const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
          shiftsWithHoleOf(testCase.holeSeconds),
          WINDOW_START,
          WINDOW_END,
        );

        expect(gaps).toHaveLength(testCase.isReported ? 1 : 0);
      });

      /*
       * The same threshold governs whether two same-user segments collapse, so
       * the two sides can never drift apart into a state where a shift is shown
       * as continuous while a gap is simultaneously reported inside it.
       */
      test(`a ${testCase.holeSeconds}s hole ${
        testCase.isReported ? "splits" : "merges"
      } same-user segments`, () => {
        const shifts: Array<OnCallShift> =
          ScheduleShiftUtil.groupEventsIntoShifts(
            eventsWithHoleOf("alice", testCase.holeSeconds),
          );

        expect(shifts).toHaveLength(testCase.isReported ? 2 : 1);
      });
    }
  });

  describe("minimumGapSeconds option", () => {
    test("60 suppresses a sub-minute hole that the default reports", () => {
      /*
       * A render layer that considers 30 seconds to be display noise raises the
       * floor itself, instead of the detector hiding it from every caller —
       * which is how the 90s default hid real holes from the alerting surfaces
       * too.
       */
      const shifts: Array<OnCallShift> = shiftsWithHoleOf(30);

      expect(
        ScheduleShiftUtil.getCoverageGaps(shifts, WINDOW_START, WINDOW_END),
      ).toHaveLength(1);

      expect(
        ScheduleShiftUtil.getCoverageGaps(shifts, WINDOW_START, WINDOW_END, {
          minimumGapSeconds: 60,
        }),
      ).toHaveLength(0);
    });

    test("0 surfaces even the one-second engine seam", () => {
      // An audit-style caller can opt into seeing every hole, artifacts included.
      const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
        shiftsWithHoleOf(1),
        WINDOW_START,
        WINDOW_END,
        { minimumGapSeconds: 0 },
      );

      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.start).toEqual(HANDOVER);
      expect(gaps[0]!.end).toEqual(at("2024-01-01T17:00:01Z"));
    });

    test("omitting it, and passing undefined, both fall back to the 5s default", () => {
      /*
       * getCoverageState always forwards { minimumGapSeconds: undefined } when
       * the caller omits it, so an `undefined` check that was written as a
       * falsy check would silently turn the floor into 0 and report every seam.
       */
      const shifts: Array<OnCallShift> = shiftsWithHoleOf(5);

      expect(
        ScheduleShiftUtil.getCoverageGaps(shifts, WINDOW_START, WINDOW_END),
      ).toHaveLength(0);

      expect(
        ScheduleShiftUtil.getCoverageGaps(shifts, WINDOW_START, WINDOW_END, {
          minimumGapSeconds: undefined,
        }),
      ).toHaveLength(0);

      const state: ScheduleCoverageState = ScheduleShiftUtil.getCoverageState({
        layerCount: 1,
        assignedUserCount: 2,
        shifts: shiftsWithHoleOf(6),
        now: WINDOW_START,
        windowEnd: WINDOW_END,
      });

      expect(state.gaps).toHaveLength(1);
      expect(state.uncoveredSeconds).toBe(6);
    });

    test("raising it hides the hole from the report but not from the shifts", () => {
      /*
       * minimumGapSeconds is a reporting filter only. If it ever leaked into
       * grouping, a caller that quietened short holes would also start claiming
       * one continuous shift across them — the exact false "fully covered"
       * reading this change removed.
       */
      const shifts: Array<OnCallShift> =
        ScheduleShiftUtil.groupEventsIntoShifts(eventsWithHoleOf("alice", 60));

      expect(shifts).toHaveLength(2);

      const state: ScheduleCoverageState = ScheduleShiftUtil.getCoverageState({
        layerCount: 1,
        assignedUserCount: 1,
        shifts,
        now: WINDOW_START,
        windowEnd: WINDOW_END,
        minimumGapSeconds: 3600,
      });

      expect(state.gaps).toEqual([]);
      expect(state.uncoveredSeconds).toBe(0);
      expect(state.coverageRatio).toBe(1);

      // The hole is still real: nobody is on call inside it.
      const insideHole: CurrentAndNextShift =
        ScheduleShiftUtil.getCurrentAndNextShift(
          shifts,
          at("2024-01-01T17:00:30Z"),
        );

      expect(insideHole.current).toBeNull();
      expect(insideHole.next?.start).toEqual(at("2024-01-01T17:01:00Z"));
    });
  });

  describe("grouping behaviour that must not change", () => {
    test("genuinely touching segments still merge", () => {
      // Zero-second seam: the previous segment's end is the next one's start.
      const shifts: Array<OnCallShift> =
        ScheduleShiftUtil.groupEventsIntoShifts(eventsWithHoleOf("alice", 0));

      expect(shifts).toHaveLength(1);
      expect(shifts[0]!.start).toEqual(WINDOW_START);
      expect(shifts[0]!.end).toEqual(WINDOW_END);
      // Two 8h + 16h segments, so the span and the active time agree here.
      expect(shifts[0]!.coverageSeconds).toBe(24 * 3600);
    });

    test("mergeAcrossGaps collapses a whole rotation turn regardless of tolerance", () => {
      /*
       * The per-layer rotation summary shows "alice: Mon -> Fri" as one turn.
       * The tolerance must not be consulted at all on this path, otherwise
       * lowering it would explode every restricted rotation into one row per
       * day.
       */
      const events: Array<CalendarEvent> = [
        event("alice", at("2024-01-01T09:00:00Z"), at("2024-01-01T17:00:00Z")),
        event("alice", at("2024-01-02T09:00:00Z"), at("2024-01-02T17:00:00Z")),
        event("bob", at("2024-01-03T09:00:00Z"), at("2024-01-03T17:00:00Z")),
      ];

      const shifts: Array<OnCallShift> =
        ScheduleShiftUtil.groupEventsIntoShifts(events, {
          mergeAcrossGaps: true,
        });

      expect(shifts).toHaveLength(2);
      expect(shifts[0]!.userId).toBe("alice");
      expect(shifts[0]!.end).toEqual(at("2024-01-02T17:00:00Z"));
      // Real active time across the turn, not the 32h wall-clock span.
      expect(shifts[0]!.coverageSeconds).toBe(16 * 3600);
      expect(shifts[1]!.userId).toBe("bob");
    });

    test("a sub-tolerance seam never merges two different users", () => {
      /*
       * The tolerance decides contiguity, never identity. Merging across users
       * would attribute somebody else's minutes to the wrong on-call person.
       */
      const events: Array<CalendarEvent> = [
        event("alice", WINDOW_START, HANDOVER),
        event("bob", OneUptimeDate.addRemoveSeconds(HANDOVER, 1), WINDOW_END),
      ];

      const shifts: Array<OnCallShift> =
        ScheduleShiftUtil.groupEventsIntoShifts(events);

      expect(shifts).toHaveLength(2);
      expect(shifts[0]!.userId).toBe("alice");
      expect(shifts[1]!.userId).toBe("bob");
    });
  });
});
