import TelemetryObservation from "Common/Types/Monitor/TelemetryObservation";

export default interface TelemetryMonitorSummary {
  lastCheckedAt?: Date | undefined;
  nextCheckAt?: Date | undefined;
  /*
   * What lastCheckedAt is. The overview passes the newest evaluation when the
   * log has one ("Evaluated At") and otherwise the scheduler's stamp, which
   * only says a run was queued ("Scheduled At"). Defaults to "Monitored At".
   */
  lastCheckedLabel?: string | undefined;
  /*
   * A check that has run, as a Monitoring Logs row shows it: it has no next
   * check, so "Next Check At" is not drawn.
   */
  isPastCheck?: boolean | undefined;
  // What the check saw (MonitorLogSummaryUtil.getTelemetryObservation).
  observation?: TelemetryObservation | undefined;
}
