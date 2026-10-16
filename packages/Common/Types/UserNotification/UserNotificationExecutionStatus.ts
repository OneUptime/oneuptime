enum UserNotificationExecutionStatus {
  Scheduled = "Scheduled",
  Started = "Started",
  Executing = "Executing",
  Completed = "Completed",
  Error = "Error",
  /*
   * The person could not take the page and passed it on: the notifications
   * still due to them are not sent, and the run they were paged by passes
   * them over from now on (OnCallPagePassOn).
   */
  PassedOn = "Passed On",
}

export default UserNotificationExecutionStatus;
