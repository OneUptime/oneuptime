import {
  IsBillingEnabled,
  WatchedTablePricingConfig,
} from "../../EnvironmentConfig";
import PayAsYouGoBillingService from "../../Services/PayAsYouGoBillingService";
import { WatchedTableMeteredPlan } from "../../Types/Billing/MeteredPlan/AllMeteredPlans";
import WatchedTableMeteredPlanType from "../../Types/Billing/MeteredPlan/WatchedTableMeteredPlan";
import logger from "../Logger";
import { getWatchedTablesCostInUSD } from "../../../Types/Billing/PayAsYouGoPricing";
import { DataObservabilityWatchedTables } from "../../../Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE TABLES A PROJECT MAY ADD, AND WHAT IT PAYS FOR THEM.
 *
 * Once watched tables are charged, a project with no way to pay keeps its free
 * ones and adds no more. As with active monitors, nothing already watched is
 * turned off: a project past its free tables keeps them, and a new table is left
 * out, and said so on its database, until there is room or a way to pay.
 */
export default class WatchedTableLimit {
  public static isCharging(): boolean {
    return IsBillingEnabled && WatchedTableMeteredPlan.hasPriceId();
  }

  public static async getRoomForNewTables(
    projectId: ObjectID,
  ): Promise<number> {
    if (!this.isCharging()) {
      return Number.POSITIVE_INFINITY;
    }

    try {
      if (await PayAsYouGoBillingService.canUsePayAsYouGo(projectId)) {
        return Number.POSITIVE_INFINITY;
      }

      return Math.max(
        0,
        WatchedTablePricingConfig.includedTables -
          (await WatchedTableMeteredPlanType.countWatchedTables(projectId)),
      );
    } catch (error) {
      // A hiccup reading the payment setup never costs anyone a table.
      logger.error(
        `Data Observability: could not read what project ${projectId.toString()} may add`,
      );
      logger.error(error);

      return Number.POSITIVE_INFINITY;
    }
  }

  public static async read(
    projectId: ObjectID,
  ): Promise<DataObservabilityWatchedTables> {
    const tableCount: number =
      await WatchedTableMeteredPlanType.countWatchedTables(projectId);

    return {
      isBilled: IsBillingEnabled,
      isCharging: this.isCharging(),
      tableCount,
      monthlyCostInUSD: getWatchedTablesCostInUSD(
        tableCount,
        WatchedTablePricingConfig,
      ),
      pricing: WatchedTablePricingConfig,
      canAddTables: (await this.getRoomForNewTables(projectId)) > 0,
    };
  }
}
