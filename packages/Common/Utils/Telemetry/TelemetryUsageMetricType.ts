import AggregationType from "../../Types/BaseDatabase/AggregationType";
import { NO_BREAK_SPACE } from "../../Types/NoBreakSpaces";
import TelemetryUsageMetricType from "../../Types/Telemetry/TelemetryUsageMetricType";

/*
 * Catalog metadata for the `oneuptime.telemetry.usage.*` metrics the usage
 * sweep posts (Common/Server/Utils/Telemetry/TelemetryUsageMetrics, issue
 * #6355). The sweep registers each name's MetricType row (description and
 * unit) from here, and billing, usage, OTLP ingest and the recording rules
 * read the reserved prefix from here, so a name or unit is spelled once.
 *
 * React-free and import-light: the worker, the ingest path, the dashboard
 * and plain node tests all load it.
 */

// Attribute keys stamped on the rows: bare keys with string values.
export const TELEMETRY_USAGE_METRIC_PROJECT_ID_ATTRIBUTE: string = "projectId";
export const TELEMETRY_USAGE_METRIC_SIGNAL_ATTRIBUTE: string = "signal";
export const TELEMETRY_USAGE_METRIC_RESOURCE_TYPE_ATTRIBUTE: string =
  "resourceType";
export const TELEMETRY_USAGE_METRIC_RESOURCE_ID_ATTRIBUTE: string =
  "resourceId";
export const TELEMETRY_USAGE_METRIC_RESOURCE_NAME_ATTRIBUTE: string =
  "resourceName";

/*
 * How often the sweep posts, in minutes: each point is the bytes of one
 * such interval. A monitor window of at least this long always holds one.
 */
export const TELEMETRY_USAGE_METRIC_INTERVAL_MINUTES: number = 5;

/*
 * Every name the sweep posts starts with this, and OTLP ingest drops
 * customer metrics that do (isReservedMetricName): these series are left out
 * of usage and billing by name, so a point anyone could send under the same
 * name must never reach them.
 */
export const TELEMETRY_USAGE_METRIC_NAME_PREFIX: string =
  "oneuptime.telemetry.usage.";

class TelemetryUsageMetricTypeUtil {
  /*
   * Every usage metric. The sweep, the billing and usage exclusion and the
   * docs walk this list, so a member missing here is a member never written.
   */
  public static getAll(): Array<TelemetryUsageMetricType> {
    return [TelemetryUsageMetricType.UsageBytes];
  }

  /*
   * Whether a metric name belongs to OneUptime's usage namespace.
   * Case-insensitive, because OTLP ingest lowercases names before storing
   * them: a name that only differs in case would land on the same series.
   */
  public static isReservedMetricName(name: string | null | undefined): boolean {
    if (typeof name !== "string") {
      return false;
    }

    return name
      .trim()
      .toLowerCase()
      .startsWith(TELEMETRY_USAGE_METRIC_NAME_PREFIX);
  }

  public static getTitle(metricType: TelemetryUsageMetricType): string {
    switch (metricType) {
      case TelemetryUsageMetricType.UsageBytes:
        return "Telemetry Usage";
      default:
        throw new Error("Invalid TelemetryUsageMetricType value");
    }
  }

  /*
   * Doubles as the MetricType catalog description, so it has to make sense
   * to someone who finds the series in a metric picker with no Usage page in
   * front of them. A figure and its minutes are held together, so a narrow
   * picker never ends a line with "5".
   */
  public static getDescription(metricType: TelemetryUsageMetricType): string {
    switch (metricType) {
      case TelemetryUsageMetricType.UsageBytes:
        return `Telemetry bytes a service or resource sent in ${TELEMETRY_USAGE_METRIC_INTERVAL_MINUTES}${NO_BREAK_SPACE}minutes, decompressed, counted as they arrived, as ingestion budgets count them. One series per signal and resource: filter on the signal, resourceType and resourceName attributes. Written every ${TELEMETRY_USAGE_METRIC_INTERVAL_MINUTES}${NO_BREAK_SPACE}minutes while the project publishes its usage as metrics, and only for what sent anything. Not counted as usage, nor billed.`;
      default:
        throw new Error("Invalid TelemetryUsageMetricType value");
    }
  }

  /*
   * The unit registered on the MetricType row: "By", the OpenTelemetry
   * spelling of bytes, which the chart formatter scales into KB, MB and GB.
   */
  public static getUnit(metricType: TelemetryUsageMetricType): string {
    switch (metricType) {
      case TelemetryUsageMetricType.UsageBytes:
        return "By";
      default:
        throw new Error("Invalid TelemetryUsageMetricType value");
    }
  }

  /*
   * Sum: each point is one interval's bytes, so a chart bucket's sum is
   * what was sent in it, and a day's sum the day's usage.
   */
  public static getAggregationType(
    metricType: TelemetryUsageMetricType,
  ): AggregationType {
    switch (metricType) {
      case TelemetryUsageMetricType.UsageBytes:
        return AggregationType.Sum;
      default:
        throw new Error("Invalid TelemetryUsageMetricType value");
    }
  }
}

export default TelemetryUsageMetricTypeUtil;
