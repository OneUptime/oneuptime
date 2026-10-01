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
  /*
   * An auto-remediation run that COMPOSES commands instead of picking a
   * runbook: rules with aiComposesCommands, and cluster rounds a
   * Kubernetes cluster's AI agent page asks for. In Suggest mode it
   * investigates read-only and proposes a command plan for one-click
   * approval; in FullAuto mode it may also execute commands inline, but
   * only ones that pass the structural policy guard and match the rule's
   * operator-authored allowlist (or the cluster's Fixes mode). Every run
   * requires Project.enableAi, the project's only AI switch. Rule runs also
   * need a target Runner with canRunAiCommands (Bash/SSH on Runners, and
   * any kubectl a rule composes). A cluster round's consent is the
   * cluster's Fixes mode plus the write access of whatever reaches the
   * cluster: the Kubernetes agent chart's RBAC, or the Kubernetes
   * credential of a Runner bound to the cluster.
   */
  RemediationExecution = "RemediationExecution",
}

export default AIRunType;
