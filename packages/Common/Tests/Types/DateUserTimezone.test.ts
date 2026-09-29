/**
 * The user's profile timezone (User Settings > Timezone) — not the zone the
 * browser reports — decides which wall clock OneUptimeDate reads and writes.
 *
 * The bug these lock in: a user in America/New_York whose browser reported
 * America/Adak was told "your local timezone - HDT" on every date field, and
 * had to enter Hawaii-Aleutian times for their events to land correctly. The
 * profile timezone was stored but never consulted by the UI.
 *
 * Every assertion is expressed in explicit-zone wall-clock (or absolute
 * milliseconds) so it holds under whatever TZ the suite runs in.
 */
import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import TimezoneAlias, {
  LEGACY_TIMEZONE_NAMES,
} from "../../Types/TimezoneAlias";
import moment from "moment-timezone";

const NY: Timezone = Timezone.AmericaNew_York;
const ADAK: Timezone = Timezone.AmericaAdak;
const KOLKATA: Timezone = Timezone.AsiaKolkata;

/*
 * The zone this process reports, in the name OneUptimeDate uses for it. On
 * a machine in India the raw guess is "Asia/Calcutta" and the answer is
 * "Asia/Kolkata"; elsewhere the two are usually the same.
 */
const currentGuess: () => string = (): string => {
  return TimezoneAlias.getCanonicalTimezone(moment.tz.guess());
};

describe("OneUptimeDate user timezone", () => {
  afterEach(() => {
    // Never leak an override (or a pinned guess) into the rest of the suite.
    jest.restoreAllMocks();
    OneUptimeDate.setUserTimezone(null);
  });

  describe("setUserTimezone / getCurrentTimezone", () => {
    it("falls back to the browser / process zone when no user timezone is set", () => {
      expect(OneUptimeDate.getUserTimezone()).toBeNull();
      expect(OneUptimeDate.getCurrentTimezone().toString()).toBe(
        currentGuess(),
      );
    });

    it("prefers the user timezone over the browser / process zone", () => {
      OneUptimeDate.setUserTimezone(NY);

      expect(OneUptimeDate.getCurrentTimezone()).toBe(NY);
      expect(OneUptimeDate.getUserTimezone()).toBe(NY);
    });

    it("reports the abbreviation of the user timezone, DST aware", () => {
      OneUptimeDate.setUserTimezone(NY);

      // The bug reported "HDT" (America/Adak) for a New York user.
      expect(OneUptimeDate.getCurrentTimezoneString()).not.toBe("HDT");
      expect(["EST", "EDT"]).toContain(
        OneUptimeDate.getCurrentTimezoneString(),
      );
    });

    it("clears back to the browser / process zone when set to null", () => {
      OneUptimeDate.setUserTimezone(NY);
      OneUptimeDate.setUserTimezone(null);

      expect(OneUptimeDate.getUserTimezone()).toBeNull();
      expect(OneUptimeDate.getCurrentTimezone().toString()).toBe(
        currentGuess(),
      );
    });

    it("ignores a value moment does not recognise as a zone rather than breaking every date", () => {
      OneUptimeDate.setUserTimezone("Not/AZone" as Timezone);

      expect(OneUptimeDate.getUserTimezone()).toBeNull();
      expect(OneUptimeDate.getCurrentTimezone().toString()).toBe(
        currentGuess(),
      );
      // Formatting still works.
      expect(
        OneUptimeDate.toDateTimeLocalString(new Date("2026-07-09T13:00:00Z")),
      ).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });
  });

  /*
   * The picker offers each clock under one name, and legacy names — the
   * ones tzdata keeps only for backward compatibility — are not among them.
   * Both ways a zone enters OneUptimeDate translate: the browser's guess
   * (Chromium reports the ICU spelling, "Asia/Calcutta"), and the saved
   * profile zone (an older build saved that guess as it was).
   */
  describe("legacy timezone names", () => {
    test.each([
      ["Asia/Calcutta", Timezone.AsiaKolkata],
      ["Europe/Kiev", Timezone.EuropeKyiv],
      ["Singapore", Timezone.AsiaSingapore],
      ["Asia/Saigon", Timezone.AsiaHo_Chi_Minh],
      ["America/Godthab", Timezone.AmericaNuuk],
      ["US/Pacific", Timezone.AmericaLos_Angeles],
      ["Etc/UTC", Timezone.UTC],
    ])(
      "reports a browser guess of %s as %s",
      (guess: string, current: Timezone) => {
        jest.spyOn(moment.tz, "guess").mockReturnValue(guess);

        expect(OneUptimeDate.getUserTimezone()).toBeNull();
        expect(OneUptimeDate.getCurrentTimezone()).toBe(current);
      },
    );

    it("reports a current browser guess exactly as it is", () => {
      jest.spyOn(moment.tz, "guess").mockReturnValue("Asia/Kuala_Lumpur");

      // A real place sharing Singapore's clock, not a legacy name.
      expect(OneUptimeDate.getCurrentTimezone()).toBe(
        Timezone.AsiaKuala_Lumpur,
      );
    });

    it("passes a guess newer than the enum through untouched", () => {
      jest.spyOn(moment.tz, "guess").mockReturnValue("America/Coyhaique");

      expect(OneUptimeDate.getCurrentTimezone().toString()).toBe(
        "America/Coyhaique",
      );
    });

    it("reads a translated guess on the same clock as the raw one", () => {
      jest.spyOn(moment.tz, "guess").mockReturnValue("Asia/Calcutta");

      const instant: Date = new Date("2026-07-09T17:00:00Z");

      expect(OneUptimeDate.getCurrentTimezoneString()).toBe("IST");
      // 17:00 UTC is 22:30 in Kolkata (UTC+5:30).
      expect(OneUptimeDate.getLocalTimeString(instant)).toBe("22:30");
      expect(OneUptimeDate.toDateTimeLocalString(instant)).toBe(
        "2026-07-09T22:30:00",
      );
    });

    it("still prefers the user timezone over a translated guess", () => {
      jest.spyOn(moment.tz, "guess").mockReturnValue("Asia/Calcutta");

      OneUptimeDate.setUserTimezone(NY);

      expect(OneUptimeDate.getCurrentTimezone()).toBe(NY);
    });

    test.each([
      ["Asia/Calcutta", Timezone.AsiaKolkata],
      ["Europe/Kiev", Timezone.EuropeKyiv],
      ["Singapore", Timezone.AsiaSingapore],
      ["GB", Timezone.EuropeLondon],
      ["US/Eastern", Timezone.AmericaNew_York],
      ["EST5EDT", Timezone.AmericaNew_York],
      ["Zulu", Timezone.UTC],
      ["Etc/Greenwich", Timezone.GMT],
    ])("keeps a saved %s as %s", (saved: string, current: Timezone) => {
      OneUptimeDate.setUserTimezone(saved as Timezone);

      expect(OneUptimeDate.getUserTimezone()).toBe(current);
      expect(OneUptimeDate.getCurrentTimezone()).toBe(current);
    });

    test.each([
      ["asia/calcutta", Timezone.AsiaKolkata],
      ["ASIA/CALCUTTA", Timezone.AsiaKolkata],
      [" Asia/Calcutta ", Timezone.AsiaKolkata],
      ["us/pacific", Timezone.AmericaLos_Angeles],
      ["america/new_york", Timezone.AmericaNew_York],
      [" Europe/London", Timezone.EuropeLondon],
    ])(
      "keeps a saved %p in the enum's spelling, %s",
      (saved: string, current: Timezone) => {
        OneUptimeDate.setUserTimezone(saved as Timezone);

        expect(OneUptimeDate.getUserTimezone()).toBe(current);
      },
    );

    it("keeps US/Pacific-New as Los Angeles, although moment dropped it", () => {
      // tzdata removed the name in 2020b; moment no longer resolves it.
      expect(moment.tz.zone("US/Pacific-New")).toBeNull();

      OneUptimeDate.setUserTimezone(Timezone.USPacificNew);

      expect(OneUptimeDate.getUserTimezone()).toBe(Timezone.AmericaLos_Angeles);
      // 17:00 UTC on Jul 9 is 10:00 in Los Angeles (PDT).
      expect(
        OneUptimeDate.toDateTimeLocalString(new Date("2026-07-09T17:00:00Z")),
      ).toBe("2026-07-09T10:00:00");
    });

    it("reads a saved legacy name on the clock the user always had", () => {
      OneUptimeDate.setUserTimezone(Timezone.AsiaCalcutta);

      const instant: Date = new Date("2026-07-09T17:00:00Z");

      expect(OneUptimeDate.getLocalTimeString(instant)).toBe("22:30");
      expect(
        OneUptimeDate.fromDateTimeLocalString("2026-07-09T22:30").toISOString(),
      ).toBe("2026-07-09T17:00:00.000Z");
    });

    it("keeps every legacy name as its current name", () => {
      const legacyNames: Array<[string, Timezone]> = Object.entries(
        LEGACY_TIMEZONE_NAMES,
      ) as Array<[string, Timezone]>;

      expect(legacyNames.length).toBeGreaterThan(100);

      for (const [legacy, current] of legacyNames) {
        OneUptimeDate.setUserTimezone(legacy as Timezone);

        // Every current name is a zone moment resolves, so none is dropped.
        expect({
          legacy: legacy,
          kept: OneUptimeDate.getUserTimezone(),
        }).toEqual({ legacy: legacy, kept: current });
      }
    });

    it.each(["Not/AZone", "", "   ", "Mars/Olympus"])(
      "still drops %p, which is not a zone in any spelling",
      (saved: string) => {
        OneUptimeDate.setUserTimezone(NY);
        OneUptimeDate.setUserTimezone(saved as Timezone);

        expect(OneUptimeDate.getUserTimezone()).toBeNull();
      },
    );

    it("drops a saved value that is not a string at all", () => {
      /*
       * LocalStorage.getItem JSON-parses what it reads, so a corrupt value
       * can arrive as a number.
       */
      expect(() => {
        OneUptimeDate.setUserTimezone(42 as unknown as Timezone);
      }).not.toThrow();
      expect(OneUptimeDate.getUserTimezone()).toBeNull();
    });
  });

  describe("datetime-local round trip", () => {
    it("renders a stored instant as its wall-clock in the user timezone", () => {
      OneUptimeDate.setUserTimezone(NY);

      // 17:00 UTC on 2026-07-09 is 13:00 in New York (EDT).
      expect(
        OneUptimeDate.toDateTimeLocalString(new Date("2026-07-09T17:00:00Z")),
      ).toBe("2026-07-09T13:00:00");
    });

    it("resolves a typed wall-clock in the user timezone, not the browser zone", () => {
      OneUptimeDate.setUserTimezone(NY);

      const typed: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-07-09T13:00");

      expect(typed.toISOString()).toBe("2026-07-09T17:00:00.000Z");
    });

    it("round trips what the user typed back into the picker unchanged", () => {
      OneUptimeDate.setUserTimezone(NY);

      const typed: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-01-15T09:30");

      expect(OneUptimeDate.toDateTimeLocalString(typed)).toBe(
        "2026-01-15T09:30:00",
      );
    });

    it("stores different instants for the same wall-clock in different user timezones", () => {
      OneUptimeDate.setUserTimezone(NY);
      const inNY: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-07-09T13:00");

      OneUptimeDate.setUserTimezone(ADAK);
      const inAdak: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-07-09T13:00");

      // Adak is 5 hours behind New York in July.
      expect(inAdak.getTime() - inNY.getTime()).toBe(5 * 60 * 60 * 1000);
    });

    it("honours the user timezone's DST offset for a winter instant", () => {
      OneUptimeDate.setUserTimezone(NY);

      // 09:00 EST is 14:00 UTC in January.
      expect(
        OneUptimeDate.fromDateTimeLocalString("2026-01-15T09:00").toISOString(),
      ).toBe("2026-01-15T14:00:00.000Z");
    });
  });

  describe("display helpers", () => {
    it("formats an instant in the user timezone with its abbreviation", () => {
      OneUptimeDate.setUserTimezone(NY);

      const formatted: string = OneUptimeDate.getDateAsLocalFormattedString(
        new Date("2026-07-09T17:00:00Z"),
      );

      expect(formatted).toContain("Jul 09 2026");
      expect(formatted).toContain("13:00");
      expect(formatted).toContain("EDT");
    });

    it("names the abbreviation in effect on the formatted date, not today's", () => {
      OneUptimeDate.setUserTimezone(NY);

      /*
       * The abbreviation used to be looked up for "now", so all summer every
       * winter timestamp read "EDT" — and 13:00 EDT is a different instant
       * than the 13:00 EST that was actually stored.
       */
      const winter: string = OneUptimeDate.getDateAsLocalFormattedString(
        new Date("2026-01-15T18:00:00Z"),
      );
      const summer: string = OneUptimeDate.getDateAsLocalFormattedString(
        new Date("2026-07-15T18:00:00Z"),
      );

      expect(winter).toContain("13:00");
      expect(winter).toContain("EST");
      expect(winter).not.toContain("EDT");

      expect(summer).toContain("14:00");
      expect(summer).toContain("EDT");
    });

    it("labels each pass of a folded fall-back hour with its own abbreviation", () => {
      OneUptimeDate.setUserTimezone(NY);

      // 01:30 local happens twice on 2026-11-01 — once EDT, once EST.
      const firstPass: string = OneUptimeDate.getDateAsLocalFormattedString(
        new Date("2026-11-01T05:30:00Z"),
      );
      const secondPass: string = OneUptimeDate.getDateAsLocalFormattedString(
        new Date("2026-11-01T06:30:00Z"),
      );

      expect(firstPass).toContain("01:30");
      expect(secondPass).toContain("01:30");
      // Identical wall clocks; the abbreviation is what tells them apart.
      expect(firstPass).toContain("EDT");
      expect(secondPass).toContain("EST");
    });

    it("still omits the abbreviation when only the date is shown", () => {
      OneUptimeDate.setUserTimezone(NY);

      const dateOnly: string = OneUptimeDate.getDateAsLocalFormattedString(
        new Date("2026-01-15T18:00:00Z"),
        true,
      );

      expect(dateOnly).toBe("Jan 15, 2026");
    });

    it("reads the hour and minute of an instant in the user timezone", () => {
      OneUptimeDate.setUserTimezone(KOLKATA);

      const instant: Date = new Date("2026-07-09T17:00:00Z");

      // 17:00 UTC is 22:30 in Kolkata (UTC+5:30).
      expect(OneUptimeDate.getLocalHours(instant)).toBe(22);
      expect(OneUptimeDate.getLocalMinutes(instant)).toBe(30);
      expect(OneUptimeDate.getLocalTimeString(instant)).toBe("22:30");
    });

    it("rolls the calendar day when the user timezone puts the instant on another date", () => {
      OneUptimeDate.setUserTimezone(KOLKATA);

      // 23:00 UTC on Jul 9 is already 04:30 on Jul 10 in Kolkata.
      const instant: Date = new Date("2026-07-09T23:00:00Z");

      expect(OneUptimeDate.asDateForDatabaseQuery(instant)).toBe("2026-07-10");
      expect(OneUptimeDate.getDateAsLocalDayMonthString(instant)).toBe(
        "10 Jul",
      );
      expect(OneUptimeDate.getDateAsLocalMonthYearString(instant)).toBe(
        "Jul 2026",
      );
    });
  });

  describe("schedule-zone wall-clock bridge", () => {
    it("reads the entered wall-clock in the user timezone before anchoring it to the schedule zone", () => {
      OneUptimeDate.setUserTimezone(NY);

      // The admin typed 09:00 while working in New York.
      const typed: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-07-09T09:00");

      const stored: Date = OneUptimeDate.getInstantFromLocalWallClockInTimezone(
        typed,
        KOLKATA.toString(),
      );

      // ...and the schedule enforces 09:00 in Kolkata.
      expect(moment.tz(stored, KOLKATA.toString()).format("HH:mm")).toBe(
        "09:00",
      );
    });

    it("redisplays a stored schedule-zone time as the same wall-clock in the picker", () => {
      OneUptimeDate.setUserTimezone(NY);

      const stored: Date = moment
        .tz("2026-07-09 09:00", KOLKATA.toString())
        .toDate();

      const forPicker: Date = OneUptimeDate.getLocalDateFromWallClockInTimezone(
        stored,
        KOLKATA.toString(),
      );

      expect(OneUptimeDate.toDateTimeLocalString(forPicker)).toBe(
        "2026-07-09T09:00:00",
      );
    });
  });
});
