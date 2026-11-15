/** @timezone UTC */

import describeRuntimeTimezone from "./DateRuntimeTimezoneCases";
import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * A browser on UTC reads as UTC, not Africa/Abidjan (DateRuntimeTimezoneCases,
 * issue #8475).
 */

describeRuntimeTimezone({ intlName: "UTC", expected: Timezone.UTC });

describe("what moment makes of a browser on UTC", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("it guesses Africa/Abidjan, from the offsets: the name Intl gives is too short for it", () => {
    expect(moment.tz.guess(true)).toBe("Africa/Abidjan");
  });

  test("the zone is named UTC, where it was GMT", () => {
    const date: Date = new Date("2026-11-05T05:14:00.000Z");

    expect(
      OneUptimeDate.getZoneAbbrByTimezone(
        OneUptimeDate.getCurrentTimezone(),
        date,
      ),
    ).toBe("UTC");
    expect(
      OneUptimeDate.getZoneAbbrByTimezone("Africa/Abidjan" as Timezone, date),
    ).toBe("GMT");
  });

  test("a guess that keeps UTC's clock all year stands in for UTC: it is UTC", () => {
    jest.spyOn(moment.tz, "guess").mockReturnValue("Atlantic/Reykjavik");

    expect(OneUptimeDate.getCurrentTimezone()).toBe(Timezone.UTC);
  });
});
