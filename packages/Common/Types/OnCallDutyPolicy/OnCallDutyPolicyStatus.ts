enum OnCallDutyPolicyStatus {
  /*
   * Held until a moment of its own - by an on-call rule that pages only
   * during working hours - and paging nobody until then
   * (OnCallDutyPolicyRunWait). The worker starts it at its first escalation
   * rule once its pagingStartsAt comes, or ends it there if its record was
   * handled or its policy archived in the meantime. Not Scheduled: a run
   * that is still Scheduled after five minutes is stuck and timed out
   * (TimeoutStuckExecutions), and a waiting run may wait for days.
   */
  Waiting = "Waiting",
  Scheduled = "Scheduled",
  Started = "Started",
  Executing = "Executing",
  Completed = "Execution Completed",
  /*
   * Terminal, like Completed, but the policy walked every escalation rule
   * without paging a single person — typically because every rule targeted an
   * on-call schedule that had nobody on call. Kept distinct from Completed
   * because the two used to be indistinguishable: an incident that notified
   * nobody closed out with the same green "Execution Completed" as one that
   * successfully paged the on-call engineer, so a policy could silently notify
   * no one indefinitely.
   *
   * `status` is a varchar column (not a Postgres enum type), so adding this
   * value needs no schema migration.
   */
  CompletedWithNoNotifications = "Execution Completed - No One Notified",
  Error = "Error",
}

export default OnCallDutyPolicyStatus;
