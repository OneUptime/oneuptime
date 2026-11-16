import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import CodeRepositoryMintedTokens from "Common/Server/Utils/CodeRepository/CodeHost/CodeRepositoryMintedTokens";

/*
 * The short-lived tokens OneUptime made for code fixes (a GitLab project
 * access token a Runner pushed a fix's branch with, issue #8912) are revoked
 * when the Runner reports the fix's end. This sweep revokes the ones no
 * report revoked: a run the stale-run sweeper failed after its Runner went
 * quiet, one queued again, one another worker now holds, one deleted - and
 * marks the ones that ended on their own. A token the host did not revoke
 * is asked about again a few minutes later, until it ends on its own.
 * Decision logic lives in CodeRepositoryMintedTokens so it is
 * unit-testable.
 */
RunCron(
  "AIAgent:RevokeMintedRepositoryTokens",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    await CodeRepositoryMintedTokens.revokeEnded();
  },
);
