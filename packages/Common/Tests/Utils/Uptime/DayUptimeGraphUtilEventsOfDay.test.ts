import DayUptimeGraphUtil, {
  DayEvent,
} from "../../../Utils/Uptime/DayUptimeGraphUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * The events one day of the uptime history lists (DayUptimeGraph's tooltip,
 * its count and its dialog): those declared in it, at both ends of the day,
 * each once. On a page that shows episodes but not incidents a day lists the
 * episode behind each incident of it (#10767), so an episode with two
 * incidents that day is one event, at the earlier one.
 */

interface Event extends DayEvent {
  title: string;
}

const START: Date = new Date("2026-11-23T00:00:00.000Z");
// The next day's start less a millisecond, as the strip's days end.
const END: Date = new Date("2026-11-23T23:59:59.999Z");

function event(id: string, iso: string, title: string = id): Event {
  return { id: id, declaredAt: new Date(iso), title: title };
}

function eventsOf(events: Array<Event>): Array<string> {
  return DayUptimeGraphUtil.getEventsOfDay<Event>({
    events: events,
    startOfDay: START,
    endOfDay: END,
  }).map((item: Event): string => {
    return `${item.id}@${new Date(item.declaredAt).toISOString()}`;
  });
}

describe("DayUptimeGraphUtil.getEventsOfDay", () => {
  test("lists the events declared in the day, in the order they came", () => {
    expect(
      eventsOf([
        event("b", "2026-11-23T15:00:00.000Z"),
        event("a", "2026-11-23T09:00:00.000Z"),
      ]),
    ).toEqual(["b@2026-11-23T15:00:00.000Z", "a@2026-11-23T09:00:00.000Z"]);
  });

  test("takes both ends of the day, and nothing either side", () => {
    expect(
      eventsOf([
        event("first-instant", "2026-11-23T00:00:00.000Z"),
        event("last-instant", "2026-11-23T23:59:59.999Z"),
        event("day-before", "2026-11-22T23:59:59.999Z"),
        event("day-after", "2026-11-24T00:00:00.000Z"),
      ]),
    ).toEqual([
      "first-instant@2026-11-23T00:00:00.000Z",
      "last-instant@2026-11-23T23:59:59.999Z",
    ]);
  });

  test("lists an event twice in a day once, at its earliest, where it first came", () => {
    expect(
      eventsOf([
        event("episode", "2026-11-23T10:00:00.000Z"),
        event("other", "2026-11-23T11:00:00.000Z"),
        event("episode", "2026-11-23T09:00:00.000Z"),
        event("episode", "2026-11-23T12:00:00.000Z"),
      ]),
    ).toEqual([
      "episode@2026-11-23T09:00:00.000Z",
      "other@2026-11-23T11:00:00.000Z",
    ]);
  });

  test("an event on another day does not take its place", () => {
    expect(
      eventsOf([
        event("episode", "2026-11-22T09:00:00.000Z"),
        event("episode", "2026-11-23T09:00:00.000Z"),
      ]),
    ).toEqual(["episode@2026-11-23T09:00:00.000Z"]);
  });

  test("an event without an id is never taken for another", () => {
    expect(
      eventsOf([
        event("", "2026-11-23T09:00:00.000Z", "first"),
        event("", "2026-11-23T10:00:00.000Z", "second"),
      ]),
    ).toEqual(["@2026-11-23T09:00:00.000Z", "@2026-11-23T10:00:00.000Z"]);
  });

  test("reads a declaration sent as text as well as a date", () => {
    expect(
      DayUptimeGraphUtil.getEventsOfDay<DayEvent>({
        events: [{ id: "a", declaredAt: "2026-11-23T08:00:00.000Z" }],
        startOfDay: START,
        endOfDay: END,
      }),
    ).toHaveLength(1);
  });

  test("no events, no day's events", () => {
    expect(eventsOf([])).toEqual([]);
  });
});
