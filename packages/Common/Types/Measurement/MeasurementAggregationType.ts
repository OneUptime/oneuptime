import AggregationType from "../BaseDatabase/AggregationType";

/*
 * The aggregation a measurement's chart should default to.
 *
 * Kept as a narrow subset of AggregationType: summing durations across
 * incidents produces a number with no meaning, so Sum is deliberately absent.
 */
enum MeasurementAggregationType {
  Avg = "Avg",
  Max = "Max",
  Min = "Min",
  P50 = "P50",
  P90 = "P90",
  P95 = "P95",
  P99 = "P99",
}

export class MeasurementAggregationTypeUtil {
  public static toAggregationType(
    type: MeasurementAggregationType | undefined,
  ): AggregationType {
    switch (type) {
      case MeasurementAggregationType.Max:
        return AggregationType.Max;
      case MeasurementAggregationType.Min:
        return AggregationType.Min;
      case MeasurementAggregationType.P50:
        return AggregationType.P50;
      case MeasurementAggregationType.P90:
        return AggregationType.P90;
      case MeasurementAggregationType.P95:
        return AggregationType.P95;
      case MeasurementAggregationType.P99:
        return AggregationType.P99;
      case MeasurementAggregationType.Avg:
      default:
        return AggregationType.Avg;
    }
  }
}

export default MeasurementAggregationType;
