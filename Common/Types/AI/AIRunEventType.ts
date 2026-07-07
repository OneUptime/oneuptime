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
  RunCompleted = "RunCompleted",
  RunFailed = "RunFailed",
}

export default AIRunEventType;
