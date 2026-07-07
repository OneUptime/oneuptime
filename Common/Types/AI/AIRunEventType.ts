enum AIRunEventType {
  RunStarted = "RunStarted",
  LlmCallStarted = "LlmCallStarted",
  LlmCallCompleted = "LlmCallCompleted",
  ToolCallStarted = "ToolCallStarted",
  ToolCallCompleted = "ToolCallCompleted",
  ToolCallFailed = "ToolCallFailed",
  RunCompleted = "RunCompleted",
  RunFailed = "RunFailed",
}

export default AIRunEventType;
