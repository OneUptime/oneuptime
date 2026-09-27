import RunCron from "../../Utils/Cron";
import Service from "Common/Server/Services/DiscordCreationDraftService";
import { EVERY_MINUTE } from "Common/Utils/CronTime";

RunCron(
  "Discord:ClearExpiredCreationDrafts",
  { schedule: EVERY_MINUTE, runOnStartup: true },
  async (): Promise<void> => {
    await Service.clearExpiredContent();
  },
);
