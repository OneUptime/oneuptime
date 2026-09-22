export default interface TelemetryMonitorSummary {
  lastCheckedAt?: Date | undefined;
  nextCheckAt?: Date | undefined;
  /*
   * What lastCheckedAt is. The overview passes the newest evaluation when the
   * log has one ("Evaluated At") and otherwise the scheduler's stamp, which
   * only says a run was queued ("Scheduled At"). Defaults to "Monitored At".
   */
  lastCheckedLabel?: string | undefined;
}
