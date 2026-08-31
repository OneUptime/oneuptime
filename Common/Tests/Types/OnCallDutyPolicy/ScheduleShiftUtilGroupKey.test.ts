import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import ScheduleShiftUtil, {
  OnCallShift,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import UserOverrideUtil, {
  OVERRIDE_META_KEY,
  OverrideEventMeta,
} from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";
import {
  at,
  dailyRestriction,
  noRestriction,
  rotation,
  user,
} from "./CalendarFeedTestFixtures";

/*
 * groupEventsIntoShifts gained a `groupKey` option for the on-call calendar
 * feed. The contract that matters most is that the DEFAULT behaviour is
 * unchanged: every dashboard summary (LayersPreview, FinalScheduleSummary)
 * calls it without a key and must keep producing byte-identical shifts.
 *
 * `legacyGroupEventsIntoShifts` below is a verbatim copy of the function as
 * it was before the option existed; the regression tests compare against it.
 */

const CONTIGUITY_TOLERANCE_SECONDS: number = 5;

function legacyGroupEventsIntoShifts(
  events: Array<CalendarEvent>,
  options?: { mergeAcrossGaps?: boolean | undefined } | undefined,
): Array<OnCallShift> {
  if (!events || events.length === 0) {
    return [];
  }

  const mergeAcrossGaps: boolean = Boolean(options?.mergeAcrossGaps);

  const sorted: Array<CalendarEvent> = [...events]
    .filter((event: CalendarEvent) => {
      return Boolean(event.title) && Boolean(event.start) && Boolean(event.end);
    })
    .sort((a: CalendarEvent, b: CalendarEvent) => {
      if (OneUptimeDate.isBefore(a.start, b.start)) {
        return -1;
      }
      if (OneUptimeDate.isAfter(a.start, b.start)) {
        return 1;
      }
      return 0;
    });

  const shifts: Array<OnCallShift> = [];

  for (const event of sorted) {
    const userId: string = event.title;
    const eventSeconds: number = OneUptimeDate.getDifferenceInSeconds(
      event.end,
      event.start,
    );
    const last: OnCallShift | undefined = shifts[shifts.length - 1];

    const sameUser: boolean = Boolean(last) && last!.userId === userId;

    const isContiguous: boolean =
      Boolean(last) &&
      OneUptimeDate.getDifferenceInSeconds(last!.end, event.start) <=
        CONTIGUITY_TOLERANCE_SECONDS &&
      OneUptimeDate.isOnOrBefore(last!.end, event.end);

    if (last && sameUser && (mergeAcrossGaps || isContiguous)) {
      if (OneUptimeDate.isAfter(event.end, last.end)) {
        last.end = event.end;
      }
      last.coverageSeconds += eventSeconds;
      continue;
    }

    shifts.push({
      userId,
      start: event.start,
      end: event.end,
      coverageSeconds: eventSeconds,
    });
  }

  return shifts;
}

const UTC: string = "UTC";
const WINDOW_START: Date = at("2026-03-02T00:00:00Z");
const WINDOW_END: Date = at("2026-03-09T00:00:00Z");

function multiLayerFixture(withLayerMeta: boolean): Array<LayerProps> {
  const primary: LayerProps = {
    users: [user("A"), user("B")],
    startDateTimeOfLayer: WINDOW_START,
    restrictionTimes: dailyRestriction("09:00", "17:00", UTC),
    handOffTime: at("2026-03-02T09:00:00Z"),
    rotation: rotation(EventInterval.Day, 1),
    timezone: UTC,
  };

  const fallback: LayerProps = {
    users: [user("C"), user("A")],
    startDateTimeOfLayer: WINDOW_START,
    restrictionTimes: noRestriction(),
    handOffTime: WINDOW_START,
    rotation: rotation(EventInterval.Day, 2),
    timezone: UTC,
  };

  if (withLayerMeta) {
    primary.layerId = "layer-1";
    primary.layerName = "Primary";
    fallback.layerId = "layer-2";
    fallback.layerName = "Fallback";
  }

  return [primary, fallback];
}

function expand(layers: Array<LayerProps>): Array<CalendarEvent> {
  return new LayerUtil().getMultiLayerEvents({
    layers,
    calendarStartDate: WINDOW_START,
    calendarEndDate: WINDOW_END,
  });
}

function event(
  userId: string,
  start: Date,
  end: Date,
  extra?: Record<string, unknown> | undefined,
): CalendarEvent {
  return {
    id: 0,
    title: userId,
    allDay: false,
    start,
    end,
    ...(extra ?? {}),
  } as CalendarEvent;
}

function project(shifts: Array<OnCallShift>): Array<string> {
  return shifts.map((shift: OnCallShift) => {
    return `${shift.userId}|${shift.start.toISOString()}|${shift.end.toISOString()}|${shift.coverageSeconds}`;
  });
}

describe("ScheduleShiftUtil.groupEventsIntoShifts default grouping is unchanged", () => {
  test("byte-identical to the legacy implementation on a multi-layer fixture (no layer metadata)", () => {
    const events: Array<CalendarEvent> = expand(multiLayerFixture(false));
    expect(events.length).toBeGreaterThan(5);

    for (const mergeAcrossGaps of [false, true]) {
      const current: Array<OnCallShift> =
        ScheduleShiftUtil.groupEventsIntoShifts(events, { mergeAcrossGaps });
      const legacy: Array<OnCallShift> = legacyGroupEventsIntoShifts(events, {
        mergeAcrossGaps,
      });

      expect(JSON.stringify(current)).toBe(JSON.stringify(legacy));
      expect(current).toEqual(legacy);
    }
  });

  test("identical shifts (projection) when the events DO carry layer metadata", () => {
    const events: Array<CalendarEvent> = expand(multiLayerFixture(true));

    for (const mergeAcrossGaps of [false, true]) {
      const current: Array<OnCallShift> =
        ScheduleShiftUtil.groupEventsIntoShifts(events, { mergeAcrossGaps });
      const legacy: Array<OnCallShift> = legacyGroupEventsIntoShifts(events, {
        mergeAcrossGaps,
      });

      expect(project(current)).toEqual(project(legacy));
    }
  });

  test("identical shifts (projection) after overrides are applied", () => {
    const events: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: expand(multiLayerFixture(false)),
        overrides: [
          {
            overrideUserId: "A",
            routeAlertsToUserId: "B",
            startsAt: at("2026-03-03T11:00:00Z"),
            endsAt: at("2026-03-03T13:00:00Z"),
          },
          {
            // C holds the fallback 03-02..03-04; this sits in its evening.
            overrideUserId: "C",
            routeAlertsToUserId: "D",
            startsAt: at("2026-03-02T18:00:00Z"),
            endsAt: at("2026-03-02T22:00:00Z"),
          },
        ],
      });

    const current: Array<OnCallShift> =
      ScheduleShiftUtil.groupEventsIntoShifts(events);
    const legacy: Array<OnCallShift> = legacyGroupEventsIntoShifts(events);

    expect(project(current)).toEqual(project(legacy));
    // The substitute really is in there, so the comparison is meaningful.
    expect(
      current.some((shift: OnCallShift) => {
        return shift.userId === "D";
      }),
    ).toBe(true);
  });

  test("hand-built events without metadata produce shift objects with exactly the legacy keys", () => {
    const events: Array<CalendarEvent> = [
      event("A", at("2026-03-02T09:00:00Z"), at("2026-03-02T12:00:00Z")),
      event("A", at("2026-03-02T12:00:01Z"), at("2026-03-02T17:00:00Z")),
      event("B", at("2026-03-02T17:00:01Z"), at("2026-03-02T20:00:00Z")),
    ];

    const shifts: Array<OnCallShift> =
      ScheduleShiftUtil.groupEventsIntoShifts(events);

    expect(shifts).toHaveLength(2);
    expect(Object.keys(shifts[0]!)).toEqual([
      "userId",
      "start",
      "end",
      "coverageSeconds",
    ]);
    expect("override" in shifts[0]!).toBe(false);
    expect("layerId" in shifts[0]!).toBe(false);
  });

  test("the 5 second contiguity tolerance and empty input are unchanged", () => {
    expect(ScheduleShiftUtil.groupEventsIntoShifts([])).toEqual([]);

    const events: Array<CalendarEvent> = [
      event("A", at("2026-03-02T09:00:00Z"), at("2026-03-02T12:00:00Z")),
      event("A", at("2026-03-02T12:00:05Z"), at("2026-03-02T13:00:00Z")),
      event("A", at("2026-03-02T13:00:06Z"), at("2026-03-02T14:00:00Z")),
    ];

    expect(ScheduleShiftUtil.groupEventsIntoShifts(events)).toHaveLength(2);
  });
});

describe("ScheduleShiftUtil.groupEventsIntoShifts with a custom groupKey", () => {
  const overrideMeta: OverrideEventMeta = {
    isOverride: true,
    originalUserId: "B",
    overrideUserId: "A",
    overrideStartsAt: at("2026-03-02T12:00:00Z"),
    overrideEndsAt: at("2026-03-02T15:00:00Z"),
  };

  test("groupKeyByUserOverrideAndLayer splits a layer handover between the same user", () => {
    const events: Array<CalendarEvent> = [
      event("A", at("2026-03-02T09:00:00Z"), at("2026-03-02T12:00:00Z"), {
        layerId: "layer-1",
        layerName: "Primary",
      }),
      event("A", at("2026-03-02T12:00:00Z"), at("2026-03-02T15:00:00Z"), {
        layerId: "layer-2",
        layerName: "Fallback",
      }),
    ];

    const merged: Array<OnCallShift> =
      ScheduleShiftUtil.groupEventsIntoShifts(events);
    expect(merged).toHaveLength(1);

    const split: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
      events,
      { groupKey: ScheduleShiftUtil.groupKeyByUserOverrideAndLayer },
    );

    expect(split).toHaveLength(2);
    expect(split[0]!.layerId).toBe("layer-1");
    expect(split[0]!.layerName).toBe("Primary");
    expect(split[1]!.layerId).toBe("layer-2");
    expect(split[1]!.layerName).toBe("Fallback");
    expect(split[0]!.end.getTime()).toBe(split[1]!.start.getTime());
  });

  test("groupKeyByUserOverrideAndLayer keeps an override segment separate from the user's own shift", () => {
    const events: Array<CalendarEvent> = [
      event("A", at("2026-03-02T09:00:00Z"), at("2026-03-02T12:00:00Z")),
      // A covering for B, immediately after A's own shift.
      event("A", at("2026-03-02T12:00:00Z"), at("2026-03-02T15:00:00Z"), {
        [OVERRIDE_META_KEY]: overrideMeta,
      }),
      event("A", at("2026-03-02T15:00:00Z"), at("2026-03-02T17:00:00Z")),
    ];

    expect(ScheduleShiftUtil.groupEventsIntoShifts(events)).toHaveLength(1);

    const split: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
      events,
      { groupKey: ScheduleShiftUtil.groupKeyByUserOverrideAndLayer },
    );

    expect(split).toHaveLength(3);
    expect("override" in split[0]!).toBe(false);
    expect(split[1]!.override).toEqual(overrideMeta);
    expect("override" in split[2]!).toBe(false);
  });

  test("two adjacent segments produced by the SAME override merge into one shift", () => {
    const events: Array<CalendarEvent> = [
      event("A", at("2026-03-02T12:00:00Z"), at("2026-03-02T13:00:00Z"), {
        [OVERRIDE_META_KEY]: overrideMeta,
      }),
      event("A", at("2026-03-02T13:00:01Z"), at("2026-03-02T15:00:00Z"), {
        [OVERRIDE_META_KEY]: overrideMeta,
      }),
    ];

    const shifts: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
      events,
      { groupKey: ScheduleShiftUtil.groupKeyByUserOverrideAndLayer },
    );

    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.override).toEqual(overrideMeta);
    expect(shifts[0]!.coverageSeconds).toBe(3600 + 7199);
  });

  test("a different override window for the same pair is a different key", () => {
    const later: OverrideEventMeta = {
      ...overrideMeta,
      overrideStartsAt: at("2026-03-02T13:00:00Z"),
      overrideEndsAt: at("2026-03-02T15:00:00Z"),
    };

    const events: Array<CalendarEvent> = [
      event("A", at("2026-03-02T12:00:00Z"), at("2026-03-02T13:00:00Z"), {
        [OVERRIDE_META_KEY]: overrideMeta,
      }),
      event("A", at("2026-03-02T13:00:00Z"), at("2026-03-02T15:00:00Z"), {
        [OVERRIDE_META_KEY]: later,
      }),
    ];

    const shifts: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
      events,
      { groupKey: ScheduleShiftUtil.groupKeyByUserOverrideAndLayer },
    );

    expect(shifts).toHaveLength(2);
  });

  test("an arbitrary key function decides grouping; the shift keeps the first segment's user", () => {
    const events: Array<CalendarEvent> = [
      event("A", at("2026-03-02T09:00:00Z"), at("2026-03-02T12:00:00Z")),
      event("B", at("2026-03-02T12:00:00Z"), at("2026-03-02T15:00:00Z")),
    ];

    const shifts: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
      events,
      {
        groupKey: (): string => {
          return "everyone";
        },
      },
    );

    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.userId).toBe("A");
    expect(shifts[0]!.end.getTime()).toBe(at("2026-03-02T15:00:00Z").getTime());
    expect(shifts[0]!.coverageSeconds).toBe(6 * 3600);
  });

  test("a custom key still respects contiguity unless mergeAcrossGaps is set", () => {
    const events: Array<CalendarEvent> = [
      event("A", at("2026-03-02T09:00:00Z"), at("2026-03-02T12:00:00Z"), {
        layerId: "layer-1",
      }),
      event("A", at("2026-03-02T14:00:00Z"), at("2026-03-02T17:00:00Z"), {
        layerId: "layer-1",
      }),
    ];

    expect(
      ScheduleShiftUtil.groupEventsIntoShifts(events, {
        groupKey: ScheduleShiftUtil.groupKeyByUserOverrideAndLayer,
      }),
    ).toHaveLength(2);

    expect(
      ScheduleShiftUtil.groupEventsIntoShifts(events, {
        groupKey: ScheduleShiftUtil.groupKeyByUserOverrideAndLayer,
        mergeAcrossGaps: true,
      }),
    ).toHaveLength(1);
  });

  test("engine-derived events with layer metadata group per layer under the feed key", () => {
    const events: Array<CalendarEvent> = expand(multiLayerFixture(true));

    const shifts: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
      events,
      { groupKey: ScheduleShiftUtil.groupKeyByUserOverrideAndLayer },
    );

    expect(shifts.length).toBeGreaterThan(0);
    for (const shift of shifts) {
      expect(["layer-1", "layer-2"]).toContain(shift.layerId);
      if (shift.layerId === "layer-1") {
        expect(["A", "B"]).toContain(shift.userId);
        expect(shift.layerName).toBe("Primary");
      } else {
        expect(["C", "A"]).toContain(shift.userId);
        expect(shift.layerName).toBe("Fallback");
      }
    }

    // Never fewer shifts than the default grouping: the key only splits.
    expect(shifts.length).toBeGreaterThanOrEqual(
      ScheduleShiftUtil.groupEventsIntoShifts(events).length,
    );
  });

  test("the default key helper equals the event title", () => {
    const sample: CalendarEvent = event(
      "user-x",
      at("2026-03-02T09:00:00Z"),
      at("2026-03-02T10:00:00Z"),
    );
    expect(ScheduleShiftUtil.defaultGroupKey(sample)).toBe("user-x");
    expect(ScheduleShiftUtil.groupKeyByUserOverrideAndLayer(sample)).toBe(
      "user-x||",
    );
  });

  test("getEventLayerId / getEventLayerName ignore non-string values", () => {
    const sample: CalendarEvent = event(
      "u",
      at("2026-03-02T09:00:00Z"),
      at("2026-03-02T10:00:00Z"),
      { layerId: 42, layerName: null },
    );
    expect(ScheduleShiftUtil.getEventLayerId(sample)).toBeUndefined();
    expect(ScheduleShiftUtil.getEventLayerName(sample)).toBeUndefined();
  });
});
