import RunCron from "../../Utils/Cron";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import FixProductionVerifier from "Common/Server/Utils/AI/CodeFix/FixProductionVerifier";

/*
 * Whether merged AI fixes worked in production: finds the recorded deploy
 * that shipped each one and watches there what it was for - an exception,
 * a slow operation, a monitor's incidents, the telemetry it adds
 * (FixProductionVerifier). Never throws.
 */
RunCron(
  "AIAgent:VerifyFixesInProduction",
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
  },
  async () => {
    await FixProductionVerifier.verifyAll();
  },
);
