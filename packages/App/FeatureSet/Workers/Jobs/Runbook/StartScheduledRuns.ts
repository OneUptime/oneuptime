import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RunbookScheduler, {
  RunbookSchedulerPassResult,
} from "Common/Server/Utils/Runbook/RunbookScheduler";
import logger from "Common/Server/Utils/Logger";

/*
 * Starts the runs runbooks' schedules are due for (their Triggers page).
 *
 * Once a minute, which is as often as a schedule can run. Every due time is
 * claimed with a compare-and-set before its run starts
 * (RunbookScheduler.runDueTime), so this may run on any number of Workers -
 * or twice at once on one - and each scheduled time still starts at most
 * one run.
 */
RunCron(
  "Runbook:StartScheduledRuns",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const result: RunbookSchedulerPassResult =
      await RunbookScheduler.runDueSchedules();

    if (result.outcomes.length > 0 || result.startedFromQueue > 0) {
      logger.debug(
        `Runbook:StartScheduledRuns: ${result.outcomes.length} scheduled time(s) handled, ${result.startedFromQueue} waiting run(s) started, ${result.planned} schedule(s) planned.`,
        { service: "workers" },
      );
    }
  },
);
