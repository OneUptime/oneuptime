import RunCron from "../../Utils/Cron";
import DataSecurityLinkedFixes from "Common/Server/Utils/DataSecurity/DataSecurityLinkedFixes";
import SecurityCasePullRequestFollower from "Common/Server/Utils/SecurityCase/SecurityCasePullRequestFollower";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";

/*
 * The pull requests people linked as fixes, followed the way OneUptime
 * follows its own, by the one follower of linked pull requests
 * (LinkedPullRequestFollower), every fifteen minutes:
 *
 *   - a security case's Fix step's (#10604): an open one's state read
 *     through its repository's connection, a merged one matched to the
 *     recorded deploy that shipped its merge commit, and the case's steps
 *     checked as soon as either changes (SecurityCasePullRequestFollower);
 *   - a Data Security issue's (#10831): an open one's state read the same
 *     way; merged, its production check starts at once, and
 *     FixProductionVerifier follows it from there as it follows an AI
 *     fix of the issue (DataSecurityLinkedFixes).
 *
 * Each kind is followed in isolation: one that cannot be read never stops
 * the other.
 */
RunCron(
  "SecurityCases:FollowLinkedPullRequests",
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await SecurityCasePullRequestFollower.followAll();
    await DataSecurityLinkedFixes.followAll();
  },
);
