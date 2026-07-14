/*
 * The one-click human verdict on a completed AI investigation's posted
 * analysis (Phase 2 measurement layer). Captured via
 * POST /ai-investigation/verdict from the investigation panel and stored on
 * the run (AIRun.humanVerdict).
 *
 * The roadmap's "confirmed/edited/rejected" trichotomy is deliberately a
 * two-button UI: "edited" is not something a human declares up front — it is
 * detected later by the grading side (comparing the analysis with the final
 * recorded root cause), so the human control stays a binary confirm/reject.
 */
enum AIRunHumanVerdict {
  Confirmed = "Confirmed",
  Rejected = "Rejected",
}

export default AIRunHumanVerdict;
