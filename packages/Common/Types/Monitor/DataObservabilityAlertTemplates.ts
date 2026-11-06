import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import {
  AnomalyDetectionSensitivity,
  EvaluateOverTimeType,
  FilterType,
  MetricAnomalyDetectionOptions,
} from "./CriteriaFilter";
import MonitorType from "./MonitorType";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import MetricQueryConfigData from "../Metrics/MetricQueryConfigData";
import {
  DataObservabilityAttribute,
  DataObservabilityMetricName,
  getDataObservabilityMetric,
} from "../DataObservability/DataObservabilityMetric";
import {
  buildHealthyCriteriaInstance,
  buildStoppedReportingCriteriaInstances,
  buildUnhealthyCriteriaInstance,
  getRecoveryFilterType,
} from "./Recommendation/RecommendationCriteriaBuilder";

/*
 * The curated alert library for ONE data store's tables (a DataStore row
 * whose tables Data Observability watches), built from the
 * oneuptime.data.table.* metrics every collection writes, one series per
 * table (Server/Utils/DataObservability/TableHealthIngest).
 *
 * WHY THESE ARE METRICS MONITORS
 *
 * Table health is ordinary metrics, so a store's alerts are plain
 * `MonitorType.Metrics` monitors - the same pattern as the Database and
 * Service libraries - and get the generic metric evaluator, the learned
 * baselines, maintenance windows, status pages and SLOs for free. No
 * monitor type of its own, and nothing new to evaluate.
 *
 * ONE MONITOR PER STORE, ONE ALERT PER TABLE
 *
 * Every query filters `oneuptime.data.store.id = <store id>`, so a monitor
 * watches that store's tables and nothing else, and groups by
 * `oneuptime.data.table.key` ("schema.table"), so the evaluator keeps one
 * series per table and opens one alert per table that breaches - named in
 * the alert's title (SeriesLabelDisplay knows the key as "Table") - which
 * resolves when that table recovers. A store with 3,000 tables is one
 * monitor, billed as one, not 3,000; and a table created next week is
 * watched the day it appears.
 *
 * THE CHECKS
 *
 *  - FRESHNESS: "Table Is Late" reads overdue_seconds, which collection
 *    works out by the same rule the catalog's Late pill uses (twice the
 *    table's learned interval, and at least fifteen minutes past it), so
 *    an alert fires exactly when the table turns Late on the page, from a
 *    table's first few changes. A table that never changes has no rhythm
 *    and is never called late.
 *  - VOLUME: "Row Count Fell Sharply" reads the change in rows between two
 *    collections (collection works it out: the monitor path has no delta),
 *    so a truncate or a bad delete alerts within minutes, from the first
 *    day. "Row Count Unusually Low" compares each table with its own
 *    learned baseline for that hour of the week, for the slow losses a
 *    single step does not show; it stays quiet for its first two weeks.
 *  - SCHEMA: "Schema Changed" fires on a collection that saw a column
 *    removed, renamed or retyped, so a migration that breaks readers is
 *    seen at once. An added column breaks nothing: it stays on the timeline.
 *  - COLLECTION: "Table Health Stopped Reporting" fires when no table of
 *    the store has been read for fifteen minutes - the database is down,
 *    its credentials changed, or the probe that reads it stopped - so a
 *    store never goes quietly unwatched.
 */

// The attribute every query is scoped by: the store's tables and nothing else.
export const DATA_STORE_ID_SCOPE_ATTRIBUTE: string =
  DataObservabilityAttribute.DataStoreId;

// The attribute every per-table query groups by: one series, and one alert, per table.
export const DATA_TABLE_GROUP_BY_ATTRIBUTE: string =
  DataObservabilityAttribute.TableKey;

export type DataObservabilityAlertTemplateCategory =
  | "Freshness"
  | "Volume"
  | "Schema"
  | "Collection";

export type DataObservabilityAlertTemplateSeverity = "Critical" | "Warning";

export interface DataObservabilityAlertTemplateArgs {
  // The DataStore row's id, as every collection stamps oneuptime.data.store.id.
  dataStoreId: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface DataObservabilityAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: DataObservabilityAlertTemplateCategory;
  severity: DataObservabilityAlertTemplateSeverity;
  // Always Metrics; carried per template the way the other libraries do.
  monitorType: MonitorType;
  // The metric the template's query reads.
  metricName: DataObservabilityMetricName;
  // Whether it compares each table with its own learned baseline, and so waits two weeks.
  isLearned: boolean;
  getMonitorStep: (args: DataObservabilityAlertTemplateArgs) => MonitorStep;
}

const METRIC_ALIAS: string = "table";
const ROW_COUNT_FELL_PERCENT: number = -50;

interface DataObservabilityTemplateSpec {
  id: string;
  name: string;
  description: string;
  category: DataObservabilityAlertTemplateCategory;
  severity: DataObservabilityAlertTemplateSeverity;
  metricName: DataObservabilityMetricName;
  aggregationType: MetricsAggregationType;
  rollingTime: RollingTime;
  /*
   * Per table (grouped by table key), or the store as one series - the
   * stopped-reporting check, where an empty window is the whole store gone
   * quiet.
   */
  isPerTable: boolean;
  criteria: {
    filterType: FilterType;
    threshold: number;
    // Sustained (All Values) unless the signal is a single event.
    evaluation: EvaluateOverTimeType;
    anomalyDetection?: MetricAnomalyDetectionOptions | undefined;
    criteriaName: string;
    criteriaDescription: string;
    incidentDescription: string;
    // The recovery comparison, when it is not the breach's complement.
    recovery?: { filterType: FilterType; threshold: number } | undefined;
  };
}

function buildQuery(data: {
  spec: DataObservabilityTemplateSpec;
  dataStoreId: string;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: METRIC_ALIAS,
      title: data.spec.name,
      description: data.spec.name,
      legend: data.spec.name,
      legendUnit: getDataObservabilityMetric(data.spec.metricName)?.unit || "",
    },
    metricQueryData: {
      filterData: {
        metricName: data.spec.metricName,
        attributes: {
          [DATA_STORE_ID_SCOPE_ATTRIBUTE]: data.dataStoreId,
        },
        aggegationType: data.spec.aggregationType,
        aggregateBy: {},
      },
      ...(data.spec.isPerTable
        ? { groupByAttributeKeys: [DATA_TABLE_GROUP_BY_ATTRIBUTE] }
        : {}),
    },
  };
}

function getIncidentTitle(
  spec: DataObservabilityTemplateSpec,
  args: DataObservabilityAlertTemplateArgs,
): string {
  return `[Data] ${spec.name} - ${args.monitorName}`;
}

function buildCriteria(
  spec: DataObservabilityTemplateSpec,
  args: DataObservabilityAlertTemplateArgs,
): MonitorCriteria {
  const criteria: DataObservabilityTemplateSpec["criteria"] = spec.criteria;

  const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
    offlineMonitorStatusId: args.offlineMonitorStatusId,
    incidentSeverityId: args.defaultIncidentSeverityId,
    alertSeverityId: args.defaultAlertSeverityId,
    monitorName: args.monitorName,
    metricAlias: METRIC_ALIAS,
    filterType: criteria.filterType,
    value: criteria.threshold,
    incidentTitle: getIncidentTitle(spec, args),
    incidentDescription: criteria.incidentDescription,
    criteriaName: criteria.criteriaName,
    criteriaDescription: criteria.criteriaDescription,
    resourceNoun: "table",
    metricAggregationType: criteria.evaluation,
    anomalyDetection: criteria.anomalyDetection,
  });

  /*
   * Recovery mirrors the breach - the complementary comparison, sustained -
   * except for an anomaly check, where anything that is not anomalous is
   * healthy (the unhealthy criteria is evaluated first).
   */
  const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
    onlineMonitorStatusId: args.onlineMonitorStatusId,
    metricAlias: METRIC_ALIAS,
    filterType:
      criteria.recovery?.filterType ||
      getRecoveryFilterType(criteria.filterType),
    value: criteria.recovery?.threshold ?? criteria.threshold,
    recoveryValue: criteria.recovery?.threshold,
    metricAggregationType: EvaluateOverTimeType.AllValues,
  });

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return monitorCriteria;
}

function buildStoppedReportingCriteria(
  spec: DataObservabilityTemplateSpec,
  args: DataObservabilityAlertTemplateArgs,
): MonitorCriteria {
  const instances: {
    offlineCriteriaInstance: MonitorCriteriaInstance;
    onlineCriteriaInstance: MonitorCriteriaInstance;
  } = buildStoppedReportingCriteriaInstances({
    onlineMonitorStatusId: args.onlineMonitorStatusId,
    offlineMonitorStatusId: args.offlineMonitorStatusId,
    incidentSeverityId: args.defaultIncidentSeverityId,
    alertSeverityId: args.defaultAlertSeverityId,
    monitorName: args.monitorName,
    metricAlias: METRIC_ALIAS,
    resourceNoun: "data store",
    incidentTitle: getIncidentTitle(spec, args),
    incidentDescription: spec.criteria.incidentDescription,
    criteriaName: spec.criteria.criteriaName,
    criteriaDescription: spec.criteria.criteriaDescription,
  });

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [
      instances.offlineCriteriaInstance,
      instances.onlineCriteriaInstance,
    ],
  };

  return monitorCriteria;
}

function buildTemplate(
  spec: DataObservabilityTemplateSpec,
): DataObservabilityAlertTemplate {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    category: spec.category,
    severity: spec.severity,
    monitorType: MonitorType.Metrics,
    metricName: spec.metricName,
    isLearned: Boolean(spec.criteria.anomalyDetection),
    getMonitorStep: (args: DataObservabilityAlertTemplateArgs): MonitorStep => {
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
          queryConfigs: [buildQuery({ spec, dataStoreId: args.dataStoreId })],
          formulaConfigs: [],
        },
      });

      step.setMonitorCriteria(
        spec.isPerTable
          ? buildCriteria(spec, args)
          : buildStoppedReportingCriteria(spec, args),
      );

      return step;
    },
  };
}

const tableIsLateTemplate: DataObservabilityAlertTemplate = buildTemplate({
  id: "data-store-table-late",
  name: "Table Is Late",
  description:
    "Alert when a table has gone longer without a change than its own rhythm allows - twice its usual interval, and at least fifteen minutes past it. Works from a table's first few changes.",
  category: "Freshness",
  severity: "Critical",
  metricName: DataObservabilityMetricName.OverdueSeconds,
  aggregationType: MetricsAggregationType.Min,
  rollingTime: RollingTime.Past15Minutes,
  isPerTable: true,
  criteria: {
    filterType: FilterType.GreaterThan,
    threshold: 0,
    evaluation: EvaluateOverTimeType.AllValues,
    criteriaName: "A table is late",
    criteriaDescription:
      "Triggers when a table stays past the time it usually changes by for fifteen minutes.",
    incidentDescription:
      "A table has not changed for longer than it usually goes without a change. Check the job or service that writes it: its last run, its last deploy and its errors. The table's page in Data Observability shows when it last changed and how often it usually does.",
  },
});

const rowCountFellSharplyTemplate: DataObservabilityAlertTemplate =
  buildTemplate({
    id: "data-store-row-count-fell-sharply",
    name: "Row Count Fell Sharply",
    description:
      "Alert when a table loses half its rows or more between two collections: a truncate, a bad delete, a load that replaced the table with less. Tables under 1,000 rows are left out.",
    category: "Volume",
    severity: "Critical",
    metricName: DataObservabilityMetricName.RowCountChangePercent,
    aggregationType: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past10Minutes,
    isPerTable: true,
    criteria: {
      filterType: FilterType.LessThanOrEqualTo,
      threshold: ROW_COUNT_FELL_PERCENT,
      /*
       * A drop is an event, not a level: the next collection sees the
       * smaller table as its new normal (a change of 0), so requiring every
       * value of the window to be a drop would never fire. Any Value fires
       * on the collection that saw it and clears once the window has
       * passed it.
       */
      evaluation: EvaluateOverTimeType.AnyValue,
      recovery: {
        filterType: FilterType.GreaterThan,
        threshold: ROW_COUNT_FELL_PERCENT,
      },
      criteriaName: "A table lost half its rows",
      criteriaDescription:
        "Triggers when a collection in the last ten minutes saw a table's row count fall by half or more.",
      incidentDescription:
        "A table lost half its rows or more since the collection before. Look for a DELETE or TRUNCATE, or a load that replaced the table with less, around that time; the table's Metrics tab charts its row count.",
    },
  });

const rowCountUnusuallyLowTemplate: DataObservabilityAlertTemplate =
  buildTemplate({
    id: "data-store-row-count-unusually-low",
    name: "Row Count Unusually Low",
    description:
      "Alert when a table holds far fewer rows than it usually does at this hour of the week. Learns each table over two weeks; catches slow losses one step does not show.",
    category: "Volume",
    severity: "Warning",
    metricName: DataObservabilityMetricName.RowCount,
    aggregationType: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past15Minutes,
    isPerTable: true,
    criteria: {
      filterType: FilterType.AnomalouslyLow,
      threshold: 0,
      evaluation: EvaluateOverTimeType.AllValues,
      anomalyDetection: { sensitivity: AnomalyDetectionSensitivity.Medium },
      recovery: { filterType: FilterType.GreaterThanOrEqualTo, threshold: 0 },
      criteriaName: "A table holds unusually few rows",
      criteriaDescription:
        "Triggers when a table's row count stays unusually low for this hour of the week, for fifteen minutes.",
      incidentDescription:
        "A table holds far fewer rows than it usually does at this hour of the week. Compare its row count chart with the weeks before, and check the jobs that load and clean it.",
    },
  });

const schemaChangedTemplate: DataObservabilityAlertTemplate = buildTemplate({
  id: "data-store-schema-changed",
  name: "Schema Changed",
  description:
    "Alert when a table's columns are removed, renamed or retyped, so a migration that breaks the reports, jobs and services reading it is seen at once. An added column stays on the table's timeline.",
  category: "Schema",
  severity: "Warning",
  metricName: DataObservabilityMetricName.BreakingSchemaChanges,
  aggregationType: MetricsAggregationType.Max,
  rollingTime: RollingTime.Past10Minutes,
  isPerTable: true,
  criteria: {
    filterType: FilterType.GreaterThan,
    threshold: 0,
    // A schema change is an event: fire on the collection that saw it.
    evaluation: EvaluateOverTimeType.AnyValue,
    criteriaName: "A column that readers rely on changed",
    criteriaDescription:
      "Triggers when a collection in the last ten minutes saw a table's column removed, renamed or retyped.",
    incidentDescription:
      "A table's columns changed. Its timeline in Data Observability says which column and how. Check what reads that column: reports, jobs and services that select it by name or type.",
  },
});

const stoppedReportingTemplate: DataObservabilityAlertTemplate = buildTemplate({
  id: "data-store-table-health-stopped-reporting",
  name: "Table Health Stopped Reporting",
  description:
    "Alert when no table of the data store has been read for fifteen minutes: the database is down or refusing the login, or the probe that reads it stopped.",
  category: "Collection",
  severity: "Critical",
  // Written for every table and view at every collection, whatever the engine can tell.
  metricName: DataObservabilityMetricName.SchemaChanges,
  aggregationType: MetricsAggregationType.Count,
  rollingTime: RollingTime.Past15Minutes,
  isPerTable: false,
  criteria: {
    filterType: FilterType.LessThan,
    threshold: 0,
    evaluation: EvaluateOverTimeType.AllValues,
    criteriaName: "Table health stopped reporting",
    criteriaDescription:
      "Triggers when no table health arrives for the data store for fifteen minutes.",
    incidentDescription:
      "No table of this data store has been read for fifteen minutes. The Databases page in Data Observability shows the last collection and why it failed: check whether the database accepts connections, whether the login still works, and - for a store read by a probe - whether the probe is connected.",
  },
});

const DATA_OBSERVABILITY_ALERT_TEMPLATES: ReadonlyArray<DataObservabilityAlertTemplate> =
  [
    tableIsLateTemplate,
    rowCountFellSharplyTemplate,
    rowCountUnusuallyLowTemplate,
    schemaChangedTemplate,
    stoppedReportingTemplate,
  ];

export function getAllDataObservabilityAlertTemplates(): Array<DataObservabilityAlertTemplate> {
  return [...DATA_OBSERVABILITY_ALERT_TEMPLATES];
}

export function getDataObservabilityAlertTemplate(
  id: string,
): DataObservabilityAlertTemplate | undefined {
  return DATA_OBSERVABILITY_ALERT_TEMPLATES.find(
    (template: DataObservabilityAlertTemplate) => {
      return template.id === id;
    },
  );
}
