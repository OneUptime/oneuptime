/**
 * @timezone Europe/London
 */

import DayUptimeGraphUtil, {
  UptimeGraphDay,
} from "../../../Utils/Uptime/DayUptimeGraphUtil";
import OneUptimeDate from "../../../Types/Date";
import {
  describeDayUptimeGraphUtilInProcessTimezone,
  expectSameDays,
  getDaysTheOldWay,
  getUtcServerBucketStarts,
  pairBarsWithBucketsLikeDayUptimeGraph,
} from "./DayUptimeGraphUtilTimezoneCases";
import { describe, expect, test } from "@jest/globals";

/*
 * The zone that is UTC half the year. In winter (GMT) a London visitor's
 * days ARE UTC days, so the pre-fix strip happened to pair every bar with the
 * right reading; in summer (BST, UTC+1) a UTC day starts at 01:00 local and
 * today's bar had no reading for the first hour of every local day. The
 * "(UTC)" marker has to follow the same seasons.
 *
 * The regression cases (in DayUptimeGraphUtilTimezoneCases) fail on the
 * pre-fix strip: at 00:30 BST the local "Sep 23" bar had no reading.
 */
describeDayUptimeGraphUtilInProcessTimezone({
  processTimezone: "Europe/London",
  timezoneOffsets: [
    { instant: "2026-01-15T12:00:00.000Z", getTimezoneOffset: 0 },
    { instant: "2026-07-15T12:00:00.000Z", getTimezoneOffset: -60 },
  ],
  localDateDiffers: [
    {
      instant: "2026-09-22T23:30:00.000Z",
      localDayLabel: "Sep 23, 2026",
      utcDayLabel: "Sep 22, 2026",
    },
    // 00:30 BST on the fall-back date (a 25 hour local day).
    {
      instant: "2026-10-24T23:30:00.000Z",
      localDayLabel: "Oct 25, 2026",
      utcDayLabel: "Oct 24, 2026",
    },
  ],
  utcBarLabels: [
    // BST: an hour off UTC, so marked.
    { date: "2026-09-23T00:00:00.000Z", expectedLabel: "Sep 23, 2026 (UTC)" },
    // GMT: the same offset as UTC, so the dates agree and no marker.
    { date: "2026-01-15T00:00:00.000Z", expectedLabel: "Jan 15, 2026" },
    /*
     * The marker is decided by the offset AT THE BAR'S DATE, not today's.
     * Clocks go forward at 01:00Z on Mar 29 and back at 01:00Z on Oct 25, so
     * the UTC midnight that starts each of those days is still on the old
     * offset.
     */
    { date: "2026-03-29T00:00:00.000Z", expectedLabel: "Mar 29, 2026" },
    { date: "2026-03-30T00:00:00.000Z", expectedLabel: "Mar 30, 2026 (UTC)" },
    { date: "2026-10-25T00:00:00.000Z", expectedLabel: "Oct 25, 2026 (UTC)" },
    { date: "2026-10-26T00:00:00.000Z", expectedLabel: "Oct 26, 2026" },
  ],
});

describe("DayUptimeGraphUtil in a London winter", () => {
  /*
   * Why nobody in London saw the mismatch from November to March: with the
   * whole window on GMT, the viewer's local strip and the UTC strip are the
   * same instants, bar for bar. This also pins that the zone path and the
   * no-zone path agree wherever they should.
   */
  test("a window wholly on GMT draws the same bars with or without the UTC zone", () => {
    const endDate: Date = new Date("2026-01-20T15:00:00.000Z");
    const startDate: Date = OneUptimeDate.getSomeDaysAgoFromDate(endDate, 60);

    const utcDays: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
      startDate: startDate,
      endDate: endDate,
      timezone: "UTC",
    });

    /*
     * Starts are UTC midnights either way; the no-zone path labels each bar
     * by the instant it stepped to rather than by its midnight, so compare
     * the spans.
     */
    const localDays: Array<UptimeGraphDay> = getDaysTheOldWay(
      startDate,
      endDate,
    );

    expect(utcDays).toHaveLength(61);
    expectSameDays(
      utcDays.map((day: UptimeGraphDay) => {
        return { ...day, date: day.startOfDay };
      }),
      localDays.map((day: UptimeGraphDay) => {
        return { ...day, date: day.startOfDay };
      }),
    );

    const bucketStarts: Array<Date> = getUtcServerBucketStarts(
      startDate,
      endDate,
    );

    expect(
      pairBarsWithBucketsLikeDayUptimeGraph(localDays, bucketStarts),
    ).toEqual(bucketStarts);
  });

  /*
   * The same window in summer: the local strip's last bar - today, at 00:30
   * BST - has no reading, while the UTC strip's has today's.
   */
  test("the same comparison in summer shows the local strip losing today's reading", () => {
    const endDate: Date = new Date("2026-07-20T23:30:00.000Z");
    const startDate: Date = OneUptimeDate.getSomeDaysAgoFromDate(endDate, 60);

    const bucketStarts: Array<Date> = getUtcServerBucketStarts(
      startDate,
      endDate,
    );

    const localPairs: Array<Date | undefined> =
      pairBarsWithBucketsLikeDayUptimeGraph(
        getDaysTheOldWay(startDate, endDate),
        bucketStarts,
      );

    expect(localPairs[localPairs.length - 1]).toBeUndefined();

    const utcPairs: Array<Date | undefined> =
      pairBarsWithBucketsLikeDayUptimeGraph(
        DayUptimeGraphUtil.getDays({
          startDate: startDate,
          endDate: endDate,
          timezone: "UTC",
        }),
        bucketStarts,
      );

    expect(utcPairs[utcPairs.length - 1]?.toISOString()).toBe(
      "2026-07-20T00:00:00.000Z",
    );
  });
});
