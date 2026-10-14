import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import WorkspaceUserGroupSync from "Common/Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";

/*
 * On-call user groups (Slack user groups, Microsoft Teams tags) take the
 * people on call at every hand-off, from the schedule's roster refresh. This
 * job looks at each group again every 15 minutes besides - to undo changes
 * made to it by hand, to add somebody who has since connected their
 * account - and sooner after Slack or Teams did not answer
 * (WorkspaceUserGroup.nextSyncAt).
 */
RunCron(
  "WorkspaceUserGroup:SyncUserGroups",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(5),
  },
  async () => {
    await WorkspaceUserGroupSync.syncDueGroups();
  },
);
