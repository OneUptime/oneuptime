/** @timezone UTC */

import {
  HistogramSelectionWindow,
  clampHistogramSelectionToWindowEnd,
  getHistogramSelectionWindow,
} from "../../../../UI/Components/Charts/Utils/HistogramSelection";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #3914: clicking a bar of the Log Volume chart (or dragging inside
 * one) showed "no logs" under a chart that plainly had some. Every bar is
 * labelled with the START of its bucket, and the selection used to run from
 * one label to the other - so one bar became a window zero seconds wide,
 * and a drag across several dropped the whole of the last one. These pin the
 * window a selection actually covers.
 */

const MINUTE_MS: number = 60 * 1000;
const FIFTEEN_MINUTES: number = 15 * MINUTE_MS;

function iso(window: HistogramSelectionWindow | null): {
  startTime: string;
  endTime: string;
} | null {
  if (!window) {
    return null;
  }

  return {
    startTime: window.startTime.toISOString(),
    endTime: window.endTime.toISOString(),
  };
}

describe("getHistogramSelectionWindow", () => {
  describe("a click on one bar", () => {
    test("covers that bar's whole bucket, not a zero-width window", () => {
      expect(
        iso(
          getHistogramSelectionWindow({
            fromBucket: "2026-09-17T10:15:00.000Z",
            toBucket: "2026-09-17T10:15:00.000Z",
            bucketIntervalMs: MINUTE_MS,
          }),
        ),
      ).toEqual({
        startTime: "2026-09-17T10:15:00.000Z",
        endTime: "2026-09-17T10:16:00.000Z",
      });
    });

    test("covers a wide bucket just as fully", () => {
      const zoomed: HistogramSelectionWindow | null =
        getHistogramSelectionWindow({
          fromBucket: "2026-09-17T10:00:00.000Z",
          toBucket: "2026-09-17T10:00:00.000Z",
          bucketIntervalMs: FIFTEEN_MINUTES,
        });

      expect(zoomed).not.toBeNull();
      expect(zoomed!.endTime.getTime() - zoomed!.startTime.getTime()).toBe(
        FIFTEEN_MINUTES,
      );
    });

    /*
     * Without a width there is no honest window to open: the old behaviour -
     * a window zero seconds wide - is exactly the bug.
     */
    test("selects nothing when the bucket width is unknown", () => {
      expect(
        getHistogramSelectionWindow({
          fromBucket: "2026-09-17T10:15:00.000Z",
          toBucket: "2026-09-17T10:15:00.000Z",
        }),
      ).toBeNull();
    });

    test.each([0, -MINUTE_MS, Number.NaN, Number.POSITIVE_INFINITY])(
      "treats a bucket width of %p as unknown",
      (bucketIntervalMs: number) => {
        expect(
          getHistogramSelectionWindow({
            fromBucket: "2026-09-17T10:15:00.000Z",
            toBucket: "2026-09-17T10:15:00.000Z",
            bucketIntervalMs: bucketIntervalMs,
          }),
        ).toBeNull();
      },
    );
  });

  describe("a drag across several bars", () => {
    test("keeps the last bar it covered, not just that bar's start", () => {
      expect(
        iso(
          getHistogramSelectionWindow({
            fromBucket: "2026-09-17T10:00:00.000Z",
            toBucket: "2026-09-17T11:00:00.000Z",
            bucketIntervalMs: FIFTEEN_MINUTES,
          }),
        ),
      ).toEqual({
        startTime: "2026-09-17T10:00:00.000Z",
        endTime: "2026-09-17T11:15:00.000Z",
      });
    });

    test("covers the same window dragged right to left", () => {
      expect(
        getHistogramSelectionWindow({
          fromBucket: "2026-09-17T11:00:00.000Z",
          toBucket: "2026-09-17T10:00:00.000Z",
          bucketIntervalMs: FIFTEEN_MINUTES,
        }),
      ).toEqual(
        getHistogramSelectionWindow({
          fromBucket: "2026-09-17T10:00:00.000Z",
          toBucket: "2026-09-17T11:00:00.000Z",
          bucketIntervalMs: FIFTEEN_MINUTES,
        }),
      );
    });

    test("runs from label to label when the bucket width is unknown", () => {
      expect(
        iso(
          getHistogramSelectionWindow({
            fromBucket: "2026-09-17T10:00:00.000Z",
            toBucket: "2026-09-17T11:00:00.000Z",
            bucketIntervalMs: 0,
          }),
        ),
      ).toEqual({
        startTime: "2026-09-17T10:00:00.000Z",
        endTime: "2026-09-17T11:00:00.000Z",
      });
    });
  });

  /*
   * The logs and traces histograms come straight out of ClickHouse, whose
   * DateTime renders as "YYYY-MM-DD hh:mm:ss" with no zone. It is UTC; read
   * as local time the window would land hours away from the bar.
   */
  describe("ClickHouse bucket labels", () => {
    test("are read as UTC", () => {
      expect(
        iso(
          getHistogramSelectionWindow({
            fromBucket: "2026-09-17 10:15:00",
            toBucket: "2026-09-17 10:15:00",
            bucketIntervalMs: MINUTE_MS,
          }),
        ),
      ).toEqual({
        startTime: "2026-09-17T10:15:00.000Z",
        endTime: "2026-09-17T10:16:00.000Z",
      });
    });

    test("with DateTime64 precision are read as UTC too", () => {
      expect(
        iso(
          getHistogramSelectionWindow({
            fromBucket: "2026-09-17 10:15:00.000000000",
            toBucket: "2026-09-17 10:17:00.000000000",
            bucketIntervalMs: MINUTE_MS,
          }),
        ),
      ).toEqual({
        startTime: "2026-09-17T10:15:00.000Z",
        endTime: "2026-09-17T10:18:00.000Z",
      });
    });
  });

  test("selects nothing when a label is not a date", () => {
    // moment warns before it gives up on a non-ISO string; that is expected.
    const warn: jest.SpyInstance = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    expect(
      getHistogramSelectionWindow({
        fromBucket: "not-a-date",
        toBucket: "2026-09-17T10:15:00.000Z",
        bucketIntervalMs: MINUTE_MS,
      }),
    ).toBeNull();

    warn.mockRestore();
  });
});

describe("clampHistogramSelectionToWindowEnd", () => {
  function selection(start: string, end: string): HistogramSelectionWindow {
    return { startTime: new Date(start), endTime: new Date(end) };
  }

  /*
   * The newest bar of a relative window is still filling up: zooming into it
   * whole would open a window that ends in the future.
   */
  test("never runs past the end of the window it zooms out of", () => {
    expect(
      clampHistogramSelectionToWindowEnd(
        selection("2026-09-17T12:30:00.000Z", "2026-09-17T13:00:00.000Z"),
        new Date("2026-09-17T12:52:10.000Z"),
      ).endTime,
    ).toEqual(new Date("2026-09-17T12:52:10.000Z"));
  });

  test("leaves the start alone", () => {
    expect(
      clampHistogramSelectionToWindowEnd(
        selection("2026-09-17T12:30:00.000Z", "2026-09-17T13:00:00.000Z"),
        new Date("2026-09-17T12:52:10.000Z"),
      ).startTime,
    ).toEqual(new Date("2026-09-17T12:30:00.000Z"));
  });

  test("leaves a selection that ends inside the window untouched", () => {
    expect(
      iso(
        clampHistogramSelectionToWindowEnd(
          selection("2026-09-17T12:30:00.000Z", "2026-09-17T12:45:00.000Z"),
          new Date("2026-09-17T12:52:10.000Z"),
        ),
      ),
    ).toEqual({
      startTime: "2026-09-17T12:30:00.000Z",
      endTime: "2026-09-17T12:45:00.000Z",
    });
  });

  /*
   * The chart can still be showing the buckets of a window the reader has
   * since left. Clamping to a window end at or before the selection's start
   * would leave nothing to show, so the selection is kept whole.
   */
  test("ignores a window end that would leave nothing to show", () => {
    expect(
      clampHistogramSelectionToWindowEnd(
        selection("2026-09-17T12:30:00.000Z", "2026-09-17T13:00:00.000Z"),
        new Date("2026-09-17T12:00:00.000Z"),
      ).endTime,
    ).toEqual(new Date("2026-09-17T13:00:00.000Z"));
  });

  test("ignores a window end exactly at the selection's start", () => {
    expect(
      clampHistogramSelectionToWindowEnd(
        selection("2026-09-17T12:30:00.000Z", "2026-09-17T13:00:00.000Z"),
        new Date("2026-09-17T12:30:00.000Z"),
      ).endTime,
    ).toEqual(new Date("2026-09-17T13:00:00.000Z"));
  });

  /*
   * A window restored from the URL or a saved view can arrive with its dates
   * still as ISO strings, whatever the type says.
   */
  test("reads a window end handed over as an ISO string", () => {
    expect(
      clampHistogramSelectionToWindowEnd(
        selection("2026-09-17T12:30:00.000Z", "2026-09-17T13:00:00.000Z"),
        "2026-09-17T12:52:10.000Z" as unknown as Date,
      ).endTime,
    ).toEqual(new Date("2026-09-17T12:52:10.000Z"));
  });

  test("leaves the selection alone when the window end is not a date", () => {
    expect(
      clampHistogramSelectionToWindowEnd(
        selection("2026-09-17T12:30:00.000Z", "2026-09-17T13:00:00.000Z"),
        new Date(Number.NaN),
      ).endTime,
    ).toEqual(new Date("2026-09-17T13:00:00.000Z"));
  });
});
