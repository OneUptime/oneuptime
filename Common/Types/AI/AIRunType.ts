enum AIRunType {
  Chat = "Chat",
  Investigation = "Investigation",
  /*
   * An exception-fix run executed by an external AI agent container: it
   * claims the run over HTTP, works in the project's code repository and
   * opens a pull request. Replaces the legacy AIAgentTask substrate.
   */
  CodeFix = "CodeFix",
}

export default AIRunType;
