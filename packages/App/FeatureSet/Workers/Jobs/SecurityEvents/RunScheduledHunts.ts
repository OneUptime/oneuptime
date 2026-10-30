import RunCron from "../../Utils/Cron";
import registerSecurityProjectJob from "../../Utils/SecurityProjectJob";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ObjectID from "Common/Types/ObjectID";
import { SecurityProjectWorkLease } from "Common/Server/Utils/SecurityEvent/SecurityProjectWork";
import SecurityHuntScheduler, {
  SECURITY_HUNTS_PROJECT_WORK,
} from "Common/Server/Utils/SecurityEvent/Hunts/SecurityHuntScheduler";

/*
 * Scheduled hunts (Types/SecurityEvent/SecurityHunt). Each minute the cron
 * queues one turn for each project with a hunt due; a turn runs that
 * project's due hunts under the project's lease, each over the events that
 * arrived since its last run, and tells the people a hunt names when it
 * finds some (SecurityHuntScheduler). A hunt left over when the turn runs
 * out of time is still due next minute.
 */
RunCron(
  "SecurityHunts:RunScheduledHunts",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 5 * 60 * 1000,
  },
  async () => {
    await SecurityHuntScheduler.enqueueProjectsWithDueHunts();
  },
);

export const runProjectSecurityHunts: ReturnType<
  typeof registerSecurityProjectJob
> = registerSecurityProjectJob(
  SECURITY_HUNTS_PROJECT_WORK,
  (projectId: ObjectID, lease: SecurityProjectWorkLease): Promise<void> => {
    return SecurityHuntScheduler.runDueHuntsForProject(projectId, lease);
  },
);
