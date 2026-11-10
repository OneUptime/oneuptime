enum AIRunEventType {
  RunStarted = "RunStarted",
  LlmCallStarted = "LlmCallStarted",
  LlmCallCompleted = "LlmCallCompleted",
  /*
   * A model call failed for good, after LLMService's own retries (issue
   * #6437). It closes the LlmCallStarted before it, so the step stops
   * thinking. resultSummary.errorMessage says why.
   */
  LlmCallFailed = "LlmCallFailed",
  ToolCallStarted = "ToolCallStarted",
  ToolCallCompleted = "ToolCallCompleted",
  ToolCallFailed = "ToolCallFailed",
  // The run paused to ask the user to approve one or more mutating actions.
  ApprovalRequested = "ApprovalRequested",
  // A mutating action the user approved was executed (or denied and skipped).
  ActionExecuted = "ActionExecuted",
  ActionDenied = "ActionDenied",
  /*
   * A plain progress/log line reported by an external executor (e.g. the
   * code-fix agent container). The message lives in resultSummary.message.
   */
  ProgressLog = "ProgressLog",
  /*
   * An incident's or alert's investigation could not tell the cause for
   * lack of logs (Utils/AI/InvestigationLogStall): what stood in its way is
   * in resultSummary.logStall, and an English line in resultSummary.message.
   * The AI card says it, with a way forward; the activity feed draws no step
   * for it.
   */
  InvestigationStalled = "InvestigationStalled",
  /*
   * An incident's or alert's investigation measured who and what it hurts,
   * in numbers (Utils/AI/InvestigationImpactNumbers): the users, sessions
   * or requests, the services and the SLOs are in
   * resultSummary.impactNumbers, and an English line in
   * resultSummary.message. The AI card's folded Investigation step draws
   * them under the summary; the activity feed draws no step for it.
   */
  InvestigationImpact = "InvestigationImpact",
  /*
   * An attempt of a durable run (an investigation, a triage, a remediation)
   * ended without settling the run: it failed and the run is tried again,
   * the server running it shut down and handed the run back, or it stopped
   * reporting progress and the stale sweep requeued the run. It closes
   * every step of the attempt still open. resultSummary.attemptEnd
   * (Types/AI/AIRunAttempt) says how it ended and when the next is due.
   */
  AttemptEnded = "AttemptEnded",
  RunCompleted = "RunCompleted",
  /*
   * The run failed for good. A durable run's says, in
   * resultSummary.attemptEnd, why and how many times it was tried.
   */
  RunFailed = "RunFailed",
}

export default AIRunEventType;
