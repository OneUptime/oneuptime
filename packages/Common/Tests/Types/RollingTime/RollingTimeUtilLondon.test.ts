/** @timezone Europe/London */

import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";
import { describe, expect, test } from "@jest/globals";
import { describeClockChanges } from "./RollingTimeUtilClockChangeCases";

/*
 * The rolling times on the London wall clock (see
 * RollingTimeUtilClockChangeCases), where the clocks change at 01:00 UTC on
 * the last Sunday of March and of October.
 */

describeClockChanges("Europe/London", [
  // Back an hour: every day range's window spans it.
  { now: "2026-10-25T03:49:00.000Z", days: 1, calendarHours: 25 },
  // The moment the Metrics monitor docs suite failed.
  { now: "2026-10-27T18:20:00.000Z", days: 3, calendarHours: 73 },
  // Forward an hour.
  { now: "2027-03-28T03:00:00.000Z", days: 1, calendarHours: 23 },
]);

describe("Past 3 Days in Europe/London after the clocks went back", () => {
  test("is bucketed every 30 minutes, as the Metrics monitor docs say", () => {
    const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
      RollingTime.Past3Days,
      new Date("2026-10-27T18:20:00.000Z"),
    );

    expect(
      AggregationIntervalUtil.getAggregationIntervalForWindow({
        startDate: window.startValue,
        endDate: window.endValue,
      }),
    ).toBe(AggregationInterval.ThirtyMinutes);
  });
});
