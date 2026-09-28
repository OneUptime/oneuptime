import {
  customFieldValueToDate,
  customFieldValueToText,
  formatCustomFieldBoolean,
  formatCustomFieldCalendarDate,
} from "../../../Types/CustomField/CustomFieldValueFormat";
import { sortCustomFieldDefinitions } from "../../../Types/CustomField/CustomFieldOrder";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import { sortCustomFieldDefinitions as sortFromForms } from "../../../UI/Components/CustomFields/CustomFieldFormFields";
import { describe, expect, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * How a stored custom field value reads as words, shared by an incident
 * note's placeholders and the status page subscriber messages, and the order
 * fields are shown in, shared by the dashboard and the server.
 */

describe("customFieldValueToText", () => {
  test.each([
    [undefined, ""],
    [null, ""],
    ["", ""],
    ["Site 03", "Site 03"],
    [0, "0"],
    [12.5, "12.5"],
    [false, "false"],
    [["Site 03", "", null, "Site 07"], "Site 03, Site 07"],
    [[], ""],
    [new Date("2026-09-27T14:05:00.000Z"), "2026-09-27T14:05:00.000Z"],
    [new Date("not a date"), ""],
    [{ a: 1 }, '{"a":1}'],
  ] as Array<[unknown, string]>)(
    "%p reads as %p",
    (value: unknown, text: string) => {
      expect(customFieldValueToText(value)).toBe(text);
    },
  );
});

describe("customFieldValueToDate", () => {
  test("reads an ISO string and a Date, and nothing else", () => {
    expect(
      customFieldValueToDate(" 2026-09-27T14:05:00.000Z ")?.toISOString(),
    ).toBe("2026-09-27T14:05:00.000Z");
    expect(
      customFieldValueToDate(new Date("2026-09-27T14:05:00.000Z"))?.getTime(),
    ).toBe(Date.parse("2026-09-27T14:05:00.000Z"));
    expect(customFieldValueToDate("soon")).toBeNull();
    expect(customFieldValueToDate("")).toBeNull();
    expect(customFieldValueToDate(12)).toBeNull();
    expect(customFieldValueToDate(new Date("x"))).toBeNull();
  });
});

describe("formatCustomFieldBoolean", () => {
  test.each([
    [true, "Yes"],
    [false, "No"],
    ["true", "Yes"],
    ["false", "No"],
    ["maybe", "maybe"],
    [1, "1"],
  ] as Array<[unknown, string]>)(
    "%p reads as %p",
    (value: unknown, text: string) => {
      expect(formatCustomFieldBoolean(value)).toBe(text);
    },
  );
});

describe("formatCustomFieldCalendarDate", () => {
  /*
   * What the dashboard's date input stores when 27 Sep 2026 is picked in
   * `zone`: the day's midnight there, as a UTC instant (Input's onChange,
   * OneUptimeDate.fromDateTimeLocalString then toString).
   */
  function storedByTheDateInput(zone: string, day: string): string {
    OneUptimeDate.setUserTimezone(zone as Timezone);

    try {
      return OneUptimeDate.toString(OneUptimeDate.fromDateTimeLocalString(day));
    } finally {
      OneUptimeDate.setUserTimezone(null);
    }
  }

  test.each([
    // Stored as the day, or UTC midnight, by an API client.
    ["2026-09-27", "2026-09-27"],
    [" 2026-09-27 ", "2026-09-27"],
    ["2026-09-27T00:00:00.000Z", "2026-09-27"],
    // A time with no offset names its day wherever it is read.
    ["2026-09-27T00:00:00", "2026-09-27"],
    ["2026-09-27 23:30", "2026-09-27"],
    // Local midnight with its offset written out.
    ["2026-09-27T00:00:00+02:00", "2026-09-27"],
    ["2026-09-27T00:00:00-04:00", "2026-09-27"],
    // As the date input stores 27 Sep picked east and west of UTC.
    ["2026-09-26T22:00:00.000Z", "2026-09-27"], // Berlin, UTC+2
    ["2026-09-27T04:00:00.000Z", "2026-09-27"], // New York, UTC-4
    ["2026-09-26T18:30:00.000Z", "2026-09-27"], // Kolkata, UTC+5:30
    ["2026-09-26T11:00:00.000Z", "2026-09-27"], // Auckland in summer, UTC+13
    ["2026-09-27T10:00:00.000Z", "2026-09-27"], // Honolulu, UTC-10
    [new Date("2026-09-26T22:00:00.000Z"), "2026-09-27"],
    ["next week", "next week"],
    ["", ""],
  ] as Array<[unknown, string]>)(
    "%p reads as %p",
    (value: unknown, text: string) => {
      expect(formatCustomFieldCalendarDate(value)).toBe(text);
    },
  );

  test("a day picked in Berlin reads as that day, not the UTC day before", () => {
    const stored: string = storedByTheDateInput("Europe/Berlin", "2026-09-27");

    // The regression: the old reader took the UTC day, 26 Sep.
    expect(stored).toBe("2026-09-26T22:00:00.000Z");
    expect(formatCustomFieldCalendarDate(stored)).toBe("2026-09-27");
  });

  test("a day picked in New York reads as that day", () => {
    const stored: string = storedByTheDateInput(
      "America/New_York",
      "2026-09-27",
    );

    expect(stored).toBe("2026-09-27T04:00:00.000Z");
    expect(formatCustomFieldCalendarDate(stored)).toBe("2026-09-27");
  });

  /*
   * Every time zone from UTC-10:59 to UTC+13:00 reads the picked day, in
   * summer and in winter, and at the turn of a month and a year.
   */
  test("reads the picked day for an author in every zone from UTC-10:59 to UTC+13:00", () => {
    const days: Array<string> = ["2026-09-27", "2026-01-01", "2026-03-31"];
    let zonesChecked: number = 0;

    for (const zone of moment.tz.names()) {
      for (const day of days) {
        const offsetMinutes: number = moment.tz(day, zone).utcOffset();

        if (offsetMinutes <= -11 * 60 || offsetMinutes > 13 * 60) {
          continue;
        }

        const stored: string = moment.tz(day, zone).toDate().toISOString();

        expect({
          zone,
          day,
          read: formatCustomFieldCalendarDate(stored),
        }).toEqual({ zone, day, read: day });
        zonesChecked++;
      }
    }

    // Hundreds of zones, not a filter that let nothing through.
    expect(zonesChecked).toBeGreaterThan(1000);
  });

  test("an author in UTC-11 or past UTC+13 is off by a day, as documented", () => {
    expect(
      formatCustomFieldCalendarDate(
        storedByTheDateInput("Pacific/Pago_Pago", "2026-09-27"),
      ),
    ).toBe("2026-09-28");
    expect(
      formatCustomFieldCalendarDate(
        storedByTheDateInput("Pacific/Kiritimati", "2026-09-27"),
      ),
    ).toBe("2026-09-26");
  });

  test("does not depend on the reader's time zone", () => {
    const stored: string = storedByTheDateInput("Asia/Tokyo", "2026-09-27");

    for (const reader of ["America/Los_Angeles", "UTC", "Asia/Tokyo"]) {
      OneUptimeDate.setUserTimezone(reader as Timezone);

      try {
        expect(formatCustomFieldCalendarDate(stored)).toBe("2026-09-27");
      } finally {
        OneUptimeDate.setUserTimezone(null);
      }
    }
  });
});

describe("sortCustomFieldDefinitions", () => {
  test("is the one the forms use", () => {
    expect(sortFromForms).toBe(sortCustomFieldDefinitions);
  });

  test("orders by sortOrder, lowest first, then keeps the given order", () => {
    const sorted: Array<{ name: string; sortOrder?: number | null }> =
      sortCustomFieldDefinitions([
        { name: "none-a" },
        { name: "two", sortOrder: 2 },
        { name: "one", sortOrder: 1 },
        { name: "none-b", sortOrder: null },
        { name: "two-b", sortOrder: 2 },
        { name: "nan", sortOrder: Number.NaN },
      ]);

    expect(
      sorted.map((definition: { name: string }) => {
        return definition.name;
      }),
    ).toEqual(["one", "two", "two-b", "none-a", "none-b", "nan"]);
  });
});
