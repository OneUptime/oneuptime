import RunCron from "../../Utils/Cron";
import TelegramUpdatePolling, {
  TELEGRAM_POLL_JOB_NAME,
  TELEGRAM_POLL_JOB_TIMEOUT_MS,
} from "Common/Server/Utils/TelegramUpdatePolling";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";

/*
 * Fetches the messages people send the OneUptime Telegram bot, while
 * "Poll Telegram for Messages" is on (Admin Dashboard > Settings > Telegram):
 * the way a server Telegram cannot reach links people's Telegram accounts.
 *
 * Everything that decides anything lives in
 * Common/Server/Utils/TelegramUpdatePolling. This file only says when it runs.
 *
 * Every ten seconds. A run waits up to 20 seconds for a message (Telegram's
 * long poll) and answers it the moment it arrives; a run that starts while
 * one is still waiting skips (the polling lock). With polling off, a run is
 * one read of the settings.
 */
RunCron(
  TELEGRAM_POLL_JOB_NAME,
  {
    schedule: EVERY_TEN_SECONDS,
    runOnStartup: false,
    timeoutInMS: TELEGRAM_POLL_JOB_TIMEOUT_MS,
  },
  async () => {
    await TelegramUpdatePolling.run();
  },
);
