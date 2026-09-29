import RunCron from "../../Utils/Cron";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import InsightScanner from "Common/Server/Utils/AI/SRE/Insights/InsightScanner";

/**
 * AI Insights watch loop: runs the deterministic telemetry detectors
 * for every project that opted in (enableAiInsights, default false)
 * and dedupes the findings into the quiet insights inbox. Detectors are
 * statistical sensors — no LLM runs in this loop; budgeted triage/fix work
 * is enqueued per NEW finding afterwards. The 10-minute timeout is shorter
 * than the 15-minute tick, so scans never overlap.
 */
RunCron(
  "AIInsight:ScanForInsights",
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await InsightScanner.scanAllProjects();
  },
);
