enum AIRunEventType {
  RunStarted = "RunStarted",
  LlmCallStarted = "LlmCallStarted",
  LlmCallCompleted = "LlmCallCompleted",
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
  RunCompleted = "RunCompleted",
  RunFailed = "RunFailed",
}

export default AIRunEventType;
