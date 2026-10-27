import ExternalCalendarExpansion, {
  ExternalCalendarExpansionResult,
} from "../../../../../Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarExpansion";
import {
  EXTERNAL_CALENDAR_MAX_DATE_LIST_VALUES,
  EXTERNAL_CALENDAR_MAX_LINE_LENGTH,
  KEPT_PROPERTIES,
  PreparedExternalCalendarText,
  cleanExternalCalendarTitle,
  getPropertyName,
  prepareExternalCalendarText,
} from "../../../../../Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarText";
import {
  EXCHANGE_CALENDAR,
  NOW,
  calendar,
  event,
} from "./ExternalCalendarFixtures";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * A calendar's text cut down to what OneUptime reads, before ical.js sees
 * it (ExternalCalendarText): lines unfolded as RFC 5545 says, every
 * property never read dropped, any line too long to be a title, a time or
 * a rule dropped, and EXDATE / RDATE capped - in one pass that takes time in
 * line with the text, whatever its shape.
 */

function prepared(text: string): PreparedExternalCalendarText {
  const result: PreparedExternalCalendarText | null =
    prepareExternalCalendarText(text);

  if (!result) {
    throw new Error("Expected a calendar");
  }

  return result;
}

function lines(text: string): Array<string> {
  return prepared(text).text.split("\r\n");
}

describe("what is a calendar", () => {
  test("text whose first line is BEGIN:VCALENDAR, in any case, after a byte order mark or blank lines", () => {
    expect(
      prepareExternalCalendarText("BEGIN:VCALENDAR\r\nEND:VCALENDAR"),
    ).not.toBeNull();
    expect(
      prepareExternalCalendarText("begin:vcalendar\nend:vcalendar"),
    ).not.toBeNull();
    expect(
      prepareExternalCalendarText("﻿BEGIN:VCALENDAR\r\nEND:VCALENDAR"),
    ).not.toBeNull();
    expect(
      prepareExternalCalendarText("\r\n\r\nBEGIN:VCALENDAR\r\nEND:VCALENDAR"),
    ).not.toBeNull();
  });

  test.each([
    ["nothing", ""],
    ["blank lines", "\n\n  \n"],
    ["a web page", "<!doctype html>\n<html></html>"],
    ["a contact card", "BEGIN:VCARD\nEND:VCARD"],
    ["another first line", "VERSION:2.0\nBEGIN:VCALENDAR\nEND:VCALENDAR"],
    [
      "a first line too long to be one",
      `BEGIN:VCALENDAR${"X".repeat(EXTERNAL_CALENDAR_MAX_LINE_LENGTH + 1)}`,
    ],
  ])("not %s", (_name: string, text: string) => {
    expect(prepareExternalCalendarText(text)).toBeNull();
  });
});

describe("unfolding", () => {
  test("a line break followed by a space or a tab continues the line, with CRLF or LF", () => {
    expect(
      lines(
        "BEGIN:VCALENDAR\r\nSUMMARY:Change\r\n  freeze\r\n\treview\nUID:a\n b\r\nEND:VCALENDAR",
      ),
    ).toEqual([
      "BEGIN:VCALENDAR",
      "SUMMARY:Change freezereview",
      "UID:ab",
      "END:VCALENDAR",
    ]);
  });

  test("a line break at the very end continues nothing", () => {
    expect(lines("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")).toEqual([
      "BEGIN:VCALENDAR",
      "END:VCALENDAR",
    ]);
  });
});

describe("what is kept", () => {
  test("only the properties OneUptime reads, components whole", () => {
    expect(lines(EXCHANGE_CALENDAR)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//OneUptime Tests//EN",
      "BEGIN:VTIMEZONE",
      "TZID:W. Europe Standard Time",
      "BEGIN:STANDARD",
      "DTSTART:16010101T030000",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0100",
      "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "DTSTART:16010101T020000",
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0200",
      "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:040000008200E00074C5B7101A82E008000000004A3F",
      "SUMMARY:Change freeze review",
      "DTSTART;TZID=W. Europe Standard Time:20261005T090000",
      "DTEND;TZID=W. Europe Standard Time:20261005T100000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6",
      "EXDATE;TZID=W. Europe Standard Time:20261012T090000",
      "CLASS:PUBLIC",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:040000008200E00074C5B7101A82E008000000004A3F",
      "SUMMARY:Change freeze review (moved)",
      "DTSTART;TZID=W. Europe Standard Time:20261020T140000",
      "DTEND;TZID=W. Europe Standard Time:20261020T150000",
      "RECURRENCE-ID;TZID=W. Europe Standard Time:20261019T090000",
      "END:VEVENT",
      "END:VCALENDAR",
    ]);

    // The description, the HTML copy, the attendee, the attachment and the busy status.
    expect(prepared(EXCHANGE_CALENDAR).droppedLineCount).toBe(5);
  });

  test("names are read up to their first ; or :, in any case", () => {
    expect(getPropertyName("dtstart;TZID=Europe/Berlin:20261005T090000")).toBe(
      "DTSTART",
    );
    expect(getPropertyName("SUMMARY:A;B")).toBe("SUMMARY");
    expect(getPropertyName("X-NO-DELIMITER")).toBe("X-NO-DELIMITER");
    expect(KEPT_PROPERTIES).toContain("RECURRENCE-ID");
    expect(KEPT_PROPERTIES).not.toContain("DESCRIPTION");
    expect(KEPT_PROPERTIES).not.toContain("ATTACH");
  });

  test("a kept line too long to be a title, a time or a rule is dropped, and the event stays", () => {
    const result: PreparedExternalCalendarText = prepared(
      calendar([
        ...event({
          uid: "long-title",
          summary: "x".repeat(EXTERNAL_CALENDAR_MAX_LINE_LENGTH),
          start: ":20261103T080000Z",
          end: ":20261103T090000Z",
        }),
      ]),
    );

    expect(result.text).not.toContain("xxxx");
    expect(result.text).toContain("DTSTART:20261103T080000Z");
    expect(result.droppedLineCount).toBe(1);
  });

  test("a folded line is judged by its unfolded length", () => {
    const folded: string = Array(40).fill("y".repeat(500)).join("\r\n ");

    const result: PreparedExternalCalendarText = prepared(
      `BEGIN:VCALENDAR\r\nSUMMARY:${folded}\r\nEND:VCALENDAR`,
    );

    expect(result.text).toBe("BEGIN:VCALENDAR\r\nEND:VCALENDAR");
    expect(result.droppedLineCount).toBe(1);
  });

  test("EXDATE and RDATE keep at most the dates they may between them", () => {
    const perLine: number = 500;
    const dates: string = Array(perLine).fill("20261103T080000Z").join(",");
    const count: number =
      Math.floor(EXTERNAL_CALENDAR_MAX_DATE_LIST_VALUES / perLine) + 3;

    const result: PreparedExternalCalendarText = prepared(
      [
        "BEGIN:VCALENDAR",
        ...Array(count).fill(`EXDATE:${dates}`),
        "END:VCALENDAR",
      ].join("\r\n"),
    );

    const keptDateLines: number = result.text
      .split("\r\n")
      .filter((line: string) => {
        return line.startsWith("EXDATE");
      }).length;

    expect(keptDateLines * perLine).toBeLessThanOrEqual(
      EXTERNAL_CALENDAR_MAX_DATE_LIST_VALUES,
    );
    expect(keptDateLines).toBe(
      Math.floor(EXTERNAL_CALENDAR_MAX_DATE_LIST_VALUES / perLine),
    );
    expect(result.droppedLineCount).toBe(3);
  });
});

describe("titles", () => {
  test("are on one line, their runs of spaces and control characters one space, trimmed and cut", () => {
    expect(
      cleanExternalCalendarTitle("  Change\n\nfreeze\t\u0007 review  ", 500),
    ).toBe("Change freeze review");
    expect(cleanExternalCalendarTitle("abcdef", 4)).toBe("abcd");
    expect(cleanExternalCalendarTitle("\n\t ", 10)).toBe("");
  });
});

/*
 * Worst cases of what a link can answer with, 400,000 characters each: the
 * pass reads them in time in line with their length. And the whole of a
 * read - the pass, then ical.js in its worker - on the shapes that took
 * ical.js longest when it read them whole.
 */
describe("time in line with the text", () => {
  const SIZE: number = 400000;

  const shapes: Array<[string, string]> = [
    [
      "one very long kept line",
      `BEGIN:VCALENDAR\r\nSUMMARY:${"x".repeat(SIZE)}\r\nEND:VCALENDAR`,
    ],
    [
      "one very long line nobody reads",
      `BEGIN:VCALENDAR\r\nX-A${";a=1".repeat(Math.floor(SIZE / 4))}:v\r\nEND:VCALENDAR`,
    ],
    ["line breaks only", `BEGIN:VCALENDAR${"\n".repeat(SIZE)}END:VCALENDAR`],
    [
      "continuations only",
      `BEGIN:VCALENDAR\r\nSUMMARY:x${"\r\n x".repeat(Math.floor(SIZE / 4))}\r\nEND:VCALENDAR`,
    ],
    [
      "semicolons where a name goes",
      `BEGIN:VCALENDAR\r\n${";".repeat(SIZE)}\r\nEND:VCALENDAR`,
    ],
    ["colons", `BEGIN:VCALENDAR\r\n${":".repeat(SIZE)}\r\nEND:VCALENDAR`],
    [
      "commas in date lists",
      `BEGIN:VCALENDAR\r\n${Array(Math.floor(SIZE / 4000))
        .fill(`EXDATE:${",".repeat(3990)}`)
        .join("\r\n")}\r\nEND:VCALENDAR`,
    ],
    [
      "parameters on kept lines, each just under the length limit",
      `BEGIN:VCALENDAR\r\n${Array(
        Math.ceil(SIZE / EXTERNAL_CALENDAR_MAX_LINE_LENGTH),
      )
        .fill(
          `BEGIN:VEVENT\r\nUID:p\r\nDTSTART${";a=1".repeat(Math.floor((EXTERNAL_CALENDAR_MAX_LINE_LENGTH - 100) / 4))}:20261103T080000Z\r\nEND:VEVENT`,
        )
        .join("\r\n")}\r\nEND:VCALENDAR`,
    ],
    [
      "events",
      calendar(
        Array(Math.ceil(SIZE / 90))
          .fill(0)
          .flatMap((_value: number, index: number): Array<string> => {
            return event({
              uid: `e${index}`,
              summary: "e",
              start: ":20261103T080000Z",
              end: ":20261103T090000Z",
            });
          }),
      ),
    ],
  ];

  test.each(shapes)(
    "the pass reads %s at once",
    (_name: string, text: string) => {
      expect(text.length).toBeGreaterThanOrEqual(SIZE - 100);

      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          prepareExternalCalendarText(text);
        },
        limitInMs: 2000,
      });
      expect(timed.inMs).toBeLessThan(2000);
    },
  );

  test.each(shapes)(
    "the whole read of %s ends well within its time limit",
    async (_name: string, text: string) => {
      const startedAt: number = Date.now();

      const result: ExternalCalendarExpansionResult =
        await ExternalCalendarExpansion.expand(text, { now: NOW });

      expect(result.ok === true || result.ok === false).toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(5000);
    },
  );
});
