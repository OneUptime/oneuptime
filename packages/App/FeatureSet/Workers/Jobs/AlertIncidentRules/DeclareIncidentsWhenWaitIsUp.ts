import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AlertIncidentRuleEngineService from "Common/Server/Services/AlertIncidentRuleEngineService";

/**
 * Ends the waits alert incident rules set: every minute, each alert whose
 * rule waits for it to stay unresolved ("Declare After") and whose wait is
 * up has an incident declared from it if it is still unresolved, and is
 * left an alert if it was resolved meanwhile. The waits are on the alerts
 * (Alert.nextIncidentRuleCheckAt), so a wait that ended while the workers
 * were down is ended on the first run after they are back
 * (AlertIncidentRuleEngineService says how).
 */
RunCron(
  "AlertIncidentRule:DeclareIncidentsWhenWaitIsUp",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    await AlertIncidentRuleEngineService.runDueChecks();
  },
);
