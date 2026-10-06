import RunCron from "../../Utils/Cron";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import InvestigationLimitCatchUp from "Common/Server/Utils/AI/SRE/InvestigationLimitCatchUp";

/**
 * Investigates the incidents and alerts a project's own daily AI limit
 * skipped, once the limit no longer stops OneUptime AI: after the reset at
 * midnight UTC, or as soon as an owner raises or removes the limit. Only
 * records still open and less than a day old, each once, through the same
 * gates as a new record (InvestigationLimitCatchUp says how).
 */
RunCron(
  "AIChat:InvestigateAfterDailyLimitReset",
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
  },
  async () => {
    await InvestigationLimitCatchUp.run();
  },
);
