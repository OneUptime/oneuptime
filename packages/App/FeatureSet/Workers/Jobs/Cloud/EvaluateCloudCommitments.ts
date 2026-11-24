import { EVERY_HOUR } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import CloudCommitmentAlertEvaluator from "Common/Server/Utils/CloudConnection/CloudCommitmentAlertEvaluator";

/*
 * ------------------------------------------------------------------
 * Cloud:EvaluateCloudCommitments
 *
 * Once an hour, every project's commitments (CloudCommitment) and each of
 * its accounts' coverage are checked against its commitment alerts - before
 * a commitment ends (90, 30 and 7 days by default), while one is under-used,
 * when coverage falls - and the alerts that no longer hold are resolved
 * (CloudCommitmentAlertEvaluator). A connection checks its project's right
 * after it reads its commitments too, once a day; this tick is for what
 * comes without a read: the days running out.
 * ------------------------------------------------------------------
 */

export const EVALUATE_CLOUD_COMMITMENTS_JOB_NAME: string =
  "Cloud:EvaluateCloudCommitments";

RunCron(
  EVALUATE_CLOUD_COMMITMENTS_JOB_NAME,
  { schedule: EVERY_HOUR, runOnStartup: false },
  async (): Promise<void> => {
    try {
      const evaluated: number = await CloudCommitmentAlertEvaluator.evaluateAll();

      if (evaluated > 0) {
        logger.debug(
          `${EVALUATE_CLOUD_COMMITMENTS_JOB_NAME}: checked the commitments of ${evaluated} project(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `${EVALUATE_CLOUD_COMMITMENTS_JOB_NAME}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
