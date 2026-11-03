import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import { EvaluateOverTimeType, FilterType } from "./CriteriaFilter";
import MonitorType from "./MonitorType";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import {
  DATA_PIPELINE_METRICS,
  DataPipelineAttribute,
  DataPipelineMetricDefinition,
  DataPipelineMetricName,
} from "../DataObservability/DataPipelineMetric";
import { UNUSUALLY_LONG_RATIO } from "../DataObservability/DataPipelineSchedule";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
  getRecoveryFilterType,
} from "./Recommendation/RecommendationCriteriaBuilder";

/*
 * The curated alert library for ONE data pipeline (a DataPipeline row), from
 * the oneuptime.data.pipeline.* metrics its OpenLineage runs write as they
 * end, and the five-minute schedule check writes between them. Each template
 * is a Metrics monitor whose query filters `oneuptime.data.pipeline.id =
 * <pipeline id>`, so it watches that pipeline and nothing else.
 *
 *  - RUNS: "Pipeline Run Failed" fires on a run that failed or was aborted.
 *    "Pipeline Run Unusually Long" fires on a run taking twice its typical
 *    time - the median of the pipeline's last 20 completed runs - while it is
 *    still running, or as it ends. A run is an event: each fires on the run
 *    that breached and clears an hour after it.
 *  - SCHEDULE: "Pipeline Is Late" fires when no run has started for longer
 *    than the pipeline's schedule allows - learned from its own runs, so it
 *    fits a job that runs every five minutes and one that runs nightly
 *    (DataPipelineSchedule).
 */

// The attribute every query is scoped by: this pipeline's runs and nothing else.
export const DATA_PIPELINE_ID_SCOPE_ATTRIBUTE: string =
  DataPipelineAttribute.PipelineId;

export type DataPipelineAlertTemplateCategory = "Runs" | "Schedule";

export type DataPipelineAlertTemplateSeverity = "Critical" | "Warning";

export interface DataPipelineAlertTemplateArgs {
  dataPipelineId: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface DataPipelineAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: DataPipelineAlertTemplateCategory;
  severity: DataPipelineAlertTemplateSeverity;
  monitorType: MonitorType;
  metricName: DataPipelineMetricName;
  getMonitorStep: (args: DataPipelineAlertTemplateArgs) => MonitorStep;
}

const METRIC_ALIAS: string = "pipeline";

interface PipelineTemplateSpec {
  id: string;
  name: string;
  description: string;
  category: DataPipelineAlertTemplateCategory;
  severity: DataPipelineAlertTemplateSeverity;
  metricName: DataPipelineMetricName;
  aggregationType: MetricsAggregationType;
  rollingTime: RollingTime;
  filterType: FilterType;
  threshold: number;
  // AnyValue for a run, an event; AllValues for lateness, a state.
  evaluation: EvaluateOverTimeType;
  criteriaName: string;
  criteriaDescription: string;
  incidentDescription: string;
}

function getMetricUnit(metricName: DataPipelineMetricName): string {
  return (
    DATA_PIPELINE_METRICS.find((metric: DataPipelineMetricDefinition) => {
      return metric.name === metricName;
    })?.unit || ""
  );
}

function buildTemplate(spec: PipelineTemplateSpec): DataPipelineAlertTemplate {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    category: spec.category,
    severity: spec.severity,
    monitorType: MonitorType.Metrics,
    metricName: spec.metricName,
    getMonitorStep: (args: DataPipelineAlertTemplateArgs): MonitorStep => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorName: args.monitorName,
        monitorType: MonitorType.Metrics,
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        defaultIncidentSeverityId: args.defaultIncidentSeverityId,
        defaultAlertSeverityId: args.defaultAlertSeverityId,
      });

      step.setMetricMonitor({
        rollingTime: spec.rollingTime,
        metricViewConfig: {
          queryConfigs: [
            {
              metricAliasData: {
                metricVariable: METRIC_ALIAS,
                title: spec.name,
                description: spec.name,
                legend: spec.name,
                legendUnit: getMetricUnit(spec.metricName),
              },
              metricQueryData: {
                filterData: {
                  metricName: spec.metricName,
                  attributes: {
                    [DATA_PIPELINE_ID_SCOPE_ATTRIBUTE]: args.dataPipelineId,
                  },
                  aggegationType: spec.aggregationType,
                  aggregateBy: {},
                },
              },
            },
          ],
          formulaConfigs: [],
        },
      });

      const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance(
        {
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          incidentSeverityId: args.defaultIncidentSeverityId,
          alertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
          metricAlias: METRIC_ALIAS,
          filterType: spec.filterType,
          value: spec.threshold,
          incidentTitle: `[Data] ${spec.name} - ${args.monitorName}`,
          incidentDescription: spec.incidentDescription,
          criteriaName: spec.criteriaName,
          criteriaDescription: spec.criteriaDescription,
          resourceNoun: "pipeline",
          metricAggregationType: spec.evaluation,
        },
      );

      // Recovered once every value is back on the healthy side of the threshold.
      const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        metricAlias: METRIC_ALIAS,
        filterType: getRecoveryFilterType(spec.filterType),
        value: spec.threshold,
        recoveryValue: spec.threshold,
        metricAggregationType: EvaluateOverTimeType.AllValues,
      });

      const criteria: MonitorCriteria = new MonitorCriteria();
      criteria.data = { monitorCriteriaInstanceArray: [unhealthy, healthy] };
      step.setMonitorCriteria(criteria);

      return step;
    },
  };
}

const runFailedTemplate: DataPipelineAlertTemplate = buildTemplate({
  id: "data-pipeline-run-failed",
  name: "Pipeline Run Failed",
  description:
    "Alert when a run of the pipeline fails or is aborted. The run's page shows the error it reported and the tables it should have written.",
  category: "Runs",
  severity: "Critical",
  metricName: DataPipelineMetricName.RunFailed,
  aggregationType: MetricsAggregationType.Max,
  rollingTime: RollingTime.Past1Hour,
  filterType: FilterType.GreaterThan,
  threshold: 0,
  evaluation: EvaluateOverTimeType.AnyValue,
  criteriaName: "A run failed",
  criteriaDescription:
    "Triggers when a run of the pipeline in the last hour failed or was aborted.",
  incidentDescription:
    "A run of the pipeline failed or was aborted. The pipeline's page in Data Observability shows the run's error, and the tables it should have written - which are now stale.",
});

const runUnusuallyLongTemplate: DataPipelineAlertTemplate = buildTemplate({
  id: "data-pipeline-run-unusually-long",
  name: "Pipeline Run Unusually Long",
  description:
    "Alert when a run takes twice as long as the pipeline's runs usually do - the median of its last 20 completed runs - while it is still running, so a run that hangs is seen before it ends. Learns from five completed runs.",
  category: "Runs",
  severity: "Warning",
  metricName: DataPipelineMetricName.RunDurationRatio,
  aggregationType: MetricsAggregationType.Max,
  rollingTime: RollingTime.Past1Hour,
  filterType: FilterType.GreaterThanOrEqualTo,
  threshold: UNUSUALLY_LONG_RATIO,
  evaluation: EvaluateOverTimeType.AnyValue,
  criteriaName: "A run took unusually long",
  criteriaDescription:
    "Triggers when a run of the pipeline has taken twice its typical time or more.",
  incidentDescription:
    "A run of the pipeline has taken at least twice as long as its runs usually do. Look for more data than usual, a slower source, a lock, or contention on the database it reads or writes. The pipeline's page in Data Observability shows its runs and their durations.",
});

const pipelineIsLateTemplate: DataPipelineAlertTemplate = buildTemplate({
  id: "data-pipeline-late",
  name: "Pipeline Is Late",
  description:
    "Alert when no run of the pipeline has started for longer than its schedule allows - learned from its own runs, with a quarter of its interval and at least fifteen minutes of slack. Learns from five runs.",
  category: "Schedule",
  severity: "Critical",
  metricName: DataPipelineMetricName.OverdueSeconds,
  aggregationType: MetricsAggregationType.Min,
  rollingTime: RollingTime.Past15Minutes,
  filterType: FilterType.GreaterThan,
  threshold: 0,
  evaluation: EvaluateOverTimeType.AllValues,
  criteriaName: "The pipeline is late",
  criteriaDescription:
    "Triggers when the pipeline stays past the time its next run should have started by for fifteen minutes.",
  incidentDescription:
    "No run of the pipeline has started for longer than its schedule allows, so the tables it writes are going stale. Check its scheduler: whether the job is paused, queued behind another, or failing to start. The pipeline's page in Data Observability shows its last run and how often it usually runs.",
});

const DATA_PIPELINE_ALERT_TEMPLATES: ReadonlyArray<DataPipelineAlertTemplate> =
  [runFailedTemplate, runUnusuallyLongTemplate, pipelineIsLateTemplate];

export function getAllDataPipelineAlertTemplates(): Array<DataPipelineAlertTemplate> {
  return [...DATA_PIPELINE_ALERT_TEMPLATES];
}

export function getDataPipelineAlertTemplate(
  id: string,
): DataPipelineAlertTemplate | undefined {
  return DATA_PIPELINE_ALERT_TEMPLATES.find(
    (template: DataPipelineAlertTemplate) => {
      return template.id === id;
    },
  );
}
