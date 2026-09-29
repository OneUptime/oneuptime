/*
 * Where one end of an alert measurement is located in time.
 * Mirrors IncidentMeasurementAnchorType, minus the incident-only anchors
 * (alerts carry no declaredAt and have no postmortem).
 */
enum AlertMeasurementAnchorType {
  ImpactStartedAt = "Impact Started At",
  CreatedAt = "Created At",
  TimelineStart = "Timeline Start",
  StateEntered = "State Entered",
  StateRoleEntered = "State Role Entered",
}

export default AlertMeasurementAnchorType;
