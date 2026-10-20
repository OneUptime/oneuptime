import RunCron from "../../Utils/Cron";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import FixProductionVerifier from "Common/Server/Utils/AI/CodeFix/FixProductionVerifier";

/*
 * Whether merged AI fixes fixed their exceptions in production: finds the
 * recorded deploy that shipped each one and watches its exception there
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
