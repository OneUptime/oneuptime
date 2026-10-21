import RunCron from "../../Utils/Cron";
import registerSecurityProjectJob from "../../Utils/SecurityProjectJob";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ObjectID from "Common/Types/ObjectID";
import { SecurityProjectWorkLease } from "Common/Server/Utils/SecurityEvent/SecurityProjectWork";
import ThreatIntelMatcher, {
  THREAT_INTEL_MATCH_PROJECT_WORK,
} from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelMatcher";

/*
 * Threat-intel match tick. Each run pages through every enabled feed and
 * queues one turn for each project that has one. A turn joins that
 * project's feeds' active indicators against the security events ingested
 * since each feed's last evaluation; matches write Detection Finding rows
 * and open deduped alerts/incidents, exactly like the Sigma detection
 * engine. Per-feed lastEvaluatedAt cursors (capped at 24h lookback) make a
 * turn that runs out of time lossless.
 */
RunCron(
  "ThreatIntel:MatchThreatIntelIndicators",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await ThreatIntelMatcher.enqueueProjectsWithEnabledFeeds();
  },
);

export const matchProjectThreatIntelIndicators: ReturnType<
  typeof registerSecurityProjectJob
> = registerSecurityProjectJob(
  THREAT_INTEL_MATCH_PROJECT_WORK,
  (projectId: ObjectID, lease: SecurityProjectWorkLease): Promise<void> => {
    return ThreatIntelMatcher.evaluateFeedsForProject(projectId, lease);
  },
);
