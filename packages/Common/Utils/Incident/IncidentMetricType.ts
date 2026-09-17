import AggregationType from "../../Types/BaseDatabase/AggregationType";
import IncidentMetricType from "../../Types/Incident/IncidentMetricType";

class IncidentMetricTypeUtil {
  public static getAggregationTypeByIncidentMetricType(
    metricType: IncidentMetricType,
  ): AggregationType {
    switch (metricType) {
      case IncidentMetricType.IncidentCount:
        return AggregationType.Sum;
      case IncidentMetricType.TimeToAcknowledge:
        return AggregationType.Avg;
      case IncidentMetricType.TimeToResolve:
        return AggregationType.Avg;
      case IncidentMetricType.IncidentDuration:
        return AggregationType.Avg;
      case IncidentMetricType.TimeInState:
        return AggregationType.Avg;
      case IncidentMetricType.SeverityChange:
        return AggregationType.Sum;
      case IncidentMetricType.PostmortemCompletionTime:
        return AggregationType.Avg;
      default:
        throw new Error("Invalid IncidentMetricType value");
    }
  }

  public static getAllIncidentMetricTypes(): Array<IncidentMetricType> {
    return [
      IncidentMetricType.IncidentCount,
      IncidentMetricType.TimeToAcknowledge,
      IncidentMetricType.TimeToResolve,
      IncidentMetricType.IncidentDuration,
    ];
  }

  public static getTitleByIncidentMetricType(
    metricType: IncidentMetricType,
  ): string {
    switch (metricType) {
      case IncidentMetricType.IncidentCount:
        return "Incident Count";
      case IncidentMetricType.TimeToAcknowledge:
        return "Time to Acknowledge";
      case IncidentMetricType.TimeToResolve:
        return "Time to Resolve";
      case IncidentMetricType.IncidentDuration:
        return "Incident Duration";
      case IncidentMetricType.TimeInState:
        return "Time in State";
      case IncidentMetricType.SeverityChange:
        return "Severity Changes";
      case IncidentMetricType.PostmortemCompletionTime:
        return "Postmortem Completion Time";
      default:
        return "";
    }
  }

  public static getDescriptionByIncidentMetricType(
    metricType: IncidentMetricType,
  ): string {
    switch (metricType) {
      case IncidentMetricType.IncidentCount:
        return "The number of incidents created for this monitor over time.";
      case IncidentMetricType.TimeToAcknowledge:
        return "The average time taken to acknowledge incidents for this monitor.";
      case IncidentMetricType.TimeToResolve:
        return "The average time taken to resolve incidents for this monitor.";
      case IncidentMetricType.IncidentDuration:
        return "The average duration of incidents for this monitor.";
      case IncidentMetricType.TimeInState:
        return "The average time incidents spend in each state for this monitor.";
      case IncidentMetricType.SeverityChange:
        return "The number of severity changes for incidents related to this monitor.";
      case IncidentMetricType.PostmortemCompletionTime:
        return "The average time taken to complete postmortems for incidents related to this monitor.";
      default:
        return "";
    }
  }

  public static getLegendByIncidentMetricType(
    metricType: IncidentMetricType,
  ): string {
    switch (metricType) {
      case IncidentMetricType.IncidentCount:
        return "Incidents";
      case IncidentMetricType.TimeToAcknowledge:
        return "Time to Acknowledge";
      case IncidentMetricType.TimeToResolve:
        return "Time to Resolve";
      case IncidentMetricType.IncidentDuration:
        return "Duration";
      case IncidentMetricType.TimeInState:
        return "Time in State";
      case IncidentMetricType.SeverityChange:
        return "Severity Changes";
      case IncidentMetricType.PostmortemCompletionTime:
        return "Postmortem Time";
      default:
        return "";
    }
  }

  public static getLegendUnitByIncidentMetricType(
    metricType: IncidentMetricType,
  ): string {
    switch (metricType) {
      case IncidentMetricType.IncidentCount:
        return "";
      case IncidentMetricType.TimeToAcknowledge:
        return "s";
      case IncidentMetricType.TimeToResolve:
        return "s";
      case IncidentMetricType.IncidentDuration:
        return "s";
      case IncidentMetricType.TimeInState:
        return "s";
      case IncidentMetricType.SeverityChange:
        return "";
      case IncidentMetricType.PostmortemCompletionTime:
        return "s";
      default:
        return "";
    }
  }
}

export default IncidentMetricTypeUtil;
