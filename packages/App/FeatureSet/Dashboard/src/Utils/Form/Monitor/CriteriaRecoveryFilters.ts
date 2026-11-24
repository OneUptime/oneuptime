import {
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorType from "Common/Types/Monitor/MonitorType";

/*
 * THE RECOVERY CONDITION A CRITERIA STARTS WITH (#10355).
 *
 * "Recover only when a condition of its own is met" starts from what most
 * people mean by it: the opposite of the criteria's own filters, holding for
 * a while. "Response time above 500 ms" recovers when it is at or below 500
 * ms for 10 minutes; "Is Online is false" when it is true for 10 minutes. A
 * filter whose check cannot be watched over a window recovers on a check
 * that no longer matches, as the criteria would without a condition of its
 * own, and the person sets the threshold or the window they want from
 * there: a lower threshold, a longer window, a count of checks.
 */

// How long a recovery condition holds before the criteria recovers.
export const DEFAULT_RECOVERY_WINDOW_IN_MINUTES: number = 10;

const OPPOSITES: Readonly<Partial<Record<FilterType, FilterType>>> = {
  [FilterType.True]: FilterType.False,
  [FilterType.False]: FilterType.True,
  [FilterType.GreaterThan]: FilterType.LessThanOrEqualTo,
  [FilterType.GreaterThanOrEqualTo]: FilterType.LessThan,
  [FilterType.LessThan]: FilterType.GreaterThanOrEqualTo,
  [FilterType.LessThanOrEqualTo]: FilterType.GreaterThan,
  [FilterType.EqualTo]: FilterType.NotEqualTo,
  [FilterType.NotEqualTo]: FilterType.EqualTo,
  [FilterType.Contains]: FilterType.NotContains,
  [FilterType.NotContains]: FilterType.Contains,
  [FilterType.IsEmpty]: FilterType.IsNotEmpty,
  [FilterType.IsNotEmpty]: FilterType.IsEmpty,
  [FilterType.IsExecuting]: FilterType.IsNotExecuting,
  [FilterType.IsNotExecuting]: FilterType.IsExecuting,
  [FilterType.AnomalouslyHigh]: FilterType.LessThanOrEqualTo,
  [FilterType.ForecastAbove]: FilterType.LessThanOrEqualTo,
  [FilterType.ForecastBelow]: FilterType.GreaterThanOrEqualTo,
};

export default class CriteriaRecoveryFilters {
  // The opposite of a condition, or the condition itself when it has none.
  public static getOpposite(
    filterType: FilterType | undefined,
  ): FilterType | undefined {
    return filterType ? OPPOSITES[filterType] || filterType : filterType;
  }

  /*
   * The recovery filters a criteria with these filters starts with: each
   * one's opposite, over the last 10 minutes on every check where its check
   * is offered a window.
   */
  public static fromFilters(data: {
    filters: Array<CriteriaFilter>;
    monitorType: MonitorType;
  }): Array<CriteriaFilter> {
    return data.filters.map((filter: CriteriaFilter): CriteriaFilter => {
      const opposite: CriteriaFilter = {
        ...filter,
        filterType: CriteriaRecoveryFilters.getOpposite(filter.filterType),
        evaluateOverTime: false,
      };

      delete opposite.evaluateOverTimeOptions;
      delete opposite.metricCriteriaContext;

      if (
        CriteriaFilterUtil.isEvaluateOverTimeFilter(
          filter.checkOn,
          data.monitorType,
        )
      ) {
        opposite.evaluateOverTime = true;
        opposite.evaluateOverTimeOptions = {
          timeValueInMinutes: DEFAULT_RECOVERY_WINDOW_IN_MINUTES,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
        };
      }

      return opposite;
    });
  }
}
