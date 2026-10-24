import RunCron from "App/FeatureSet/Workers/Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import logger from "Common/Server/Utils/Logger";
import MarketplaceConfig from "../MarketplaceConfig";
import VercelMarketplaceBilling from "../Vercel/VercelMarketplaceBilling";

/*
 * Bills every Vercel team for its OneUptime resources
 * (VercelMarketplaceBilling): the running totals of the month every hour,
 * the invoice of each month once it has ended, and the final invoice of a
 * team that uninstalled OneUptime - after its projects are deleted. A
 * quarter past every hour, so the hourly usage report (a minute past) has
 * written the hour it bills.
 */
RunCron(
  "Marketplace:VercelBilling",
  {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : "15 * * * *",
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(40),
  },
  async () => {
    if (!IsBillingEnabled || !MarketplaceConfig.isVercelConfigured()) {
      logger.debug(
        "Marketplace:VercelBilling Vercel Marketplace is not set up. Skipping job.",
      );
      return;
    }

    await VercelMarketplaceBilling.runAll();
  },
);
