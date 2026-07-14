import RunCron from "../../Utils/Cron";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import InsightScanner from "Common/Server/Utils/AI/Sentinel/Insights/InsightScanner";

/**
 * Sentinel Insights watch loop: runs the deterministic telemetry detectors
 * for every project that opted in (enableSentinelInsights, default false)
 * and dedupes the findings into the quiet insights inbox. Detectors are
 * statistical sensors — no LLM runs in this loop; budgeted triage/fix work
 * is enqueued per NEW finding afterwards. The 10-minute timeout is shorter
 * than the 15-minute tick, so scans never overlap.
 */
RunCron(
  "SentinelInsight:ScanForInsights",
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await InsightScanner.scanAllProjects();
  },
);
