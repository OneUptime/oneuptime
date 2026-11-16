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
  /*
   * Another policy's run is paging the person about the same record already:
   * this page was merged into that one, sends nothing of its own while that
   * one is open, and takes the page over if that one ends without their
   * answer (Types/OnCallDutyPolicy/OnCallPageMerge).
   */
  AlreadyPaged = "Already Paged",
}

export default UserNotificationExecutionStatus;
