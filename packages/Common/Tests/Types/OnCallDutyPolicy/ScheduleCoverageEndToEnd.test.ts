import User from "../../../Models/DatabaseModels/User";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import ScheduleShiftUtil, {
  CoverageGap,
  OnCallShift,
  ScheduleCoverageState,
  ScheduleCoverageStatus,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";

/*
 * End-to-end coverage of the pipeline every on-call UI surface actually runs:
 *
 *   LayerUtil.getMultiLayerEvents -> ScheduleShiftUtil.groupEventsIntoShifts
 *     -> getCoverageGaps / getCoverageState
 *
 * The individual stages have their own exhaustive suites, but the headline bug
 * (a schedule with a coverage gap rendering as nothing at all) lived in the
 * COMPOSITION: the engine legitimately emits zero events for an unassigned
 * layer, and the consumer treated "no events" as "nothing to warn about"
 * instead of "nobody is ever on call". These tests pin the composed behaviour
 * so a change in any single stage that breaks the whole cannot pass unnoticed.
 *
 * Every layer declares an explicit "UTC" schedule timezone and every instant is
 * built from a fixed ISO string, so restriction wall-clock windows resolve
 * identically no matter which timezone the test process runs in.
 */

const UTC_ZONE: string = "UTC";

const at: (iso: string) => Date = (iso: string): Date => {
  return OneUptimeDate.fromString(iso);
};

function user(id: string): User {
  return {
    id: {
      toString: (): string => {
        return id;
      },
    } as any,
  } as User;
}

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
  } as any);
}

function noRestriction(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.None;
  restrictionTimes.dayRestrictionTimes = null;
  return restrictionTimes;
}

/*
 * A weekly restriction window authored by its wall-clock start/end. The engine
 * derives the enforced weekday from the timestamp itself (startDay/endDay are
 * informational), so the instants must land on the intended day.
 */
function weeklyWindow(startISO: string, endISO: string): WeeklyResctriction {
  const startTime: Date = at(startISO);
  const endTime: Date = at(endISO);

  return {
    startDay: OneUptimeDate.getDayOfWeek(startTime, UTC_ZONE),
    endDay: OneUptimeDate.getDayOfWeek(endTime, UTC_ZONE),
    startTime,
    endTime,
  };
}

/*
 * The single most common real-world schedule shape: office hours, Mon-Fri
 * 09:00-17:00. Authored as five separate weekday windows (one continuous
 * Mon 09:00 -> Fri 17:00 window would wrongly cover the nights too).
 */
function businessHoursRestriction(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Weekly;
  restrictionTimes.weeklyRestrictionTimes = [
    weeklyWindow("2026-01-05T09:00:00Z", "2026-01-05T17:00:00Z"),
    weeklyWindow("2026-01-06T09:00:00Z", "2026-01-06T17:00:00Z"),
    weeklyWindow("2026-01-07T09:00:00Z", "2026-01-07T17:00:00Z"),
    weeklyWindow("2026-01-08T09:00:00Z", "2026-01-08T17:00:00Z"),
    weeklyWindow("2026-01-09T09:00:00Z", "2026-01-09T17:00:00Z"),
  ];
  return restrictionTimes;
}

/*
 * Window anchored on a Monday so weekday-restricted expectations (nights,
 * weekends) are easy to reason about, and long enough that a weekend falls
 * strictly INSIDE it — a trailing weekend would be swallowed by the deliberate
 * "no trailing gap" rule and would not prove anything.
 */
const WINDOW_START: Date = at("2026-01-05T00:00:00Z");
const WINDOW_END: Date = at("2026-01-19T00:00:00Z");
const WINDOW_SECONDS: number = 14 * 24 * 3600;

const HANDOFF: Date = at("2026-01-05T09:00:00Z");

function expand(layers: Array<LayerProps>): Array<CalendarEvent> {
  const util: LayerUtil = new LayerUtil();

  return util.getMultiLayerEvents({
    layers: layers,
    calendarStartDate: WINDOW_START,
    calendarEndDate: WINDOW_END,
  });
}

function shiftsFor(layers: Array<LayerProps>): Array<OnCallShift> {
  return ScheduleShiftUtil.groupEventsIntoShifts(expand(layers));
}

function secondsOf(gap: CoverageGap): number {
  return OneUptimeDate.getDifferenceInSeconds(gap.end, gap.start);
}

/*
 * Assert a boundary lands on the authored wall-clock instant, allowing for the
 * engine's own one-second artifact: LayerUtil resumes each segment with
 * addRemoveSeconds(end, 1), so a restriction window entered from a preceding
 * fully-restricted period opens at 09:00:01 rather than 09:00:00. One second is
 * the whole budget on purpose — this is the tolerance that was lowered from 90s
 * because a wider one silently absorbed genuine sub-minute misalignments.
 */
function expectInstantNear(actual: Date, expected: Date): void {
  expect(
    Math.abs(OneUptimeDate.getDifferenceInSeconds(actual, expected)),
  ).toBeLessThanOrEqual(1);
}

describe("Schedule coverage end to end (LayerUtil -> shifts -> gaps/state)", () => {
  describe("a layer with nobody assigned", () => {
    /*
     * The headline bug, composed. Layer.isDataValid short-circuits on an empty
     * user list, so the engine emits zero events — which is indistinguishable
     * from "quiet window" unless the consumer is told the assigned-user count.
     * This is a PERMANENT 100% coverage hole, and the UI used to gate its gap
     * warning on `assignedUserCount > 0`, i.e. it rendered the warning in every
     * case EXCEPT the one that needed it.
     */
    const unassignedLayer: LayerProps = {
      users: [],
      startDateTimeOfLayer: WINDOW_START,
      handOffTime: HANDOFF,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC_ZONE,
    };

    test("produces no events and therefore no shifts", () => {
      const events: Array<CalendarEvent> = expand([unassignedLayer]);

      expect(events).toHaveLength(0);
      expect(ScheduleShiftUtil.groupEventsIntoShifts(events)).toHaveLength(0);
    });

    test("reports one gap spanning the entire window", () => {
      const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
        shiftsFor([unassignedLayer]),
        WINDOW_START,
        WINDOW_END,
      );

      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.start).toEqual(WINDOW_START);
      expect(gaps[0]!.end).toEqual(WINDOW_END);
    });

    test("resolves to NoUsers rather than to a merely uncovered instant", () => {
      const state: ScheduleCoverageState = ScheduleShiftUtil.getCoverageState({
        layerCount: 1,
        assignedUserCount: 0,
        shifts: shiftsFor([unassignedLayer]),
        now: WINDOW_START,
        windowEnd: WINDOW_END,
      });

      /*
       * NoUsers must win over UncoveredNow: the remedy differs ("assign users"
       * vs "widen the active hours"), and only the explicit status keeps a
       * caller from silently falling through to a covered-looking render.
       */
      expect(state.status).toBe(ScheduleCoverageStatus.NoUsers);
      expect(state.current).toBeNull();
      expect(state.next).toBeNull();
      expect(state.uncoveredSeconds).toBe(WINDOW_SECONDS);
      expect(state.coverageRatio).toBe(0);
    });
  });

  describe("a single unrestricted 24/7 layer", () => {
    const alwaysOnLayer: LayerProps = {
      users: [user("solo")],
      startDateTimeOfLayer: WINDOW_START,
      handOffTime: HANDOFF,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC_ZONE,
    };

    test("collapses a fortnight of daily handoffs into one uninterrupted shift", () => {
      /*
       * A single-user daily rotation emits one segment per rotation period, each
       * starting exactly one second after the previous ends. Those seams are the
       * engine's own artifact, not coverage holes, so the summary must show one
       * continuous stretch — not fourteen suspicious-looking fragments.
       */
      const shifts: Array<OnCallShift> = shiftsFor([alwaysOnLayer]);

      expect(shifts).toHaveLength(1);
      expect(shifts[0]!.userId).toBe("solo");
      expect(shifts[0]!.start).toEqual(WINDOW_START);
      expect(shifts[0]!.end).toEqual(WINDOW_END);
    });

    test("reports no gaps and full coverage over the whole window", () => {
      const state: ScheduleCoverageState = ScheduleShiftUtil.getCoverageState({
        layerCount: 1,
        assignedUserCount: 1,
        shifts: shiftsFor([alwaysOnLayer]),
        now: WINDOW_START,
        windowEnd: WINDOW_END,
      });

      expect(state.status).toBe(ScheduleCoverageStatus.Covered);
      expect(state.gaps).toHaveLength(0);
      expect(state.uncoveredSeconds).toBe(0);
      expect(state.coverageRatio).toBe(1);
      expect(state.current?.userId).toBe("solo");
    });
  });

  describe("a single Mon-Fri 09:00-17:00 layer", () => {
    const officeHoursLayer: LayerProps = {
      users: [user("dayshift")],
      startDateTimeOfLayer: WINDOW_START,
      handOffTime: HANDOFF,
      restrictionTimes: businessHoursRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC_ZONE,
    };

    test("yields one shift per business day across the two weeks", () => {
      const shifts: Array<OnCallShift> = shiftsFor([officeHoursLayer]);

      expect(shifts).toHaveLength(10);
      expectInstantNear(shifts[0]!.start, at("2026-01-05T09:00:00Z"));
      expectInstantNear(shifts[0]!.end, at("2026-01-05T17:00:00Z"));
      expectInstantNear(shifts[9]!.start, at("2026-01-16T09:00:00Z"));
      expectInstantNear(shifts[9]!.end, at("2026-01-16T17:00:00Z"));
    });

    test("reports the morning, every night and the weekend as gaps", () => {
      const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
        shiftsFor([officeHoursLayer]),
        WINDOW_START,
        WINDOW_END,
      );

      /*
       * One leading gap (midnight until the first 09:00) plus one gap between
       * each pair of the ten business-day shifts. The stretch after the last
       * Friday is deliberately NOT reported: it is an artifact of where the
       * summary window happens to end, not a misconfiguration.
       */
      expect(gaps).toHaveLength(10);
      expect(gaps[0]!.start).toEqual(WINDOW_START);
      expectInstantNear(gaps[0]!.end, at("2026-01-05T09:00:00Z"));

      const weekendGaps: Array<CoverageGap> = gaps.filter(
        (gap: CoverageGap) => {
          return secondsOf(gap) > 24 * 3600;
        },
      );

      expect(weekendGaps).toHaveLength(1);
      expectInstantNear(weekendGaps[0]!.start, at("2026-01-09T17:00:00Z"));
      expectInstantNear(weekendGaps[0]!.end, at("2026-01-12T09:00:00Z"));
    });

    test("never reports a sub-minute gap, so engine seams cannot masquerade as holes", () => {
      /*
       * The regression this guards: the weekly expansion tiles restriction
       * windows week by week and advances segments with +/-1s steps. If any of
       * those seams leaked into the gap list, the schedule page would display a
       * list of one-second "coverage holes" that no operator can act on — the
       * noise that motivated a 90s contiguity tolerance, which in turn silently
       * hid genuine sub-minute misalignments.
       */
      const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
        shiftsFor([officeHoursLayer]),
        WINDOW_START,
        WINDOW_END,
      );

      expect(gaps.length).toBeGreaterThan(0);

      for (const gap of gaps) {
        expect(secondsOf(gap)).toBeGreaterThanOrEqual(60);
      }
    });

    test("resolves to UncoveredNow — not NoUsers — when now falls in an off-hours gap", () => {
      /*
       * Users ARE assigned here, so the remedy is "extend the active hours or
       * add a fallback layer", never "assign somebody". Conflating this with
       * NoUsers is what the explicit status enum exists to prevent.
       */
      const state: ScheduleCoverageState = ScheduleShiftUtil.getCoverageState({
        layerCount: 1,
        assignedUserCount: 1,
        shifts: shiftsFor([officeHoursLayer]),
        now: at("2026-01-06T03:00:00Z"),
        windowEnd: WINDOW_END,
      });

      expect(state.status).toBe(ScheduleCoverageStatus.UncoveredNow);
      expect(state.current).toBeNull();
      expect(state.next).not.toBeNull();
      expectInstantNear(state.next!.start, at("2026-01-06T09:00:00Z"));
      expect(state.uncoveredSeconds).toBeGreaterThan(0);
      expect(state.coverageRatio).toBeLessThan(1);
    });
  });

  describe("a business-hours layer stacked over a 24/7 fallback", () => {
    /*
     * The configuration operators are told to use to close the off-hours holes
     * above. The lower-priority layer is trimmed around the higher-priority
     * windows by the priority merge, which leaves +/-1s seams everywhere the
     * two meet — so this is simultaneously the test that those seams do not
     * resurface as gaps once the layers are composed.
     */
    const layers: Array<LayerProps> = [
      {
        users: [user("primary")],
        startDateTimeOfLayer: WINDOW_START,
        handOffTime: HANDOFF,
        restrictionTimes: businessHoursRestriction(),
        rotation: rotation(EventInterval.Day, 1),
        timezone: UTC_ZONE,
      },
      {
        users: [user("fallback-a"), user("fallback-b")],
        startDateTimeOfLayer: WINDOW_START,
        handOffTime: HANDOFF,
        restrictionTimes: noRestriction(),
        rotation: rotation(EventInterval.Week, 1),
        timezone: UTC_ZONE,
      },
    ];

    test("closes every off-hours hole the restricted layer leaves", () => {
      const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
        shiftsFor(layers),
        WINDOW_START,
        WINDOW_END,
      );

      expect(gaps).toHaveLength(0);
    });

    test("still hands the business-hours user the daytime and the fallback the night", () => {
      const shifts: Array<OnCallShift> = shiftsFor(layers);

      const onCallAt: (instant: Date) => string | null = (
        instant: Date,
      ): string | null => {
        for (const shift of shifts) {
          if (
            OneUptimeDate.isOnOrBefore(shift.start, instant) &&
            OneUptimeDate.isAfter(shift.end, instant)
          ) {
            return shift.userId;
          }
        }
        return null;
      };

      expect(onCallAt(at("2026-01-06T12:00:00Z"))).toBe("primary");
      expect(onCallAt(at("2026-01-06T03:00:00Z"))).not.toBe("primary");
      expect(onCallAt(at("2026-01-06T03:00:00Z"))).not.toBeNull();
      // Saturday: the restricted layer is silent, so the fallback owns the day.
      expect(onCallAt(at("2026-01-10T12:00:00Z"))).not.toBe("primary");
      expect(onCallAt(at("2026-01-10T12:00:00Z"))).not.toBeNull();
    });

    test("reports full coverage from an off-hours instant", () => {
      const state: ScheduleCoverageState = ScheduleShiftUtil.getCoverageState({
        layerCount: 2,
        assignedUserCount: 3,
        shifts: shiftsFor(layers),
        now: at("2026-01-06T03:00:00Z"),
        windowEnd: WINDOW_END,
      });

      expect(state.status).toBe(ScheduleCoverageStatus.Covered);
      expect(state.current).not.toBeNull();
      expect(state.uncoveredSeconds).toBe(0);
      expect(state.coverageRatio).toBe(1);
    });
  });

  describe("a multi-user 24/7 rotation", () => {
    const rotatingLayer: LayerProps = {
      users: [user("A"), user("B"), user("C")],
      startDateTimeOfLayer: WINDOW_START,
      handOffTime: HANDOFF,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC_ZONE,
    };

    test("hands over between users without leaving a hole at any handoff", () => {
      /*
       * Each handoff is a user change, so the shifts CANNOT merge and every
       * boundary is exposed. A one-second handoff seam being treated as a real
       * hole here would flag a perfectly healthy rotation as broken fourteen
       * times over.
       */
      const shifts: Array<OnCallShift> = shiftsFor([rotatingLayer]);

      expect(shifts.length).toBeGreaterThan(10);

      const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
        shifts,
        WINDOW_START,
        WINDOW_END,
      );

      expect(gaps).toHaveLength(0);

      for (let index: number = 1; index < shifts.length; index++) {
        const seamSeconds: number = OneUptimeDate.getDifferenceInSeconds(
          shifts[index]!.start,
          shifts[index - 1]!.end,
        );
        expect(seamSeconds).toBeLessThanOrEqual(1);
      }
    });

    test("cycles the users in order across the whole window", () => {
      const shifts: Array<OnCallShift> = shiftsFor([rotatingLayer]);
      const order: Array<string> = ["A", "B", "C"];

      shifts.forEach((shift: OnCallShift, index: number) => {
        expect(shift.userId).toBe(order[index % order.length]);
      });
    });

    test("resolves the current and next on-call user mid-rotation", () => {
      const state: ScheduleCoverageState = ScheduleShiftUtil.getCoverageState({
        layerCount: 1,
        assignedUserCount: 3,
        shifts: shiftsFor([rotatingLayer]),
        now: at("2026-01-08T12:00:00Z"),
        windowEnd: WINDOW_END,
      });

      expect(state.status).toBe(ScheduleCoverageStatus.Covered);
      expect(state.gaps).toHaveLength(0);
      expect(state.coverageRatio).toBe(1);
      expect(state.current).not.toBeNull();
      expect(state.next).not.toBeNull();
      expect(state.next!.userId).not.toBe(state.current!.userId);
      expect(state.next!.start).toEqual(at("2026-01-09T09:00:01Z"));
    });
  });
});
