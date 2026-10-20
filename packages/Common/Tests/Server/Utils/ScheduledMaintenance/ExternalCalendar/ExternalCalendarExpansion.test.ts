import ExternalCalendarExpansion, {
  EXTERNAL_CALENDAR_WORKER_PATH,
  ExternalCalendarEventToKeep,
  ExternalCalendarExpansionResult,
} from "../../../../../Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarExpansion";
import {
  EXTERNAL_CALENDAR_FUTURE_DAYS,
  EXTERNAL_CALENDAR_MAX_TITLE_LENGTH,
  EXTERNAL_CALENDAR_PAST_DAYS,
  ExternalCalendarReadError,
} from "../../../../../Types/ScheduledMaintenance/ExternalCalendar";
import MaintenanceCalendar, {
  MaintenanceCalendarAudience,
} from "../../../../../Types/ScheduledMaintenance/MaintenanceCalendar";
import {
  EXCHANGE_CALENDAR,
  GOOGLE_HOLIDAYS_CALENDAR,
  NOW,
  calendar,
  event,
} from "./ExternalCalendarFixtures";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";

/*
 * A calendar's events, worked out from its text in a worker thread
 * (ExternalCalendarExpansion + ExternalCalendarExpansionWorker.cjs) - the
 * real worker, the real ical.js, on calendars shaped as Exchange, Google
 * Calendar and OneUptime itself write them.
 *
 * Every test runs at Thursday 15 October 2026, 10:20 UTC: the window then
 * runs from 17 July 2026 to 16 October 2027 (90 days back, a year ahead).
 */

interface Kept {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

function kept(events: Array<ExternalCalendarEventToKeep>): Array<Kept> {
  return events.map((item: ExternalCalendarEventToKeep): Kept => {
    return {
      title: item.title,
      start: item.startsAt.toISOString(),
      end: item.endsAt.toISOString(),
      allDay: item.isAllDay,
    };
  });
}

async function expand(
  text: string,
  options: Partial<Parameters<typeof ExternalCalendarExpansion.expand>[1]> = {},
): Promise<ExternalCalendarExpansionResult> {
  return await ExternalCalendarExpansion.expand(text, {
    now: NOW,
    ...options,
  });
}

async function expandOk(
  text: string,
  options: Partial<Parameters<typeof ExternalCalendarExpansion.expand>[1]> = {},
): Promise<Extract<ExternalCalendarExpansionResult, { ok: true }>> {
  const result: ExternalCalendarExpansionResult = await expand(text, options);

  if (!result.ok) {
    throw new Error(`Expected events, got ${result.error}`);
  }

  return result;
}

describe("the worker", () => {
  test("is a file beside the module, so a fresh Node thread can load it", () => {
    expect(fs.existsSync(EXTERNAL_CALENDAR_WORKER_PATH)).toBe(true);
    expect(EXTERNAL_CALENDAR_WORKER_PATH.endsWith(".cjs")).toBe(true);
  });
});

describe("the window", () => {
  test("runs from 90 days back to a year ahead, in whole UTC days", () => {
    const window: { start: Date; end: Date } =
      ExternalCalendarExpansion.getWindow(NOW);

    expect(EXTERNAL_CALENDAR_PAST_DAYS).toBe(90);
    expect(EXTERNAL_CALENDAR_FUTURE_DAYS).toBe(365);
    expect(window.start.toISOString()).toBe("2026-07-17T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2027-10-16T00:00:00.000Z");
  });

  test("keeps what touches it and leaves out what does not", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          // Over before the window starts.
          ...event({
            uid: "too-old",
            summary: "Too old",
            start: ":20260601T090000Z",
            end: ":20260601T100000Z",
          }),
          // Across the window's start.
          ...event({
            uid: "across",
            summary: "Across the start",
            start: ":20260716T090000Z",
            end: ":20260718T090000Z",
          }),
          // Inside it.
          ...event({
            uid: "inside",
            summary: "Inside",
            start: ":20261020T090000Z",
            end: ":20261020T100000Z",
          }),
          // After it.
          ...event({
            uid: "too-far",
            summary: "Too far ahead",
            start: ":20280101T090000Z",
            end: ":20280101T100000Z",
          }),
        ]),
      );

    expect(
      kept(result.events).map((item: Kept) => {
        return item.title;
      }),
    ).toEqual(["Across the start", "Inside"]);
    expect(result.eventsInWindow).toBe(2);
    expect(result.hasMoreEvents).toBe(false);
  });
});

describe("a calendar from Exchange", () => {
  test("repeats a weekly meeting in its VTIMEZONE across the change from summer time", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(EXCHANGE_CALENDAR);

    /*
     * 09:00 in Berlin: 07:00 UTC in summer time, 08:00 UTC after 25
     * October. 12 October is an EXDATE; 19 October moved to 20 October at
     * 14:00 with its own title.
     */
    expect(kept(result.events)).toEqual([
      {
        title: "Change freeze review",
        start: "2026-10-05T07:00:00.000Z",
        end: "2026-10-05T08:00:00.000Z",
        allDay: false,
      },
      {
        title: "Change freeze review (moved)",
        start: "2026-10-20T12:00:00.000Z",
        end: "2026-10-20T13:00:00.000Z",
        allDay: false,
      },
      {
        title: "Change freeze review",
        start: "2026-10-26T08:00:00.000Z",
        end: "2026-10-26T09:00:00.000Z",
        allDay: false,
      },
      {
        title: "Change freeze review",
        start: "2026-11-02T08:00:00.000Z",
        end: "2026-11-02T09:00:00.000Z",
        allDay: false,
      },
      {
        title: "Change freeze review",
        start: "2026-11-09T08:00:00.000Z",
        end: "2026-11-09T09:00:00.000Z",
        allDay: false,
      },
    ]);
    expect(result.skippedSeries).toBe(0);
  });
});

describe("a calendar from Google Calendar", () => {
  test("keeps all-day holidays as dates, their last day included", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(GOOGLE_HOLIDAYS_CALENDAR);

    expect(kept(result.events)).toEqual([
      {
        title: "Christmas Day",
        start: "2026-12-25T00:00:00.000Z",
        end: "2026-12-26T00:00:00.000Z",
        allDay: true,
      },
      {
        title: "Boxing Day",
        start: "2026-12-26T00:00:00.000Z",
        end: "2026-12-27T00:00:00.000Z",
        allDay: true,
      },
      {
        title: "Company shutdown",
        start: "2026-12-28T00:00:00.000Z",
        end: "2027-01-02T00:00:00.000Z",
        allDay: true,
      },
    ]);
  });

  test("repeats a yearly all-day event once each year in the window", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "summer-freeze",
            summary: "Summer change freeze",
            start: ";VALUE=DATE:20150801",
            end: ";VALUE=DATE:20150802",
            extra: ["RRULE:FREQ=YEARLY"],
          }),
        ]),
      );

    expect(
      kept(result.events).map((item: Kept) => {
        return [item.start, item.allDay];
      }),
    ).toEqual([
      ["2026-08-01T00:00:00.000Z", true],
      ["2027-08-01T00:00:00.000Z", true],
    ]);
  });

  test("gives an all-day event with no end one day", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "one-day",
            summary: "One day",
            start: ";VALUE=DATE:20261101",
          }),
        ]),
      );

    expect(kept(result.events)).toEqual([
      {
        title: "One day",
        start: "2026-11-01T00:00:00.000Z",
        end: "2026-11-02T00:00:00.000Z",
        allDay: true,
      },
    ]);
  });
});

describe("times with no VTIMEZONE", () => {
  test("a TZID naming an IANA zone is read in that zone, daylight saving included", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "new-york-weekly",
            summary: "Standup in New York",
            start: ";TZID=America/New_York:20261026T090000",
            end: ";TZID=America/New_York:20261026T093000",
            extra: ["RRULE:FREQ=WEEKLY;COUNT=2"],
          }),
        ]),
      );

    // 09:00 EDT is 13:00 UTC; after 1 November, 09:00 EST is 14:00 UTC.
    expect(
      kept(result.events).map((item: Kept) => {
        return [item.start, item.end];
      }),
    ).toEqual([
      ["2026-10-26T13:00:00.000Z", "2026-10-26T13:30:00.000Z"],
      ["2026-11-02T14:00:00.000Z", "2026-11-02T14:30:00.000Z"],
    ]);
  });

  test("an old Mozilla TZID is read as the IANA zone at its end", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "mozilla",
            summary: "Mozilla zone",
            start: ";TZID=/mozilla.org/20050126_1/Europe/Paris:20261110T090000",
            end: ";TZID=/mozilla.org/20050126_1/Europe/Paris:20261110T100000",
          }),
        ]),
      );

    expect(kept(result.events)[0]!.start).toBe("2026-11-10T08:00:00.000Z");
  });

  test("a floating time is read in the calendar's own zone (X-WR-TIMEZONE)", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar(
          [
            ...event({
              uid: "floating-summer",
              summary: "Floating in summer",
              start: ":20261014T090000",
              end: ":20261014T100000",
            }),
            ...event({
              uid: "floating-winter",
              summary: "Floating in winter",
              start: ":20261105T090000",
              end: ":20261105T100000",
            }),
          ],
          ["X-WR-TIMEZONE:Europe/London"],
        ),
      );

    // British Summer Time until 25 October: 09:00 BST is 08:00 UTC.
    expect(
      kept(result.events).map((item: Kept) => {
        return item.start;
      }),
    ).toEqual(["2026-10-14T08:00:00.000Z", "2026-11-05T09:00:00.000Z"]);
  });

  test("a floating time in a calendar with no zone, or a TZID nobody knows, is read as UTC", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "floating",
            summary: "Floating",
            start: ":20261105T090000",
            end: ":20261105T100000",
          }),
          ...event({
            uid: "unknown-zone",
            summary: "Unknown zone",
            start: ";TZID=Mars/Olympus_Mons:20261106T090000",
            end: ";TZID=Mars/Olympus_Mons:20261106T100000",
          }),
        ]),
      );

    expect(
      kept(result.events).map((item: Kept) => {
        return item.start;
      }),
    ).toEqual(["2026-11-05T09:00:00.000Z", "2026-11-06T09:00:00.000Z"]);
  });
});

describe("what an event holds", () => {
  test("DURATION gives the end, and a timed event with no end lasts no time", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "duration",
            summary: "Two and a half hours",
            start: ":20261103T080000Z",
            extra: ["DURATION:PT2H30M"],
          }),
          ...event({
            uid: "moment",
            summary: "A moment",
            start: ":20261104T080000Z",
          }),
          ...event({
            uid: "backwards",
            summary: "Ends before it starts",
            start: ":20261105T080000Z",
            end: ":20261105T070000Z",
          }),
        ]),
      );

    expect(kept(result.events)).toEqual([
      {
        title: "Two and a half hours",
        start: "2026-11-03T08:00:00.000Z",
        end: "2026-11-03T10:30:00.000Z",
        allDay: false,
      },
      {
        title: "A moment",
        start: "2026-11-04T08:00:00.000Z",
        end: "2026-11-04T08:00:00.000Z",
        allDay: false,
      },
      {
        title: "Ends before it starts",
        start: "2026-11-05T08:00:00.000Z",
        end: "2026-11-05T08:00:00.000Z",
        allDay: false,
      },
    ]);
  });

  test("a private or confidential event keeps its time but not its title, and one with no title has none", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "private",
            summary: "Interview with Ana",
            start: ":20261103T080000Z",
            end: ":20261103T090000Z",
            extra: ["CLASS:PRIVATE"],
          }),
          ...event({
            uid: "confidential",
            summary: "Acquisition talks",
            start: ":20261104T080000Z",
            end: ":20261104T090000Z",
            extra: ["CLASS:CONFIDENTIAL"],
          }),
          ...event({
            uid: "untitled",
            start: ":20261105T080000Z",
            end: ":20261105T090000Z",
          }),
        ]),
      );

    expect(
      kept(result.events).map((item: Kept) => {
        return [item.title, item.start];
      }),
    ).toEqual([
      ["", "2026-11-03T08:00:00.000Z"],
      ["", "2026-11-04T08:00:00.000Z"],
      ["", "2026-11-05T08:00:00.000Z"],
    ]);
  });

  test("a cancelled event, and a cancelled occurrence of a repeating one, are left out", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "cancelled",
            summary: "Called off",
            start: ":20261103T080000Z",
            end: ":20261103T090000Z",
            extra: ["STATUS:CANCELLED"],
          }),
          ...event({
            uid: "daily",
            summary: "Daily window",
            start: ":20261110T020000Z",
            end: ":20261110T030000Z",
            extra: ["RRULE:FREQ=DAILY;COUNT=3"],
          }),
          ...event({
            uid: "daily",
            summary: "Daily window",
            start: ":20261111T020000Z",
            end: ":20261111T030000Z",
            extra: ["RECURRENCE-ID:20261111T020000Z", "STATUS:CANCELLED"],
          }),
        ]),
      );

    expect(
      kept(result.events).map((item: Kept) => {
        return [item.title, item.start];
      }),
    ).toEqual([
      ["Daily window", "2026-11-10T02:00:00.000Z"],
      ["Daily window", "2026-11-12T02:00:00.000Z"],
    ]);
  });

  test("RDATE adds occurrences and EXDATE takes them away", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "patching",
            summary: "Patching",
            start: ":20261101T220000Z",
            end: ":20261101T230000Z",
            extra: [
              "RRULE:FREQ=MONTHLY;COUNT=3",
              "RDATE:20261115T220000Z,20261116T220000Z",
              "EXDATE:20261201T220000Z",
            ],
          }),
        ]),
      );

    expect(
      kept(result.events).map((item: Kept) => {
        return item.start;
      }),
    ).toEqual([
      "2026-11-01T22:00:00.000Z",
      "2026-11-15T22:00:00.000Z",
      "2026-11-16T22:00:00.000Z",
      "2027-01-01T22:00:00.000Z",
    ]);
  });

  test("a rule that ended before the window gives nothing", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "ended",
            summary: "Ended long ago",
            start: ":20200101T090000Z",
            end: ":20200101T100000Z",
            extra: ["RRULE:FREQ=WEEKLY;UNTIL=20210101T000000Z"],
          }),
        ]),
      );

    expect(result.events).toEqual([]);
    expect(result.eventsInWindow).toBe(0);
  });

  test("a title is on one line, its runs of spaces one space, and cut to 500 characters", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "lines",
            summary: "Line one\\nLine two\\n\\n   Line three",
            start: ":20261103T080000Z",
            end: ":20261103T090000Z",
          }),
          ...event({
            uid: "long",
            summary: "x".repeat(2000),
            start: ":20261104T080000Z",
            end: ":20261104T090000Z",
          }),
        ]),
      );

    expect(result.events[0]!.title).toBe("Line one Line two Line three");
    expect(result.events[1]!.title).toBe(
      "x".repeat(EXTERNAL_CALENDAR_MAX_TITLE_LENGTH),
    );
    expect(EXTERNAL_CALENDAR_MAX_TITLE_LENGTH).toBe(500);
  });

  test("the same event twice at the same time is kept once", async () => {
    const twice: Array<string> = event({
      uid: "twice",
      summary: "Written twice",
      start: ":20261103T080000Z",
      end: ":20261103T090000Z",
    });

    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(calendar([...twice, ...twice]));

    expect(result.events).toHaveLength(1);
  });

  test("an override whose event is not in the calendar is an event of its own", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "orphan",
            summary: "Moved, from a series we do not have",
            start: ":20261103T080000Z",
            end: ":20261103T090000Z",
            extra: ["RECURRENCE-ID:20261102T080000Z"],
          }),
        ]),
      );

    expect(kept(result.events)).toEqual([
      {
        title: "Moved, from a series we do not have",
        start: "2026-11-03T08:00:00.000Z",
        end: "2026-11-03T09:00:00.000Z",
        allDay: false,
      },
    ]);
  });

  test("an occurrence moved from past the window into it is kept", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "yearly-review",
            summary: "Yearly review",
            start: ":20260101T090000Z",
            end: ":20260101T100000Z",
            extra: ["RRULE:FREQ=YEARLY;COUNT=4"],
          }),
          // The 2028 review, brought forward into December 2026.
          ...event({
            uid: "yearly-review",
            summary: "Yearly review (brought forward)",
            start: ":20261201T090000Z",
            end: ":20261201T100000Z",
            extra: ["RECURRENCE-ID:20280101T090000Z"],
          }),
        ]),
      );

    expect(
      kept(result.events).map((item: Kept) => {
        return [item.title, item.start];
      }),
    ).toEqual([
      ["Yearly review (brought forward)", "2026-12-01T09:00:00.000Z"],
      ["Yearly review", "2027-01-01T09:00:00.000Z"],
    ]);
  });

  test("reads every calendar of a text that holds more than one", async () => {
    const text: string = [
      calendar([
        ...event({
          uid: "first",
          summary: "From the first",
          start: ":20261103T080000Z",
          end: ":20261103T090000Z",
        }),
      ]),
      calendar([
        ...event({
          uid: "second",
          summary: "From the second",
          start: ":20261104T080000Z",
          end: ":20261104T090000Z",
        }),
      ]),
    ].join("\r\n");

    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(text);

    expect(
      kept(result.events).map((item: Kept) => {
        return item.title;
      }),
    ).toEqual(["From the first", "From the second"]);
  });

  test("reads another OneUptime project's calendar link, called-off events left out", async () => {
    const text: string = MaintenanceCalendar.render({
      audience: MaintenanceCalendarAudience.Team,
      name: "Payments",
      productId: MaintenanceCalendar.getProductId("OneUptime"),
      events: [
        {
          id: "8f0e7a3c-2b1d-4c5e-9f6a-7b8c9d0e1f2a",
          title: "Database upgrade",
          description: "We upgrade the primary database.",
          startsAt: new Date("2026-10-20T22:00:00.000Z"),
          endsAt: new Date("2026-10-21T01:00:00.000Z"),
          stateName: "Scheduled",
        },
        {
          id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
          title: "Old cluster retirement",
          startsAt: new Date("2026-10-02T14:00:00.000Z"),
          endsAt: new Date("2026-10-02T16:00:00.000Z"),
          stateName: "Completed",
          isCalledOff: true,
        },
      ],
    });

    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(text);

    expect(kept(result.events)).toEqual([
      {
        title: "Database upgrade",
        start: "2026-10-20T22:00:00.000Z",
        end: "2026-10-21T01:00:00.000Z",
        allDay: false,
      },
    ]);
  });
});

describe("limits", () => {
  test("keeps the events nearest now when a calendar holds more than it keeps", async () => {
    const lines: Array<string> = [];

    // One event a day from 1 to 12 November.
    for (let day: number = 1; day <= 12; day++) {
      const date: string = `202611${String(day).padStart(2, "0")}`;

      lines.push(
        ...event({
          uid: `day-${day}`,
          summary: `Day ${day}`,
          start: `:${date}T080000Z`,
          end: `:${date}T090000Z`,
        }),
      );
    }

    // And one in progress now, which is the nearest of all.
    lines.push(
      ...event({
        uid: "now",
        summary: "Happening now",
        start: ":20261015T100000Z",
        end: ":20261015T110000Z",
      }),
    );

    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(calendar(lines), { maxEvents: 4 });

    expect(
      kept(result.events).map((item: Kept) => {
        return item.title;
      }),
    ).toEqual(["Happening now", "Day 1", "Day 2", "Day 3"]);
    expect(result.eventsInWindow).toBe(13);
    expect(result.hasMoreEvents).toBe(true);
  });

  test("leaves out a rule that steps by the minute or the second, and keeps the rest", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "minutely",
            summary: "Every minute",
            start: ":20261015T090000Z",
            end: ":20261015T090100Z",
            extra: ["RRULE:FREQ=MINUTELY"],
          }),
          ...event({
            uid: "secondly",
            summary: "Every second",
            start: ":20261015T090000Z",
            end: ":20261015T090001Z",
            extra: ["RRULE:FREQ=SECONDLY"],
          }),
          ...event({
            uid: "normal",
            summary: "A normal event",
            start: ":20261103T080000Z",
            end: ":20261103T090000Z",
          }),
        ]),
      );

    expect(
      kept(result.events).map((item: Kept) => {
        return item.title;
      }),
    ).toEqual(["A normal event"]);
    expect(result.skippedSeries).toBe(2);
  });

  test("leaves out a repeating event that takes more steps than one may, and keeps the rest", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          // Daily since 2000: about 9,800 steps before the window.
          ...event({
            uid: "since-2000",
            summary: "Daily since 2000",
            start: ":20000101T090000Z",
            end: ":20000101T091500Z",
            extra: ["RRULE:FREQ=DAILY"],
          }),
          ...event({
            uid: "normal",
            summary: "A normal event",
            start: ":20261103T080000Z",
            end: ":20261103T090000Z",
          }),
        ]),
        { maxStepsPerEvent: 1000 },
      );

    expect(
      kept(result.events).map((item: Kept) => {
        return item.title;
      }),
    ).toEqual(["A normal event"]);
    expect(result.skippedSeries).toBe(1);
    expect(result.hasMoreEvents).toBe(false);
  });

  test("says there may be more when the calendar's step budget runs out", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "daily",
            summary: "Daily",
            start: ":20261001T090000Z",
            end: ":20261001T091500Z",
            extra: ["RRULE:FREQ=DAILY"],
          }),
        ]),
        { maxSteps: 50 },
      );

    expect(result.hasMoreEvents).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.length).toBeLessThanOrEqual(50);
  });

  test("leaves out a rule ical.js refuses, and keeps the rest", async () => {
    const result: Extract<ExternalCalendarExpansionResult, { ok: true }> =
      await expandOk(
        calendar([
          ...event({
            uid: "invalid-rule",
            summary: "Invalid rule",
            start: ":20261103T080000Z",
            end: ":20261103T090000Z",
            extra: ["RRULE:FREQ=WEEKLY;BYMONTHDAY=3"],
          }),
          ...event({
            uid: "normal",
            summary: "A normal event",
            start: ":20261104T080000Z",
            end: ":20261104T090000Z",
          }),
        ]),
      );

    expect(
      kept(result.events).map((item: Kept) => {
        return item.title;
      }),
    ).toEqual(["A normal event"]);
    expect(result.skippedSeries).toBe(1);
  });

  test("a rule that never matches is stopped at the time limit, while the server goes on", async () => {
    let ticks: number = 0;

    const ticker: NodeJS.Timeout = setInterval(() => {
      ticks++;
    }, 50);

    const startedAt: number = Date.now();

    try {
      // February has no 30th: ical.js looks for one forever.
      const result: ExternalCalendarExpansionResult = await expand(
        calendar([
          ...event({
            uid: "never",
            summary: "Never",
            start: ":20260101T090000Z",
            end: ":20260101T100000Z",
            extra: ["RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30"],
          }),
        ]),
        { timeLimitInMs: 1500 },
      );

      expect(result).toEqual({
        ok: false,
        error: ExternalCalendarReadError.TooComplex,
      });
    } finally {
      clearInterval(ticker);
    }

    const elapsed: number = Date.now() - startedAt;

    expect(elapsed).toBeGreaterThanOrEqual(1400);
    expect(elapsed).toBeLessThan(10000);
    // The main thread kept running meanwhile: the loop is the worker's.
    expect(ticks).toBeGreaterThanOrEqual(10);
  });
});

describe("not a calendar", () => {
  test.each([
    ["an empty answer", ""],
    ["blank lines", "\r\n\r\n   \r\n"],
    [
      "a sign-in page",
      "<!doctype html><html><body>Sign in</body></html>",
    ],
    ["JSON", '{"events": []}'],
    ["a contact card", "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Ana\r\nEND:VCARD"],
    [
      "a calendar cut off half way",
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:20261103T080000Z",
    ],
  ])("%s", async (_name: string, text: string) => {
    expect(await expand(text)).toEqual({
      ok: false,
      error: ExternalCalendarReadError.NotACalendar,
    });
  });
});

describe("the worker's answer is checked before anything is kept", () => {
  test("an answer of another shape is no answer", () => {
    expect(ExternalCalendarExpansion.readWorkerAnswer(null)).toBeNull();
    expect(ExternalCalendarExpansion.readWorkerAnswer("ok")).toBeNull();
    expect(ExternalCalendarExpansion.readWorkerAnswer({ ok: true })).toBeNull();
    expect(
      ExternalCalendarExpansion.readWorkerAnswer({ ok: false, reason: "x" }),
    ).toBeNull();
    expect(
      ExternalCalendarExpansion.readWorkerAnswer({
        ok: false,
        reason: "NotACalendar",
      }),
    ).toEqual({ ok: false, reason: "NotACalendar" });
  });

  test("occurrences with impossible times are dropped, the rest kept", () => {
    const answer: unknown = ExternalCalendarExpansion.readWorkerAnswer({
      ok: true,
      calendarTimezone: "Europe/London",
      skippedSeries: 2.7,
      hitStepLimit: "yes",
      hitOccurrenceLimit: true,
      occurrences: [
        {
          uid: "good",
          title: "Good",
          isPrivate: false,
          start: { kind: "instant", ms: 1793692800000 },
          end: { kind: "instant", ms: 1793696400000 },
        },
        {
          uid: "bad-month",
          title: "Month 13",
          start: { kind: "date", year: 2026, month: 13, day: 1 },
          end: { kind: "date", year: 2026, month: 13, day: 2 },
        },
        {
          uid: "bad-hour",
          title: "Hour 25",
          start: {
            kind: "wall",
            year: 2026,
            month: 11,
            day: 1,
            hour: 25,
            minute: 0,
            second: 0,
            tzid: null,
          },
          end: { kind: "instant", ms: 1 },
        },
        {
          uid: "bad-kind",
          title: "Unknown kind",
          start: { kind: "elsewhen" },
          end: { kind: "instant", ms: 1 },
        },
        {
          uid: "not-a-number",
          title: "NaN",
          start: { kind: "instant", ms: Number.NaN },
          end: { kind: "instant", ms: 1 },
        },
        "not an occurrence",
      ],
    });

    expect(answer).toEqual({
      ok: true,
      calendarTimezone: "Europe/London",
      skippedSeries: 2,
      hitStepLimit: false,
      hitOccurrenceLimit: true,
      occurrences: [
        {
          uid: "good",
          title: "Good",
          isPrivate: false,
          start: { kind: "instant", ms: 1793692800000 },
          end: { kind: "instant", ms: 1793696400000 },
        },
      ],
    });
  });
});

describe("time zones", () => {
  test("resolveTimezone knows IANA names, cuts Mozilla prefixes, and knows nothing else", () => {
    expect(ExternalCalendarExpansion.resolveTimezone("Europe/Berlin")).toBe(
      "Europe/Berlin",
    );
    expect(
      ExternalCalendarExpansion.resolveTimezone(
        "/mozilla.org/20070129_1/Europe/Berlin",
      ),
    ).toBe("Europe/Berlin");
    expect(
      ExternalCalendarExpansion.resolveTimezone("W. Europe Standard Time"),
    ).toBeNull();
    expect(ExternalCalendarExpansion.resolveTimezone("")).toBeNull();
    expect(ExternalCalendarExpansion.resolveTimezone(null)).toBeNull();
  });

  test("toInstant reads a wall clock that a change of clocks skips as the moment after it", () => {
    // 02:30 on 29 March 2026 does not exist in Berlin: the clocks go from 02:00 to 03:00.
    const instant: Date | null = ExternalCalendarExpansion.toInstant(
      {
        kind: "wall",
        year: 2026,
        month: 3,
        day: 29,
        hour: 2,
        minute: 30,
        second: 0,
        tzid: "Europe/Berlin",
      },
      null,
    );

    expect(instant?.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });
});
