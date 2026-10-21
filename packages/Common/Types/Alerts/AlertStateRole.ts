/*
 * The roles an alert's move into a state can play: Created is the project's
 * created state (isCreatedState); Acknowledged is a move into a state that
 * counts as acknowledged (Common/Utils/AcknowledgedState: the acknowledged
 * state, one placed after it, or a resolved one) from one that does not;
 * Resolved a move into a state that counts as resolved
 * (Common/Utils/ResolvedState) from one that does not.
 */
enum AlertStateRole {
  Created = "Created",
  Acknowledged = "Acknowledged",
  Resolved = "Resolved",
}

export default AlertStateRole;
