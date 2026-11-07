enum ExceptionDetailSection {
  Overview = "overview",
  StackTrace = "stack-trace",
  Occurrences = "occurrences",
  Context = "context",
  Logs = "logs",
  AIAssistance = "ai-assistance",
  Settings = "settings",
  // Who resolved, archived or assigned it: its audit log entries.
  AuditLogs = "audit-logs",
}

export default ExceptionDetailSection;
