/*
 * The automatic grade assigned to a completed AI investigation when its
 * incident resolves with a human-recorded root cause (Phase 2 measurement
 * layer): one constrained LLM call compares the investigation's posted
 * analysis with Incident.rootCause and stores the verdict on the run
 * (AIRun.autoGrade). See
 * Common/Server/Utils/AI/SRE/InvestigationGrader.ts.
 */
enum AIRunAutoGrade {
  // The analysis identified the same root cause the humans recorded.
  Match = "Match",
  // Part of the cause, or a closely related cause.
  Partial = "Partial",
  // The analysis pointed somewhere else.
  Mismatch = "Mismatch",
}

export default AIRunAutoGrade;
