import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import OnCallAcknowledgementTimeout from "Common/Server/Utils/OnCall/OnCallAcknowledgementTimeout";

/**
 * An on-call policy's acknowledgement timeout (issue #5123): every minute,
 * each record a policy paged about that is still acknowledged and not
 * resolved when the policy's timeout runs out is paged about again - the
 * person who acknowledged it and whoever is on call now. The clocks are on
 * the runs, so a timeout that ran out while the workers were down pages
 * again on the first run after they are back; each clock is claimed, so it
 * pages again once (OnCallAcknowledgementTimeout says how).
 */
RunCron(
  "OnCallDutyPolicyExecutionLog:PageAgainAfterAcknowledgementTimeout",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    await OnCallAcknowledgementTimeout.run();
  },
);
