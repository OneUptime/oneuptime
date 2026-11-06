/*
 * HOW LONG A PIPELINE'S RUNS USUALLY TAKE, AND HOW OFTEN THEY START.
 *
 * Both are learned from the pipeline's own runs, so they fit a job that runs
 * every five minutes as well as one that runs nightly - which a baseline per
 * hour of the week, needing several samples in each hour, never learns for a
 * nightly job.
 *
 *  - TYPICAL DURATION: the median of the last 20 completed runs, once there
 *    are five. A run is unusually long once it takes twice that, the typical
 *    run counted as at least a minute so a job of seconds is not called slow
 *    for a few seconds more. It is judged as the run ends, and every five
 *    minutes while it runs, so a run that hangs is seen before it ends.
 *  - EXPECTED INTERVAL: how long the pipeline goes without a run on its
 *    schedule - the longest gap between the starts of its last 50 runs that
 *    is not a one-off (the second longest), once there are five. So one that
 *    runs at 9:00 and 17:00 is not called late overnight, and a pause, or a
 *    backfill of a month long past, does not stretch it. A run's scheduled
 *    time (OpenLineage's nominalTime facet) stands for its start when the
 *    producer sends it, so a backfill's burst of runs still reads as its
 *    schedule. A pipeline is late once no run has started for that long
 *    plus a quarter of it, and at least fifteen minutes more.
 *
 * The pipeline's page and its alerts read the same answers: the five-minute
 * check writes them as metrics (overdue_seconds, run_duration_ratio).
 */

// The completed runs, or starts, before either is learned.
export const MIN_RUNS_TO_LEARN: number = 5;

// The completed runs the typical duration is the median of.
export const RUNS_FOR_TYPICAL_DURATION: number = 20;

// The runs whose starts the expected interval is learned from.
export const RUNS_FOR_EXPECTED_INTERVAL: number = 50;

// The least a typical run is counted as, so seconds more of a short job are not slow.
export const MIN_TYPICAL_DURATION_IN_SECONDS: number = 60;

// How many times its typical duration a run takes before it is unusually long.
export const UNUSUALLY_LONG_RATIO: number = 2;

// The least slack past the expected interval before a pipeline is called late.
export const MIN_PIPELINE_LATENESS_SLACK_IN_SECONDS: number = 15 * 60;

/*
 * A run still going after this long is taken as abandoned - its producer
 * never sent its end - and is no longer judged.
 */
export const MAX_RUNNING_WATCH_IN_SECONDS: number = 7 * 24 * 60 * 60;

// A pipeline not started for this long is retired: never judged late again.
export const MAX_LATENESS_WATCH_IN_SECONDS: number = 30 * 24 * 60 * 60;

function median(values: Array<number>): number {
  const sorted: Array<number> = [...values].sort((a: number, b: number) => {
    return a - b;
  });
  const middle: number = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

// The median of the latest completed runs' durations; null until there are enough.
export function getTypicalDurationInSeconds(
  durationsInSeconds: Array<number>,
): number | null {
  const durations: Array<number> = durationsInSeconds
    .filter((duration: number) => {
      return Number.isFinite(duration) && duration >= 0;
    })
    .slice(0, RUNS_FOR_TYPICAL_DURATION);

  if (durations.length < MIN_RUNS_TO_LEARN) {
    return null;
  }

  return Math.round(median(durations));
}

// The longest gap between the latest starts but a one-off; null until there are enough.
export function getExpectedIntervalInSeconds(
  startTimes: Array<Date>,
): number | null {
  const starts: Array<number> = startTimes
    .map((start: Date) => {
      return new Date(start).getTime();
    })
    .filter((time: number) => {
      return Number.isFinite(time);
    })
    .sort((a: number, b: number) => {
      return b - a;
    })
    .slice(0, RUNS_FOR_EXPECTED_INTERVAL);

  if (starts.length < MIN_RUNS_TO_LEARN) {
    return null;
  }

  const gaps: Array<number> = [];

  for (let index: number = 1; index < starts.length; index++) {
    gaps.push(starts[index - 1]! - starts[index]!);
  }

  gaps.sort((a: number, b: number) => {
    return b - a;
  });

  const interval: number = gaps[1] || 0;

  // Runs that all started together say nothing of a schedule.
  return interval > 0 ? Math.round(interval / 1000) : null;
}

// How a run's duration compares with the typical one; null while that is not known.
export function getDurationRatio(data: {
  durationInSeconds: number;
  typicalDurationInSeconds: number | undefined | null;
}): number | null {
  if (
    data.typicalDurationInSeconds === undefined ||
    data.typicalDurationInSeconds === null ||
    !Number.isFinite(data.durationInSeconds) ||
    data.durationInSeconds < 0
  ) {
    return null;
  }

  const typical: number = Math.max(
    data.typicalDurationInSeconds,
    MIN_TYPICAL_DURATION_IN_SECONDS,
  );

  return Math.round((data.durationInSeconds / typical) * 100) / 100;
}

export function isUnusuallyLong(ratio: number | null): boolean {
  return ratio !== null && ratio >= UNUSUALLY_LONG_RATIO;
}

export enum DataPipelineTimeliness {
  OnTime = "On Time",
  Late = "Late",
  // Fewer than five runs, or none in thirty days: no schedule to judge by.
  Unknown = "Unknown",
}

export interface DataPipelineLateness {
  timeliness: DataPipelineTimeliness;
  // When the pipeline becomes late without a new run; null when that cannot be said.
  lateAt: Date | null;
  // How long it has been late; 0 when it is not.
  overdueBySeconds: number;
}

export function getDataPipelineLateness(data: {
  lastRunStartedAt: Date | undefined | null;
  expectedRunIntervalInSeconds: number | undefined | null;
  now: Date;
}): DataPipelineLateness {
  const unknown: DataPipelineLateness = {
    timeliness: DataPipelineTimeliness.Unknown,
    lateAt: null,
    overdueBySeconds: 0,
  };

  if (
    !data.lastRunStartedAt ||
    !data.expectedRunIntervalInSeconds ||
    data.expectedRunIntervalInSeconds <= 0
  ) {
    return unknown;
  }

  const lastStart: number = new Date(data.lastRunStartedAt).getTime();

  if (data.now.getTime() - lastStart > MAX_LATENESS_WATCH_IN_SECONDS * 1000) {
    return unknown;
  }

  const allowedSeconds: number =
    data.expectedRunIntervalInSeconds +
    Math.max(
      data.expectedRunIntervalInSeconds / 4,
      MIN_PIPELINE_LATENESS_SLACK_IN_SECONDS,
    );
  const lateAt: Date = new Date(lastStart + allowedSeconds * 1000);
  const overdueBySeconds: number = Math.max(
    0,
    Math.floor((data.now.getTime() - lateAt.getTime()) / 1000),
  );

  return {
    timeliness:
      overdueBySeconds > 0
        ? DataPipelineTimeliness.Late
        : DataPipelineTimeliness.OnTime,
    lateAt,
    overdueBySeconds,
  };
}
