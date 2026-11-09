import AggregationType from "../../Types/BaseDatabase/AggregationType";
import TelemetryIngestionBudgetMetricType from "../../Types/Telemetry/TelemetryIngestionBudgetMetricType";

/*
 * Catalog metadata for the `oneuptime.telemetry.budget.*` metrics the
 * ingestion budget sweep posts (Common/Server/Utils/Telemetry/
 * TelemetryIngestionBudgetMetrics). The sweep registers each name's MetricType
 * row (description + unit) from here, and billing, usage, OTLP ingest and the
 * recording rules read the reserved prefix from here, so a name or unit is
 * spelled exactly once.
 *
 * React-free and import-light: the worker, the ingest path, the dashboard and
 * plain node tests all load it.
 */

/*
 * Attribute keys stamped on the rows: bare keys with string values, like
 * `monitorId` on monitor metrics and `projectId` on the session replay budget
 * series, so the same filters work on all of them.
 */
export const TELEMETRY_INGESTION_BUDGET_METRIC_PROJECT_ID_ATTRIBUTE: string =
  "projectId";
export const TELEMETRY_INGESTION_BUDGET_METRIC_SIGNAL_ATTRIBUTE: string =
  "signal";
export const TELEMETRY_INGESTION_BUDGET_METRIC_SCOPE_ATTRIBUTE: string =
  "scope";
export const TELEMETRY_INGESTION_BUDGET_METRIC_INGESTION_KEY_ID_ATTRIBUTE: string =
  "ingestionKeyId";
export const TELEMETRY_INGESTION_BUDGET_METRIC_INGESTION_KEY_NAME_ATTRIBUTE: string =
  "ingestionKeyName";

/*
 * How often the sweep posts, in minutes. The worker's cron schedule and the
 * descriptions below follow from it: a monitor window shorter than about
 * three intervals can find no point in it, and an empty window resolves an
 * open alert.
 */
export const TELEMETRY_INGESTION_BUDGET_METRIC_INTERVAL_MINUTES: number = 5;

/*
 * Every name the sweep posts starts with this, and OTLP ingest drops
 * customer metrics that do (isReservedMetricName). These series open
 * incidents and are left out of usage and billing by name, so a point anyone
 * could send under the same name must never reach them.
 */
export const TELEMETRY_INGESTION_BUDGET_METRIC_NAME_PREFIX: string =
  "oneuptime.telemetry.budget.";

class TelemetryIngestionBudgetMetricTypeUtil {
  /*
   * Every budget metric. The sweep, the billing and usage exclusion and the
   * docs walk this list, so a member missing here is a member never written -
   * TelemetryIngestionBudgetMetricType.test.ts pins it against the enum.
   */
  public static getAll(): Array<TelemetryIngestionBudgetMetricType> {
    return [
      TelemetryIngestionBudgetMetricType.UsedBytes,
      TelemetryIngestionBudgetMetricType.UsedPercent,
      TelemetryIngestionBudgetMetricType.DroppedBytes,
      TelemetryIngestionBudgetMetricType.ThrottledRequests,
    ];
  }

  /*
   * Whether a metric name belongs to OneUptime's ingestion budget namespace.
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
      .startsWith(TELEMETRY_INGESTION_BUDGET_METRIC_NAME_PREFIX);
  }

  public static getTitle(
    metricType: TelemetryIngestionBudgetMetricType,
  ): string {
    switch (metricType) {
      case TelemetryIngestionBudgetMetricType.UsedBytes:
        return "Ingestion Budget Used";
      case TelemetryIngestionBudgetMetricType.UsedPercent:
        return "Ingestion Budget Used (%)";
      case TelemetryIngestionBudgetMetricType.DroppedBytes:
        return "Telemetry Dropped by Budget";
      case TelemetryIngestionBudgetMetricType.ThrottledRequests:
        return "Requests Throttled by Rate Limit";
      default:
        throw new Error("Invalid TelemetryIngestionBudgetMetricType value");
    }
  }

  /*
   * Doubles as the MetricType catalog description, so it has to make sense
   * to someone who finds the series in a metric picker with no Usage page in
   * front of them.
   */
  public static getDescription(
    metricType: TelemetryIngestionBudgetMetricType,
  ): string {
    const everyInterval: string = `Written every ${TELEMETRY_INGESTION_BUDGET_METRIC_INTERVAL_MINUTES} minutes while a budget or rate limit is set and the figure is above zero`;
    const perScope: string =
      "one series per signal and scope (the project, or an ingestion key): filter on the signal and scope attributes";

    switch (metricType) {
      case TelemetryIngestionBudgetMetricType.UsedBytes:
        return `Telemetry bytes counted against the daily ingestion budget since the budget day started, decompressed, as they arrived. ${everyInterval}, ${perScope}.`;
      case TelemetryIngestionBudgetMetricType.UsedPercent:
        return `The bytes counted today as a percent of the daily ingestion budget, rounded down to 0.01. At 100 or more, the signal is refused until the budget resets. ${everyInterval}, ${perScope}.`;
      case TelemetryIngestionBudgetMetricType.DroppedBytes:
        return `Telemetry bytes refused or dropped since the budget day started because the daily ingestion budget was used up. ${everyInterval}, ${perScope}.`;
      case TelemetryIngestionBudgetMetricType.ThrottledRequests:
        return `Requests refused since the budget day started because they came faster than the per-second ingestion rate limit allows. Their senders retry them. ${everyInterval}, ${perScope}.`;
      default:
        throw new Error("Invalid TelemetryIngestionBudgetMetricType value");
    }
  }

  /*
   * The unit registered on the MetricType row. "By" is the OpenTelemetry
   * spelling of bytes, which the chart formatter scales into KB/MB/GB; the
   * percent series uses "%" (not "1"), so nothing multiplies it by 100.
   */
  public static getUnit(
    metricType: TelemetryIngestionBudgetMetricType,
  ): string {
    switch (metricType) {
      case TelemetryIngestionBudgetMetricType.UsedBytes:
      case TelemetryIngestionBudgetMetricType.DroppedBytes:
        return "By";
      case TelemetryIngestionBudgetMetricType.UsedPercent:
        return "%";
      case TelemetryIngestionBudgetMetricType.ThrottledRequests:
        return "{request}";
      default:
        throw new Error("Invalid TelemetryIngestionBudgetMetricType value");
    }
  }

  /*
   * Max for every series: each only climbs within a budget day, so the
   * highest point in a chart bucket is the latest reading.
   */
  public static getAggregationType(
    metricType: TelemetryIngestionBudgetMetricType,
  ): AggregationType {
    switch (metricType) {
      case TelemetryIngestionBudgetMetricType.UsedBytes:
      case TelemetryIngestionBudgetMetricType.UsedPercent:
      case TelemetryIngestionBudgetMetricType.DroppedBytes:
      case TelemetryIngestionBudgetMetricType.ThrottledRequests:
        return AggregationType.Max;
      default:
        throw new Error("Invalid TelemetryIngestionBudgetMetricType value");
    }
  }
}

export default TelemetryIngestionBudgetMetricTypeUtil;
