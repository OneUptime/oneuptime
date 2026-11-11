enum UserNotificationEventType {
  IncidentCreated = "Incident Created",
  AlertCreated = "Alert Created",
  AlertEpisodeCreated = "Alert Episode Created",
  IncidentEpisodeCreated = "Incident Episode Created",
  /*
   * A test page (Types/OnCallDutyPolicy/OnCallTestPage): a run, and every
   * log under it, with no incident, alert or episode behind it. It reaches
   * people through their own On-Call Rules for the kind of record and the
   * severity it stands in for, and every message says it is a test.
   */
  TestPage = "Test Page",
}

export default UserNotificationEventType;
