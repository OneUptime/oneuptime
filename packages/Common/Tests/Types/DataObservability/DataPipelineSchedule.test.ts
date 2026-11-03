import { describe, expect, test } from "@jest/globals";
import {
  DataPipelineTimeliness,
  getDataPipelineLateness,
  getDurationRatio,
  getExpectedIntervalInSeconds,
  getTypicalDurationInSeconds,
  isUnusuallyLong,
  MAX_LATENESS_WATCH_IN_SECONDS,
  MIN_PIPELINE_LATENESS_SLACK_IN_SECONDS,
  MIN_RUNS_TO_LEARN,
  RUNS_FOR_EXPECTED_INTERVAL,
  RUNS_FOR_TYPICAL_DURATION,
} from "../../../Types/DataObservability/DataPipelineSchedule";

/*
 * A pipeline's typical run and schedule are learned from its own runs, so
 * a job that runs every five minutes and one that runs nightly are judged
 * each by its own rhythm.
 */

const HOUR: number = 60 * 60;
const DAY: number = 24 * HOUR;
const NOW: Date = new Date("2026-11-03T12:00:00.000Z");

function startsEvery(seconds: Array<number>, from: Date = NOW): Array<Date> {
  // The latest start first, each gap before the one after it.
  const starts: Array<Date> = [from];
  let time: number = from.getTime();

  for (const gap of seconds) {
    time -= gap * 1000;
    starts.push(new Date(time));
  }

  return starts;
}

describe("getTypicalDurationInSeconds", () => {
  test("is the median of the latest completed runs", () => {
    expect(getTypicalDurationInSeconds([600, 620, 580, 3000, 610])).toBe(610);
    expect(getTypicalDurationInSeconds([10, 20, 30, 40, 50, 60])).toBe(35);
  });

  test("is not known before five completed runs", () => {
    expect(
      getTypicalDurationInSeconds(new Array(MIN_RUNS_TO_LEARN - 1).fill(60)),
    ).toBe(null);
    expect(
      getTypicalDurationInSeconds(new Array(MIN_RUNS_TO_LEARN).fill(60)),
    ).toBe(60);
  });

  test("reads only the latest twenty, and no impossible duration", () => {
    const latest: Array<number> = new Array(RUNS_FOR_TYPICAL_DURATION).fill(
      100,
    );

    expect(
      getTypicalDurationInSeconds([...latest, 9000, 9000, 9000, 9000, 9000]),
    ).toBe(100);
    expect(
      getTypicalDurationInSeconds([100, 100, -5, NaN, 100, 100, 100]),
    ).toBe(100);
  });
});

describe("getExpectedIntervalInSeconds", () => {
  test("an hourly job runs every hour", () => {
    expect(
      getExpectedIntervalInSeconds(
        startsEvery([HOUR, HOUR + 30, HOUR - 20, HOUR, HOUR]),
      ),
    ).toBe(HOUR);
  });

  test("a job at 9:00 and 17:00 goes sixteen hours without a run", () => {
    expect(
      getExpectedIntervalInSeconds(
        startsEvery([8 * HOUR, 16 * HOUR, 8 * HOUR, 16 * HOUR, 8 * HOUR]),
      ),
    ).toBe(16 * HOUR);
  });

  test("one pause, or a backfill long past, does not stretch it", () => {
    expect(
      getExpectedIntervalInSeconds(
        startsEvery([DAY, DAY, 9 * DAY, DAY, DAY, DAY]),
      ),
    ).toBe(DAY);
    expect(
      getExpectedIntervalInSeconds(
        startsEvery([DAY, DAY, 400 * DAY, DAY, DAY, DAY]),
      ),
    ).toBe(DAY);
  });

  test("a weekday job learns its weekend once it has seen two", () => {
    const weeks: Array<number> = [];

    for (let week: number = 0; week < 3; week++) {
      weeks.push(3 * DAY, DAY, DAY, DAY, DAY);
    }

    expect(getExpectedIntervalInSeconds(startsEvery(weeks))).toBe(3 * DAY);
  });

  test("starts in any order are the same schedule", () => {
    const starts: Array<Date> = startsEvery([HOUR, HOUR, HOUR, HOUR, HOUR]);

    expect(getExpectedIntervalInSeconds([...starts].reverse())).toBe(HOUR);
  });

  test("is not known before five starts, or from runs that all started together", () => {
    expect(getExpectedIntervalInSeconds(startsEvery([HOUR, HOUR, HOUR]))).toBe(
      null,
    );
    expect(getExpectedIntervalInSeconds(startsEvery([0, 0, 0, 0, 0]))).toBe(
      null,
    );
  });

  test("reads only the latest fifty starts", () => {
    const gaps: Array<number> = new Array(RUNS_FOR_EXPECTED_INTERVAL - 1).fill(
      HOUR,
    );

    // Two long gaps older than the latest fifty starts are never read.
    expect(
      getExpectedIntervalInSeconds(startsEvery([...gaps, 5 * DAY, 5 * DAY])),
    ).toBe(HOUR);
  });
});

describe("getDurationRatio", () => {
  test("is the run's time over the typical run's", () => {
    expect(
      getDurationRatio({
        durationInSeconds: 1200,
        typicalDurationInSeconds: 600,
      }),
    ).toBe(2);
    expect(
      getDurationRatio({
        durationInSeconds: 900,
        typicalDurationInSeconds: 600,
      }),
    ).toBe(1.5);
  });

  test("a job of seconds is counted as taking at least a minute", () => {
    // 10 seconds against a typical 3: not slow - 10 / 60.
    expect(
      getDurationRatio({ durationInSeconds: 10, typicalDurationInSeconds: 3 }),
    ).toBe(0.17);
    expect(
      isUnusuallyLong(
        getDurationRatio({
          durationInSeconds: 10,
          typicalDurationInSeconds: 3,
        }),
      ),
    ).toBe(false);
    // Two minutes against a typical 3 seconds is.
    expect(
      isUnusuallyLong(
        getDurationRatio({
          durationInSeconds: 120,
          typicalDurationInSeconds: 3,
        }),
      ),
    ).toBe(true);
  });

  test("is not known without a typical run", () => {
    expect(
      getDurationRatio({
        durationInSeconds: 60,
        typicalDurationInSeconds: null,
      }),
    ).toBe(null);
    expect(isUnusuallyLong(null)).toBe(false);
  });
});

describe("getDataPipelineLateness", () => {
  test("an hourly job is late seventy-five minutes after its last start", () => {
    const lastRunStartedAt: Date = new Date(NOW.getTime() - 74 * 60 * 1000);

    expect(
      getDataPipelineLateness({
        lastRunStartedAt,
        expectedRunIntervalInSeconds: HOUR,
        now: NOW,
      }),
    ).toEqual({
      timeliness: DataPipelineTimeliness.OnTime,
      lateAt: new Date(lastRunStartedAt.getTime() + 75 * 60 * 1000),
      overdueBySeconds: 0,
    });
    expect(
      getDataPipelineLateness({
        lastRunStartedAt: new Date(NOW.getTime() - 80 * 60 * 1000),
        expectedRunIntervalInSeconds: HOUR,
        now: NOW,
      }),
    ).toMatchObject({
      timeliness: DataPipelineTimeliness.Late,
      overdueBySeconds: 5 * 60,
    });
  });

  test("a nightly job has a quarter of a day of slack", () => {
    expect(
      getDataPipelineLateness({
        lastRunStartedAt: new Date(NOW.getTime() - 29 * HOUR * 1000),
        expectedRunIntervalInSeconds: DAY,
        now: NOW,
      }).timeliness,
    ).toBe(DataPipelineTimeliness.OnTime);
    expect(
      getDataPipelineLateness({
        lastRunStartedAt: new Date(NOW.getTime() - 31 * HOUR * 1000),
        expectedRunIntervalInSeconds: DAY,
        now: NOW,
      }),
    ).toMatchObject({
      timeliness: DataPipelineTimeliness.Late,
      overdueBySeconds: HOUR,
    });
  });

  test("a job every five minutes has at least fifteen minutes of slack", () => {
    const lastRunStartedAt: Date = new Date(NOW.getTime() - 19 * 60 * 1000);

    expect(
      getDataPipelineLateness({
        lastRunStartedAt,
        expectedRunIntervalInSeconds: 5 * 60,
        now: NOW,
      }).lateAt,
    ).toEqual(
      new Date(
        lastRunStartedAt.getTime() +
          (5 * 60 + MIN_PIPELINE_LATENESS_SLACK_IN_SECONDS) * 1000,
      ),
    );
  });

  test("without a learned schedule, or after thirty days without a run, it cannot be said", () => {
    expect(
      getDataPipelineLateness({
        lastRunStartedAt: NOW,
        expectedRunIntervalInSeconds: null,
        now: NOW,
      }),
    ).toEqual({
      timeliness: DataPipelineTimeliness.Unknown,
      lateAt: null,
      overdueBySeconds: 0,
    });
    expect(
      getDataPipelineLateness({
        lastRunStartedAt: new Date(
          NOW.getTime() - (MAX_LATENESS_WATCH_IN_SECONDS + 60) * 1000,
        ),
        expectedRunIntervalInSeconds: HOUR,
        now: NOW,
      }).timeliness,
    ).toBe(DataPipelineTimeliness.Unknown);
  });
});
