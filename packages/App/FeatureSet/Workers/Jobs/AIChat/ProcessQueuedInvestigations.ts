import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AIInvestigationQueue from "Common/Server/Utils/AI/SRE/InvestigationQueue";

/**
 * The durable AI investigation queue's safety net: sends the Queued AIRuns
 * to the workers again (a job that could not be added, a run the project's
 * concurrency cap or daily budget held back, a requeued attempt) and
 * expires runs that sat queued past their usefulness window. A run whose
 * job is still waiting is not added twice, and claims are CAS-guarded, so
 * a second job for a run is safe by construction.
 */
RunCron(
  "AIChat:ProcessQueuedInvestigations",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    await AIInvestigationQueue.processQueuedRuns();
  },
);
