/*
 * The roles an IncidentState can carry, mirroring the isCreatedState /
 * isAcknowledgedState / isResolvedState flags on the model.
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
