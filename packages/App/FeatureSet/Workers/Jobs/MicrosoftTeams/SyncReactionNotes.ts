import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import MicrosoftTeamsReactionNoteSync from "Common/Server/Utils/Workspace/MicrosoftTeams/ReactionNoteSync";

/*
 * Microsoft Teams does not tell bots about reactions to messages people post,
 * so pins and megaphones in incident / alert channels are read from Graph
 * here and saved as notes. See MicrosoftTeamsReactionNoteSync.
 */
RunCron(
  "MicrosoftTeams:SyncReactionNotes",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(5),
  },
  async () => {
    await MicrosoftTeamsReactionNoteSync.syncAllProjects();
  },
);
