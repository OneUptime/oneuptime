import Log from "../../Models/AnalyticsModels/Log";
import Span from "../../Models/AnalyticsModels/Span";
import Query from "../BaseDatabase/Query";
import Dictionary from "../Dictionary";
import MetricViewData from "../Metrics/MetricViewData";
import TelemetryType from "./TelemetryType";
import ExceptionInstance from "../../Models/AnalyticsModels/ExceptionInstance";

export interface TelemetryQuery {
  telemetryType: TelemetryType;
  telemetryQuery: Query<Log> | Query<Span> | Query<ExceptionInstance> | null;
  metricViewData: MetricViewData | null;
  /*
   * On a metric snapshot: for each of metricViewData's queries, in order,
   * the attribute filters its monitor added when the check read it - the
   * cluster, host, vCenter, array or fleet an infrastructure monitor
   * watches, its resource filters, and any filter of the query's own it
   * overrode - or null where it added none (every query of a Metrics
   * monitor). The queries themselves stay as the step keeps them, so what
   * reads their own filters (the event's Logs, Traces and Exceptions tabs)
   * reads what it always did; the event's metric card charts each query
   * with its scope (MetricTelemetrySnapshot, issue #6265). Absent on a
   * snapshot stored before: that card narrows it to what the monitor
   * watches now.
   */
  metricQueryScopes?: Array<Dictionary<unknown> | null> | undefined;
}
