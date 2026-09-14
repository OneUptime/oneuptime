/*
 * The command grammar the OneUptime GitHub App understands when it is
 * mentioned in an issue or pull request conversation.
 *
 * These strings are persisted on AIRun.taskContext and travel to the agent
 * worker over /ai-agent-data/get-github-task-details, so they are a wire
 * contract — do not rename them.
 */
enum GitHubCommandType {
  // "@oneuptime review" on a pull request: post a code review, change nothing.
  Review = "Review",
  /*
   * "@oneuptime revise this because ..." on a pull request: push new commits
   * to the SAME head branch. Never opens a second pull request.
   */
  Revise = "Revise",
  /*
   * "@oneuptime fix this" on an issue (or an assignment / trigger label):
   * work the issue and open a pull request that closes it.
   */
  Implement = "Implement",
  // "@oneuptime help": reply with the command list. No agent run.
  Help = "Help",
  // "@oneuptime status": reply with what this app is currently working on.
  Status = "Status",
  // "@oneuptime cancel": cancel the in-flight run for this issue / PR.
  Cancel = "Cancel",
}

export default GitHubCommandType;

/*
 * Where the mention was written. The same words mean different things on the
 * two surfaces — a bare "@oneuptime please tidy this up" is a revision on a
 * pull request and a new implementation on an issue — so the parser is told
 * which one it is reading rather than guessing from the text.
 */
export enum GitHubCommandSurface {
  Issue = "Issue",
  PullRequest = "PullRequest",
}

export interface GitHubCommand {
  commandType: GitHubCommandType;
  /*
   * Everything the author wrote after the mention, with the mention token
   * itself removed. Empty when they only mentioned the app.
   *
   * UNTRUSTED. This is arbitrary text from a GitHub comment that ends up
   * inside an LLM prompt — every consumer treats it as data to be quoted,
   * never as instructions that can widen what the run is allowed to do.
   */
  instruction: string;
}

/*
 * Commands that only need a reply. They are answered synchronously in the
 * webhook handler and never enqueue an agent run, so they cost nothing and
 * are not subject to the fix-run budget.
 */
export function isConversationalCommand(
  commandType: GitHubCommandType,
): boolean {
  return (
    commandType === GitHubCommandType.Help ||
    commandType === GitHubCommandType.Status ||
    commandType === GitHubCommandType.Cancel
  );
}
