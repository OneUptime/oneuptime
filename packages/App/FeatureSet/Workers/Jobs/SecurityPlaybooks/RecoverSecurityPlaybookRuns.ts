import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import SecurityPlaybookEngine from "Common/Server/Utils/SecurityPlaybook/SecurityPlaybookEngine";

/*
 * The playbook runs' safety net, every minute: a queued run whose job was
 * lost is queued again, and a run its worker dropped half way is failed
 * with the reason, so nothing sits in Running forever.
 */
RunCron(
  "SecurityPlaybooks:RecoverRuns",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 5 * 60 * 1000,
  },
  async () => {
    await SecurityPlaybookEngine.recoverRuns();
  },
);
