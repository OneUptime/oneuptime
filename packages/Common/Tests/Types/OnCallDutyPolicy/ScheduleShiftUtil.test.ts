import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import OneUptimeDate from "../../../Types/Date";
import ScheduleShiftUtil, {
  CoverageGap,
  CurrentAndNextShift,
  OnCallShift,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";

/*
 * These tests pin the pure event -> shift transformation the on-call schedule
 * summaries depend on. They deliberately do NOT re-test LayerUtil (covered by
 * its own exhaustive suites) — they only cover the grouping / gap / current-next
 * logic layered on top of its output.
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

/*
 * Build an OnCallShift literal for the resolver/gap tests (coverageSeconds is
 * irrelevant to those, so default it to the wall-clock span).
 */
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

describe("ScheduleShiftUtil", () => {
  describe("groupEventsIntoShifts", () => {
    test("returns empty array for no events", () => {
      expect(ScheduleShiftUtil.groupEventsIntoShifts([])).toEqual([]);
    });

    test("keeps distinct users as separate shifts (24/7 rotation)", () => {
      const events: Array<CalendarEvent> = [
        event("A", at("2024-01-01T09:00:00Z"), at("2024-01-02T09:00:00Z")),
        event("B", at("2024-01-02T09:00:01Z"), at("2024-01-03T09:00:00Z")),
        event("A", at("2024-01-03T09:00:01Z"), at("2024-01-04T09:00:00Z")),
      ];

      const shifts: Array<OnCallShift> =
        ScheduleShiftUtil.groupEventsIntoShifts(events);

      expect(shifts).toHaveLength(3);
      expect(
        shifts.map((s: OnCallShift) => {
          return s.userId;
        }),
      ).toEqual(["A", "B", "A"]);
      expect(shifts[0]!.end).toEqual(at("2024-01-02T09:00:00Z"));
    });

    test("merges touching same-user segments into one contiguous shift", () => {
      // Two segments one second apart -> a single shift.
      const events: Array<CalendarEvent> = [
        event("A", at("2024-01-01T09:00:00Z"), at("2024-01-01T17:00:00Z")),
        event("A", at("2024-01-01T17:00:01Z"), at("2024-01-02T09:00:00Z")),
      ];

      const shifts: Array<OnCallShift> =
        ScheduleShiftUtil.groupEventsIntoShifts(events);

      expect(shifts).toHaveLength(1);
      expect(shifts[0]!.start).toEqual(at("2024-01-01T09:00:00Z"));
      expect(shifts[0]!.end).toEqual(at("2024-01-02T09:00:00Z"));
    });

    test("does NOT merge same-user segments across a real gap by default", () => {
      // Daily 9-5 restriction: same user, but a 16h nightly gap between days.
      const events: Array<CalendarEvent> = [
        event("A", at("2024-01-01T09:00:00Z"), at("2024-01-01T17:00:00Z")),
        event("A", at("2024-01-02T09:00:00Z"), at("2024-01-02T17:00:00Z")),
      ];

      const shifts: Array<OnCallShift> =
        ScheduleShiftUtil.groupEventsIntoShifts(events);

      expect(shifts).toHaveLength(2);
    });

    test("merges same-user segments across gaps when mergeAcrossGaps=true", () => {
      const events: Array<CalendarEvent> = [
        event("A", at("2024-01-01T09:00:00Z"), at("2024-01-01T17:00:00Z")),
        event("A", at("2024-01-02T09:00:00Z"), at("2024-01-02T17:00:00Z")),
        event("B", at("2024-01-03T09:00:00Z"), at("2024-01-03T17:00:00Z")),
      ];

      const shifts: Array<OnCallShift> =
        ScheduleShiftUtil.groupEventsIntoShifts(events, {
          mergeAcrossGaps: true,
        });

      expect(shifts).toHaveLength(2);
      expect(shifts[0]!.userId).toBe("A");
      expect(shifts[0]!.start).toEqual(at("2024-01-01T09:00:00Z"));
      // Turn end is the last covered instant of that user's run.
      expect(shifts[0]!.end).toEqual(at("2024-01-02T17:00:00Z"));
      /*
       * coverageSeconds is the REAL active time (two 8h days = 16h), not the
       * ~32h wall-clock span across the overnight gap.
       */
      expect(shifts[0]!.coverageSeconds).toBe(16 * 3600);
      expect(shifts[1]!.userId).toBe("B");
    });

    test("sorts unsorted input by start time and never mutates the caller array", () => {
      const events: Array<CalendarEvent> = [
        event("B", at("2024-01-02T09:00:00Z"), at("2024-01-03T09:00:00Z")),
        event("A", at("2024-01-01T09:00:00Z"), at("2024-01-02T09:00:00Z")),
      ];
      const snapshot: Array<string> = events.map((e: CalendarEvent) => {
        return e.title;
      });

      const shifts: Array<OnCallShift> =
        ScheduleShiftUtil.groupEventsIntoShifts(events);

      expect(
        shifts.map((s: OnCallShift) => {
          return s.userId;
        }),
      ).toEqual(["A", "B"]);
      // input order preserved (we copy before sorting)
      expect(
        events.map((e: CalendarEvent) => {
          return e.title;
        }),
      ).toEqual(snapshot);
    });
  });

  describe("getCurrentAndNextShift", () => {
    const shifts: Array<OnCallShift> = [
      mkShift("A", at("2024-01-01T09:00:00Z"), at("2024-01-02T09:00:00Z")),
      mkShift("B", at("2024-01-02T09:00:00Z"), at("2024-01-03T09:00:00Z")),
    ];

    test("resolves the current and next shift when now is inside a shift", () => {
      const result: CurrentAndNextShift =
        ScheduleShiftUtil.getCurrentAndNextShift(
          shifts,
          at("2024-01-01T12:00:00Z"),
        );

      expect(result.current?.userId).toBe("A");
      expect(result.next?.userId).toBe("B");
    });

    test("current is null inside a coverage gap but next is still found", () => {
      const gapped: Array<OnCallShift> = [
        mkShift("A", at("2024-01-01T09:00:00Z"), at("2024-01-01T17:00:00Z")),
        mkShift("A", at("2024-01-02T09:00:00Z"), at("2024-01-02T17:00:00Z")),
      ];

      const result: CurrentAndNextShift =
        ScheduleShiftUtil.getCurrentAndNextShift(
          gapped,
          at("2024-01-01T20:00:00Z"),
        );

      expect(result.current).toBeNull();
      expect(result.next?.start).toEqual(at("2024-01-02T09:00:00Z"));
    });

    test("next is null when now is past the last shift", () => {
      const result: CurrentAndNextShift =
        ScheduleShiftUtil.getCurrentAndNextShift(
          shifts,
          at("2024-01-05T00:00:00Z"),
        );

      expect(result.current).toBeNull();
      expect(result.next).toBeNull();
    });
  });

  describe("getCoverageGaps", () => {
    test("reports a leading gap before the first shift", () => {
      const shifts: Array<OnCallShift> = [
        mkShift("A", at("2024-01-01T12:00:00Z"), at("2024-01-01T18:00:00Z")),
      ];

      const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
        shifts,
        at("2024-01-01T09:00:00Z"),
        at("2024-01-01T20:00:00Z"),
      );

      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.start).toEqual(at("2024-01-01T09:00:00Z"));
      expect(gaps[0]!.end).toEqual(at("2024-01-01T12:00:00Z"));
    });

    test("reports gaps between shifts but not trailing time after the last", () => {
      const shifts: Array<OnCallShift> = [
        mkShift("A", at("2024-01-01T09:00:00Z"), at("2024-01-01T17:00:00Z")),
        mkShift("A", at("2024-01-02T09:00:00Z"), at("2024-01-02T17:00:00Z")),
      ];

      const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
        shifts,
        at("2024-01-01T09:00:00Z"),
        at("2024-01-03T00:00:00Z"),
      );

      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.start).toEqual(at("2024-01-01T17:00:00Z"));
      expect(gaps[0]!.end).toEqual(at("2024-01-02T09:00:00Z"));
    });

    test("treats the whole window as a gap when there are no shifts", () => {
      const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
        [],
        at("2024-01-01T09:00:00Z"),
        at("2024-01-02T09:00:00Z"),
      );

      expect(gaps).toHaveLength(1);
    });

    test("ignores the one-second boundaries between touching segments", () => {
      const shifts: Array<OnCallShift> = [
        mkShift("A", at("2024-01-01T09:00:00Z"), at("2024-01-01T17:00:00Z")),
        mkShift("B", at("2024-01-01T17:00:01Z"), at("2024-01-02T09:00:00Z")),
      ];

      const gaps: Array<CoverageGap> = ScheduleShiftUtil.getCoverageGaps(
        shifts,
        at("2024-01-01T09:00:00Z"),
        at("2024-01-02T09:00:00Z"),
      );

      expect(gaps).toHaveLength(0);
    });
  });
});
