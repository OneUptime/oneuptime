/** @timezone America/Los_Angeles */

import OneUptimeDate from "../../Types/Date";
import { describe, expect, test } from "@jest/globals";

/*
 * OneUptimeDate.addRemoveDurationInDays: days as a length of time, for a
 * range such as "the last 7 days" (issue #7623). The product analytics,
 * session list and LLM routes default to the 7 days before a range's end;
 * stepped in the server's calendar with addRemoveDays, those were an hour
 * short or long on a server outside UTC whenever its clocks changed inside
 * the week.
 *
 * This file runs on Los Angeles' clock (the @timezone docblock above;
 * Tests/Utils/TimezoneEnvironment.js), which went to summer time at
 * 2026-03-08T10:00Z and back at 2026-11-01T09:00Z. The first tests show
 * the zone took and that its calendar days there are not 24 hours, so
 * nothing below can pass in a zone where they always are.
 */

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

// A moment a few days after each 2026 clock change in Los Angeles.
const AFTER_SPRING_FORWARD: Date = new Date("2026-03-12T18:00:00.000Z");
const AFTER_FALL_BACK: Date = new Date("2026-11-04T07:30:00.000Z");

describe("the zone this file runs in", () => {
  test("is America/Los_Angeles, eight hours behind UTC in winter and seven in summer", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "America/Los_Angeles",
    );
    expect(new Date("2026-01-15T12:00:00.000Z").getTimezoneOffset()).toBe(480);
    expect(new Date("2026-07-15T12:00:00.000Z").getTimezoneOffset()).toBe(420);
  });

  test("steps a week of its calendar across a clock change an hour short or long", () => {
    // What the routes used to do: 167 hours back over the spring change...
    expect(
      AFTER_SPRING_FORWARD.getTime() -
        OneUptimeDate.addRemoveDays(AFTER_SPRING_FORWARD, -7).getTime(),
    ).toBe(7 * DAY_MS - HOUR_MS);
    // ...and 169 over the autumn one.
    expect(
      AFTER_FALL_BACK.getTime() -
        OneUptimeDate.addRemoveDays(AFTER_FALL_BACK, -7).getTime(),
    ).toBe(7 * DAY_MS + HOUR_MS);
  });
});

describe("OneUptimeDate.addRemoveDurationInDays", () => {
  test("goes back 7 x 24 hours across the spring clock change", () => {
    expect(
      OneUptimeDate.addRemoveDurationInDays(
        AFTER_SPRING_FORWARD,
        -7,
      ).toISOString(),
    ).toBe("2026-03-05T18:00:00.000Z");
  });

  test("goes back 7 x 24 hours across the autumn clock change", () => {
    expect(
      OneUptimeDate.addRemoveDurationInDays(AFTER_FALL_BACK, -7).toISOString(),
    ).toBe("2026-10-28T07:30:00.000Z");
  });

  test("goes forward across a clock change by the same length", () => {
    const beforeFallBack: Date = new Date("2026-10-29T07:30:00.000Z");

    expect(
      OneUptimeDate.addRemoveDurationInDays(beforeFallBack, 7).getTime() -
        beforeFallBack.getTime(),
    ).toBe(7 * DAY_MS);
    // Where the calendar step would land an hour later.
    expect(
      OneUptimeDate.addRemoveDays(beforeFallBack, 7).getTime() -
        beforeFallBack.getTime(),
    ).toBe(7 * DAY_MS + HOUR_MS);
  });

  test("is days x 24 hours for any number of days, whole or not", () => {
    const from: Date = new Date("2026-03-01T00:00:00.000Z");

    for (const days of [1, 7, 30, 90, 400, 0.5, 1.25]) {
      expect(OneUptimeDate.addRemoveDurationInDays(from, -days).getTime()).toBe(
        from.getTime() - days * DAY_MS,
      );
      expect(OneUptimeDate.addRemoveDurationInDays(from, days).getTime()).toBe(
        from.getTime() + days * DAY_MS,
      );
    }
  });

  test("keeps the milliseconds of the moment it steps from", () => {
    expect(
      OneUptimeDate.addRemoveDurationInDays(
        new Date("2026-11-08T23:59:59.999Z"),
        -7,
      ).toISOString(),
    ).toBe("2026-11-01T23:59:59.999Z");
  });

  test("zero days is the same moment, as a new date", () => {
    const from: Date = new Date("2026-11-01T09:30:00.000Z");
    const same: Date = OneUptimeDate.addRemoveDurationInDays(from, 0);

    expect(same.getTime()).toBe(from.getTime());
    expect(same).not.toBe(from);
  });

  test("leaves the date it is given as it was", () => {
    const from: Date = new Date("2026-11-04T07:30:00.000Z");

    OneUptimeDate.addRemoveDurationInDays(from, -7);

    expect(from.toISOString()).toBe("2026-11-04T07:30:00.000Z");
  });

  test("takes an ISO string, as the other steps do", () => {
    expect(
      OneUptimeDate.addRemoveDurationInDays(
        "2026-03-12T18:00:00.000Z" as unknown as Date,
        -7,
      ).toISOString(),
    ).toBe("2026-03-05T18:00:00.000Z");
  });

  test("agrees with a calendar step in UTC, where every day is 24 hours", () => {
    for (const from of [AFTER_SPRING_FORWARD, AFTER_FALL_BACK]) {
      expect(OneUptimeDate.addRemoveDurationInDays(from, -7).getTime()).toBe(
        OneUptimeDate.addRemoveDays(from, -7, "UTC").getTime(),
      );
    }
  });
});
