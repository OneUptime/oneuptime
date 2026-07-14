enum IncidentMetricType {
  TimeToAcknowledge = "oneuptime.incident.time-to-acknowledge",
  TimeToResolve = "oneuptime.incident.time-to-resolve",
  IncidentCount = "oneuptime.incident.count",
  IncidentDuration = "oneuptime.incident.duration",
  TimeInState = "oneuptime.incident.time-in-state",
  SeverityChange = "oneuptime.incident.severity-change",
  PostmortemCompletionTime = "oneuptime.incident.postmortem-completion-time",
  /*
   * Seconds from incident creation to the moment the Sentinel investigation
   * posted its root-cause analysis. Written once from the investigation
   * runner (not from refreshIncidentMetrics — the refresh replace-list
   * deliberately excludes this name so refreshes never tombstone it).
   */
  TimeToRootCausePosted = "oneuptime.incident.time-to-rca",
}

export default IncidentMetricType;
