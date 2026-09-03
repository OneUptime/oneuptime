import FilterCondition from "Common/Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/**
 * Plain-English descriptions of a monitor criteria, for the collapsed
 * rows of the criteria form.
 *
 * The criteria form is the longest form in the product: a monitor ships
 * with two criteria, each of which is a name, a description, a list of
 * filters and three action sub-forms. Collapsed rows only help if the
 * row still says what the criteria DOES - "3 filters | status change,
 * incidents" told the user how much configuration was hidden, not which
 * of their criteria this was. Everything here exists to answer "which
 * one is this?" without expanding it.
 *
 * Kept out of the components and free of React so the wording is
 * testable on its own.
 */

/** The word this criteria's filters are joined by on screen. */
export const AND_JOINER: string = " and ";
export const OR_JOINER: string = " or ";

/**
 * How many filters a one-line summary spells out before it gives up and
 * counts the rest. Two fit comfortably on the narrowest row we render.
 */
export const MAX_FILTERS_IN_SUMMARY: number = 2;

/** The wildcard that opts a criteria into one alert per disk / interface. */
export const ALL_ENTITIES_WILDCARD: string = "*";

/**
 * Comparison filter types rendered as symbols. Everything else keeps its
 * enum wording, lower-cased, which already reads as English ("contains",
 * "starts with", "is empty").
 */
const FILTER_TYPE_SYMBOLS: Partial<Record<FilterType, string>> = {
  [FilterType.EqualTo]: "=",
  [FilterType.NotEqualTo]: "≠",
  [FilterType.GreaterThan]: ">",
  [FilterType.LessThan]: "<",
  [FilterType.GreaterThanOrEqualTo]: "≥",
  [FilterType.LessThanOrEqualTo]: "≤",
};

export default class MonitorCriteriaSummaryUtil {
  /**
   * The subject of one filter: the check it runs, plus the entity it is
   * pinned to when the check names one (a disk, an OID, an interface, a
   * metric, a database series). Without the entity, three disk-usage
   * filters on the same criteria all summarise identically.
   */
  public static getFilterSubject(filter: CriteriaFilter): string {
    const checkOn: CheckOn | undefined = filter.checkOn;

    if (!checkOn) {
      return "";
    }

    const scope: string | undefined =
      MonitorCriteriaSummaryUtil.getFilterScope(filter);

    return scope ? `${checkOn} [${scope}]` : `${checkOn}`;
  }

  /**
   * The entity a filter is pinned to, or undefined when the check names
   * no entity. `*` is passed through as-is: it is meaningful to the
   * user (one alert per disk) and hiding it would make a fan-out
   * criteria look identical to a pinned one.
   */
  public static getFilterScope(filter: CriteriaFilter): string | undefined {
    const trim: (value: string | undefined) => string | undefined = (
      value: string | undefined,
    ): string | undefined => {
      const trimmed: string = (value || "").trim();
      return trimmed.length > 0 ? trimmed : undefined;
    };

    if (filter.checkOn === CheckOn.DiskUsagePercent) {
      return trim(filter.serverMonitorOptions?.diskPath);
    }

    if (
      filter.checkOn === CheckOn.SnmpOidValue ||
      filter.checkOn === CheckOn.SnmpOidExists ||
      filter.checkOn === CheckOn.SnmpTrapReceived
    ) {
      return trim(filter.snmpMonitorOptions?.oid);
    }

    if (
      filter.checkOn === CheckOn.SnmpInterfaceIsDown ||
      filter.checkOn === CheckOn.SnmpInterfaceUtilizationPercent ||
      filter.checkOn === CheckOn.SnmpInterfaceErrorsPerSecond
    ) {
      return trim(filter.snmpMonitorOptions?.interfaceName);
    }

    if (filter.checkOn === CheckOn.MetricValue) {
      return trim(filter.metricMonitorOptions?.metricAlias);
    }

    if (filter.checkOn === CheckOn.DatabaseMetric) {
      return trim(
        filter.databaseMonitorOptions?.metricType as string | undefined,
      );
    }

    return undefined;
  }

  /** "Greater Than" reads as ">", "Contains" reads as "contains". */
  public static getFilterOperator(filterType: FilterType | undefined): string {
    if (!filterType) {
      return "";
    }

    return FILTER_TYPE_SYMBOLS[filterType] || filterType.toLowerCase();
  }

  /**
   * One filter as a sentence fragment, e.g.
   *   Response Time (in ms) > 5000
   *   Is Online is true
   *   Metric Value [cpu] ≥ 80 (Average over 5m)
   *
   * A filter that has not been filled in yet says so rather than
   * rendering a half sentence - a criteria the server can never match
   * should be visible from the collapsed row.
   */
  public static getFilterSummary(filter: CriteriaFilter | undefined): string {
    if (!filter || !filter.checkOn) {
      return "Incomplete filter";
    }

    const parts: Array<string> = [
      MonitorCriteriaSummaryUtil.getFilterSubject(filter),
    ];

    if (filter.filterType === FilterType.True) {
      parts.push("is true");
    } else if (filter.filterType === FilterType.False) {
      parts.push("is false");
    } else if (filter.filterType) {
      parts.push(
        MonitorCriteriaSummaryUtil.getFilterOperator(filter.filterType),
      );
    }

    const takesValue: boolean =
      Boolean(filter.filterType) &&
      CriteriaFilterUtil.hasValueField({
        checkOn: filter.checkOn,
        filterType: filter.filterType,
      });

    if (takesValue) {
      const value: string = (filter.value ?? "").toString().trim();
      parts.push(value.length > 0 ? value : "…");
    }

    const overTime: string | undefined =
      MonitorCriteriaSummaryUtil.getEvaluateOverTimeSummary(filter);

    if (overTime) {
      parts.push(overTime);
    }

    return parts
      .filter((part: string) => {
        return part.length > 0;
      })
      .join(" ");
  }

  /** "(Average over 5m)" for filters evaluated across a window. */
  public static getEvaluateOverTimeSummary(
    filter: CriteriaFilter,
  ): string | undefined {
    if (!filter.evaluateOverTime || !filter.evaluateOverTimeOptions) {
      return undefined;
    }

    const minutes: number | undefined =
      filter.evaluateOverTimeOptions.timeValueInMinutes;
    const type: string | undefined =
      filter.evaluateOverTimeOptions.evaluateOverTimeType;

    if (!minutes && !type) {
      return undefined;
    }

    if (!minutes) {
      return `(${type})`;
    }

    if (!type) {
      return `(over ${minutes}m)`;
    }

    return `(${type} over ${minutes}m)`;
  }

  /**
   * Every filter of a criteria joined by the criteria's own match
   * condition, truncated so the row stays one line.
   */
  public static getFiltersSummary(data: {
    filters: Array<CriteriaFilter> | undefined;
    filterCondition: FilterCondition | undefined;
  }): string {
    const filters: Array<CriteriaFilter> = data.filters || [];

    if (filters.length === 0) {
      return "No filters";
    }

    const joiner: string =
      data.filterCondition === FilterCondition.Any ? OR_JOINER : AND_JOINER;

    const shown: Array<CriteriaFilter> = filters.slice(
      0,
      MAX_FILTERS_IN_SUMMARY,
    );

    const summary: string = shown
      .map((filter: CriteriaFilter) => {
        return MonitorCriteriaSummaryUtil.getFilterSummary(filter);
      })
      .join(joiner);

    const hidden: number = filters.length - shown.length;

    /*
     * The overflow is parenthesised rather than joined with "and"/"or":
     * "... or 1 more" reads as another condition, which is exactly what
     * it is not.
     */
    return hidden > 0 ? `${summary} (+${hidden} more)` : summary;
  }

  /**
   * The actions a criteria takes when it matches, as short badges. An
   * action that is switched on but not configured says so ("Status → not
   * set") instead of being left out, because a criteria in that state
   * saves and then does nothing.
   */
  public static getActionSummaries(data: {
    criteriaInstance: MonitorCriteriaInstance | undefined;
    monitorStatusOptions?: Array<DropdownOption> | undefined;
  }): Array<string> {
    const criteria: MonitorCriteriaInstance | undefined = data.criteriaInstance;
    const actions: Array<string> = [];

    if (!criteria?.data) {
      return actions;
    }

    const changesStatus: boolean =
      Boolean(criteria.data.changeMonitorStatus) ||
      Boolean(criteria.data.monitorStatusId?.id);

    if (changesStatus) {
      const statusId: string | undefined =
        criteria.data.monitorStatusId?.id?.toString();

      const statusOption: DropdownOption | undefined = (
        data.monitorStatusOptions || []
      ).find((option: DropdownOption) => {
        return option.value?.toString() === statusId;
      });

      actions.push(`Status → ${statusOption?.label || "not set"}`);
    }

    if (criteria.data.createAlerts) {
      const count: number = criteria.data.alerts?.length || 0;
      actions.push(`${count} alert${count === 1 ? "" : "s"}`);
    }

    if (criteria.data.createIncidents) {
      const count: number = criteria.data.incidents?.length || 0;
      actions.push(`${count} incident${count === 1 ? "" : "s"}`);
    }

    return actions;
  }

  /**
   * The whole criteria on one line: what it looks for, and what it does
   * about it.
   */
  public static getCriteriaSummary(data: {
    criteriaInstance: MonitorCriteriaInstance | undefined;
    monitorStatusOptions?: Array<DropdownOption> | undefined;
  }): string {
    const criteria: MonitorCriteriaInstance | undefined = data.criteriaInstance;

    const filtersSummary: string = MonitorCriteriaSummaryUtil.getFiltersSummary(
      {
        filters: criteria?.data?.filters,
        filterCondition: criteria?.data?.filterCondition,
      },
    );

    const actions: Array<string> =
      MonitorCriteriaSummaryUtil.getActionSummaries(data);

    const actionsSummary: string =
      actions.length > 0 ? actions.join(", ") : "No actions";

    return `If ${filtersSummary} → ${actionsSummary}`;
  }

  /**
   * Does the server stop at the first criteria that matches?
   *
   * Mirrors MonitorCriteriaEvaluator's `isPerSeriesMonitor` /
   * `fanOutAcrossCriteria` (Common/Server/Utils/Monitor), which is the
   * source of truth. It cannot be imported here - it reaches into the
   * server-only VM and logger utilities - so the rule is restated, and
   * pinned by tests, rather than shared.
   *
   * The form says which of the two it is because the difference decides
   * whether the ORDER of the criteria matters at all, and ordering is the
   * one thing a criteria list cannot show on its own.
   */
  public static isFirstMatchWins(data: {
    monitorType: MonitorType;
    monitorStep?: MonitorStep | undefined;
    criteriaInstances?: Array<MonitorCriteriaInstance> | undefined;
  }): boolean {
    const criteriaInstances: Array<MonitorCriteriaInstance> =
      data.criteriaInstances || [];

    /*
     * Incoming Request is per-series when incident grouping is on, but
     * the evaluator deliberately keeps first-match-wins for it: a webhook
     * carries one payload and the criteria pick one reading of it.
     */
    if (data.monitorType === MonitorType.IncomingRequest) {
      return true;
    }

    if (MonitorCriteriaInstance.isMetricBackedMonitorType(data.monitorType)) {
      return MonitorStep.getGroupByAttributeKeys(data.monitorStep).length === 0;
    }

    if (data.monitorType === MonitorType.Server) {
      return !criteriaInstances.some((criteria: MonitorCriteriaInstance) => {
        return (criteria.data?.filters || []).some((filter: CriteriaFilter) => {
          return (
            filter.checkOn === CheckOn.DiskUsagePercent &&
            (filter.serverMonitorOptions?.diskPath || "").trim() ===
              ALL_ENTITIES_WILDCARD
          );
        });
      });
    }

    if (data.monitorType === MonitorType.NetworkDevice) {
      return !criteriaInstances.some((criteria: MonitorCriteriaInstance) => {
        return (criteria.data?.filters || []).some((filter: CriteriaFilter) => {
          return (
            (filter.checkOn === CheckOn.SnmpInterfaceIsDown ||
              filter.checkOn === CheckOn.SnmpInterfaceUtilizationPercent ||
              filter.checkOn === CheckOn.SnmpInterfaceErrorsPerSecond) &&
            (filter.snmpMonitorOptions?.interfaceName || "").trim() ===
              ALL_ENTITIES_WILDCARD
          );
        });
      });
    }

    return true;
  }

  /**
   * The sentence the criteria list shows above the rows, so the reader
   * knows whether dragging them around changes anything.
   */
  public static getEvaluationOrderHint(data: {
    monitorType: MonitorType;
    monitorStep?: MonitorStep | undefined;
    criteriaInstances?: Array<MonitorCriteriaInstance> | undefined;
  }): string {
    if (MonitorCriteriaSummaryUtil.isFirstMatchWins(data)) {
      return "Checked top to bottom — the first criteria that matches wins, and the rest are skipped. Drag to reorder.";
    }

    return "Every criteria is checked on each run, because this monitor alerts separately per series.";
  }
}
