/** @timezone UTC */

import { afterEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../Types/Date";
import {
  resetMomentDefaultZone,
  setMomentDefaultZone,
} from "./MomentDefaultZone";

/*
 * Tests/Helpers/MomentDefaultZone: moment's calendar arithmetic in a zone
 * the test names, for the suites that cannot ask Jest for a zone (ee's
 * server tests). This file runs in UTC (the docblock above), so every
 * instant below that is not a whole number of 24-hour days away from where
 * it started could only come from the zone the helper set.
 */

const HOUR: number = 60 * 60 * 1000;

// What OneUptimeDate.addRemoveDays gives, as an ISO string.
const daysLater: (iso: string, days: number) => string = (
  iso: string,
  days: number,
): string => {
  return OneUptimeDate.addRemoveDays(new Date(iso), days).toISOString();
};

afterEach(() => {
  resetMomentDefaultZone();
});

describe("moment's arithmetic in the zone a test names", () => {
  test("this file runs in UTC: a day is 24 hours, the clock change in Europe aside", () => {
    expect(new Date("2026-10-24T11:59:00.000Z").getTimezoneOffset()).toBe(0);
    expect(daysLater("2026-10-24T11:59:00.000Z", 1)).toBe(
      "2026-10-25T11:59:00.000Z",
    );
  });

  test("Europe/London: the day its clocks go back is 25 hours, the day they go forward 23", () => {
    setMomentDefaultZone("Europe/London");

    // 12:59 BST on 24 October 2026; 12:59 GMT the next day.
    expect(daysLater("2026-10-24T11:59:00.000Z", 1)).toBe(
      "2026-10-25T12:59:00.000Z",
    );
    // 12:00 GMT on 28 March 2026; 12:00 BST the next day.
    expect(daysLater("2026-03-28T12:00:00.000Z", 1)).toBe(
      "2026-03-29T11:00:00.000Z",
    );
    // A week that holds no change is 168 hours, as in UTC.
    expect(daysLater("2026-10-01T11:59:00.000Z", 7)).toBe(
      "2026-10-08T11:59:00.000Z",
    );
  });

  test("Australia/Lord_Howe: its clocks change by half an hour", () => {
    setMomentDefaultZone("Australia/Lord_Howe");

    // 12:00 at +10:30 on 3 October 2026; 12:00 at +11:00 the next day.
    expect(daysLater("2026-10-03T01:30:00.000Z", 1)).toBe(
      "2026-10-04T01:00:00.000Z",
    );
  });

  test("OneUptimeDate's months and years follow the zone too; hours stay hours", () => {
    setMomentDefaultZone("America/New_York");

    const noonOnTheSeventhOfMarch: Date = new Date("2026-03-07T17:00:00.000Z");

    // 12:00 EST on 7 March 2026; 12:00 EDT on 7 April, 7 March 2027 is EST again.
    expect(
      OneUptimeDate.addRemoveMonths(noonOnTheSeventhOfMarch, 1).toISOString(),
    ).toBe("2026-04-07T16:00:00.000Z");
    expect(
      OneUptimeDate.addRemoveYears(noonOnTheSeventhOfMarch, 1).toISOString(),
    ).toBe("2027-03-07T17:00:00.000Z");
    expect(
      OneUptimeDate.addRemoveHours(noonOnTheSeventhOfMarch, 24).getTime() -
        noonOnTheSeventhOfMarch.getTime(),
    ).toBe(24 * HOUR);
  });

  test("it reaches moment only: Date's own local getters still read the machine's zone", () => {
    setMomentDefaultZone("Europe/London");

    const instant: Date = new Date("2026-10-24T11:59:00.000Z");

    expect(instant.getTimezoneOffset()).toBe(0);
    expect(instant.getHours()).toBe(11);
  });

  test("a reset reckons in the machine's zone again", () => {
    setMomentDefaultZone("Europe/London");
    resetMomentDefaultZone();

    expect(daysLater("2026-10-24T11:59:00.000Z", 1)).toBe(
      "2026-10-25T11:59:00.000Z",
    );
  });

  test("a zone moment does not know throws, and leaves the zone as it was", () => {
    setMomentDefaultZone("Europe/London");

    expect(() => {
      setMomentDefaultZone("Europe/Atlantis");
    }).toThrow('moment-timezone does not know the zone "Europe/Atlantis".');
    expect(() => {
      setMomentDefaultZone("");
    }).toThrow('moment-timezone does not know the zone "".');
    // Still London's 25-hour day, never quietly the machine's.
    expect(daysLater("2026-10-24T11:59:00.000Z", 1)).toBe(
      "2026-10-25T12:59:00.000Z",
    );
  });
});
