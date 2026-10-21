import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";

/*
 * A MetricView's window lives in its data as a resolved startAndEndDate
 * plus, for a relative window, the preset it came from (rangeToken). These
 * convert that to and from the picker's RangeStartAndEndDateTime, so the
 * shared page zoom (useTimeRangeZoom) can run over a MetricView's own
 * window too.
 */

const isTimeRange: (value: string | undefined) => boolean = (
  value: string | undefined,
): boolean => {
  return (
    value !== undefined &&
    value !== TimeRange.CUSTOM &&
    (Object.values(TimeRange) as Array<string>).includes(value)
  );
};

export default class MetricViewTimeRange {
  /** The window a MetricView's data describes, as a picker range. */
  public static fromData(data: MetricViewData): RangeStartAndEndDateTime {
    const startAndEndDate: InBetween<Date> | undefined =
      data.startAndEndDate || undefined;

    if (isTimeRange(data.rangeToken)) {
      return {
        range: data.rangeToken as TimeRange,
        startAndEndDate: startAndEndDate,
      };
    }

    return {
      range: TimeRange.CUSTOM,
      startAndEndDate: startAndEndDate,
    };
  }

  /**
   * The same data on another window. A relative range is resolved against
   * now and keeps its preset, so it goes on sliding; a custom range is
   * pinned and carries no preset.
   */
  public static applyToData(
    data: MetricViewData,
    timeRange: RangeStartAndEndDateTime,
  ): MetricViewData {
    if (timeRange.range === TimeRange.CUSTOM) {
      return {
        ...data,
        startAndEndDate: timeRange.startAndEndDate || null,
        rangeToken: undefined,
      };
    }

    return {
      ...data,
      startAndEndDate:
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange),
      rangeToken: timeRange.range,
    };
  }
}
