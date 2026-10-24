import RunCron from "App/FeatureSet/Workers/Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_DAY, EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import logger from "Common/Server/Utils/Logger";
import MarketplacePurchaseSync from "../MarketplacePurchaseSync";

/*
 * Reads every marketplace purchase that has not ended back from its
 * marketplace, so one whose webhook or event never arrived still ends (or
 * resumes) on time (MarketplacePurchaseSync).
 */
RunCron(
  "Marketplace:SyncPurchases",
  {
    schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_DAY,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(120),
  },
  async () => {
    if (!IsBillingEnabled) {
      logger.debug(
        "Marketplace:SyncPurchases Billing is not enabled. Skipping job.",
      );
      return;
    }

    await MarketplacePurchaseSync.syncAll();
  },
);
