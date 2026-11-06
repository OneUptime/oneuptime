/*
 * WHEN SOMETHING FILLS UP, AT ITS RECENT GROWTH.
 *
 * One straight line through what was used, against what there is: what the Growth Forecast tile
 * says on a part's page, what the Capacity page lists soonest first, and what Capacity Forecast
 * Under N Days alerts on. Pure, so the server and the pages read the same answer.
 */

export interface OpenStackGrowthSample {
  time: number;
  used: number;
}

export type OpenStackForecast =
  // At capacity already.
  | { state: "full" }
  | { state: "days"; days: number }
  // Flat or shrinking: nothing to project.
  | { state: "not-growing" }
  // Too little of it to tell, which is what a new cloud says.
  | { state: "not-enough-history" };

const FORECAST_MINIMUM_SAMPLES: number = 3;
const FORECAST_MINIMUM_HOURS: number = 6;
const FORECAST_MAXIMUM_DAYS: number = 365;

/*
 * A straight line through what was used, against what there is: the same least-squares
 * fit as the Proxmox and Ceph forecasts. Past a year out it says it is not growing,
 * because nobody plans around a line that far off.
 */
export function getOpenStackForecast(data: {
  samples: Array<OpenStackGrowthSample>;
  capacity: number | null | undefined;
  // How much history it takes to say anything: a part's page settles for six hours.
  minimumHours?: number | undefined;
}): OpenStackForecast {
  const capacity: number | null | undefined = data.capacity;
  if (capacity === null || capacity === undefined || capacity <= 0) {
    return { state: "not-enough-history" };
  }

  const samples: Array<OpenStackGrowthSample> = data.samples
    .filter((sample: OpenStackGrowthSample): boolean => {
      return Number.isFinite(sample.time) && Number.isFinite(sample.used);
    })
    .sort((first: OpenStackGrowthSample, second: OpenStackGrowthSample) => {
      return first.time - second.time;
    });

  const newest: OpenStackGrowthSample | undefined = samples[samples.length - 1];

  if (newest && newest.used >= capacity) {
    return { state: "full" };
  }

  const minimumHours: number = data.minimumHours ?? FORECAST_MINIMUM_HOURS;

  if (
    !newest ||
    samples.length < FORECAST_MINIMUM_SAMPLES ||
    newest.time - samples[0]!.time < minimumHours * 60 * 60 * 1000
  ) {
    return { state: "not-enough-history" };
  }

  const count: number = samples.length;
  let timeSum: number = 0;
  let usedSum: number = 0;
  for (const sample of samples) {
    timeSum += sample.time;
    usedSum += sample.used;
  }
  const meanTime: number = timeSum / count;
  const meanUsed: number = usedSum / count;

  let covariance: number = 0;
  let variance: number = 0;
  for (const sample of samples) {
    covariance += (sample.time - meanTime) * (sample.used - meanUsed);
    variance += (sample.time - meanTime) * (sample.time - meanTime);
  }

  const growthPerMs: number = variance > 0 ? covariance / variance : 0;
  if (growthPerMs <= 0) {
    return { state: "not-growing" };
  }

  const days: number =
    (capacity - newest.used) / (growthPerMs * 24 * 60 * 60 * 1000);

  return days > FORECAST_MAXIMUM_DAYS
    ? { state: "not-growing" }
    : { state: "days", days };
}
