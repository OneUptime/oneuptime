import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DiscordReactionNoteSync from "Common/Server/Utils/Workspace/Discord/ReactionNoteSync";

/*
 * Discord never tells OneUptime about 📌 / 📣 reactions on messages people
 * post, so pins and megaphones in incident / alert threads are read from the
 * Discord REST API here and saved as notes. See DiscordReactionNoteSync.
 */
RunCron(
  "Discord:SyncReactionNotes",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(5),
  },
  async () => {
    await DiscordReactionNoteSync.syncAllProjects();
  },
);
