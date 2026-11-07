import Log from "../../Models/AnalyticsModels/Log";
import Span from "../../Models/AnalyticsModels/Span";
import Query from "../BaseDatabase/Query";
import MetricViewData from "../Metrics/MetricViewData";
import TelemetryType from "./TelemetryType";
import ExceptionInstance from "../../Models/AnalyticsModels/ExceptionInstance";

export interface TelemetryQuery {
  telemetryType: TelemetryType;
  telemetryQuery: Query<Log> | Query<Span> | Query<ExceptionInstance> | null;
  metricViewData: MetricViewData | null;
  /*
   * Set on a metric snapshot whose queries carry the attribute filters its
   * monitor read them with: their own, and the ones an infrastructure
   * monitor adds before each check - the cluster, host, vCenter, array or
   * fleet it watches, and its resource filters (MetricTelemetrySnapshot).
   * Snapshots stored before (issue #6265) keep the queries as the step
   * does, without that scope, and do not say so: an event's metric card
   * narrows those to what the monitor watches now.
   */
  metricQueriesAsRead?: boolean | undefined;
}
