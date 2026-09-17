import InBetween from "../BaseDatabase/InBetween";
import MetricsViewConfig from "./MetricsViewConfig";

export default interface MetricViewData extends MetricsViewConfig {
  startAndEndDate: InBetween<Date> | null;
  /*
   * Optional relative-time token (a Range enum value from
   * Common/Types/Time/TimeRange, e.g. "Past 1 Hour"). When set, the
   * resolved startAndEndDate re-anchors to "now" on fetch/refresh instead
   * of staying pinned to the instant it was first resolved. Custom /
   * pinned absolute windows carry no token.
   */
  rangeToken?: string | undefined;
}
