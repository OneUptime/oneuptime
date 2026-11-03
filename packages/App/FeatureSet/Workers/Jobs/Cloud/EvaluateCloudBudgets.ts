import { EVERY_HOUR } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import CloudBudgetEvaluator from "Common/Server/Utils/CloudConnection/CloudBudgetEvaluator";

/*
 * ------------------------------------------------------------------
 * Cloud:EvaluateCloudBudgets
 *
 * Once an hour, every enabled cloud budget (CloudBudget) is compared with
 * what its accounts cost this month so far and are on course to cost, and
 * raises its alerts (CloudBudgetEvaluator). A connection checks its
 * project's budgets right after it reads their costs too; this tick is for
 * what comes without a read: a new month (the spend starts from nothing,
 * last month's alerts are resolved) and a budget saved while its
 * accounts' costs were not being read.
 * ------------------------------------------------------------------
 */

export const EVALUATE_CLOUD_BUDGETS_JOB_NAME: string =
  "Cloud:EvaluateCloudBudgets";

RunCron(
  EVALUATE_CLOUD_BUDGETS_JOB_NAME,
  { schedule: EVERY_HOUR, runOnStartup: false },
  async (): Promise<void> => {
    try {
      const evaluated: number = await CloudBudgetEvaluator.evaluateAll();

      if (evaluated > 0) {
        logger.debug(
          `${EVALUATE_CLOUD_BUDGETS_JOB_NAME}: checked ${evaluated} cloud budget(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `${EVALUATE_CLOUD_BUDGETS_JOB_NAME}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
