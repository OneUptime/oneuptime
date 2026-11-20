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
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PromQLEngine from "../../../Utils/PromQL/PromQLEngine";
import {
  PromQLQueryResult,
  PromQLSeriesSource,
} from "../../../Utils/PromQL/PromQLEngineTypes";
import PromQLError from "../../../Utils/PromQL/PromQLError";
import { applyGrafanaIntervalMacros } from "../../../Utils/PromQL/PromQLGrafanaMacros";
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
 */

export interface ProjectMetricsQueryRequest {
  props: DatabaseCommonInteractionProps;
  query: string;
  resultKind: DataSourceResultKind;
  startDate: Date;
  endDate: Date;
  stepInSeconds?: number | undefined;
  // Where series come from: the project's metrics; tests hand in their own.
  source?: PromQLSeriesSource | undefined;
}

export type ProjectMetricsQueryAnswer =
  | { resultKind: DataSourceResultKind.TimeSeries; result: AggregatedResult }
  | { resultKind: DataSourceResultKind.Table; result: DataSourceTableResult };

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

export const runProjectMetricsQuery: (
  request: ProjectMetricsQueryRequest,
) => Promise<ProjectMetricsQueryAnswer> = async (
  request: ProjectMetricsQueryRequest,
): Promise<ProjectMetricsQueryAnswer> => {
  const projectId: ObjectID | undefined = request.props.tenantId;

  if (!projectId) {
    throw new BadDataException(
      "This request names no project. Open the dashboard from its project, and try again.",
    );
  }

  if (!mayReadProjectMetrics(request.props)) {
    throw new NotAuthorizedException(
      "You do not have permission to read this project's metrics. Ask a project admin for a role that reads telemetry.",
    );
  }

  let source: PromQLSeriesSource | undefined = request.source;

  if (!source) {
    const serviceFilter: TelemetryServiceFilter =
      await TelemetryReadAccess.getServiceFilter({
        modelType: Metric,
        props: request.props,
      });

    source = new PromQLMetricSeriesSource({ projectId, serviceFilter });
  }

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

    const result: PromQLQueryResult = await engine.rangeQuery(
      query,
      request.startDate.getTime(),
      request.endDate.getTime(),
      stepInSeconds * 1000,
    );

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
