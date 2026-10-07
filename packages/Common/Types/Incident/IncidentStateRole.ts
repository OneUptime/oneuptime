/*
 * The roles an incident's move into a state can play: Created is the
 * project's created state (isCreatedState); Acknowledged is a move into a
 * state that counts as acknowledged (Common/Utils/AcknowledgedState: the
 * acknowledged state, one placed after it, or a resolved one) from one that
 * does not; Resolved a move into a state that counts as resolved
 * (Common/Utils/ResolvedState) from one that does not.
 *
 * Resolving by role rather than by state id keeps a measurement working when
 * a project renames or replaces the state that plays that part.
 */
enum IncidentStateRole {
  Created = "Created",
  Acknowledged = "Acknowledged",
  Resolved = "Resolved",
}

export default IncidentStateRole;
