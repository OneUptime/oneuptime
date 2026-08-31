/**
 * The Traces explorer's and the dashboard log/trace widgets' own timestamps -
 * histogram x-axis ticks, chart tooltips, and the clock on a span row.
 *
 * Each of these was a copy of `date.toLocaleTimeString([], { hour12: false })`,
 * which hardcodes a 24-hour clock over the reader's preference and, passing no
 * `timeZone`, reads the digits off the browser process rather than the zone set
 * in User Settings. So a span row's clock could disagree with the chart above
 * it and with every other date on the page.
 *
 * These tests run in the "node" environment, where `window` is undefined and
 * `OneUptimeDate.getUserPrefers12HourFormat()` therefore always answers true.
 * That is a server-side default, not this machine's preference, so every case
 * below pins the preference rather than inheriting it - otherwise the 24-hour
 * half of the behaviour would never be exercised at all.
 */
import OneUptimeDate from "Common/Types/Date";
import Timezone from "Common/Types/Timezone";
import { formatLogChartTickTime } from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/LogChartData";
import { formatTickTime as formatTraceWidgetTick } from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/TraceChartData";
import {
  formatAbsoluteTime,
  formatTickTime,
  formatTooltipLabel,
} from "../../FeatureSet/Dashboard/src/Components/Traces/TraceTimeFormat";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/** 14:30:45 UTC - an afternoon, so a 12-hour clock has real work to do. */
const AFTERNOON_ISO: string = "2024-03-01T14:30:45.000Z";
const AFTERNOON: Date = new Date(AFTERNOON_ISO);

function pin(use12HourFormat: boolean, timezone: Timezone): void {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(use12HourFormat);
  OneUptimeDate.setUserTimezone(timezone);
}

afterEach(() => {
  // Never leak a pinned zone or a mocked preference into the rest of the suite.
  OneUptimeDate.setUserTimezone(null);
  jest.restoreAllMocks();
});

describe("the Traces explorer histogram x-axis", () => {
  test("labels a tick with AM/PM on a machine set to a 12-hour clock", () => {
    pin(true, Timezone.UTC);

    expect(formatTickTime(AFTERNOON_ISO)).toBe("2:30 PM");
  });

  test("keeps a 24-hour tick when that is the machine's clock", () => {
    pin(false, Timezone.UTC);

    expect(formatTickTime(AFTERNOON_ISO)).toBe("14:30");
  });

  test("reads the tick in the configured timezone", () => {
    pin(false, Timezone.AsiaKolkata);

    // 14:30 UTC is 20:00 the same evening in Kolkata.
    expect(formatTickTime(AFTERNOON_ISO)).toBe("20:00");
  });

  test("carries the configured timezone into the 12-hour reading too", () => {
    pin(true, Timezone.AmericaNew_York);

    expect(formatTickTime(AFTERNOON_ISO)).toBe("9:30 AM");
  });

  test("leaves a label it cannot parse alone", () => {
    pin(true, Timezone.UTC);

    expect(formatTickTime("not-a-date")).toBe("not-a-date");
  });
});

describe("the Traces explorer chart tooltip", () => {
  test("dates the bucket on the machine's clock", () => {
    pin(true, Timezone.UTC);

    expect(formatTooltipLabel(AFTERNOON_ISO)).toBe("Mar 1, 2:30 PM");
  });

  test("dates the bucket on a 24-hour clock when that is the preference", () => {
    pin(false, Timezone.UTC);

    expect(formatTooltipLabel(AFTERNOON_ISO)).toBe("Mar 1, 14:30");
  });

  /*
   * Kolkata is 5h30m ahead, so this instant has already rolled over into the
   * next day there - the date half has to move with the clock half.
   */
  test("rolls the date with the configured timezone", () => {
    pin(false, Timezone.AsiaKolkata);

    expect(formatTooltipLabel("2024-03-01T23:00:00.000Z")).toBe("Mar 2, 04:30");
  });

  test("returns nothing for an absent label", () => {
    pin(true, Timezone.UTC);

    expect(formatTooltipLabel(undefined)).toBe("");
  });

  test("leaves a label it cannot parse alone", () => {
    pin(true, Timezone.UTC);

    expect(formatTooltipLabel("not-a-date")).toBe("not-a-date");
  });
});

describe("a span row's start time", () => {
  test("shows seconds on the machine's clock", () => {
    pin(true, Timezone.UTC);

    expect(formatAbsoluteTime(AFTERNOON)).toBe("2:30:45 PM");
  });

  test("shows seconds on a 24-hour clock when that is the preference", () => {
    pin(false, Timezone.UTC);

    expect(formatAbsoluteTime(AFTERNOON)).toBe("14:30:45");
  });

  test("reads the row in the configured timezone", () => {
    pin(false, Timezone.AsiaKolkata);

    expect(formatAbsoluteTime(AFTERNOON)).toBe("20:00:45");
  });
});

describe("the dashboard log volume widget x-axis", () => {
  test("labels a bare tick on the machine's clock", () => {
    pin(true, Timezone.UTC);
    expect(formatLogChartTickTime(AFTERNOON_ISO)).toBe("2:30 PM");

    jest.restoreAllMocks();

    pin(false, Timezone.UTC);
    expect(formatLogChartTickTime(AFTERNOON_ISO)).toBe("14:30");
  });

  test("dates a tick when the window spans more than a day", () => {
    pin(true, Timezone.UTC);
    expect(formatLogChartTickTime(AFTERNOON_ISO, true)).toBe("Mar 1, 2:30 PM");

    jest.restoreAllMocks();

    pin(false, Timezone.UTC);
    expect(formatLogChartTickTime(AFTERNOON_ISO, true)).toBe("Mar 1, 14:30");
  });

  test("reads both forms in the configured timezone", () => {
    pin(false, Timezone.AsiaKolkata);

    expect(formatLogChartTickTime("2024-03-01T23:00:00.000Z")).toBe("04:30");
    expect(formatLogChartTickTime("2024-03-01T23:00:00.000Z", true)).toBe(
      "Mar 2, 04:30",
    );
  });

  test("leaves a tick it cannot parse alone", () => {
    pin(true, Timezone.UTC);

    expect(formatLogChartTickTime("not-a-date")).toBe("not-a-date");
    expect(formatLogChartTickTime("not-a-date", true)).toBe("not-a-date");
  });
});

describe("the dashboard trace widget x-axis", () => {
  test("labels a tick on the machine's clock and configured zone", () => {
    pin(true, Timezone.AmericaNew_York);
    expect(formatTraceWidgetTick(AFTERNOON_ISO)).toBe("9:30 AM");

    jest.restoreAllMocks();

    pin(false, Timezone.AmericaNew_York);
    expect(formatTraceWidgetTick(AFTERNOON_ISO)).toBe("09:30");
  });

  test("leaves a tick it cannot parse alone", () => {
    pin(true, Timezone.UTC);

    expect(formatTraceWidgetTick("not-a-date")).toBe("not-a-date");
  });
});
