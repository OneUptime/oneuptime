enum AIRunType {
  Chat = "Chat",
  Investigation = "Investigation",
  /*
   * An exception-fix run executed by an external AI agent container: it
   * claims the run over HTTP, works in the project's code repository and
   * opens a pull request. Replaces the legacy AIAgentTask substrate.
   */
  CodeFix = "CodeFix",
  /*
   * A read-only auto-remediation planning run: reads the incident/alert
   * context and picks the most applicable runbook for its
   * AutoRemediationSuggestion. It never executes anything — execution only
   * happens after one-click human approval (or via deterministic FullAuto
   * rules, which never involve the AI).
   */
  RemediationPlan = "RemediationPlan",
}

export default AIRunType;
