/** @timezone America/Los_Angeles */

import { coerceDateColumnValue } from "../../../Types/Database/DateColumnValue";
import { describe, expect, it } from "@jest/globals";

/*
 * What lands in Postgres must not depend on the zone the Node process runs
 * in. An offset-less literal in a timestamptz column is parsed in the
 * session timezone, which is UTC in every OneUptime deployment, so
 * coerceDateColumnValue reads it as UTC - and so must a server whose host
 * runs on Pacific time, where moment's default local parse would land eight
 * hours later.
 *
 * This file runs in America/Los_Angeles through the docblock above
 * (Tests/Utils/TimezoneEnvironment.js). The case used to set
 * process.env.TZ inside DateColumnValue.test.ts, which never changes the
 * zone (Jest's process.env is a copy), so it ran in UTC, where local and UTC
 * parsing agree and it proved nothing. The first test checks the zone took.
 */

describe("the zone this file runs in", () => {
  it("is America/Los_Angeles, eight hours behind UTC in winter and seven in summer", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "America/Los_Angeles",
    );
    expect(new Date("2027-01-15T12:00:00.000Z").getTimezoneOffset()).toBe(480);
    expect(new Date("2027-07-15T12:00:00.000Z").getTimezoneOffset()).toBe(420);

    // A local parse of an offset-less string lands on Pacific time here.
    expect(new Date(2027, 0, 1).toISOString()).toBe("2027-01-01T08:00:00.000Z");
  });
});

describe("coerceDateColumnValue on a host that runs on Pacific time", () => {
  it("reads an offset-less date as UTC midnight", () => {
    const coerced: unknown = coerceDateColumnValue("2027-01-01");

    expect(coerced).toBeInstanceOf(Date);
    expect((coerced as Date).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("reads an offset-less date in summer time as UTC midnight too", () => {
    const coerced: unknown = coerceDateColumnValue("2027-07-01");

    expect((coerced as Date).toISOString()).toBe("2027-07-01T00:00:00.000Z");
  });

  it("reads the space-separated form Postgres renders as UTC", () => {
    const coerced: unknown = coerceDateColumnValue("2027-01-01 10:30:00");

    expect((coerced as Date).toISOString()).toBe("2027-01-01T10:30:00.000Z");
  });

  it("reads an offset-less date and time with a T as UTC", () => {
    const coerced: unknown = coerceDateColumnValue("2027-03-14T02:30:00");

    /*
     * 02:30 on the morning the clocks go forward does not exist in Los
     * Angeles; read as UTC it is an instant like any other.
     */
    expect((coerced as Date).toISOString()).toBe("2027-03-14T02:30:00.000Z");
  });

  it("keeps an offset the value names", () => {
    const coerced: unknown = coerceDateColumnValue("2027-01-01T00:00:00-08:00");

    expect((coerced as Date).toISOString()).toBe("2027-01-01T08:00:00.000Z");
  });
});
