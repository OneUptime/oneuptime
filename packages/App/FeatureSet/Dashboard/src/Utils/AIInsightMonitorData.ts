import Metric, {
  AggregationTemporality,
  MetricPointType,
} from "Common/Models/AnalyticsModels/Metric";
import AIInsight from "Common/Models/DatabaseModels/AIInsight";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  AIInsightMetricShape,
  AIInsightMonitorInput,
  AIInsightMonitorSeedIds,
} from "./AIInsightMonitorPrefill";

/*
 * The network half of "Create Monitor" from an AI insight — everything
 * AIInsightMonitorPrefill needs that it must not fetch itself, so the
 * builder stays pure: the insight's own fields, the project's statuses and
 * severities, and what a drifting metric IS.
 */

// The AIInsight columns the monitor prefill reads.
export const AI_INSIGHT_MONITOR_SELECT: Select<AIInsight> = {
  insightType: true,
  severity: true,
  serviceName: true,
  telemetryServiceId: true,
  metricName: true,
  evidence: true,
};

/*
 * How far back the newest point of a drifting metric is looked for: the
 * detector compares the last two weeks, so a metric it drifted on has
 * points in them.
 */
export const AI_INSIGHT_METRIC_SHAPE_LOOKBACK_DAYS: number = 14;

export function toAIInsightMonitorInput(
  insight: AIInsight,
): AIInsightMonitorInput {
  return {
    insightType: insight.insightType,
    severity: insight.severity,
    serviceName: insight.serviceName,
    telemetryServiceId: insight.telemetryServiceId?.toString(),
    metricName: insight.metricName,
    evidence: insight.evidence,
  };
}

/*
 * The statuses and severities the criteria are built with. Sorted the way
 * MonitorService.onBeforeCreate and the steps form sort them — priority for
 * statuses, order for severities — so the status the criteria pick is the
 * one the server stamps, and the first severity is the most severe.
 */
export async function fetchAIInsightMonitorSeedIds(): Promise<AIInsightMonitorSeedIds> {
  const [monitorStatuses, incidentSeverities, alertSeverities]: [
    ListResult<MonitorStatus>,
    ListResult<IncidentSeverity>,
    ListResult<AlertSeverity>,
  ] = await Promise.all([
    ModelAPI.getList<MonitorStatus>({
      modelType: MonitorStatus,
      query: {},
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        isOperationalState: true,
        isOfflineState: true,
        priority: true,
      },
      sort: {
        priority: SortOrder.Ascending,
      },
    }),
    ModelAPI.getList<IncidentSeverity>({
      modelType: IncidentSeverity,
      query: {},
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        order: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
    }),
    ModelAPI.getList<AlertSeverity>({
      modelType: AlertSeverity,
      query: {},
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        order: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
    }),
  ]);

  const toIds: (rows: Array<{ id: ObjectID | null }>) => Array<ObjectID> = (
    rows: Array<{ id: ObjectID | null }>,
  ): Array<ObjectID> => {
    return rows
      .map((row: { id: ObjectID | null }) => {
        return row.id;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });
  };

  return {
    operationalMonitorStatusId:
      monitorStatuses.data.find((status: MonitorStatus) => {
        return status.isOperationalState;
      })?.id || null,
    offlineMonitorStatusId:
      monitorStatuses.data.find((status: MonitorStatus) => {
        return status.isOfflineState;
      })?.id || null,
    rankedIncidentSeverityIds: toIds(incidentSeverities.data),
    rankedAlertSeverityIds: toIds(alertSeverities.data),
  };
}

/**
 * What a metric is — point type, monotonicity, temporality — read from its
 * newest point on the entity it drifted on. Null when it cannot be told
 * (no project, no point in the window, or the read failed): an unknown is
 * never held against the metric.
 */
export async function fetchAIInsightMetricShape(data: {
  metricName: string;
  primaryEntityId?: string | undefined;
}): Promise<AIInsightMetricShape | null> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const metricName: string = (data.metricName || "").trim();

  if (!projectId || !metricName) {
    return null;
  }

  const endTime: Date = OneUptimeDate.getCurrentDate();
  const startTime: Date = OneUptimeDate.addRemoveDays(
    endTime,
    -1 * AI_INSIGHT_METRIC_SHAPE_LOOKBACK_DAYS,
  );

  const query: Record<string, unknown> = {
    projectId: projectId,
    name: metricName,
    time: new InBetween<Date>(startTime, endTime),
  };

  const primaryEntityId: string = (data.primaryEntityId || "").trim();

  if (primaryEntityId && ObjectID.isValidUUID(primaryEntityId)) {
    query["primaryEntityId"] = new ObjectID(primaryEntityId);
  }

  try {
    const result: AnalyticsListResult<Metric> =
      await AnalyticsModelAPI.getList<Metric>({
        modelType: Metric,
        query: query,
        select: {
          metricPointType: true,
          isMonotonic: true,
          aggregationTemporality: true,
        },
        sort: { time: SortOrder.Descending },
        skip: 0,
        limit: 1,
      });

    const row: Metric | undefined = result.data?.[0];

    if (!row) {
      return null;
    }

    const pointType: unknown = row.metricPointType;
    const temporality: unknown = row.aggregationTemporality;

    return {
      pointType: Object.values(MetricPointType).includes(
        pointType as MetricPointType,
      )
        ? (pointType as MetricPointType)
        : null,
      isMonotonic:
        typeof row.isMonotonic === "boolean" ? row.isMonotonic : null,
      aggregationTemporality: Object.values(AggregationTemporality).includes(
        temporality as AggregationTemporality,
      )
        ? (temporality as AggregationTemporality)
        : null,
    };
  } catch {
    return null;
  }
}
