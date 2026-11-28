import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import MonitorTemplateChangeRunner from "Common/Server/Utils/Monitor/MonitorTemplateChangeRunner";
import logger from "Common/Server/Utils/Logger";

/*
 * The backstop of changes of monitors' template (issues #11260, #11266). A
 * change runs inside a queue job, so a worker that dies mid-way (a deploy,
 * an out-of-memory kill) would leave it Running for ever, and a job that
 * never ran would leave one Queued. Every minute this picks up a change that
 * has gone quiet where it stopped - the monitors it dealt with are never
 * touched again - and fails one that cannot go on, with a sentence saying
 * what was kept and how to try the rest again.
 */
RunCron(
  "MonitorTemplate:SweepTemplateChanges",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    try {
      await MonitorTemplateChangeRunner.sweep();
    } catch (error) {
      logger.error(
        "Monitor template change: the sweep of stalled changes failed.",
      );
      logger.error(error);
    }
  },
);
