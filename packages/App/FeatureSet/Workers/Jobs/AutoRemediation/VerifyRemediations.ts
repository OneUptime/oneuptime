import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RemediationVerifier from "Common/Server/Utils/AutoRemediation/RemediationVerifier";

/**
 * Closes the auto-remediation loop: a remediation is not done when the
 * runbook exits — it is done when the subject's monitors recover within the
 * verification window. This sweep verifies every started remediation
 * (runbook failed/overran -> Failed; monitors recovered -> Verified, with
 * optional system auto-resolve; window elapsed unhealthy -> Failed) and
 * posts the outcome to the incident/alert feed. Escalation is never
 * delayed or suppressed by verification. Conclusions are CAS-guarded, so
 * concurrent Workers replicas settle each verification exactly once.
 */
RunCron(
  "AutoRemediation:VerifyRemediations",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    await RemediationVerifier.verifyPendingRemediations();
  },
);
