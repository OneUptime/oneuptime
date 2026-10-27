import AddCustomChannelToEveryonesRules from "../AddCustomChannelToEveryonesRules";
import RunCron from "App/FeatureSet/Workers/Utils/Cron";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import { ADD_CUSTOM_CHANNEL_TO_EVERYONES_RULES_JOB_NAME } from "Common/Server/Services/CustomNotificationChannelService";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * Adds every custom channel that started paging everyone to everybody's
 * on-call rules (AddCustomChannelToEveryonesRules).
 *
 * CustomNotificationChannelService, in core, enqueues it by this name the
 * moment a channel starts paging everyone, so in practice it runs within
 * seconds. It also runs on a schedule: the Worker queue hands the job no
 * payload, the job re-derives its work from the channels themselves, and a
 * lost enqueue - Redis down, a worker mid-deploy - costs minutes rather than
 * coverage.
 */
const JOB_NAME: string = ADD_CUSTOM_CHANNEL_TO_EVERYONES_RULES_JOB_NAME;

const LOCK_KEY: string = JOB_NAME;
const LOCK_NAMESPACE: string = "Workers.Cron";
const LOCK_TIMEOUT_MS: number = OneUptimeDate.convertMinutesToMilliseconds(6);

RunCron(
  JOB_NAME,
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: LOCK_KEY,
        namespace: LOCK_NAMESPACE,
        lockTimeout: LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
      });
    } catch (err) {
      logger.debug(
        `${JOB_NAME}: could not acquire the lock; a run is already in flight (or Redis is unavailable). Skipping this run: ${err}`,
      );
      return;
    }

    try {
      const finished: number = await AddCustomChannelToEveryonesRules.run();

      if (finished > 0) {
        logger.debug(
          `${JOB_NAME}: added ${finished} custom channel(s) to everyone's on-call rules`,
          { service: "workers" },
        );
      }
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        // A release failure only means the lock expires on its own timeout.
        logger.error(`${JOB_NAME}: error releasing the lock: ${err}`);
      }
    }
  },
);
