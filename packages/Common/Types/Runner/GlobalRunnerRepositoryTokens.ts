import CodeRepositoryType from "../CodeRepository/CodeRepositoryType";
import { CodeHost } from "../CodeRepository/CodeHost";

/*
 * WHICH REPOSITORIES GLOBAL RUNNERS STAY OUT OF.
 *
 * A Runner works in a repository with a token the server hands it for the
 * run. A GitHub repository's is minted for that one repository from the
 * GitHub App and revoked when the run ends. A GitLab repository's is, where
 * GitLab lets OneUptime make one (issue #8912), a project access token made
 * for the run alone: on that one project, able to push and nothing else,
 * ending on its own by the end of the next day in UTC and revoked when the
 * run ends - GitLab makes one only for a Maintainer's or Owner's token with
 * the api scope, and on GitLab.com only on Premium and Ultimate. A Forgejo, Gitea or Git
 * repository's is the token its connection holds (CodeRepositoryConnection):
 * long-lived, and as wide as the account it was made with, because neither
 * host lets OneUptime make a narrower one with the token it holds - Gitea
 * and Forgejo make tokens only for a user's password, never for another
 * token, and a plain Git server has no API at all.
 *
 * Where every customer's JavaScript steps run on the same global Runners -
 * OneUptime Cloud, or a self-hosted install that serves several tenants and
 * turns the rule on (GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY) - a connection's
 * own token never goes to one: a Forgejo, Gitea or Git repository's AI work
 * runs on a Runner of the project's own (the one it picks in Code, or the
 * project's default Runner), or on an AI agent of the project's own; so does
 * a GitLab repository's once GitLab refused to make it a token
 * (CodeRepository.mintedTokenRefusedAt). The server holds the rule where the
 * work is claimed (CodeFixClaimQuery), where the token is handed
 * (CodeHostRunnerToken) and where Code says what the repository runs on
 * (CodeRepositoryRunnerChoice); the dashboard says it where the
 * repository's Runner is picked. A single-tenant self-hosted OneUptime runs
 * its global Runners for its own projects, and is left as it was.
 *
 * Pure, so the server and the dashboard answer the same way.
 */

// Why global Runners stay out of a repository.
export enum GlobalRunnerKeptOffReason {
  /*
   * Forgejo, Gitea or Git: the repository is reached with its connection's
   * own token, which OneUptime cannot narrow: Forgejo and Gitea make a
   * token only for a user's password, and a Git server has no API.
   */
  ConnectionToken = "ConnectionToken",
  // GitLab: GitLab refused to make the short-lived token a fix pushes with.
  TokenNotMinted = "TokenNotMinted",
}

export const GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL: string =
  "AI works in a Forgejo, Gitea or Git repository on one of your own Runners, never a global one: the repository's access token is its connection's own. Pick one of your Runners in the repository's settings in Code.";

export const GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_REFUSAL: string =
  "GitLab did not let OneUptime make a short-lived token for this repository, so AI works in it on one of your own Runners. Give its connection a token of someone with the Maintainer role and the api scope (GitLab self-managed, or GitLab.com Premium or Ultimate), or pick one of your Runners in the repository's settings in Code.";

/*
 * What a global Runner too old to push with a short-lived GitLab token is
 * told for a GitLab repository: one of this release or later, or one of the
 * project's own Runners, does the work.
 */
export const GLOBAL_RUNNER_TOO_OLD_FOR_GITLAB_REFUSAL: string =
  "This global Runner is older than the short-lived tokens AI pushes to GitLab with. AI works in this repository on a global Runner of the latest version, or on one of your own Runners.";

/*
 * Why global Runners stay out of this repository, or null while they may
 * work in it: where they keep connection tokens off (OneUptime Cloud, or a
 * self-hosted multi-tenant install with the setting on), every Forgejo,
 * Gitea and Git repository, and a GitLab repository GitLab refused to make a
 * token for. A stored host that cannot be read is GitHub, as every
 * repository was before the others (CodeHost.readType).
 */
export function getGlobalRunnerKeptOffReason(data: {
  repositoryHostedAt: string | null | undefined;
  keepConnectionTokensOffGlobalRunners: boolean;
  /*
   * When GitLab last refused to make the short-lived token a fix pushes
   * with (CodeRepository.mintedTokenRefusedAt); left out, it has not.
   */
  mintedTokenRefusedAt?: Date | string | null | undefined;
}): GlobalRunnerKeptOffReason | null {
  if (!data.keepConnectionTokensOffGlobalRunners) {
    return null;
  }

  switch (CodeHost.readType(data.repositoryHostedAt)) {
    case CodeRepositoryType.GitHub:
      return null;
    case CodeRepositoryType.GitLab:
      return data.mintedTokenRefusedAt
        ? GlobalRunnerKeptOffReason.TokenNotMinted
        : null;
    default:
      return GlobalRunnerKeptOffReason.ConnectionToken;
  }
}

// Whether global Runners stay out of this repository (getGlobalRunnerKeptOffReason).
export function isRepositoryKeptOffGlobalRunners(data: {
  repositoryHostedAt: string | null | undefined;
  keepConnectionTokensOffGlobalRunners: boolean;
  mintedTokenRefusedAt?: Date | string | null | undefined;
}): boolean {
  return getGlobalRunnerKeptOffReason(data) !== null;
}

// What a global Runner is told for a repository it stays out of, and why.
export function getGlobalRunnerKeptOffRefusal(
  reason: GlobalRunnerKeptOffReason,
): string {
  return reason === GlobalRunnerKeptOffReason.TokenNotMinted
    ? GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_REFUSAL
    : GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL;
}
