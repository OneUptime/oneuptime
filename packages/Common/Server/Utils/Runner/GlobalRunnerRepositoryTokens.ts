import { isRepositoryKeptOffGlobalRunners } from "../../../Types/Runner/GlobalRunnerRepositoryTokens";

/*
 * The server's side of Types/Runner/GlobalRunnerRepositoryTokens: whether
 * this install is OneUptime Cloud, where global Runners never get a GitLab,
 * Forgejo, Gitea or Git repository's connection token. Billing on is
 * OneUptime Cloud, read at call time as DataSourceEgressGuard reads it, so
 * the rule can be exercised in tests; in a running deployment the
 * environment is fixed at boot.
 */
export default class GlobalRunnerRepositoryTokens {
  public static keepsConnectionTokensOffGlobalRunners(): boolean {
    return process.env["BILLING_ENABLED"] === "true";
  }

  public static isRepositoryKeptOff(
    repositoryHostedAt: string | null | undefined,
  ): boolean {
    return isRepositoryKeptOffGlobalRunners({
      repositoryHostedAt,
      isOneUptimeCloud:
        GlobalRunnerRepositoryTokens.keepsConnectionTokensOffGlobalRunners(),
    });
  }
}
