/*
 * Which entry to use when a state is entered more than once -- the reopen knob.
 *
 * `First` reproduces the behaviour of the built-in metrics, which resolve a
 * state with `.find()` over a timeline sorted ascending. `Last` is the opt-in
 * selector for teams who want a reopened incident's measurement to move to the
 * final resolution rather than pinning to the first one.
 */
enum MeasurementOccurrence {
  First = "First",
  Last = "Last",
}

export default MeasurementOccurrence;
