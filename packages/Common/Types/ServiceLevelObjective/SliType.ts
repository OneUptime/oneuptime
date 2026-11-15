/*
 * What an SLO measures. The values are stored in the SLO's sliType column and
 * written by API clients, Terraform and workflows, so they never change.
 *
 *   - Monitor Uptime: the share of time the SLO's monitors are up, read from
 *     their status timelines.
 *   - Request Success: the share of the requests its services served that
 *     did not fail, counted from their traces (Utils/Slo/SloRequestSli).
 *   - Request Latency: the share of those requests served within the SLO's
 *     latency threshold, counted from their traces the same way.
 *   - Metric: reserved for an SLI read from a metric query. Nothing measures
 *     it yet, so an SLO of this type reads Misconfigured.
 */
enum SliType {
  MonitorUptime = "Monitor Uptime",
  RequestSuccess = "Request Success",
  RequestLatency = "Request Latency",
  Metric = "Metric",
}

export default SliType;
