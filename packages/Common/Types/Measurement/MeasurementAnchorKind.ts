/*
 * The three ways a measurement endpoint can be located in time.
 *
 * Domain services translate their own anchor-type enum into one of these
 * before handing the definition to MeasurementEvaluator, which is what lets
 * one evaluator serve incidents, alerts and scheduled maintenance events.
 */
enum MeasurementAnchorKind {
  // A timestamp column on the entity itself, already resolved by the caller.
  Timestamp = "Timestamp",

  // The moment a specific state was entered, located by state id.
  StateEntered = "State Entered",

  /*
   * The moment a state carrying a given role was entered -- "whichever state
   * is the acknowledged one". Resolves by flag rather than pinning an id, so
   * it keeps working when a project renames or replaces the state.
   */
  StateRoleEntered = "State Role Entered",
}

export default MeasurementAnchorKind;
