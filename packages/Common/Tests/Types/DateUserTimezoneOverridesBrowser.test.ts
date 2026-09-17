/** @timezone America/Adak */

/**
 * Regression test for the reported bug, reproduced exactly: the process (a
 * stand-in for the customer's browser) reports America/Adak — abbreviated
 * "HDT" — while the user has picked America/New_York in User Settings.
 *
 * Before the fix, every date field labelled itself "your local timezone - HDT"
 * and resolved what the user typed in Adak's zone, so a New York user had to
 * enter Hawaii-Aleutian times to get the right instant stored. The profile
 * timezone must win over whatever the browser reports.
 */
import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import moment from "moment-timezone";

const NY: Timezone = Timezone.AmericaNew_York;

describe("user timezone overrides a browser reporting a different zone", () => {
  afterEach(() => {
    OneUptimeDate.setUserTimezone(null);
  });

  it("confirms the process really is on the Adak (HDT) clock", () => {
    // Guards the premise of every assertion below.
    expect(moment.tz.guess()).toBe("America/Adak");
    expect(OneUptimeDate.getCurrentTimezoneString()).toBe("HDT");
  });

  it("labels date fields with the profile timezone, not HDT", () => {
    OneUptimeDate.setUserTimezone(NY);

    expect(OneUptimeDate.getCurrentTimezoneString()).toBe("EDT");
    expect(OneUptimeDate.getCurrentTimezone()).toBe(NY);
  });

  it("stores the wall-clock the user typed as New York time", () => {
    OneUptimeDate.setUserTimezone(NY);

    /*
     * The user schedules maintenance for 14:00 on Jul 9. That is 18:00 UTC in
     * New York; reading it on the Adak clock would have stored 23:00 UTC —
     * five hours off, which is exactly what the customer worked around.
     */
    const startsAt: Date =
      OneUptimeDate.fromDateTimeLocalString("2026-07-09T14:00");

    expect(startsAt.toISOString()).toBe("2026-07-09T18:00:00.000Z");
  });

  it("reads a stored event back at the wall-clock the user typed", () => {
    OneUptimeDate.setUserTimezone(NY);

    const startsAt: Date = new Date("2026-07-09T18:00:00.000Z");

    expect(OneUptimeDate.toDateTimeLocalString(startsAt)).toBe(
      "2026-07-09T14:00:00",
    );
    expect(OneUptimeDate.getDateAsLocalFormattedString(startsAt)).toContain(
      "EDT",
    );
    expect(OneUptimeDate.getLocalTimeString(startsAt)).toBe("14:00");
  });

  it("still follows the browser zone for a user who has not picked one", () => {
    OneUptimeDate.setUserTimezone(null);

    // 14:00 HDT (UTC-9) is 23:00 UTC the same day.
    expect(
      OneUptimeDate.fromDateTimeLocalString("2026-07-09T14:00").toISOString(),
    ).toBe("2026-07-09T23:00:00.000Z");
  });
});
