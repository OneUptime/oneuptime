/** @timezone America/New_York */

import { afterEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../../../Types/Date";
import Timezone from "../../../../Types/Timezone";
import {
  DAY_BAR_MS,
  formatHistogramTick,
  getExplorerBarMinutes,
  getHistogramBarEndMs,
  getHistogramRequestTimezone,
  isDayBar,
  readHistogramBucketTimezone,
} from "../../../../UI/Components/Charts/Utils/HistogramDayBars";
import { getHistogramSelectionWindow } from "../../../../UI/Components/Charts/Utils/HistogramSelection";

/*
 * A TELEMETRY HISTOGRAM'S DAY BARS, ON THE READER'S DAYS (issue #7923).
 *
 * The browser half: the zone a histogram asks its day bars in, the label
 * under a day bar, and where a click or a drag on day bars zooms to - to
 * the next midnight of the zone they were cut in, 25 hours on when New
 * York's clocks go back and 23 when they go forward, never a flat 24.
 */

const HOUR_MS: number = 60 * 60 * 1000;
const NEW_YORK: Timezone = Timezone.AmericaNew_York;

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
});

describe("getHistogramBarEndMs", () => {
  test.each([
    [
      "the day the clocks go back is 25 hours",
      "2026-11-01T04:00:00.000Z",
      "2026-11-02T05:00:00.000Z",
    ],
    [
      "the day the clocks go forward is 23 hours",
      "2026-03-08T05:00:00.000Z",
      "2026-03-09T04:00:00.000Z",
    ],
    [
      "any other day is 24 hours",
      "2026-11-10T05:00:00.000Z",
      "2026-11-11T05:00:00.000Z",
    ],
  ])("a New York day bar: %s", (_name: string, start: string, end: string) => {
    expect(
      new Date(
        getHistogramBarEndMs({
          startMs: Date.parse(start),
          bucketIntervalMs: DAY_BAR_MS,
          bucketTimezone: NEW_YORK,
        }),
      ).toISOString(),
    ).toBe(end);
  });

  test("a day bar the answer named no zone for is UTC's, 24 hours", () => {
    expect(
      new Date(
        getHistogramBarEndMs({
          startMs: Date.parse("2026-11-01T00:00:00.000Z"),
          bucketIntervalMs: DAY_BAR_MS,
        }),
      ).toISOString(),
    ).toBe("2026-11-02T00:00:00.000Z");
  });

  test("a shorter bar is its own length, whatever zone", () => {
    expect(
      getHistogramBarEndMs({
        startMs: Date.parse("2026-11-01T05:00:00.000Z"),
        bucketIntervalMs: 6 * HOUR_MS,
        bucketTimezone: NEW_YORK,
      }),
    ).toBe(Date.parse("2026-11-01T11:00:00.000Z"));
  });

  test("no width, no end", () => {
    expect(
      getHistogramBarEndMs({
        startMs: Date.parse("2026-11-01T05:00:00.000Z"),
        bucketIntervalMs: undefined,
      }),
    ).toBeNaN();
    expect(
      getHistogramBarEndMs({
        startMs: Number.NaN,
        bucketIntervalMs: DAY_BAR_MS,
      }),
    ).toBeNaN();
  });
});

describe("a selection on New York day bars", () => {
  test("a click on 1 November opens its 25 hours", () => {
    expect(
      getHistogramSelectionWindow({
        fromBucket: "2026-11-01 04:00:00",
        toBucket: "2026-11-01 04:00:00",
        bucketIntervalMs: DAY_BAR_MS,
        bucketTimezone: NEW_YORK,
      }),
    ).toEqual({
      startTime: new Date("2026-11-01T04:00:00.000Z"),
      endTime: new Date("2026-11-02T05:00:00.000Z"),
    });
  });

  test("a drag across 7 and 8 March ends at 9 March's midnight, the 23-hour day whole", () => {
    expect(
      getHistogramSelectionWindow({
        fromBucket: "2026-03-08 05:00:00",
        toBucket: "2026-03-07 05:00:00",
        bucketIntervalMs: DAY_BAR_MS,
        bucketTimezone: NEW_YORK,
      }),
    ).toEqual({
      startTime: new Date("2026-03-07T05:00:00.000Z"),
      endTime: new Date("2026-03-09T04:00:00.000Z"),
    });
  });

  test("bars shorter than a day zoom as they always did", () => {
    expect(
      getHistogramSelectionWindow({
        fromBucket: "2026-11-01 06:00:00",
        toBucket: "2026-11-01 06:00:00",
        bucketIntervalMs: 6 * HOUR_MS,
        bucketTimezone: NEW_YORK,
      }),
    ).toEqual({
      startTime: new Date("2026-11-01T06:00:00.000Z"),
      endTime: new Date("2026-11-01T12:00:00.000Z"),
    });
    // With no width, a single bar is no window to zoom into.
    expect(
      getHistogramSelectionWindow({
        fromBucket: "2026-11-01 06:00:00",
        toBucket: "2026-11-01 06:00:00",
      }),
    ).toBeNull();
  });
});

describe("formatHistogramTick", () => {
  test("a day bar cut at New York's midnight is named by its day", () => {
    expect(
      formatHistogramTick("2026-11-01 04:00:00", {
        bucketIntervalMs: DAY_BAR_MS,
      }),
    ).toBe("01 Nov");
    expect(
      formatHistogramTick("2026-11-02 05:00:00", {
        bucketIntervalMs: DAY_BAR_MS,
      }),
    ).toBe("02 Nov");
  });

  test("a day bar cut at UTC's midnight, for a reader whose zone the server could not take, is named by that day too", () => {
    expect(
      formatHistogramTick("2026-11-01 00:00:00", {
        bucketIntervalMs: DAY_BAR_MS,
      }),
    ).toBe("01 Nov");
  });

  test("a shorter bar is named by its time, as it always was", () => {
    const time: string = "2026-11-01 15:00:00";

    expect(formatHistogramTick(time, { bucketIntervalMs: 6 * HOUR_MS })).toBe(
      OneUptimeDate.getLocalTimeString(OneUptimeDate.fromString(time), {
        use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
      }),
    );
    expect(formatHistogramTick(time, {})).not.toBe("01 Nov");
  });

  test("text that is no date is drawn as it is", () => {
    expect(
      formatHistogramTick("not a date", { bucketIntervalMs: DAY_BAR_MS }),
    ).toBe("not a date");
  });
});

describe("what a request asks, and what an answer says", () => {
  test("a request names the reader's zone when the Timezone list holds it", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

    expect(getHistogramRequestTimezone()).toBe(Timezone.AsiaKolkata);
  });

  test("an answer's zone is read only when it is a listed one, in its current name", () => {
    expect(readHistogramBucketTimezone("America/New_York")).toBe(NEW_YORK);
    expect(readHistogramBucketTimezone("Asia/Calcutta")).toBe(
      Timezone.AsiaKolkata,
    );
    expect(readHistogramBucketTimezone("Europe/Lodnon")).toBeUndefined();
    expect(readHistogramBucketTimezone(undefined)).toBeUndefined();
    expect(readHistogramBucketTimezone(42)).toBeUndefined();
  });

  test("a bar is a day bar when it is exactly a day wide", () => {
    expect(isDayBar(DAY_BAR_MS)).toBe(true);
    expect(isDayBar(DAY_BAR_MS - 1)).toBe(false);
    expect(isDayBar(undefined)).toBe(false);
  });
});

describe("getExplorerBarMinutes", () => {
  test.each([
    [1, 1],
    [36, 36],
    [719, 719],
    // Forty bars over 20 days and more: a day each, from the reader's midnight.
    [720, 1440],
    [1116, 1440],
    [1440, 1440],
    [3312, 1440],
  ])("%i minutes -> %i", (minutes: number, expected: number) => {
    expect(getExplorerBarMinutes(minutes)).toBe(expected);
  });
});
