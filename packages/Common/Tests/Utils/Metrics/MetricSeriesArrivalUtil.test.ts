import MetricSeriesArrivalUtil, {
  MetricSeriesArrivalAggregates,
} from "../../../Utils/Metrics/MetricSeriesArrivalUtil";
import MetricSeriesArrival from "../../../Types/Monitor/MetricMonitor/MetricSeriesArrival";
import { describe, expect, test } from "@jest/globals";

/*
 * WHEN A SERIES' DATA ARRIVED, FROM WHAT ITS ROWS SAY.
 *
 * A metric row carries the time its source measured and the second
 * OneUptime wrote it (createdAt). The worker reads, per series, the newest
 * and oldest createdAt, how many distinct minutes something arrived in, and
 * when its newest data point arrived and what time it carries; these tests
 * pin what that becomes: how long nothing has arrived (staleness), how late
 * the data arrives (lag), and how often it arrives - and how a formula
 * combines the arrivals of the queries it reads. Every time is fixed.
 */

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

// When the worker read the arrivals.
const READ_AT: number = Date.UTC(2026, 10, 4, 12, 0, 0);

function aggregates(
  overrides: Partial<MetricSeriesArrivalAggregates> = {},
): MetricSeriesArrivalAggregates {
  return {
    newestArrivalMs: READ_AT - 20 * SECOND,
    oldestArrivalMs: READ_AT - 15 * MINUTE,
    arrivalMinuteCount: 15,
    newestPointArrivalMs: READ_AT - 20 * SECOND,
    newestPointTimeMs: READ_AT - 50 * SECOND,
    ...overrides,
  };
}

function arrivalOf(
  overrides: Partial<MetricSeriesArrivalAggregates> = {},
): MetricSeriesArrival | null {
  return MetricSeriesArrivalUtil.fromAggregates({
    readAtMs: READ_AT,
    aggregates: aggregates(overrides),
  });
}

describe("MetricSeriesArrivalUtil.fromAggregates", () => {
  test("a collector that sends what it reads as it reads it: fresh, half a minute late, arriving every minute", () => {
    expect(arrivalOf()).toEqual({
      sinceNewestArrivalMs: 20 * SECOND,
      lagMs: 30 * SECOND,
      arrivalIntervalMs: (15 * MINUTE - 20 * SECOND) / 14,
    });
  });

  test("staleness counts from the newest arrival to the read", () => {
    expect(
      arrivalOf({
        newestArrivalMs: READ_AT - 9 * MINUTE,
        newestPointArrivalMs: READ_AT - 9 * MINUTE,
      })!.sinceNewestArrivalMs,
    ).toBe(9 * MINUTE);
  });

  test("a row written after the read started counts as just arrived, never as arrived in the future", () => {
    expect(
      arrivalOf({
        newestArrivalMs: READ_AT + 2 * SECOND,
        newestPointArrivalMs: READ_AT + 2 * SECOND,
      })!.sinceNewestArrivalMs,
    ).toBe(0);
  });

  test("the lag is the newest data point's createdAt minus its own time", () => {
    // CloudWatch's receiver: a period ten minutes old, written now.
    expect(
      arrivalOf({
        newestPointArrivalMs: READ_AT - 5 * SECOND,
        newestPointTimeMs: READ_AT - 11 * MINUTE,
      })!.lagMs,
    ).toBe(11 * MINUTE - 5 * SECOND);

    // A collector whose clock runs three minutes behind.
    expect(
      arrivalOf({
        newestPointArrivalMs: READ_AT - 30 * SECOND,
        newestPointTimeMs: READ_AT - 3 * MINUTE - 30 * SECOND,
      })!.lagMs,
    ).toBe(3 * MINUTE);
  });

  test("a data point stamped by a clock that runs ahead - or within the second it arrived - is not late", () => {
    expect(
      arrivalOf({
        newestPointArrivalMs: READ_AT - 30 * SECOND,
        newestPointTimeMs: READ_AT - 29 * SECOND,
      })!.lagMs,
    ).toBe(0);
    expect(
      arrivalOf({
        newestPointArrivalMs: READ_AT - 30 * SECOND,
        newestPointTimeMs: READ_AT + 4 * MINUTE,
      })!.lagMs,
    ).toBe(0);
  });

  test("a source that delivers five minutes of data at once arrives every five minutes, however often its points are", () => {
    // Six deliveries over 25 minutes: 12:35, 12:40, ... 13:00.
    expect(
      arrivalOf({
        newestArrivalMs: READ_AT - 2 * MINUTE,
        oldestArrivalMs: READ_AT - 27 * MINUTE,
        arrivalMinuteCount: 6,
      })!.arrivalIntervalMs,
    ).toBe(5 * MINUTE);
  });

  test("everything arrived within one minute: how often is unknown", () => {
    expect(arrivalOf({ arrivalMinuteCount: 1 })!.arrivalIntervalMs).toBeNull();
    expect(
      arrivalOf({
        oldestArrivalMs: READ_AT - 20 * SECOND,
        arrivalMinuteCount: 1,
      })!.arrivalIntervalMs,
    ).toBeNull();
    // One batch written across the turn of a minute: two minutes, seconds apart.
    expect(
      arrivalOf({
        newestArrivalMs: READ_AT - 59 * SECOND,
        oldestArrivalMs: READ_AT - 61 * SECOND,
        arrivalMinuteCount: 2,
      })!.arrivalIntervalMs,
    ).toBeNull();
  });

  test("an oldest arrival after the newest, or none, is read as the newest", () => {
    expect(
      arrivalOf({
        oldestArrivalMs: READ_AT,
        arrivalMinuteCount: 3,
      })!.arrivalIntervalMs,
    ).toBeNull();
    expect(
      arrivalOf({ oldestArrivalMs: Number.NaN })!.arrivalIntervalMs,
    ).toBeNull();
  });

  test("a minute count that is not a number says nothing of how often", () => {
    expect(
      arrivalOf({ arrivalMinuteCount: Number.NaN })!.arrivalIntervalMs,
    ).toBeNull();
  });

  test("without a newest arrival, or a time to read it at, there is no arrival", () => {
    expect(arrivalOf({ newestArrivalMs: Number.NaN })).toBeNull();
    expect(arrivalOf({ newestArrivalMs: 0 })).toBeNull();
    expect(
      MetricSeriesArrivalUtil.fromAggregates({
        readAtMs: Number.NaN,
        aggregates: aggregates(),
      }),
    ).toBeNull();
  });

  test("a newest data point without a time is not late", () => {
    expect(arrivalOf({ newestPointTimeMs: Number.NaN })!.lagMs).toBe(0);
    expect(arrivalOf({ newestPointArrivalMs: 0 })!.lagMs).toBe(0);
  });
});

describe("MetricSeriesArrivalUtil.combine: a formula's arrival from its queries'", () => {
  const fresh: MetricSeriesArrival = {
    sinceNewestArrivalMs: 20 * SECOND,
    lagMs: 30 * SECOND,
    arrivalIntervalMs: MINUTE,
  };
  const late: MetricSeriesArrival = {
    sinceNewestArrivalMs: 40 * SECOND,
    lagMs: 11 * MINUTE,
    arrivalIntervalMs: 5 * MINUTE,
  };
  const stopped: MetricSeriesArrival = {
    sinceNewestArrivalMs: 9 * MINUTE,
    lagMs: 10 * SECOND,
    arrivalIntervalMs: null,
  };

  test("only as fresh as the stalest, as late as the latest, as seldom as the slowest", () => {
    expect(MetricSeriesArrivalUtil.combine([fresh, late])).toEqual({
      sinceNewestArrivalMs: 40 * SECOND,
      lagMs: 11 * MINUTE,
      arrivalIntervalMs: 5 * MINUTE,
    });
    expect(MetricSeriesArrivalUtil.combine([late, stopped])).toEqual({
      sinceNewestArrivalMs: 9 * MINUTE,
      lagMs: 11 * MINUTE,
      arrivalIntervalMs: 5 * MINUTE,
    });
  });

  test("a query whose arrivals were not read is left out", () => {
    expect(MetricSeriesArrivalUtil.combine([null, stopped, undefined])).toEqual(
      stopped,
    );
  });

  test("nothing read: no arrival", () => {
    expect(MetricSeriesArrivalUtil.combine([])).toBeNull();
    expect(MetricSeriesArrivalUtil.combine([null, undefined])).toBeNull();
  });

  test("it never changes the arrivals it reads", () => {
    const copy: MetricSeriesArrival = { ...fresh };
    const combined: MetricSeriesArrival | null =
      MetricSeriesArrivalUtil.combine([fresh]);

    expect(combined).toEqual(fresh);
    expect(combined).not.toBe(fresh);
    MetricSeriesArrivalUtil.combine([fresh, late, stopped]);
    expect(fresh).toEqual(copy);
  });
});
