import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import RumProductAnalyticsUser from "../../Models/AnalyticsModels/RumProductAnalyticsUser";

/*
 * The per-person-per-month product analytics table (issue #6444). Created by
 * boot schema-sync with its materialized view and filled by it alone; read by
 * Utils/RumProductAnalytics/RumProductAnalyticsReadService, and pruned by the
 * session erasure job.
 */
export class RumProductAnalyticsUserService extends AnalyticsDatabaseService<RumProductAnalyticsUser> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({
      modelType: RumProductAnalyticsUser,
      database: clickhouseDatabase,
    });
  }
}

export default new RumProductAnalyticsUserService();
