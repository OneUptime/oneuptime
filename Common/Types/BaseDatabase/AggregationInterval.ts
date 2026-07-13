export enum AggregationInterval {
  Minute = "Minute",
  Hour = "Hour",
  Day = "Day",
  Week = "Week",
  Month = "Month",
  Year = "Year",
  /**
   * No time bucketing: collapse the entire [startTimestamp, endTimestamp]
   * window into a single aggregate per group. Only meaningful as an
   * explicit `AggregateBy.aggregationInterval` override — the
   * window-derived interval picker never returns it. Builders emit one
   * row per group with the earliest sample timestamp in the window as the
   * bucket label (see AggregateUtil.buildBucketTimestampSelect).
   */
  None = "None",
}

export default AggregationInterval;
