import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import InvestigationRuleWait from "Common/Server/Utils/AI/SRE/InvestigationRuleWait";

/**
 * Ends the waits investigation rules set (issue #5074): every minute, each
 * incident and alert whose wait has ended is investigated if it is still
 * open, and one resolved meanwhile is marked as not investigated, with why,
 * on its AI card. The waits are on the records, so a wait that ended while
 * the workers were down is ended on the first run after they are back
 * (InvestigationRuleWait says how).
 */
RunCron(
  "AIChat:InvestigateAfterRuleWait",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    await InvestigationRuleWait.run();
  },
);
