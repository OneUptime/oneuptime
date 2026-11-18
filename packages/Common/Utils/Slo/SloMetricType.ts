import AggregationType from "../../Types/BaseDatabase/AggregationType";
import SloMetricType from "../../Types/ServiceLevelObjective/SloMetricType";
import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";
import { translationKey } from "../../Types/Translator";

/*
 * Display and catalog metadata for the `oneuptime.slo.*` metrics the SLO
 * evaluation worker posts (Common/Server/Utils/Slo/SloMetricUtil).
 *
 * One table for both sides of the metric store: the server registers each
 * name's MetricType row (description + unit) from here, and the dashboard's
 * SLO Metrics page titles, legends and aggregates the same series from here.
 * A unit spelled once cannot disagree between the catalog and the chart.
 *
 * React-free and import-light on purpose: the worker, the dashboard and plain
 * node tests all load it.
 *
 * A title, a legend and a description are keys of the Dashboard's locales
 * (translationKey; this file is a `keys` root of its extractor): the SLO
 * Metrics page looks each up once where it builds the chart's query
 * (SloMetricsQueryConfig, #8282), and the metrics list a description the
 * server stored from here. The Burn Rate description carries its window,
 * so the page words it as a sentence of its own.
 */

/*
 * Attribute keys stamped on every SLO metric row. Bare keys with string
 * values, exactly like `monitorId` / `monitorName` on monitor metrics, so the
 * same filters and dashboard variables work on both.
 */
export const SLO_METRIC_SLO_ID_ATTRIBUTE: string = "sloId";
export const SLO_METRIC_SLO_NAME_ATTRIBUTE: string = "sloName";
export const SLO_METRIC_PROJECT_ID_ATTRIBUTE: string = "projectId";

/*
 * Attribute keys IncidentService and AlertService stamp on incident and alert
 * metrics for the SLOs the incident or alert affects - comma-joined, like
 * `monitorIds`, because one incident can affect several SLOs. The SLO Metrics
 * page filters its Incident and Alert tabs on the ids key, so the writer and
 * the reader share the spelling through these constants.
 */
export const SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE: string =
  "serviceLevelObjectiveIds";
export const SERVICE_LEVEL_OBJECTIVE_NAMES_METRIC_ATTRIBUTE: string =
  "serviceLevelObjectiveNames";

/*
 * Numeric encoding of the Status series. Ordered by severity so the Max
 * aggregation surfaces the worst state inside a chart bucket. Waiting,
 * Misconfigured and Paused have no entry: those guard paths measure nothing,
 * so they post no point rather than a number that would read as a real
 * health state.
 */
const STATUS_METRIC_VALUES: Array<{ status: SloStatus; value: number }> = [
  { status: SloStatus.Healthy, value: 0 },
  { status: SloStatus.AtRisk, value: 1 },
  { status: SloStatus.BudgetExhausted, value: 2 },
];

class SloMetricTypeUtil {
  /*
   * Every SLO metric, in the order the Metrics page shows them. The emitter
   * walks this list, so a member missing here is a member never written -
   * SloMetricType.test.ts pins it against the enum.
   */
  public static getAll(): Array<SloMetricType> {
    return [
      SloMetricType.SliPercent,
      SloMetricType.TargetPercent,
      SloMetricType.ErrorBudgetRemainingPercent,
      SloMetricType.ErrorBudgetRemainingSeconds,
      SloMetricType.BurnRate,
      SloMetricType.Status,
    ];
  }

  public static getAggregationType(metricType: SloMetricType): AggregationType {
    switch (metricType) {
      /*
       * Instantaneous gauges re-computed every evaluation: averaging the
       * points that fall into one chart bucket is the honest roll-up, and
       * matches what the SloHistory charts have always drawn.
       */
      case SloMetricType.SliPercent:
      case SloMetricType.TargetPercent:
      case SloMetricType.ErrorBudgetRemainingPercent:
      case SloMetricType.ErrorBudgetRemainingSeconds:
        return AggregationType.Avg;
      /*
       * A burn-rate spike or a short trip into Budget Exhausted is exactly
       * the thing a coarse bucket must not average away.
       */
      case SloMetricType.BurnRate:
      case SloMetricType.Status:
        return AggregationType.Max;
      default:
        throw new Error("Invalid SloMetricType value");
    }
  }

  public static getTitle(metricType: SloMetricType): string {
    switch (metricType) {
      case SloMetricType.SliPercent:
        return translationKey("SLI");
      case SloMetricType.TargetPercent:
        return translationKey("Target");
      case SloMetricType.ErrorBudgetRemainingPercent:
        return translationKey("Error Budget Remaining");
      case SloMetricType.ErrorBudgetRemainingSeconds:
        return translationKey("Error Budget Remaining Time");
      case SloMetricType.BurnRate:
        return translationKey("Burn Rate");
      case SloMetricType.Status:
        return translationKey("Status");
      default:
        throw new Error("Invalid SloMetricType value");
    }
  }

  /*
   * Doubles as the MetricType catalog description, so it describes the
   * series for anyone who finds it in a dashboard picker - not only for
   * someone already looking at one SLO.
   */
  public static getDescription(metricType: SloMetricType): string {
    switch (metricType) {
      case SloMetricType.SliPercent:
        return translationKey(
          "Service Level Indicator over the SLO's compliance window: the percentage of measured time that counted as good.",
        );
      case SloMetricType.TargetPercent:
        return translationKey(
          "The objective the SLI is measured against. Charted with the SLI so a dip below the target reads at a glance.",
        );
      case SloMetricType.ErrorBudgetRemainingPercent:
        return translationKey(
          "Share of the error budget still unspent in the compliance window. Negative once the budget is overspent.",
        );
      case SloMetricType.ErrorBudgetRemainingSeconds:
        return translationKey(
          "Downtime the SLO can still absorb in its compliance window before it breaches. Negative once the budget is overspent.",
        );
      case SloMetricType.BurnRate:
        /*
         * Written out whole, for the window SLO_CURRENT_BURN_RATE_WINDOW_MINUTES
         * holds (60), so the series' stored description is a key the
         * metrics list words (#8356). SloBurnRateDescriptionWindow holds the
         * two together.
         */
        return translationKey(
          "How fast the error budget is being spent, measured over the trailing 60 minutes. 1x spends the budget exactly over the compliance window; anything higher exhausts it early.",
        );
      case SloMetricType.Status:
        return translationKey(
          "The SLO's status at each evaluation: 0 = Healthy, 1 = At Risk, 2 = Budget Exhausted. Paused and misconfigured evaluations record no point.",
        );
      default:
        throw new Error("Invalid SloMetricType value");
    }
  }

  public static getLegend(metricType: SloMetricType): string {
    switch (metricType) {
      case SloMetricType.SliPercent:
        return translationKey("SLI");
      case SloMetricType.TargetPercent:
        return translationKey("Target");
      case SloMetricType.ErrorBudgetRemainingPercent:
        return translationKey("Budget Remaining");
      case SloMetricType.ErrorBudgetRemainingSeconds:
        return translationKey("Budget Remaining");
      case SloMetricType.BurnRate:
        return translationKey("Burn Rate");
      case SloMetricType.Status:
        return translationKey("Status");
      default:
        throw new Error("Invalid SloMetricType value");
    }
  }

  /*
   * The unit registered on the MetricType row. "seconds" is the spelling the
   * incident and alert duration metrics already use, which the chart value
   * formatter scales into minutes, hours and days.
   */
  public static getUnit(metricType: SloMetricType): string {
    switch (metricType) {
      case SloMetricType.SliPercent:
      case SloMetricType.TargetPercent:
      case SloMetricType.ErrorBudgetRemainingPercent:
        return "%";
      case SloMetricType.ErrorBudgetRemainingSeconds:
        return "seconds";
      case SloMetricType.BurnRate:
        return "x";
      case SloMetricType.Status:
        return "";
      default:
        throw new Error("Invalid SloMetricType value");
    }
  }

  /*
   * Deliberately the catalog unit, never a separately maintained string: a
   * chart that labelled the series differently from the MetricType row would
   * make a dashboard built from the picker disagree with the SLO page.
   */
  public static getLegendUnit(metricType: SloMetricType): string {
    return SloMetricTypeUtil.getUnit(metricType);
  }

  /*
   * The value posted on the Status series, or null for a status that must not
   * post one (the Waiting, Misconfigured and Paused guards, and a status the
   * worker has not computed yet).
   */
  public static getStatusMetricValue(
    status: SloStatus | undefined | null,
  ): number | null {
    for (const entry of STATUS_METRIC_VALUES) {
      if (entry.status === status) {
        return entry.value;
      }
    }

    return null;
  }

  /*
   * The inverse of getStatusMetricValue, for chart axes and tooltips. A
   * bucket value can be fractional when a dashboard re-aggregates the series
   * with Avg, so it rounds to the nearest state instead of reading as none.
   */
  public static getStatusFromMetricValue(value: number): SloStatus | null {
    if (typeof value !== "number" || !isFinite(value)) {
      return null;
    }

    const roundedValue: number = Math.round(value);

    for (const entry of STATUS_METRIC_VALUES) {
      if (entry.value === roundedValue) {
        return entry.status;
      }
    }

    return null;
  }

  // Axis / tooltip text for the Status series: "At Risk" rather than "1".
  public static formatStatusMetricValue(value: number): string {
    const status: SloStatus | null =
      SloMetricTypeUtil.getStatusFromMetricValue(value);

    if (status) {
      return status;
    }

    return typeof value === "number" && isFinite(value) ? String(value) : "";
  }
}

export default SloMetricTypeUtil;
