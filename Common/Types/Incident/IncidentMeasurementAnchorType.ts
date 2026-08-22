/*
 * Where one end of an incident measurement is located in time.
 *
 * Deliberately wider than "a state" -- the request that prompted this asked
 * for `Started -> Detected`, and "started" is not a state and never will be.
 * Allowing a timestamp column as an endpoint is what makes Time to Detect
 * expressible at all.
 */
enum IncidentMeasurementAnchorType {
  // When customer impact actually began. Recorded by a human; never inferred.
  ImpactStartedAt = "Impact Started At",

  // When the incident was declared. Defaults to creation time.
  DeclaredAt = "Declared At",

  CreatedAt = "Created At",

  /*
   * The origin the built-in incident metrics use: the first state timeline
   * entry, falling back to declaredAt and then createdAt. Exists so a
   * definition can reproduce today's numbers exactly.
   */
  TimelineStart = "Timeline Start",

  // A specific state, pinned by id.
  StateEntered = "State Entered",

  // Whichever state carries a role -- created, acknowledged or resolved.
  StateRoleEntered = "State Role Entered",

  PostmortemPostedAt = "Postmortem Posted At",
}

export default IncidentMeasurementAnchorType;
