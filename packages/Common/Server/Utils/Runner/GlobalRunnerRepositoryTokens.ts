import { isRepositoryKeptOffGlobalRunners } from "../../../Types/Runner/GlobalRunnerRepositoryTokens";

/*
 * The server's side of Types/Runner/GlobalRunnerRepositoryTokens: whether
 * global Runners never get a GitLab, Forgejo, Gitea or Git repository's
 * connection token here. They do not on OneUptime Cloud (billing on), where
 * every customer's work shares the same global Runners; and on a self-hosted
 * install that serves several tenants and turns the rule on with
 * GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY=true. Both are read at call time, as
 * DataSourceEgressGuard reads BILLING_ENABLED, so the rule can be exercised
 * in tests; in a running deployment the environment is fixed at boot.
 */
export const GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY_SETTING: string =
  "GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY";

export default class GlobalRunnerRepositoryTokens {
  public static keepsConnectionTokensOffGlobalRunners(): boolean {
    return (
      process.env["BILLING_ENABLED"] === "true" ||
      process.env[GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY_SETTING] === "true"
    );
  }

  public static isRepositoryKeptOff(
    repositoryHostedAt: string | null | undefined,
  ): boolean {
    return isRepositoryKeptOffGlobalRunners({
      repositoryHostedAt,
      keepConnectionTokensOffGlobalRunners:
        GlobalRunnerRepositoryTokens.keepsConnectionTokensOffGlobalRunners(),
    });
  }
}
