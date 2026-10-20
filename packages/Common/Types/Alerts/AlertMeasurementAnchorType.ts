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

  /*
   * When an on-call policy or a direct page first notified somebody about
   * the alert (Alert.firstPagedAt). Empty until somebody is paged.
   */
  FirstPagedAt = "First Paged At",
}

export default AlertMeasurementAnchorType;
