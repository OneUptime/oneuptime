import AggregationType from "../../Types/BaseDatabase/AggregationType";
import SessionReplayBudgetMetricType from "../../Types/Rum/SessionReplayBudgetMetricType";

/*
 * Catalog metadata for the `oneuptime.rum.session.replay.budget.*` metrics
 * the budget sweep posts (Common/Server/Utils/SessionReplay/
 * SessionReplayBudgetMetrics). The sweep registers each name's MetricType row
 * (description + unit) from here, the RUM alert templates read the names from
 * here, and billing and OTLP ingest read the reserved prefix from here, so a
 * name or unit is spelled exactly once.
 *
 * React-free and import-light on purpose: the worker, the ingest path, the
 * dashboard and plain node tests all load it.
 *
 * It lives here rather than beside its enum in Common/{Types,Utils}/Rum on
 * purpose. Those two directories are the allow-list of dependency-free
 * modules the browser recorder inlines into the script served on customers'
 * pages, so nothing in them may import from outside them - and this module
 * needs AggregationType. The recorder's esbuild plugin and its SourceHygiene
 * test both refuse such an import. The enum itself imports nothing, so it
 * stays in Types/Rum.
 */

/*
 * Attribute keys stamped on the rows. Bare keys with string values, like
 * `monitorId` / `monitorName` on monitor metrics and `sloId` / `sloName` on
 * SLO metrics, so the same filters work on all of them. `rumApplicationId`
 * is also the key the metrics explorer's RUM facet already reads.
 */
export const SESSION_REPLAY_BUDGET_METRIC_PROJECT_ID_ATTRIBUTE: string =
  "projectId";
export const SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_ID_ATTRIBUTE: string =
  "rumApplicationId";
export const SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_NAME_ATTRIBUTE: string =
  "rumApplicationName";

/*
 * How often the sweep posts, in minutes. The worker's cron schedule, the
 * descriptions below and the alert templates' 15-minute window all follow
 * from it: a monitor window shorter than about three intervals can find no
 * point in it, and an empty window resolves an open alert.
 */
export const SESSION_REPLAY_BUDGET_METRIC_INTERVAL_MINUTES: number = 5;

/*
 * Every name the sweep posts starts with this, and OTLP ingest refuses
 * customer metrics that do (isReservedMetricName). These series open
 * incidents and are left out of telemetry billing by name, so a point anyone
 * could send from a browser page under the same name must never reach them.
 */
export const SESSION_REPLAY_METRIC_NAME_PREFIX: string =
  "oneuptime.rum.session.replay.";

class SessionReplayBudgetMetricTypeUtil {
  /*
   * Every budget metric, project series first. The sweep, the billing
   * exclusion and the docs all walk this list, so a member missing here is a
   * member never written - SessionReplayBudgetMetricType.test.ts pins it
   * against the enum.
   */
  public static getAll(): Array<SessionReplayBudgetMetricType> {
    return [
      SessionReplayBudgetMetricType.ProjectDailyUsedBytes,
      SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
      SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes,
      SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
    ];
  }

  /*
   * Whether a metric name belongs to OneUptime's session replay namespace.
   * Case-insensitive, because OTLP ingest lowercases names before storing
   * them: a name that only differs in case would land on the same series.
   */
  public static isReservedMetricName(name: string | null | undefined): boolean {
    if (typeof name !== "string") {
      return false;
    }

    return name.toLowerCase().startsWith(SESSION_REPLAY_METRIC_NAME_PREFIX);
  }

  public static getTitle(metricType: SessionReplayBudgetMetricType): string {
    switch (metricType) {
      case SessionReplayBudgetMetricType.ProjectDailyUsedBytes:
        return "Project Bytes Today";
      case SessionReplayBudgetMetricType.ProjectDailyUsedPercent:
        return "Project Daily Budget Used";
      case SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes:
        return "Application Bytes This Month";
      case SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent:
        return "Application Monthly Budget Used";
      default:
        throw new Error("Invalid SessionReplayBudgetMetricType value");
    }
  }

  /*
   * Doubles as the MetricType catalog description, so it has to make sense to
   * someone who finds the series in a metric picker with no Health page in
   * front of them - including why the project series must not be summed.
   */
  public static getDescription(
    metricType: SessionReplayBudgetMetricType,
  ): string {
    /*
     * "Usage", not the value: a percent point is posted with the bytes point,
     * and a few kilobytes of a gigabyte round down to 0.00.
     */
    const everyInterval: string = `Written every ${SESSION_REPLAY_BUDGET_METRIC_INTERVAL_MINUTES} minutes while usage is above zero`;
    const sharedByApplications: string =
      "with the same value on every application that records (session replay on): aggregate with Max, never Sum";

    switch (metricType) {
      case SessionReplayBudgetMetricType.ProjectDailyUsedBytes:
        return `Session replay upload bytes counted against the project's daily limit since 00:00 UTC, all applications together, as the recorders sent them (usually compressed). ${everyInterval}, ${sharedByApplications}.`;
      case SessionReplayBudgetMetricType.ProjectDailyUsedPercent:
        return `The project's session replay bytes today as a percent of this deployment's daily limit, rounded down to 0.01. At 100 or more, recorders are told to stop until 00:00 UTC. ${everyInterval}, ${sharedByApplications}.`;
      case SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes:
        return `Session replay upload bytes charged to this application's monthly budget since the 1st of the month (UTC), counted only while a budget is set. ${everyInterval}, and only for applications with a monthly budget.`;
      case SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent:
        return `This application's session replay bytes this month as a percent of its monthly budget, rounded down to 0.01. At 100 or more, its recorders are told to stop until the 1st of next month (UTC) or until the budget is raised. ${everyInterval}, and only for applications with a monthly budget.`;
      default:
        throw new Error("Invalid SessionReplayBudgetMetricType value");
    }
  }

  /*
   * The unit registered on the MetricType row. "By" is the OpenTelemetry
   * spelling of bytes, which the chart formatter scales into KB/MB/GB; the
   * percent series use "%" (not "1"), so nothing multiplies them by 100.
   */
  public static getUnit(metricType: SessionReplayBudgetMetricType): string {
    switch (metricType) {
      case SessionReplayBudgetMetricType.ProjectDailyUsedBytes:
      case SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes:
        return "By";
      case SessionReplayBudgetMetricType.ProjectDailyUsedPercent:
      case SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent:
        return "%";
      default:
        throw new Error("Invalid SessionReplayBudgetMetricType value");
    }
  }

  /*
   * Max for every series. A budget only ever climbs within its window, so the
   * highest point in a chart bucket is the latest reading. For the project
   * series, posted with one value under every recording application, Max
   * (like Avg or Min) reads that one value; Sum and Count would multiply it
   * by the number of applications.
   */
  public static getAggregationType(
    metricType: SessionReplayBudgetMetricType,
  ): AggregationType {
    switch (metricType) {
      case SessionReplayBudgetMetricType.ProjectDailyUsedBytes:
      case SessionReplayBudgetMetricType.ProjectDailyUsedPercent:
      case SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes:
      case SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent:
        return AggregationType.Max;
      default:
        throw new Error("Invalid SessionReplayBudgetMetricType value");
    }
  }

  // Whether the series is shared by every application of the project.
  public static isProjectScoped(
    metricType: SessionReplayBudgetMetricType,
  ): boolean {
    switch (metricType) {
      case SessionReplayBudgetMetricType.ProjectDailyUsedBytes:
      case SessionReplayBudgetMetricType.ProjectDailyUsedPercent:
        return true;
      case SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes:
      case SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent:
        return false;
      default:
        throw new Error("Invalid SessionReplayBudgetMetricType value");
    }
  }
}

export default SessionReplayBudgetMetricTypeUtil;
