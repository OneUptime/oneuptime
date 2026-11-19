import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import TimezoneAlias from "../../Types/TimezoneAlias";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * BRITISH COLUMBIA IS UTC-7 ALL YEAR (issue #9999).
 *
 * British Columbia moved to permanent UTC-7 in March 2026. IANA's tz
 * database release 2026b models it as America/Vancouver (and its legacy
 * link Canada/Pacific) not falling back on 2026-11-01: from 02:00 that
 * night its clocks stay at UTC-7, named MST. OneUptime bundled tzdata 2024b
 * (moment-timezone 0.5.46), so from 1 November it read Vancouver as UTC-8:
 * the time zone picker said "GMT-8 America/Vancouver", and every time
 * typed, shown or scheduled in British Columbia was an hour off.
 *
 * These pin the change in each runtime OneUptime reads time zones with:
 *
 *   - moment-timezone's bundled data, which computes every rotation,
 *     handoff, restriction window, maintenance window, report and summary,
 *     on the server and in the browser;
 *   - the JavaScript runtime's own Intl (Node's ICU here, a browser's in a
 *     browser), which writes dates in the reader's language;
 *   - and OneUptimeDate's helpers on top of them.
 *
 * A moment-timezone, or a Node.js, whose data predates 2026b fails here,
 * naming the zone. Los Angeles and Tijuana, which keep daylight saving
 * time, still fall back on 2026-11-01.
 */

const VANCOUVER: Timezone = Timezone.AmericaVancouver;
const CANADA_PACIFIC: Timezone = Timezone.CanadaPacific;
const LOS_ANGELES: Timezone = Timezone.AmericaLos_Angeles;
const TIJUANA: Timezone = Timezone.AmericaTijuana;

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;

// 02:00 local on 2026-11-01: when the Pacific zones that keep DST fall back.
const FALL_BACK: Date = new Date("2026-11-01T09:00:00.000Z");

// Instants either side of the change, and well after it.
const MID_OCTOBER: Date = new Date("2026-10-15T12:00:00.000Z");
const FIRST_OF_DECEMBER: Date = new Date("2026-12-01T12:00:00.000Z");
const MID_JANUARY: Date = new Date("2027-01-15T12:00:00.000Z");
// When the United States springs forward in 2027; British Columbia does not.
const MID_MARCH_2027: Date = new Date("2027-03-14T12:00:00.000Z");
const MID_SUMMER_2027: Date = new Date("2027-07-01T12:00:00.000Z");

// The release that first has British Columbia's change.
const FIRST_RELEASE_WITH_BRITISH_COLUMBIA: string = "2026b";

/*
 * Whether tz database release `version` ("2026f") is `floor` or later.
 * Releases are a year and a letter, so a year and then the letters order
 * them.
 */
function isReleaseAtLeast(version: string, floor: string): boolean {
  const pattern: RegExp = /^(\d{4})([a-z]+)$/;
  const parsed: RegExpExecArray | null = pattern.exec(version.trim());
  const parsedFloor: RegExpExecArray | null = pattern.exec(floor);

  if (!parsed || !parsedFloor) {
    return false;
  }

  if (parsed[1] !== parsedFloor[1]) {
    return Number(parsed[1]) > Number(parsedFloor[1]);
  }

  const letters: string = parsed[2]!;
  const floorLetters: string = parsedFloor[2]!;

  if (letters.length !== floorLetters.length) {
    return letters.length > floorLetters.length;
  }

  return letters >= floorLetters;
}

// The UTC offset in minutes moment's data gives `zone` at `instant`.
function momentOffset(zone: string, instant: Date): number {
  return moment.tz(instant, zone).utcOffset();
}

// What Intl writes for an offset: "GMT-07:00", or "GMT" for UTC itself.
const LONG_OFFSET: RegExp = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/;

// The UTC offset in minutes this runtime's Intl gives `zone` at `instant`.
function intlOffset(zone: string, instant: Date): number {
  const part: Intl.DateTimeFormatPart | undefined = new Intl.DateTimeFormat(
    "en-US",
    { timeZone: zone, timeZoneName: "longOffset" },
  )
    .formatToParts(instant)
    .find((candidate: Intl.DateTimeFormatPart): boolean => {
      return candidate.type === "timeZoneName";
    });

  const match: RegExpExecArray | null = LONG_OFFSET.exec(part?.value || "");

  if (!match) {
    throw new Error(`Intl wrote no offset for ${zone}: ${part?.value}`);
  }

  if (!match[1]) {
    return 0;
  }

  const minutes: number = Number(match[2]) * 60 + Number(match[3]);

  return match[1] === "-" ? -minutes : minutes;
}

// Every instant from `start` to `end`, `stepMs` apart.
function everyInstant(start: Date, end: Date, stepMs: number): Array<Date> {
  const instants: Array<Date> = [];

  for (let ms: number = start.getTime(); ms <= end.getTime(); ms += stepMs) {
    instants.push(new Date(ms));
  }

  return instants;
}

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the tz database release the runtimes carry", () => {
  test("orders releases by year, then letter", () => {
    expect(isReleaseAtLeast("2026b", "2026b")).toBe(true);
    expect(isReleaseAtLeast("2026f", "2026b")).toBe(true);
    expect(isReleaseAtLeast("2027a", "2026b")).toBe(true);
    expect(isReleaseAtLeast("2026a", "2026b")).toBe(false);
    expect(isReleaseAtLeast("2025z", "2026b")).toBe(false);
    expect(isReleaseAtLeast("2024b", "2026b")).toBe(false);
    expect(isReleaseAtLeast("", "2026b")).toBe(false);
  });

  test("moment-timezone carries 2026b or later", () => {
    expect(moment.tz.dataVersion).toMatch(/^\d{4}[a-z]+$/);
    expect({
      dataVersion: moment.tz.dataVersion,
      hasBritishColumbia: isReleaseAtLeast(
        moment.tz.dataVersion,
        FIRST_RELEASE_WITH_BRITISH_COLUMBIA,
      ),
    }).toEqual({
      dataVersion: moment.tz.dataVersion,
      hasBritishColumbia: true,
    });
  });

  test("this Node.js's ICU carries 2026b or later", () => {
    const tz: string | undefined = process.versions["tz"];

    expect(tz).toBeDefined();
    expect({
      node: process.versions.node,
      tz: tz,
      hasBritishColumbia: isReleaseAtLeast(
        tz || "",
        FIRST_RELEASE_WITH_BRITISH_COLUMBIA,
      ),
    }).toEqual({
      node: process.versions.node,
      tz: tz,
      hasBritishColumbia: true,
    });
  });
});

describe("moment-timezone's data: British Columbia stays on UTC-7", () => {
  test.each([VANCOUVER, CANADA_PACIFIC])(
    "%s is UTC-7 on 2026-12-01 and on 2027-01-15",
    (zone: Timezone) => {
      expect(momentOffset(zone, FIRST_OF_DECEMBER)).toBe(-7 * 60);
      expect(momentOffset(zone, MID_JANUARY)).toBe(-7 * 60);
    },
  );

  test.each([VANCOUVER, CANADA_PACIFIC])(
    "%s is UTC-7 every minute across the night it no longer falls back",
    (zone: Timezone) => {
      const offsets: Set<number> = new Set<number>(
        everyInstant(
          new Date("2026-11-01T06:00:00.000Z"),
          new Date("2026-11-01T12:00:00.000Z"),
          MINUTE_MS,
        ).map((instant: Date): number => {
          return momentOffset(zone, instant);
        }),
      );

      expect([...offsets]).toEqual([-7 * 60]);
    },
  );

  test.each([VANCOUVER, CANADA_PACIFIC])(
    "%s is UTC-7 every hour from October 2026 to the end of 2027",
    (zone: Timezone) => {
      const offsets: Set<number> = new Set<number>(
        everyInstant(
          new Date("2026-10-01T00:00:00.000Z"),
          new Date("2027-12-31T23:00:00.000Z"),
          HOUR_MS,
        ).map((instant: Date): number => {
          return momentOffset(zone, instant);
        }),
      );

      expect([...offsets]).toEqual([-7 * 60]);
    },
  );

  test("its last change of offset is the spring-forward of 2026-03-08", () => {
    const zone: moment.MomentZone = moment.tz.zone(VANCOUVER)!;

    const offsetChanges: Array<string> = [];

    for (let i: number = 1; i < zone.offsets.length; i++) {
      if (zone.offsets[i] !== zone.offsets[i - 1]) {
        offsetChanges.push(new Date(zone.untils[i - 1]!).toISOString());
      }
    }

    expect(offsetChanges[offsetChanges.length - 1]).toBe(
      "2026-03-08T10:00:00.000Z",
    );
    // UTC-7 from then on, with no end.
    expect(zone.offsets[zone.offsets.length - 1]).toBe(7 * 60);
    expect(zone.untils[zone.untils.length - 1]).toBe(Infinity);
  });

  test("its clocks read 02:00 when the Pacific zones that keep DST read 01:00 again", () => {
    expect(moment.tz(FALL_BACK, VANCOUVER).format("YYYY-MM-DD HH:mm")).toBe(
      "2026-11-01 02:00",
    );
    expect(moment.tz(FALL_BACK, LOS_ANGELES).format("YYYY-MM-DD HH:mm")).toBe(
      "2026-11-01 01:00",
    );
  });

  test("01:30 on 2026-11-01 happens once in Vancouver, twice in Los Angeles", () => {
    // Vancouver: one 01:30, 08:30 UTC; an hour later it is 02:30.
    expect(
      everyInstant(
        new Date("2026-11-01T07:00:00.000Z"),
        new Date("2026-11-01T11:00:00.000Z"),
        30 * MINUTE_MS,
      )
        .filter((instant: Date): boolean => {
          return moment.tz(instant, VANCOUVER).format("HH:mm") === "01:30";
        })
        .map((instant: Date): string => {
          return instant.toISOString();
        }),
    ).toEqual(["2026-11-01T08:30:00.000Z"]);

    // Los Angeles: 01:30 PDT, then 01:30 PST an hour later.
    expect(
      everyInstant(
        new Date("2026-11-01T07:00:00.000Z"),
        new Date("2026-11-01T11:00:00.000Z"),
        30 * MINUTE_MS,
      )
        .filter((instant: Date): boolean => {
          return moment.tz(instant, LOS_ANGELES).format("HH:mm") === "01:30";
        })
        .map((instant: Date): string => {
          return instant.toISOString();
        }),
    ).toEqual(["2026-11-01T08:30:00.000Z", "2026-11-01T09:30:00.000Z"]);
  });

  test("Canada/Pacific is America/Vancouver: the same clock, and translated to it", () => {
    const vancouver: moment.MomentZone = moment.tz.zone(VANCOUVER)!;
    const canadaPacific: moment.MomentZone = moment.tz.zone(CANADA_PACIFIC)!;

    expect(canadaPacific.untils).toEqual(vancouver.untils);
    expect(canadaPacific.offsets).toEqual(vancouver.offsets);
    expect(canadaPacific.abbrs).toEqual(vancouver.abbrs);
    expect(TimezoneAlias.getCanonicalTimezone(CANADA_PACIFIC)).toBe(VANCOUVER);
  });

  test.each([LOS_ANGELES, TIJUANA])(
    "%s still falls back to UTC-8 at 02:00 on 2026-11-01, and springs forward on 2027-03-14",
    (zone: Timezone) => {
      expect(momentOffset(zone, MID_OCTOBER)).toBe(-7 * 60);
      expect(momentOffset(zone, new Date(FALL_BACK.getTime() - 1))).toBe(
        -7 * 60,
      );
      expect(momentOffset(zone, FALL_BACK)).toBe(-8 * 60);
      expect(momentOffset(zone, FIRST_OF_DECEMBER)).toBe(-8 * 60);
      expect(momentOffset(zone, MID_JANUARY)).toBe(-8 * 60);
      expect(momentOffset(zone, MID_MARCH_2027)).toBe(-7 * 60);
      expect(momentOffset(zone, MID_SUMMER_2027)).toBe(-7 * 60);
    },
  );
});

describe("this runtime's Intl: British Columbia stays on UTC-7", () => {
  /*
   * OneUptime writes dates in the reader's language with Intl, which reads
   * zones with the runtime's own data: Node's ICU on the server (and in
   * these tests), the browser's in a browser.
   */
  test.each([VANCOUVER, CANADA_PACIFIC])(
    "%s is UTC-7 on 2026-12-01 and on 2027-01-15",
    (zone: Timezone) => {
      expect(intlOffset(zone, FIRST_OF_DECEMBER)).toBe(-7 * 60);
      expect(intlOffset(zone, MID_JANUARY)).toBe(-7 * 60);
    },
  );

  test.each([VANCOUVER, CANADA_PACIFIC])(
    "%s does not fall back in November 2026",
    (zone: Timezone) => {
      const offsets: Set<number> = new Set<number>(
        everyInstant(
          new Date("2026-10-25T00:00:00.000Z"),
          new Date("2026-11-08T00:00:00.000Z"),
          HOUR_MS,
        ).map((instant: Date): number => {
          return intlOffset(zone, instant);
        }),
      );

      expect([...offsets]).toEqual([-7 * 60]);
    },
  );

  test.each([LOS_ANGELES, TIJUANA])(
    "%s still falls back to UTC-8 on 2026-11-01",
    (zone: Timezone) => {
      expect(intlOffset(zone, new Date(FALL_BACK.getTime() - 1))).toBe(-7 * 60);
      expect(intlOffset(zone, FALL_BACK)).toBe(-8 * 60);
      expect(intlOffset(zone, FIRST_OF_DECEMBER)).toBe(-8 * 60);
      expect(intlOffset(zone, MID_JANUARY)).toBe(-8 * 60);
    },
  );

  test("agrees with moment-timezone for the four zones, every hour of late 2026", () => {
    const disagreements: Array<string> = [];

    for (const zone of [VANCOUVER, CANADA_PACIFIC, LOS_ANGELES, TIJUANA]) {
      for (const instant of everyInstant(
        new Date("2026-10-01T00:00:00.000Z"),
        new Date("2027-01-31T00:00:00.000Z"),
        HOUR_MS,
      )) {
        if (intlOffset(zone, instant) !== momentOffset(zone, instant)) {
          disagreements.push(`${zone} at ${instant.toISOString()}`);
        }
      }
    }

    expect(disagreements).toEqual([]);
  });
});

describe("OneUptimeDate in British Columbia", () => {
  test.each([VANCOUVER, CANADA_PACIFIC])(
    "09:00 typed on 2026-12-01 by someone in %s is 16:00 UTC, and reads back as 09:00",
    (zone: Timezone) => {
      OneUptimeDate.setUserTimezone(zone);

      const typed: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-12-01T09:00");

      // It was 17:00 UTC (10:00 in British Columbia) with tzdata 2024b.
      expect(typed.toISOString()).toBe("2026-12-01T16:00:00.000Z");
      expect(OneUptimeDate.toDateTimeLocalString(typed)).toBe(
        "2026-12-01T09:00:00",
      );
      expect(OneUptimeDate.getLocalTimeString(typed)).toBe("09:00");
    },
  );

  test.each([LOS_ANGELES, TIJUANA])(
    "09:00 typed on 2026-12-01 by someone in %s is still 17:00 UTC",
    (zone: Timezone) => {
      OneUptimeDate.setUserTimezone(zone);

      expect(
        OneUptimeDate.fromDateTimeLocalString("2026-12-01T09:00").toISOString(),
      ).toBe("2026-12-01T17:00:00.000Z");
    },
  );

  test("a date is shown with British Columbia's wall clock and the abbreviation the data gives it", () => {
    OneUptimeDate.setUserTimezone(VANCOUVER);

    const october: string = OneUptimeDate.getDateAsLocalFormattedString(
      new Date("2026-10-15T16:00:00.000Z"),
    );
    const december: string = OneUptimeDate.getDateAsLocalFormattedString(
      new Date("2026-12-01T16:00:00.000Z"),
    );

    expect(october).toContain("09:00");
    expect(october).toContain("PDT");

    // Not "08:00 PST", as tzdata 2024b had it.
    expect(december).toContain("09:00");
    expect(december).toContain("MST");
    expect(december).not.toContain("PST");
  });

  test("the abbreviation is PDT until 02:00 on 2026-11-01 and MST from then on, as tzdata 2026b names it", () => {
    for (const zone of [VANCOUVER, CANADA_PACIFIC]) {
      expect(OneUptimeDate.getZoneAbbrByTimezone(zone, MID_OCTOBER)).toBe(
        "PDT",
      );
      expect(
        OneUptimeDate.getZoneAbbrByTimezone(
          zone,
          new Date(FALL_BACK.getTime() - 1),
        ),
      ).toBe("PDT");
      expect(OneUptimeDate.getZoneAbbrByTimezone(zone, FALL_BACK)).toBe("MST");
      expect(OneUptimeDate.getZoneAbbrByTimezone(zone, FIRST_OF_DECEMBER)).toBe(
        "MST",
      );
      expect(OneUptimeDate.getZoneAbbrByTimezone(zone, MID_SUMMER_2027)).toBe(
        "MST",
      );
    }

    for (const zone of [LOS_ANGELES, TIJUANA]) {
      expect(OneUptimeDate.getZoneAbbrByTimezone(zone, FIRST_OF_DECEMBER)).toBe(
        "PST",
      );
      expect(OneUptimeDate.getZoneAbbrByTimezone(zone, MID_SUMMER_2027)).toBe(
        "PDT",
      );
    }
  });

  test("on 2026-11-19 the zone is named GMT-7, as it was named GMT-8 before", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-19T12:00:00.000Z"));

    expect(OneUptimeDate.getGmtOffsetByTimezone(VANCOUVER)).toBe(-7 * 60);
    expect(OneUptimeDate.getGmtOffsetFriendlyStringByTimezone(VANCOUVER)).toBe(
      "GMT-7 America/Vancouver",
    );
    expect(
      OneUptimeDate.getGmtOffsetFriendlyStringByTimezone(CANADA_PACIFIC),
    ).toBe("GMT-7 Canada/Pacific");
    expect(
      OneUptimeDate.getGmtOffsetFriendlyStringByTimezone(LOS_ANGELES),
    ).toBe("GMT-8 America/Los_Angeles");
    expect(OneUptimeDate.getGmtOffsetFriendlyStringByTimezone(TIJUANA)).toBe(
      "GMT-8 America/Tijuana",
    );
  });

  test("the hour after 01:00 on 2026-11-01 is 02:00 in Vancouver, and 01:00 again in Los Angeles", () => {
    const oneAm: Date = new Date("2026-11-01T08:00:00.000Z");
    const anHourLater: Date = OneUptimeDate.addRemoveHours(oneAm, 1);

    expect(moment.tz(anHourLater, VANCOUVER).format("HH:mm")).toBe("02:00");
    expect(moment.tz(anHourLater, LOS_ANGELES).format("HH:mm")).toBe("01:00");
  });

  test("a day added in Vancouver across 2026-11-01 is 24 hours; in Los Angeles it is 25", () => {
    const vancouverNoon: Date = moment
      .tz("2026-10-31 12:00", VANCOUVER)
      .toDate();
    const losAngelesNoon: Date = moment
      .tz("2026-10-31 12:00", LOS_ANGELES)
      .toDate();

    const vancouverNextNoon: Date = OneUptimeDate.addRemoveDays(
      vancouverNoon,
      1,
      VANCOUVER,
    );
    const losAngelesNextNoon: Date = OneUptimeDate.addRemoveDays(
      losAngelesNoon,
      1,
      LOS_ANGELES,
    );

    expect(vancouverNextNoon.getTime() - vancouverNoon.getTime()).toBe(
      24 * HOUR_MS,
    );
    expect(
      moment.tz(vancouverNextNoon, VANCOUVER).format("YYYY-MM-DD HH:mm"),
    ).toBe("2026-11-01 12:00");
    expect(losAngelesNextNoon.getTime() - losAngelesNoon.getTime()).toBe(
      25 * HOUR_MS,
    );
    expect(
      moment.tz(losAngelesNextNoon, LOS_ANGELES).format("YYYY-MM-DD HH:mm"),
    ).toBe("2026-11-01 12:00");
  });
});
