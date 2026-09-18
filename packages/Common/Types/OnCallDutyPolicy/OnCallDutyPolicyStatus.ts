enum OnCallDutyPolicyStatus {
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
