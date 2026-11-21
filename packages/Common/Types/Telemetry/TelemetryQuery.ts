import Log from "../../Models/AnalyticsModels/Log";
import Span from "../../Models/AnalyticsModels/Span";
import Query from "../BaseDatabase/Query";
import Dictionary from "../Dictionary";
import MetricViewData from "../Metrics/MetricViewData";
import TelemetryType from "./TelemetryType";
import ExceptionInstance from "../../Models/AnalyticsModels/ExceptionInstance";

/*
 * What a resource's logs or traces are read by: the attribute filters, as
 * the signal stores them, and the metric attributes the monitor narrowed its
 * reads by that the signal cannot carry (MonitorResourceSignalScope).
 */
export interface TelemetrySignalScope {
  attributes: Dictionary<string>;
  notCarried: Array<string>;
}

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
  /*
   * On a metric snapshot: the telemetry services every query was read for,
   * by id, when its Metrics monitor was limited to some
   * (MetricMonitorResponse.queryServiceIds). Absent: every service. The
   * event's metric card charts its queries for those services only (issue
   * #6266).
   */
  metricServiceIds?: Array<string> | undefined;
  /*
   * On a metric snapshot of a Host, Docker, Podman or IoT Device monitor:
   * its resource's logs and traces, by what the check read (#10451) - the
   * host, a container host's runtime, an IoT fleet, a systemd unit's
   * journal lines. The event's Logs, Traces and Exceptions tabs read these
   * in place of the metric queries' own filters, which are the metric's (a
   * Windows service's `name`, a CPU's `state`) and on no log line or span.
   * Absent for every other monitor, and on a snapshot stored before.
   */
  metricSignalScopes?:
    | { logs: TelemetrySignalScope; traces: TelemetrySignalScope }
    | undefined;
}
