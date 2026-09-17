/*
 * Where one end of a scheduled maintenance measurement is located in time.
 *
 * Maintenance is planned rather than detected, so the useful anchors are the
 * planned window against what actually happened -- "did we start on time",
 * "did we overrun" -- rather than an impact-onset timestamp.
 */
enum ScheduledMaintenanceMeasurementAnchorType {
  CreatedAt = "Created At",

  // The planned window, as configured on the event.
  ScheduledStartsAt = "Scheduled Starts At",
  ScheduledEndsAt = "Scheduled Ends At",

  TimelineStart = "Timeline Start",
  StateEntered = "State Entered",
  StateRoleEntered = "State Role Entered",
}

export default ScheduledMaintenanceMeasurementAnchorType;
