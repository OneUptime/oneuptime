import AggregationType from "../../Types/BaseDatabase/AggregationType";
import AlertMetricType from "../../Types/Alerts/AlertMetricType";

class AlertMetricTypeUtil {
  public static getAggregationTypeByAlertMetricType(
    metricType: AlertMetricType,
  ): AggregationType {
    switch (metricType) {
      case AlertMetricType.AlertCount:
        return AggregationType.Sum;
      case AlertMetricType.TimeToAcknowledge:
        return AggregationType.Avg;
      case AlertMetricType.TimeToResolve:
        return AggregationType.Avg;
      case AlertMetricType.AlertDuration:
        return AggregationType.Avg;
      default:
        throw new Error("Invalid AlertMetricType value");
    }
  }

  public static getAllAlertMetricTypes(): Array<AlertMetricType> {
    return [
      AlertMetricType.AlertCount,
      AlertMetricType.TimeToAcknowledge,
      AlertMetricType.TimeToResolve,
      AlertMetricType.AlertDuration,
    ];
  }

  public static getTitleByAlertMetricType(
    metricType: AlertMetricType,
  ): string {
    switch (metricType) {
      case AlertMetricType.AlertCount:
        return "Alert Count";
      case AlertMetricType.TimeToAcknowledge:
        return "Time to Acknowledge";
      case AlertMetricType.TimeToResolve:
        return "Time to Resolve";
      case AlertMetricType.AlertDuration:
        return "Alert Duration";
      default:
        return "";
    }
  }

  public static getDescriptionByAlertMetricType(
    metricType: AlertMetricType,
  ): string {
    switch (metricType) {
      case AlertMetricType.AlertCount:
        return "The number of alerts created for this monitor over time.";
      case AlertMetricType.TimeToAcknowledge:
        return "The average time taken to acknowledge alerts for this monitor.";
      case AlertMetricType.TimeToResolve:
        return "The average time taken to resolve alerts for this monitor.";
      case AlertMetricType.AlertDuration:
        return "The average duration of alerts for this monitor.";
      default:
        return "";
    }
  }

  public static getLegendByAlertMetricType(
    metricType: AlertMetricType,
  ): string {
    switch (metricType) {
      case AlertMetricType.AlertCount:
        return "Alerts";
      case AlertMetricType.TimeToAcknowledge:
        return "Time to Acknowledge";
      case AlertMetricType.TimeToResolve:
        return "Time to Resolve";
      case AlertMetricType.AlertDuration:
        return "Duration";
      default:
        return "";
    }
  }

  public static getLegendUnitByAlertMetricType(
    metricType: AlertMetricType,
  ): string {
    switch (metricType) {
      case AlertMetricType.AlertCount:
        return "";
      case AlertMetricType.TimeToAcknowledge:
        return "s";
      case AlertMetricType.TimeToResolve:
        return "s";
      case AlertMetricType.AlertDuration:
        return "s";
      default:
        return "";
    }
  }
}

export default AlertMetricTypeUtil;
