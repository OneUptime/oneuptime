import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import EventInterval from "../../../Types/Events/EventInterval";
import LayerUtil, {
  LayerProps,
  PriorityCalendarEvents,
} from "../../../Types/OnCallDutyPolicy/Layer";
import ScheduleShiftUtil, {
  OnCallShift,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import ShiftSeamUtil, {
  SEAM_TOLERANCE_MILLISECONDS,
  TimeSegment,
} from "../../../Types/OnCallDutyPolicy/ShiftSeamUtil";
import UserOverrideUtil from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";
import {
  at,
  dailyRestriction,
  hhmm,
  noRestriction,
  rotation,
  tzInstant,
  user,
} from "./CalendarFeedTestFixtures";

/*
 * Seam normalisation is what turns the engine's 1-second artefacts into
 * calendar entries that read 09:00-17:00 and touch their neighbours exactly.
 * The fixtures are the ones the design cites: the LayerUtilAuditFixes "Fix 3"
 * primary/fallback schedule (A[10:00-11:00], B[11:00:01-12:00]) and an
 * override split A / B / A.
 */

const UTC: string = "UTC";

function seg(start: string, end: string): TimeSegment {
  return { start: at(start), end: at(end) };
}

function assertTouchingChain(segments: Array<TimeSegment>): void {
  for (let i: number = 0; i < segments.length - 1; i++) {
    expect(segments[i]!.end.getTime()).toBe(segments[i + 1]!.start.getTime());
  }
}

describe("ShiftSeamUtil.snapStart / snapEnd", () => {
  test("a start on second 1 snaps down to the minute, including any milliseconds", () => {
    expect(
      ShiftSeamUtil.snapStart(at("2026-03-02T11:00:01Z")).toISOString(),
    ).toBe("2026-03-02T11:00:00.000Z");
    expect(
      ShiftSeamUtil.snapStart(at("2026-03-02T11:00:01.750Z")).toISOString(),
    ).toBe("2026-03-02T11:00:00.000Z");
  });

  test("an end on second 59 snaps up to the next minute, including across an hour/day", () => {
    expect(
      ShiftSeamUtil.snapEnd(at("2026-03-02T10:59:59Z")).toISOString(),
    ).toBe("2026-03-02T11:00:00.000Z");
    expect(
      ShiftSeamUtil.snapEnd(at("2026-03-02T23:59:59Z")).toISOString(),
    ).toBe("2026-03-03T00:00:00.000Z");
  });

  test("other seconds are left alone and a copy is returned", () => {
    const original: Date = at("2026-03-02T11:00:30Z");
    const start: Date = ShiftSeamUtil.snapStart(original);
    const end: Date = ShiftSeamUtil.snapEnd(original);

    expect(start.getTime()).toBe(original.getTime());
    expect(end.getTime()).toBe(original.getTime());
    expect(start).not.toBe(original);
    expect(end).not.toBe(original);

    expect(ShiftSeamUtil.snapStart(at("2026-03-02T11:00:02Z")).getTime()).toBe(
      at("2026-03-02T11:00:02Z").getTime(),
    );
    expect(ShiftSeamUtil.snapEnd(at("2026-03-02T11:00:58Z")).getTime()).toBe(
      at("2026-03-02T11:00:58Z").getTime(),
    );
    expect(ShiftSeamUtil.snapEnd(at("2026-03-02T11:00:00Z")).getTime()).toBe(
      at("2026-03-02T11:00:00Z").getTime(),
    );
  });
});

describe("ShiftSeamUtil.normalizeSeams", () => {
  test("the cited audit fixture: A[10:00-11:00], B[11:00:01-12:00] becomes touching at 11:00", () => {
    const calStart: Date = at("2026-03-02T00:00:00Z");
    const calEnd: Date = at("2026-03-03T00:00:00Z");

    const primary: LayerProps = {
      users: [user("A"), user("B")],
      startDateTimeOfLayer: calStart,
      restrictionTimes: dailyRestriction("10:00", "12:00", UTC),
      handOffTime: at("2026-03-02T11:00:00Z"),
      rotation: rotation(EventInterval.Hour, 1),
      timezone: UTC,
    };

    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      ...primary,
      calendarStartDate: calStart,
      calendarEndDate: calEnd,
    });

    const a: CalendarEvent | undefined = events.find((event: CalendarEvent) => {
      return event.title === "A";
    });
    const b: CalendarEvent | undefined = events.find((event: CalendarEvent) => {
      return event.title === "B";
    });

    // The raw engine output really has the 1-second seam we are fixing.
    expect(a!.end.toISOString()).toBe("2026-03-02T11:00:00.000Z");
    expect(b!.start.toISOString()).toBe("2026-03-02T11:00:01.000Z");

    const normalized: Array<CalendarEvent> =
      ShiftSeamUtil.normalizeSeams(events);
    const na: CalendarEvent = normalized.find((event: CalendarEvent) => {
      return event.title === "A";
    })!;
    const nb: CalendarEvent = normalized.find((event: CalendarEvent) => {
      return event.title === "B";
    })!;

    expect(na.start.toISOString()).toBe("2026-03-02T10:00:00.000Z");
    expect(na.end.toISOString()).toBe("2026-03-02T11:00:00.000Z");
    expect(nb.start.toISOString()).toBe("2026-03-02T11:00:00.000Z");
    expect(nb.end.toISOString()).toBe("2026-03-02T12:00:00.000Z");
    expect(na.end.getTime()).toBe(nb.start.getTime());
  });

  test("a daily 09:00-17:00 restriction reads 09:00-17:00 on every day, not 09:00:01", () => {
    const tz: string = "Europe/Stockholm";
    const calStart: Date = tzInstant("2026-01-05 00:00", tz);
    const calEnd: Date = tzInstant("2026-01-09 00:00", tz);

    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("A")],
      startDateTimeOfLayer: calStart,
      restrictionTimes: dailyRestriction("09:00", "17:00", tz),
      handOffTime: tzInstant("2026-01-05 09:00", tz),
      rotation: rotation(EventInterval.Week, 1),
      timezone: tz,
      calendarStartDate: calStart,
      calendarEndDate: calEnd,
    });

    // The engine's own artefact: at least one window opens on second 1.
    expect(
      events.some((event: CalendarEvent) => {
        return event.start.getUTCSeconds() === 1;
      }),
    ).toBe(true);

    const normalized: Array<CalendarEvent> =
      ShiftSeamUtil.normalizeSeams(events);

    expect(normalized).toHaveLength(4);
    for (const event of normalized) {
      expect(hhmm(event.start, tz)).toBe("09:00");
      expect(hhmm(event.end, tz)).toBe("17:00");
      expect(event.start.getUTCSeconds()).toBe(0);
      expect(event.end.getUTCSeconds()).toBe(0);
    }
  });

  test("an override split yields A / B / A that touch exactly", () => {
    const base: CalendarEvent = {
      id: 1,
      title: "A",
      allDay: false,
      start: at("2026-03-02T09:00:00Z"),
      end: at("2026-03-02T17:00:00Z"),
    };

    const events: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [base],
        overrides: [
          {
            overrideUserId: "A",
            routeAlertsToUserId: "B",
            startsAt: at("2026-03-02T12:00:00Z"),
            endsAt: at("2026-03-02T13:00:00Z"),
          },
        ],
      });

    expect(
      events.map((event: CalendarEvent) => {
        return event.title;
      }),
    ).toEqual(["A", "B", "A"]);

    const normalized: Array<CalendarEvent> =
      ShiftSeamUtil.normalizeSeams(events);
    assertTouchingChain(normalized);

    const shifts: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
      normalized,
      { groupKey: ScheduleShiftUtil.groupKeyByUserOverrideAndLayer },
    );

    expect(shifts).toHaveLength(3);
    assertTouchingChain(shifts);
    expect(shifts[0]!.start.toISOString()).toBe("2026-03-02T09:00:00.000Z");
    expect(shifts[1]!.start.toISOString()).toBe("2026-03-02T12:00:00.000Z");
    expect(shifts[2]!.start.toISOString()).toBe("2026-03-02T13:00:00.000Z");
    expect(shifts[2]!.end.toISOString()).toBe("2026-03-02T17:00:00.000Z");
  });

  test("priority-merge seams (end = start-1s, start = end+1s) are closed", () => {
    const merged: Array<CalendarEvent> =
      new LayerUtil().removeOverlappingEvents([
        {
          id: 1,
          title: "fallback",
          allDay: false,
          start: at("2026-03-02T00:00:00Z"),
          end: at("2026-03-03T00:00:00Z"),
          priority: 2,
        } as PriorityCalendarEvents,
        {
          id: 2,
          title: "primary",
          allDay: false,
          start: at("2026-03-02T10:00:00Z"),
          end: at("2026-03-02T12:00:00Z"),
          priority: 1,
        } as PriorityCalendarEvents,
      ]);

    // Raw merge output carries the 1s seams.
    expect(merged[0]!.end.toISOString()).toBe("2026-03-02T09:59:59.000Z");
    expect(merged[2]!.start.toISOString()).toBe("2026-03-02T12:00:01.000Z");

    const normalized: Array<CalendarEvent> =
      ShiftSeamUtil.normalizeSeams(merged);

    expect(normalized[0]!.end.toISOString()).toBe("2026-03-02T10:00:00.000Z");
    expect(normalized[1]!.start.toISOString()).toBe("2026-03-02T10:00:00.000Z");
    expect(normalized[1]!.end.toISOString()).toBe("2026-03-02T12:00:00.000Z");
    expect(normalized[2]!.start.toISOString()).toBe("2026-03-02T12:00:00.000Z");
    assertTouchingChain(normalized);
  });

  test("a full multi-layer expansion normalises into a gapless, overlap-free chain", () => {
    const calStart: Date = at("2026-03-02T00:00:00Z");
    const calEnd: Date = at("2026-03-05T00:00:00Z");

    const events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents({
      layers: [
        {
          users: [user("A"), user("B")],
          startDateTimeOfLayer: calStart,
          restrictionTimes: dailyRestriction("10:00", "12:00", UTC),
          handOffTime: at("2026-03-02T11:00:00Z"),
          rotation: rotation(EventInterval.Hour, 1),
          timezone: UTC,
        },
        {
          users: [user("C")],
          startDateTimeOfLayer: calStart,
          restrictionTimes: noRestriction(),
          handOffTime: calStart,
          rotation: rotation(EventInterval.Week, 1),
          timezone: UTC,
        },
      ],
      calendarStartDate: calStart,
      calendarEndDate: calEnd,
    });

    const normalized: Array<CalendarEvent> =
      ShiftSeamUtil.normalizeSeams(events);

    expect(normalized.length).toBeGreaterThan(6);
    expect(normalized[0]!.start.getTime()).toBe(calStart.getTime());
    expect(normalized[normalized.length - 1]!.end.getTime()).toBe(
      calEnd.getTime(),
    );
    assertTouchingChain(normalized);

    for (const event of normalized) {
      expect(event.end.getTime()).toBeGreaterThan(event.start.getTime());
      expect(event.start.getUTCSeconds()).toBe(0);
      expect(event.end.getUTCSeconds()).toBe(0);
    }
  });

  test("segments 0..1000 ms apart are made to touch; anything further stays a gap", () => {
    const zero: Array<TimeSegment> = ShiftSeamUtil.normalizeSeams([
      seg("2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z"),
      seg("2026-03-02T10:00:00Z", "2026-03-02T11:00:00Z"),
    ]);
    assertTouchingChain(zero);

    const exactlyTolerance: Array<TimeSegment> = ShiftSeamUtil.normalizeSeams([
      seg("2026-03-02T09:00:00Z", "2026-03-02T10:00:00.000Z"),
      { start: at("2026-03-02T10:00:00Z"), end: at("2026-03-02T11:00:00Z") },
    ]);
    assertTouchingChain(exactlyTolerance);
    expect(SEAM_TOLERANCE_MILLISECONDS).toBe(1000);

    const halfSecond: Array<TimeSegment> = ShiftSeamUtil.normalizeSeams([
      seg("2026-03-02T09:00:00Z", "2026-03-02T10:00:00.000Z"),
      seg("2026-03-02T10:00:00.500Z", "2026-03-02T11:00:00Z"),
    ]);
    assertTouchingChain(halfSecond);

    const twoSeconds: Array<TimeSegment> = ShiftSeamUtil.normalizeSeams([
      seg("2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z"),
      seg("2026-03-02T10:00:02Z", "2026-03-02T11:00:00Z"),
    ]);
    expect(twoSeconds[0]!.end.toISOString()).toBe("2026-03-02T10:00:00.000Z");
    expect(twoSeconds[1]!.start.toISOString()).toBe("2026-03-02T10:00:02.000Z");

    const realGap: Array<TimeSegment> = ShiftSeamUtil.normalizeSeams([
      seg("2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z"),
      seg("2026-03-02T14:00:00Z", "2026-03-02T15:00:00Z"),
    ]);
    expect(realGap[0]!.end.toISOString()).toBe("2026-03-02T10:00:00.000Z");
  });

  test("overlapping segments are not altered", () => {
    const overlapping: Array<TimeSegment> = ShiftSeamUtil.normalizeSeams([
      seg("2026-03-02T09:00:00Z", "2026-03-02T11:00:00Z"),
      seg("2026-03-02T10:00:00Z", "2026-03-02T12:00:00Z"),
    ]);

    expect(overlapping[0]!.end.toISOString()).toBe("2026-03-02T11:00:00.000Z");
    expect(overlapping[1]!.start.toISOString()).toBe(
      "2026-03-02T10:00:00.000Z",
    );
  });

  test("snapping only ever widens a segment, so a sub-minute one still grows outward", () => {
    const tiny: Array<TimeSegment> = ShiftSeamUtil.normalizeSeams([
      seg("2026-03-02T09:00:01Z", "2026-03-02T09:00:59Z"),
    ]);

    expect(tiny[0]!.start.toISOString()).toBe("2026-03-02T09:00:00.000Z");
    expect(tiny[0]!.end.toISOString()).toBe("2026-03-02T09:01:00.000Z");
  });

  test("an empty or inverted segment is left exactly as it was", () => {
    const empty: Array<TimeSegment> = ShiftSeamUtil.normalizeSeams([
      seg("2026-03-02T09:00:01Z", "2026-03-02T09:00:01Z"),
    ]);
    expect(empty[0]!.start.toISOString()).toBe("2026-03-02T09:00:01.000Z");
    expect(empty[0]!.end.toISOString()).toBe("2026-03-02T09:00:01.000Z");

    const inverted: Array<TimeSegment> = ShiftSeamUtil.normalizeSeams([
      seg("2026-03-02T10:00:01Z", "2026-03-02T09:59:59Z"),
    ]);
    expect(inverted[0]!.start.toISOString()).toBe("2026-03-02T10:00:01.000Z");
    expect(inverted[0]!.end.toISOString()).toBe("2026-03-02T09:59:59.000Z");
  });

  test("returns sorted copies, preserves extra properties and never mutates the input", () => {
    const first: TimeSegment & { label: string } = {
      ...seg("2026-03-02T12:00:01Z", "2026-03-02T13:59:59Z"),
      label: "second-by-time",
    };
    const second: TimeSegment & { label: string } = {
      ...seg("2026-03-02T09:00:01Z", "2026-03-02T11:59:59Z"),
      label: "first-by-time",
    };
    const input: Array<TimeSegment & { label: string }> = [first, second];
    const snapshot: string = JSON.stringify(input);

    const normalized: Array<TimeSegment & { label: string }> =
      ShiftSeamUtil.normalizeSeams(input);

    expect(JSON.stringify(input)).toBe(snapshot);
    expect(normalized).not.toBe(input);
    expect(normalized[0]!.label).toBe("first-by-time");
    expect(normalized[1]!.label).toBe("second-by-time");
    expect(normalized[0]!.start).not.toBe(second.start);
    expect(normalized[0]!.start.toISOString()).toBe("2026-03-02T09:00:00.000Z");
    expect(normalized[0]!.end.toISOString()).toBe("2026-03-02T12:00:00.000Z");
    expect(normalized[1]!.start.toISOString()).toBe("2026-03-02T12:00:00.000Z");
    expect(normalized[1]!.end.toISOString()).toBe("2026-03-02T14:00:00.000Z");
  });

  test("an empty input yields an empty output", () => {
    expect(ShiftSeamUtil.normalizeSeams([])).toEqual([]);
  });
});
