/**
 * Dashboard widgets used to print a bare date — "Jul 16, 2026" — in every
 * timestamp column. On a dashboard that is close to useless: three incidents
 * declared on the same day read identically, and a log stream repeats one
 * date down the whole pane. Every widget timestamp now goes through
 * DashboardDateTime, which pairs the date with a time of day.
 *
 * These tests lock in that pairing, and — just as importantly — that the date
 * half and the time half can never disagree about which timezone they are in.
 * They are written in explicit-zone wall clock so they hold under whatever TZ
 * the suite happens to run in.
 */
import OneUptimeDate, { Moment } from "Common/Types/Date";
import Timezone from "Common/Types/Timezone";
import {
  DashboardDateTime,
  NO_DATE_LABEL,
  getDashboardDateTime,
  getDashboardDateTimeLabel,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Utils/DashboardDateTime";

const NY: Timezone = Timezone.AmericaNew_York;
const LA: Timezone = Timezone.AmericaLos_Angeles;
const KOLKATA: Timezone = Timezone.AsiaKolkata;
const KATHMANDU: Timezone = Timezone.AsiaKathmandu;
const LONDON: Timezone = Timezone.EuropeLondon;
const UTC: Timezone = Timezone.UTC;

/*
 * 2026-07-16T21:32:05Z. Deliberately late enough in UTC that the calendar
 * DATE differs between zones — which is exactly how a date/time pair that
 * formats its two halves in different zones gets caught.
 */
const INSTANT: Date = new Date("2026-07-16T21:32:05.000Z");

// "MMM DD, YYYY HH:mm" with an optional ":ss".
const LABEL_SHAPE: RegExp = /^[A-Z][a-z]{2} \d{2}, \d{4} \d{2}:\d{2}(:\d{2})?$/;

describe("DashboardDateTime", () => {
  afterEach(() => {
    // Never leak a timezone override into another test.
    OneUptimeDate.setUserTimezone(null);
  });

  describe("the label pairs a date with a time", () => {
    it("shows the time of day next to the date", () => {
      OneUptimeDate.setUserTimezone(LA);

      expect(getDashboardDateTime(INSTANT).label).toBe("Jul 16, 2026 14:32");
    });

    it("keeps the date half byte-identical to the old date-only rendering", () => {
      OneUptimeDate.setUserTimezone(LA);

      /*
       * The regression this guards: widening the format must not quietly
       * restyle the date itself (e.g. to "Jul 16 2026" or "16 Jul 2026").
       */
      const dateOnly: string = OneUptimeDate.getDateAsLocalFormattedString(
        INSTANT,
        true,
      );

      expect(getDashboardDateTime(INSTANT).label.startsWith(dateOnly)).toBe(
        true,
      );
      expect(dateOnly).toBe("Jul 16, 2026");
    });

    it("is never just a date — a time is always appended", () => {
      OneUptimeDate.setUserTimezone(LA);

      const label: string = getDashboardDateTime(INSTANT).label;

      expect(label).not.toBe(
        OneUptimeDate.getDateAsLocalFormattedString(INSTANT, true),
      );
      expect(label).toMatch(LABEL_SHAPE);
    });

    it("omits seconds by default", () => {
      OneUptimeDate.setUserTimezone(LA);

      expect(getDashboardDateTime(INSTANT).label).not.toContain(":05");
    });

    it("includes seconds when the surface asks for them", () => {
      OneUptimeDate.setUserTimezone(LA);

      expect(getDashboardDateTime(INSTANT, { showSeconds: true }).label).toBe(
        "Jul 16, 2026 14:32:05",
      );
    });

    it("treats showSeconds: false and an absent option the same", () => {
      OneUptimeDate.setUserTimezone(LA);

      expect(getDashboardDateTime(INSTANT, { showSeconds: false }).label).toBe(
        getDashboardDateTime(INSTANT).label,
      );
    });

    it("carries no stray leading or trailing whitespace", () => {
      OneUptimeDate.setUserTimezone(LA);

      const label: string = getDashboardDateTime(INSTANT).label;

      expect(label).toBe(label.trim());
    });
  });

  describe("the title carries the full, unambiguous timestamp", () => {
    it("adds seconds and the timezone the label leaves off", () => {
      OneUptimeDate.setUserTimezone(LA);

      expect(getDashboardDateTime(INSTANT).title).toBe(
        "Jul 16 2026, 14:32:05 PDT",
      );
    });

    it("names the timezone so a bare wall clock is never ambiguous", () => {
      OneUptimeDate.setUserTimezone(KOLKATA);

      expect(getDashboardDateTime(INSTANT).title).toContain(
        OneUptimeDate.getCurrentTimezoneString(),
      );
    });

    it("is the same whether or not the label shows seconds", () => {
      OneUptimeDate.setUserTimezone(LA);

      expect(getDashboardDateTime(INSTANT, { showSeconds: true }).title).toBe(
        getDashboardDateTime(INSTANT).title,
      );
    });

    it("stays 24-hour, matching the label", () => {
      OneUptimeDate.setUserTimezone(LA);

      const title: string = getDashboardDateTime(INSTANT).title;

      expect(title).not.toContain("PM");
      expect(title).not.toContain("AM");
    });
  });

  describe("timezone resolution", () => {
    it("reads the wall clock of the timezone the user picked in settings", () => {
      OneUptimeDate.setUserTimezone(NY);
      const newYork: DashboardDateTime = getDashboardDateTime(INSTANT);

      OneUptimeDate.setUserTimezone(LA);
      const losAngeles: DashboardDateTime = getDashboardDateTime(INSTANT);

      // Same instant, two zones, three hours apart.
      expect(newYork.label).toBe("Jul 16, 2026 17:32");
      expect(losAngeles.label).toBe("Jul 16, 2026 14:32");
    });

    it("falls back to the process/browser zone when the user picked none", () => {
      OneUptimeDate.setUserTimezone(null);

      /*
       * Computed straight from moment rather than from OneUptimeDate, so this
       * fails if the fallback ever resolves to some other zone instead of
       * agreeing with itself.
       */
      expect(getDashboardDateTime(INSTANT).label).toBe(
        Moment.tz(INSTANT, Moment.tz.guess()).format("MMM DD, YYYY HH:mm"),
      );
    });

    it("prefers the user timezone over the process/browser zone", () => {
      /*
       * Pick a zone the process is definitely not in, so the assertion cannot
       * pass by accident on a machine that happens to run in it.
       */
      const processZone: string = Moment.tz.guess();
      const elsewhere: Timezone =
        processZone === KOLKATA.toString() ? NY : KOLKATA;

      OneUptimeDate.setUserTimezone(elsewhere);

      expect(getDashboardDateTime(INSTANT).label).toBe(
        Moment.tz(INSTANT, elsewhere.toString()).format("MMM DD, YYYY HH:mm"),
      );
      expect(getDashboardDateTime(INSTANT).label).not.toBe(
        Moment.tz(INSTANT, processZone).format("MMM DD, YYYY HH:mm"),
      );
    });

    it("moves the DATE too when the zone pushes past midnight", () => {
      /*
       * 21:32 UTC is still the 16th in Los Angeles but already the 17th in
       * Kolkata. A date formatted in one zone and a time in another would
       * produce "Jul 16, 2026 03:02" here — the bug this test exists for.
       */
      OneUptimeDate.setUserTimezone(KOLKATA);

      expect(getDashboardDateTime(INSTANT).label).toBe("Jul 17, 2026 03:02");
    });

    it("keeps date and time in the same zone across a year boundary", () => {
      const newYearsEve: Date = new Date("2026-12-31T23:30:00.000Z");
      OneUptimeDate.setUserTimezone(Timezone.AustraliaSydney);

      // Sydney is already in 2027 while UTC is still in 2026.
      expect(getDashboardDateTime(newYearsEve).label).toBe(
        "Jan 01, 2027 10:30",
      );
    });

    it("handles zones at a half-hour offset", () => {
      OneUptimeDate.setUserTimezone(KOLKATA);

      // +05:30 — the minutes must shift, not just the hours.
      expect(getDashboardDateTime(INSTANT).label).toContain("03:02");
    });

    it("handles zones at a quarter-hour offset", () => {
      OneUptimeDate.setUserTimezone(KATHMANDU);

      // +05:45.
      expect(getDashboardDateTime(INSTANT).label).toBe("Jul 17, 2026 03:17");
    });

    it("renders a UTC user exactly the UTC wall clock", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(getDashboardDateTime(INSTANT).label).toBe("Jul 16, 2026 21:32");
    });
  });

  describe("daylight saving time", () => {
    const WINTER: Date = new Date("2026-01-15T18:00:00.000Z");
    const SUMMER: Date = new Date("2026-07-15T18:00:00.000Z");

    it("shifts the wall clock across the DST boundary", () => {
      OneUptimeDate.setUserTimezone(NY);

      // Same 18:00Z: EST (-5) in January, EDT (-4) in July.
      expect(getDashboardDateTime(WINTER).label).toBe("Jan 15, 2026 13:00");
      expect(getDashboardDateTime(SUMMER).label).toBe("Jul 15, 2026 14:00");
    });

    it("names the abbreviation in effect on that date, not today's", () => {
      OneUptimeDate.setUserTimezone(NY);

      expect(getDashboardDateTime(WINTER).title).toContain("EST");
      expect(getDashboardDateTime(SUMMER).title).toContain("EDT");
    });

    it("survives the spring-forward gap", () => {
      OneUptimeDate.setUserTimezone(NY);

      // 2026-03-08 07:00Z — the instant New York jumps 01:59 -> 03:00.
      const springForward: Date = new Date("2026-03-08T07:00:00.000Z");

      expect(getDashboardDateTime(springForward).label).toBe(
        "Mar 08, 2026 03:00",
      );
    });

    it("distinguishes the two passes of a fall-back hour", () => {
      OneUptimeDate.setUserTimezone(NY);

      // 01:30 local happens twice on 2026-11-01: once at 05:30Z, once at 06:30Z.
      const firstPass: Date = new Date("2026-11-01T05:30:00.000Z");
      const secondPass: Date = new Date("2026-11-01T06:30:00.000Z");

      expect(getDashboardDateTime(firstPass).label).toBe("Nov 01, 2026 01:30");
      expect(getDashboardDateTime(secondPass).label).toBe("Nov 01, 2026 01:30");
      // The wall clocks collide; the titles must not.
      expect(getDashboardDateTime(firstPass).title).toContain("EDT");
      expect(getDashboardDateTime(secondPass).title).toContain("EST");
    });

    it("renders London's summer offset, not a fixed GMT", () => {
      OneUptimeDate.setUserTimezone(LONDON);

      expect(getDashboardDateTime(SUMMER).label).toBe("Jul 15, 2026 19:00");
    });
  });

  describe("clock edges", () => {
    it("renders midnight as 00:00, never 24:00 and never blank", () => {
      OneUptimeDate.setUserTimezone(UTC);

      const midnight: Date = new Date("2026-07-16T00:00:00.000Z");
      const label: string = getDashboardDateTime(midnight).label;

      expect(label).toBe("Jul 16, 2026 00:00");
      expect(label).not.toContain("24:");
    });

    it("renders noon as 12:00 on a 24-hour clock", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(
        getDashboardDateTime(new Date("2026-07-16T12:00:00.000Z")).label,
      ).toBe("Jul 16, 2026 12:00");
    });

    it("renders the last minute of the day as 23:59", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(
        getDashboardDateTime(new Date("2026-07-16T23:59:59.000Z")).label,
      ).toBe("Jul 16, 2026 23:59");
    });

    it("zero-pads single-digit hours, minutes and seconds", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(
        getDashboardDateTime(new Date("2026-07-06T04:05:06.000Z"), {
          showSeconds: true,
        }).label,
      ).toBe("Jul 06, 2026 04:05:06");
    });

    it("does not round a timestamp up to the next minute", () => {
      OneUptimeDate.setUserTimezone(UTC);

      // 14:32:59 is still 14:32, not 14:33.
      expect(
        getDashboardDateTime(new Date("2026-07-16T14:32:59.000Z")).label,
      ).toBe("Jul 16, 2026 14:32");
    });

    it("renders a leap day", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(
        getDashboardDateTime(new Date("2028-02-29T08:15:00.000Z")).label,
      ).toBe("Feb 29, 2028 08:15");
    });
  });

  describe("input shapes", () => {
    it("accepts an ISO string and a Date interchangeably", () => {
      OneUptimeDate.setUserTimezone(NY);

      expect(getDashboardDateTime("2026-07-16T21:32:05.000Z")).toEqual(
        getDashboardDateTime(INSTANT),
      );
    });

    it("accepts an ISO string without milliseconds", () => {
      OneUptimeDate.setUserTimezone(NY);

      expect(getDashboardDateTime("2026-07-16T21:32:05Z").label).toBe(
        "Jul 16, 2026 17:32",
      );
    });

    it("reads an offset-bearing string as the instant it names", () => {
      OneUptimeDate.setUserTimezone(UTC);

      // 17:32-04:00 is 21:32Z.
      expect(getDashboardDateTime("2026-07-16T17:32:05-04:00").label).toBe(
        "Jul 16, 2026 21:32",
      );
    });
  });

  describe("missing and unusable timestamps", () => {
    const CASES: Array<[string, Date | string | null | undefined]> = [
      ["null", null],
      ["undefined", undefined],
      ["an empty string", ""],
      ["an invalid Date", new Date("nonsense")],
    ];

    for (const [name, value] of CASES) {
      it(`renders the placeholder for ${name}`, () => {
        OneUptimeDate.setUserTimezone(NY);

        const result: DashboardDateTime = getDashboardDateTime(value);

        expect(result.label).toBe(NO_DATE_LABEL);
        expect(result.title).toBe("");
      });
    }

    it("renders the placeholder for an unparseable string instead of 'Invalid date'", () => {
      OneUptimeDate.setUserTimezone(NY);

      const result: DashboardDateTime = getDashboardDateTime("not-a-date");

      expect(result.label).toBe(NO_DATE_LABEL);
      expect(result.label).not.toContain("Invalid");
    });

    it("never throws on a value the API should not have sent", () => {
      OneUptimeDate.setUserTimezone(NY);

      const junk: Array<unknown> = [
        {},
        [],
        NaN,
        0,
        true,
        Number.POSITIVE_INFINITY,
      ];

      for (const value of junk) {
        expect(() => {
          return getDashboardDateTime(value as unknown as Date);
        }).not.toThrow();
      }
    });

    it("keeps the placeholder free of a hover title", () => {
      /*
       * A title on a placeholder would show an empty or bogus tooltip on
       * hover, so the widget must get nothing to hang there.
       */
      expect(getDashboardDateTime(null).title).toBe("");
    });
  });

  describe("getDashboardDateTimeLabel", () => {
    it("returns exactly the label half", () => {
      OneUptimeDate.setUserTimezone(NY);

      expect(getDashboardDateTimeLabel(INSTANT)).toBe(
        getDashboardDateTime(INSTANT).label,
      );
    });

    it("forwards the seconds option", () => {
      OneUptimeDate.setUserTimezone(NY);

      expect(getDashboardDateTimeLabel(INSTANT, { showSeconds: true })).toBe(
        "Jul 16, 2026 17:32:05",
      );
    });

    it("returns the placeholder for a missing date", () => {
      expect(getDashboardDateTimeLabel(undefined)).toBe(NO_DATE_LABEL);
    });
  });

  describe("consistency across widgets", () => {
    it("gives every widget the same shape for the same instant", () => {
      OneUptimeDate.setUserTimezone(NY);

      /*
       * The incident, alert, trace, log-stream and table widgets all render
       * timestamps side by side on one dashboard. Two of them disagreeing on
       * format is the thing this helper exists to prevent.
       */
      const withoutSeconds: string = getDashboardDateTimeLabel(INSTANT);
      const withSeconds: string = getDashboardDateTimeLabel(INSTANT, {
        showSeconds: true,
      });

      expect(withoutSeconds).toMatch(LABEL_SHAPE);
      expect(withSeconds).toMatch(LABEL_SHAPE);
      expect(withSeconds.startsWith(withoutSeconds)).toBe(true);
    });

    it("orders lexicographically the same way it orders chronologically within a month", () => {
      OneUptimeDate.setUserTimezone(UTC);

      /*
       * Widgets list rows newest-first. Two rows a minute apart must not
       * render an identical label, or the ordering looks broken to the user.
       */
      const earlier: string = getDashboardDateTimeLabel(
        new Date("2026-07-16T14:32:00.000Z"),
      );
      const later: string = getDashboardDateTimeLabel(
        new Date("2026-07-16T14:33:00.000Z"),
      );

      expect(earlier).not.toBe(later);
    });

    it("distinguishes two events on the same day — the whole point of the change", () => {
      OneUptimeDate.setUserTimezone(UTC);

      const morning: string = getDashboardDateTimeLabel(
        new Date("2026-07-16T09:05:00.000Z"),
      );
      const evening: string = getDashboardDateTimeLabel(
        new Date("2026-07-16T19:45:00.000Z"),
      );

      expect(morning).not.toBe(evening);
      expect(morning).toContain("Jul 16, 2026");
      expect(evening).toContain("Jul 16, 2026");
    });
  });
});
