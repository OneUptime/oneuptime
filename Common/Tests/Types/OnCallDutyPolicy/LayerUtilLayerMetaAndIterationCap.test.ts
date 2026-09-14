import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import EventInterval from "../../../Types/Events/EventInterval";
import LayerUtil, {
  LayerEventsResult,
  LayerProps,
} from "../../../Types/OnCallDutyPolicy/Layer";
import ScheduleShiftUtil from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import {
  at,
  dailyRestriction,
  noRestriction,
  rotation,
  user,
} from "./CalendarFeedTestFixtures";

/*
 * The two LayerUtil additions made for the on-call calendar feed:
 *
 *  1. LayerProps.layerId / layerName are stamped onto every merged event so a
 *     consumer can tell which layer a segment came from — and are ABSENT (not
 *     undefined) when the caller never set them, so existing callers see the
 *     exact event shape they always did.
 *  2. LayerExpansionOptions.maxSimulationIterations bounds the per-layer work
 *     and reports `truncated` through getEventsWithMeta /
 *     getMultiLayerEventsWithMeta, while getEvents / getMultiLayerEvents stay
 *     byte-identical to before.
 */

const UTC: string = "UTC";

const CAL_START: Date = at("2026-03-02T00:00:00Z");
const CAL_END: Date = at("2026-03-04T00:00:00Z");

/*
 * The LayerUtilAuditFixes "Fix 3" fixture: primary A/B hourly rotation
 * restricted to 10:00-12:00 (A[10:00-11:00], B[11:00:01-12:00] each day)
 * over a 24/7 fallback layer with C.
 */
function primaryLayer(withMeta: boolean): LayerProps {
  const layer: LayerProps = {
    users: [user("A"), user("B")],
    startDateTimeOfLayer: CAL_START,
    restrictionTimes: dailyRestriction("10:00", "12:00", UTC),
    handOffTime: at("2026-03-02T11:00:00Z"),
    rotation: rotation(EventInterval.Hour, 1),
    timezone: UTC,
  };

  if (withMeta) {
    layer.layerId = "layer-primary";
    layer.layerName = "Primary";
  }

  return layer;
}

function fallbackLayer(withMeta: boolean): LayerProps {
  const layer: LayerProps = {
    users: [user("C")],
    startDateTimeOfLayer: CAL_START,
    restrictionTimes: noRestriction(),
    handOffTime: CAL_START,
    rotation: rotation(EventInterval.Week, 1),
    timezone: UTC,
  };

  if (withMeta) {
    layer.layerId = "layer-fallback";
    layer.layerName = "Fallback";
  }

  return layer;
}

function coveringUser(
  events: Array<CalendarEvent>,
  instant: Date,
): string | null {
  for (const event of events) {
    if (
      event.start.getTime() <= instant.getTime() &&
      event.end.getTime() >= instant.getTime()
    ) {
      return event.title;
    }
  }
  return null;
}

describe("LayerUtil: layerId / layerName stamping", () => {
  test("every merged event carries the id and name of the layer it came from", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents({
      layers: [primaryLayer(true), fallbackLayer(true)],
      calendarStartDate: CAL_START,
      calendarEndDate: CAL_END,
    });

    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      const layerId: string | undefined =
        ScheduleShiftUtil.getEventLayerId(event);
      const layerName: string | undefined =
        ScheduleShiftUtil.getEventLayerName(event);

      if (event.title === "C") {
        expect(layerId).toBe("layer-fallback");
        expect(layerName).toBe("Fallback");
      } else {
        expect(["A", "B"]).toContain(event.title);
        expect(layerId).toBe("layer-primary");
        expect(layerName).toBe("Primary");
      }
    }
  });

  test("the fallback layer's trailing segment (split by the merge) keeps its layer", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents({
      layers: [primaryLayer(true), fallbackLayer(true)],
      calendarStartDate: CAL_START,
      calendarEndDate: CAL_END,
    });

    // The afternoon of day 1 is C's coverage AFTER the primary window.
    const afternoon: CalendarEvent | undefined = events.find(
      (event: CalendarEvent) => {
        return (
          event.title === "C" &&
          event.start.getTime() >= at("2026-03-02T12:00:00Z").getTime() &&
          event.start.getTime() < at("2026-03-02T13:00:00Z").getTime()
        );
      },
    );

    expect(afternoon).toBeDefined();
    expect(ScheduleShiftUtil.getEventLayerId(afternoon!)).toBe(
      "layer-fallback",
    );

    // Coverage itself is unchanged by stamping.
    expect(coveringUser(events, at("2026-03-02T10:30:00Z"))).toBe("A");
    expect(coveringUser(events, at("2026-03-02T11:30:00Z"))).toBe("B");
    expect(coveringUser(events, at("2026-03-02T15:00:00Z"))).toBe("C");
    expect(coveringUser(events, at("2026-03-03T03:00:00Z"))).toBe("C");
  });

  test("no layer keys are added when LayerProps carries none", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents({
      layers: [primaryLayer(false), fallbackLayer(false)],
      calendarStartDate: CAL_START,
      calendarEndDate: CAL_END,
    });

    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      expect("layerId" in event).toBe(false);
      expect("layerName" in event).toBe(false);
      expect(ScheduleShiftUtil.getEventLayerId(event)).toBeUndefined();
      expect(ScheduleShiftUtil.getEventLayerName(event)).toBeUndefined();
    }
  });

  test("only the id is stamped when only the id is given", () => {
    const layer: LayerProps = fallbackLayer(false);
    layer.layerId = "only-id";

    const events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents({
      layers: [layer],
      calendarStartDate: CAL_START,
      calendarEndDate: CAL_END,
    });

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(ScheduleShiftUtil.getEventLayerId(event)).toBe("only-id");
      expect("layerName" in event).toBe(false);
    }
  });

  test("stamping does not change the merged coverage compared to unstamped layers", () => {
    const util: LayerUtil = new LayerUtil();

    const stamped: Array<CalendarEvent> = util.getMultiLayerEvents({
      layers: [primaryLayer(true), fallbackLayer(true)],
      calendarStartDate: CAL_START,
      calendarEndDate: CAL_END,
    });

    const plain: Array<CalendarEvent> = util.getMultiLayerEvents({
      layers: [primaryLayer(false), fallbackLayer(false)],
      calendarStartDate: CAL_START,
      calendarEndDate: CAL_END,
    });

    const project: (events: Array<CalendarEvent>) => Array<string> = (
      events: Array<CalendarEvent>,
    ): Array<string> => {
      return events.map((event: CalendarEvent) => {
        return `${event.id}|${event.title}|${event.start.toISOString()}|${event.end.toISOString()}`;
      });
    };

    expect(project(stamped)).toEqual(project(plain));
  });
});

describe("LayerUtil: getEvents / getMultiLayerEvents stay identical to the *WithMeta variants", () => {
  test("getEvents returns exactly getEventsWithMeta().events, never truncated by default", () => {
    const util: LayerUtil = new LayerUtil();
    const props: LayerProps = primaryLayer(false);

    const plain: Array<CalendarEvent> = util.getEvents({
      ...props,
      calendarStartDate: CAL_START,
      calendarEndDate: CAL_END,
    });

    const withMeta: LayerEventsResult = util.getEventsWithMeta({
      ...props,
      calendarStartDate: CAL_START,
      calendarEndDate: CAL_END,
    });

    expect(plain.length).toBeGreaterThan(0);
    expect(JSON.stringify(plain)).toBe(JSON.stringify(withMeta.events));
    expect(withMeta.truncated).toBe(false);
  });

  test("getMultiLayerEvents returns exactly getMultiLayerEventsWithMeta().events", () => {
    const util: LayerUtil = new LayerUtil();

    const plain: Array<CalendarEvent> = util.getMultiLayerEvents({
      layers: [primaryLayer(false), fallbackLayer(false)],
      calendarStartDate: CAL_START,
      calendarEndDate: CAL_END,
    });

    const withMeta: LayerEventsResult = util.getMultiLayerEventsWithMeta({
      layers: [primaryLayer(false), fallbackLayer(false)],
      calendarStartDate: CAL_START,
      calendarEndDate: CAL_END,
    });

    expect(JSON.stringify(plain)).toBe(JSON.stringify(withMeta.events));
    expect(withMeta.truncated).toBe(false);
  });

  test("getNumberOfEvents still caps the merged result through the meta variant", () => {
    const util: LayerUtil = new LayerUtil();

    const withMeta: LayerEventsResult = util.getMultiLayerEventsWithMeta(
      {
        layers: [primaryLayer(false), fallbackLayer(false)],
        calendarStartDate: CAL_START,
        calendarEndDate: CAL_END,
      },
      { getNumberOfEvents: 2 },
    );

    expect(withMeta.events).toHaveLength(2);
    expect(withMeta.truncated).toBe(false);
  });

  test("invalid windows still yield an empty, untruncated result", () => {
    const util: LayerUtil = new LayerUtil();

    const result: LayerEventsResult = util.getEventsWithMeta({
      ...primaryLayer(false),
      calendarStartDate: CAL_END,
      calendarEndDate: CAL_START,
    });

    expect(result.events).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe("LayerUtil: maxSimulationIterations", () => {
  /*
   * A restricted hourly layer that started six months before the window: the
   * engine must simulate ~4,500 periods to find the rotation position at the
   * window start (the restricted path cannot use the O(1) index).
   */
  const oldRestrictedLayer: LayerProps = {
    users: [user("A"), user("B"), user("C")],
    startDateTimeOfLayer: at("2025-07-01T00:00:00Z"),
    restrictionTimes: dailyRestriction("09:00", "17:00", UTC),
    handOffTime: at("2025-07-01T09:00:00Z"),
    rotation: rotation(EventInterval.Hour, 1),
    timezone: UTC,
  };

  const windowStart: Date = at("2026-01-05T00:00:00Z");
  const windowEnd: Date = at("2026-01-07T00:00:00Z");

  test("a pre-window cap hit yields NO events for the layer and truncated=true", () => {
    const result: LayerEventsResult = new LayerUtil().getEventsWithMeta(
      {
        ...oldRestrictedLayer,
        calendarStartDate: windowStart,
        calendarEndDate: windowEnd,
      },
      { maxSimulationIterations: 100 },
    );

    expect(result.truncated).toBe(true);
    expect(result.events).toEqual([]);
  });

  test("without the option the same layer expands fully and is not truncated", () => {
    const result: LayerEventsResult = new LayerUtil().getEventsWithMeta({
      ...oldRestrictedLayer,
      calendarStartDate: windowStart,
      calendarEndDate: windowEnd,
    });

    expect(result.truncated).toBe(false);
    expect(result.events.length).toBeGreaterThan(0);
  });

  test("a generous cap produces the same events as no cap", () => {
    const util: LayerUtil = new LayerUtil();

    const unbounded: LayerEventsResult = util.getEventsWithMeta({
      ...oldRestrictedLayer,
      calendarStartDate: windowStart,
      calendarEndDate: windowEnd,
    });

    const bounded: LayerEventsResult = util.getEventsWithMeta(
      {
        ...oldRestrictedLayer,
        calendarStartDate: windowStart,
        calendarEndDate: windowEnd,
      },
      { maxSimulationIterations: 200000 },
    );

    expect(bounded.truncated).toBe(false);
    expect(JSON.stringify(bounded.events)).toBe(
      JSON.stringify(unbounded.events),
    );
  });

  test("an in-window cap hit keeps the events produced so far and sets truncated", () => {
    // Unrestricted (O(1) index), so the cap can only bite inside the window.
    const hourlyLayer: LayerProps = {
      users: [user("A"), user("B")],
      startDateTimeOfLayer: windowStart,
      restrictionTimes: noRestriction(),
      handOffTime: at("2026-01-05T01:00:00Z"),
      rotation: rotation(EventInterval.Hour, 1),
      timezone: UTC,
    };

    const tenDaysLater: Date = at("2026-01-15T00:00:00Z");

    const capped: LayerEventsResult = new LayerUtil().getEventsWithMeta(
      {
        ...hourlyLayer,
        calendarStartDate: windowStart,
        calendarEndDate: tenDaysLater,
      },
      { maxSimulationIterations: 50 },
    );

    expect(capped.truncated).toBe(true);
    expect(capped.events.length).toBeGreaterThan(0);
    expect(capped.events.length).toBeLessThanOrEqual(50);

    const full: LayerEventsResult = new LayerUtil().getEventsWithMeta({
      ...hourlyLayer,
      calendarStartDate: windowStart,
      calendarEndDate: tenDaysLater,
    });

    expect(full.truncated).toBe(false);
    expect(full.events.length).toBeGreaterThan(capped.events.length);

    // The events that WERE produced are a prefix of the full expansion.
    for (let i: number = 0; i < capped.events.length; i++) {
      expect(capped.events[i]!.title).toBe(full.events[i]!.title);
      expect(capped.events[i]!.start.getTime()).toBe(
        full.events[i]!.start.getTime(),
      );
      expect(capped.events[i]!.end.getTime()).toBe(
        full.events[i]!.end.getTime(),
      );
    }
  });

  test("getMultiLayerEventsWithMeta reports truncated when ANY layer hit the cap and keeps the others", () => {
    const fineLayer: LayerProps = {
      users: [user("Z")],
      startDateTimeOfLayer: windowStart,
      restrictionTimes: noRestriction(),
      handOffTime: windowStart,
      rotation: rotation(EventInterval.Week, 1),
      timezone: UTC,
    };

    const result: LayerEventsResult =
      new LayerUtil().getMultiLayerEventsWithMeta(
        {
          layers: [oldRestrictedLayer, fineLayer],
          calendarStartDate: windowStart,
          calendarEndDate: windowEnd,
        },
        { maxSimulationIterations: 100 },
      );

    expect(result.truncated).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
    for (const event of result.events) {
      expect(event.title).toBe("Z");
    }
  });

  test("a non-positive or non-finite cap is ignored", () => {
    const util: LayerUtil = new LayerUtil();

    const reference: LayerEventsResult = util.getEventsWithMeta({
      ...oldRestrictedLayer,
      calendarStartDate: windowStart,
      calendarEndDate: windowEnd,
    });

    for (const cap of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result: LayerEventsResult = util.getEventsWithMeta(
        {
          ...oldRestrictedLayer,
          calendarStartDate: windowStart,
          calendarEndDate: windowEnd,
        },
        { maxSimulationIterations: cap },
      );

      expect(result.truncated).toBe(false);
      expect(JSON.stringify(result.events)).toBe(
        JSON.stringify(reference.events),
      );
    }
  });

  test("the plain getMultiLayerEvents still returns the partial events under a cap", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents(
      {
        layers: [oldRestrictedLayer],
        calendarStartDate: windowStart,
        calendarEndDate: windowEnd,
      },
      { maxSimulationIterations: 100 },
    );

    expect(events).toEqual([]);
  });
});
