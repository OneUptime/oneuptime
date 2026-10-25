/** @timezone Europe/London */

import InBetween from "../../../Types/BaseDatabase/InBetween";
import { RangeStartAndEndDateTimeUtil } from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  describeClockChanges,
  freezeNowAt,
} from "./RangeStartAndEndDateTimeClockChangeCases";

/*
 * The time ranges on the London wall clock (see
 * RangeStartAndEndDateTimeClockChangeCases), where the clocks change at
 * 01:00 UTC on the last Sunday of March and of October.
 */

describeClockChanges("Europe/London", [
  // Back an hour: the moment the KubernetesEvents suite failed.
  { now: "2026-10-25T03:49:00.000Z", calendarDayHours: 25 },
  // Forward an hour.
  { now: "2027-03-28T03:00:00.000Z", calendarDayHours: 23 },
]);

describe("the month ranges in Europe/London", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Past 1 Month stays a calendar month: the same time of day a month back", () => {
    freezeNowAt("2026-10-25T03:49:00.000Z");

    const between: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate({
        range: TimeRange.PAST_ONE_MONTH,
      });

    // 03:49 GMT on 25 October back to 03:49 BST on 25 September.
    expect(between.startValue.toISOString()).toBe("2026-09-25T02:49:00.000Z");
  });
});
