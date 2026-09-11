import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import SecurityEventConnectionPoller from "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";

/*
 * Poll all enabled managed security-event connections that are due. The
 * poller owns provider pagination, overlap windows, deduplication, and cursor
 * advancement, including persisted provider continuations and bounded retries.
 */
RunCron(
  "SecurityEvents:PollSecurityEventConnections",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 12 * 60 * 1000,
  },
  async () => {
    await SecurityEventConnectionPoller.pollAllDueConnections();
  },
);
