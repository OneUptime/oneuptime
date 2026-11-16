import CodeRepositoryType from "../CodeRepository/CodeRepositoryType";
import { CodeHost } from "../CodeRepository/CodeHost";

/*
 * WHICH REPOSITORIES GLOBAL RUNNERS STAY OUT OF.
 *
 * A Runner works in a repository with a token the server hands it for the
 * run. A GitHub repository's is minted for that one repository from the
 * GitHub App and revoked when the run ends. A GitLab, Forgejo, Gitea or Git
 * repository's is the token its connection holds (CodeRepositoryConnection):
 * long-lived, and as wide as the account it was made with. None of those
 * hosts lets OneUptime make a narrower one with the token it holds - GitLab
 * makes a project access token only for a Maintainer's token with the api
 * scope, not on GitLab.com's Free tier, with an expiry counted in whole days,
 * and a bot user of its own whose merge requests it then writes; Gitea and
 * Forgejo make tokens only for a user's password, never for another token;
 * a plain Git server has no API at all - so the connection's token is what
 * a Runner would get.
 *
 * Where every customer's JavaScript steps run on the same global Runners -
 * OneUptime Cloud, or a self-hosted install that serves several tenants and
 * turns the rule on (GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY) - such a token
 * never goes to one: the repository's AI work runs on a Runner of the
 * project's own (the one it picks in Code, or the project's default Runner),
 * or on an AI agent of the project's own. The server holds the rule where
 * the work is claimed (CodeFixClaimQuery), where the token is handed
 * (CodeHostRunnerToken) and where Code says what the repository runs on
 * (CodeRepositoryRunnerChoice); the dashboard says it where the repository's
 * Runner is picked. A single-tenant self-hosted OneUptime runs its global
 * Runners for its own projects, and is left as it was.
 *
 * Pure, so the server and the dashboard answer the same way.
 */

export const GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL: string =
  "AI works in a GitLab, Forgejo, Gitea or Git repository on one of your own Runners, never a global one: the repository's access token is its connection's own. Pick one of your Runners in the repository's settings in Code.";

/*
 * Whether global Runners stay out of this repository: where they keep
 * connection tokens off (OneUptime Cloud, or a self-hosted multi-tenant
 * install with the setting on), every repository that is not on GitHub. A
 * stored host that cannot be read is GitHub, as every repository was before
 * the others (CodeHost.readType).
 */
export function isRepositoryKeptOffGlobalRunners(data: {
  repositoryHostedAt: string | null | undefined;
  keepConnectionTokensOffGlobalRunners: boolean;
}): boolean {
  return (
    data.keepConnectionTokensOffGlobalRunners &&
    CodeHost.readType(data.repositoryHostedAt) !== CodeRepositoryType.GitHub
  );
}
