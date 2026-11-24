import RunCron from "../../Utils/Cron";
import SecurityCasePullRequestFollower from "Common/Server/Utils/SecurityCase/SecurityCasePullRequestFollower";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";

/*
 * The pull requests people linked to security cases' Fix steps (#10604),
 * followed the way OneUptime follows its own: every fifteen minutes, an
 * open one's state is read through its repository's connection, and a
 * merged one is matched to the recorded deploy that shipped its merge
 * commit (SecurityCasePullRequestFollower). The case's steps are checked as
 * soon as either changes, so its Fix step names the fix that shipped.
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
  },
);
