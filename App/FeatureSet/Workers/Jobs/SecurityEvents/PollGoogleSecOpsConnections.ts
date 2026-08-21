import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import GoogleSecOpsPoller from "Common/Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller";

/*
 * Google SecOps connector tick. Each run polls every enabled connection
 * that is due (per-connection poll interval) for new detection alerts and
 * ingests them as Detection Finding security events. Per-connection
 * cursors mean a timed-out run resumes where it left off.
 */
RunCron(
  "SecurityEvents:PollGoogleSecOpsConnections",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await GoogleSecOpsPoller.pollAllDueConnections();
  },
);
