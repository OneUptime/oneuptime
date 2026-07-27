import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RemediationStatusSync from "Common/Server/Utils/AI/SRE/RemediationStatusSync";

/**
 * AI remediation status sweeper: finalizes Executing remediation actions
 * from their linked RunbookExecution (Completed → Succeeded, Failed/
 * Cancelled → Failed) and posts the outcome to the incident/alert timeline
 * with a workspace notification — execution on customer infrastructure is
 * always news. Also quietly sweeps Proposed actions past their 24h expiry
 * to Expired. Every transition is CAS-guarded, so this job racing the
 * executor or a concurrent approve is safe by construction.
 */
RunCron(
  "AIRemediation:SyncExecutionStatus",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    await RemediationStatusSync.sync();
  },
);
