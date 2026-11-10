import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import RumProductAnalyticsSession from "../../Models/AnalyticsModels/RumProductAnalyticsSession";

/*
 * The per-session product analytics table (issue #6444). Created by boot
 * schema-sync with its materialized view and filled by it alone; read by
 * Utils/RumProductAnalytics/RumProductAnalyticsReadService, and pruned by the
 * session erasure job.
 */
export class RumProductAnalyticsSessionService extends AnalyticsDatabaseService<RumProductAnalyticsSession> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({
      modelType: RumProductAnalyticsSession,
      database: clickhouseDatabase,
    });
  }
}

export default new RumProductAnalyticsSessionService();
