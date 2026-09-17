/*
 * The outcome of evaluating a measurement definition against one entity.
 *
 * A measurement is a named duration between two anchors. Every one of these
 * values is a deliberate alternative to writing a number that looks plausible
 * and is wrong -- which is the failure mode this feature exists to remove.
 */
enum MeasurementStatus {
  // Both anchors resolved and the duration is meaningful.
  Recorded = "Recorded",

  /*
   * An anchor has not happened yet but still can. The entity is mid-flight.
   * This is the only status that is expected to change on its own.
   */
  Pending = "Pending",

  /*
   * An anchor can never resolve for this entity -- the state was skipped, the
   * timestamp was never recorded, or the referenced state has been deleted.
   * No metric point is written, so a skipped milestone does not pull an
   * average towards zero.
   */
  NotApplicable = "Not Applicable",

  /*
   * Both anchors resolved but the end precedes the start. This is the "field
   * whose value looks wrong" -- it means someone's recorded timestamps
   * disagree with each other, and it is surfaced rather than clamped to zero.
   */
  Invalid = "Invalid",
}

export default MeasurementStatus;
