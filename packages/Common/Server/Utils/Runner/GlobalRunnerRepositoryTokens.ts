import {
  GlobalRunnerKeptOffReason,
  getGlobalRunnerKeptOffReason,
} from "../../../Types/Runner/GlobalRunnerRepositoryTokens";

/*
 * The server's side of Types/Runner/GlobalRunnerRepositoryTokens: whether
 * global Runners never get a connection's own token here - a Forgejo, Gitea
 * or Git repository's, or a GitLab repository's GitLab made no short-lived
 * token for. They do not on OneUptime Cloud (billing on), where every
 * customer's work shares the same global Runners; and on a self-hosted
 * install that serves several tenants and turns the rule on with
 * GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY=true. Both are read at call time, as
 * DataSourceEgressGuard reads BILLING_ENABLED, so the rule can be exercised
 * in tests; in a running deployment the environment is fixed at boot.
 */
export const GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY_SETTING: string =
  "GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY";

// What the rule reads off a repository.
export interface GlobalRunnerRepositoryFacts {
  repositoryHostedAt?: string | null | undefined;
  // When GitLab last refused to make the short-lived token a fix pushes with.
  mintedTokenRefusedAt?: Date | string | null | undefined;
}

export default class GlobalRunnerRepositoryTokens {
  public static keepsConnectionTokensOffGlobalRunners(): boolean {
    return (
      process.env["BILLING_ENABLED"] === "true" ||
      process.env[GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY_SETTING] === "true"
    );
  }

  /*
   * Why global Runners stay out of the repository here, or null while they
   * may work in it. A host alone (a string) is a repository GitLab has not
   * refused.
   */
  public static getKeptOffReason(
    repository: GlobalRunnerRepositoryFacts | string | null | undefined,
  ): GlobalRunnerKeptOffReason | null {
    const facts: GlobalRunnerRepositoryFacts =
      repository && typeof repository === "object"
        ? repository
        : { repositoryHostedAt: repository };

    return getGlobalRunnerKeptOffReason({
      repositoryHostedAt: facts.repositoryHostedAt,
      keepConnectionTokensOffGlobalRunners:
        GlobalRunnerRepositoryTokens.keepsConnectionTokensOffGlobalRunners(),
      mintedTokenRefusedAt: facts.mintedTokenRefusedAt,
    });
  }

  public static isRepositoryKeptOff(
    repository: GlobalRunnerRepositoryFacts | string | null | undefined,
  ): boolean {
    return GlobalRunnerRepositoryTokens.getKeptOffReason(repository) !== null;
  }
}
