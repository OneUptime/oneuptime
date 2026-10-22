/*
 * The time arithmetic of temporal correlations, on plain numbers so it is
 * exact, cheap and pinned in plain tests.
 *
 * The engine reads, for each group (a user, a host, an address), the times
 * each step of a correlation matched - the latest few hundred per step -
 * and asks three questions of them:
 *
 *   - countStepTimes: when an event_count step happened. A step like "ten
 *     failed sign-ins within ten minutes" happens at each event that brings
 *     the count in its window to ten.
 *   - findOrderedChain: whether the steps happened in order, first to last,
 *     within the correlation's timespan (temporal_ordered).
 *   - findTogetherWindow: whether enough of the steps happened within the
 *     timespan, in any order (temporal).
 *
 * Every answer is the most recent one, and only one that ends at or after
 * `notBefore` (where the run's window starts): a chain the previous run
 * already reported is not reported again, while one completed by an event
 * of this run is, even when its first step happened before the window.
 *
 * Times are milliseconds. Every function sorts its own copy of the input
 * and runs in O(n log n) at most.
 */

export interface CorrelationMatch {
  // When the first and the last step of the match happened.
  start: number;
  end: number;
  // The time each step matched at, in step order (-1 for a step not needed).
  stepTimes: Array<number>;
}

function sortedCopy(times: Array<number>): Array<number> {
  return times
    .filter((time: number): boolean => {
      return Number.isFinite(time);
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });
}

// The index of the latest time <= limit in an ascending list, or -1.
function latestAtOrBefore(times: Array<number>, limit: number): number {
  let low: number = 0;
  let high: number = times.length - 1;
  let found: number = -1;

  while (low <= high) {
    const middle: number = Math.floor((low + high) / 2);

    if (times[middle]! <= limit) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}

/*
 * The moments an event_count step happens: each event at which at least
 * `minimumCount` of the step's events fall in the `windowMs` ending at it
 * (the event itself included, the window's far edge excluded, as a rolling
 * window counts).
 */
export function countStepTimes(
  times: Array<number>,
  windowMs: number,
  minimumCount: number,
): Array<number> {
  const sorted: Array<number> = sortedCopy(times);
  const needed: number = Math.max(1, Math.floor(minimumCount));
  // A window holds at least its own end.
  const window: number = Math.max(1, windowMs);
  const happened: Array<number> = [];

  let left: number = 0;

  for (let right: number = 0; right < sorted.length; right++) {
    const end: number = sorted[right]!;

    while (sorted[left]! <= end - window) {
      left++;
    }

    if (right - left + 1 >= needed) {
      happened.push(end);
    }
  }

  return happened;
}

/*
 * The most recent chain of the steps in order - a time from step 1, then
 * one from step 2 no earlier, and so on - whose first and last times are
 * at most `windowMs` apart and whose last time is at or after `notBefore`.
 *
 * Working back from each candidate end, the latest earlier time of each
 * step is the best choice: it keeps the chain's start as late as it can be,
 * so if that chain does not fit the window, none ending there does.
 */
export function findOrderedChain(
  stepTimes: Array<Array<number>>,
  windowMs: number,
  notBefore: number,
): CorrelationMatch | null {
  if (stepTimes.length === 0) {
    return null;
  }

  const steps: Array<Array<number>> = stepTimes.map(sortedCopy);
  const last: Array<number> = steps[steps.length - 1]!;

  for (let index: number = last.length - 1; index >= 0; index--) {
    const end: number = last[index]!;

    if (end < notBefore) {
      break;
    }

    const chain: Array<number> = new Array<number>(steps.length);
    chain[steps.length - 1] = end;

    let current: number = end;
    let complete: boolean = true;

    for (let step: number = steps.length - 2; step >= 0; step--) {
      const position: number = latestAtOrBefore(steps[step]!, current);

      if (position === -1) {
        complete = false;
        break;
      }

      current = steps[step]![position]!;
      chain[step] = current;
    }

    if (complete && end - chain[0]! <= windowMs) {
      return { start: chain[0]!, end, stepTimes: chain };
    }
  }

  return null;
}

/*
 * The most recent window of at most `windowMs` holding times of at least
 * `minimumSteps` different steps, in any order, whose latest time is at or
 * after `notBefore`. The match's step times are each step's latest time in
 * that window (-1 for a step it does not hold).
 */
export function findTogetherWindow(
  stepTimes: Array<Array<number>>,
  windowMs: number,
  minimumSteps: number,
  notBefore: number,
): CorrelationMatch | null {
  const needed: number = Math.min(
    stepTimes.length,
    Math.max(1, Math.floor(minimumSteps)),
  );

  if (stepTimes.length === 0) {
    return null;
  }

  const events: Array<{ time: number; step: number }> = [];

  stepTimes.forEach((times: Array<number>, step: number): void => {
    for (const time of sortedCopy(times)) {
      events.push({ time, step });
    }
  });

  events.sort(
    (
      a: { time: number; step: number },
      b: { time: number; step: number },
    ): number => {
      return a.time - b.time || a.step - b.step;
    },
  );

  const counts: Array<number> = new Array<number>(stepTimes.length).fill(0);
  let distinct: number = 0;
  let left: number = 0;
  let best: { left: number; right: number } | null = null;

  for (let right: number = 0; right < events.length; right++) {
    const entering: { time: number; step: number } = events[right]!;

    if (counts[entering.step] === 0) {
      distinct++;
    }

    counts[entering.step]! += 1;

    while (events[left]!.time < entering.time - windowMs) {
      const leaving: { time: number; step: number } = events[left]!;
      counts[leaving.step]! -= 1;

      if (counts[leaving.step] === 0) {
        distinct--;
      }

      left++;
    }

    if (distinct >= needed && entering.time >= notBefore) {
      best = { left, right };
    }
  }

  if (!best) {
    return null;
  }

  const matched: Array<number> = new Array<number>(stepTimes.length).fill(-1);

  for (let index: number = best.left; index <= best.right; index++) {
    const event: { time: number; step: number } = events[index]!;
    matched[event.step] = Math.max(matched[event.step]!, event.time);
  }

  return {
    start: events[best.left]!.time,
    end: events[best.right]!.time,
    stepTimes: matched,
  };
}
