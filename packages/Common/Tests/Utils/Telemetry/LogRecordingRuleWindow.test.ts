import LogRecordingRuleWindowUtil, {
  LOG_RECORDING_RULE_BUCKET_SIZE_IN_MINUTES,
  LOG_RECORDING_RULE_EVALUATION_LAG_IN_SECONDS,
  LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES,
  LOG_RECORDING_RULE_MAX_MINUTES_PER_RUN,
  LogRecordingRuleWindow,
} from "../../../Utils/Telemetry/LogRecordingRuleWindow";
import { describe, expect, test } from "@jest/globals";

/*
 * Which minutes a log recording rule computes on a run. The metric and
 * trace recording rule workers compute "the minute that ended 30 seconds
 * ago" and nothing else, so a run that does not happen is a gap for good;
 * a log recording rule resumes from the end of the last minute it wrote
 * (its watermark), catching up on what it missed - within a bound - and
 * never computing a minute twice.
 */

const MINUTE: number = 60 * 1000;

const at: (iso: string) => Date = (iso: string): Date => {
  return new Date(iso);
};

const windowOf: (
  now: string,
  computedUntil?: string | null,
) => LogRecordingRuleWindow | null = (
  now: string,
  computedUntil?: string | null,
): LogRecordingRuleWindow | null => {
  return LogRecordingRuleWindowUtil.getWindow({
    now: at(now),
    computedUntil:
      computedUntil === undefined || computedUntil === null
        ? computedUntil
        : at(computedUntil),
  });
};

describe("the cadence it shares with the other recording rule workers", () => {
  test("1-minute buckets, computed 30 seconds after they end, every minute", () => {
    expect(LOG_RECORDING_RULE_BUCKET_SIZE_IN_MINUTES).toBe(1);
    expect(LOG_RECORDING_RULE_EVALUATION_LAG_IN_SECONDS).toBe(30);
  });

  test("the catch-up is bounded, and spread over runs", () => {
    expect(LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES).toBe(60);
    expect(LOG_RECORDING_RULE_MAX_MINUTES_PER_RUN).toBeGreaterThan(1);
    expect(LOG_RECORDING_RULE_MAX_MINUTES_PER_RUN).toBeLessThan(
      LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES,
    );
  });
});

describe("LogRecordingRuleWindowUtil.getNewestBucketEnd", () => {
  test.each([
    ["2026-10-07T10:05:20.000Z", "2026-10-07T10:04:00.000Z"],
    ["2026-10-07T10:05:30.000Z", "2026-10-07T10:05:00.000Z"],
    ["2026-10-07T10:05:40.123Z", "2026-10-07T10:05:00.000Z"],
    ["2026-10-07T10:06:29.999Z", "2026-10-07T10:05:00.000Z"],
    ["2026-10-07T00:00:10.000Z", "2026-10-06T23:59:00.000Z"],
  ])(
    "at %s the newest elapsed minute ends at %s",
    (now: string, end: string) => {
      expect(
        LogRecordingRuleWindowUtil.getNewestBucketEnd(at(now)).toISOString(),
      ).toBe(end);
    },
  );
});

describe("LogRecordingRuleWindowUtil.getWindow", () => {
  test("a rule that never ran computes the newest elapsed minute only, as the other workers do", () => {
    for (const computedUntil of [null, undefined]) {
      const window: LogRecordingRuleWindow | null = windowOf(
        "2026-10-07T10:05:40.000Z",
        computedUntil,
      );

      expect(window).toEqual({
        startTime: at("2026-10-07T10:04:00.000Z"),
        endTime: at("2026-10-07T10:05:00.000Z"),
        minutes: 1,
        skippedMinutes: 0,
      });
    }
  });

  test("in the steady state each run computes the one minute since the last", () => {
    expect(
      windowOf("2026-10-07T10:05:40.000Z", "2026-10-07T10:04:00.000Z"),
    ).toEqual({
      startTime: at("2026-10-07T10:04:00.000Z"),
      endTime: at("2026-10-07T10:05:00.000Z"),
      minutes: 1,
      skippedMinutes: 0,
    });
  });

  test("a run in the same minute as the last computes nothing: no minute twice", () => {
    expect(
      windowOf("2026-10-07T10:05:55.000Z", "2026-10-07T10:05:00.000Z"),
    ).toBeNull();
    // Inside the lag the newest minute has not elapsed yet either.
    expect(
      windowOf("2026-10-07T10:06:20.000Z", "2026-10-07T10:05:00.000Z"),
    ).toBeNull();
  });

  test("a watermark ahead of the clock (a skewed worker) computes nothing until time catches up", () => {
    expect(
      windowOf("2026-10-07T10:05:40.000Z", "2026-10-07T10:30:00.000Z"),
    ).toBeNull();
  });

  test("after a few missed runs, the next one computes every missed minute", () => {
    expect(
      windowOf("2026-10-07T10:05:40.000Z", "2026-10-07T09:59:00.000Z"),
    ).toEqual({
      startTime: at("2026-10-07T09:59:00.000Z"),
      endTime: at("2026-10-07T10:05:00.000Z"),
      minutes: 6,
      skippedMinutes: 0,
    });
  });

  test(`a longer catch-up is split into runs of at most ${LOG_RECORDING_RULE_MAX_MINUTES_PER_RUN} minutes`, () => {
    const window: LogRecordingRuleWindow | null = windowOf(
      "2026-10-07T10:05:40.000Z",
      "2026-10-07T09:35:00.000Z",
    );

    expect(window).toEqual({
      startTime: at("2026-10-07T09:35:00.000Z"),
      endTime: new Date(
        at("2026-10-07T09:35:00.000Z").getTime() +
          LOG_RECORDING_RULE_MAX_MINUTES_PER_RUN * MINUTE,
      ),
      minutes: LOG_RECORDING_RULE_MAX_MINUTES_PER_RUN,
      skippedMinutes: 0,
    });
  });

  test("minutes older than the catch-up bound are given up, and counted", () => {
    // Down for three hours: only the last hour is computed.
    const window: LogRecordingRuleWindow | null = windowOf(
      "2026-10-07T10:05:40.000Z",
      "2026-10-07T07:05:00.000Z",
    );

    const newestEnd: Date = at("2026-10-07T10:05:00.000Z");
    const earliest: Date = new Date(
      newestEnd.getTime() - LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES * MINUTE,
    );

    expect(window?.startTime).toEqual(earliest);
    expect(window?.endTime).toEqual(
      new Date(
        earliest.getTime() + LOG_RECORDING_RULE_MAX_MINUTES_PER_RUN * MINUTE,
      ),
    );
    expect(window?.skippedMinutes).toBe(
      180 - LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES,
    );
  });

  test("a watermark exactly at the bound loses nothing", () => {
    const window: LogRecordingRuleWindow | null = windowOf(
      "2026-10-07T10:05:40.000Z",
      "2026-10-07T09:05:00.000Z",
    );

    expect(window?.startTime).toEqual(at("2026-10-07T09:05:00.000Z"));
    expect(window?.skippedMinutes).toBe(0);
  });

  test("a watermark off the minute boundary rounds up, never reopening a written minute", () => {
    expect(
      windowOf("2026-10-07T10:05:40.000Z", "2026-10-07T10:02:30.000Z"),
    ).toEqual({
      startTime: at("2026-10-07T10:03:00.000Z"),
      endTime: at("2026-10-07T10:05:00.000Z"),
      minutes: 2,
      skippedMinutes: 0,
    });
  });

  test("an unreadable watermark counts as never run", () => {
    expect(
      LogRecordingRuleWindowUtil.getWindow({
        now: at("2026-10-07T10:05:40.000Z"),
        computedUntil: new Date("not a date"),
      }),
    ).toEqual({
      startTime: at("2026-10-07T10:04:00.000Z"),
      endTime: at("2026-10-07T10:05:00.000Z"),
      minutes: 1,
      skippedMinutes: 0,
    });
  });

  test("run after run, catching up covers every minute exactly once and then settles", () => {
    let computedUntil: Date | null = at("2026-10-07T09:20:00.000Z");
    let now: Date = at("2026-10-07T10:05:40.000Z");
    const covered: Array<number> = [];

    for (let run: number = 0; run < 12; run++) {
      const window: LogRecordingRuleWindow | null =
        LogRecordingRuleWindowUtil.getWindow({ now, computedUntil });

      if (window) {
        for (
          let time: number = window.startTime.getTime();
          time < window.endTime.getTime();
          time += MINUTE
        ) {
          covered.push(time);
        }

        computedUntil = window.endTime;
      }

      now = new Date(now.getTime() + MINUTE);
    }

    // Every minute from the watermark to the newest elapsed one, once each.
    const first: number = at("2026-10-07T09:20:00.000Z").getTime();
    const last: number = LogRecordingRuleWindowUtil.getNewestBucketEnd(
      new Date(now.getTime() - MINUTE),
    ).getTime();

    expect(covered).toEqual(
      Array.from(
        { length: (last - first) / MINUTE },
        (_value: unknown, index: number): number => {
          return first + index * MINUTE;
        },
      ),
    );
    expect(new Set(covered).size).toBe(covered.length);
    expect(computedUntil?.getTime()).toBe(last);
  });
});

describe("LogRecordingRuleWindowUtil.getBucketStarts", () => {
  test("lists the start of every minute in the window, oldest first", () => {
    expect(
      LogRecordingRuleWindowUtil.getBucketStarts({
        startTime: at("2026-10-07T10:00:00.000Z"),
        endTime: at("2026-10-07T10:03:00.000Z"),
        minutes: 3,
        skippedMinutes: 0,
      }).map((start: Date): string => {
        return start.toISOString();
      }),
    ).toEqual([
      "2026-10-07T10:00:00.000Z",
      "2026-10-07T10:01:00.000Z",
      "2026-10-07T10:02:00.000Z",
    ]);
  });
});
