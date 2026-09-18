/*
 * The durable code-fix recommendation for an incident/alert investigation.
 * Stored on AIRun so the dashboard and the manual fix-task endpoint consume
 * the same server-authored decision instead of interpreting analysis prose.
 *
 * Every run starts NotRecommended. The investigation engine atomically moves
 * a winning incident/alert run to Pending with its Completed transition, then
 * settles the posted analysis to a terminal recommendation. This keeps all
 * error, legacy and non-investigation paths fail closed.
 */
enum AIRunCodeFixRecommendation {
  Pending = "Pending",
  Recommended = "Recommended",
  NotRecommended = "NotRecommended",
}

export default AIRunCodeFixRecommendation;
