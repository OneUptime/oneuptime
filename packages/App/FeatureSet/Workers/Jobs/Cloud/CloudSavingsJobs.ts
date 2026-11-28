import { EVERY_FIVE_MINUTE, EVERY_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import CloudOffHoursScheduler from "Common/Server/Utils/CloudSavings/CloudOffHoursScheduler";
import CloudSavingsActionRunner from "Common/Server/Utils/CloudSavings/CloudSavingsActionRunner";

/*
 * ------------------------------------------------------------------
 * Acting on cloud savings (#11010).
 *
 * CloudSavings:StepActions - every minute, the changes that wait on their
 * cloud between steps (a final snapshot before a disk is deleted, an
 * instance stopping before it is resized) and the ones AI rules made
 * without asking are taken their next steps (CloudSavingsActionRunner),
 * each leased first, so two workers never step one change at once.
 *
 * CloudSavings:RunOffHoursSchedules - every five minutes, each enabled
 * off-hours schedule stops what it picks when working hours end and starts
 * again what it stopped when they begin (CloudOffHoursScheduler). It acts
 * at those moments only, so a run that is late acts late, never twice.
 * ------------------------------------------------------------------
 */

export const STEP_CLOUD_SAVINGS_ACTIONS_JOB_NAME: string =
  "CloudSavings:StepActions";

export const RUN_OFF_HOURS_SCHEDULES_JOB_NAME: string =
  "CloudSavings:RunOffHoursSchedules";

RunCron(
  STEP_CLOUD_SAVINGS_ACTIONS_JOB_NAME,
  { schedule: EVERY_MINUTE, runOnStartup: false, timeoutInMS: 4 * 60 * 1000 },
  async (): Promise<void> => {
    try {
      const stepped: number = await CloudSavingsActionRunner.runDue();

      if (stepped > 0) {
        logger.debug(
          `${STEP_CLOUD_SAVINGS_ACTIONS_JOB_NAME}: stepped ${stepped} change(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `${STEP_CLOUD_SAVINGS_ACTIONS_JOB_NAME}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);

RunCron(
  RUN_OFF_HOURS_SCHEDULES_JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: 4 * 60 * 1000,
  },
  async (): Promise<void> => {
    try {
      const acted: number = await CloudOffHoursScheduler.runAll();

      if (acted > 0) {
        logger.debug(
          `${RUN_OFF_HOURS_SCHEDULES_JOB_NAME}: ${acted} schedule(s) stopped or started resources`,
        );
      }
    } catch (err) {
      logger.error(
        `${RUN_OFF_HOURS_SCHEDULES_JOB_NAME}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
