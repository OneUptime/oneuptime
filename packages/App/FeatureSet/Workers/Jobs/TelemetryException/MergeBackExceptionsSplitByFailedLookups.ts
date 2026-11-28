import RunCron from "../../Utils/Cron";
import MergeBackExceptionsSplitByFailedLookups, {
  MERGE_BACK_SPLITS_JOB_NAME,
} from "../../DataMigrations/MergeBackExceptionsSplitByFailedLookups";
import { EVERY_FIFTEEN_MINUTE, EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";

// How long a run reads, at most; what is left waits for the next one.
export const MERGE_BACK_SPLITS_TIME_BUDGET_MS: number = 10 * 60 * 1000;

/*
 * Goes on with merging back the duplicates a failed lookup made before
 * #11027 whose error never happens again (#11113), from where the upgrade's
 * run of the MergeBackExceptionsSplitByFailedLookups data migration stopped:
 * that run takes a couple of minutes at most, so a large install's sweep
 * never holds up its upgrade. Every 15 minutes, and at startup, one run at a
 * time (CronLock), each bounded by its time budget, until every exception
 * made since grouping v2 has been read; then it does nothing, ever.
 */
RunCron(
  MERGE_BACK_SPLITS_JOB_NAME,
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIFTEEN_MINUTE,
    runOnStartup: true,
    timeoutInMS: MERGE_BACK_SPLITS_TIME_BUDGET_MS + 5 * 60 * 1000,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      await new MergeBackExceptionsSplitByFailedLookups().continueSweep({
        deadline: deadline,
        timeBudgetMs: MERGE_BACK_SPLITS_TIME_BUDGET_MS,
      });
    } catch (err) {
      logger.error(
        `${MERGE_BACK_SPLITS_JOB_NAME}: the sweep stopped; the next run goes on from where it did: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  },
);
