import AlertMetricType from "Common/Types/Alerts/AlertMetricType";
import Search from "Common/Types/BaseDatabase/Search";
import IncidentMetricType from "Common/Types/Incident/IncidentMetricType";
import MetricQueryConfigData, {
  MetricChartType,
} from "Common/Types/Metrics/MetricQueryConfigData";
import ObjectID from "Common/Types/ObjectID";
import SloMetricType from "Common/Types/ServiceLevelObjective/SloMetricType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import AlertMetricTypeUtil from "Common/Utils/Alerts/AlertMetricType";
import IncidentMetricTypeUtil from "Common/Utils/Incident/IncidentMetricType";
import { SLO_CURRENT_BURN_RATE_WINDOW_MINUTES } from "Common/Utils/Slo/SloEvaluation";
import SloMetricTypeUtil, {
  SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE,
  SLO_METRIC_PROJECT_ID_ATTRIBUTE,
  SLO_METRIC_SLO_ID_ATTRIBUTE,
} from "Common/Utils/Slo/SloMetricType";

/*
 * Everything the SLO Metrics page asks the metric store for, as plain data.
 *
 * Kept out of the .tsx components on purpose: no React, no RouteMap, no
 * ProjectUtil (the caller passes the project id), so App's plain-node suites
 * can import these builders and pin the exact queries - the metric names, the
 * attribute each tab filters on, the misspelled `aggegationType` key the
 * query layer expects - without a renderer.
 */

export enum SloMetricsTab {
  SloMetrics = "SLO Metrics",
  ErrorBudgetHistory = "Error Budget History",
  IncidentMetrics = "Incident Metrics",
  AlertMetrics = "Alert Metrics",
}

// The order the Metrics page shows its tabs in.
export const SLO_METRICS_TABS: ReadonlyArray<SloMetricsTab> = [
  SloMetricsTab.SloMetrics,
  SloMetricsTab.ErrorBudgetHistory,
  SloMetricsTab.IncidentMetrics,
  SloMetricsTab.AlertMetrics,
];

/*
 * An SLO posts one point per evaluation (every few minutes), so a day shows
 * a few hundred points of shape; an hour, the monitor default, shows a dozen.
 */
export const SLO_METRICS_DEFAULT_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_DAY,
};

/*
 * Incidents and alerts that affect one SLO are rare by design - a burn-rate
 * rule fires when the budget is genuinely at risk - so a one-day window is
 * almost always an empty bar chart. A week shows whether it happens at all.
 */
export const SLO_EVENT_METRICS_DEFAULT_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_WEEK,
};

/*
 * The target is a reference, not a signal: amber and drawn over the SLI's own
 * panel, the same colour the Error Budget History charts use for the target
 * line, so "below the line" reads the same on both tabs.
 */
export const SLO_TARGET_SERIES_COLOR: string = "#f59e0b";

export interface SloMetricCategory {
  id: string;
  title: string;
  description: string;
  metrics: Array<SloMetricType>;
}

export interface SloMetricsCardCopy {
  title: string;
  description: string;
}

export type GetSloMetricCategoriesFunction = () => Array<SloMetricCategory>;

export const getSloMetricCategories: GetSloMetricCategoriesFunction =
  (): Array<SloMetricCategory> => {
    return [
      {
        id: "objective",
        title: "Objective",
        description:
          "The SLI against its target, and the share of the error budget still unspent. Metrics follow the monitor metric retention; Error Budget History keeps the long-range view.",
        metrics: [
          SloMetricType.SliPercent,
          SloMetricType.TargetPercent,
          SloMetricType.ErrorBudgetRemainingPercent,
        ],
      },
      {
        id: "burn",
        title: "Burn",
        description: `How fast the error budget is being spent over the trailing ${SLO_CURRENT_BURN_RATE_WINDOW_MINUTES} minutes, and how much downtime the SLO can still absorb before it breaches.`,
        metrics: [
          SloMetricType.BurnRate,
          SloMetricType.ErrorBudgetRemainingSeconds,
        ],
      },
      {
        id: "status",
        title: "Status",
        description:
          "The SLO's status at each evaluation - Healthy, At Risk or Budget Exhausted. Paused and misconfigured evaluations leave a gap.",
        metrics: [SloMetricType.Status],
      },
    ];
  };

/*
 * Series drawn on the panel of the series right before them instead of on a
 * panel of their own: the target belongs over the SLI it is measured against.
 * Only applied when the two are adjacent in a card, which is how
 * MetricCharts chains overlays.
 */
const OVERLAID_ON: Partial<Record<SloMetricType, SloMetricType>> = {
  [SloMetricType.TargetPercent]: SloMetricType.SliPercent,
};

export type BuildSloMetricQueryConfigsFunction = (data: {
  sloId: ObjectID;
  projectId: string;
  metrics: Array<SloMetricType>;
}) => Array<MetricQueryConfigData>;

export const buildSloMetricQueryConfigs: BuildSloMetricQueryConfigsFunction =
  (data: {
    sloId: ObjectID;
    projectId: string;
    metrics: Array<SloMetricType>;
  }): Array<MetricQueryConfigData> => {
    return data.metrics.map(
      (metricType: SloMetricType, index: number): MetricQueryConfigData => {
        const queryConfig: MetricQueryConfigData = {
          // Stable per series, so per-chart UI state survives a re-render.
          id: `slo-metric-${metricType}`,
          metricAliasData: {
            metricVariable: metricType,
            title: SloMetricTypeUtil.getTitle(metricType),
            description: SloMetricTypeUtil.getDescription(metricType),
            legend: SloMetricTypeUtil.getLegend(metricType),
            legendUnit: SloMetricTypeUtil.getLegendUnit(metricType),
          },
          metricQueryData: {
            filterData: {
              metricName: metricType,
              /*
               * Filter on the SLO id, never the name: renaming an SLO must
               * not split or empty its charts.
               */
              attributes: {
                [SLO_METRIC_SLO_ID_ATTRIBUTE]: data.sloId.toString(),
                [SLO_METRIC_PROJECT_ID_ATTRIBUTE]: data.projectId,
              },
              aggegationType: SloMetricTypeUtil.getAggregationType(metricType),
            },
            /*
             * No group-by: an SLO's series has no dimension that varies
             * between its rows except labels and name, and grouping on those
             * would split one line into several when either is edited.
             */
            groupBy: undefined,
          },
        };

        const overlaidOn: SloMetricType | undefined = OVERLAID_ON[metricType];

        if (overlaidOn && index > 0 && data.metrics[index - 1] === overlaidOn) {
          queryConfig.overlayWithPreviousQuery = true;
          queryConfig.color = SLO_TARGET_SERIES_COLOR;
        }

        if (metricType === SloMetricType.Status) {
          // "At Risk" on the axis, not "1".
          queryConfig.yAxisValueFormatter =
            SloMetricTypeUtil.formatStatusMetricValue;
        }

        return queryConfig;
      },
    );
  };

export const SLO_INCIDENT_METRICS_CARD: SloMetricsCardCopy = {
  title: "Incident Metrics",
  description:
    "Incidents affecting this SLO - count, time to acknowledge, time to resolve and duration. Incidents declared by this SLO's burn rate rules are included automatically.",
};

export const SLO_ALERT_METRICS_CARD: SloMetricsCardCopy = {
  title: "Alert Metrics",
  description:
    "Alerts affecting this SLO - count, time to acknowledge, time to resolve and duration. Alerts raised by this SLO's burn rate rules are included automatically.",
};

/*
 * The incident and alert metric utils describe their series "for this
 * monitor"; on an SLO page that would be wrong, so the SLO wording lives here.
 */
export type GetSloIncidentMetricDescriptionFunction = (
  metricType: IncidentMetricType,
) => string;

export const getSloIncidentMetricDescription: GetSloIncidentMetricDescriptionFunction =
  (metricType: IncidentMetricType): string => {
    switch (metricType) {
      case IncidentMetricType.IncidentCount:
        return "The number of incidents affecting this SLO over time.";
      case IncidentMetricType.TimeToAcknowledge:
        return "The average time taken to acknowledge incidents affecting this SLO.";
      case IncidentMetricType.TimeToResolve:
        return "The average time taken to resolve incidents affecting this SLO.";
      case IncidentMetricType.IncidentDuration:
        return "The average duration of incidents affecting this SLO.";
      default:
        return `${IncidentMetricTypeUtil.getTitleByIncidentMetricType(metricType)} for incidents affecting this SLO.`;
    }
  };

export type GetSloAlertMetricDescriptionFunction = (
  metricType: AlertMetricType,
) => string;

export const getSloAlertMetricDescription: GetSloAlertMetricDescriptionFunction =
  (metricType: AlertMetricType): string => {
    switch (metricType) {
      case AlertMetricType.AlertCount:
        return "The number of alerts affecting this SLO over time.";
      case AlertMetricType.TimeToAcknowledge:
        return "The average time taken to acknowledge alerts affecting this SLO.";
      case AlertMetricType.TimeToResolve:
        return "The average time taken to resolve alerts affecting this SLO.";
      case AlertMetricType.AlertDuration:
        return "The average duration of alerts affecting this SLO.";
      default:
        return `${AlertMetricTypeUtil.getTitleByAlertMetricType(metricType)} for alerts affecting this SLO.`;
    }
  };

export type BuildSloEventMetricQueryConfigsFunction = (data: {
  sloId: ObjectID;
  projectId: string;
}) => Array<MetricQueryConfigData>;

/*
 * Incident metrics carry the affected SLOs as a comma-joined
 * serviceLevelObjectiveIds attribute (IncidentService), so the SLO id is
 * matched with a substring Search - the monitorIds pattern a monitor's
 * Incident Metrics tab uses.
 */
export const buildSloIncidentMetricQueryConfigs: BuildSloEventMetricQueryConfigsFunction =
  (data: {
    sloId: ObjectID;
    projectId: string;
  }): Array<MetricQueryConfigData> => {
    return IncidentMetricTypeUtil.getAllIncidentMetricTypes().map(
      (metricType: IncidentMetricType): MetricQueryConfigData => {
        return {
          id: `slo-incident-metric-${metricType}`,
          metricAliasData: {
            metricVariable: metricType,
            title:
              IncidentMetricTypeUtil.getTitleByIncidentMetricType(metricType),
            description: getSloIncidentMetricDescription(metricType),
            legend:
              IncidentMetricTypeUtil.getLegendByIncidentMetricType(metricType),
            legendUnit:
              IncidentMetricTypeUtil.getLegendUnitByIncidentMetricType(
                metricType,
              ),
          },
          metricQueryData: {
            filterData: {
              metricName: metricType,
              attributes: {
                [SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE]: new Search(
                  data.sloId.toString(),
                ),
                projectId: data.projectId,
              },
              aggegationType:
                IncidentMetricTypeUtil.getAggregationTypeByIncidentMetricType(
                  metricType,
                ),
            },
            groupBy: undefined,
          },
          chartType: MetricChartType.BAR,
        };
      },
    );
  };

// Same shape as the incident builder; AlertService stamps the same key.
export const buildSloAlertMetricQueryConfigs: BuildSloEventMetricQueryConfigsFunction =
  (data: {
    sloId: ObjectID;
    projectId: string;
  }): Array<MetricQueryConfigData> => {
    return AlertMetricTypeUtil.getAllAlertMetricTypes().map(
      (metricType: AlertMetricType): MetricQueryConfigData => {
        return {
          id: `slo-alert-metric-${metricType}`,
          metricAliasData: {
            metricVariable: metricType,
            title: AlertMetricTypeUtil.getTitleByAlertMetricType(metricType),
            description: getSloAlertMetricDescription(metricType),
            legend: AlertMetricTypeUtil.getLegendByAlertMetricType(metricType),
            legendUnit:
              AlertMetricTypeUtil.getLegendUnitByAlertMetricType(metricType),
          },
          metricQueryData: {
            filterData: {
              metricName: metricType,
              attributes: {
                [SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE]: new Search(
                  data.sloId.toString(),
                ),
                projectId: data.projectId,
              },
              aggegationType:
                AlertMetricTypeUtil.getAggregationTypeByAlertMetricType(
                  metricType,
                ),
            },
            groupBy: undefined,
          },
          chartType: MetricChartType.BAR,
        };
      },
    );
  };
