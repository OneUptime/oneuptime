import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import AddCustomChannelToEveryonesRules from "Common/Server/Utils/OnCall/AddCustomChannelToEveryonesRules";

/*
 * Adds every custom channel that started paging everyone to everybody's
 * on-call rules (Common/Server/Utils/OnCall/AddCustomChannelToEveryonesRules).
 *
 * CustomNotificationChannelService enqueues it by name the moment a channel
 * starts paging everyone (it duplicates JOB_NAME below verbatim - Common
 * cannot import from App), so in practice it runs within seconds. It also
 * runs on a schedule: the Worker queue hands the job no payload, the job
 * re-derives its work from the channels themselves, and a lost enqueue -
 * Redis down, a worker mid-deploy - costs minutes rather than coverage.
 */

/*
 * Enqueued by name from Common/Server/Services/CustomNotificationChannelService.ts.
 * Renaming this means renaming it there.
 */
const JOB_NAME: string = "OnCallDutyPolicy:AddCustomChannelToEveryonesRules";

/*
 * Single-flight lock. Every write is a check-then-create, and two runs at
 * once would both read "no rule yet" and both write one - a person paged
 * twice for one incident. Both ways the job starts, the schedule and the
 * by-name enqueue, take the same key. A run that finds it held skips: the
 * holder is already doing the same channels.
 *
 * The timeout outlives the job's own: QueueWorker.runJobWithTimeout races the
 * body rather than stopping it, and redis-semaphore refreshes the lock while
 * it is held, so this only bounds how long a crashed worker's lock lingers.
 */
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
