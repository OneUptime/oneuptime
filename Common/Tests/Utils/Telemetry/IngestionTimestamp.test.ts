import {
  IngestionStamp,
  getIngestionStamp,
  getRetentionDateDb,
} from "../../../Server/Utils/Telemetry/IngestionTimestamp";
import OneUptimeDate from "../../../Types/Date";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Minimal structural view of a jest spy — the @jest/globals and @types/jest
 * spy types disagree in this repo, so annotate with just the surface this
 * test reads.
 */
type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockRestore: () => void;
};

/*
 * Contract under test — the per-second memo behind every ingested row's
 * createdAt / retentionDate stamps.
 *
 * The Otel logs / traces / metrics row builders used to derive these per
 * row (current Date + ClickHouse format + moment add-days + second format,
 * per log record / span / metric datapoint). The memo must hand out values
 * IDENTICAL to that per-row derivation — same second → same strings — and
 * roll over crisply on the second boundary, or rows would carry stale
 * createdAt / retention stamps.
 */

describe("getIngestionStamp", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("db string matches toClickhouseDateTime of the stamp's date", () => {
    jest.setSystemTime(new Date("2026-08-10T13:45:59.700Z"));

    const stamp: IngestionStamp = getIngestionStamp();

    expect(stamp.db).toBe(OneUptimeDate.toClickhouseDateTime(stamp.date));
    expect(stamp.db).toBe("2026-08-10 13:45:59");
  });

  test("date is truncated to the second", () => {
    jest.setSystemTime(new Date("2026-08-10T13:45:59.999Z"));

    const stamp: IngestionStamp = getIngestionStamp();

    expect(stamp.date.getMilliseconds()).toBe(0);
    expect(stamp.date.getTime()).toBe(
      new Date("2026-08-10T13:45:59.000Z").getTime(),
    );
  });

  test("same second returns the identical stamp object (memo hit)", () => {
    jest.setSystemTime(new Date("2026-08-10T13:45:59.100Z"));
    const first: IngestionStamp = getIngestionStamp();

    jest.setSystemTime(new Date("2026-08-10T13:45:59.900Z"));
    const second: IngestionStamp = getIngestionStamp();

    expect(second).toBe(first);
  });

  test("rolls over when the second changes", () => {
    jest.setSystemTime(new Date("2026-08-10T13:45:59.900Z"));
    const first: IngestionStamp = getIngestionStamp();

    jest.setSystemTime(new Date("2026-08-10T13:46:00.000Z"));
    const second: IngestionStamp = getIngestionStamp();

    expect(second).not.toBe(first);
    expect(first.db).toBe("2026-08-10 13:45:59");
    expect(second.db).toBe("2026-08-10 13:46:00");
  });
});

describe("getRetentionDateDb", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-10T13:45:59.700Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("equals the per-row derivation it replaced (addRemoveDays + format)", () => {
    const stamp: IngestionStamp = getIngestionStamp();

    for (const days of [1, 15, 30, 90, 365]) {
      expect(getRetentionDateDb(stamp, days)).toBe(
        OneUptimeDate.toClickhouseDateTime(
          OneUptimeDate.addRemoveDays(stamp.date, days),
        ),
      );
    }
  });

  test("distinct retention windows produce distinct dates", () => {
    const stamp: IngestionStamp = getIngestionStamp();

    expect(getRetentionDateDb(stamp, 15)).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDays(stamp.date, 15),
      ),
    );
    expect(getRetentionDateDb(stamp, 30)).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDays(stamp.date, 30),
      ),
    );
    expect(getRetentionDateDb(stamp, 15)).not.toBe(
      getRetentionDateDb(stamp, 30),
    );
  });

  test("memoizes per retention window: addRemoveDays runs once per (second, days)", () => {
    const stamp: IngestionStamp = getIngestionStamp();
    const addRemoveDaysSpy: SpyLike = jest.spyOn(
      OneUptimeDate,
      "addRemoveDays",
    ) as unknown as SpyLike;

    const first: string = getRetentionDateDb(stamp, 15);
    const callsAfterFirst: number = addRemoveDaysSpy.mock.calls.length;

    for (let i: number = 0; i < 50; i++) {
      expect(getRetentionDateDb(stamp, 15)).toBe(first);
    }

    expect(addRemoveDaysSpy.mock.calls.length).toBe(callsAfterFirst);
    addRemoveDaysSpy.mockRestore();
  });

  test("stays consistent with the stamp's own second, not the current clock", () => {
    const stamp: IngestionStamp = getIngestionStamp();
    const expected: string = getRetentionDateDb(stamp, 15);

    // Clock moves on; a held stamp must keep answering for ITS second.
    jest.setSystemTime(new Date("2026-08-10T13:46:30.000Z"));

    expect(getRetentionDateDb(stamp, 15)).toBe(expected);
  });

  test("computes correctly for a bare stamp that never went through the memo", () => {
    const bareStamp: IngestionStamp = {
      date: new Date("2026-01-01T00:00:00.000Z"),
      db: "2026-01-01 00:00:00",
    };

    expect(getRetentionDateDb(bareStamp, 15)).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDays(bareStamp.date, 15),
      ),
    );
  });
});
