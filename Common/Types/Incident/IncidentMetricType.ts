enum IncidentMetricType {
  TimeToAcknowledge = "oneuptime.incident.time-to-acknowledge",
  TimeToResolve = "oneuptime.incident.time-to-resolve",
  IncidentCount = "oneuptime.incident.count",
  IncidentDuration = "oneuptime.incident.duration",
  TimeInState = "oneuptime.incident.time-in-state",
  SeverityChange = "oneuptime.incident.severity-change",
  PostmortemCompletionTime = "oneuptime.incident.postmortem-completion-time",
}

export default IncidentMetricType;
