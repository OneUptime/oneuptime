import RunCron from "App/FeatureSet/Workers/Utils/Cron";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import MarketplaceUsageRun, {
  REPORT_MARKETPLACE_USAGE_JOB_NAME,
  REPORT_MARKETPLACE_USAGE_TIMEOUT_IN_MS,
} from "../MarketplaceUsageRun";

/*
 * Bills this self-hosted installation's users through the cloud marketplace
 * it was bought on (MarketplaceUsageRun). Every 15 minutes, so each hour is
 * seen several times (it is billed at the most users seen in it) and a report
 * the marketplace did not take is tried again well inside AWS's six-hour
 * window; and at startup, so a fresh installation is licensed by its
 * marketplace within the first hour.
 */
RunCron(
  REPORT_MARKETPLACE_USAGE_JOB_NAME,
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: true,
    timeoutInMS: REPORT_MARKETPLACE_USAGE_TIMEOUT_IN_MS,
  },
  async (): Promise<void> => {
    await MarketplaceUsageRun.run();
  },
);
