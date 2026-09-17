/*
 * The roles an AlertState can carry, mirroring isCreatedState /
 * isAcknowledgedState / isResolvedState on the model.
 */
enum AlertStateRole {
  Created = "Created",
  Acknowledged = "Acknowledged",
  Resolved = "Resolved",
}

export default AlertStateRole;
