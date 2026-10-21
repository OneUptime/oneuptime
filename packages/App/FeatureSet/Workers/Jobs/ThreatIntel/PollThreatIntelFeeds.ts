import RunCron from "../../Utils/Cron";
import registerSecurityProjectJob from "../../Utils/SecurityProjectJob";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ObjectID from "Common/Types/ObjectID";
import { SecurityProjectWorkLease } from "Common/Server/Utils/SecurityEvent/SecurityProjectWork";
import ThreatIntelFeedPoller, {
  THREAT_INTEL_POLL_PROJECT_WORK,
} from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelFeedPoller";

/*
 * Threat-intel feed tick. Each run pages through every enabled TAXII feed
 * and queues one turn for each project with a feed due (per-feed poll
 * interval). A turn polls that project's due feeds for new STIX indicator
 * objects and upserts them into the ThreatIntelIndicator table. Per-feed
 * added_after cursors and per-poll page caps mean a huge initial sync
 * progresses across successive due polls, and a turn that runs out of time
 * resumes where it left off.
 */
RunCron(
  "ThreatIntel:PollThreatIntelFeeds",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await ThreatIntelFeedPoller.enqueueProjectsWithDueFeeds();
  },
);

export const pollProjectThreatIntelFeeds: ReturnType<
  typeof registerSecurityProjectJob
> = registerSecurityProjectJob(
  THREAT_INTEL_POLL_PROJECT_WORK,
  (projectId: ObjectID, lease: SecurityProjectWorkLease): Promise<void> => {
    return ThreatIntelFeedPoller.pollDueFeedsForProject(projectId, lease);
  },
);
