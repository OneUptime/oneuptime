import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import SecurityEventConnectionRunExecutor from "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor";

/*
 * Security Event Connections tick. Each run enqueues a poll for every
 * enabled connection that is due (per-connection interval); the poll
 * itself runs as its own queue job with a run-history row, so the
 * dashboard can show what was queued and what it found.
 */
RunCron(
  "SecurityEvents:PollSecurityEventConnections",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await SecurityEventConnectionRunExecutor.enqueueDueConnections();
  },
);
