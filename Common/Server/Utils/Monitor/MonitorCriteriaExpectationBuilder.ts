import {
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";

export default class MonitorCriteriaExpectationBuilder {
  public static getCriteriaFilterDescription(
    criteriaFilter: CriteriaFilter,
  ): string {
    const parts: Array<string> = [criteriaFilter.checkOn];

    if (criteriaFilter.filterType) {
      parts.push(criteriaFilter.filterType);
    }

    if (criteriaFilter.value !== undefined && criteriaFilter.value !== null) {
      parts.push(String(criteriaFilter.value));
    }

    return parts.join(" ").trim();
  }

  public static describeCriteriaExpectation(
    criteriaFilter: CriteriaFilter,
  ): string | null {
    if (!criteriaFilter.filterType) {
      return null;
    }

    let expectation: string;

    const value: string | number | undefined = criteriaFilter.value;

    switch (criteriaFilter.filterType) {
      case FilterType.GreaterThan:
        expectation = `to be greater than ${value}`;
        break;
      case FilterType.GreaterThanOrEqualTo:
        expectation = `to be greater than or equal to ${value}`;
        break;
      case FilterType.LessThan:
        expectation = `to be less than ${value}`;
        break;
      case FilterType.LessThanOrEqualTo:
        expectation = `to be less than or equal to ${value}`;
        break;
      case FilterType.EqualTo:
        expectation = `to equal ${value}`;
        break;
      case FilterType.NotEqualTo:
        expectation = `to not equal ${value}`;
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
