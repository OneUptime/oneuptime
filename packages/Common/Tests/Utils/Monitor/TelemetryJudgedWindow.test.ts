/** @timezone America/New_York */

import { afterEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import {
  forgetRememberedDateTexts,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import Timezone from "../../../Types/Timezone";
import TelemetryJudgedWindow from "../../../Utils/Monitor/TelemetryJudgedWindow";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE WINDOW A TELEMETRY CHECK JUDGED, IN WORDS (issue #11248).
 *
 * A check judges the window it was due to, however late it runs, so the time
 * it ran no longer says which data it read. The root cause of what it opens
 * names the window in UTC (TelemetryJudgedWindow, read in email, Slack and
 * Teams by people in every zone), and its log entry in the reader's zone,
 * language and clock, to the second (getLocalDateTimeRangeEnds with
 * includeSeconds). This file runs in New York, so a root cause that slipped
 * onto the process's zone would read five hours off.
 */

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
});

describe("TelemetryJudgedWindow.describe, the root cause's words", () => {
  test("the process runs in New York, so UTC is not its zone", () => {
    expect(new Date("2026-11-27T10:00:00.000Z").getHours()).toBe(5);
  });

  test("a window within one day says its date once, in UTC, to the second", () => {
    expect(
      TelemetryJudgedWindow.describe({
        startsAt: new Date("2026-11-27T10:00:07.123Z"),
        endsAt: new Date("2026-11-27T10:01:07.123Z"),
      }),
    ).toBe("2026-11-27 10:00:07 to 10:01:07 UTC");
  });

  test("a window across midnight in UTC says both dates", () => {
    expect(
      TelemetryJudgedWindow.describe({
        startsAt: new Date("2026-11-26T23:59:30.000Z"),
        endsAt: new Date("2026-11-27T00:00:30.000Z"),
      }),
    ).toBe("2026-11-26 23:59:30 to 2026-11-27 00:00:30 UTC");
  });

  test("a day-long window says both dates", () => {
    expect(
      TelemetryJudgedWindow.describe({
        startsAt: new Date("2026-11-26T10:00:07.000Z"),
        endsAt: new Date("2026-11-27T10:00:07.000Z"),
      }),
    ).toBe("2026-11-26 10:00:07 to 2026-11-27 10:00:07 UTC");
  });

  test("a window read back from JSON, as a stored summary holds it, reads the same", () => {
    const stored: { startsAt: Date; endsAt: Date } = JSON.parse(
      JSON.stringify({
        startsAt: new Date("2026-11-27T10:00:07.000Z"),
        endsAt: new Date("2026-11-27T10:01:07.000Z"),
      }),
    );

    expect(typeof stored.startsAt).toBe("string");
    expect(TelemetryJudgedWindow.describe(stored)).toBe(
      "2026-11-27 10:00:07 to 10:01:07 UTC",
    );
  });

  test("windows that follow on read so: one ends at the second the next starts", () => {
    const first: string = TelemetryJudgedWindow.describe({
      startsAt: new Date("2026-11-27T10:00:07.400Z"),
      endsAt: new Date("2026-11-27T10:01:07.400Z"),
    })!;
    const second: string = TelemetryJudgedWindow.describe({
      startsAt: new Date("2026-11-27T10:01:07.400Z"),
      endsAt: new Date("2026-11-27T10:02:07.400Z"),
    })!;

    expect(first.split(" to ")[1]!.replace(" UTC", "")).toBe("10:01:07");
    expect(second.split(" to ")[0]!.slice(11)).toBe("10:01:07");
  });

  test("no window, ends that cannot be read and an end before the start say nothing", () => {
    expect(TelemetryJudgedWindow.describe(undefined)).toBeNull();
    expect(TelemetryJudgedWindow.describe(null)).toBeNull();
    expect(
      TelemetryJudgedWindow.describe({
        startsAt: new Date(Number.NaN),
        endsAt: new Date("2026-11-27T10:01:07.000Z"),
      }),
    ).toBeNull();
    expect(
      TelemetryJudgedWindow.describe({
        startsAt: new Date("2026-11-27T10:01:07.000Z"),
        endsAt: new Date("2026-11-27T10:00:07.000Z"),
      }),
    ).toBeNull();
  });

  test("a window with no length - a check of the last zero seconds - is still named", () => {
    expect(
      TelemetryJudgedWindow.describe({
        startsAt: new Date("2026-11-27T10:01:07.000Z"),
        endsAt: new Date("2026-11-27T10:01:07.000Z"),
      }),
    ).toBe("2026-11-27 10:01:07 to 10:01:07 UTC");
  });
});

describe("getLocalDateTimeRangeEnds with includeSeconds, the log entry's words", () => {
  const START: Date = new Date("2026-11-27T10:00:07.000Z");
  const END: Date = new Date("2026-11-27T10:01:07.000Z");

  test("a short window within one day writes its day once and both times to the second, in the reader's zone", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    expect(
      OneUptimeDate.getLocalDateTimeRangeEnds({
        start: START,
        end: END,
        style: "short",
        showYear: true,
        includeSeconds: true,
        use12HourFormat: true,
      }),
    ).toEqual({
      start: "Nov 27, 2026, 10:00:07 AM",
      end: "10:01:07 AM",
      isWithinOneDay: true,
    });

    expect(
      OneUptimeDate.getLocalDateTimeRangeEnds({
        start: START,
        end: END,
        style: "short",
        showYear: true,
        includeSeconds: true,
        use12HourFormat: false,
      }),
    ).toEqual({
      start: "Nov 27, 2026, 10:00:07",
      end: "10:01:07",
      isWithinOneDay: true,
    });
  });

  test("the reader's zone, not the process's or UTC: Kolkata reads the same window five and a half hours on", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

    expect(
      OneUptimeDate.getLocalDateTimeRangeEnds({
        start: START,
        end: END,
        style: "short",
        showYear: true,
        includeSeconds: true,
        use12HourFormat: false,
      }),
    ).toEqual({
      start: "Nov 27, 2026, 15:30:07",
      end: "15:31:07",
      isWithinOneDay: true,
    });
  });

  test("across midnight in the reader's zone, both ends are whole, each to the second", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    expect(
      OneUptimeDate.getLocalDateTimeRangeEnds({
        start: new Date("2026-11-26T23:59:30.000Z"),
        end: new Date("2026-11-27T00:00:30.000Z"),
        style: "short",
        showYear: true,
        includeSeconds: true,
        use12HourFormat: false,
      }),
    ).toEqual({
      start: "Nov 26, 2026, 23:59:30",
      end: "Nov 27, 2026, 00:00:30",
      isWithinOneDay: false,
    });
  });

  test("without includeSeconds a window reads as it always did: to the minute", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    expect(
      OneUptimeDate.getLocalDateTimeRangeEnds({
        start: START,
        end: END,
        style: "short",
        showYear: true,
        use12HourFormat: false,
      }),
    ).toEqual({
      start: "Nov 27, 2026, 10:00",
      end: "10:01",
      isWithinOneDay: true,
    });
  });

  test("a sentence's long style keeps its shape: includeSeconds is for the short one", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    const withSeconds: { start: string; end: string } =
      OneUptimeDate.getLocalDateTimeRangeEnds({
        start: START,
        end: END,
        style: "long",
        includeSeconds: true,
        use12HourFormat: false,
      });
    const without: { start: string; end: string } =
      OneUptimeDate.getLocalDateTimeRangeEnds({
        start: START,
        end: END,
        style: "long",
        use12HourFormat: false,
      });

    expect(withSeconds).toEqual(without);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "in %s the end of a one-day window still says its seconds",
    (language: string) => {
      OneUptimeDate.setUserTimezone(Timezone.UTC);
      setDateDisplayLanguage(language);

      const ends: { start: string; end: string } =
        OneUptimeDate.getLocalDateTimeRangeEnds({
          start: START,
          end: END,
          style: "short",
          showYear: true,
          includeSeconds: true,
          use12HourFormat: false,
        });

      // The seconds, 07, in Latin, Persian or Arabic-Indic digits.
      expect(ends.end).toMatch(/[0۰٠][7۷٧]/u);
      expect(ends.start).toMatch(/[0۰٠][7۷٧]/u);
    },
  );
});
