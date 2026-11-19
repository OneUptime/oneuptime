import ExternalCalendarExpansion, {
  ExternalCalendarEventToKeep,
  ExternalCalendarExpansionResult,
} from "../../../../../Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarExpansion";
import { NOW, calendar, event } from "./ExternalCalendarFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * MAINTENANCE WINDOWS FROM AN EXTERNAL CALENDAR IN BRITISH COLUMBIA
 * (issue #9999).
 *
 * A calendar a status page overlays names its times' zone with a TZID, or
 * the calendar's own X-WR-TIMEZONE, and OneUptime reads a wall clock in
 * that zone with moment-timezone's data (ExternalCalendarExpansion.toInstant).
 * British Columbia stayed on UTC-7 when the rest of the Pacific zone fell
 * back on 2026-11-01 (tzdata 2026b): a weekly 02:00 window there is 09:00
 * UTC every week. With tzdata 2024b the windows after 1 November were read
 * as 10:00 UTC, so the status page showed maintenance an hour late. Los
 * Angeles still falls back: its 02:00 window is 10:00 UTC from November.
 *
 * Every test runs at Thursday 15 October 2026, 10:20 UTC (the fixtures'
 * NOW).
 */

type Window = [string, string];

async function windowsOf(text: string): Promise<Array<Window>> {
  const result: ExternalCalendarExpansionResult =
    await ExternalCalendarExpansion.expand(text, { now: NOW });

  if (!result.ok) {
    throw new Error(`Expected events, got ${result.error}`);
  }

  return result.events.map((item: ExternalCalendarEventToKeep): Window => {
    return [item.startsAt.toISOString(), item.endsAt.toISOString()];
  });
}

// A weekly window from 02:00 to 04:00 on Tuesdays, four times, in `tzid`.
function weeklyWindowIn(tzid: string): string {
  return calendar([
    ...event({
      uid: `weekly-${tzid}`,
      summary: "Database maintenance",
      start: `;TZID=${tzid}:20261027T020000`,
      end: `;TZID=${tzid}:20261027T040000`,
      extra: ["RRULE:FREQ=WEEKLY;COUNT=4"],
    }),
  ]);
}

describe("a weekly 02:00 maintenance window from an external calendar", () => {
  test.each(["America/Vancouver", "Canada/Pacific"])(
    "in %s is 09:00 to 11:00 UTC every week, before and after 2026-11-01",
    async (tzid: string) => {
      expect(await windowsOf(weeklyWindowIn(tzid))).toEqual([
        ["2026-10-27T09:00:00.000Z", "2026-10-27T11:00:00.000Z"],
        ["2026-11-03T09:00:00.000Z", "2026-11-03T11:00:00.000Z"],
        ["2026-11-10T09:00:00.000Z", "2026-11-10T11:00:00.000Z"],
        ["2026-11-17T09:00:00.000Z", "2026-11-17T11:00:00.000Z"],
      ]);
    },
  );

  test.each(["America/Los_Angeles", "America/Tijuana"])(
    "in %s, which still falls back, is 10:00 to 12:00 UTC from November",
    async (tzid: string) => {
      expect(await windowsOf(weeklyWindowIn(tzid))).toEqual([
        ["2026-10-27T09:00:00.000Z", "2026-10-27T11:00:00.000Z"],
        ["2026-11-03T10:00:00.000Z", "2026-11-03T12:00:00.000Z"],
        ["2026-11-10T10:00:00.000Z", "2026-11-10T12:00:00.000Z"],
        ["2026-11-17T10:00:00.000Z", "2026-11-17T12:00:00.000Z"],
      ]);
    },
  );
});

describe("a floating time in a calendar whose own zone is British Columbia's", () => {
  test("09:00 is 16:00 UTC in October and in December alike", async () => {
    expect(
      await windowsOf(
        calendar(
          [
            ...event({
              uid: "floating-october",
              summary: "Before the change",
              start: ":20261020T090000",
              end: ":20261020T100000",
            }),
            ...event({
              uid: "floating-december",
              summary: "After the change",
              start: ":20261201T090000",
              end: ":20261201T100000",
            }),
          ],
          ["X-WR-TIMEZONE:America/Vancouver"],
        ),
      ),
    ).toEqual([
      ["2026-10-20T16:00:00.000Z", "2026-10-20T17:00:00.000Z"],
      ["2026-12-01T16:00:00.000Z", "2026-12-01T17:00:00.000Z"],
    ]);
  });
});
