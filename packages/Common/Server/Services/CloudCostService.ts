import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import CloudCost from "../../Models/AnalyticsModels/CloudCost";

/*
 * What each connected cloud account cost (CloudCost). Written by the costs
 * lane only (CloudCostWriter), read through /aggregate and the account's
 * summary. Its rows keep the table's own retention (400 days), not the
 * project's telemetry retention: a year back is what a cost compares with.
 */
export class CloudCostService extends AnalyticsDatabaseService<CloudCost> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: CloudCost, database: clickhouseDatabase });
  }
}

export default new CloudCostService();
