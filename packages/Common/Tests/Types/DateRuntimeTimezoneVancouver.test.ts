/** @timezone America/Vancouver */

import describeRuntimeTimezone from "./DateRuntimeTimezoneCases";
import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A browser (or a server) in British Columbia reads as Vancouver, as it
 * always did (DateRuntimeTimezoneCases, issue #8475), and its clock stays
 * on UTC-7 after 2026-11-01 (issue #9999): British Columbia moved to
 * permanent UTC-7 in March 2026 (tzdata 2026b).
 *
 * The process runs in America/Vancouver (the zone docblock above), so the
 * runtime's own clock - Date's local getters, which read the zone through
 * the runtime's ICU - and moment's guess of the reader's zone are the ones
 * a reader there has.
 */

describeRuntimeTimezone({
  intlName: "America/Vancouver",
  expected: Timezone.AmericaVancouver,
});

describe("a runtime in British Columbia after 2026-11-01", () => {
  afterEach(() => {
    OneUptimeDate.setUserTimezone(null);
  });

  test("its local clock is UTC-7 on 2026-12-01 and on 2027-01-15", () => {
    // getTimezoneOffset is minutes BEHIND UTC: 420 is UTC-7, 480 UTC-8.
    expect(new Date("2026-12-01T12:00:00.000Z").getTimezoneOffset()).toBe(420);
    expect(new Date("2027-01-15T12:00:00.000Z").getTimezoneOffset()).toBe(420);
  });

  test("its local clock does not fall back on 2026-11-01", () => {
    const beforeTwo: Date = new Date("2026-11-01T08:59:00.000Z");
    const atTwo: Date = new Date("2026-11-01T09:00:00.000Z");

    expect(beforeTwo.getTimezoneOffset()).toBe(420);
    expect(atTwo.getTimezoneOffset()).toBe(420);
    expect([beforeTwo.getHours(), beforeTwo.getMinutes()]).toEqual([1, 59]);
    expect([atTwo.getHours(), atTwo.getMinutes()]).toEqual([2, 0]);
  });

  test("a local date built for 09:00 on 2026-12-01 is 16:00 UTC", () => {
    expect(new Date(2026, 11, 1, 9, 0).toISOString()).toBe(
      "2026-12-01T16:00:00.000Z",
    );
  });

  test("with no zone picked, OneUptime reads and writes Vancouver's wall clock", () => {
    expect(OneUptimeDate.getCurrentTimezone()).toBe(Timezone.AmericaVancouver);

    const typed: Date =
      OneUptimeDate.fromDateTimeLocalString("2026-12-01T09:00");

    expect(typed.toISOString()).toBe("2026-12-01T16:00:00.000Z");
    expect(OneUptimeDate.getLocalTimeString(typed)).toBe("09:00");
    expect(
      OneUptimeDate.getZoneAbbrByTimezone(
        OneUptimeDate.getCurrentTimezone(),
        typed,
      ),
    ).toBe("MST");
  });
});
