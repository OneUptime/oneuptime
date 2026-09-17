import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ThreatIntelFeedPoller from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelFeedPoller";

/*
 * Threat-intel feed tick. Each run polls every enabled TAXII feed that
 * is due (per-feed poll interval) for new STIX indicator objects and
 * upserts them into the ThreatIntelIndicator table. Per-feed added_after
 * cursors and per-poll page caps mean a huge initial sync progresses
 * across successive due polls, and a timed-out run resumes where it
 * left off.
 */
RunCron(
  "ThreatIntel:PollThreatIntelFeeds",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await ThreatIntelFeedPoller.pollAllDueFeeds();
  },
);
