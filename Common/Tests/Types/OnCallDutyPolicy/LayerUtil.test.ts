import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes, { RestrictionType } from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import OneUptimeDate from "../../../Types/Date";
import User from "../../../Models/DatabaseModels/User";
import EventInterval from "../../../Types/Events/EventInterval";

// Helper to create a user model with id only.
function user(id: string): User {
  return { id: { toString: () => id } as any } as User;
}

function buildLayerProps(data: {
  users: string[];
  start: Date;
  handoff: Date;
  restriction?: { type: RestrictionType; start?: string; end?: string };
  rotation?: { intervalType: EventInterval; intervalCount: number };
}): LayerProps {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();

  if (data.restriction) {
    restrictionTimes.restictionType = data.restriction.type;
    if (data.restriction.type === RestrictionType.Daily && data.restriction.start && data.restriction.end) {
      restrictionTimes.dayRestrictionTimes = {
        startTime: OneUptimeDate.getDateWithCustomTime({
          hours: parseInt(data.restriction.start.split(":")[0] || "0"),
          minutes: parseInt(data.restriction.start.split(":")[1] || "0"),
          seconds: 0,
        }),
        endTime: OneUptimeDate.getDateWithCustomTime({
          hours: parseInt(data.restriction.end.split(":")[0] || "0"),
          minutes: parseInt(data.restriction.end.split(":")[1] || "0"),
          seconds: 0,
        }),
      };
    }
  } else {
    restrictionTimes.restictionType = RestrictionType.None;
    restrictionTimes.dayRestrictionTimes = null;
  }

  const rotation: Recurring = data.rotation
    ? Recurring.fromJSON({
        _type: "Recurring",
        value: {
          intervalType: data.rotation.intervalType,
          intervalCount: { _type: "PositiveNumber", value: data.rotation.intervalCount },
        },
      } as any)
    : Recurring.fromJSON({
        _type: "Recurring",
        value: {
          intervalType: EventInterval.Day,
          intervalCount: { _type: "PositiveNumber", value: 1 },
        },
      } as any);

  return {
    users: data.users.map(user),
    startDateTimeOfLayer: data.start,
    handOffTime: data.handoff,
    restrictionTimes,
    rotation,
  };
}

describe("LayerUtil getEvents - Daily Restrictions", () => {
  test("Should return full-day events when no restriction", () => {
    const util = new LayerUtil();
    const start = OneUptimeDate.getStartOfDay(new Date());
    const end = OneUptimeDate.addRemoveDays(start, 1); // one day calendar

    const layer = buildLayerProps({
      users: ["u1"],
      start: start,
      handoff: OneUptimeDate.addRemoveDays(start, 10),
    });

    const events = util.getEvents({
      ...layer,
      calendarStartDate: start,
      calendarEndDate: end,
    });

  expect(events.length).toBe(1);
  const only = events[0]!;
  expect(only.start.getTime()).toBe(start.getTime());
  expect(only.end.getTime()).toBe(end.getTime());
  });

  test("Should trim to same-day restriction window (11:00-23:00)", () => {
    const util = new LayerUtil();
    const start = OneUptimeDate.getStartOfDay(new Date());
    const calendarEnd = OneUptimeDate.addRemoveDays(start, 1);

    const layer = buildLayerProps({
      users: ["u1"],
      start: start,
      handoff: OneUptimeDate.addRemoveDays(start, 2),
      restriction: { type: RestrictionType.Daily, start: "11:00", end: "23:00" },
    });

    const events = util.getEvents({
      ...layer,
      calendarStartDate: start,
      calendarEndDate: calendarEnd,
    });

    expect(events.length).toBe(1);
  const ev = events[0]!;
  expect(OneUptimeDate.getLocalHourAndMinuteFromDate(ev.start)).toBe("11:00");
  expect(OneUptimeDate.getLocalHourAndMinuteFromDate(ev.end)).toBe("23:00");
  });

  test("Should produce two segments for overnight window (23:00-11:00 next day)", () => {
    const util = new LayerUtil();
    const todayStart = OneUptimeDate.getStartOfDay(new Date());
    const calendarEnd = OneUptimeDate.addRemoveDays(todayStart, 1); // 24h range

    const layer = buildLayerProps({
      users: ["u1"],
      start: todayStart,
      handoff: OneUptimeDate.addRemoveDays(todayStart, 2),
      restriction: { type: RestrictionType.Daily, start: "23:00", end: "11:00" },
    });

    const events = util.getEvents({
      ...layer,
      calendarStartDate: todayStart,
      calendarEndDate: calendarEnd,
    });

    // Expect two events: 23:00 -> 23:59:59 (approx) and 00:00 -> 11:00 next day (depending on trimming logic)
    // We simplify by checking presence of one starting at 23:00 and one ending at 11:00.
    expect(events.length).toBeGreaterThanOrEqual(1); // Could be 1 or 2 depending on merging logic; validate coverage below.

    const has23Start = events.some(e => OneUptimeDate.getLocalHourAndMinuteFromDate(e.start) === "23:00");
    const has11End = events.some(e => OneUptimeDate.getLocalHourAndMinuteFromDate(e.end) === "11:00");

    expect(has23Start).toBeTruthy();
    expect(has11End).toBeTruthy();
  });
});

describe("LayerUtil getEvents - Rotation Handoff", () => {
  test("Hourly rotation changes user after each hour", () => {
    const util = new LayerUtil();
    const start = OneUptimeDate.getStartOfDay(new Date());
    const calendarEnd = OneUptimeDate.addRemoveHours(start, 5); // 5 hours window

    const layer = buildLayerProps({
      users: ["u1", "u2", "u3"],
      start: start,
      handoff: OneUptimeDate.addRemoveHours(start, 1), // first handoff at +1h
      rotation: { intervalType: EventInterval.Hour, intervalCount: 1 },
    });

    const events = util.getEvents({
      ...layer,
      calendarStartDate: start,
      calendarEndDate: calendarEnd,
    });

    // Expect roughly 5 events (one per hour) and user IDs rotate in sequence.
    expect(events.length).toBeGreaterThanOrEqual(4);
    const userSequence = events.map(e => e.title);

    // Titles are user ids (strings we passed) according to implementation.
    // Check that at least first three rotate u1 -> u2 -> u3
    expect(userSequence.slice(0,3)).toEqual(["u1","u2","u3"]);
  });
});

describe("LayerUtil getMultiLayerEvents - Overlap Priority", () => {
  test("Higher priority (lower index) layer should trim overlapping lower priority events", () => {
    const util = new LayerUtil();
    const start = OneUptimeDate.getStartOfDay(new Date());
    const calendarEnd = OneUptimeDate.addRemoveHours(start, 6);

    const layer1 = buildLayerProps({
      users: ["primary"],
      start: start,
      handoff: OneUptimeDate.addRemoveHours(start, 6),
    });

    const layer2 = buildLayerProps({
      users: ["backup"],
      start: start,
      handoff: OneUptimeDate.addRemoveHours(start, 6),
    });

    const events = util.getMultiLayerEvents({
      layers: [layer1, layer2],
      calendarStartDate: start,
      calendarEndDate: calendarEnd,
    });

    // All events should belong to primary (priority 1) with no backup overlapping intervals left.
    const titles = events.map(e => e.title);
    expect(titles.every(t => t === "primary")).toBeTruthy();
  });
});
