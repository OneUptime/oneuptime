/** @timezone Australia/Lord_Howe */

import "./RumProductAnalyticsEventsAPI.test";
import { describe, expect, test } from "@jest/globals";

/*
 * The product analytics event API suite again, on a server whose clock is
 * Lord Howe Island's (issue #7623). CI runs every suite in UTC, where a
 * calendar day is always 24 hours long, so a route that stepped back seven
 * days of the server's calendar passed there and read half an hour more or
 * less than seven days here, where the clocks move by half an hour, in two
 * of the weeks the suite reads (WEEKS_ACROSS_A_CLOCK_CHANGE).
 *
 * The @timezone docblock above sets the zone before the file loads
 * (Tests/Utils/TimezoneEnvironment.js), and the suite's mocks come with it.
 * One suite per file: each records TelemetryAPI's routes into its own list
 * when it first loads the module.
 */

describe("the zone the product analytics event suite runs in here", () => {
  test("is Australia/Lord_Howe, whose clocks move by half an hour", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "Australia/Lord_Howe",
    );
    // UTC+11 in the southern summer, UTC+10:30 in winter.
    expect(new Date("2026-01-15T12:00:00.000Z").getTimezoneOffset()).toBe(-660);
    expect(new Date("2026-07-15T12:00:00.000Z").getTimezoneOffset()).toBe(-630);
  });
});
