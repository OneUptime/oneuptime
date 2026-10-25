import RunCron from "App/FeatureSet/Workers/Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_FIVE_MINUTE, EVERY_HOUR } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import logger from "Common/Server/Utils/Logger";
import MarketplaceUsageReporter from "../MarketplaceUsageReporter";

/*
 * Reports the last hour of every marketplace-billed project - its plan's
 * seats, active monitors and telemetry - to the marketplace that bills it
 * (MarketplaceUsageReporter). A minute past every hour, so the hour it
 * reports has ended. Google Cloud asks for usage within an hour of it
 * happening; AWS and Microsoft take it for 24 hours.
 */
RunCron(
  "Marketplace:ReportUsage",
  {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_HOUR,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(50),
  },
  async () => {
    if (!IsBillingEnabled) {
      logger.debug(
        "Marketplace:ReportUsage Billing is not enabled. Skipping job.",
      );
      return;
    }

    await MarketplaceUsageReporter.reportAll();
  },
);
