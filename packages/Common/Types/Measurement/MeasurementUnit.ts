/*
 * The unit a measurement's chart reads in.
 *
 * Every measurement is worked out in whole seconds - the stored value is
 * always valueInSeconds - and the unit only decides the number a chart is
 * drawn from. Seconds is the default and reads best: the dashboard's value
 * formatter scales seconds itself, so a chart shows "45 sec", "12 min",
 * "3.5 hours" or "2 days" as the numbers grow. The other units pin the chart
 * to one scale - a team that reports time to resolve in hours gets a chart
 * whose every point is in hours.
 *
 * A unit is honest only if the number it labels is in that unit, so the
 * metric writer converts each value (MeasurementMetricWriter) and registers
 * the unit with it. It used to write seconds whatever the unit said, so a
 * measurement in "minutes" charted 3,600 minutes for an hour.
 *
 * The column is free text in the API, and some measurements were saved with
 * a unit typed by hand ("secs", "min"). Those read as the unit they spell; a
 * unit nobody can read as a time unit reads as seconds - the number the
 * value really is - rather than labelling seconds with a word that is not
 * true of them.
 */
enum MeasurementUnit {
  Seconds = "seconds",
  Minutes = "minutes",
  Hours = "hours",
  Days = "days",
}

export const DEFAULT_MEASUREMENT_UNIT: MeasurementUnit =
  MeasurementUnit.Seconds;

// How many seconds one of each unit is.
export const SECONDS_PER_MEASUREMENT_UNIT: Record<MeasurementUnit, number> = {
  [MeasurementUnit.Seconds]: 1,
  [MeasurementUnit.Minutes]: 60,
  [MeasurementUnit.Hours]: 60 * 60,
  [MeasurementUnit.Days]: 24 * 60 * 60,
};

/*
 * The spellings each unit is read from, lowercase: the unit's own value, the
 * UCUM code a metric would carry, and the ways a person types it.
 */
export const MEASUREMENT_UNIT_SPELLINGS: Record<
  MeasurementUnit,
  Array<string>
> = {
  [MeasurementUnit.Seconds]: ["seconds", "second", "secs", "sec", "s"],
  [MeasurementUnit.Minutes]: ["minutes", "minute", "mins", "min"],
  [MeasurementUnit.Hours]: ["hours", "hour", "hrs", "hr", "h"],
  [MeasurementUnit.Days]: ["days", "day", "d"],
};

export type GetMeasurementUnitFunction = (unit: unknown) => MeasurementUnit;

/**
 * The unit a measurement's stored unit means: one of the four, read
 * case-insensitively from any of its spellings. Empty, missing or anything
 * else is seconds, the unit the values are worked out in.
 */
export const getMeasurementUnit: GetMeasurementUnitFunction = (
  unit: unknown,
): MeasurementUnit => {
  if (typeof unit !== "string") {
    return DEFAULT_MEASUREMENT_UNIT;
  }

  const spelling: string = unit.trim().toLowerCase();

  for (const candidate of Object.values(MeasurementUnit)) {
    if (MEASUREMENT_UNIT_SPELLINGS[candidate].includes(spelling)) {
      return candidate;
    }
  }

  return DEFAULT_MEASUREMENT_UNIT;
};

export type ConvertMeasurementValueFunction = (data: {
  valueInSeconds: number;
  unit: unknown;
}) => number;

/**
 * A duration in seconds, in the measurement's unit: 5400 seconds is 90
 * minutes, or 1.5 hours.
 */
export const convertMeasurementValueFromSeconds: ConvertMeasurementValueFunction =
  (data: { valueInSeconds: number; unit: unknown }): number => {
    return (
      data.valueInSeconds /
      SECONDS_PER_MEASUREMENT_UNIT[getMeasurementUnit(data.unit)]
    );
  };

export default MeasurementUnit;
