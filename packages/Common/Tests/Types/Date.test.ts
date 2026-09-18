import OneUptimeDate from "../../Types/Date";
import PositiveNumber from "../../Types/PositiveNumber";
import Timezone from "../../Types/Timezone";
import moment, { isMoment } from "moment";

describe("class OneUptimeDate", () => {
  test("OneUptimeDate.getCurrentDate should return current date", () => {
    expect(OneUptimeDate.getCurrentDate().getFullYear()).toEqual(
      new Date().getFullYear(),
    );
    expect(OneUptimeDate.getCurrentDate().getDay()).toEqual(
      new Date().getDay(),
    );
    expect(OneUptimeDate.getCurrentDate().getDate()).toEqual(
      new Date().getDate(),
    );
    expect(OneUptimeDate.getCurrentDate().getHours()).toEqual(
      new Date().getHours(),
    );
    expect(isMoment(OneUptimeDate.getCurrentDate())).toBeFalsy();
  });
  test("OneUptimeDAte.getCurrentMomentDate() should return moment Date", () => {
    expect(isMoment(OneUptimeDate.getCurrentMomentDate())).toBeTruthy();
  });
  test("OneUptimeDAte.getSomeMinutesAgo should return someMinutes ago Date from current time", () => {
    expect(
      OneUptimeDate.getSomeMinutesAgo(new PositiveNumber(4)).getMinutes(),
    ).toEqual(moment().add(-4, "minutes").toDate().getMinutes());
  });
  test("OneUptimeDAte.getOneMinAgo should return one minute age Date from current time", () => {
    expect(OneUptimeDate.getOneMinAgo().getMinutes()).toEqual(
      moment().add(-1, "minute").toDate().getMinutes(),
    );
  });
  test("OneUptimeDAte.getOneDayAgo should return oneDate ago Date", () => {
    expect(OneUptimeDate.getOneDayAgo().getDay()).toEqual(
      moment().add(-1, "day").toDate().getDay(),
    );
  });
  test("OneUptimeDAte.getSomeHoursAgo should return moment Date", () => {
    expect(
      OneUptimeDate.getSomeHoursAgo(new PositiveNumber(4)).getHours(),
    ).toEqual(moment().add(-4, "hours").toDate().getHours());
  });
  test("OneUptimeDAte.getSomeDaysAgo should return moment Date", () => {
    expect(
      OneUptimeDate.getSomeDaysAgo(new PositiveNumber(4)).getDay(),
    ).toEqual(moment().add(-4, "days").toDate().getDay());
  });
  test("OneUptimeDAte.getSomeSecondsAgo should return moment Date", () => {
    expect(
      OneUptimeDate.getSomeSecondsAgo(new PositiveNumber(4)).getSeconds(),
    ).toEqual(moment().add(-4, "seconds").toDate().getSeconds());
  });
  test("OneUptimeDAte.getOneMinAfter should return moment Date", () => {
    expect(OneUptimeDate.getOneMinAfter().getMinutes()).toEqual(
      moment().add(1, "minute").toDate().getMinutes(),
    );
  });
  test("OneUptimeDAte.getOneDayAfter should return moment Date", () => {
    expect(OneUptimeDate.getOneDayAfter().getDay()).toEqual(
      moment().add(1, "day").toDate().getDay(),
    );
  });
  test("OneUptimeDAte.getSomeMinutesAfter should return moment Date", () => {
    expect(
      OneUptimeDate.getSomeMinutesAfter(new PositiveNumber(4)).getMinutes(),
    ).toEqual(moment().add(4, "minutes").toDate().getMinutes());
  });
  test("OneUptimeDAte.getSomeHoursAfter should return moment Date", () => {
    expect(
      OneUptimeDate.getSomeHoursAfter(new PositiveNumber(4)).getHours(),
    ).toEqual(moment().add(4, "hours").toDate().getHours());
  });
  test("OneUptimeDAte.getSomeDaysAfter should return moment Date", () => {
    expect(
      OneUptimeDate.getSomeDaysAfter(new PositiveNumber(4)).getDay(),
    ).toEqual(moment().add(4, "days").toDate().getDay());
  });
  test("OneUptimeDAte.getSomeSecondsAfter should return moment Date", () => {
    expect(
      OneUptimeDate.getSomeSecondsAfter(new PositiveNumber(4)).getSeconds(),
    ).toEqual(moment().add(4, "seconds").toDate().getSeconds());
  });
  test("OneUptimeDAte.getCurrentYear should return the current year", () => {
    expect(
      OneUptimeDate.getSomeSecondsAfter(new PositiveNumber(4)).getSeconds(),
    ).toEqual(moment().add(4, "seconds").toDate().getSeconds());
  });

  test("OneUptimeDate.fromString should parse ClickHouse timestamps as UTC", () => {
    expect(
      OneUptimeDate.fromString("2026-04-01 14:45:31.414000000").toISOString(),
    ).toBe("2026-04-01T14:45:31.414Z");
  });

  describe("getZoneAbbrByTimezone (DST awareness)", () => {
    test("returns EST for America/New_York on a winter date", () => {
      const winterDate: Date = new Date("2026-01-15T12:00:00Z");
      expect(
        OneUptimeDate.getZoneAbbrByTimezone(
          Timezone.AmericaNew_York,
          winterDate,
        ),
      ).toBe("EST");
    });

    test("returns EDT for America/New_York on a summer date", () => {
      const summerDate: Date = new Date("2026-07-15T12:00:00Z");
      expect(
        OneUptimeDate.getZoneAbbrByTimezone(
          Timezone.AmericaNew_York,
          summerDate,
        ),
      ).toBe("EDT");
    });

    test("returns PST for America/Los_Angeles on a winter date", () => {
      const winterDate: Date = new Date("2026-01-15T12:00:00Z");
      expect(
        OneUptimeDate.getZoneAbbrByTimezone(
          Timezone.AmericaLos_Angeles,
          winterDate,
        ),
      ).toBe("PST");
    });

    test("returns PDT for America/Los_Angeles on a summer date", () => {
      const summerDate: Date = new Date("2026-07-15T12:00:00Z");
      expect(
        OneUptimeDate.getZoneAbbrByTimezone(
          Timezone.AmericaLos_Angeles,
          summerDate,
        ),
      ).toBe("PDT");
    });

    test("returns UTC for UTC regardless of date", () => {
      const winterDate: Date = new Date("2026-01-15T12:00:00Z");
      const summerDate: Date = new Date("2026-07-15T12:00:00Z");
      expect(
        OneUptimeDate.getZoneAbbrByTimezone(Timezone.UTC, winterDate),
      ).toBe("UTC");
      expect(
        OneUptimeDate.getZoneAbbrByTimezone(Timezone.UTC, summerDate),
      ).toBe("UTC");
    });

    test("returns IST for Asia/Kolkata year-round (no DST)", () => {
      const winterDate: Date = new Date("2026-01-15T12:00:00Z");
      const summerDate: Date = new Date("2026-07-15T12:00:00Z");
      expect(
        OneUptimeDate.getZoneAbbrByTimezone(Timezone.AsiaKolkata, winterDate),
      ).toBe("IST");
      expect(
        OneUptimeDate.getZoneAbbrByTimezone(Timezone.AsiaKolkata, summerDate),
      ).toBe("IST");
    });

    test("returns correct abbreviation right after US DST spring-forward", () => {
      // US DST begins 2026-03-08 at 02:00 local -> springs to 03:00 EDT.
      const beforeDst: Date = new Date("2026-03-08T06:00:00Z"); // 01:00 EST
      const afterDst: Date = new Date("2026-03-08T08:00:00Z"); // 04:00 EDT
      expect(
        OneUptimeDate.getZoneAbbrByTimezone(
          Timezone.AmericaNew_York,
          beforeDst,
        ),
      ).toBe("EST");
      expect(
        OneUptimeDate.getZoneAbbrByTimezone(Timezone.AmericaNew_York, afterDst),
      ).toBe("EDT");
    });

    test("accepts an ISO date string", () => {
      expect(
        OneUptimeDate.getZoneAbbrByTimezone(
          Timezone.AmericaNew_York,
          "2026-01-15T12:00:00Z",
        ),
      ).toBe("EST");
      expect(
        OneUptimeDate.getZoneAbbrByTimezone(
          Timezone.AmericaNew_York,
          "2026-07-15T12:00:00Z",
        ),
      ).toBe("EDT");
    });

    test("falls back to current date when no date is passed (backward compat)", () => {
      const abbr: string = OneUptimeDate.getZoneAbbrByTimezone(Timezone.UTC);
      expect(abbr).toBe("UTC");
    });
  });

  describe("getDateAsFormattedArrayInMultipleTimezones (DST awareness)", () => {
    test("shows EST for a winter event in America/New_York", () => {
      const result: Array<string> =
        OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
          date: new Date("2026-01-15T17:00:00Z"),
          timezones: [Timezone.AmericaNew_York],
          use12HourFormat: true,
        });
      expect(result).toHaveLength(1);
      expect(result[0]).toContain("EST");
      expect(result[0]).not.toContain("EDT");
      // 17:00 UTC in winter EST (UTC-5) = 12:00 PM
      expect(result[0]).toContain("12:00 PM");
    });

    test("shows EDT for a summer event in America/New_York", () => {
      const result: Array<string> =
        OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
          date: new Date("2026-07-15T17:00:00Z"),
          timezones: [Timezone.AmericaNew_York],
          use12HourFormat: true,
        });
      expect(result).toHaveLength(1);
      expect(result[0]).toContain("EDT");
      expect(result[0]).not.toContain("EST");
      // 17:00 UTC in summer EDT (UTC-4) = 01:00 PM
      expect(result[0]).toContain("01:00 PM");
    });

    test("picks the correct abbreviation per-timezone for the same event", () => {
      // A winter event in multiple zones: NY should say EST, LA should say PST, UTC stays UTC.
      const result: Array<string> =
        OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
          date: new Date("2026-01-15T17:00:00Z"),
          timezones: [
            Timezone.UTC,
            Timezone.AmericaNew_York,
            Timezone.AmericaLos_Angeles,
          ],
          use12HourFormat: true,
        });
      expect(result[0]).toContain("UTC");
      expect(result[1]).toContain("EST");
      expect(result[2]).toContain("PST");
    });

    test("omits the abbreviation when onlyShowDate is true", () => {
      const result: Array<string> =
        OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
          date: new Date("2026-07-15T17:00:00Z"),
          timezones: [Timezone.AmericaNew_York],
          onlyShowDate: true,
        });
      expect(result[0]).not.toContain("EDT");
      expect(result[0]).not.toContain("EST");
    });
  });

  describe("getDateAsFormattedArrayInMultipleTimezones default timezones", () => {
    test("defaults include UTC, London, New York, LA, Kolkata, Sydney", () => {
      const result: Array<string> =
        OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
          date: new Date("2026-07-15T17:00:00Z"),
          use12HourFormat: true,
        });
      expect(result).toHaveLength(6);
      expect(result[0]).toContain("UTC");
    });

    test("summer (DST) event shows EDT and BST in defaults, not EST or GMT", () => {
      /*
       * Apr 27 2026 21:30 UTC — both US and UK are in DST. Use word
       * boundaries so AEST/AEDT (Sydney) doesn't match EST/EDT.
       */
      const result: Array<string> =
        OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
          date: new Date("2026-04-27T21:30:00Z"),
          use12HourFormat: true,
        });
      const joined: string = result.join("\n");
      expect(joined).toMatch(/\bEDT\b/);
      expect(joined).toMatch(/\bBST\b/);
      expect(joined).not.toMatch(/\bEST\b/);
      expect(joined).not.toMatch(/\bGMT\b/);
    });

    test("winter (no DST) event shows EST and GMT in defaults, not EDT or BST", () => {
      /*
       * Jan 15 2026 17:00 UTC — both US and UK are on standard time. Use
       * word boundaries so AEDT (Sydney) doesn't match EDT.
       */
      const result: Array<string> =
        OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
          date: new Date("2026-01-15T17:00:00Z"),
          use12HourFormat: true,
        });
      const joined: string = result.join("\n");
      expect(joined).toMatch(/\bEST\b/);
      expect(joined).toMatch(/\bGMT\b/);
      expect(joined).not.toMatch(/\bEDT\b/);
      expect(joined).not.toMatch(/\bBST\b/);
    });
  });
});
