import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE TWO DATE HELPERS BEHIND A DATE AND TIME FIELD PICKED TO THE MINUTE
 * (issue #7593).
 *
 * toDateTimeLocalMinuteString is what an <input type="datetime-local">
 * shows: the wall clock in the person's zone (User Settings, else the
 * browser's), to the minute. With no seconds in its value, the browser's
 * picker shows no seconds column. getStartOfMinute is what "now" is in a
 * field people schedule with: the minute it is, already begun.
 *
 * Every expectation is written in a named zone, so it holds under whatever
 * TZ the suite runs in.
 */

afterEach(() => {
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("a date and time field's value, to the minute", () => {
  const INSTANT: Date = new Date("2026-11-13T05:45:52.345Z");

  test.each([
    [Timezone.UTC, "2026-11-13T05:45"],
    [Timezone.AmericaNew_York, "2026-11-13T00:45"],
    [Timezone.EuropeBerlin, "2026-11-13T06:45"],
    // Half and quarter hour zones keep their own minutes.
    [Timezone.AsiaKolkata, "2026-11-13T11:15"],
    [Timezone.AsiaKathmandu, "2026-11-13T11:30"],
    [Timezone.PacificChatham, "2026-11-13T19:30"],
    [Timezone.AmericaSt_Johns, "2026-11-13T02:15"],
    // Across the date line, the day is the zone's own.
    [Timezone.PacificHonolulu, "2026-11-12T19:45"],
  ])("in %s it reads %s, with no seconds", (zone: Timezone, shown: string) => {
    OneUptimeDate.setUserTimezone(zone);

    expect(OneUptimeDate.toDateTimeLocalMinuteString(INSTANT)).toBe(shown);
    // The same instant to the second, as a telemetry range shows it.
    expect(OneUptimeDate.toDateTimeLocalString(INSTANT)).toBe(`${shown}:52`);
  });

  test("cuts the seconds, never rounds them: 11:15:59.999 is 11:15", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

    expect(
      OneUptimeDate.toDateTimeLocalMinuteString(
        new Date("2026-11-13T05:45:59.999Z"),
      ),
    ).toBe("2026-11-13T11:15");
    expect(
      OneUptimeDate.toDateTimeLocalMinuteString(
        new Date("2026-11-13T05:46:00.000Z"),
      ),
    ).toBe("2026-11-13T11:16");
  });

  test("the minute before midnight stays on its own day, in every zone", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    expect(
      OneUptimeDate.toDateTimeLocalMinuteString(
        new Date("2026-12-31T23:59:59.999Z"),
      ),
    ).toBe("2026-12-31T23:59");
  });

  test("reads the wall clock of the User Settings zone, not the browser's", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);
    const newYork: string = OneUptimeDate.toDateTimeLocalMinuteString(INSTANT);

    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);
    const kolkata: string = OneUptimeDate.toDateTimeLocalMinuteString(INSTANT);

    expect([newYork, kolkata]).toEqual([
      "2026-11-13T00:45",
      "2026-11-13T11:15",
    ]);
  });

  test("an hour a clock change repeats reads the same either time", () => {
    // New York's 01:30 on 2026-11-01 happens twice: in EDT, then in EST.
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    expect(
      OneUptimeDate.toDateTimeLocalMinuteString(
        new Date("2026-11-01T05:30:41.000Z"),
      ),
    ).toBe("2026-11-01T01:30");
    expect(
      OneUptimeDate.toDateTimeLocalMinuteString(
        new Date("2026-11-01T06:30:41.000Z"),
      ),
    ).toBe("2026-11-01T01:30");
  });

  test.each([
    Timezone.UTC,
    Timezone.AmericaNew_York,
    Timezone.AsiaKolkata,
    Timezone.AsiaKathmandu,
    Timezone.PacificChatham,
  ])(
    "picked back in %s, it is the start of the minute shown",
    (zone: Timezone) => {
      OneUptimeDate.setUserTimezone(zone);

      for (const at of [
        "2026-11-13T05:45:52.345Z",
        "2026-11-11T08:00:17.000Z",
        "2026-07-09T17:00:00.000Z",
        "2026-03-29T00:59:59.999Z",
      ]) {
        const instant: Date = new Date(at);
        const pickedBack: Date = OneUptimeDate.fromDateTimeLocalString(
          OneUptimeDate.toDateTimeLocalMinuteString(instant),
        );

        expect({ zone, at, pickedBack: pickedBack.toISOString() }).toEqual({
          zone,
          at,
          pickedBack: OneUptimeDate.getStartOfMinute(instant).toISOString(),
        });
      }
    },
  );
});

describe("the start of a minute", () => {
  test("drops the seconds and milliseconds", () => {
    expect(
      OneUptimeDate.getStartOfMinute(
        new Date("2026-11-13T11:15:52.345Z"),
      ).toISOString(),
    ).toBe("2026-11-13T11:15:00.000Z");
  });

  test.each([
    ["the first millisecond of a minute", "2026-11-13T11:15:00.001Z"],
    ["the last millisecond of a minute", "2026-11-13T11:15:59.999Z"],
    ["the minute itself", "2026-11-13T11:15:00.000Z"],
  ])("%s is in that minute", (_name: string, at: string) => {
    expect(OneUptimeDate.getStartOfMinute(new Date(at)).toISOString()).toBe(
      "2026-11-13T11:15:00.000Z",
    );
  });

  test("never moves later than the time given: what starts now has begun", () => {
    for (const at of [
      "2026-11-13T11:15:00.000Z",
      "2026-11-13T11:15:30.000Z",
      "2026-11-13T23:59:59.999Z",
      "2026-12-31T23:59:59.999Z",
    ]) {
      const instant: Date = new Date(at);
      const start: Date = OneUptimeDate.getStartOfMinute(instant);

      expect({
        at,
        notLater: start.getTime() <= instant.getTime(),
        withinAMinute: instant.getTime() - start.getTime() < 60 * 1000,
      }).toEqual({ at, notLater: true, withinAMinute: true });
    }
  });

  test("keeps the day, the month and the year at their ends", () => {
    expect(
      OneUptimeDate.getStartOfMinute(
        new Date("2026-12-31T23:59:59.999Z"),
      ).toISOString(),
    ).toBe("2026-12-31T23:59:00.000Z");
    expect(
      OneUptimeDate.getStartOfMinute(
        new Date("2028-02-29T00:00:30.000Z"),
      ).toISOString(),
    ).toBe("2028-02-29T00:00:00.000Z");
  });

  test("before 1970, too: it rounds down, not toward zero", () => {
    expect(
      OneUptimeDate.getStartOfMinute(
        new Date("1969-12-31T23:59:59.500Z"),
      ).toISOString(),
    ).toBe("1969-12-31T23:59:00.000Z");
  });

  test("leaves the date it is given as it was, unlike resetSecondsAndMilliseconds", () => {
    const given: Date = new Date("2026-11-13T11:15:52.345Z");

    const start: Date = OneUptimeDate.getStartOfMinute(given);

    expect(start).not.toBe(given);
    expect(given.toISOString()).toBe("2026-11-13T11:15:52.345Z");
  });

  test("takes an ISO string as well as a Date", () => {
    expect(
      OneUptimeDate.getStartOfMinute("2026-11-13T11:15:52.345Z").toISOString(),
    ).toBe("2026-11-13T11:15:00.000Z");
    expect(
      OneUptimeDate.getStartOfMinute(
        "2026-11-13T16:45:52.345+05:30",
      ).toISOString(),
    ).toBe("2026-11-13T11:15:00.000Z");
  });

  test("is the same instant in every zone: no zone's offset has seconds", () => {
    const instant: Date = new Date("2026-11-13T05:45:52.345Z");
    const starts: Array<string> = [];

    for (const zone of [
      Timezone.UTC,
      Timezone.AmericaNew_York,
      Timezone.AsiaKolkata,
      Timezone.AsiaKathmandu,
      Timezone.PacificChatham,
      Timezone.AustraliaLord_Howe,
    ]) {
      OneUptimeDate.setUserTimezone(zone);
      starts.push(OneUptimeDate.getStartOfMinute(instant).toISOString());
    }

    expect(new Set(starts)).toEqual(new Set(["2026-11-13T05:45:00.000Z"]));
  });

  test("agrees with resetSecondsAndMilliseconds, which changes its argument", () => {
    for (const at of [
      "2026-11-13T11:15:52.345Z",
      "2026-11-13T11:15:00.000Z",
      "2026-03-29T00:59:59.999Z",
    ]) {
      expect({
        at,
        start: OneUptimeDate.getStartOfMinute(new Date(at)).toISOString(),
      }).toEqual({
        at,
        start: OneUptimeDate.resetSecondsAndMilliseconds(
          new Date(at),
        ).toISOString(),
      });
    }
  });

  test("of a time that is not one is not one either, and does not throw", () => {
    const start: Date = OneUptimeDate.getStartOfMinute(new Date("not a date"));

    expect(Number.isNaN(start.getTime())).toBe(true);
  });
});
