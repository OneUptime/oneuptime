import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  EXCEPTION_TREND_ZOOM_BUCKET_MINUTES,
  EXCEPTION_TREND_ZOOM_MAX_BARS,
  buildExceptionTrendZoomRequest,
  describeExceptionTrendZoomWindow,
  getExceptionTrendPresetTimeRange,
  isExceptionTrendIntraday,
  pickExceptionTrendZoomBucketMinutes,
} from "../../FeatureSet/Dashboard/src/Components/Exceptions/ExceptionTrendZoom";
import {
  ExceptionTrendRow,
  ExceptionTrendWindowKey,
  buildExceptionTrendRequest,
  buildExceptionTrendRows,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionDetailPresentation";

/*
 * Issue #4105: the Occurrence Trend card zooms into a dragged stretch. These
 * are the pure halves - what bars a zoomed window is drawn with, and what the
 * histogram is asked for - pinned without rendering (the card itself is
 * driven in Common/Tests/App/Dashboard/ExceptionOccurrenceTrendZoom.test.tsx).
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
const FINGERPRINT: string = "9f86d081884c7d659a2feaa0c55ad015";
const SERVICE_ID: string = "60000000-0000-4000-8000-000000000001";

function zoomWindow(startIso: string, endIso: string): InBetween<Date> {
  return new InBetween<Date>(new Date(startIso), new Date(endIso));
}

describe("pickExceptionTrendZoomBucketMinutes", () => {
  test.each([
    ["a single minute", MINUTE, 1],
    ["half an hour", 30 * MINUTE, 1],
    ["48 minutes, exactly the most bars", 48 * MINUTE, 1],
    ["49 minutes, one bar too many at a minute", 49 * MINUTE, 2],
    ["an hour", HOUR, 2],
    ["four hours", 4 * HOUR, 5],
    ["eight hours", 8 * HOUR, 10],
    ["a day", DAY, 30],
    ["a week", 7 * DAY, 240],
    ["a month", 30 * DAY, 1440],
  ])(
    "%s draws in the narrowest bucket that fits",
    (_label: string, durationMs: number, expectedMinutes: number) => {
      expect(pickExceptionTrendZoomBucketMinutes(durationMs)).toBe(
        expectedMinutes,
      );
    },
  );

  test("never draws more than the most bars a preset does", () => {
    for (
      let durationMs: number = MINUTE;
      durationMs <= 31 * DAY;
      durationMs += 37 * MINUTE
    ) {
      const minutes: number = pickExceptionTrendZoomBucketMinutes(durationMs);
      const isWidestBucket: boolean =
        minutes ===
        EXCEPTION_TREND_ZOOM_BUCKET_MINUTES[
          EXCEPTION_TREND_ZOOM_BUCKET_MINUTES.length - 1
        ];

      if (!isWidestBucket) {
        expect(durationMs / (minutes * MINUTE)).toBeLessThanOrEqual(
          EXCEPTION_TREND_ZOOM_MAX_BARS,
        );
      }
    }
  });

  test("picks the finest bucket that fits, not just any that does", () => {
    for (const durationMs of [2 * HOUR, 5 * HOUR, 11 * HOUR, 3 * DAY]) {
      const minutes: number = pickExceptionTrendZoomBucketMinutes(durationMs);
      const index: number =
        EXCEPTION_TREND_ZOOM_BUCKET_MINUTES.indexOf(minutes);

      if (index > 0) {
        const finer: number = EXCEPTION_TREND_ZOOM_BUCKET_MINUTES[index - 1]!;
        expect(durationMs / (finer * MINUTE)).toBeGreaterThan(
          EXCEPTION_TREND_ZOOM_MAX_BARS,
        );
      }
    }
  });

  test.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "an unusable duration (%s) falls back to a sane bucket",
    (durationMs: number) => {
      const minutes: number = pickExceptionTrendZoomBucketMinutes(durationMs);
      expect(EXCEPTION_TREND_ZOOM_BUCKET_MINUTES).toContain(minutes);
    },
  );

  test("every bucket divides a day evenly, so bars line up with the clock", () => {
    for (const minutes of EXCEPTION_TREND_ZOOM_BUCKET_MINUTES) {
      expect(1440 % minutes).toBe(0);
    }
  });
});

describe("getExceptionTrendPresetTimeRange", () => {
  test.each([
    [ExceptionTrendWindowKey.Day, TimeRange.PAST_ONE_DAY],
    [ExceptionTrendWindowKey.Week, TimeRange.PAST_ONE_WEEK],
    [ExceptionTrendWindowKey.Month, TimeRange.PAST_ONE_MONTH],
  ])(
    "the %s preset goes back to a relative range, which still ends now",
    (key: ExceptionTrendWindowKey, expected: TimeRange) => {
      expect(getExceptionTrendPresetTimeRange(key)).toBe(expected);
    },
  );
});

describe("buildExceptionTrendZoomRequest", () => {
  test("without a zoom it is exactly the preset's request", () => {
    const zoomed: JSONObject | null = buildExceptionTrendZoomRequest({
      windowKey: ExceptionTrendWindowKey.Week,
      fingerprint: FINGERPRINT,
      primaryEntityId: new ObjectID(SERVICE_ID),
      zoomWindow: null,
      now: NOW,
    });

    expect(zoomed).toEqual(
      buildExceptionTrendRequest({
        windowKey: ExceptionTrendWindowKey.Week,
        fingerprint: FINGERPRINT,
        primaryEntityId: new ObjectID(SERVICE_ID),
        now: NOW,
      }),
    );
  });

  test("a zoom narrows the window and the bars, and keeps the scope", () => {
    const zoomed: JSONObject | null = buildExceptionTrendZoomRequest({
      windowKey: ExceptionTrendWindowKey.Day,
      fingerprint: FINGERPRINT,
      primaryEntityId: SERVICE_ID,
      zoomWindow: zoomWindow(
        "2026-09-28T10:00:00.000Z",
        "2026-09-28T11:00:00.000Z",
      ),
      now: NOW,
    });

    expect(zoomed).toEqual({
      startTime: "2026-09-28T10:00:00.000Z",
      endTime: "2026-09-28T11:00:00.000Z",
      bucketSizeInMinutes: 2,
      fingerprints: [FINGERPRINT],
      serviceIds: [SERVICE_ID],
    });
  });

  test("a group with no service is not given one by a zoom", () => {
    const zoomed: JSONObject | null = buildExceptionTrendZoomRequest({
      windowKey: ExceptionTrendWindowKey.Day,
      fingerprint: FINGERPRINT,
      zoomWindow: zoomWindow(
        "2026-09-28T10:00:00.000Z",
        "2026-09-28T11:00:00.000Z",
      ),
      now: NOW,
    });

    expect(zoomed).not.toHaveProperty("serviceIds");
  });

  test("without a fingerprint nothing is asked for, zoomed or not", () => {
    expect(
      buildExceptionTrendZoomRequest({
        windowKey: ExceptionTrendWindowKey.Day,
        fingerprint: "   ",
        zoomWindow: zoomWindow(
          "2026-09-28T10:00:00.000Z",
          "2026-09-28T11:00:00.000Z",
        ),
        now: NOW,
      }),
    ).toBeNull();
  });

  test.each([
    [
      "an empty window",
      zoomWindow("2026-09-28T10:00:00.000Z", "2026-09-28T10:00:00.000Z"),
    ],
    [
      "a backwards window",
      zoomWindow("2026-09-28T11:00:00.000Z", "2026-09-28T10:00:00.000Z"),
    ],
    [
      "an invalid date",
      new InBetween<Date>(new Date("not a date"), new Date()),
    ],
  ])(
    "%s falls back to the preset",
    (_label: string, window: InBetween<Date>) => {
      const zoomed: JSONObject | null = buildExceptionTrendZoomRequest({
        windowKey: ExceptionTrendWindowKey.Day,
        fingerprint: FINGERPRINT,
        zoomWindow: window,
        now: NOW,
      });

      expect(zoomed).toMatchObject({ bucketSizeInMinutes: 30 });
      expect(
        new Date(zoomed!["endTime"] as string).getTime() -
          new Date(zoomed!["startTime"] as string).getTime(),
      ).toBe(DAY);
    },
  );

  test("a window restored with string dates is read as dates", () => {
    const zoomed: JSONObject | null = buildExceptionTrendZoomRequest({
      windowKey: ExceptionTrendWindowKey.Day,
      fingerprint: FINGERPRINT,
      zoomWindow: new InBetween<Date>(
        "2026-09-28T10:00:00.000Z" as unknown as Date,
        "2026-09-28T10:30:00.000Z" as unknown as Date,
      ),
      now: NOW,
    });

    expect(zoomed).toMatchObject({
      startTime: "2026-09-28T10:00:00.000Z",
      endTime: "2026-09-28T10:30:00.000Z",
      bucketSizeInMinutes: 1,
    });
  });

  test("the zoomed request zero-fills to one row per bar across just that window", () => {
    const zoomed: JSONObject | null = buildExceptionTrendZoomRequest({
      windowKey: ExceptionTrendWindowKey.Day,
      fingerprint: FINGERPRINT,
      zoomWindow: zoomWindow(
        "2026-09-28T10:00:00.000Z",
        "2026-09-28T11:00:00.000Z",
      ),
      now: NOW,
    });

    const rows: Array<ExceptionTrendRow> = buildExceptionTrendRows(
      [{ time: "2026-09-28 10:31:00", series: "handled", count: 4 }],
      zoomed,
    );

    expect(rows[0]!.timeMs).toBe(
      new Date("2026-09-28T10:00:00.000Z").getTime(),
    );
    /*
     * 10:00 to 11:00 in two-minute bars: thirty of them, the last starting
     * at 10:58. The window ends on a bucket boundary, and a bucket starting
     * at 11:00 would lie wholly past it.
     */
    expect(rows).toHaveLength(30);
    expect(rows[rows.length - 1]!.timeMs).toBe(
      new Date("2026-09-28T10:58:00.000Z").getTime(),
    );
    expect(
      rows.find((row: ExceptionTrendRow): boolean => {
        return row.handled > 0;
      })!.timeMs,
    ).toBe(new Date("2026-09-28T10:30:00.000Z").getTime());
  });

  test("every zoom a drag across preset bars can make draws no bar past its end", () => {
    /*
     * A drag zooms to the end of the last bar it covered, so a first zoom
     * always ends on a preset bucket boundary - and every zoom bucket size
     * divides every preset bucket size, so that end is on a zoom bucket
     * boundary too. None of those windows may draw a slot past its end:
     * a click there would open the stretch after the zoom.
     */
    for (const [windowKey, presetBucketMinutes] of [
      [ExceptionTrendWindowKey.Day, 30],
      [ExceptionTrendWindowKey.Week, 240],
      [ExceptionTrendWindowKey.Month, 1440],
    ] as Array<[ExceptionTrendWindowKey, number]>) {
      for (const barsDragged of [2, 3, 6]) {
        const endMs: number =
          Math.floor(NOW.getTime() / (presetBucketMinutes * MINUTE)) *
            presetBucketMinutes *
            MINUTE -
          presetBucketMinutes * MINUTE;
        const startMs: number =
          endMs - barsDragged * presetBucketMinutes * MINUTE;

        const zoomed: JSONObject | null = buildExceptionTrendZoomRequest({
          windowKey: windowKey,
          fingerprint: FINGERPRINT,
          zoomWindow: new InBetween<Date>(new Date(startMs), new Date(endMs)),
          now: NOW,
        });
        const bucketMs: number =
          Number(zoomed!["bucketSizeInMinutes"]) * MINUTE;

        const rows: Array<ExceptionTrendRow> = buildExceptionTrendRows(
          [],
          zoomed,
        );

        expect(rows[0]!.timeMs).toBe(startMs);
        expect(rows[rows.length - 1]!.timeMs).toBe(endMs - bucketMs);
        expect(rows).toHaveLength((endMs - startMs) / bucketMs);
      }
    }
  });
});

describe("isExceptionTrendIntraday", () => {
  test.each([
    [MINUTE, true],
    [DAY, true],
    [2 * DAY, true],
    [2 * DAY + 1, false],
    [7 * DAY, false],
    [Number.NaN, false],
  ])(
    "a %s ms window reads by time of day: %s",
    (spanMs: number, expected: boolean) => {
      expect(isExceptionTrendIntraday(spanMs)).toBe(expected);
    },
  );
});

describe("describeExceptionTrendZoomWindow", () => {
  test("names both edges the way the reader's clock writes them", () => {
    const window: InBetween<Date> = zoomWindow(
      "2026-09-28T10:00:00.000Z",
      "2026-09-28T11:30:00.000Z",
    );

    expect(describeExceptionTrendZoomWindow(window)).toBe(
      `between ${OneUptimeDate.getDateAsLocalShortDateTimeString(
        new Date("2026-09-28T10:00:00.000Z"),
      )} and ${OneUptimeDate.getDateAsLocalShortDateTimeString(
        new Date("2026-09-28T11:30:00.000Z"),
      )}`,
    );
  });
});
