import StatusPageUptimeTimezone from "../../../Utils/StatusPage/StatusPageUptimeTimezone";
import DayUptimeGraphUtil, {
  UptimeGraphDay,
} from "../../../Utils/Uptime/DayUptimeGraphUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * StatusPageUptimeTimezone: the zone a status page's uptime history is cut
 * in for one visitor, and the key a history is kept under so every zone of
 * one clock shares it (issue #6697: the bars were UTC days for everyone).
 */

const WINDOW_START: Date = new Date("2026-08-13T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-11T10:00:00.000Z");

function keyOf(timezone: string): string {
  return StatusPageUptimeTimezone.getZoneKey({
    timezone: timezone,
    startDate: WINDOW_START,
    endDate: WINDOW_END,
  });
}

function dayStartsOf(timezone: string): Array<number> {
  return DayUptimeGraphUtil.getDays({
    startDate: WINDOW_START,
    endDate: WINDOW_END,
    timezone: timezone,
  }).map((day: UptimeGraphDay) => {
    return day.startOfDay.getTime();
  });
}

describe("StatusPageUptimeTimezone.resolve", () => {
  test.each([
    ["Asia/Shanghai", "Asia/Shanghai"],
    ["America/New_York", "America/New_York"],
    ["UTC", "UTC"],
    // what Chromium reports for India and Ukraine: the current names.
    ["Asia/Calcutta", "Asia/Kolkata"],
    ["Europe/Kiev", "Europe/Kyiv"],
    ["US/Eastern", "America/New_York"],
    // a visitor's spelling is not a different zone.
    ["asia/shanghai", "Asia/Shanghai"],
    ["  Europe/Berlin  ", "Europe/Berlin"],
  ])("%s is cut as %s", (raw: string, expected: string) => {
    expect(StatusPageUptimeTimezone.resolve(raw)).toBe(expected);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty string", ""],
    ["blank", "   "],
    ["a number", 480],
    ["an object", { timezone: "Asia/Shanghai" }],
    ["a list", ["Asia/Shanghai"]],
    ["a name no zone has", "Mars/Olympus_Mons"],
    ["an offset", "+08:00"],
    ["SQL", 'UTC\'; DROP TABLE "MonitorStatusTimeline"; --'],
    ["a name longer than any zone's", `Asia/${"x".repeat(80)}`],
  ])(
    "%s is UTC, the history the page always drew",
    (_: string, raw: unknown) => {
      expect(StatusPageUptimeTimezone.resolve(raw)).toBe("UTC");
    },
  );
});

describe("StatusPageUptimeTimezone.getZoneKey", () => {
  test("every UTC+8 zone without daylight saving keeps one clock, so one key", () => {
    const shanghai: string = keyOf("Asia/Shanghai");

    for (const zone of [
      "Asia/Singapore",
      "Australia/Perth",
      "Asia/Manila",
      "Asia/Taipei",
      "Asia/Hong_Kong",
    ]) {
      expect(keyOf(zone)).toBe(shanghai);
    }
  });

  test("the EU's zones change their clocks at the same instant, so one key", () => {
    const berlin: string = keyOf("Europe/Berlin");

    for (const zone of [
      "Europe/Paris",
      "Europe/Madrid",
      "Europe/Rome",
      "Europe/Amsterdam",
    ]) {
      expect(keyOf(zone)).toBe(berlin);
    }
  });

  test("zones of different clocks get different keys", () => {
    const keys: Set<string> = new Set<string>(
      [
        "UTC",
        "Europe/London",
        "Europe/Berlin",
        "America/New_York",
        "America/Chicago",
        "Asia/Shanghai",
        "Asia/Tokyo",
        "Asia/Kolkata",
        "Australia/Sydney",
      ].map(keyOf),
    );

    expect(keys.size).toBe(9);
  });

  test("a zone whose clock changes in the window says when, and to what", () => {
    // New York leaves daylight saving on 1 November 2026.
    expect(keyOf("America/New_York")).toBe(
      `offset:${4 * 60}|${Date.parse("2026-11-01T06:00:00.000Z")}:${5 * 60}`,
    );

    // and a window without a change is the offset alone.
    expect(
      StatusPageUptimeTimezone.getZoneKey({
        timezone: "America/New_York",
        startDate: new Date("2026-06-01T00:00:00.000Z"),
        endDate: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ).toBe(`offset:${4 * 60}`);
  });

  test("two zones share a key only when they cut the same days", () => {
    const zones: Array<string> = [
      "UTC",
      "Africa/Abidjan",
      "Atlantic/Reykjavik",
      "Europe/London",
      "Europe/Lisbon",
      "Europe/Berlin",
      "Europe/Oslo",
      "America/New_York",
      "America/Toronto",
      "America/Santiago",
      "Asia/Shanghai",
      "Asia/Singapore",
      "Asia/Kolkata",
      "Asia/Kathmandu",
      "Australia/Lord_Howe",
      "Pacific/Chatham",
    ];

    for (const a of zones) {
      for (const b of zones) {
        if (keyOf(a) === keyOf(b)) {
          expect([a, b, dayStartsOf(a)]).toEqual([a, b, dayStartsOf(b)]);
        }
      }
    }

    // the keys do share: UTC with the zones that keep it all year.
    expect(keyOf("Africa/Abidjan")).toBe(keyOf("UTC"));
    expect(keyOf("Europe/Oslo")).toBe(keyOf("Europe/Berlin"));
  });

  test("a zone it cannot read keys on its name", () => {
    expect(keyOf("Mars/Olympus_Mons")).toBe("zone:Mars/Olympus_Mons");
  });
});
