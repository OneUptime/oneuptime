import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Metric, {
  AggregationTemporality,
} from "Common/Models/AnalyticsModels/Metric";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
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
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ArchivedValuePicker from "Common/UI/Utils/ArchivedValuePicker";
import ProjectUtil from "Common/UI/Utils/Project";
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
 *   - whether each Datadog metric is a gauge, a rate or a count, and the
 *     seconds a rate's point covers, from the project's metrics;
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

// What the project's data says of a file's Datadog metrics.
export interface DatadogMetricFacts {
  // Each metric's kind, by its Datadog name: a gauge, a rate or a count.
  kinds: Map<string, DatadogMetricKind>;
  // The seconds each point of a rate covers, where its data says.
  rateIntervalsInSeconds: Map<string, number>;
}

export const NO_DATADOG_METRIC_FACTS: DatadogMetricFacts = {
  kinds: new Map<string, DatadogMetricKind>(),
  rateIntervalsInSeconds: new Map<string, number>(),
};

// How far back a rate's newest point is looked for.
const RATE_LOOKUP_DAYS: number = 7;

/*
 * Whether a gauge the file reads with .as_count() is a rate - a DogStatsD
 * count, its points marked datadog.metric.type = rate - and the seconds its
 * newest point covers (its time less its start, which the intake keeps
 * as a rate's interval, issue #10327). Undefined when it is no rate.
 */
const lookUpRate: (
  name: string,
) => Promise<{ intervalInSeconds: number | undefined } | undefined> = async (
  name: string,
): Promise<{ intervalInSeconds: number | undefined } | undefined> => {
  const now: Date = OneUptimeDate.getCurrentDate();
  // Written out, then read as the model's query: its type is too deep to infer.
  const query: Record<string, unknown> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
    name: name,
    time: new InBetween<Date>(
      OneUptimeDate.addRemoveDays(now, -RATE_LOOKUP_DAYS),
      now,
    ),
    attributes: { "datadog.metric.type": "rate" },
  };
  const select: Record<string, boolean> = { time: true, startTime: true };
  const sort: Record<string, SortOrder> = { time: SortOrder.Descending };
  const result: AnalyticsListResult<Metric> =
    await AnalyticsModelAPI.getList<Metric>({
      modelType: Metric,
      query: query as unknown as Query<Metric>,
      select: select as unknown as Select<Metric>,
      sort: sort as unknown as Sort<Metric>,
      limit: 1,
      skip: 0,
    });
  const point: Metric | undefined = result.data[0];

  if (!point) {
    return undefined;
  }

  const time: Date | undefined = point.time
    ? OneUptimeDate.fromString(point.time)
    : undefined;
  const start: Date | undefined = point.startTime
    ? OneUptimeDate.fromString(point.startTime)
    : undefined;
  const seconds: number =
    time && start ? Math.round((time.getTime() - start.getTime()) / 1000) : 0;

  return { intervalInSeconds: seconds > 0 ? seconds : undefined };
};

/*
 * What each Datadog metric is, as the project's own data says: the Datadog
 * Agent's counts arrive as sums of deltas, its gauges and rates as gauges,
 * a rate's points marked as one. Of the gauges the file reads with
 * .as_count() (`asCountNames`), each is asked whether it is a rate, and
 * over how many seconds (issue #10327). A metric the project has no data
 * for yet is left out, and read as the query's words imply, said; so is a
 * gauge whose rate could not be looked up.
 */
export const lookUpDatadogMetrics: (data: {
  names: Array<string>;
  asCountNames: Array<string>;
}) => Promise<DatadogMetricFacts> = async (data: {
  names: Array<string>;
  asCountNames: Array<string>;
}): Promise<DatadogMetricFacts> => {
  const facts: DatadogMetricFacts = {
    kinds: new Map<string, DatadogMetricKind>(),
    rateIntervalsInSeconds: new Map<string, number>(),
  };

  if (data.names.length === 0) {
    return facts;
  }

  try {
    const result: ListResult<MetricType> = await ModelAPI.getList<MetricType>({
      modelType: MetricType,
      query: { name: new Includes(data.names.slice(0, LIMIT_PER_PROJECT)) },
      select: { name: true, aggregationTemporality: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: {},
    });

    for (const metricType of result.data || []) {
      if (metricType.name) {
        facts.kinds.set(
          metricType.name,
          metricType.aggregationTemporality === AggregationTemporality.Delta
            ? DatadogMetricKind.Count
            : DatadogMetricKind.Gauge,
        );
      }
    }
  } catch {
    // Read as the queries' words imply, and said so.
    return facts;
  }

  const gauges: Array<string> = data.asCountNames
    .filter((name: string): boolean => {
      return facts.kinds.get(name) === DatadogMetricKind.Gauge;
    })
    .slice(0, LIMIT_PER_PROJECT);

  await Promise.all(
    gauges.map(async (name: string): Promise<void> => {
      try {
        const rate: { intervalInSeconds: number | undefined } | undefined =
          await lookUpRate(name);

        if (!rate) {
          return;
        }

        facts.kinds.set(name, DatadogMetricKind.Rate);

        if (rate.intervalInSeconds) {
          facts.rateIntervalsInSeconds.set(name, rate.intervalInSeconds);
        }
      } catch {
        // Not known to be a gauge or a rate: read as its words imply, said.
        facts.kinds.delete(name);
      }
    }),
  );

  return facts;
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

    const liveStatuses: Array<MonitorStatus> =
      ArchivedValuePicker.getLiveValues(statuses.data || []);
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
export const fetchMonitorNames: () => Promise<
  Array<string>
> = async (): Promise<Array<string>> => {
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
