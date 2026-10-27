import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AiFirstResponder from "Common/Server/Utils/AI/FirstResponder/AiFirstResponder";

/*
 * Every minute, each page OneUptime AI holds while it works (OnCallPolicyAiHold)
 * is reviewed against what AI did since: kept while it investigates or its fix
 * is checked, its record resolved once the fix is verified, or handed to
 * people as soon as AI cannot fix it (AiFirstResponder.reviewHolds). A hold
 * whose time runs out starts as any waiting run does (ExecutePendingExecutions).
 */
RunCron(
  "OnCallDutyPolicyExecutionLog:ReviewAiFirstResponderHolds",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    await AiFirstResponder.reviewHolds();
  },
);
