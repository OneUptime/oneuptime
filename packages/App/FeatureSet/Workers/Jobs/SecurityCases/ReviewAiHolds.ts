import RunCron from "../../Utils/Cron";
import SecurityCaseAiHold from "Common/Server/Utils/SecurityCase/SecurityCaseAiHold";
import { EVERY_MINUTE } from "Common/Utils/CronTime";

/*
 * OneUptime AI responding first to security cases (#10353): every minute,
 * each case whose alerts it holds is reviewed (SecurityCaseAiHold.reviewHolds)
 * - contained with every step checked or closed, it is resolved and nobody
 * is alerted; OneUptime AI asking a person, handing the case over, not
 * getting started, or the hold time running out, alerts people at once. A
 * playbook run still waiting for a hold that ended is carried on. Most holds
 * end sooner, where what ends them happens; this catches the rest.
 */
RunCron(
  "SecurityCases:ReviewAiHolds",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 2 * 60 * 1000,
  },
  async () => {
    await SecurityCaseAiHold.reviewHolds();
  },
);
