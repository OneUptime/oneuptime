import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import { AggregationTemporality } from "Common/Models/AnalyticsModels/Metric";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DashboardImportPlan,
  DashboardImportVariable,
  ImportAiCandidate,
} from "Common/Types/ObservabilityImport/ObservabilityImport";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ArchivedValuePicker from "Common/UI/Utils/ArchivedValuePicker";
import { AlertImportSeeds } from "Common/Utils/ObservabilityImport/AlertImportMonitorBuilder";
import { DatadogMetricKind } from "Common/Utils/ObservabilityImport/Datadog/DatadogPromQL";
import MetricUtil from "../Metrics/Utils/Metrics";

/*
 * WHAT THE IMPORT ASKS THE SERVER (issue #7697), each with the person's own
 * permissions, as the create forms ask:
 *
 *   - OneUptime AI's conversion of one query, when the person asks for it;
 *   - the first value a variable takes, where the source picks its first
 *     value itself (Grafana does), from the project's metrics;
 *   - whether each Datadog metric is a gauge or a count, from the
 *     project's metrics;
 *   - the project's statuses and severities a monitor is made with, and
 *     its monitors' names, so none is taken twice.
 *
 * A read that fails leaves the preview as it was: a variable starts on
 * All, a Datadog metric is read as a gauge and says so.
 */

export enum ImportAiTarget {
  Dashboard = "dashboard",
  Monitor = "monitor",
}

export interface ImportAiAnswer {
  promQL: string;
  explanation: string;
}

export const convertImportQueryWithAi: (data: {
  target: ImportAiTarget;
  candidate: ImportAiCandidate;
}) => Promise<ImportAiAnswer> = async (data: {
  target: ImportAiTarget;
  candidate: ImportAiCandidate;
}): Promise<ImportAiAnswer> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        `/${data.target}/import/convert-query-with-ai`,
      ),
      data: {
        language: data.candidate.language,
        query: data.candidate.query,
        variableNames: data.candidate.variableNames,
      },
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const promQL: unknown = response.data["promQL"];

  if (typeof promQL !== "string" || !promQL.trim()) {
    throw new BadDataException(
      "OneUptime AI answered without a query. Try again.",
    );
  }

  return {
    promQL: promQL.trim(),
    explanation:
      typeof response.data["explanation"] === "string"
        ? (response.data["explanation"] as string)
        : "",
  };
};

/*
 * The value each variable starts on, by its key, for the variables whose
 * source picks its first value itself: the first value of its attribute
 * the project's metrics have, as Grafana lists them (sorted).
 */
export const lookUpVariableStartingValues: (
  plan: DashboardImportPlan,
) => Promise<Map<string, string>> = async (
  plan: DashboardImportPlan,
): Promise<Map<string, string>> => {
  const values: Map<string, string> = new Map<string, string>();

  await Promise.all(
    plan.variables
      .filter((item: DashboardImportVariable): boolean => {
        return Boolean(item.startsOnFirstValue && item.variable?.attributeKey);
      })
      .map(async (item: DashboardImportVariable): Promise<void> => {
        const attributeKey: string = item.variable?.attributeKey || "";

        try {
          let found: Array<string> = item.valuesOfMetric
            ? await MetricUtil.getTelemetryAttributeValues({
                attributeKey,
                metricName: item.valuesOfMetric,
              })
            : [];

          if (found.length === 0) {
            found = await MetricUtil.getTelemetryAttributeValues({
              attributeKey,
            });
          }

          const first: string | undefined = [...found]
            .filter((value: string): boolean => {
              return value.trim().length > 0;
            })
            .sort((a: string, b: string): number => {
              return a.localeCompare(b);
            })[0];

          if (first) {
            values.set(item.key, first);
          }
        } catch {
          // The variable starts on All.
        }
      }),
  );

  return values;
};

/*
 * Whether each Datadog metric is a gauge or a count, as the project's own
 * data says: the Datadog Agent's counts arrive as sums of deltas. A metric
 * the project has no data for yet is left out, and read as a gauge.
 */
export const lookUpDatadogMetricKinds: (
  names: Array<string>,
) => Promise<Map<string, DatadogMetricKind>> = async (
  names: Array<string>,
): Promise<Map<string, DatadogMetricKind>> => {
  const kinds: Map<string, DatadogMetricKind> = new Map<
    string,
    DatadogMetricKind
  >();

  if (names.length === 0) {
    return kinds;
  }

  try {
    const result: ListResult<MetricType> = await ModelAPI.getList<MetricType>({
      modelType: MetricType,
      query: { name: new Includes(names.slice(0, LIMIT_PER_PROJECT)) },
      select: { name: true, aggregationTemporality: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: {},
    });

    for (const metricType of result.data || []) {
      if (metricType.name) {
        kinds.set(
          metricType.name,
          metricType.aggregationTemporality === AggregationTemporality.Delta
            ? DatadogMetricKind.Count
            : DatadogMetricKind.Gauge,
        );
      }
    }
  } catch {
    // Read as gauges, and said so.
  }

  return kinds;
};

/*
 * The statuses and severities an imported monitor is made with, read as
 * the monitor form reads them: the operational, degraded and offline
 * statuses, and the live severities, the most severe first.
 */
export const loadAlertImportSeeds: () => Promise<AlertImportSeeds> =
  async (): Promise<AlertImportSeeds> => {
    const [statuses, incidentSeverities, alertSeverities]: [
      ListResult<MonitorStatus>,
      ListResult<IncidentSeverity>,
      ListResult<AlertSeverity>,
    ] = await Promise.all([
      ModelAPI.getList<MonitorStatus>({
        modelType: MonitorStatus,
        query: {},
        select: {
          isOperationalState: true,
          isOfflineState: true,
          priority: true,
          isArchived: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: { priority: SortOrder.Ascending },
      }),
      ModelAPI.getList<IncidentSeverity>({
        modelType: IncidentSeverity,
        query: {},
        select: { order: true, isArchived: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: { order: SortOrder.Ascending },
      }),
      ModelAPI.getList<AlertSeverity>({
        modelType: AlertSeverity,
        query: {},
        select: { order: true, isArchived: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: { order: SortOrder.Ascending },
      }),
    ]);

    const liveStatuses: Array<MonitorStatus> = ArchivedValuePicker.getLiveValues(
      statuses.data || [],
    );
    const operational: ObjectID | null =
      liveStatuses.find((status: MonitorStatus): boolean => {
        return Boolean(status.isOperationalState);
      })?.id || null;
    const offline: ObjectID | null =
      liveStatuses.find((status: MonitorStatus): boolean => {
        return Boolean(status.isOfflineState);
      })?.id || null;

    if (!operational || !offline) {
      throw new BadDataException(
        "This project has no monitor status marked as operational or offline, so a new monitor has no status to be in. Add them under Monitors > Settings > Monitor Status, then import again.",
      );
    }

    const toIds: <T extends IncidentSeverity | AlertSeverity>(
      values: Array<T>,
    ) => Array<ObjectID> = <T extends IncidentSeverity | AlertSeverity>(
      values: Array<T>,
    ): Array<ObjectID> => {
      return ArchivedValuePicker.getLiveValues(values)
        .map((value: T): ObjectID | null => {
          return value.id;
        })
        .filter((id: ObjectID | null): id is ObjectID => {
          return Boolean(id);
        });
    };

    return {
      operationalStatusId: operational,
      degradedStatusId:
        liveStatuses.find((status: MonitorStatus): boolean => {
          return !status.isOperationalState && !status.isOfflineState;
        })?.id || undefined,
      offlineStatusId: offline,
      rankedIncidentSeverityIds: toIds(incidentSeverities.data || []),
      rankedAlertSeverityIds: toIds(alertSeverities.data || []),
    };
  };

/*
 * The names the project's monitors already have, archived ones too: a
 * monitor's name is unique in its project. A lookup that fails hands back
 * none, and the server's own check still decides.
 */
export const fetchMonitorNames: () => Promise<Array<string>> =
  async (): Promise<Array<string>> => {
    try {
      const result: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: {},
        select: { name: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: {},
      });

      return (result.data || [])
        .map((monitor: Monitor): string => {
          return monitor.name || "";
        })
        .filter((name: string): boolean => {
          return name.length > 0;
        });
    } catch {
      return [];
    }
  };
