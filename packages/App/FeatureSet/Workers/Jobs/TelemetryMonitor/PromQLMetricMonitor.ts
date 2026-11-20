import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "Common/Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
  PROMQL_MONITOR_MAX_SERIES,
} from "Common/Types/Monitor/MonitorStepMetricMonitor";
import BadDataException from "Common/Types/Exception/BadDataException";
import MetricQueryServices from "Common/Utils/Metrics/MetricQueryServices";
import MetricSeriesFingerprint from "Common/Utils/Metrics/MetricSeriesFingerprint";
import PromQLEngine from "Common/Utils/PromQL/PromQLEngine";
import {
  PromQLMatrixResultSeries,
  PromQLQueryResult,
  PromQLResultType,
  PromQLSeriesSource,
} from "Common/Utils/PromQL/PromQLEngineTypes";
import { PromQLLabels } from "Common/Utils/PromQL/PromQLLabels";
import { getPromQLMonitorSeriesNames } from "Common/Utils/PromQL/PromQLMonitorSeries";
import { getPromQLMonitorExpressionProblem } from "Common/Utils/PromQL/PromQLMonitorExpression";
import PromQLMetricSeriesSource from "Common/Server/Utils/PromQL/PromQLMetricSeriesSource";
import { TelemetryServiceFilter } from "Common/Server/Utils/Telemetry/TelemetryReadScope";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Incident from "Common/Models/DatabaseModels/Incident";
import Alert from "Common/Models/DatabaseModels/Alert";
import logger from "Common/Server/Utils/Logger";
import { copyOwnValues } from "Common/Utils/LookupTable";

/*
 * ONE CHECK OF A METRICS MONITOR WRITTEN IN PROMQL (issue #7712).
 *
 * The step's expression is evaluated over the project's metrics by the
 * same engine the PromQL tab, the Prometheus API and Grafana use
 * (PromQLEngine over PromQLMetricSeriesSource), held to the same limits,
 * as the worker: the monitor's own scope is its services, not a member's.
 *
 * It is evaluated at each minute of the monitor's window, ending at the
 * check's time - a window of one minute is one evaluation, at the check's
 * time, the way Prometheus evaluates an alert rule - so a criteria that
 * judges every value of the window ("All Values" over 5 minutes) is how
 * long a series must breach, Prometheus' `for:`.
 *
 * Every series the expression returns is a series of the check
 * (MetricSeriesResult), named by its labels: the criteria evaluator judges
 * each on its own, each opens its own incident and alert, and each
 * resolves when its series recovers or is no longer returned - the same
 * path a monitor grouped by attributes takes.
 */

// One evaluation a minute: the cadence telemetry monitors are checked at.
export const PROMQL_MONITOR_STEP_MS: number = 60 * 1000;

/*
 * The most evaluations one check makes: a longer window is evaluated at
 * whole minutes further apart, so a day's window costs what an hour's does.
 */
export const PROMQL_MONITOR_MAX_EVALUATIONS: number = 60;

// How long evaluating may take, after the series are read: the API's.
export const PROMQL_MONITOR_EVALUATION_TIMEOUT_MS: number = 30000;

export interface PromQLMonitorEvaluationTimes {
  startMs: number;
  endMs: number;
  stepMs: number;
}

/*
 * When a check evaluates its expression: every step from the window's end
 * back, never before its start - a minute's window once, at its end.
 */
export const getPromQLMonitorEvaluationTimes: (
  window: InBetween<Date>,
) => PromQLMonitorEvaluationTimes = (
  window: InBetween<Date>,
): PromQLMonitorEvaluationTimes => {
  const endMs: number = window.endValue.getTime();
  const windowMs: number = Math.max(0, endMs - window.startValue.getTime());
  let stepMs: number = PROMQL_MONITOR_STEP_MS;

  if (windowMs / stepMs > PROMQL_MONITOR_MAX_EVALUATIONS) {
    stepMs =
      Math.ceil(windowMs / PROMQL_MONITOR_MAX_EVALUATIONS / 60000) * 60000;
  }

  const evaluations: number = Math.max(1, Math.floor(windowMs / stepMs));

  return {
    startMs: endMs - (evaluations - 1) * stepMs,
    endMs,
    stepMs,
  };
};

// A series' labels as the series of a check: its own keys, __proto__ too.
const toLabelsObject: (labels: PromQLLabels) => JSONObject = (
  labels: PromQLLabels,
): JSONObject => {
  return copyOwnValues(labels) as JSONObject;
};

/*
 * The series of a check, from the expression's answer. A series is named
 * by its labels without `__name__`, as Prometheus names an alert: `up == 0`
 * keeps the name `up`, which says nothing about which target is down. Two
 * series that only their names tell apart keep them, so neither is lost
 * (PromQLMonitorSeries, which an incident's chart finds its series by).
 * NaN, which a comparison never keeps, is no value to judge; an infinite
 * one is (a ratio over nothing).
 */
export const toPromQLSeriesBreakdown: (
  series: Array<PromQLMatrixResultSeries>,
) => Array<MetricSeriesResult> = (
  series: Array<PromQLMatrixResultSeries>,
): Array<MetricSeriesResult> => {
  const names: Array<PromQLLabels> = getPromQLMonitorSeriesNames(
    series.map((item: PromQLMatrixResultSeries): PromQLLabels => {
      return item.labels;
    }),
  );

  const breakdown: Array<MetricSeriesResult> = [];

  series.forEach((item: PromQLMatrixResultSeries, index: number): void => {
    const labels: PromQLLabels = names[index] || {};
    const jsonLabels: JSONObject = toLabelsObject(labels);
    const data: Array<AggregatedModel> = [];

    for (const point of item.points) {
      if (Number.isNaN(point.value)) {
        continue;
      }

      data.push({
        timestamp: new Date(point.timestampMs),
        value: point.value,
      } as AggregatedModel);
    }

    breakdown.push({
      fingerprint: MetricSeriesFingerprint.computeFingerprint(jsonLabels),
      labels: jsonLabels,
      aggregatedResults: [{ data }],
    });
  });

  return breakdown;
};

/*
 * The series fingerprints this monitor has an incident or alert open for:
 * read only when an expression returns more series than a check judges,
 * so the series already acted on are judged first, and none of them is
 * resolved for being left out.
 */
export type ReadOpenSeriesFingerprints = (data: {
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<Set<string>>;

export const readOpenSeriesFingerprints: ReadOpenSeriesFingerprints =
  async (data: {
    monitorId: ObjectID;
    projectId: ObjectID;
  }): Promise<Set<string>> => {
    const [incidents, alerts] = await Promise.all([
      IncidentService.findBy({
        query: {
          monitors: [data.monitorId],
          currentIncidentStateId: QueryHelper.any(
            await IncidentStateService.getUnresolvedIncidentStateIds(
              data.projectId,
            ),
          ),
        },
        select: { seriesFingerprint: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
      AlertService.findBy({
        query: {
          monitor: data.monitorId,
          currentAlertStateId: QueryHelper.any(
            await AlertStateService.getUnresolvedAlertStateIds(data.projectId),
          ),
        },
        select: { seriesFingerprint: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
    ]);

    const fingerprints: Set<string> = new Set<string>();

    for (const record of [...incidents, ...alerts] as Array<Incident | Alert>) {
      if (record.seriesFingerprint) {
        fingerprints.add(record.seriesFingerprint);
      }
    }

    return fingerprints;
  };

/*
 * The series a check judges, at most PROMQL_MONITOR_MAX_SERIES: those with
 * an incident or alert open first, then the rest in the order the engine
 * answers them (by their labels), so the same ones are judged check after
 * check and none flaps in and out.
 */
export const limitPromQLMonitorSeries: (data: {
  breakdown: Array<MetricSeriesResult>;
  openFingerprints: Set<string>;
  maxSeries?: number | undefined;
}) => Array<MetricSeriesResult> = (data: {
  breakdown: Array<MetricSeriesResult>;
  openFingerprints: Set<string>;
  maxSeries?: number | undefined;
}): Array<MetricSeriesResult> => {
  const maxSeries: number = data.maxSeries ?? PROMQL_MONITOR_MAX_SERIES;

  if (data.breakdown.length <= maxSeries) {
    return data.breakdown;
  }

  const open: Array<MetricSeriesResult> = [];
  const rest: Array<MetricSeriesResult> = [];

  for (const series of data.breakdown) {
    (data.openFingerprints.has(series.fingerprint) ? open : rest).push(series);
  }

  return [...open, ...rest].slice(0, maxSeries);
};

export interface MonitorPromQLMetricInput {
  metricMonitor: MonitorStepMetricMonitor;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
  // Where the series come from: the project's metrics; tests hand in their own.
  source?: PromQLSeriesSource | undefined;
  readOpenFingerprints?: ReadOpenSeriesFingerprints | undefined;
}

export const monitorPromQLMetric: (
  input: MonitorPromQLMetricInput,
) => Promise<MetricMonitorResponse> = async (
  input: MonitorPromQLMetricInput,
): Promise<MetricMonitorResponse> => {
  const query: string = MonitorStepMetricMonitorUtil.getPromQLQuery(
    input.metricMonitor,
  );
  const problem: string | null = getPromQLMonitorExpressionProblem(query);

  /*
   * A step saved through the API with no expression, or one that does not
   * parse, is not judged: the check fails as a read that fails does, and
   * the monitor keeps its status and its records.
   */
  if (problem) {
    throw new BadDataException(problem);
  }

  const startAndEndDate: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(
      input.metricMonitor.rollingTime || RollingTime.Past1Minute,
      input.evaluateUntil,
    );

  const serviceIds: Array<ObjectID> =
    input.metricMonitor.telemetryServiceIds || [];
  const serviceFilter: TelemetryServiceFilter =
    serviceIds.length > 0 ? { serviceIds } : {};

  const source: PromQLSeriesSource =
    input.source ||
    new PromQLMetricSeriesSource({
      projectId: input.projectId,
      serviceFilter,
    });

  const times: PromQLMonitorEvaluationTimes =
    getPromQLMonitorEvaluationTimes(startAndEndDate);

  const result: PromQLQueryResult = await new PromQLEngine(source, {
    timeoutMs: PROMQL_MONITOR_EVALUATION_TIMEOUT_MS,
  }).rangeQuery(query, times.startMs, times.endMs, times.stepMs);

  const series: Array<PromQLMatrixResultSeries> =
    result.resultType === PromQLResultType.Matrix ? result.series : [];

  let seriesBreakdown: Array<MetricSeriesResult> =
    toPromQLSeriesBreakdown(series);

  if (seriesBreakdown.length > PROMQL_MONITOR_MAX_SERIES) {
    const openFingerprints: Set<string> = await (
      input.readOpenFingerprints || readOpenSeriesFingerprints
    )({ monitorId: input.monitorId, projectId: input.projectId });

    logger.warn(
      `${input.monitorId.toString()} - The PromQL expression returned ${seriesBreakdown.length} series, more than the ${PROMQL_MONITOR_MAX_SERIES} a check judges. The ${PROMQL_MONITOR_MAX_SERIES} judged are those with an open incident or alert first, then the rest by their labels; aggregate the expression (sum by (...)) or add label matchers to cover the rest.`,
      {
        service: "workers",
        projectId: input.projectId.toString(),
      },
    );

    seriesBreakdown = limitPromQLMonitorSeries({
      breakdown: seriesBreakdown,
      openFingerprints,
    });
  }

  // The whole check's points, for what reads the monitor as one series.
  const allPoints: Array<AggregatedModel> = [];

  for (const item of seriesBreakdown) {
    allPoints.push(...(item.aggregatedResults[0]?.data || []));
  }

  return {
    projectId: input.projectId,
    monitorId: input.monitorId,
    metricViewConfig: MonitorStepMetricMonitorUtil.getPromQLViewConfig(query),
    startAndEndDate: startAndEndDate,
    metricResult: [{ data: allPoints }],
    seriesBreakdown: seriesBreakdown,
    // The services the expression was read for, when it was limited to some.
    ...(serviceIds.length > 0
      ? { queryServiceIds: MetricQueryServices.normalize(serviceIds) }
      : {}),
    nativeUnitsByMetricName: {},
  };
};
