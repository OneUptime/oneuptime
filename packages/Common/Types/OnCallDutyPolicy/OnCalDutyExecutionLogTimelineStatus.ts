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
  /*
   * Another policy's run is paging the person about the same record already,
   * and its page stands for this one (Types/OnCallDutyPolicy/OnCallPageMerge):
   * the person was reached, so the level waits its minutes as for any page.
   */
  AlreadyPaged = "Already Paged",
}

export default OnCallDutyExecutionLogTimelineStatus;
