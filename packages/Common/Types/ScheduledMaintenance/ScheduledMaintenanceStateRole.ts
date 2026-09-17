/*
 * The roles a ScheduledMaintenanceState can carry, mirroring
 * isScheduledState / isOngoingState / isEndedState / isResolvedState.
 *
 * Note this vocabulary differs from incidents and alerts -- which is exactly
 * why measurement definitions resolve endpoints per domain rather than
 * assuming one shared created/acknowledged/resolved triple.
 */
enum ScheduledMaintenanceStateRole {
  Scheduled = "Scheduled",
  Ongoing = "Ongoing",
  Ended = "Ended",
  Resolved = "Resolved",
}

export default ScheduledMaintenanceStateRole;
