import AggregationType from "../../Types/BaseDatabase/AggregationType";
import AlertMetricType from "../../Types/Alerts/AlertMetricType";
import { translationKey } from "../../Types/Translator";

/*
 * The words a monitor's or an SLO's Alert Metrics charts draw - each
 * chart's title, legend and what it shows - are keys of the Dashboard's
 * locales (translationKey; this file is a `keys` root of its extractor),
 * and the charts look each up once where they hand it to the chart
 * (#8282).
 */
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

  public static getTitleByAlertMetricType(metricType: AlertMetricType): string {
    switch (metricType) {
      case AlertMetricType.AlertCount:
        return translationKey("Alert Count");
      case AlertMetricType.TimeToAcknowledge:
        return translationKey("Time to Acknowledge");
      case AlertMetricType.TimeToResolve:
        return translationKey("Time to Resolve");
      case AlertMetricType.AlertDuration:
        return translationKey("Alert Duration");
      default:
        return "";
    }
  }

  public static getDescriptionByAlertMetricType(
    metricType: AlertMetricType,
  ): string {
    switch (metricType) {
      case AlertMetricType.AlertCount:
        return translationKey(
          "The number of alerts created for this monitor over time.",
        );
      case AlertMetricType.TimeToAcknowledge:
        return translationKey(
          "The average time taken to acknowledge alerts for this monitor.",
        );
      case AlertMetricType.TimeToResolve:
        return translationKey(
          "The average time taken to resolve alerts for this monitor.",
        );
      case AlertMetricType.AlertDuration:
        return translationKey(
          "The average duration of alerts for this monitor.",
        );
      default:
        return "";
    }
  }

  public static getLegendByAlertMetricType(
    metricType: AlertMetricType,
  ): string {
    switch (metricType) {
      case AlertMetricType.AlertCount:
        return translationKey("Alerts");
      case AlertMetricType.TimeToAcknowledge:
        return translationKey("Time to Acknowledge");
      case AlertMetricType.TimeToResolve:
        return translationKey("Time to Resolve");
      case AlertMetricType.AlertDuration:
        return translationKey("Duration");
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
