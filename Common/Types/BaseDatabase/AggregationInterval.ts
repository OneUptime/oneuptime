export enum AggregationInterval {
  Minute = "Minute",
  /*
   * The sub-hour tiers are served from the same 1-minute rollup as
   * `Minute` (any bucket that is a whole multiple of a minute is >= the
   * MV's resolution). Unlike the calendar units they are NOT valid
   * ClickHouse `date_trunc`/INTERVAL-1 units, so SQL builders must go
   * through AggregateUtil.buildBucketTimestampExpression instead of
   * lowercasing the enum value into the statement.
   */
  FiveMinutes = "FiveMinutes",
  FifteenMinutes = "FifteenMinutes",
  ThirtyMinutes = "ThirtyMinutes",
  Hour = "Hour",
  Day = "Day",
  Week = "Week",
  Month = "Month",
  Year = "Year",
  /**
   * No time bucketing: collapse the entire [startTimestamp, endTimestamp]
   * window into a single aggregate per group (one total value over the
   * whole range). Only meaningful as an explicit
   * `AggregateBy.aggregationInterval` override — the window-derived
   * interval picker never returns it. Builders emit one row per group with
   * the earliest sample timestamp in the window as the bucket label (see
   * AggregateUtil.buildBucketTimestampSelect).
   */
  Total = "Total",
}

export default AggregationInterval;
