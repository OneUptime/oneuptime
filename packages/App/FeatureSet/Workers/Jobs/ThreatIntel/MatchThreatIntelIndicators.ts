import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ThreatIntelMatcher from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelMatcher";

/*
 * Threat-intel match tick. Each run joins every enabled feed's active
 * indicators against the security events ingested since that feed's
 * last evaluation; matches write Detection Finding rows and open deduped
 * alerts/incidents, exactly like the Sigma detection engine. Per-feed
 * lastEvaluatedAt cursors (capped at 24h lookback) make a timed-out run
 * lossless.
 */
RunCron(
  "ThreatIntel:MatchThreatIntelIndicators",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await ThreatIntelMatcher.evaluateAllDueFeeds();
  },
);
