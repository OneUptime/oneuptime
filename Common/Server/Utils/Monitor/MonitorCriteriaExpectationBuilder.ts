import {
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricValueFormatter from "../../../Utils/Monitor/MetricValueFormatter";

/**
 * How a criteria's values are displayed: the unit, and the metric name
 * the formatter's fraction / epoch rules are keyed on.
 */
export interface CriteriaDisplayOptions {
  unit?: string | undefined;
  metricName?: string | undefined;
}

export default class MonitorCriteriaExpectationBuilder {
  public static getCriteriaFilterDescription(
    criteriaFilter: CriteriaFilter,
    options?: CriteriaDisplayOptions,
  ): string {
    const parts: Array<string> = [criteriaFilter.checkOn];

    if (criteriaFilter.filterType) {
      parts.push(criteriaFilter.filterType);
    }

    if (criteriaFilter.value !== undefined && criteriaFilter.value !== null) {
      const formatted: string | number =
        MonitorCriteriaExpectationBuilder.formatThreshold(
          criteriaFilter.value,
          options,
        ) ?? criteriaFilter.value;

      parts.push(String(formatted));
    }

    return parts.join(" ").trim();
  }

  /*
   * The threshold, rendered exactly as an observed value would be — or
   * returned untouched when it cannot be.
   *
   * Untouched covers three cases, and each matters: no unit was resolved
   * (every non-metric checkOn, whose unit lives in its CheckOn label), the
   * threshold is a string (the Contains / StartsWith family, which must
   * quote what the user typed), or it is not a finite number.
   */
  private static formatThreshold(
    value: string | number | undefined,
    options?: CriteriaDisplayOptions,
  ): string | number | undefined {
    if (!options?.unit) {
      return value;
    }

    const numeric: number = Number(value);

    if (typeof value === "boolean" || !Number.isFinite(numeric)) {
      return value;
    }

    return MetricValueFormatter.format({
      value: numeric,
      unit: options.unit,
      metricName: options.metricName,
    });
  }

  public static describeCriteriaExpectation(
    criteriaFilter: CriteriaFilter,
    options?: CriteriaDisplayOptions,
  ): string | null {
    if (!criteriaFilter.filterType) {
      return null;
    }

    let expectation: string;

    /*
     * Render the threshold the way the observed value is rendered, so the
     * two halves of one sentence cannot describe one quantity differently.
     * Reformatting only the observation produced "recorded latest 1.07 GB
     * (expected to be greater than 1000000000 By)".
     *
     * A NON-numeric threshold falls back to the previous text verbatim —
     * `criteriaFilter.value` is `string | number | undefined`, and the
     * string filter types below must keep quoting exactly what the user
     * typed. So must a threshold with no unit: `formatThreshold` is only
     * installed when a unit was resolved, which happens for the two metric
     * checkOns and nothing else.
     */
    const value: string | number | undefined = criteriaFilter.value;

    /*
     * The threshold as the six value-comparison cases below should print
     * it, unit included. Only those six get it: the string comparisons
     * quote what the user typed, and the heartbeat windows carry their own
     * "minutes" — formatting their value produced "within 5 sec minutes".
     */
    const comparedValue: string | number | undefined =
      MonitorCriteriaExpectationBuilder.formatThreshold(value, options);

    /*
     * Suffix numeric-threshold comparisons with the metric's display unit
     * (e.g. "greater than 5 sec") so the threshold reads in the same unit
     * as the observed value. Only the value-comparison filter types below
     * carry a numeric threshold — the others (empty, boolean, heartbeat
     * windows, …) supply their own wording and get no suffix.
     *
     * When the value was formatted above it already carries its unit, so
     * this suffix collapses to empty and the unit is not printed twice.
     */
    const unitSuffix: string =
      options?.unit && comparedValue === value ? ` ${options.unit}` : "";

    switch (criteriaFilter.filterType) {
      case FilterType.GreaterThan:
        expectation = `to be greater than ${comparedValue}${unitSuffix}`;
        break;
      case FilterType.GreaterThanOrEqualTo:
        expectation = `to be greater than or equal to ${comparedValue}${unitSuffix}`;
        break;
      case FilterType.LessThan:
        expectation = `to be less than ${comparedValue}${unitSuffix}`;
        break;
      case FilterType.LessThanOrEqualTo:
        expectation = `to be less than or equal to ${comparedValue}${unitSuffix}`;
        break;
      case FilterType.EqualTo:
        expectation = `to equal ${comparedValue}${unitSuffix}`;
        break;
      case FilterType.NotEqualTo:
        expectation = `to not equal ${comparedValue}${unitSuffix}`;
        break;
      case FilterType.Contains:
        expectation = `to contain ${value}`;
        break;
      case FilterType.NotContains:
        expectation = `to not contain ${value}`;
        break;
      case FilterType.StartsWith:
        expectation = `to start with ${value}`;
        break;
      case FilterType.EndsWith:
        expectation = `to end with ${value}`;
        break;
      case FilterType.IsEmpty:
        expectation = "to be empty";
        break;
      case FilterType.IsNotEmpty:
        expectation = "to not be empty";
        break;
      case FilterType.True:
        expectation = "to be true";
        break;
      case FilterType.False:
        expectation = "to be false";
        break;
      case FilterType.IsExecuting:
        expectation = "to be executing";
        break;
      case FilterType.IsNotExecuting:
        expectation = "to not be executing";
        break;
      case FilterType.RecievedInMinutes:
        expectation = value
          ? `to receive a heartbeat within ${value} minutes`
          : "to receive a heartbeat within the configured window";
        break;
      case FilterType.NotRecievedInMinutes:
        expectation = value
          ? `to miss a heartbeat for at least ${value} minutes`
          : "to miss a heartbeat within the configured window";
        break;
      case FilterType.EvaluatesToTrue:
        expectation = "to evaluate to true";
        break;
      default:
        expectation = `${criteriaFilter.filterType}${value ? ` ${value}` : ""}`;
        break;
    }

    const evaluationWindow: string | null =
      MonitorCriteriaExpectationBuilder.getEvaluationWindowDescription(
        criteriaFilter,
      );

    if (evaluationWindow) {
      expectation += ` ${evaluationWindow}`;
    }

    return expectation.trim();
  }

  public static getEvaluationWindowDescription(
    criteriaFilter: CriteriaFilter,
  ): string | null {
    const parts: Array<string> = [];

    if (
      criteriaFilter.evaluateOverTime &&
      criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes
    ) {
      parts.push(
        `over the last ${criteriaFilter.evaluateOverTimeOptions.timeValueInMinutes} minutes`,
      );
    }

    const aggregation: string | undefined =
      criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ||
      criteriaFilter.metricMonitorOptions?.metricAggregationType;

    if (aggregation) {
      parts.push(`using ${aggregation.toLowerCase()}`);
    }

    if (!parts.length) {
      return null;
    }

    return parts.join(" ");
  }
}
