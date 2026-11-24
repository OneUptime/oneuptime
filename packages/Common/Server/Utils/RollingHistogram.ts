/*
 * A DISTRIBUTION OF THE LAST FEW SECONDS, IN CONSTANT MEMORY.
 *
 * What a metrics endpoint reports of something that happens many times a
 * second - how long a request waited, how late a monitor was handed out -
 * when it is asked "over the last minute": the count, the mean, the largest
 * and the 50th, 95th and 99th percentiles. Values go into fixed buckets
 * (`bucketBounds`, ascending upper bounds; a value above the last goes into
 * an overflow bucket), one set of buckets per second, `windowSeconds` of
 * them reused round a ring. So recording is a few additions, a read merges
 * at most `windowSeconds` sets of buckets, and nothing grows with traffic.
 *
 * A percentile is the upper bound of the bucket its rank falls in, never
 * more than the largest value seen: as precise as the bounds are close.
 * RollingCount is the same ring for a count.
 */

export interface RollingSummary {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

interface Slot {
  second: number;
  count: number;
  sum: number;
  max: number;
  buckets: Array<number>;
}

export interface RollingHistogramOptions {
  bucketBounds: Array<number>;
  windowSeconds: number;
  // Test seam: the clock, in ms.
  now?: (() => number) | undefined;
}

export const EMPTY_ROLLING_SUMMARY: RollingSummary = {
  count: 0,
  mean: 0,
  p50: 0,
  p95: 0,
  p99: 0,
  max: 0,
};

function currentSecond(now: () => number): number {
  return Math.floor(now() / 1000);
}

export default class RollingHistogram {
  private readonly bounds: Array<number>;
  private readonly windowSeconds: number;
  private readonly now: () => number;
  private readonly slots: Array<Slot>;

  public constructor(options: RollingHistogramOptions) {
    this.bounds = options.bucketBounds.slice().sort((a: number, b: number) => {
      return a - b;
    });
    this.windowSeconds = Math.max(1, Math.floor(options.windowSeconds));
    this.now = options.now || Date.now;
    this.slots = [];

    for (let index: number = 0; index < this.windowSeconds; index++) {
      this.slots.push(this.emptySlot(-1));
    }
  }

  private emptySlot(second: number): Slot {
    return {
      second: second,
      count: 0,
      sum: 0,
      max: 0,
      buckets: new Array<number>(this.bounds.length + 1).fill(0),
    };
  }

  // The bucket a value goes into: the first whose bound it does not pass.
  private bucketOf(value: number): number {
    let low: number = 0;
    let high: number = this.bounds.length;

    while (low < high) {
      const middle: number = (low + high) >> 1;

      if (value <= this.bounds[middle]!) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }

    return low;
  }

  public record(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    const measured: number = Math.max(0, value);
    const second: number = currentSecond(this.now);
    const index: number = second % this.windowSeconds;
    let slot: Slot = this.slots[index]!;

    if (slot.second !== second) {
      slot = this.emptySlot(second);
      this.slots[index] = slot;
    }

    slot.count++;
    slot.sum += measured;
    slot.max = Math.max(slot.max, measured);
    slot.buckets[this.bucketOf(measured)]!++;
  }

  public summary(): RollingSummary {
    const second: number = currentSecond(this.now);
    const buckets: Array<number> = new Array<number>(
      this.bounds.length + 1,
    ).fill(0);
    let count: number = 0;
    let sum: number = 0;
    let max: number = 0;

    for (const slot of this.slots) {
      if (slot.second < 0 || second - slot.second >= this.windowSeconds) {
        continue;
      }

      count += slot.count;
      sum += slot.sum;
      max = Math.max(max, slot.max);

      for (let index: number = 0; index < buckets.length; index++) {
        buckets[index]! += slot.buckets[index]!;
      }
    }

    if (count === 0) {
      return { ...EMPTY_ROLLING_SUMMARY };
    }

    const percentile: (fraction: number) => number = (
      fraction: number,
    ): number => {
      const rank: number = Math.max(1, Math.ceil(count * fraction));
      let seen: number = 0;

      for (let index: number = 0; index < buckets.length; index++) {
        seen += buckets[index]!;

        if (seen >= rank) {
          const bound: number | undefined = this.bounds[index];
          return bound === undefined ? max : Math.min(bound, max);
        }
      }

      return max;
    };

    return {
      count: count,
      mean: sum / count,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      max: max,
    };
  }
}

// How many times something happened in the last `windowSeconds`.
export class RollingCount {
  private readonly windowSeconds: number;
  private readonly now: () => number;
  private readonly seconds: Array<number>;
  private readonly counts: Array<number>;

  public constructor(options: {
    windowSeconds: number;
    now?: (() => number) | undefined;
  }) {
    this.windowSeconds = Math.max(1, Math.floor(options.windowSeconds));
    this.now = options.now || Date.now;
    this.seconds = new Array<number>(this.windowSeconds).fill(-1);
    this.counts = new Array<number>(this.windowSeconds).fill(0);
  }

  public add(count: number = 1): void {
    if (!Number.isFinite(count) || count <= 0) {
      return;
    }

    const second: number = currentSecond(this.now);
    const index: number = second % this.windowSeconds;

    if (this.seconds[index] !== second) {
      this.seconds[index] = second;
      this.counts[index] = 0;
    }

    this.counts[index]! += count;
  }

  public total(): number {
    const second: number = currentSecond(this.now);
    let total: number = 0;

    for (let index: number = 0; index < this.windowSeconds; index++) {
      const slotSecond: number = this.seconds[index]!;

      if (slotSecond >= 0 && second - slotSecond < this.windowSeconds) {
        total += this.counts[index]!;
      }
    }

    return total;
  }
}
