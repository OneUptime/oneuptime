/** @timezone Europe/London */

import "./RumProductAnalyticsAPI.test";
import { describe, expect, test } from "@jest/globals";

/*
 * The product analytics API suite again, on a server whose clock is
 * London's (issue #7623). CI runs every suite in UTC, where a calendar day
 * is always 24 hours long, so a route that stepped back seven days of the
 * server's calendar passed there, and gave an hour more or less than seven
 * days on a self-hosted server in a zone with summer time. London changes
 * its clocks inside two of the weeks the suite reads
 * (WEEKS_ACROSS_A_CLOCK_CHANGE), and every one of its tests runs here.
 *
 * The @timezone docblock above sets the zone before the file loads
 * (Tests/Utils/TimezoneEnvironment.js), and the suite's mocks come with it.
 * One suite per file: each records TelemetryAPI's routes into its own list
 * when it first loads the module.
 */

describe("the zone the product analytics suite runs in here", () => {
  test("is Europe/London, which moves its clocks in spring and autumn", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "Europe/London",
    );
    expect(new Date("2026-01-15T12:00:00.000Z").getTimezoneOffset()).toBe(0);
    expect(new Date("2026-07-15T12:00:00.000Z").getTimezoneOffset()).toBe(-60);
  });
});
