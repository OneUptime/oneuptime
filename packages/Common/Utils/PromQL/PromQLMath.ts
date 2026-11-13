/*
 * The arithmetic PromQL's functions share, written as Prometheus writes it
 * (promql/functions.go, promql/quantile.go) so results agree to the last
 * digit where the order of additions matters.
 */

export interface KahanSum {
  sum: number;
  compensation: number;
}

// Neumaier's improvement of Kahan summation, as kahanSumInc in Prometheus.
export const kahanAdd: (state: KahanSum, value: number) => void = (
  state: KahanSum,
  value: number,
): void => {
  const total: number = state.sum + value;

  if (!Number.isFinite(total)) {
    state.compensation = 0;
  } else if (Math.abs(state.sum) >= Math.abs(value)) {
    state.compensation += state.sum - total + value;
  } else {
    state.compensation += value - total + state.sum;
  }

  state.sum = total;
};

export const kahanResult: (state: KahanSum) => number = (
  state: KahanSum,
): number => {
  return state.sum + state.compensation;
};

/*
 * The φ-quantile of a list of values, interpolating between the two nearest
 * ranks. NaN sorts first, as Prometheus sorts it.
 */
export const promQLQuantile: (phi: number, values: Array<number>) => number = (
  phi: number,
  values: Array<number>,
): number => {
  if (values.length === 0 || Number.isNaN(phi)) {
    return NaN;
  }

  if (phi < 0) {
    return -Infinity;
  }

  if (phi > 1) {
    return Infinity;
  }

  const sorted: Array<number> = [...values].sort(compareWithNaNFirst);
  const count: number = sorted.length;
  const rank: number = phi * (count - 1);
  const lowerIndex: number = Math.max(0, Math.floor(rank));
  const upperIndex: number = Math.min(count - 1, lowerIndex + 1);
  const weight: number = rank - Math.floor(rank);

  return sorted[lowerIndex]! * (1 - weight) + sorted[upperIndex]! * weight;
};

export const compareWithNaNFirst: (a: number, b: number) => number = (
  a: number,
  b: number,
): number => {
  if (Number.isNaN(a)) {
    return Number.isNaN(b) ? 0 : -1;
  }

  if (Number.isNaN(b)) {
    return 1;
  }

  return a - b;
};

/*
 * The least-squares line through samples, with x in seconds from
 * `interceptTimeMs`: the slope per second, and the value at that time.
 */
export const linearRegression: (
  timestampsMs: ArrayLike<number>,
  values: ArrayLike<number>,
  interceptTimeMs: number,
) => { slope: number; intercept: number } = (
  timestampsMs: ArrayLike<number>,
  values: ArrayLike<number>,
  interceptTimeMs: number,
): { slope: number; intercept: number } => {
  const sumX: KahanSum = { sum: 0, compensation: 0 };
  const sumY: KahanSum = { sum: 0, compensation: 0 };
  const sumXY: KahanSum = { sum: 0, compensation: 0 };
  const sumX2: KahanSum = { sum: 0, compensation: 0 };
  const initialY: number = values[0]!;
  let constantY: boolean = true;
  let count: number = 0;

  for (let index: number = 0; index < values.length; index++) {
    const y: number = values[index]!;

    if (constantY && index > 0 && y !== initialY) {
      constantY = false;
    }

    count++;
    const x: number = (timestampsMs[index]! - interceptTimeMs) / 1000;
    kahanAdd(sumX, x);
    kahanAdd(sumY, y);
    kahanAdd(sumXY, x * y);
    kahanAdd(sumX2, x * x);
  }

  if (constantY) {
    if (!Number.isFinite(initialY)) {
      return { slope: NaN, intercept: NaN };
    }

    return { slope: 0, intercept: initialY };
  }

  const totalX: number = kahanResult(sumX);
  const totalY: number = kahanResult(sumY);
  const covarianceXY: number = kahanResult(sumXY) - (totalX * totalY) / count;
  const varianceX: number = kahanResult(sumX2) - (totalX * totalX) / count;
  const slope: number = covarianceXY / varianceX;
  const intercept: number = totalY / count - (slope * totalX) / count;

  return { slope, intercept };
};

export interface HistogramBucket {
  upperBound: number;
  count: number;
}

/*
 * The φ-quantile of a classic histogram's cumulative buckets
 * (bucketQuantile): the buckets need a +Inf one, and the quantile is
 * interpolated linearly inside the bucket it falls in.
 */
export const bucketQuantile: (
  phi: number,
  input: Array<HistogramBucket>,
) => number = (phi: number, input: Array<HistogramBucket>): number => {
  if (Number.isNaN(phi)) {
    return NaN;
  }

  if (phi < 0) {
    return -Infinity;
  }

  if (phi > 1) {
    return Infinity;
  }

  const sorted: Array<HistogramBucket> = [...input].sort(
    (a: HistogramBucket, b: HistogramBucket): number => {
      return a.upperBound - b.upperBound;
    },
  );

  if (
    sorted.length === 0 ||
    sorted[sorted.length - 1]!.upperBound !== Infinity
  ) {
    return NaN;
  }

  // Buckets with the same bound (two sources of one histogram) add up.
  const buckets: Array<HistogramBucket> = [];

  for (const bucket of sorted) {
    const last: HistogramBucket | undefined = buckets[buckets.length - 1];

    if (last && last.upperBound === bucket.upperBound) {
      last.count += bucket.count;
    } else {
      buckets.push({ ...bucket });
    }
  }

  // Counts only grow from bucket to bucket; a dip is a scrape artefact.
  for (let index: number = 1; index < buckets.length; index++) {
    if (buckets[index]!.count < buckets[index - 1]!.count) {
      buckets[index]!.count = buckets[index - 1]!.count;
    }
  }

  if (buckets.length < 2) {
    return NaN;
  }

  const observations: number = buckets[buckets.length - 1]!.count;

  if (observations === 0) {
    return NaN;
  }

  let rank: number = phi * observations;
  let bucketIndex: number = buckets.length - 1;

  for (let index: number = 0; index < buckets.length - 1; index++) {
    if (buckets[index]!.count >= rank) {
      bucketIndex = index;
      break;
    }
  }

  if (bucketIndex === buckets.length - 1) {
    return buckets[buckets.length - 2]!.upperBound;
  }

  if (bucketIndex === 0 && buckets[0]!.upperBound <= 0) {
    return buckets[0]!.upperBound;
  }

  let bucketStart: number = 0;
  const bucketEnd: number = buckets[bucketIndex]!.upperBound;
  let count: number = buckets[bucketIndex]!.count;

  if (bucketIndex > 0) {
    bucketStart = buckets[bucketIndex - 1]!.upperBound;
    count -= buckets[bucketIndex - 1]!.count;
    rank -= buckets[bucketIndex - 1]!.count;
  }

  return bucketStart + (bucketEnd - bucketStart) * (rank / count);
};

// Go's math.Pow agrees with JavaScript but for two edge cases.
export const promQLPow: (base: number, exponent: number) => number = (
  base: number,
  exponent: number,
): number => {
  if (base === 1) {
    return 1;
  }

  if (base === -1 && !Number.isFinite(exponent) && !Number.isNaN(exponent)) {
    return 1;
  }

  return Math.pow(base, exponent);
};

/*
 * The index of the first timestamp after `value` in an ascending list:
 * every index before it is at or before `value`.
 */
export const upperBound: (
  sorted: ArrayLike<number>,
  value: number,
) => number = (sorted: ArrayLike<number>, value: number): number => {
  let low: number = 0;
  let high: number = sorted.length;

  while (low < high) {
    const middle: number = (low + high) >>> 1;

    if (sorted[middle]! <= value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
};
