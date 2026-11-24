import Metric from "../../../Models/AnalyticsModels/Metric";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataSourceResultKind } from "../../../Types/DataSource/DataSourceQueryConfig";
import {
  DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
  DataSourceLimitsUtil,
} from "../../../Types/DataSource/DataSourceLimits";
import DataSourceTableResult from "../../../Types/DataSource/DataSourceTableResult";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PromQLEngine from "../../../Utils/PromQL/PromQLEngine";
import {
  PromQLMatrixResultSeries,
  PromQLQueryResult,
  PromQLResultType,
  PromQLSeriesSource,
} from "../../../Utils/PromQL/PromQLEngineTypes";
import PromQLError from "../../../Utils/PromQL/PromQLError";
import { applyGrafanaIntervalMacros } from "../../../Utils/PromQL/PromQLGrafanaMacros";
import { isSeriesNamed } from "../../../Utils/PromQL/PromQLMonitorSeries";
import {
  parseInstantQueryResult,
  parseRangeQueryResult,
} from "../DataSource/Connectors/PrometheusConnector";
import CallerPermission from "../Permission/CallerPermission";
import { getMetricReadPermissions } from "../Telemetry/MetricReadPermissions";
import TelemetryReadAccess from "../Telemetry/TelemetryReadAccess";
import { TelemetryServiceFilter } from "../Telemetry/TelemetryReadScope";
import PromQLMetricSeriesSource from "./PromQLMetricSeriesSource";
import {
  formatPrometheusQueryResult,
  prometheusSuccess,
} from "./PrometheusHttpApi";

/*
 * A DATA SOURCE WIDGET'S PROMQL OVER THE PROJECT'S OWN METRICS (issue
 * #7713): the built-in source (ProjectMetricsDataSource) of the Chart,
 * Value, Gauge and Table data source widgets.
 *
 * Run as the person looking at the dashboard: they must be one who may
 * read the project's metrics - the roles the Metrics explorer and the
 * Prometheus API let in - and the query reads exactly the services they
 * may read (TelemetryReadAccess). The engine is the PromQL tab's, held to
 * its limits, and the answer is the Prometheus API's, shaped by the very
 * functions that shape an outside Prometheus' answer for these widgets
 * (PrometheusConnector's parseRangeQueryResult and parseInstantQueryResult)
 * - its series and point caps included - so a widget draws both alike.
 *
 * Two more read through the same engine and limits (runPromQLOverProject
 * Metrics):
 *
 *   - a Metrics monitor written in PromQL, on its Overview and on the
 *     incidents and alerts it opens (issue #10227), as the person viewing:
 *     for the services the monitor reads, among those they may read, and on
 *     an incident or alert for the one series that opened it;
 *   - a public dashboard's PromQL widgets (issue #10226), for a visitor
 *     nobody signed in: only the queries stored in the dashboard's
 *     widgets, over its own project (PublicDashboardPromQLPolicy).
 */

export interface ProjectMetricsQueryRequest {
  props: DatabaseCommonInteractionProps;
  query: string;
  resultKind: DataSourceResultKind;
  startDate: Date;
  endDate: Date;
  stepInSeconds?: number | undefined;
  /*
   * Only these services, of those the caller may read: a monitor limited
   * to some (MonitorStepMetricMonitor.telemetryServiceIds) is charted for
   * them, as it reads. Absent: every service the caller may read.
   */
  serviceIds?: Array<string> | undefined;
  /*
   * Only the series a monitor names by these labels (PromQLMonitorSeries):
   * the one an incident or alert was opened for, charted alone (issue
   * #10227). Absent: every series.
   */
  seriesLabels?: JSONObject | undefined;
  // Where series come from: the project's metrics; tests hand in their own.
  source?: PromQLSeriesSource | undefined;
}

export type ProjectMetricsQueryAnswer =
  | { resultKind: DataSourceResultKind.TimeSeries; result: AggregatedResult }
  | { resultKind: DataSourceResultKind.Table; result: DataSourceTableResult };

export const PROJECT_METRICS_NO_PROJECT_MESSAGE: string =
  "This request names no project. Open the dashboard from its project, and try again.";

export const PROJECT_METRICS_NOT_ALLOWED_MESSAGE: string =
  "You do not have permission to read this project's metrics. Ask a Project Owner or Project Admin for a role that reads telemetry.";

// Whether the caller may read the project's metrics, as the Prometheus API asks.
export const mayReadProjectMetrics: (
  props: DatabaseCommonInteractionProps,
) => boolean = (props: DatabaseCommonInteractionProps): boolean => {
  if (props.isRoot || props.isMasterAdmin) {
    return true;
  }

  return CallerPermission.holdsAnyOf(props, getMetricReadPermissions(), {
    wildcard: Permission.ReadAllOperationalResources,
  });
};

export interface PromQLOverProjectMetricsRequest {
  projectId: ObjectID;
  // The services it reads: {} for every service of the project.
  serviceFilter: TelemetryServiceFilter;
  query: string;
  resultKind: DataSourceResultKind;
  startDate: Date;
  endDate: Date;
  // Worked out from the window when absent, about 250 points across it.
  stepInSeconds?: number | undefined;
  seriesLabels?: JSONObject | undefined;
  // Where series come from: the project's metrics; tests hand in their own.
  source?: PromQLSeriesSource | undefined;
}

/*
 * A range query's answer kept to the series a monitor names by these
 * labels, before the series cap: the one an incident is about is never
 * left out for coming after a hundred others.
 */
const keepNamedSeries: (data: {
  result: PromQLQueryResult;
  seriesLabels: JSONObject | undefined;
}) => PromQLQueryResult = (data: {
  result: PromQLQueryResult;
  seriesLabels: JSONObject | undefined;
}): PromQLQueryResult => {
  const seriesLabels: JSONObject | undefined = data.seriesLabels;

  if (!seriesLabels || data.result.resultType !== PromQLResultType.Matrix) {
    return data.result;
  }

  return {
    ...data.result,
    series: data.result.series.filter(
      (series: PromQLMatrixResultSeries): boolean => {
        return isSeriesNamed({ labels: series.labels, seriesLabels });
      },
    ),
  };
};

/*
 * PromQL over one project's metrics, for the services a filter names, by
 * the PromQL tab's engine and held to its limits, answered in the shape
 * the Data Source widgets draw - their series, point and row caps
 * included. Who may ask, and for which services, is the caller's to have
 * decided.
 */
export const runPromQLOverProjectMetrics: (
  request: PromQLOverProjectMetricsRequest,
) => Promise<ProjectMetricsQueryAnswer> = async (
  request: PromQLOverProjectMetricsRequest,
): Promise<ProjectMetricsQueryAnswer> => {
  const source: PromQLSeriesSource =
    request.source ||
    new PromQLMetricSeriesSource({
      projectId: request.projectId,
      serviceFilter: request.serviceFilter,
    });

  const engine: PromQLEngine = new PromQLEngine(source, {
    timeoutMs: DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
  });

  const stepInSeconds: number =
    request.stepInSeconds ??
    DataSourceLimitsUtil.getStepInSeconds(request.startDate, request.endDate);

  /*
   * Grafana's $__interval, $__rate_interval and $__range, filled from the
   * window and step the query runs at (PromQLGrafanaMacros), as Grafana
   * fills them before a query reaches Prometheus (issue #7697).
   */
  const query: string = applyGrafanaIntervalMacros(request.query, {
    startDate: request.startDate,
    endDate: request.endDate,
    stepInSeconds,
  });

  try {
    if (request.resultKind === DataSourceResultKind.Table) {
      const result: PromQLQueryResult = await engine.instantQuery(
        query,
        request.endDate.getTime(),
      );

      return {
        resultKind: DataSourceResultKind.Table,
        result: parseInstantQueryResult(
          prometheusSuccess(formatPrometheusQueryResult(result)),
        ),
      };
    }

    const result: PromQLQueryResult = keepNamedSeries({
      result: await engine.rangeQuery(
        query,
        request.startDate.getTime(),
        request.endDate.getTime(),
        stepInSeconds * 1000,
      ),
      seriesLabels: request.seriesLabels,
    });

    return {
      resultKind: DataSourceResultKind.TimeSeries,
      result: parseRangeQueryResult(
        prometheusSuccess(formatPrometheusQueryResult(result)),
      ),
    };
  } catch (error: unknown) {
    // A mistake in the query, or one that ran out of room, said as it is.
    if (error instanceof PromQLError) {
      throw new BadDataException(
        `The PromQL query did not run. ${error.message}`,
      );
    }

    throw error;
  }
};

export const runProjectMetricsQuery: (
  request: ProjectMetricsQueryRequest,
) => Promise<ProjectMetricsQueryAnswer> = async (
  request: ProjectMetricsQueryRequest,
): Promise<ProjectMetricsQueryAnswer> => {
  const projectId: ObjectID | undefined = request.props.tenantId;

  if (!projectId) {
    throw new BadDataException(PROJECT_METRICS_NO_PROJECT_MESSAGE);
  }

  if (!mayReadProjectMetrics(request.props)) {
    throw new NotAuthorizedException(PROJECT_METRICS_NOT_ALLOWED_MESSAGE);
  }

  /*
   * The services the caller may read - of those a monitor reads, when the
   * request names some (a service named that the caller may not read is
   * left out, never read for them).
   */
  const serviceFilter: TelemetryServiceFilter = request.source
    ? {}
    : await TelemetryReadAccess.getServiceFilter({
        modelType: Metric,
        props: request.props,
        requested:
          request.serviceIds && request.serviceIds.length > 0
            ? request.serviceIds
            : undefined,
      });

  return await runPromQLOverProjectMetrics({
    projectId,
    serviceFilter,
    query: request.query,
    resultKind: request.resultKind,
    startDate: request.startDate,
    endDate: request.endDate,
    stepInSeconds: request.stepInSeconds,
    seriesLabels: request.seriesLabels,
    source: request.source,
  });
};
