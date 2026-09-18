/*
 * What a CodeFix run needs before it can complete, as a wire contract shared
 * by the server checks and every UI that renders them. Two surfaces consume
 * this today: the per-exception "Fix with AI Agent" panel
 * (GET /telemetry-exception/ai-fix-readiness/:id) and the project-wide AI
 * Tasks page (POST /ai-readiness/code-fix).
 */

/*
 * The repository gate comes in two strengths, and they are deliberately
 * distinct ids — a UI that conflates them would promise more than the check
 * verified:
 *
 * - repositoryResolved: a repository matches THIS exception's stack trace.
 *   Per-exception, and the stronger claim.
 * - repositoryConnected: the project has at least one GitHub-App-connected
 *   repository. Project-wide, and all a page-level check can honestly assert
 *   — it says nothing about whether any given exception will resolve.
 */
export type AIFixReadinessCheckId =
  | "llmProvider"
  | "repositoryResolved"
  | "repositoryConnected"
  | "agentAvailable";

export interface AIFixReadinessCheck {
  id: AIFixReadinessCheckId;
  ok: boolean;
  /*
   * The gate's headline. Checks fill in what they actually found where that
   * is useful ("Repository resolved: acme/api"), so this is not a fixed
   * label per id.
   */
  title: string;
  /*
   * When ok is false: exactly what to do next. When ok is true: what is
   * configured, so the user can tell a project-owned provider from the
   * shared one without leaving the page. May be empty.
   */
  detail: string;
}

export interface AIFixReadiness {
  ready: boolean;
  checks: Array<AIFixReadinessCheck>;
}
