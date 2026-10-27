/** @timezone Europe/London */

import { describe, expect, test } from "@jest/globals";

import SeriesPoints from "../../../../UI/Components/Charts/Types/SeriesPoints";
import XAxisPrecision from "../../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisUtil from "../../../../UI/Components/Charts/Utils/XAxis";

/*
 * The trailing-bucket trim of ChartTrailingBucketGap.test.ts on the days the
 * clocks change, in a zone that has them. This file runs in Europe/London
 * through the docblock above (Tests/Utils/TimezoneEnvironment.js): a test
 * that assigns process.env.TZ at run time never changes the zone, because
 * Jest's process.env is a copy, so it would run in UTC, where every day is
 * 24 hours and these cases prove nothing.
 *
 * In London 2026, 29 March is 23 hours long (01:00 GMT becomes 02:00 BST)
 * and 25 October is 25 hours long (02:00 BST becomes 01:00 GMT). An empty
 * last slot stays on the axis when the window covers at least half of its
 * bucket, and these windows end just either side of half of the clock-change
 * day, or of the day after it: only the bucket's real length puts each one
 * on the right side.
 */

const HOUR_IN_MS: number = 60 * 60 * 1000;

type TrailingSlotFunction = (window: { start: string; end: string }) => {
  intervals: Array<Date>;
  renderable: Array<Date>;
};

// The day grid of a window with one reading at its start, and what renders.
const trailingSlot: TrailingSlotFunction = (window: {
  start: string;
  end: string;
}): { intervals: Array<Date>; renderable: Array<Date> } => {
  const start: Date = new Date(window.start);
  const end: Date = new Date(window.end);
  const seriesPoints: Array<SeriesPoints> = [
    {
      seriesName: "resource.host.name=web-1",
      data: [{ x: start, y: 1 }],
    },
  ];

  return {
    intervals: XAxisUtil.getPrecisionIntervals({
      xAxisMin: start,
      xAxisMax: end,
      precision: XAxisPrecision.EVERY_DAY,
    }),
    renderable: XAxisUtil.getRenderableIntervals({
      xAxisMin: start,
      xAxisMax: end,
      precision: XAxisPrecision.EVERY_DAY,
      seriesPoints: seriesPoints,
    }),
  };
};

describe("the zone this file runs in", () => {
  test("is Europe/London, with its two clock changes of 2026", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "Europe/London",
    );
    // GMT in January, BST in July.
    expect(new Date("2026-01-15T12:00:00.000Z").getTimezoneOffset()).toBe(0);
    expect(new Date("2026-07-15T12:00:00.000Z").getTimezoneOffset()).toBe(-60);

    // A day's step of the grid from local midnight to local midnight.
    const springForward: Date = new Date("2026-03-29T00:00:00.000Z");
    const fallBack: Date = new Date("2026-10-24T23:00:00.000Z");
    expect(
      XAxisUtil.getNextInterval(
        springForward,
        XAxisPrecision.EVERY_DAY,
      ).getTime() - springForward.getTime(),
    ).toBe(23 * HOUR_IN_MS);
    expect(
      XAxisUtil.getNextInterval(fallBack, XAxisPrecision.EVERY_DAY).getTime() -
        fallBack.getTime(),
    ).toBe(25 * HOUR_IN_MS);
  });
});

describe("an empty trailing day bucket is measured by its own length", () => {
  test("the spring-forward day is 23 hours: 11 h 45 min of it is over half, so its slot stays", () => {
    // 11.75 / 23 = 0.51; measured as 24 hours it would be 0.49 and dropped.
    const { intervals, renderable } = trailingSlot({
      start: "2026-03-25T00:00:00.000Z",
      end: "2026-03-29T11:45:00.000Z",
    });

    expect(intervals[intervals.length - 1]!.toISOString()).toBe(
      "2026-03-29T00:00:00.000Z",
    );
    expect(renderable).toHaveLength(intervals.length);
  });

  test("the day after the spring-forward day is 24 hours again: 11 h 45 min of it is under half, so its slot goes", () => {
    /*
     * 11.75 / 24 = 0.49. The grid's step before this slot is the 23-hour
     * day, so a width read off the previous step would make it 0.51 and
     * keep an empty slot the window barely reaches.
     */
    const { intervals, renderable } = trailingSlot({
      start: "2026-03-26T00:00:00.000Z",
      end: "2026-03-30T10:45:00.000Z",
    });

    // Local midnight of 30 March is 23:00 UTC on the 29th, in BST.
    expect(intervals[intervals.length - 1]!.toISOString()).toBe(
      "2026-03-29T23:00:00.000Z",
    );
    expect(renderable).toHaveLength(intervals.length - 1);
    expect(renderable[renderable.length - 1]!.toISOString()).toBe(
      "2026-03-29T00:00:00.000Z",
    );
  });

  test("the fall-back day is 25 hours: 12 h 15 min of it is under half, so its slot goes", () => {
    // 12.25 / 25 = 0.49; measured as 24 hours it would be 0.51 and kept.
    const { intervals, renderable } = trailingSlot({
      start: "2026-10-21T23:00:00.000Z",
      end: "2026-10-25T11:15:00.000Z",
    });

    // Local midnight of 25 October is 23:00 UTC on the 24th, in BST.
    expect(intervals[intervals.length - 1]!.toISOString()).toBe(
      "2026-10-24T23:00:00.000Z",
    );
    expect(renderable).toHaveLength(intervals.length - 1);
  });

  test("the fall-back day is 25 hours: 12 h 45 min of it is over half, so its slot stays", () => {
    // 12.75 / 25 = 0.51.
    const { intervals, renderable } = trailingSlot({
      start: "2026-10-21T23:00:00.000Z",
      end: "2026-10-25T11:45:00.000Z",
    });

    expect(renderable).toHaveLength(intervals.length);
  });

  test("a trailing bucket that holds a reading stays whatever its length", () => {
    const start: Date = new Date("2026-03-25T00:00:00.000Z");
    const end: Date = new Date("2026-03-29T02:00:00.000Z");
    const intervals: Array<Date> = XAxisUtil.getPrecisionIntervals({
      xAxisMin: start,
      xAxisMax: end,
      precision: XAxisPrecision.EVERY_DAY,
    });
    const renderable: Array<Date> = XAxisUtil.getRenderableIntervals({
      xAxisMin: start,
      xAxisMax: end,
      precision: XAxisPrecision.EVERY_DAY,
      seriesPoints: [
        {
          seriesName: "resource.host.name=web-1",
          data: [
            { x: start, y: 1 },
            { x: new Date("2026-03-29T01:30:00.000Z"), y: 2 },
          ],
        },
      ],
    });

    // Two hours of a 23-hour day, but the bucket holds a reading.
    expect(renderable).toHaveLength(intervals.length);
  });
});
