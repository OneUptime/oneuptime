/*
 * THE PLACES OF A CODE REPOSITORY'S SETTINGS ON ITS SETTINGS PAGE.
 *
 * Each setting of a repository in Code has a place on its Settings page:
 * its card's id, the key the page's More settings lists it by, and what a
 * link names after the page's "#" to land on it - More settings then opens
 * by itself there (Common/UI/Utils/PageAnchor). "Pick a Runner" opens
 * ".../settings#runner".
 *
 * React-free and server-free, so the Dashboard's page and links
 * (Components/Code/CodeRepositorySettingsCopy, CodePaths) and the server's
 * links into the Dashboard - the GitHub App's answer when a repository's
 * commands are off links straight to its switch - name the same places.
 */

/*
 * The settings of a repository, by their places on its Settings page, in
 * the order the page draws them under More settings.
 */
export enum CodeRepositorySetting {
  GitHubCommands = "github-commands",
  ProductionReview = "production-review",
  Runner = "runner",
  PullRequests = "pull-requests",
  TriggerLabel = "trigger-label",
  ProductionReviewComment = "production-review-comment",
  // The LLM provider OneUptime AI reads pull requests with in its reviews.
  ProductionReviewLlmProvider = "production-review-llm-provider",
  // Only on a repository whose operator set build and test commands.
  Commands = "commands",
  /*
   * A Git repository's Pull Requests: AI pushes a branch there and opens no
   * pull request, so only the branch it starts from is asked.
   */
  Branches = "branches",
}

/*
 * A repository's Settings page in the Dashboard, under the Dashboard's own
 * address (DashboardClientUrl, ".../dashboard"), landing on one of its
 * settings when it is named: the route the Dashboard draws it at
 * (RouteMap's PageMap.CODE_REPOSITORY_VIEW_SETTINGS), and the place after
 * its "#".
 */
export function getCodeRepositorySettingsPath(data: {
  projectId: string;
  codeRepositoryId: string;
  setting?: CodeRepositorySetting | undefined;
}): string {
  const path: string = `/${encodeURIComponent(data.projectId)}/code/repositories/${encodeURIComponent(data.codeRepositoryId)}/settings`;

  return data.setting ? `${path}#${data.setting}` : path;
}
