import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RemediationPlanRunner from "Common/Server/Utils/AI/Remediation/RemediationPlanRunner";

/**
 * Settles auto-remediation suggestions stranded in Planning: the AI plan
 * run's postAnalysis is the only happy-path settle, and several run
 * outcomes (queue-TTL expiry, permanent failure, stale pod out of retries,
 * empty analysis, a settle write that failed post-completion) never reach
 * it. This sweep moves those suggestions to NoneApplicable so the incident
 * page never shows an eternal "AI is picking a runbook…" spinner. Settles
 * are CAS-guarded, so racing a still-finishing plan is safe by
 * construction.
 */
RunCron(
  "AutoRemediation:SettleStrandedSuggestions",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    await RemediationPlanRunner.settleStrandedPlanningSuggestions();
  },
);
