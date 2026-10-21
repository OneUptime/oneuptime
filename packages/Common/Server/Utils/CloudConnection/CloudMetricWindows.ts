/*
 * WHICH STRETCH OF TIME A READ ASKS THE CLOUD FOR, per datapoint period.
 *
 * Every read picks up where the last one stopped (the connection's cursor
 * for that period), so each datapoint is written once: metrics are
 * appended, and a window read twice would chart every point twice.
 *
 *   - The window ends on a whole period, `delay` before now: a cloud
 *     publishes a datapoint minutes after the minute it is about
 *     (CloudWatch up to ten, Azure Monitor and Cloud Monitoring a few), and
 *     a once-a-day storage figure a day and a half after its day. A point
 *     asked for too early is not there, and the cursor would move past it.
 *   - A first read starts `firstReadBackMs` before that end, so a new
 *     connection shows a little history at once.
 *   - A read after a long pause - OneUptime down, the connection turned off
 *     - starts no further back than `maxBackMs`: a day of minutes for every
 *     resource is not worth what the cloud charges for it.
 */

export interface MetricWindowPolicy {
  periodSeconds: number;
  delayMs: number;
  firstReadBackMs: number;
  maxBackMs: number;
}

export interface MetricWindow {
  periodSeconds: number;
  start: Date;
  end: Date;
}

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

function floorTo(timeMs: number, stepMs: number): number {
  return Math.floor(timeMs / stepMs) * stepMs;
}

/*
 * The window to read now for a period, or null when there is nothing new
 * yet (the last read already reached the newest whole period).
 */
export function getMetricWindow(data: {
  policy: MetricWindowPolicy;
  cursor?: string | undefined;
  now: Date;
}): MetricWindow | null {
  const periodMs: number = data.policy.periodSeconds * 1000;
  const end: number = floorTo(
    data.now.getTime() - data.policy.delayMs,
    periodMs,
  );
  const cursorMs: number = data.cursor ? Date.parse(data.cursor) : NaN;

  let start: number = Number.isFinite(cursorMs)
    ? cursorMs
    : end - data.policy.firstReadBackMs;

  start = floorTo(Math.max(start, end - data.policy.maxBackMs), periodMs);

  if (start >= end) {
    return null;
  }

  return {
    periodSeconds: data.policy.periodSeconds,
    start: new Date(start),
    end: new Date(end),
  };
}

// The policy for a period: minutes, an hour, or a day.
export function getMetricWindowPolicy(data: {
  periodSeconds: number;
  // The cloud's own delay for its minute-to-minute metrics.
  delayMs: number;
}): MetricWindowPolicy {
  const periodMs: number = data.periodSeconds * 1000;

  if (periodMs >= DAY_MS) {
    return {
      periodSeconds: data.periodSeconds,
      delayMs: 36 * HOUR_MS,
      firstReadBackMs: periodMs,
      maxBackMs: 3 * DAY_MS,
    };
  }

  if (periodMs >= HOUR_MS) {
    return {
      periodSeconds: data.periodSeconds,
      delayMs: Math.max(data.delayMs, periodMs),
      firstReadBackMs: 3 * periodMs,
      maxBackMs: 12 * HOUR_MS,
    };
  }

  return {
    periodSeconds: data.periodSeconds,
    delayMs: data.delayMs,
    firstReadBackMs: HOUR_MS,
    maxBackMs: 6 * HOUR_MS,
  };
}

// Each cloud's delay before a minute's metrics can be read.
export const AWS_METRIC_DELAY_MS: number = 10 * MINUTE_MS;
export const AZURE_METRIC_DELAY_MS: number = 4 * MINUTE_MS;
export const GCP_METRIC_DELAY_MS: number = 4 * MINUTE_MS;
