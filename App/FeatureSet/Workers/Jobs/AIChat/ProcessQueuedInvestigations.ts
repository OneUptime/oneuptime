import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import SentinelInvestigationQueue from "Common/Server/Utils/AI/Sentinel/InvestigationQueue";

/**
 * Drains the durable Sentinel investigation queue: claims Queued AIRuns that
 * the inline path left behind (the enqueueing pod died, the project was at
 * its concurrency cap, or the daily budget was momentarily exhausted) and
 * expires runs that sat queued past their usefulness window. Claims are
 * CAS-guarded, so this job racing the inline path is safe by construction.
 */
RunCron(
  "AIChat:ProcessQueuedInvestigations",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    await SentinelInvestigationQueue.processQueuedRuns();
  },
);
