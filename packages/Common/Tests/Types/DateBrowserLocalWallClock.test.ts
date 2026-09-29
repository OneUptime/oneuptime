/** @timezone Asia/Kolkata */

/*
 * The browser-local wall-clock helpers:
 *   - getBrowserLocalDateFromWallClockInTimezone
 *   - getInstantFromBrowserLocalWallClockInTimezone (inverse)
 *
 * They are for widgets that draw a Date at its BROWSER-local wall clock and
 * know nothing of the user's configured zone. react-big-calendar is one, and
 * the on-call schedule preview hands it every block, band and "now".
 *
 * The browser (see the docblock) is in India. The user's User Settings zone is
 * New York. The current-timezone pair (getLocalDateFromWallClockInTimezone and
 * its inverse) builds wall clocks in the settings zone, so the Dates it built
 * for the grid were drawn nine and a half hours late: a 09:00 shift sat at
 * 6:30 PM.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import moment from "moment-timezone";

const SETTINGS_ZONE: Timezone = Timezone.AmericaNew_York;
const SINGAPORE: string = "Asia/Singapore";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// A Date's browser-local wall clock, read the way react-big-calendar reads it.
function browserWallClock(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function wallClockIn(date: Date, timezone: string): string {
  return moment.tz(date, timezone).format("YYYY-MM-DD HH:mm:ss");
}

// 09:00 on Wednesday 23 September 2026 in Singapore.
const NINE_IN_SINGAPORE: Date = moment
  .tz("2026-09-23 09:00:00", SINGAPORE)
  .toDate();

beforeEach(() => {
  OneUptimeDate.setUserTimezone(SETTINGS_ZONE);
});

afterEach(() => {
  // Never leak a settings zone into the rest of the suite.
  OneUptimeDate.setUserTimezone(null);
});

describe("the setup", () => {
  test("the browser is in India while the settings zone is New York", () => {
    /*
     * Everything below depends on the two zones disagreeing. If the docblock
     * pin stopped working, the assertions could pass for the wrong reason.
     */
    expect(new Date(2026, 8, 23, 9, 0, 0).getTimezoneOffset()).toBe(-330);
    expect(OneUptimeDate.getCurrentTimezone()).toBe(SETTINGS_ZONE);
  });
});

describe("getBrowserLocalDateFromWallClockInTimezone", () => {
  test("puts the zone's wall clock on the browser-local clock", () => {
    const display: Date =
      OneUptimeDate.getBrowserLocalDateFromWallClockInTimezone(
        NINE_IN_SINGAPORE,
        SINGAPORE,
      );

    expect(browserWallClock(display)).toBe("2026-09-23 09:00:00");
    expect(display.getHours()).toBe(9);
  });

  test("the current-timezone helper puts it on the settings zone's clock instead, which the grid draws at 6:30 PM", () => {
    /*
     * This is the bug the preview had. The Date reads 09:00 in New York, and
     * a widget that reads its browser-local wall clock draws it at 18:30.
     */
    const display: Date = OneUptimeDate.getLocalDateFromWallClockInTimezone(
      NINE_IN_SINGAPORE,
      SINGAPORE,
    );

    expect(wallClockIn(display, SETTINGS_ZONE)).toBe("2026-09-23 09:00:00");
    expect(browserWallClock(display)).toBe("2026-09-23 18:30:00");
  });

  test("does not depend on the settings zone", () => {
    for (const settingsZone of [
      null,
      Timezone.AmericaNew_York,
      Timezone.AustraliaSydney,
      Timezone.AsiaKolkata,
      Timezone.UTC,
    ]) {
      OneUptimeDate.setUserTimezone(settingsZone);

      expect(
        browserWallClock(
          OneUptimeDate.getBrowserLocalDateFromWallClockInTimezone(
            NINE_IN_SINGAPORE,
            SINGAPORE,
          ),
        ),
      ).toBe("2026-09-23 09:00:00");
    }
  });

  test("follows the target zone's own daylight saving", () => {
    const summer: Date = moment
      .tz("2026-07-01 09:00:00", "America/New_York")
      .toDate();
    const winter: Date = moment
      .tz("2026-12-01 09:00:00", "America/New_York")
      .toDate();

    expect(
      browserWallClock(
        OneUptimeDate.getBrowserLocalDateFromWallClockInTimezone(
          summer,
          "America/New_York",
        ),
      ),
    ).toBe("2026-07-01 09:00:00");
    expect(
      browserWallClock(
        OneUptimeDate.getBrowserLocalDateFromWallClockInTimezone(
          winter,
          "America/New_York",
        ),
      ),
    ).toBe("2026-12-01 09:00:00");
  });

  test("accepts a date string", () => {
    expect(
      browserWallClock(
        OneUptimeDate.getBrowserLocalDateFromWallClockInTimezone(
          NINE_IN_SINGAPORE.toISOString(),
          SINGAPORE,
        ),
      ),
    ).toBe("2026-09-23 09:00:00");
  });
});

describe("getInstantFromBrowserLocalWallClockInTimezone", () => {
  test("reads the browser-local wall clock, not the settings zone's", () => {
    // Sunday 20 September at midnight, as the grid reports its week's start.
    const reported: Date = new Date(2026, 8, 20, 0, 0, 0, 0);

    expect(
      wallClockIn(
        OneUptimeDate.getInstantFromBrowserLocalWallClockInTimezone(
          reported,
          SINGAPORE,
        ),
        SINGAPORE,
      ),
    ).toBe("2026-09-20 00:00:00");

    /*
     * The current-timezone helper reads that Date at New York's wall clock,
     * 14:30 the afternoon before. The preview then computed its week from
     * Saturday afternoon.
     */
    expect(
      wallClockIn(
        OneUptimeDate.getInstantFromLocalWallClockInTimezone(
          reported,
          SINGAPORE,
        ),
        SINGAPORE,
      ),
    ).toBe("2026-09-19 14:30:00");
  });

  test("does not depend on the settings zone", () => {
    const reported: Date = new Date(2026, 8, 23, 9, 0, 0, 0);

    for (const settingsZone of [
      null,
      Timezone.AmericaNew_York,
      Timezone.AustraliaSydney,
      Timezone.UTC,
    ]) {
      OneUptimeDate.setUserTimezone(settingsZone);

      expect(
        OneUptimeDate.getInstantFromBrowserLocalWallClockInTimezone(
          reported,
          SINGAPORE,
        ).getTime(),
      ).toBe(NINE_IN_SINGAPORE.getTime());
    }
  });
});

describe("the two are inverses", () => {
  const zones: Array<string> = [
    SINGAPORE,
    "America/New_York",
    "Australia/Sydney",
    "Europe/London",
    "Asia/Kathmandu",
    "UTC",
  ];

  // Whole seconds: like the current-timezone pair, these keep wall clocks to the second.
  const instants: Array<Date> = [
    new Date("2026-01-15T03:17:42.000Z"),
    // The morning New York springs forward (03:30 EDT).
    new Date("2026-03-08T07:30:00.000Z"),
    new Date("2026-07-01T12:00:00.000Z"),
    // The morning Sydney springs forward (03:45 AEDT).
    new Date("2026-10-03T16:45:00.000Z"),
    new Date("2026-12-31T23:59:59.000Z"),
  ];

  test("instant -> grid Date -> instant gives back the instant, in every zone", () => {
    for (const zone of zones) {
      for (const instant of instants) {
        const display: Date =
          OneUptimeDate.getBrowserLocalDateFromWallClockInTimezone(
            instant,
            zone,
          );

        expect(browserWallClock(display)).toBe(wallClockIn(instant, zone));
        expect(
          OneUptimeDate.getInstantFromBrowserLocalWallClockInTimezone(
            display,
            zone,
          ).getTime(),
        ).toBe(instant.getTime());
      }
    }
  });

  test("with no settings zone they agree with the current-timezone pair", () => {
    /*
     * The browser zone IS the current timezone then, so users whose settings
     * zone is unset see exactly what they saw before.
     */
    OneUptimeDate.setUserTimezone(null);

    for (const zone of zones) {
      for (const instant of instants) {
        const display: Date =
          OneUptimeDate.getBrowserLocalDateFromWallClockInTimezone(
            instant,
            zone,
          );

        expect(display.getTime()).toBe(
          OneUptimeDate.getLocalDateFromWallClockInTimezone(
            instant,
            zone,
          ).getTime(),
        );
        expect(
          OneUptimeDate.getInstantFromBrowserLocalWallClockInTimezone(
            display,
            zone,
          ).getTime(),
        ).toBe(
          OneUptimeDate.getInstantFromLocalWallClockInTimezone(
            display,
            zone,
          ).getTime(),
        );
      }
    }
  });
});
