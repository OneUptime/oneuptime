import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import { describe, expect, test } from "@jest/globals";

describe("AggregationIntervalUtil", () => {
  test("keeps dashboard windows below the 1500 point target", () => {
    const startDate: Date = new Date("2026-01-01T00:00:00.000Z");

    expect(
      AggregationIntervalUtil.getAggregationIntervalForWindow({
        startDate,
        endDate: new Date("2026-01-02T00:00:00.000Z"),
      }),
    ).toBe(AggregationInterval.Minute);

    expect(
      AggregationIntervalUtil.getAggregationIntervalForWindow({
        startDate,
        endDate: new Date("2026-03-02T00:00:00.000Z"),
      }),
    ).toBe(AggregationInterval.Hour);

    expect(
      AggregationIntervalUtil.getAggregationIntervalForWindow({
        startDate,
        endDate: new Date("2029-12-31T00:00:00.000Z"),
      }),
    ).toBe(AggregationInterval.Day);

    expect(
      AggregationIntervalUtil.getAggregationIntervalForWindow({
        startDate,
        endDate: new Date("2045-12-26T00:00:00.000Z"),
      }),
    ).toBe(AggregationInterval.Week);

    expect(
      AggregationIntervalUtil.getAggregationIntervalForWindow({
        startDate,
        endDate: new Date("2145-12-01T00:00:00.000Z"),
      }),
    ).toBe(AggregationInterval.Month);

    expect(
      AggregationIntervalUtil.getAggregationIntervalForWindow({
        startDate,
        endDate: new Date("2200-01-01T00:00:00.000Z"),
      }),
    ).toBe(AggregationInterval.Year);
  });

  test("returns millisecond widths for each interval", () => {
    expect(
      AggregationIntervalUtil.getAggregationIntervalMs(
        AggregationInterval.Minute,
      ),
    ).toBe(1000 * 60);
    expect(
      AggregationIntervalUtil.getAggregationIntervalMs(
        AggregationInterval.Hour,
      ),
    ).toBe(1000 * 60 * 60);
    expect(
      AggregationIntervalUtil.getAggregationIntervalMs(AggregationInterval.Day),
    ).toBe(1000 * 60 * 60 * 24);
    expect(
      AggregationIntervalUtil.getAggregationIntervalMs(
        AggregationInterval.Week,
      ),
    ).toBe(1000 * 60 * 60 * 24 * 7);
    expect(
      AggregationIntervalUtil.getAggregationIntervalMs(
        AggregationInterval.Month,
      ),
    ).toBe(1000 * 60 * 60 * 24 * 30);
    expect(
      AggregationIntervalUtil.getAggregationIntervalMs(
        AggregationInterval.Year,
      ),
    ).toBe(1000 * 60 * 60 * 24 * 365);
  });
});
