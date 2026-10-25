import RunCron from "App/FeatureSet/Workers/Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { backupScheduler } from "../BackupScheduler";

/*
 * Every minute: fail runs whose worker stopped, queue the scheduled backup
 * when it is due, and start the next queued backup or restore
 * (BackupScheduler.tick). The name is part of the contract with core's
 * EnterpriseLoader, which gives a placeholder to any enterprise job ee
 * does not register: it must never change.
 *
 * The tick returns as soon as a run has started: the run goes on in this
 * worker, holding the backup lock, however long it takes. Startup runs a
 * tick at once, so a run whose worker restarted is failed (and cleaned up)
 * within minutes of the restart.
 */
export const RUN_BACKUPS_JOB_NAME: string = "Backup:RunBackups";

export const RUN_BACKUPS_JOB_TIMEOUT_IN_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(4);

RunCron(
  RUN_BACKUPS_JOB_NAME,
  {
    schedule: EVERY_MINUTE,
    runOnStartup: true,
    timeoutInMS: RUN_BACKUPS_JOB_TIMEOUT_IN_MS,
  },
  async (): Promise<void> => {
    try {
      await backupScheduler.tick();
    } catch (error) {
      logger.error(`${RUN_BACKUPS_JOB_NAME}: the tick failed:`);
      logger.error(error);
    }
  },
);
