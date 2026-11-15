import AggregationIntervalUtil from "../../Types/BaseDatabase/AggregationIntervalUtil";
import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * THE BROWSER'S OWN ZONE, BY ITS OWN NAME (issue #8475).
 *
 * OneUptimeDate.getCurrentTimezone() is the zone every "local" date is
 * written in when the reader picked none, the zone the Dashboard saves to
 * a new user's profile, and the asker's zone Ask AI cuts its days in. It
 * was moment's guess, and moment trusts the name Intl gives the zone only
 * when it is longer than three letters: in a browser on UTC - Intl's
 * "UTC" - it guessed from the offsets instead, and named Africa/Abidjan.
 * Zones read "GMT" ("GMT+0" in German), a new profile was saved with
 * Abidjan, and an Ask AI chart said "Days are in Africa/Abidjan." of a
 * reader on UTC.
 *
 * These run with the process in a zone of its own (the zone docblock
 * of each file that calls describeRuntimeTimezone).
 */

export default function describeRuntimeTimezone(data: {
  // The zone the docblock set, as Intl names it.
  intlName: string;
  // What getCurrentTimezone() reads there with no zone picked.
  expected: Timezone;
}): void {
  afterEach(() => {
    OneUptimeDate.setUserTimezone(null);
    jest.restoreAllMocks();
  });

  describe(`a browser whose zone Intl names ${data.intlName}`, () => {
    test("is the zone the docblock asked for", () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
        data.intlName,
      );
    });

    test(`reads as ${data.expected} when the reader picked no zone`, () => {
      expect(OneUptimeDate.getCurrentTimezone()).toBe(data.expected);
      expect(OneUptimeDate.getCurrentTimezone()).toBe(data.expected);
    });

    test("the zone the reader picked comes first, as it always did", () => {
      OneUptimeDate.setUserTimezone(Timezone.AsiaKathmandu);

      expect(OneUptimeDate.getCurrentTimezone()).toBe(Timezone.AsiaKathmandu);

      OneUptimeDate.setUserTimezone(null);

      expect(OneUptimeDate.getCurrentTimezone()).toBe(data.expected);
    });

    test("a zone moment guesses with another clock is moment's, in its current name", () => {
      // What the Dashboard's tests play the browser with.
      jest.spyOn(moment.tz, "guess").mockReturnValue("Asia/Calcutta");
      expect(OneUptimeDate.getCurrentTimezone()).toBe(Timezone.AsiaKolkata);

      // London is UTC's clock in winter, not in summer: it stays London.
      jest.spyOn(moment.tz, "guess").mockReturnValue("Europe/London");
      expect(OneUptimeDate.getCurrentTimezone()).toBe(Timezone.EuropeLondon);

      jest.spyOn(moment.tz, "guess").mockReturnValue("America/Coyhaique");
      expect(OneUptimeDate.getCurrentTimezone()).toBe(
        "America/Coyhaique" as Timezone,
      );
    });

    test("the zone Ask AI and the day bars are asked in is the same one", () => {
      expect(AggregationIntervalUtil.getListedReaderTimezone()).toBe(
        data.expected,
      );

      const end: Date = new Date("2026-11-15T15:00:00.000Z");

      expect(
        AggregationIntervalUtil.getReaderTimezone({
          startDate: new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000),
          endDate: end,
        }),
      ).toBe(data.expected);
    });
  });
}
