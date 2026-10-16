enum OnCallDutyExecutionLogTimelineStatus {
  Skipped = "Skipped",
  Started = "Started",
  Executing = "Executing",
  SuccessfullyAcknowledged = "Successfully Acknowledged",
  NotificationSent = "Notification Sent",
  Error = "Error",
  /*
   * The person paged could not take it and passed it on (OnCallPagePassOn):
   * the run moves on without them.
   */
  PassedOn = "Passed On",
}

export default OnCallDutyExecutionLogTimelineStatus;
